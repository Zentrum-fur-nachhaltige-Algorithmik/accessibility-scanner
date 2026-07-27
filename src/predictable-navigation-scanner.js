const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Predictable Navigation Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.3.2.1, 9.3.2.2, 9.3.2.3, 9.3.2.4
 * Tests navigation consistency, predictable behavior, and user control
 */
class PredictableNavigationScanner extends BaseScanner {
  constructor() {
    super('predictable-navigation', {
      wcagCriteria: ['3.2.1', '3.2.2', '3.2.3', '3.2.4'],
      wcagPrinciple: 'understandable'
    });
    this.screenshotDir = path.join(__dirname, '../tmp/predictable-navigation-screenshots');
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      testOnFocus: true,
      testOnInput: true,
      testConsistentNavigation: true,
      testConsistentIdentification: true,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const navigationResults = await this.performPredictableNavigationAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["9.3.2.1", "9.3.2.2", "9.3.2.3", "9.3.2.4"],
      passed: navigationResults.violations.length === 0,
      violations: navigationResults.violations,
      summary: {
        onFocusPredictable: navigationResults.onFocusPredictable,
        onInputPredictable: navigationResults.onInputPredictable,
        navigationConsistent: navigationResults.navigationConsistent,
        identificationConsistent: navigationResults.identificationConsistent
      },
      screenshotPath: scanDir,
      visualEvidence: navigationResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive predictable navigation analysis
   */
  async performPredictableNavigationAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let onFocusPredictable = true;
    let onInputPredictable = true;
    let navigationConsistent = true;
    let identificationConsistent = true;

    console.log('Starting predictable navigation analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'predictable-navigation-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Test on focus behavior (WCAG 3.2.1)
    if (options.testOnFocus) {
      const onFocusResults = await this.analyzeOnFocusBehavior(page, violations);
      onFocusPredictable = onFocusResults.predictable;
    }

    // 2. Test on input behavior (WCAG 3.2.2)
    if (options.testOnInput) {
      const onInputResults = await this.analyzeOnInputBehavior(page, violations);
      onInputPredictable = onInputResults.predictable;
    }

    // 3. Test consistent navigation (WCAG 3.2.3)
    if (options.testConsistentNavigation) {
      const consistentNavResults = await this.analyzeConsistentNavigation(page, violations);
      navigationConsistent = consistentNavResults.consistent;
    }

    // 4. Test consistent identification (WCAG 3.2.4)
    if (options.testConsistentIdentification) {
      const consistentIdResults = await this.analyzeConsistentIdentification(page, violations);
      identificationConsistent = consistentIdResults.consistent;
    }

    // Generate visual evidence
    visualEvidence.push({
      type: 'predictable-navigation',
      screenshot: path.basename(initialScreenshot),
      onFocusPredictable: onFocusPredictable,
      onInputPredictable: onInputPredictable,
      navigationConsistent: navigationConsistent,
      identificationConsistent: identificationConsistent
    });

    console.log(`Predictable navigation analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      onFocusPredictable,
      onInputPredictable,
      navigationConsistent,
      identificationConsistent
    };
  }

  /**
   * Analyze on focus behavior (WCAG 3.2.1)
   */
  async analyzeOnFocusBehavior(page, violations) {
    console.log('Analyzing on focus behavior...');

    const onFocusAnalysis = await page.evaluate(() => {
      const issues = [];
      let predictable = true;

      // Get all focusable elements
      const focusableElements = document.querySelectorAll('input, button, select, textarea, a[href], [tabindex], [contenteditable]');
      
      focusableElements.forEach(element => {
        const elementInfo = {
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Check for onfocus event handlers that might cause context changes
        const hasFocusHandler = element.hasAttribute('onfocus') || 
                              element.addEventListener || 
                              element.onfocus;

        if (element.hasAttribute('onfocus')) {
          const focusCode = element.getAttribute('onfocus');
          
          // Check for potentially disruptive focus actions
          const disruptiveActions = [
            'window.open', 'location.href', 'location.replace', 'location.assign',
            'form.submit', 'document.location', 'window.location',
            'history.pushState', 'history.replaceState'
          ];

          const hasDisruptiveAction = disruptiveActions.some(action => 
            focusCode.includes(action)
          );

          if (hasDisruptiveAction) {
            issues.push({
              type: 'focus-causes-context-change',
              element: elementInfo.selector,
              description: 'Focus event triggers unexpected context change without user initiation',
              severity: 'error',
              focusCode: focusCode.substring(0, 100)
            });
            predictable = false;
          }
        }

        // Check for focus traps that might be disorienting
        if (element.hasAttribute('tabindex')) {
          const tabIndex = parseInt(element.getAttribute('tabindex'));
          
          // Very high positive tabindex values can be disorienting
          if (tabIndex > 10) {
            issues.push({
              type: 'high-tabindex-focus-jump',
              element: elementInfo.selector,
              description: 'High tabindex value may cause unpredictable focus behavior',
              severity: 'warning',
              tabIndex: tabIndex
            });
          }
        }

        // Check for elements that auto-focus and might disrupt user flow
        if (element.hasAttribute('autofocus')) {
          // Auto-focus is generally ok on landing pages but problematic in modals/dynamic content
          const isInModal = element.closest('[role="dialog"]') || 
                           element.closest('.modal') ||
                           element.closest('[aria-modal="true"]');

          const isDynamicContent = element.closest('[aria-live]') ||
                                  element.closest('[role="alert"]');

          if (isInModal || isDynamicContent) {
            // Check if there's user consent for the auto-focus
            const hasUserControl = document.querySelector('button[aria-controls]') ||
                                  document.querySelector('[aria-expanded]');

            if (!hasUserControl) {
              issues.push({
                type: 'autofocus-in-dynamic-content',
                element: elementInfo.selector,
                description: 'Auto-focus in modal or dynamic content without user initiation',
                severity: 'warning'
              });
            }
          }
        }
      });

      // Check for CSS that might cause unexpected focus styling changes
      const styleSheets = Array.from(document.styleSheets);
      let hasUnpredictableFocusStyles = false;

      try {
        styleSheets.forEach(sheet => {
          try {
            const rules = Array.from(sheet.cssRules || []);
            rules.forEach(rule => {
              if (rule.selectorText && rule.selectorText.includes(':focus')) {
                const focusRule = rule.cssText;
                
                // Check for focus styles that might be disorienting
                const problematicStyles = ['display: none', 'visibility: hidden', 'position: absolute'];
                const hasProblematicStyle = problematicStyles.some(style => 
                  focusRule.includes(style)
                );

                if (hasProblematicStyle) {
                  hasUnpredictableFocusStyles = true;
                }
              }
            });
          } catch (e) {
            // Cross-origin stylesheet
          }
        });
      } catch (e) {
        // Error accessing stylesheets
      }

      if (hasUnpredictableFocusStyles) {
        issues.push({
          type: 'unpredictable-focus-styles',
          element: 'document',
          description: 'CSS focus styles may cause elements to disappear or move unexpectedly',
          severity: 'warning'
        });
      }

      return { issues, predictable };
    });

    // Create violations for on focus issues
    onFocusAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.3.2.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getOnFocusSuggestion(issue.type)
      });
    });

    return { predictable: onFocusAnalysis.predictable };
  }

  /**
   * Analyze on input behavior (WCAG 3.2.2)
   */
  async analyzeOnInputBehavior(page, violations) {
    console.log('Analyzing on input behavior...');

    const onInputAnalysis = await page.evaluate(() => {
      const issues = [];
      let predictable = true;

      /**
       * Inline handlers almost never contain the context change themselves -
       * they delegate: onchange="submitOrder(this.form)". Matching only the
       * literal attribute text therefore misses every real-world case. Read
       * the source of the global functions the handler calls (one level, no
       * recursion) so the decision rests on what the code actually does.
       */
      function resolveHandlerCode(code) {
        let resolved = code || '';
        const calledNames = new Set();
        const callPattern = /([A-Za-z_$][\w$]*)\s*\(/g;
        let match;
        while ((match = callPattern.exec(code || '')) !== null) calledNames.add(match[1]);

        for (const name of calledNames) {
          try {
            const fn = window[name];
            if (typeof fn === 'function') {
              resolved += '\n' + Function.prototype.toString.call(fn);
            }
          } catch (e) {
            // Inaccessible / cross-origin - ignore
          }
        }
        return resolved;
      }

      // Concrete constructs that change the user's context per the WCAG
      // definition (change of user agent, viewport, focus, or content that
      // changes the meaning of the page).
      const NAVIGATION_CONSTRUCTS = [
        { pattern: /\.\s*submit\s*\(/, what: 'submits the form' },
        { pattern: /\bwindow\s*\.\s*open\s*\(/, what: 'opens a new window' },
        { pattern: /\blocation\s*\.\s*(?:href|replace|assign)\s*[=(]/, what: 'navigates to another URL' },
        { pattern: /\b(?:window|document)\s*\.\s*location\s*=/, what: 'navigates to another URL' },
        { pattern: /\bhistory\s*\.\s*(?:pushState|replaceState)\s*\(/, what: 'replaces the browser history entry' }
      ];
      const DIALOG_CONSTRUCTS = [
        { pattern: /\b(?:alert|confirm|prompt)\s*\(/, what: 'opens a modal dialog which takes focus' },
        { pattern: /\.\s*showModal\s*\(/, what: 'opens a modal dialog which takes focus' }
      ];

      function detectContextChange(resolvedCode) {
        for (const c of NAVIGATION_CONSTRUCTS) {
          if (c.pattern.test(resolvedCode)) return { kind: 'navigation', what: c.what };
        }
        for (const c of DIALOG_CONSTRUCTS) {
          if (c.pattern.test(resolvedCode)) return { kind: 'dialog', what: c.what };
        }
        return null;
      }

      // Check form inputs for unexpected context changes
      const formElements = document.querySelectorAll('input, select, textarea');

      formElements.forEach(element => {
        const elementInfo = {
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Check for onchange/oninput handlers that might cause context changes
        ['onchange', 'oninput', 'onblur'].forEach(eventType => {
          if (element.hasAttribute(eventType)) {
            const eventCode = element.getAttribute(eventType);
            
            // Check for navigation/submission without user consent
            const contextChangeActions = [
              'form.submit', 'window.open', 'location.href', 'location.replace',
              'document.location', 'window.location', 'history.pushState'
            ];

            const causesContextChange = contextChangeActions.some(action => 
              eventCode.includes(action)
            );

            // The handler may only reference a function that performs the
            // context change - resolve it so indirect handlers are caught too.
            const indirect = causesContextChange ? null : detectContextChange(resolveHandlerCode(eventCode));

            if (causesContextChange || indirect) {
              // Check if it's a select dropdown (which is more acceptable)
              const isSelectElement = element.tagName.toLowerCase() === 'select';

              // For select elements, check if there's a warning or submit button
              if (isSelectElement) {
                const hasWarning = element.parentElement.textContent.toLowerCase().includes('automatically') ||
                                 element.parentElement.textContent.toLowerCase().includes('automatisch') ||
                                 element.parentElement.querySelector('[role="alert"]') ||
                                 element.getAttribute('aria-describedby');

                if (!hasWarning) {
                  issues.push({
                    type: 'select-auto-submit-no-warning',
                    element: elementInfo.selector,
                    description: 'Select element auto-submits form without warning to user',
                    severity: 'error',
                    evidence: indirect ? `${eventType} handler ${indirect.what}` : `${eventType}="${eventCode.substring(0, 80)}"`
                  });
                  predictable = false;
                }
              } else if (indirect && indirect.kind === 'dialog') {
                issues.push({
                  type: 'input-opens-modal-dialog',
                  element: elementInfo.selector,
                  description: 'Changing this control automatically opens a modal dialog, moving focus without user request',
                  severity: 'warning',
                  evidence: `${eventType} handler ${indirect.what}`
                });
                predictable = false;
              } else {
                issues.push({
                  type: 'input-causes-context-change',
                  element: elementInfo.selector,
                  description: 'Input change triggers unexpected navigation or form submission',
                  severity: 'error',
                  evidence: indirect ? `${eventType} handler ${indirect.what}` : `${eventType}="${eventCode.substring(0, 80)}"`
                });
                predictable = false;
              }
            }
          }
        });

        // Check for radio buttons that auto-submit
        if (element.type === 'radio') {
          const radioGroup = document.querySelectorAll(`input[name="${element.name}"]`);
          let hasAutoSubmit = false;
          
          radioGroup.forEach(radio => {
            if (radio.hasAttribute('onchange') || radio.hasAttribute('onclick')) {
              const eventCode = radio.getAttribute('onchange') || radio.getAttribute('onclick');
              if (eventCode.includes('submit') || eventCode.includes('location')) {
                hasAutoSubmit = true;
              }
            }
          });

          if (hasAutoSubmit) {
            // Look for submit button or warning
            const form = element.closest('form');
            const hasSubmitButton = form && form.querySelector('input[type="submit"], button[type="submit"]');
            const hasWarning = form && (form.textContent.toLowerCase().includes('automatically') ||
                                       form.querySelector('[role="alert"]'));

            if (!hasSubmitButton && !hasWarning) {
              issues.push({
                type: 'radio-auto-submit-no-control',
                element: elementInfo.selector,
                description: 'Radio button auto-submits without submit button or user warning',
                severity: 'error'
              });
              predictable = false;
            }
          }
        }

        // Check for checkboxes that immediately trigger actions
        if (element.type === 'checkbox') {
          const hasImmediateAction = element.hasAttribute('onchange') || element.hasAttribute('onclick');
          
          if (hasImmediateAction) {
            const eventCode = element.getAttribute('onchange') || element.getAttribute('onclick');
            
            // Allow simple UI state changes but not navigation
            const allowedActions = ['show', 'hide', 'toggle', 'addClass', 'removeClass'];
            const hasNavigation = eventCode.includes('location') || 
                                 eventCode.includes('submit') ||
                                 eventCode.includes('window.open');

            if (hasNavigation) {
              issues.push({
                type: 'checkbox-causes-navigation',
                element: elementInfo.selector,
                description: 'Checkbox change causes immediate navigation without user confirmation',
                severity: 'error'
              });
              predictable = false;
            }
          }
        }
      });

      // Check for forms that auto-submit on completion
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        const inputs = form.querySelectorAll('input:required');
        let hasAutoSubmitOnComplete = false;

        // Check if form has script that monitors completion
        if (form.hasAttribute('onchange') || form.hasAttribute('oninput')) {
          const formCode = form.getAttribute('onchange') || form.getAttribute('oninput');
          if (formCode.includes('submit') && formCode.includes('complete')) {
            hasAutoSubmitOnComplete = true;
          }
        }

        if (hasAutoSubmitOnComplete) {
          const hasWarning = form.textContent.toLowerCase().includes('automatically submit') ||
                           form.querySelector('[role="alert"]') ||
                           form.querySelector('.auto-submit-warning');

          if (!hasWarning) {
            issues.push({
              type: 'form-auto-submit-no-warning',
              element: 'form',
              description: 'Form auto-submits when complete without user warning',
              severity: 'error'
            });
            predictable = false;
          }
        }
      });

      return { issues, predictable };
    });

    // Create violations for on input issues
    onInputAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.3.2.2",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        evidence: issue.evidence,
        suggestion: this.getOnInputSuggestion(issue.type)
      });
    });

    return { predictable: onInputAnalysis.predictable };
  }

  /**
   * Analyze consistent navigation (WCAG 3.2.3)
   */
  async analyzeConsistentNavigation(page, violations) {
    console.log('Analyzing consistent navigation...');

    const navigationAnalysis = await page.evaluate(() => {
      const issues = [];
      let consistent = true;

      // ----------------------------------------------------------------
      // WCAG 3.2.3 Consistent Navigation
      //
      // "Navigational mechanisms that are repeated on multiple Web pages
      //  ... occur in the same relative order each time they are repeated."
      //
      // The only thing a single-document scan can observe is a navigational
      // mechanism that is REPEATED inside this document (header + footer +
      // mobile menu, or the section-per-page pattern). Two navigation blocks
      // that expose essentially the same set of destinations are the same
      // mechanism, so they must list those destinations in the same relative
      // order. A differing order is concrete evidence of a 3.2.3 failure.
      //
      // Deliberately NOT checked here (all previously reported under 3.2.3,
      // none of which is 3.2.3): "skip to main content" links belong to
      // 2.4.1 Bypass Blocks, H1 presence and skipped heading levels belong
      // to 1.3.1 / 2.4.6, and the presence of a navigation landmark belongs
      // to 1.3.1 / 2.4.1. Those are covered by the keyboard-navigation,
      // page-structure, html-validation and screen-reader scanners.
      // ----------------------------------------------------------------

      const MIN_SHARED_DESTINATIONS = 3;   // below this, two blocks are not evidently the same mechanism
      const MAX_REPORTED_PAIRS = 5;

      function selectorFor(el) {
        return el.tagName.toLowerCase() +
               (el.id ? `#${el.id}` : '') +
               (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');
      }

      const allNavs = Array.from(
        document.querySelectorAll('nav, [role="navigation"], .navigation, .nav-menu, .main-nav')
      );

      // Drop nested duplicates (e.g. <nav class="navigation">) and hidden blocks,
      // so the same markup is never compared against itself.
      const navigationElements = allNavs.filter(nav => {
        if (nav.closest('[aria-hidden="true"]')) return false;
        return !allNavs.some(other => other !== nav && other.contains(nav));
      });

      function destinationsOf(nav) {
        const seen = new Set();
        const ordered = [];
        nav.querySelectorAll('a[href]').forEach(link => {
          const name = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() ||
                       (link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (!name || seen.has(name)) return;
          seen.add(name);
          ordered.push(name);
        });
        return ordered;
      }

      const navProfiles = navigationElements
        .map(nav => ({ nav, selector: selectorFor(nav), destinations: destinationsOf(nav) }))
        .filter(profile => profile.destinations.length >= MIN_SHARED_DESTINATIONS);

      let reportedPairs = 0;

      for (let i = 0; i < navProfiles.length && reportedPairs < MAX_REPORTED_PAIRS; i++) {
        for (let j = i + 1; j < navProfiles.length && reportedPairs < MAX_REPORTED_PAIRS; j++) {
          const a = navProfiles[i];
          const b = navProfiles[j];

          const setB = new Set(b.destinations);
          const shared = a.destinations.filter(name => setB.has(name));

          if (shared.length < MIN_SHARED_DESTINATIONS) continue;

          // Require the two blocks to expose exactly the same destinations.
          // Anything less is not demonstrably the same navigational mechanism
          // repeated - a footer menu that carries the main links plus
          // "Impressum"/"Datenschutz" is its own mechanism and is free to
          // order them differently, so it must not be flagged.
          const isSameMechanism = shared.length === a.destinations.length &&
                                  shared.length === b.destinations.length;
          if (!isSameMechanism) continue;

          const orderA = a.destinations;
          const orderB = b.destinations;

          if (orderA.join('|') !== orderB.join('|')) {
            issues.push({
              type: 'inconsistent-nav-order',
              element: `${a.selector} vs ${b.selector}`,
              description: 'Repeated navigation blocks list the same destinations in a different relative order',
              severity: 'error',
              evidence: `"${orderA.join(' > ')}" vs "${orderB.join(' > ')}"`
            });
            consistent = false;
            reportedPairs++;
          }
        }
      }

      return { issues, consistent };
    });

    // Create violations for navigation consistency issues
    navigationAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.3.2.3",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        evidence: issue.evidence,
        suggestion: this.getNavigationConsistencySuggestion(issue.type)
      });
    });

    return { consistent: navigationAnalysis.consistent };
  }

  /**
   * Analyze consistent identification (WCAG 3.2.4)
   */
  async analyzeConsistentIdentification(page, violations) {
    console.log('Analyzing consistent identification...');

    const identificationAnalysis = await page.evaluate(() => {
      const issues = [];
      let consistent = true;

      /**
       * Normalise an accessible name for comparison: drop icon glyphs,
       * punctuation and whitespace noise so "🔍 Search" and "Search" compare
       * equal while "Search" and "Find" do not.
       */
      function normalizeName(value) {
        return (value || '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      /**
       * Two names count as "the same identification" only when both actually
       * exist. Comparing two ABSENT names (both '') used to evaluate to
       * `true`, which made every button pair look consistent and disabled
       * this check entirely; `''.split(' ')[0]` is also `''`, and
       * `anything.includes('')` is always true, which had the same effect
       * whenever only one of the two carried an aria-label.
       */
      function namesSimilar(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        const aFirst = a.split(' ')[0];
        const bFirst = b.split(' ')[0];
        if (!aFirst || !bFirst) return false;
        return a.includes(bFirst) || b.includes(aFirst);
      }

      // Check for consistent button identification
      const buttons = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
      const buttonPatterns = new Map();

      buttons.forEach(button => {
        const text = normalizeName(button.textContent);
        const ariaLabel = normalizeName(button.getAttribute('aria-label'));
        // Group buttons by similar function - be more specific.
        //
        // Matching is on whole words: substring matching put "Newsletter
        // abonnieren" into the "add" group (via "new") and similar accidents.
        // The button's `type` is deliberately NOT used: HTMLButtonElement.type
        // defaults to "submit" for every plain <button>, which collapsed every
        // button on the page into one "submit" group and then demanded that a
        // "Subscribe to newsletter" and an "Upload file" button carry the same
        // label. Two forms' submit buttons are named after their own form's
        // action; they are not "the same functionality" in the sense of 3.2.4.
        const words = new Set(text.split(' ').filter(Boolean));
        const hasWord = (...candidates) => candidates.some(w => words.has(w));

        let functionType = 'other';
        if (hasWord('cancel', 'close', 'dismiss')) {
          functionType = 'cancel';
        } else if (hasWord('save', 'store')) {
          functionType = 'save';
        } else if (hasWord('delete', 'remove', 'trash')) {
          functionType = 'delete';
        } else if (hasWord('edit', 'modify', 'change')) {
          functionType = 'edit';
        } else if (hasWord('add', 'create', 'new')) {
          functionType = 'add';
        } else if (hasWord('search', 'find')) {
          functionType = 'search';
        } else if (hasWord('next', 'continue', 'proceed')) {
          functionType = 'navigate';
        } else if (hasWord('back', 'previous', 'return')) {
          functionType = 'back';
        }

        if (!buttonPatterns.has(functionType)) {
          buttonPatterns.set(functionType, []);
        }

        buttonPatterns.get(functionType).push({
          element: button,
          text: text,
          ariaLabel: ariaLabel,
          selector: button.tagName.toLowerCase() + 
                   (button.id ? `#${button.id}` : '') + 
                   (button.className ? `.${button.className.split(' ')[0]}` : '')
        });
      });

      // Check for inconsistent button labeling within same function type
      buttonPatterns.forEach((buttons, functionType) => {
        // Only check specific function types, not generic "other"
        if (buttons.length > 1 && functionType !== 'other') {
          const firstButton = buttons[0];
          const inconsistentButtons = buttons.filter(button => {
            // Allow slight variations but flag major differences
            const textSimilar = namesSimilar(button.text, firstButton.text);
            const labelSimilar = namesSimilar(button.ariaLabel, firstButton.ariaLabel);

            return !textSimilar && !labelSimilar;
          });

          if (inconsistentButtons.length > 0) {
            issues.push({
              type: 'inconsistent-button-identification',
              element: 'multiple buttons',
              description: `Buttons with similar function "${functionType}" have inconsistent labels`,
              severity: 'warning',
              functionType: functionType,
              variations: buttons.map(b => b.text).join(', ')
            });
            consistent = false;
          }
        }
      });

      // Check for consistent link identification
      const links = document.querySelectorAll('a[href]');
      const linkPatterns = new Map();

      links.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim();
        const ariaLabel = link.getAttribute('aria-label') || '';

        // Group links by destination type
        let destinationType = 'internal';
        if (href.startsWith('http') && !href.includes(window.location.hostname)) {
          destinationType = 'external';
        } else if (href.startsWith('mailto:')) {
          destinationType = 'email';
        } else if (href.startsWith('tel:')) {
          destinationType = 'phone';
        } else if (href.startsWith('#')) {
          destinationType = 'anchor';
        } else if (href.includes('.pdf') || href.includes('.doc') || href.includes('.xls')) {
          destinationType = 'document';
        }

        if (!linkPatterns.has(destinationType)) {
          linkPatterns.set(destinationType, []);
        }

        linkPatterns.get(destinationType).push({
          element: link,
          text: text,
          href: href,
          ariaLabel: ariaLabel,
          selector: `a[href="${href.substring(0, 50)}"]`
        });
      });

      // Check for missing external link indicators
      if (linkPatterns.has('external')) {
        const externalLinks = linkPatterns.get('external');
        const hasExternalIndicators = externalLinks.some(link => 
          link.text.includes('(external)') ||
          link.ariaLabel.includes('external') ||
          link.element.querySelector('[class*="external"], [class*="icon"]') ||
          link.element.hasAttribute('target')
        );

        if (!hasExternalIndicators && externalLinks.length > 0) {
          issues.push({
            type: 'external-links-no-identification',
            element: 'external links',
            description: 'External links lack consistent identification (visual indicator or text)',
            severity: 'warning'
          });
        }
      }

      // Check for document link identification
      if (linkPatterns.has('document')) {
        const documentLinks = linkPatterns.get('document');
        const hasDocumentIndicators = documentLinks.some(link => {
          const hasFileType = link.text.includes('.pdf') || 
                            link.text.includes('.doc') || 
                            link.text.includes('PDF') ||
                            link.text.includes('Word');
          const hasIcon = link.element.querySelector('[class*="pdf"], [class*="doc"], [class*="file"]');
          return hasFileType || hasIcon;
        });

        if (!hasDocumentIndicators && documentLinks.length > 0) {
          issues.push({
            type: 'document-links-no-identification',
            element: 'document links',
            description: 'Document links lack file type identification',
            severity: 'warning'
          });
        }
      }

      // Check for consistent form field identification
      const formFields = document.querySelectorAll('input, select, textarea');
      const requiredFields = Array.from(formFields).filter(field => field.hasAttribute('required'));
      
      if (requiredFields.length > 1) {
        // Check what identification methods are used
        const identificationMethods = {
          asterisk: 0,
          ariaRequired: 0,
          requiredText: 0,
          cssClass: 0
        };

        requiredFields.forEach(field => {
          // Check for asterisk in label
          const hasAsterisk = field.labels && Array.from(field.labels).some(label => 
            label.textContent.includes('*') || label.className.includes('required')
          );
          if (hasAsterisk) identificationMethods.asterisk++;

          // Check for aria-required
          if (field.hasAttribute('aria-required')) identificationMethods.ariaRequired++;

          // Check for "required" text in label
          const hasRequiredText = field.labels && Array.from(field.labels).some(label => 
            label.textContent.toLowerCase().includes('required')
          );
          if (hasRequiredText) identificationMethods.requiredText++;

          // Check for CSS class indicating required
          if (field.className.includes('required') || 
              (field.labels && Array.from(field.labels).some(label => label.className.includes('required')))) {
            identificationMethods.cssClass++;
          }
        });

        // At least one method should be used consistently across all required fields
        const hasConsistentMethod = Object.values(identificationMethods).some(count => 
          count === requiredFields.length
        );

        if (!hasConsistentMethod) {
          issues.push({
            type: 'inconsistent-required-field-identification',
            element: 'form fields',
            description: 'Required form fields lack consistent identification method',
            severity: 'error'
          });
          consistent = false;
        }
      }

      // Check for consistent error identification
      const errorElements = document.querySelectorAll('[class*="error"], [role="alert"], [aria-invalid="true"]');
      if (errorElements.length > 0) {
        const errorPatterns = [];
        
        errorElements.forEach(element => {
          const hasErrorClass = element.className.includes('error');
          const hasAriaInvalid = element.hasAttribute('aria-invalid');
          const hasRole = element.getAttribute('role') === 'alert';
          const hasErrorText = element.textContent.toLowerCase().includes('error');
          
          errorPatterns.push({
            hasErrorClass,
            hasAriaInvalid,
            hasRole,
            hasErrorText
          });
        });

        // Check if error identification is consistent
        if (errorPatterns.length > 1) {
          const firstPattern = errorPatterns[0];
          const isConsistent = errorPatterns.every(pattern => 
            pattern.hasErrorClass === firstPattern.hasErrorClass ||
            pattern.hasAriaInvalid === firstPattern.hasAriaInvalid ||
            pattern.hasRole === firstPattern.hasRole
          );

          if (!isConsistent) {
            issues.push({
              type: 'inconsistent-error-identification',
              element: 'error elements',
              description: 'Error states use inconsistent identification methods',
              severity: 'warning'
            });
          }
        }
      }

      return { issues, consistent };
    });

    // Create violations for identification consistency issues
    identificationAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.3.2.4",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getIdentificationConsistencySuggestion(issue.type)
      });
    });

    return { consistent: identificationAnalysis.consistent };
  }

  /**
   * Get suggestion for on focus violations
   */
  getOnFocusSuggestion(violationType) {
    const suggestions = {
      'focus-causes-context-change': 'Remove automatic navigation on focus - require user action (click/enter)',
      'high-tabindex-focus-jump': 'Use lower tabindex values or rely on natural DOM order for predictable focus flow',
      'autofocus-in-dynamic-content': 'Remove autofocus or ensure user initiated the modal/content display',
      'unpredictable-focus-styles': 'Ensure focus styles maintain element visibility and position'
    };
    return suggestions[violationType] || 'Ensure focus behavior is predictable and user-controlled';
  }

  /**
   * Get suggestion for on input violations
   */
  getOnInputSuggestion(violationType) {
    const suggestions = {
      'input-causes-context-change': 'Add submit button instead of automatic form submission on input change',
      'input-opens-modal-dialog': 'Do not open dialogs from change/input/blur handlers - trigger them from an explicit user action such as a button press',
      'select-auto-submit-no-warning': 'Add warning text about automatic submission or provide submit button',
      'radio-auto-submit-no-control': 'Replace auto-submit with explicit submit button for user control',
      'checkbox-causes-navigation': 'Replace immediate navigation with user-initiated action (button click)',
      'form-auto-submit-no-warning': 'Add clear warning about automatic form submission behavior'
    };
    return suggestions[violationType] || 'Require explicit user action for context changes rather than automatic triggers';
  }

  /**
   * Get suggestion for navigation consistency violations
   */
  getNavigationConsistencySuggestion(violationType) {
    const suggestions = {
      'inconsistent-nav-order': 'List the repeated navigation links in the same relative order everywhere the navigation is repeated'
    };
    return suggestions[violationType] || 'Maintain consistent navigation patterns and structure across pages';
  }

  /**
   * Get suggestion for identification consistency violations
   */
  getIdentificationConsistencySuggestion(violationType) {
    const suggestions = {
      'inconsistent-button-identification': 'Use consistent button labels for similar functions across the site',
      'external-links-no-identification': 'Add consistent indicators for external links (icon, text, or target="_blank")',
      'document-links-no-identification': 'Include file type in link text or add file type icons consistently',
      'inconsistent-required-field-identification': 'Use consistent method to identify required fields (asterisk, "required" text, or aria-required)',
      'inconsistent-error-identification': 'Standardize error identification with consistent classes, ARIA attributes, and visual styling'
    };
    return suggestions[violationType] || 'Maintain consistent identification patterns for similar interface components';
  }

}

module.exports = PredictableNavigationScanner;