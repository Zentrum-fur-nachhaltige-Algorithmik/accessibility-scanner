const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: accnameCode } = require('../utils/accessible-name');

/**
 * Input Modalities Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.2.5.1, 9.2.5.2, 9.2.5.3, 9.2.5.4
 * Tests pointer gestures, cancellation, label matching, and motion actuation
 */
class InputModalitiesScanner extends BaseScanner {
  constructor() {
    super('input-modalities', {
      wcagCriteria: ['2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.7', '2.5.8'],
      wcagPrinciple: 'operable',
    });
  }

  get needsExclusiveAccess() { return true; }

  /**
   * Core scan method — receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      testPointerGestures: true,
      testMotionActuation: true,
      testLabelMatching: true,
      ...options,
    };

    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const inputResults = await this.performInputModalitiesAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["9.2.5.1", "9.2.5.2", "9.2.5.3", "9.2.5.4", "9.2.5.7", "9.2.5.8"],
      passed: inputResults.violations.length === 0,
      violations: inputResults.violations,
      summary: {
        pointerGesturesAccessible: inputResults.pointerGesturesAccessible,
        pointerCancellationAvailable: inputResults.pointerCancellationAvailable,
        labelNamesConsistent: inputResults.labelNamesConsistent,
        motionAlternativesProvided: inputResults.motionAlternativesProvided,
        draggingAlternativesProvided: inputResults.draggingAlternativesProvided,
        targetSizingAdequate: inputResults.targetSizingAdequate
      },
      screenshotPath: scanDir,
      visualEvidence: inputResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive input modalities analysis
   */
  async performInputModalitiesAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let pointerGesturesAccessible = true;
    let pointerCancellationAvailable = true;
    let labelNamesConsistent = true;
    let motionAlternativesProvided = true;
    let draggingAlternativesProvided = true;
    let targetSizingAdequate = true;

    console.log('Starting input modalities analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'input-modalities-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Test pointer gestures (WCAG 2.5.1)
    if (options.testPointerGestures) {
      const gestureResults = await this.analyzePointerGestures(page, violations);
      pointerGesturesAccessible = gestureResults.accessible;
    }

    // 2. Test pointer cancellation (WCAG 2.5.2)
    const cancellationResults = await this.analyzePointerCancellation(page, violations);
    pointerCancellationAvailable = cancellationResults.available;

    // 3. Test label in name (WCAG 2.5.3)
    if (options.testLabelMatching) {
      const labelResults = await this.analyzeLabelInName(page, violations);
      labelNamesConsistent = labelResults.consistent;
    }

    // 4. Test motion actuation (WCAG 2.5.4)
    if (options.testMotionActuation) {
      const motionResults = await this.analyzeMotionActuation(page, violations);
      motionAlternativesProvided = motionResults.alternativesProvided;
    }

    // 5. Test target size minimum (WCAG 2.5.8)
    const targetSizeResults = await this.analyzeTargetSize(page, violations);
    targetSizingAdequate = targetSizeResults.adequate;

    // 6. Test dragging movements (WCAG 2.5.7)
    const draggingResults = await this.analyzeDraggingMovements(page, violations);
    draggingAlternativesProvided = draggingResults.alternativesProvided;

    // Generate visual evidence
    visualEvidence.push({
      type: 'input-modalities',
      screenshot: path.basename(initialScreenshot),
      gesturesAccessible: pointerGesturesAccessible,
      cancellationAvailable: pointerCancellationAvailable,
      labelsConsistent: labelNamesConsistent,
      motionAlternatives: motionAlternativesProvided,
      draggingAlternatives: draggingAlternativesProvided,
      targetSizingAdequate
    });

    console.log(`Input modalities analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      pointerGesturesAccessible,
      pointerCancellationAvailable,
      labelNamesConsistent,
      motionAlternativesProvided,
      draggingAlternativesProvided,
      targetSizingAdequate
    };
  }

  /**
   * Analyze pointer gestures (WCAG 2.5.1)
   */
  async analyzePointerGestures(page, violations) {
    console.log('Analyzing pointer gestures...');

    const gestureAnalysis = await page.evaluate(() => {
      const issues = [];
      let accessible = true;

      // Find elements with complex gesture requirements
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(element => {
        // SVG/MathML elements expose className as an SVGAnimatedString, not a string
        const className = typeof element.className === 'string' ? element.className : '';
        const elementInfo = {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: className,
          selector: element.tagName.toLowerCase() +
                   (element.id ? `#${element.id}` : '') +
                   (className ? `.${className.split(' ')[0]}` : '')
        };

        // Check for drag and drop without keyboard alternatives
        if (element.hasAttribute('draggable') && element.getAttribute('draggable') === 'true') {
          const hasKeyboardAlternative = (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') ||
                                        element.querySelector('[tabindex]:not([tabindex="-1"])') ||
                                        element.closest('[role="button"]') ||
                                        document.querySelector(`button[aria-controls="${element.id}"]`);

          if (!hasKeyboardAlternative) {
            issues.push({
              type: 'drag-without-alternative',
              element: elementInfo.selector,
              description: 'Draggable element lacks keyboard alternative',
              severity: 'error'
            });
            accessible = false;
          }
        }

        // Check for multi-touch gestures without alternatives
        const hasMultiTouchListeners = element.ontouchstart || element.ontouchmove ||
                                     element.getAttribute('ontouchstart') || 
                                     element.getAttribute('ontouchmove');

        if (hasMultiTouchListeners) {
          // Check for simple touch/click alternatives
          const hasSimpleAlternative = element.onclick || element.onmouseup ||
                                      element.getAttribute('onclick') ||
                                      element.getAttribute('onmouseup') ||
                                      (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1');

          if (!hasSimpleAlternative) {
            issues.push({
              type: 'multitouch-without-alternative',
              element: elementInfo.selector,
              description: 'Multi-touch gesture lacks simple activation alternative',
              severity: 'error'
            });
            accessible = false;
          }
        }

        // Check for swipe-only interfaces (only for interactive elements)
        const isInteractiveElement = element.tagName.toLowerCase() === 'button' ||
                                   element.hasAttribute('onclick') ||
                                   element.hasAttribute('role') ||
                                   (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1');

        if (isInteractiveElement) {
          const swipeIndicators = ['swipe', 'slide'];
          const elementText = element.textContent.toLowerCase();
          const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
          
          const hasSwipeIndication = swipeIndicators.some(indicator => 
            elementText.includes(indicator) || ariaLabel.includes(indicator)
          );

          if (hasSwipeIndication) {
            // Look for alternative navigation controls
            const hasAlternativeNavigation = document.querySelector('button[aria-label*="next"]') ||
                                           document.querySelector('button[aria-label*="previous"]') ||
                                           document.querySelector('.pagination') ||
                                           document.querySelector('[role="tablist"]') ||
                                           element.closest('form') ||
                                           (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1');

            if (!hasAlternativeNavigation) {
              issues.push({
                type: 'swipe-without-alternative',
                element: elementInfo.selector,
                description: 'Swipe gesture interface lacks alternative navigation controls',
                severity: 'warning'
              });
            }
          }
        }

        // Check for path-based gestures (complex gestures)
        if (element.hasAttribute('ongesturestart') || element.hasAttribute('ongesturechange')) {
          const hasSimpleActivation = element.onclick || element.onkeydown ||
                                     element.hasAttribute('onclick') ||
                                     element.hasAttribute('onkeydown');

          if (!hasSimpleActivation) {
            issues.push({
              type: 'complex-gesture-only',
              element: elementInfo.selector,
              description: 'Complex path-based gesture lacks simple activation method',
              severity: 'error'
            });
            accessible = false;
          }
        }
      });

      return { issues, accessible };
    });

    // Create violations for gesture issues
    gestureAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.5.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getGestureSuggestion(issue.type)
      });
    });

    return { accessible: gestureAnalysis.accessible };
  }

  /**
   * Analyze pointer cancellation (WCAG 2.5.2)
   */
  async analyzePointerCancellation(page, violations) {
    console.log('Analyzing pointer cancellation...');

    const cancellationAnalysis = await page.evaluate(() => {
      const issues = [];
      let available = true;

      // Find interactive elements that might have cancellation issues
      const interactiveElements = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[href], [onclick], [onmousedown], [ontouchstart]');

      interactiveElements.forEach(element => {
        // SVG/MathML elements expose className as an SVGAnimatedString, not a string
        const className = typeof element.className === 'string' ? element.className : '';
        const elementInfo = {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: className,
          selector: element.tagName.toLowerCase() +
                   (element.id ? `#${element.id}` : '') +
                   (className ? `.${className.split(' ')[0]}` : ''),
          textContent: element.textContent.trim().substring(0, 50)
        };

        // Check for down-event activation without cancellation
        const hasDownEvent = element.onmousedown || element.ontouchstart ||
                            element.getAttribute('onmousedown') ||
                            element.getAttribute('ontouchstart');

        if (hasDownEvent) {
          // Check if there's corresponding up-event or cancellation mechanism
          const hasUpEvent = element.onmouseup || element.ontouchend ||
                           element.getAttribute('onmouseup') ||
                           element.getAttribute('ontouchend') ||
                           element.onclick || element.getAttribute('onclick');

          const hasLeaveEvent = element.onmouseleave || element.ontouchcancel ||
                              element.getAttribute('onmouseleave') ||
                              element.getAttribute('ontouchcancel');

          // Elements with keydown/keyup handlers likely have JS-registered up events too
          const hasKeyboardHandler = element.onkeydown || element.getAttribute('onkeydown') ||
                                    element.getAttribute('role') === 'slider' ||
                                    element.getAttribute('role') === 'scrollbar';

          if (!hasUpEvent && !hasLeaveEvent && !hasKeyboardHandler) {
            // Check if it's a critical action that requires cancellation
            const criticalKeywords = ['delete', 'remove', 'buy', 'purchase', 'pay', 'submit', 'send', 'confirm'];
            const isCritical = criticalKeywords.some(keyword => 
              elementInfo.textContent.toLowerCase().includes(keyword) ||
              element.getAttribute('aria-label')?.toLowerCase().includes(keyword)
            );

            if (isCritical) {
              issues.push({
                type: 'critical-action-no-cancellation',
                element: elementInfo.selector,
                description: 'Critical action activates on down-event without cancellation mechanism',
                textContent: elementInfo.textContent,
                severity: 'error'
              });
              available = false;
            } else {
              issues.push({
                type: 'down-event-no-cancellation',
                element: elementInfo.selector,
                description: 'Action activates on down-event without cancellation option',
                textContent: elementInfo.textContent,
                severity: 'warning'
              });
            }
          }
        }

        // Check for immediate actions that can't be cancelled
        const immediateActionIndicators = ['immediate', 'instant', 'auto'];
        const hasImmediateAction = immediateActionIndicators.some(indicator =>
          elementInfo.textContent.toLowerCase().includes(indicator) ||
          element.getAttribute('aria-label')?.toLowerCase().includes(indicator)
        );

        if (hasImmediateAction) {
          issues.push({
            type: 'immediate-action-no-cancel',
            element: elementInfo.selector,
            description: 'Immediate action cannot be cancelled or undone',
            textContent: elementInfo.textContent,
            severity: 'error'
          });
          available = false;
        }
      });

      return { issues, available };
    });

    // Create violations for cancellation issues
    cancellationAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.5.2",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        textContent: issue.textContent,
        severity: issue.severity,
        suggestion: this.getCancellationSuggestion(issue.type)
      });
    });

    return { available: cancellationAnalysis.available };
  }

  /**
   * Analyze label in name (WCAG 2.5.3)
   */
  async analyzeLabelInName(page, violations) {
    console.log('Analyzing label in name consistency...');

    const labelAnalysis = await page.evaluate((accnameCode, renderedCode) => {
      eval(accnameCode);
      eval(renderedCode);
      const issues = [];
      let consistent = true;

      // Visible label, normalisation and the containment test all come from
      // src/utils/accessible-name.js (__visibleLabelText / __nameContainsLabel
      // / __labelInNameOk) so this scanner and phase6a-label-in-name cannot
      // disagree about what "the visible label" is. The local copy that used
      // to live here concatenated every rendered text node, which made a
      // branding link's monogram and tagline part of the label and failed
      // every one of them — see the header comment in that file.
      const norm = __visibleLabelNormalize;

      const controls = document.querySelectorAll('button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], a[href], input[type="button"], input[type="submit"], input[type="reset"]');
      controls.forEach(element => {
        if (!__isRendered(element)) return;
        const tag = element.tagName.toLowerCase();
        const visible = __visibleLabelText(element);
        const vis = visible.full;
        if (!vis) return; // icon-only control: 2.5.3 does not apply (4.1.2 covers naming)
        const name = norm(__accessibleName(element));
        if (!name) return; // missing name is 4.1.2, reported elsewhere
        if (__labelInNameOk(element, __accessibleName(element))) return;

        const className = typeof element.className === 'string' ? element.className.trim() : '';
        issues.push({
          type: 'label-name-mismatch',
          element: tag + (element.id ? `#${element.id}` : '') + (className ? `.${className.split(/\s+/)[0]}` : ''),
          visibleText: vis.substring(0, 50),
          accessibleName: name.substring(0, 50),
          description: 'Accessible name does not contain the visible label text',
          severity: 'serious'
        });
        consistent = false;
      });

      return { issues, consistent };
    }, accnameCode, renderedCode);

    // Create violations for label consistency issues
    labelAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.5.3",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        visibleText: issue.visibleText,
        accessibleName: issue.accessibleName,
        severity: issue.severity,
        suggestion: this.getLabelSuggestion(issue.type)
      });
    });

    return { consistent: labelAnalysis.consistent };
  }

  /**
   * Analyze motion actuation (WCAG 2.5.4)
   */
  async analyzeMotionActuation(page, violations) {
    console.log('Analyzing motion actuation...');

    const motionAnalysis = await page.evaluate(() => {
      const issues = [];
      let alternativesProvided = true;

      // Check for device motion API usage
      const hasDeviceMotion = window.DeviceMotionEvent !== undefined;
      const hasDeviceOrientation = window.DeviceOrientationEvent !== undefined;

      if (hasDeviceMotion || hasDeviceOrientation) {
        // Look for motion-related keywords in visible page content (exclude script/style)
        const motionKeywords = ['shake', 'tilt', 'rotate', 'motion', 'gesture', 'device orientation'];
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        const pageText = clone.textContent.toLowerCase();
        
        const hasMotionFeatures = motionKeywords.some(keyword => pageText.includes(keyword));

        if (hasMotionFeatures) {
          // Check for disable/alternative controls
          const disableControls = document.querySelectorAll('input[type="checkbox"], button, [role="switch"]');
          let hasDisableOption = false;
          let hasAlternativeMethod = false;

          disableControls.forEach(control => {
            const controlText = control.textContent.toLowerCase() + 
                              (control.getAttribute('aria-label') || '').toLowerCase() +
                              (control.getAttribute('placeholder') || '').toLowerCase();

            if ((controlText.includes('motion') && (controlText.includes('enable') || controlText.includes('disable'))) ||
                (controlText.includes('shake') && (controlText.includes('enable') || controlText.includes('disable'))) || 
                controlText.includes('tilt') || 
                controlText.includes('disable motion') ||
                controlText.includes('enable motion') ||
                controlText.includes('motion controls')) {
              hasDisableOption = true;
            }
          });

          // Look for alternative methods (buttons for same functionality)
          const actionButtons = document.querySelectorAll('button, [role="button"]');
          actionButtons.forEach(button => {
            const buttonText = button.textContent.toLowerCase() + 
                             (button.getAttribute('aria-label') || '').toLowerCase();

            if (buttonText.includes('refresh') || buttonText.includes('reload') || 
                buttonText.includes('update') || buttonText.includes('manual') ||
                buttonText.includes('alternative')) {
              hasAlternativeMethod = true;
            }
          });

          // Only flag as violations if no controls found AND motion features are explicitly mentioned
          const explicitMotionFeatures = motionKeywords.some(keyword => 
            pageText.includes(`${keyword} to `) || pageText.includes(`${keyword} device`) ||
            pageText.includes(`${keyword} your phone`)
          );

          if (explicitMotionFeatures && !hasDisableOption) {
            issues.push({
              type: 'motion-no-disable-option',
              element: 'document',
              description: 'Motion-activated features lack user control to disable them',
              severity: 'error'
            });
            alternativesProvided = false;
          }

          if (explicitMotionFeatures && !hasAlternativeMethod) {
            issues.push({
              type: 'motion-no-alternative-method',
              element: 'document',
              description: 'Motion-activated functionality lacks alternative input method',
              severity: 'error'
            });
            alternativesProvided = false;
          }
        }
      }

      // Check for CSS motion controls that might be problematic
      const elementsWithTransform = document.querySelectorAll('[style*="transform"], [class*="rotate"], [class*="shake"]');
      
      elementsWithTransform.forEach(element => {
        // SVG/MathML elements expose className as an SVGAnimatedString, not a string
        const className = typeof element.className === 'string' ? element.className : '';
        const elementInfo = {
          selector: element.tagName.toLowerCase() +
                   (element.id ? `#${element.id}` : '') +
                   (className ? `.${className.split(' ')[0]}` : '')
        };

        // Check if element responds to device orientation
        const style = window.getComputedStyle(element);
        const hasOrientationCSS = className.includes('orientation') ||
                                element.style.transform.includes('rotate');

        if (hasOrientationCSS) {
          // Look for alternative controls for this element
          const hasControlButton = document.querySelector(`button[aria-controls="${element.id}"]`) ||
                                  element.querySelector('button') ||
                                  element.parentElement.querySelector('button');

          if (!hasControlButton) {
            issues.push({
              type: 'orientation-css-no-alternative',
              element: elementInfo.selector,
              description: 'Element responds to device orientation without alternative controls',
              severity: 'warning'
            });
          }
        }
      });

      // Check for infinite CSS animations without pause controls or prefers-reduced-motion
      let hasReducedMotionQuery = false;
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules || []) {
              if (rule instanceof CSSMediaRule &&
                  rule.conditionText && rule.conditionText.includes('prefers-reduced-motion')) {
                hasReducedMotionQuery = true;
                break;
              }
            }
          } catch (e) { /* cross-origin */ }
          if (hasReducedMotionQuery) break;
        }
      } catch (e) { /* no stylesheets */ }

      if (!hasReducedMotionQuery) {
        const allElements = document.querySelectorAll('*');
        const animatedElements = [];

        allElements.forEach(el => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          const iterationCount = style.animationIterationCount;
          const duration = style.animationDuration;
          const animName = style.animationName;

          if (iterationCount === 'infinite' && animName && animName !== 'none' &&
              duration && duration !== '0s' && duration !== '0ms') {
            const className = el.className && typeof el.className === 'string'
              ? el.className : '';
            animatedElements.push({
              selector: el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (className ? `.${className.split(' ')[0]}` : ''),
              animation: animName,
              duration: duration,
            });
          }
        });

        if (animatedElements.length > 0) {
          // Check for pause/stop controls
          const pauseControls = document.querySelectorAll('button, [role="button"], input[type="checkbox"], [role="switch"]');
          let hasPauseControl = false;
          const pauseKeywords = /pause|stop|disable|reduce|animation|motion/i;
          pauseControls.forEach(ctrl => {
            const text = (ctrl.textContent || '') +
              (ctrl.getAttribute('aria-label') || '') +
              (ctrl.getAttribute('title') || '');
            if (pauseKeywords.test(text)) hasPauseControl = true;
          });

          if (!hasPauseControl) {
            for (const anim of animatedElements) {
              issues.push({
                type: 'infinite-animation-no-pause',
                element: anim.selector,
                description: `Infinite CSS animation "${anim.animation}" (${anim.duration}) without pause control or prefers-reduced-motion media query`,
                severity: 'error',
              });
              alternativesProvided = false;
            }
          }
        }
      }

      return { issues, alternativesProvided };
    });

    // Create violations for motion actuation issues
    motionAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.5.4",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getMotionSuggestion(issue.type)
      });
    });

    return { alternativesProvided: motionAnalysis.alternativesProvided };
  }

  /**
   * Analyze target size minimum (WCAG 2.5.8)
   * Flags interactive elements smaller than 24x24 CSS pixels
   */
  async analyzeTargetSize(page, violations) {
    console.log('Analyzing target size minimum...');

    const targetAnalysis = await page.evaluate((renderedCode) => {
      eval(renderedCode);
      const issues = [];
      let adequate = true;

      const MIN_SIZE = 24;          // WCAG 2.5.8 AA minimum
      const RADIUS = MIN_SIZE / 2;  // spacing exception: 24px-diameter circle

      const INLINE_TEXT_PARENTS = new Set(['p', 'li', 'td', 'th', 'dd', 'dt', 'span', 'label',
        'figcaption', 'blockquote', 'cite', 'em', 'strong', 'small', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

      function selectorOf(el) {
        return el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '');
      }

      /** 2.5.8 "Inline" exception: the target is in a sentence or its size is constrained by line-height of non-target text. */
      function isInlineTextTarget(el, style) {
        if (style.display !== 'inline') return false;
        const parent = el.parentElement;
        if (!parent) return false;
        if (!INLINE_TEXT_PARENTS.has(parent.tagName.toLowerCase()) && !parent.closest('p, li, td, th, dd, figcaption, blockquote')) return false;
        const own = (el.textContent || '').trim().length;
        const all = (parent.textContent || '').trim().length;
        return all > own + 2; // surrounded by other text
      }

      /** 2.5.8 "User agent control" exception: size set by the UA, not the author. */
      function isUaSizedControl(el, rect) {
        const tag = el.tagName.toLowerCase();
        if (tag !== 'input') return false;
        const t = (el.type || '').toLowerCase();
        if (t !== 'checkbox' && t !== 'radio') return false;
        // Chromium default is 13x13; anything near that has not been author-sized.
        return rect.width <= 16 && rect.height <= 16;
      }

      // Collect every rendered pointer target ONCE (each element, not each selector match)
      const candidates = new Set();
      document.querySelectorAll('a, area, button, input, select, textarea, summary, [role], [tabindex], [contenteditable], audio[controls], video[controls]')
        .forEach(el => { if (__isInteractiveTarget(el) && __isRendered(el)) candidates.add(el); });

      const targets = [];
      for (const el of candidates) {
        // A target nested in another target (icon inside a button) is the same target.
        let p = el.parentElement, nested = false;
        while (p && p !== document.body) { if (candidates.has(p)) { nested = true; break; } p = p.parentElement; }
        if (nested) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        targets.push({ el, rect, selector: selectorOf(el), style: window.getComputedStyle(el) });
      }

      function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      function circleIntersectsRect(c, r) {
        const dx = Math.max(r.left - c.x, 0, c.x - r.right);
        const dy = Math.max(r.top - c.y, 0, c.y - r.bottom);
        return dx * dx + dy * dy < RADIUS * RADIUS;
      }

      for (const t of targets) {
        const { rect, el, style } = t;
        if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) continue;
        if (isInlineTextTarget(el, style)) continue;
        if (isUaSizedControl(el, rect)) continue;

        // Spacing exception: the 24px circle centred on this target must not
        // intersect any other target or any other undersized target's circle.
        const c = center(rect);
        let blocker = null;
        for (const o of targets) {
          if (o === t) continue;
          if (circleIntersectsRect(c, o.rect)) { blocker = o; break; }
          if (o.rect.width < MIN_SIZE || o.rect.height < MIN_SIZE) {
            const oc = center(o.rect);
            const d = Math.hypot(c.x - oc.x, c.y - oc.y);
            if (d < MIN_SIZE) { blocker = o; break; }
          }
        }
        if (!blocker) continue; // undersized but sufficiently spaced — passes 2.5.8

        adequate = false;
        issues.push({
          type: 'target-too-small',
          element: t.selector,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          nearbyElement: blocker.selector,
          description: `Interactive target is ${Math.round(rect.width)}x${Math.round(rect.height)}px (minimum ${MIN_SIZE}x${MIN_SIZE}px) and its 24px spacing circle overlaps ${blocker.selector}`,
          severity: 'serious',
        });
      }

      return { issues, adequate };
    }, renderedCode);

    targetAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: '9.2.5.8',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        width: issue.width,
        height: issue.height,
        nearbyElement: issue.nearbyElement,
        gap: issue.gap,
        suggestion: this.getTargetSizeSuggestion(issue.type),
      });
    });

    return { adequate: targetAnalysis.adequate };
  }

  /**
   * Analyze dragging movements (WCAG 2.5.7)
   * Checks that drag operations have single-pointer alternatives
   */
  async analyzeDraggingMovements(page, violations) {
    console.log('Analyzing dragging movements...');

    const dragAnalysis = await page.evaluate(() => {
      const issues = [];
      let alternativesProvided = true;

      function getSelector(el) {
        return el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');
      }

      function hasAlternativeControls(el) {
        // Check for sibling/nearby buttons with move/reorder labels
        const parent = el.parentElement;
        if (!parent) return false;

        const buttons = parent.querySelectorAll('button, [role="button"], a[href]');
        const movePatterns = /\b(up|down|move|sort|reorder|left|right|remove|add|insert)\b/i;
        for (const btn of buttons) {
          const text = (btn.textContent + ' ' + (btn.getAttribute('aria-label') || '')).trim();
          if (movePatterns.test(text)) return true;
        }

        // Check if element itself also has click/keyboard handlers
        if (el.getAttribute('onclick') || el.getAttribute('onkeydown') || el.getAttribute('onkeyup')) return true;

        // Check for ARIA listbox/grid patterns
        const parentRole = parent.getAttribute('role');
        if (parentRole === 'listbox' || parentRole === 'grid') return true;
        if (parent.getAttribute('aria-sort')) return true;

        // Check for keyboard-accessible role on the draggable itself
        if (el.getAttribute('role') === 'option' || el.getAttribute('role') === 'gridcell') return true;

        // Traverse up one more level for move buttons in a wrapper
        const grandparent = parent.parentElement;
        if (grandparent) {
          const gpButtons = grandparent.querySelectorAll('button, [role="button"]');
          for (const btn of gpButtons) {
            const text = (btn.textContent + ' ' + (btn.getAttribute('aria-label') || '')).trim();
            if (movePatterns.test(text)) return true;
          }
        }

        return false;
      }

      // 1. Find elements with draggable="true"
      const draggables = document.querySelectorAll('[draggable="true"]');
      draggables.forEach(el => {
        if (!hasAlternativeControls(el)) {
          issues.push({
            type: 'drag-only-no-alternative',
            element: getSelector(el),
            description: 'Draggable element has no single-pointer or keyboard alternative for repositioning',
            severity: 'serious',
          });
          alternativesProvided = false;
        }
      });

      // 2. Find elements with drag event handlers (inline)
      const dragHandlerElements = document.querySelectorAll(
        '[ondragstart], [ondrag], [ondragend], [ondragover], [ondrop]'
      );
      dragHandlerElements.forEach(el => {
        // Don't double-count if already flagged as draggable
        if (el.getAttribute('draggable') === 'true') return;

        if (el.hasAttribute('ondrop') || el.hasAttribute('ondragover')) {
          // This is a drop zone — check if it also has click-to-add or similar
          const hasClickAlternative = el.getAttribute('onclick') ||
            el.querySelector('button, [role="button"], input[type="file"]');
          if (!hasClickAlternative) {
            issues.push({
              type: 'drop-zone-no-alternative',
              element: getSelector(el),
              description: 'Drop zone has no non-drag mechanism to add/move content',
              severity: 'serious',
            });
            alternativesProvided = false;
          }
        } else if (el.hasAttribute('ondragstart')) {
          if (!hasAlternativeControls(el)) {
            issues.push({
              type: 'drag-only-no-alternative',
              element: getSelector(el),
              description: 'Element with drag handler has no single-pointer alternative',
              severity: 'serious',
            });
            alternativesProvided = false;
          }
        }
      });

      // 3. Detect sortable list patterns (common in JS libraries)
      const sortableContainers = document.querySelectorAll(
        '[data-sortable], [class*="sortable"], [class*="draggable-list"], [class*="drag-list"]'
      );
      sortableContainers.forEach(container => {
        const items = container.querySelectorAll('li, [role="listitem"], [data-sortable-item]');
        if (items.length < 2) return;

        // Check if any item has move buttons
        let hasButtons = false;
        items.forEach(item => {
          if (hasAlternativeControls(item)) hasButtons = true;
        });

        if (!hasButtons) {
          issues.push({
            type: 'sortable-no-buttons',
            element: getSelector(container),
            description: 'Sortable list uses drag-only reordering without up/down buttons or keyboard alternative',
            severity: 'serious',
          });
          alternativesProvided = false;
        }
      });

      return { issues, alternativesProvided };
    });

    dragAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: '9.2.5.7',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getDraggingSuggestion(issue.type),
      });
    });

    return { alternativesProvided: dragAnalysis.alternativesProvided };
  }

  /**
   * Get suggestion for target size violations
   */
  getTargetSizeSuggestion(violationType) {
    const suggestions = {
      'target-too-small': 'Increase target dimensions to at least 24x24 CSS pixels using min-width/min-height or padding',
      'target-underspaced': 'Increase spacing between small targets to at least 24px, or increase target size to 24x24px minimum',
    };
    return suggestions[violationType] || 'Ensure interactive targets meet the 24x24px minimum size requirement';
  }

  /**
   * Get suggestion for dragging violations
   */
  getDraggingSuggestion(violationType) {
    const suggestions = {
      'drag-only-no-alternative': 'Add move up/down buttons, click-to-select, or keyboard arrow key support as alternatives to drag',
      'drop-zone-no-alternative': 'Add a click/tap mechanism (button, file input) to add content to the drop zone',
      'sortable-no-buttons': 'Add up/down or move buttons to each list item for single-pointer reordering',
    };
    return suggestions[violationType] || 'Provide single-pointer and keyboard alternatives for drag operations';
  }

  /**
   * Get suggestion for gesture violations
   */
  getGestureSuggestion(violationType) {
    const suggestions = {
      'drag-without-alternative': 'Provide keyboard-accessible controls (arrow keys, buttons) as alternatives to drag and drop',
      'multitouch-without-alternative': 'Ensure multi-touch gestures have single-point alternatives (buttons, keyboard shortcuts)',
      'swipe-without-alternative': 'Add navigation buttons or keyboard controls alongside swipe gestures',
      'complex-gesture-only': 'Provide simple click/tap alternatives for complex path-based gestures'
    };
    return suggestions[violationType] || 'Provide accessible alternatives to complex pointer gestures';
  }

  /**
   * Get suggestion for cancellation violations
   */
  getCancellationSuggestion(violationType) {
    const suggestions = {
      'critical-action-no-cancellation': 'Implement completion on up-event with ability to cancel by moving pointer away',
      'down-event-no-cancellation': 'Use click (up-event) for activation instead of mousedown/touchstart',
      'immediate-action-no-cancel': 'Add confirmation dialogs or undo mechanisms for immediate actions'
    };
    return suggestions[violationType] || 'Implement pointer cancellation mechanisms for better user control';
  }

  /**
   * Get suggestion for label violations
   */
  getLabelSuggestion(violationType) {
    const suggestions = {
      'label-name-mismatch': 'Ensure accessible name contains the visible label text as a substring',
    };
    return suggestions[violationType] || 'Ensure visible labels match accessible names for voice control users';
  }

  /**
   * Get suggestion for motion violations
   */
  getMotionSuggestion(violationType) {
    const suggestions = {
      'motion-no-disable-option': 'Provide user controls to disable motion-activated features',
      'motion-no-alternative-method': 'Add button or keyboard alternatives to motion-triggered actions',
      'orientation-css-no-alternative': 'Provide manual controls for orientation-dependent functionality',
      'infinite-animation-no-pause': 'Add a pause/stop control and a @media (prefers-reduced-motion: reduce) CSS rule to disable or reduce animations'
    };
    return suggestions[violationType] || 'Ensure motion-based features can be disabled and have alternatives';
  }

}

module.exports = InputModalitiesScanner;