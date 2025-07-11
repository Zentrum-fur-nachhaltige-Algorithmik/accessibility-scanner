const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Input Modalities Scanner for WCAG 2.1 compliance testing
 * Implements EN 301 549 criteria 9.2.5.1, 9.2.5.2, 9.2.5.3, 9.2.5.4
 * Tests pointer gestures, cancellation, label matching, and motion actuation
 */
class InputModalitiesScanner {
  constructor() {
    this.browser = null;
    this.screenshotDir = path.join(__dirname, '../tmp/input-modalities-screenshots');
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    
    // Ensure screenshot directory exists
    await fs.ensureDir(this.screenshotDir);
  }

  /**
   * Scan input modalities compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @param {boolean} options.testPointerGestures - Test pointer gesture accessibility
   * @param {boolean} options.testMotionActuation - Test device motion controls
   * @param {boolean} options.testLabelMatching - Test label/name consistency
   * @param {number} options.timeout - Test timeout in milliseconds
   * @returns {Promise<Object>} InputModalitiesReport
   */
  async scanInputModalities(url, options = {}) {
    const defaultOptions = {
      testPointerGestures: true,
      testMotionActuation: true,
      testLabelMatching: true,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      const page = await this.browser.newPage();
      
      // Set viewport for consistent testing
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

      // Create timestamped scan directory
      const timestamp = Date.now();
      const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
      await fs.ensureDir(scanDir);

      const inputResults = await this.performInputModalitiesAnalysis(page, scanDir, scanOptions);
      
      await page.close();

      // Create report according to interface
      const report = {
        criteria: ["9.2.5.1", "9.2.5.2", "9.2.5.3", "9.2.5.4"],
        passed: inputResults.violations.length === 0,
        violations: inputResults.violations,
        summary: {
          pointerGesturesAccessible: inputResults.pointerGesturesAccessible,
          pointerCancellationAvailable: inputResults.pointerCancellationAvailable,
          labelNamesConsistent: inputResults.labelNamesConsistent,
          motionAlternativesProvided: inputResults.motionAlternativesProvided
        },
        screenshotPath: scanDir,
        visualEvidence: inputResults.visualEvidence
      };

      return report;

    } catch (error) {
      throw new Error(`Input modalities scan failed: ${error.message}`);
    }
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

    // Generate visual evidence
    visualEvidence.push({
      type: 'input-modalities',
      screenshot: path.basename(initialScreenshot),
      gesturesAccessible: pointerGesturesAccessible,
      cancellationAvailable: pointerCancellationAvailable,
      labelsConsistent: labelNamesConsistent,
      motionAlternatives: motionAlternativesProvided
    });

    console.log(`Input modalities analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      pointerGesturesAccessible,
      pointerCancellationAvailable,
      labelNamesConsistent,
      motionAlternativesProvided
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
        const elementInfo = {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className,
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Check for drag and drop without keyboard alternatives
        if (element.hasAttribute('draggable') && element.getAttribute('draggable') === 'true') {
          const hasKeyboardAlternative = element.hasAttribute('tabindex') ||
                                        element.querySelector('[tabindex]') ||
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
                                      element.hasAttribute('tabindex');

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
                                   element.hasAttribute('tabindex');

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
                                           element.hasAttribute('tabindex');

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
        const elementInfo = {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className,
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : ''),
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
                           element.getAttribute('ontouchend');

          const hasLeaveEvent = element.onmouseleave || element.ontouchcancel ||
                              element.getAttribute('onmouseleave') ||
                              element.getAttribute('ontouchcancel');

          if (!hasUpEvent && !hasLeaveEvent) {
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

    const labelAnalysis = await page.evaluate(() => {
      const issues = [];
      let consistent = true;

      // Find elements with both visible text and accessible names
      const labeledElements = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[href], label');

      labeledElements.forEach(element => {
        const elementInfo = {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className,
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Get visible text
        const visibleText = element.textContent.trim().toLowerCase();
        
        // Get accessible name
        const ariaLabel = element.getAttribute('aria-label');
        const ariaLabelledBy = element.getAttribute('aria-labelledby');
        let accessibleName = '';

        if (ariaLabel) {
          accessibleName = ariaLabel.toLowerCase();
        } else if (ariaLabelledBy) {
          const labelElement = document.getElementById(ariaLabelledBy);
          if (labelElement) {
            accessibleName = labelElement.textContent.trim().toLowerCase();
          }
        } else if (element.tagName.toLowerCase() === 'input') {
          const associatedLabel = document.querySelector(`label[for="${element.id}"]`);
          if (associatedLabel) {
            accessibleName = associatedLabel.textContent.trim().toLowerCase();
          }
        }

        // Compare visible text with accessible name
        if (visibleText && accessibleName && visibleText !== accessibleName) {
          // Check if visible text is contained within accessible name (more flexible matching)
          const visibleWords = visibleText.split(' ').filter(word => word.length > 2);
          const accessibleWords = accessibleName.split(' ').filter(word => word.length > 2);
          
          const visibleWordsInAccessible = visibleWords.length > 0 && 
            visibleWords.every(word => accessibleWords.some(aWord => aWord.includes(word) || word.includes(aWord)));

          // Also check if accessible name contains visible text as substring (ignoring case/punctuation)
          const normalizedVisible = visibleText.replace(/[^\w\s]/g, '').trim();
          const normalizedAccessible = accessibleName.replace(/[^\w\s]/g, '').trim();
          const isSubstring = normalizedAccessible.includes(normalizedVisible) || normalizedVisible.includes(normalizedAccessible);

          if (!visibleWordsInAccessible && !isSubstring && normalizedVisible.length > 5) {
            issues.push({
              type: 'label-name-mismatch',
              element: elementInfo.selector,
              visibleText: visibleText.substring(0, 50),
              accessibleName: accessibleName.substring(0, 50),
              description: 'Visible label text does not match accessible name',
              severity: 'error'
            });
            consistent = false;
          }
        }

        // Check for accessible name without visible text
        if (accessibleName && !visibleText && element.tagName.toLowerCase() === 'button') {
          issues.push({
            type: 'accessible-name-no-visible-text',
            element: elementInfo.selector,
            accessibleName: accessibleName.substring(0, 50),
            description: 'Button has accessible name but no visible text',
            severity: 'warning'
          });
        }

        // Check for visible text without accessible name (only for critical interactive elements)
        if (visibleText && !accessibleName && element.hasAttribute('onclick') && 
            !element.closest('form') && !element.hasAttribute('type')) {
          // Only flag if it's clearly an action button, not form controls
          const actionKeywords = ['submit', 'save', 'delete', 'buy', 'download', 'share'];
          const hasActionKeyword = actionKeywords.some(keyword => visibleText.includes(keyword));
          
          if (hasActionKeyword) {
            issues.push({
              type: 'visible-text-no-accessible-name',
              element: elementInfo.selector,
              visibleText: visibleText.substring(0, 50),
              description: 'Interactive element has visible text but no accessible name',
              severity: 'warning'
            });
          }
        }
      });

      return { issues, consistent };
    });

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
        // Look for motion-related keywords in page content
        const motionKeywords = ['shake', 'tilt', 'rotate', 'motion', 'gesture', 'device orientation'];
        const pageText = document.body.textContent.toLowerCase();
        
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
        const elementInfo = {
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Check if element responds to device orientation
        const style = window.getComputedStyle(element);
        const hasOrientationCSS = element.className.includes('orientation') || 
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
      'accessible-name-no-visible-text': 'Add visible text that matches the accessible name',
      'visible-text-no-accessible-name': 'Add aria-label or associate with a label element'
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
      'orientation-css-no-alternative': 'Provide manual controls for orientation-dependent functionality'
    };
    return suggestions[violationType] || 'Ensure motion-based features can be disabled and have alternatives';
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = InputModalitiesScanner;