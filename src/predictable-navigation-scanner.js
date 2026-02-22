const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Predictable Navigation Scanner for WCAG 2.1 compliance testing
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

            if (causesContextChange) {
              // Check if it's a select dropdown (which is more acceptable)
              const isSelectElement = element.tagName.toLowerCase() === 'select';
              
              // For select elements, check if there's a warning or submit button
              if (isSelectElement) {
                const hasWarning = element.parentElement.textContent.toLowerCase().includes('automatically') ||
                                 element.parentElement.querySelector('[role="alert"]') ||
                                 element.getAttribute('aria-describedby');

                if (!hasWarning) {
                  issues.push({
                    type: 'select-auto-submit-no-warning',
                    element: elementInfo.selector,
                    description: 'Select element auto-submits form without warning to user',
                    severity: 'error'
                  });
                  predictable = false;
                }
              } else {
                issues.push({
                  type: 'input-causes-context-change',
                  element: elementInfo.selector,
                  description: 'Input change triggers unexpected navigation or form submission',
                  severity: 'error'
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

      // Analyze main navigation structure
      const navigationElements = document.querySelectorAll('nav, [role="navigation"], .navigation, .nav-menu, .main-nav');
      
      if (navigationElements.length === 0) {
        issues.push({
          type: 'no-navigation-landmark',
          element: 'document',
          description: 'No navigation landmark found - affects consistency across pages',
          severity: 'warning'
        });
      }

      navigationElements.forEach(nav => {
        const navInfo = {
          selector: nav.tagName.toLowerCase() + 
                   (nav.id ? `#${nav.id}` : '') + 
                   (nav.className ? `.${nav.className.split(' ')[0]}` : '')
        };

        // Check for consistent navigation patterns
        const navLinks = nav.querySelectorAll('a[href], button');
        
        // Analyze link structure consistency
        let hasInconsistentStructure = false;
        const linkPatterns = [];

        navLinks.forEach(link => {
          const pattern = {
            hasIcon: link.querySelector('img, svg, i[class*="icon"]') !== null,
            hasText: link.textContent.trim().length > 0,
            hasSubMenu: link.nextElementSibling && 
                       (link.nextElementSibling.tagName === 'UL' || 
                        link.nextElementSibling.classList.contains('submenu'))
          };
          linkPatterns.push(pattern);
        });

        // Check if all nav items follow the same pattern
        if (linkPatterns.length > 1) {
          const firstPattern = linkPatterns[0];
          const isConsistent = linkPatterns.every(pattern => 
            pattern.hasIcon === firstPattern.hasIcon &&
            pattern.hasText === firstPattern.hasText
          );

          if (!isConsistent) {
            hasInconsistentStructure = true;
          }
        }

        if (hasInconsistentStructure) {
          issues.push({
            type: 'inconsistent-nav-structure',
            element: navInfo.selector,
            description: 'Navigation items have inconsistent structure (icons, text, submenus)',
            severity: 'warning'
          });
        }

        // Check for breadcrumbs consistency
        const breadcrumbs = document.querySelector('[aria-label*="breadcrumb"], .breadcrumb, nav[aria-label*="breadcrumb"]');
        if (breadcrumbs) {
          const breadcrumbItems = breadcrumbs.querySelectorAll('li, .breadcrumb-item');
          
          if (breadcrumbItems.length > 1) {
            // Check if breadcrumbs use CSS-based separators (preferred method)
            let hasCSSSeperators = false;
            
            breadcrumbItems.forEach(item => {
              const computedStyle = window.getComputedStyle(item, '::before');
              if (computedStyle.content !== 'none' && computedStyle.content !== '' && computedStyle.content !== 'normal') {
                hasCSSSeperators = true;
              }
            });

            if (!hasCSSSeperators) {
              // Check text-based separators
              let separatorCount = 0;
              const separators = ['/>', '/', '>', '»', '→', '|'];
              
              separators.forEach(sep => {
                const count = breadcrumbs.textContent.split(sep).length - 1;
                if (count > separatorCount) separatorCount = count;
              });

              const expectedSeparators = breadcrumbItems.length - 1;
              if (separatorCount === 0 && expectedSeparators > 0) {
                issues.push({
                  type: 'missing-breadcrumb-separators',
                  element: 'breadcrumb',
                  description: 'Breadcrumb items lack visual separators',
                  severity: 'warning'
                });
              }
            }
          }
        }
      });

      // Check for consistent skip links
      const skipLinks = document.querySelectorAll('a[href^="#"], [class*="skip"]');
      let hasMainContentSkip = false;
      let hasNavigationSkip = false;

      skipLinks.forEach(link => {
        const linkText = link.textContent.toLowerCase();
        if (linkText.includes('main') || linkText.includes('content')) {
          hasMainContentSkip = true;
        }
        if (linkText.includes('nav') || linkText.includes('menu')) {
          hasNavigationSkip = true;
        }
      });

      // If there's navigation, there should be skip links
      if (navigationElements.length > 0 && !hasMainContentSkip) {
        issues.push({
          type: 'missing-skip-to-main',
          element: 'document',
          description: 'Navigation present but no "skip to main content" link found',
          severity: 'warning'
        });
      }

      // Check for consistent headings structure
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headings.length > 0) {
        let hasH1 = false;
        let hasSkippedLevels = false;
        let previousLevel = 0;

        headings.forEach(heading => {
          const level = parseInt(heading.tagName.charAt(1));
          
          if (level === 1) hasH1 = true;
          
          if (previousLevel > 0 && level > previousLevel + 1) {
            hasSkippedLevels = true;
          }
          
          previousLevel = level;
        });

        if (!hasH1) {
          issues.push({
            type: 'missing-h1-heading',
            element: 'document',
            description: 'No H1 heading found - affects navigation consistency',
            severity: 'warning'
          });
        }

        if (hasSkippedLevels) {
          issues.push({
            type: 'skipped-heading-levels',
            element: 'document',
            description: 'Heading levels are skipped - affects navigation structure consistency',
            severity: 'warning'
          });
          consistent = false;
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

      // Check for consistent button identification
      const buttons = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
      const buttonPatterns = new Map();

      buttons.forEach(button => {
        const text = button.textContent.trim().toLowerCase();
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        const type = button.type || button.getAttribute('role') || 'button';
        
        // Group buttons by similar function - be more specific
        let functionType = 'other';
        if (text.includes('submit') || type === 'submit' || text.includes('send') || text.includes('confirm')) {
          functionType = 'submit';
        } else if (text.includes('cancel') || text.includes('close') || text.includes('dismiss')) {
          functionType = 'cancel';
        } else if (text.includes('save') || text.includes('store')) {
          functionType = 'save';
        } else if (text.includes('delete') || text.includes('remove') || text.includes('trash')) {
          functionType = 'delete';
        } else if (text.includes('edit') || text.includes('modify') || text.includes('change')) {
          functionType = 'edit';
        } else if (text.includes('add') || text.includes('create') || text.includes('new')) {
          functionType = 'add';
        } else if (text.includes('search') || text.includes('find')) {
          functionType = 'search';
        } else if (text.includes('next') || text.includes('continue') || text.includes('proceed')) {
          functionType = 'navigate';
        } else if (text.includes('back') || text.includes('previous') || text.includes('return')) {
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
            const textSimilar = button.text === firstButton.text ||
                              button.text.includes(firstButton.text.split(' ')[0]) ||
                              firstButton.text.includes(button.text.split(' ')[0]);
            
            const labelSimilar = button.ariaLabel === firstButton.ariaLabel ||
                               button.ariaLabel.includes(firstButton.ariaLabel.split(' ')[0]) ||
                               firstButton.ariaLabel.includes(button.ariaLabel.split(' ')[0]);

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
      'no-navigation-landmark': 'Add <nav> element or role="navigation" to identify main navigation',
      'inconsistent-nav-structure': 'Standardize navigation item structure (consistent use of icons, text, submenus)',
      'inconsistent-breadcrumb-separators': 'Use consistent breadcrumb separators throughout the site',
      'missing-skip-to-main': 'Add "Skip to main content" link at the beginning of the page',
      'missing-h1-heading': 'Add single H1 heading to identify main page content',
      'skipped-heading-levels': 'Use sequential heading levels (H1→H2→H3) without skipping'
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