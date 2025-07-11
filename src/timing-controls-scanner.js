const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Timing Controls Scanner for WCAG 2.1 compliance testing
 * Implements EN 301 549 criteria 9.2.2.1, 9.2.2.2, 9.2.2.6
 * Tests timing adjustability, auto-play controls, and timeout handling
 */
class TimingControlsScanner {
  constructor() {
    this.browser = null;
    this.screenshotDir = path.join(__dirname, '../tmp/timing-controls-screenshots');
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
   * Scan timing controls compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @param {boolean} options.testTimeouts - Test timeout adjustability
   * @param {boolean} options.testAutoPlay - Test auto-playing content controls
   * @param {boolean} options.testMovingContent - Test moving/updating content controls
   * @param {number} options.observationTime - Time to observe for dynamic content (ms)
   * @param {number} options.timeout - Test timeout in milliseconds
   * @returns {Promise<Object>} TimingControlsReport
   */
  async scanTimingControls(url, options = {}) {
    const defaultOptions = {
      testTimeouts: true,
      testAutoPlay: true,
      testMovingContent: true,
      observationTime: 5000,
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

      const timingResults = await this.performTimingControlsAnalysis(page, scanDir, scanOptions);
      
      await page.close();

      // Create report according to interface
      const report = {
        criteria: ["9.2.2.1", "9.2.2.2", "9.2.2.6"],
        passed: timingResults.violations.length === 0,
        violations: timingResults.violations,
        summary: {
          timeoutsAdjustable: timingResults.timeoutsAdjustable,
          autoPlayControlled: timingResults.autoPlayControlled,
          movingContentControllable: timingResults.movingContentControllable,
          dataPreservedOnTimeout: timingResults.dataPreservedOnTimeout
        },
        screenshotPath: scanDir,
        visualEvidence: timingResults.visualEvidence
      };

      return report;

    } catch (error) {
      throw new Error(`Timing controls scan failed: ${error.message}`);
    }
  }

  /**
   * Perform comprehensive timing controls analysis
   */
  async performTimingControlsAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let timeoutsAdjustable = true;
    let autoPlayControlled = true;
    let movingContentControllable = true;
    let dataPreservedOnTimeout = true;

    console.log('Starting timing controls analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'timing-controls-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Test timeout adjustability (WCAG 2.2.1)
    if (options.testTimeouts) {
      const timeoutResults = await this.analyzeTimeoutAdjustability(page, violations);
      timeoutsAdjustable = timeoutResults.adjustable;
      dataPreservedOnTimeout = timeoutResults.dataPreserved;
    }

    // 2. Test auto-playing content (WCAG 2.2.2)
    if (options.testAutoPlay) {
      const autoPlayResults = await this.analyzeAutoPlayingContent(page, violations, options.observationTime);
      autoPlayControlled = autoPlayResults.controlled;
    }

    // 3. Test moving/updating content (WCAG 2.2.2)
    if (options.testMovingContent) {
      const movingContentResults = await this.analyzeMovingContent(page, violations, options.observationTime);
      movingContentControllable = movingContentResults.controllable;
    }

    // 4. Test timeout warnings (WCAG 2.2.6)
    const timeoutWarningResults = await this.analyzeTimeoutWarnings(page, violations);

    // Generate visual evidence
    visualEvidence.push({
      type: 'timing-controls',
      screenshot: path.basename(initialScreenshot),
      timeoutsAdjustable: timeoutsAdjustable,
      autoPlayControlled: autoPlayControlled,
      movingContentControllable: movingContentControllable,
      dataPreserved: dataPreservedOnTimeout
    });

    console.log(`Timing controls analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      timeoutsAdjustable,
      autoPlayControlled,
      movingContentControllable,
      dataPreservedOnTimeout
    };
  }

  /**
   * Analyze timeout adjustability (WCAG 2.2.1)
   */
  async analyzeTimeoutAdjustability(page, violations) {
    console.log('Analyzing timeout adjustability...');

    const timeoutAnalysis = await page.evaluate(() => {
      const issues = [];
      let adjustable = true;
      let dataPreserved = true;

      // Look for JavaScript timeouts and intervals
      const originalSetTimeout = window.setTimeout;
      const originalSetInterval = window.setInterval;
      
      const detectedTimeouts = [];
      
      // Override setTimeout to detect timeouts
      window.setTimeout = function(callback, delay, ...args) {
        if (delay && delay < 20 * 60 * 1000) { // Less than 20 minutes
          detectedTimeouts.push({
            type: 'timeout',
            delay: delay,
            callback: callback.toString().substring(0, 100)
          });
        }
        return originalSetTimeout.call(this, callback, delay, ...args);
      };

      // Look for timeout-related content
      const timeoutKeywords = ['timeout', 'session expires', 'expires in', 'time remaining', 'will expire'];
      const pageText = document.body.textContent.toLowerCase();
      const hasTimeoutContent = timeoutKeywords.some(keyword => pageText.includes(keyword));

      if (hasTimeoutContent) {
        // Look for timeout adjustment controls
        const adjustmentControls = document.querySelectorAll('button, [role="button"], input[type="button"], a[href]');
        let hasExtendOption = false;
        let hasWarningMechanism = false;

        adjustmentControls.forEach(control => {
          const controlText = control.textContent.toLowerCase() + 
                            (control.getAttribute('aria-label') || '').toLowerCase();
          
          if (controlText.includes('extend') || controlText.includes('more time') || 
              controlText.includes('continue') || controlText.includes('keep session')) {
            hasExtendOption = true;
          }
        });

        // Look for timeout warnings
        const warningElements = document.querySelectorAll('[role="alert"], [aria-live], .warning, .timeout, .expires');
        if (warningElements.length > 0) {
          hasWarningMechanism = true;
        }

        if (!hasExtendOption) {
          issues.push({
            type: 'timeout-no-extend-option',
            element: 'document',
            description: 'Timeout detected without user control to extend time limit',
            severity: 'error'
          });
          adjustable = false;
        }

        if (!hasWarningMechanism) {
          issues.push({
            type: 'timeout-no-warning',
            element: 'document',
            description: 'Timeout detected without advance warning mechanism',
            severity: 'error'
          });
        }

        // Check for data preservation
        const formElements = document.querySelectorAll('input, textarea, select');
        let hasAutoSave = false;
        
        formElements.forEach(element => {
          if (element.hasAttribute('oninput') || element.hasAttribute('onchange')) {
            const eventHandler = element.getAttribute('oninput') || element.getAttribute('onchange');
            if (eventHandler.includes('save') || eventHandler.includes('store')) {
              hasAutoSave = true;
            }
          }
        });

        // Look for auto-save indicators
        const autoSaveIndicators = document.querySelectorAll('*');
        autoSaveIndicators.forEach(element => {
          const text = element.textContent.toLowerCase();
          if (text.includes('auto save') || text.includes('automatically saved') || 
              text.includes('draft saved')) {
            hasAutoSave = true;
          }
        });

        if (formElements.length > 0 && !hasAutoSave) {
          issues.push({
            type: 'timeout-no-data-preservation',
            element: 'document',
            description: 'Forms present but no data preservation mechanism detected for timeouts',
            severity: 'warning'
          });
          dataPreserved = false;
        }
      }

      // Restore original functions
      window.setTimeout = originalSetTimeout;

      return { issues, adjustable, dataPreserved, detectedTimeouts };
    });

    // Create violations for timeout issues
    timeoutAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.2.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getTimeoutSuggestion(issue.type)
      });
    });

    return { 
      adjustable: timeoutAnalysis.adjustable, 
      dataPreserved: timeoutAnalysis.dataPreserved 
    };
  }

  /**
   * Analyze auto-playing content (WCAG 2.2.2)
   */
  async analyzeAutoPlayingContent(page, violations, observationTime) {
    console.log('Analyzing auto-playing content...');

    // First, check for auto-playing media elements
    const mediaAnalysis = await page.evaluate(() => {
      const issues = [];
      let controlled = true;

      // Check video and audio elements
      const mediaElements = document.querySelectorAll('video, audio');
      
      mediaElements.forEach(element => {
        const elementInfo = {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className,
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Check for autoplay attribute
        if (element.hasAttribute('autoplay') && !element.hasAttribute('muted')) {
          // Look for user controls
          const hasControls = element.hasAttribute('controls') ||
                            element.parentElement.querySelector('button') ||
                            document.querySelector(`button[aria-controls="${element.id}"]`);

          if (!hasControls) {
            issues.push({
              type: 'autoplay-no-controls',
              element: elementInfo.selector,
              description: 'Auto-playing media lacks user controls for pause/stop',
              severity: 'error'
            });
            controlled = false;
          }

          // Check duration (auto-play longer than 5 seconds needs controls)
          if (element.duration > 5 && !hasControls) {
            issues.push({
              type: 'autoplay-long-duration-no-controls',
              element: elementInfo.selector,
              description: 'Auto-playing media longer than 5 seconds lacks pause/stop controls',
              severity: 'error'
            });
            controlled = false;
          }
        }
      });

      return { issues, controlled };
    });

    // Observe page for auto-starting content
    await new Promise(resolve => setTimeout(resolve, observationTime));

    const dynamicContentAnalysis = await page.evaluate(() => {
      const issues = [];
      let controlled = true;

      // Look for elements with animations or auto-updating content
      const animatedElements = document.querySelectorAll('[class*="animate"], [class*="moving"], [style*="animation"], [style*="transition"]');
      
      animatedElements.forEach(element => {
        const elementInfo = {
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        const computedStyle = window.getComputedStyle(element);
        const hasInfiniteAnimation = computedStyle.animationIterationCount === 'infinite' ||
                                   computedStyle.animationDuration !== '0s';

        if (hasInfiniteAnimation) {
          // Look for pause controls
          const hasPauseControl = element.querySelector('button') ||
                                element.parentElement.querySelector('button') ||
                                document.querySelector(`button[aria-controls="${element.id}"]`) ||
                                element.hasAttribute('onclick');

          if (!hasPauseControl) {
            // Check if it's likely distracting (moving or flashing)
            const isDistracting = element.className.includes('flash') ||
                                element.className.includes('blink') ||
                                element.className.includes('scroll') ||
                                computedStyle.animationName.includes('flash') ||
                                computedStyle.animationName.includes('blink');

            if (isDistracting) {
              issues.push({
                type: 'auto-animation-no-pause',
                element: elementInfo.selector,
                description: 'Auto-playing animation lacks pause or stop controls',
                severity: 'error'
              });
              controlled = false;
            }
          }
        }
      });

      // Check for auto-updating content (like news tickers, live feeds)
      const updateIndicators = ['live', 'updating', 'ticker', 'feed', 'refresh'];
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(element => {
        const elementText = element.textContent.toLowerCase();
        const hasUpdateIndicator = updateIndicators.some(indicator => 
          elementText.includes(indicator) || 
          element.className.toLowerCase().includes(indicator) ||
          element.id.toLowerCase().includes(indicator)
        );

        if (hasUpdateIndicator && element.textContent.trim().length > 20) {
          const elementInfo = {
            selector: element.tagName.toLowerCase() + 
                     (element.id ? `#${element.id}` : '') + 
                     (element.className ? `.${element.className.split(' ')[0]}` : '')
          };

          // Look for pause/stop controls
          const hasUpdateControls = element.querySelector('button') ||
                                   element.parentElement.querySelector('button') ||
                                   document.querySelector(`button[aria-controls="${element.id}"]`);

          if (!hasUpdateControls) {
            issues.push({
              type: 'auto-update-no-controls',
              element: elementInfo.selector,
              description: 'Auto-updating content lacks pause or stop controls',
              severity: 'warning'
            });
          }
        }
      });

      return { issues, controlled };
    });

    // Combine results
    const allIssues = [...mediaAnalysis.issues, ...dynamicContentAnalysis.issues];
    const overallControlled = mediaAnalysis.controlled && dynamicContentAnalysis.controlled;

    // Create violations for auto-play issues
    allIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.2.2",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getAutoPlaySuggestion(issue.type)
      });
    });

    return { controlled: overallControlled };
  }

  /**
   * Analyze moving content (WCAG 2.2.2)
   */
  async analyzeMovingContent(page, violations, observationTime) {
    console.log('Analyzing moving content...');

    const movingContentAnalysis = await page.evaluate((observationTime) => {
      const issues = [];
      let controllable = true;

      // Find elements with CSS animations, transforms, or movement
      const potentiallyMovingElements = document.querySelectorAll('*');
      const movingElements = [];

      potentiallyMovingElements.forEach(element => {
        const computedStyle = window.getComputedStyle(element);
        const hasMovement = computedStyle.animationName !== 'none' ||
                          computedStyle.transform !== 'none' ||
                          element.className.includes('move') ||
                          element.className.includes('slide') ||
                          element.className.includes('scroll') ||
                          element.className.includes('rotate');

        if (hasMovement) {
          movingElements.push(element);
        }
      });

      movingElements.forEach(element => {
        const elementInfo = {
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        const computedStyle = window.getComputedStyle(element);
        
        // Check if movement lasts longer than 5 seconds
        const animationDuration = parseFloat(computedStyle.animationDuration) || 0;
        const isInfinite = computedStyle.animationIterationCount === 'infinite';
        const isLongDuration = animationDuration > 5 || isInfinite;

        if (isLongDuration) {
          // Look for pause, stop, or hide controls
          const hasControls = element.querySelector('button') ||
                            element.parentElement.querySelector('button') ||
                            document.querySelector(`button[aria-controls="${element.id}"]`) ||
                            element.hasAttribute('onclick') ||
                            element.closest('[role="dialog"]'); // Modals often have close buttons

          if (!hasControls) {
            // Check if the movement is essential (like progress indicators)
            const isEssential = element.className.includes('progress') ||
                              element.className.includes('loading') ||
                              element.getAttribute('role') === 'progressbar' ||
                              element.tagName.toLowerCase() === 'progress';

            if (!isEssential) {
              issues.push({
                type: 'moving-content-no-controls',
                element: elementInfo.selector,
                description: 'Moving content lasting longer than 5 seconds lacks pause, stop, or hide controls',
                severity: 'error'
              });
              controllable = false;
            }
          }
        }

        // Check for blinking/flashing content
        const isBlinking = element.className.includes('blink') ||
                         element.className.includes('flash') ||
                         computedStyle.animationName.includes('blink') ||
                         computedStyle.animationName.includes('flash');

        if (isBlinking) {
          issues.push({
            type: 'blinking-content',
            element: elementInfo.selector,
            description: 'Blinking or flashing content detected - potential seizure risk',
            severity: 'error'
          });
          controllable = false;
        }
      });

      return { issues, controllable };
    }, observationTime);

    // Create violations for moving content issues
    movingContentAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.2.2",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getMovingContentSuggestion(issue.type)
      });
    });

    return { controllable: movingContentAnalysis.controllable };
  }

  /**
   * Analyze timeout warnings (WCAG 2.2.6)
   */
  async analyzeTimeoutWarnings(page, violations) {
    console.log('Analyzing timeout warnings...');

    const warningAnalysis = await page.evaluate(() => {
      const issues = [];

      // Look for timeout-related elements
      const timeoutElements = document.querySelectorAll('[class*="timeout"], [class*="expire"], [id*="timeout"], [id*="expire"]');
      
      timeoutElements.forEach(element => {
        const elementInfo = {
          selector: element.tagName.toLowerCase() + 
                   (element.id ? `#${element.id}` : '') + 
                   (element.className ? `.${element.className.split(' ')[0]}` : '')
        };

        // Check if timeout warning is accessible
        const hasAriaLive = element.hasAttribute('aria-live');
        const hasRole = element.getAttribute('role') === 'alert' || element.getAttribute('role') === 'status';
        const isVisuallyHidden = element.style.display === 'none' ||
                                element.style.visibility === 'hidden' ||
                                element.getAttribute('aria-hidden') === 'true';

        if (!hasAriaLive && !hasRole && !isVisuallyHidden) {
          issues.push({
            type: 'timeout-warning-not-accessible',
            element: elementInfo.selector,
            description: 'Timeout warning lacks proper ARIA live region or alert role',
            severity: 'warning'
          });
        }

        // Check for timeout duration information
        const hasTimeRemaining = element.textContent.includes(':') || 
                                element.textContent.includes('minute') ||
                                element.textContent.includes('second');

        if (!hasTimeRemaining && element.textContent.toLowerCase().includes('timeout')) {
          issues.push({
            type: 'timeout-warning-no-duration',
            element: elementInfo.selector,
            description: 'Timeout warning does not specify remaining time',
            severity: 'warning'
          });
        }
      });

      return { issues };
    });

    // Create violations for timeout warning issues
    warningAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.2.6",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getTimeoutWarningSuggestion(issue.type)
      });
    });

    return warningAnalysis;
  }

  /**
   * Get suggestion for timeout violations
   */
  getTimeoutSuggestion(violationType) {
    const suggestions = {
      'timeout-no-extend-option': 'Provide user controls to extend time limits (extend, continue session buttons)',
      'timeout-no-warning': 'Implement advance warning system (20 seconds before expiry) with ARIA live regions',
      'timeout-no-data-preservation': 'Add auto-save functionality or session storage to preserve user data'
    };
    return suggestions[violationType] || 'Ensure timeout mechanisms are user-controllable and accessible';
  }

  /**
   * Get suggestion for auto-play violations
   */
  getAutoPlaySuggestion(violationType) {
    const suggestions = {
      'autoplay-no-controls': 'Add pause, stop, and volume controls for auto-playing media',
      'autoplay-long-duration-no-controls': 'Provide pause/stop controls for media longer than 5 seconds',
      'auto-animation-no-pause': 'Add pause or stop controls for auto-playing animations',
      'auto-update-no-controls': 'Provide pause controls for auto-updating content like news feeds'
    };
    return suggestions[violationType] || 'Provide user controls for auto-playing content';
  }

  /**
   * Get suggestion for moving content violations
   */
  getMovingContentSuggestion(violationType) {
    const suggestions = {
      'moving-content-no-controls': 'Add pause, stop, or hide controls for moving content lasting over 5 seconds',
      'blinking-content': 'Remove blinking/flashing content or provide controls to stop it'
    };
    return suggestions[violationType] || 'Ensure moving content can be paused or hidden by users';
  }

  /**
   * Get suggestion for timeout warning violations
   */
  getTimeoutWarningSuggestion(violationType) {
    const suggestions = {
      'timeout-warning-not-accessible': 'Add role="alert" or aria-live="assertive" to timeout warnings',
      'timeout-warning-no-duration': 'Include specific time remaining in timeout warnings'
    };
    return suggestions[violationType] || 'Make timeout warnings accessible with proper ARIA markup';
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = TimingControlsScanner;