const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Seizure Prevention Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.2.3.1, 9.2.3.3 (Three Flashes, Animation from Interactions)
 * CRITICAL SAFETY REQUIREMENT - Tests for seizure-inducing content
 */
class SeizurePreventionScanner extends BaseScanner {
  constructor() {
    super('seizure-prevention', {
      // 2.3.3 (Animation from Interactions) is emitted by analyzeAnimationTriggers()
      // as EN 301 549 clause 9.2.3.3, but was missing from this list — which made
      // the criterion invisible to the coverage matrix and to every
      // criterion-filtered harness. The scanner has always tested it.
      wcagCriteria: ['2.3.1', '2.3.2', '2.3.3'],
      wcagPrinciple: 'operable'
    });
    this.screenshotDir = path.join(__dirname, '../tmp/seizure-prevention-screenshots');
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      testFlashingContent: true,
      testAnimationTriggers: true,
      testMotionSensitivity: true,
      observationTime: 10000,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const seizureResults = await this.performSeizurePreventionAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["9.2.3.1", "9.2.3.3"],
      passed: seizureResults.violations.length === 0,
      violations: seizureResults.violations,
      summary: {
        noFlashingViolations: seizureResults.noFlashingViolations,
        animationTriggersControlled: seizureResults.animationTriggersControlled,
        motionSensitivitySupported: seizureResults.motionSensitivitySupported,
        seizureRiskLevel: seizureResults.seizureRiskLevel
      },
      screenshotPath: scanDir,
      visualEvidence: seizureResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive seizure prevention analysis - SAFETY CRITICAL
   */
  async performSeizurePreventionAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let noFlashingViolations = true;
    let animationTriggersControlled = true;
    let motionSensitivitySupported = true;
    let seizureRiskLevel = 'LOW';

    console.log('🚨 Starting CRITICAL seizure prevention analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'seizure-prevention-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. CRITICAL: Test for dangerous flashing content (WCAG 2.3.1)
    if (options.testFlashingContent) {
      const flashingResults = await this.analyzeFlashingContent(page, violations, options.observationTime);
      noFlashingViolations = flashingResults.safe;
      seizureRiskLevel = flashingResults.riskLevel;
    }

    // 2. Test animation from interactions (WCAG 2.3.3)
    if (options.testAnimationTriggers) {
      const animationResults = await this.analyzeAnimationFromInteractions(page, violations);
      animationTriggersControlled = animationResults.controlled;
    }

    // 3. Test motion sensitivity support
    if (options.testMotionSensitivity) {
      const motionSensitivityResults = await this.analyzeMotionSensitivity(page, violations);
      motionSensitivitySupported = motionSensitivityResults.supported;
    }

    // Generate visual evidence with SAFETY WARNING if needed
    visualEvidence.push({
      type: 'seizure-prevention',
      screenshot: path.basename(initialScreenshot),
      riskLevel: seizureRiskLevel,
      flashingSafe: noFlashingViolations,
      animationControlled: animationTriggersControlled,
      motionSensitive: motionSensitivitySupported,
      safetyWarning: seizureRiskLevel === 'HIGH' ? 'DANGER: High seizure risk detected!' : null
    });

    console.log(`🚨 Seizure prevention analysis complete: ${violations.length} violations found`);
    console.log(`🚨 SAFETY RISK LEVEL: ${seizureRiskLevel}`);

    return {
      violations,
      visualEvidence,
      noFlashingViolations,
      animationTriggersControlled,
      motionSensitivitySupported,
      seizureRiskLevel
    };
  }

  /**
   * Analyze flashing content - CRITICAL SAFETY CHECK (WCAG 2.3.1)
   */
  async analyzeFlashingContent(page, violations, observationTime) {
    console.log('🚨 CRITICAL: Analyzing flashing content for seizure risk...');

    // Set up flash detection monitoring
    await page.evaluate(() => {
      window.flashDetectionData = {
        flashingElements: [],
        flashCounts: {},
        startTime: Date.now()
      };

      // SVG and MathML elements expose `className` as an SVGAnimatedString, not
      // a string — `.includes()` and `.split()` throw on them. Because the sweep
      // below is a forEach over querySelectorAll('*'), a single inline <svg>
      // aborted the ENTIRE flash analysis. Real pages are full of inline SVG
      // icons; the synthetic corpus has almost none, which is why this survived
      // until the real-world fixtures were added.
      const safeClass = (el) => (typeof el.className === 'string' ? el.className : '');
      const safeSelector = (el) => {
        const cls = safeClass(el).trim().split(/\s+/).filter(Boolean)[0];
        return el.tagName.toLowerCase() +
               (el.id ? `#${el.id}` : '') +
               (cls ? `.${cls}` : '');
      };
      window.__seizureSafeClass = safeClass;
      window.__seizureSafeSelector = safeSelector;

      // Monitor for rapid color/brightness changes
      const observeFlashing = () => {
        const allElements = document.querySelectorAll('*');

        allElements.forEach((element, index) => {
          if (element.flashMonitor) return; // Already monitoring

          const elementKey = `element_${index}`;
          const computedStyle = window.getComputedStyle(element);
          
          // Check for CSS animations that might cause flashing
          const animationName = computedStyle.animationName;
          const animationDuration = parseFloat(computedStyle.animationDuration) || 0;
          const animationIterationCount = computedStyle.animationIterationCount;
          
          if (animationName !== 'none' && animationDuration > 0) {
            const flashFrequency = 1 / animationDuration; // flashes per second
            
            // CRITICAL: Check for dangerous flash rates (>3 Hz is seizure risk)
            if (flashFrequency > 3 || animationIterationCount === 'infinite') {
              window.flashDetectionData.flashingElements.push({
                element: element,
                elementKey: elementKey,
                animationName: animationName,
                frequency: flashFrequency,
                duration: animationDuration,
                selector: safeSelector(element),
                riskLevel: flashFrequency > 3 ? 'HIGH' : 'MEDIUM'
              });
            }
          }
          
          // Monitor for class changes that might indicate flashing
          if (safeClass(element).includes('flash') || safeClass(element).includes('blink')) {
            window.flashDetectionData.flashingElements.push({
              element: element,
              elementKey: elementKey,
              type: 'css-class',
              className: safeClass(element),
              selector: safeSelector(element),
              riskLevel: 'HIGH' // Assume high risk for explicit flashing classes
            });
          }
          
          element.flashMonitor = true;
        });
      };
      
      // Initial scan
      observeFlashing();
      
      // Monitor for new elements
      const observer = new MutationObserver(observeFlashing);
      observer.observe(document.body, { childList: true, subtree: true });
      
      window.flashObserver = observer;
    });

    // Wait and observe for flashing content
    console.log(`Observing page for ${observationTime}ms to detect flashing...`);
    await new Promise(resolve => setTimeout(resolve, observationTime));

    // Analyze detected flashing
    const flashingAnalysis = await page.evaluate(() => {
      const issues = [];
      let safe = true;
      let riskLevel = 'LOW';

      // Stop monitoring
      if (window.flashObserver) {
        window.flashObserver.disconnect();
      }

      const flashData = window.flashDetectionData;
      
      flashData.flashingElements.forEach(flashElement => {
        // CRITICAL: Check for dangerous flash frequencies
        if (flashElement.frequency && flashElement.frequency > 3) {
          issues.push({
            type: 'dangerous-flash-frequency',
            element: flashElement.selector,
            frequency: flashElement.frequency,
            animationName: flashElement.animationName,
            description: `DANGER: Flashing at ${flashElement.frequency.toFixed(2)} Hz exceeds safe limit of 3 Hz`,
            severity: 'critical',
            riskLevel: 'HIGH'
          });
          safe = false;
          riskLevel = 'HIGH';
        }
        
        // Check for CSS-based flashing
        if (flashElement.type === 'css-class') {
          issues.push({
            type: 'css-flashing-class',
            element: flashElement.selector,
            className: (typeof flashElement.className === 'string' ? flashElement.className : ''),
            description: 'Element uses CSS class indicating flashing/blinking behavior',
            severity: 'error',
            riskLevel: 'HIGH'
          });
          safe = false;
          if (riskLevel !== 'HIGH') riskLevel = 'MEDIUM';
        }
        
        // Check for infinite animations that could be problematic
        if (flashElement.animationIterationCount === 'infinite' && 
            flashElement.frequency > 1) {
          issues.push({
            type: 'infinite-animation-risk',
            element: flashElement.selector,
            frequency: flashElement.frequency,
            description: 'Infinite animation with potential seizure risk',
            severity: 'warning',
            riskLevel: 'MEDIUM'
          });
          if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
        }
      });

      // Check for red flashing specifically (highest seizure risk)
      const redFlashElements = document.querySelectorAll('[style*="red"], [class*="red"], [class*="error"]');
      redFlashElements.forEach(element => {
        const computedStyle = window.getComputedStyle(element);
        const animationName = computedStyle.animationName;
        
        if (animationName !== 'none') {
          // className is an SVGAnimatedString on SVG/MathML elements.
          const cls = typeof element.className === 'string' ? element.className : '';
          const selector = element.tagName.toLowerCase() +
                          (element.id ? `#${element.id}` : '') +
                          (cls.trim() ? `.${cls.trim().split(/\s+/)[0]}` : '');
          
          issues.push({
            type: 'red-flashing-content',
            element: selector,
            description: 'CRITICAL: Red flashing content detected - highest seizure risk',
            severity: 'critical',
            riskLevel: 'HIGH'
          });
          safe = false;
          riskLevel = 'HIGH';
        }
      });

      return { issues, safe, riskLevel, totalFlashingElements: flashData.flashingElements.length };
    });

    // Create violations for flashing content - CRITICAL PRIORITY
    flashingAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.3.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        frequency: issue.frequency,
        severity: issue.severity,
        riskLevel: issue.riskLevel,
        suggestion: this.getFlashingSuggestion(issue.type),
        safetyWarning: issue.severity === 'critical' ? '⚠️ IMMEDIATE ACTION REQUIRED - SEIZURE RISK' : null
      });
    });

    console.log(`🚨 Flashing analysis complete: ${flashingAnalysis.issues.length} issues, Risk: ${flashingAnalysis.riskLevel}`);

    return { 
      safe: flashingAnalysis.safe, 
      riskLevel: flashingAnalysis.riskLevel 
    };
  }

  /**
   * Analyze animation from interactions (WCAG 2.3.3)
   */
  async analyzeAnimationFromInteractions(page, violations) {
    console.log('Analyzing animation from interactions...');

    const animationAnalysis = await page.evaluate(() => {
      const issues = [];
      let controlled = true;

      // Check for prefers-reduced-motion support
      const supportsReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      
      // Look for elements that trigger animations on interaction
      const interactiveElements = document.querySelectorAll('button, [role="button"], a[href], input, [onclick], [onmouseover], [onfocus]');
      
      interactiveElements.forEach(element => {
        // className is an SVGAnimatedString on SVG/MathML elements — an inline
        // <svg> inside a <button> would otherwise throw and abort this sweep.
        const cls = typeof element.className === 'string' ? element.className : '';
        const elementInfo = {
          selector: element.tagName.toLowerCase() +
                   (element.id ? `#${element.id}` : '') +
                   (cls.trim() ? `.${cls.trim().split(/\s+/)[0]}` : '')
        };

        // Check for hover/focus animations
        const hasHoverAnimation = element.style.transition !== '' ||
                                cls.includes('hover') ||
                                cls.includes('animate');

        if (hasHoverAnimation) {
          // Check if animation respects prefers-reduced-motion
          const respectsMotionPreference = element.style.transition.includes('prefers-reduced-motion') ||
                                          document.querySelector('style')?.textContent.includes('@media (prefers-reduced-motion: reduce)');

          if (!respectsMotionPreference) {
            issues.push({
              type: 'animation-no-motion-preference',
              element: elementInfo.selector,
              description: 'Interactive animation does not respect prefers-reduced-motion preference',
              severity: 'warning'
            });
          }
        }

        // Check for onclick animations that might be jarring
        if (element.hasAttribute('onclick')) {
          const onclickCode = element.getAttribute('onclick');
          const hasAnimationTrigger = onclickCode.includes('animate') ||
                                     onclickCode.includes('transition') ||
                                     onclickCode.includes('transform');

          if (hasAnimationTrigger) {
            // Look for animation controls or motion preference handling
            const hasMotionControls = document.querySelector('[type="checkbox"][id*="motion"]') ||
                                     document.querySelector('[type="checkbox"][id*="animation"]') ||
                                     document.querySelector('button[aria-label*="motion"]');

            if (!hasMotionControls) {
              issues.push({
                type: 'interaction-animation-no-controls',
                element: elementInfo.selector,
                description: 'Interactive animation lacks user controls or motion preference support',
                severity: 'warning'
              });
              controlled = false;
            }
          }
        }
      });

      // Check for CSS animations triggered by :hover, :focus, :active
      const styleSheets = Array.from(document.styleSheets);
      let hasMotionSafeCSS = false;
      
      try {
        styleSheets.forEach(sheet => {
          try {
            const rules = Array.from(sheet.cssRules || sheet.rules || []);
            rules.forEach(rule => {
              if (rule.selectorText && rule.selectorText.includes('prefers-reduced-motion')) {
                hasMotionSafeCSS = true;
              }
            });
          } catch (e) {
            // Cross-origin stylesheet, skip
          }
        });
      } catch (e) {
        // Error accessing stylesheets
      }

      // Check if page has interactive animations but no motion preferences
      const hasInteractiveAnimations = document.querySelectorAll('[class*="animate"], [style*="transition"], [style*="transform"]').length > 0;
      
      if (hasInteractiveAnimations && !hasMotionSafeCSS) {
        issues.push({
          type: 'no-reduced-motion-support',
          element: 'document',
          description: 'Page has animations but does not support prefers-reduced-motion',
          severity: 'warning'
        });
      }

      return { issues, controlled };
    });

    // Create violations for animation interaction issues
    animationAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.3.3",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getAnimationSuggestion(issue.type)
      });
    });

    return { controlled: animationAnalysis.controlled };
  }

  /**
   * Analyze motion sensitivity support
   */
  async analyzeMotionSensitivity(page, violations) {
    console.log('Analyzing motion sensitivity support...');

    const motionAnalysis = await page.evaluate(() => {
      const issues = [];
      let supported = true;

      // Check for vestibular disorder considerations
      const motionKeywords = ['scroll', 'parallax', 'zoom', 'spin', 'rotate', 'tilt'];
      const pageText = document.body.textContent.toLowerCase();
      
      const hasMotionEffects = motionKeywords.some(keyword => 
        pageText.includes(keyword) || 
        document.querySelector(`[class*="${keyword}"]`) ||
        document.querySelector(`[id*="${keyword}"]`)
      );

      if (hasMotionEffects) {
        // Look for motion reduction controls
        const motionControls = document.querySelectorAll('input[type="checkbox"], button, [role="switch"]');
        let hasMotionToggle = false;

        motionControls.forEach(control => {
          const controlText = control.textContent.toLowerCase() + 
                            (control.getAttribute('aria-label') || '').toLowerCase();
          
          if (controlText.includes('motion') || controlText.includes('animation') ||
              controlText.includes('parallax') || controlText.includes('scroll')) {
            hasMotionToggle = true;
          }
        });

        if (!hasMotionToggle) {
          issues.push({
            type: 'motion-effects-no-toggle',
            element: 'document',
            description: 'Motion effects detected without user controls to disable them',
            severity: 'warning'
          });
          supported = false;
        }

        // Check for CSS prefers-reduced-motion support
        const reducedMotionSupport = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        
        if (!reducedMotionSupport) {
          // Check if CSS actually implements reduced motion
          const styleSheets = Array.from(document.styleSheets);
          let implementsReducedMotion = false;
          
          try {
            styleSheets.forEach(sheet => {
              try {
                const rules = Array.from(sheet.cssRules || []);
                rules.forEach(rule => {
                  if (rule.media && rule.media.mediaText.includes('prefers-reduced-motion')) {
                    implementsReducedMotion = true;
                  }
                });
              } catch (e) {
                // Cross-origin or restricted stylesheet
              }
            });
          } catch (e) {
            // Error accessing stylesheets
          }

          if (!implementsReducedMotion) {
            issues.push({
              type: 'no-reduced-motion-css',
              element: 'document',
              description: 'Motion effects present but prefers-reduced-motion not implemented in CSS',
              severity: 'warning'
            });
          }
        }
      }

      return { issues, supported };
    });

    // Create violations for motion sensitivity issues
    motionAnalysis.issues.forEach(issue => {
      violations.push({
        criterion: "9.2.3.3",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getMotionSensitivitySuggestion(issue.type)
      });
    });

    return { supported: motionAnalysis.supported };
  }

  /**
   * Get suggestion for flashing violations - CRITICAL
   */
  getFlashingSuggestion(violationType) {
    const suggestions = {
      'dangerous-flash-frequency': '🚨 CRITICAL: Remove or reduce flashing to under 3 Hz immediately - SEIZURE RISK',
      'css-flashing-class': '🚨 Remove CSS flashing/blinking classes - replace with static alternatives',
      'infinite-animation-risk': 'Limit animation duration or provide pause controls for infinite animations',
      'red-flashing-content': '🚨 CRITICAL: Remove red flashing content immediately - highest seizure risk'
    };
    return suggestions[violationType] || '🚨 Review flashing content for seizure safety';
  }

  /**
   * Get suggestion for animation violations
   */
  getAnimationSuggestion(violationType) {
    const suggestions = {
      'animation-no-motion-preference': 'Implement @media (prefers-reduced-motion: reduce) to disable animations',
      'interaction-animation-no-controls': 'Add user controls to disable interactive animations',
      'no-reduced-motion-support': 'Implement CSS prefers-reduced-motion media query support'
    };
    return suggestions[violationType] || 'Provide user controls for motion-triggered animations';
  }

  /**
   * Get suggestion for motion sensitivity violations
   */
  getMotionSensitivitySuggestion(violationType) {
    const suggestions = {
      'motion-effects-no-toggle': 'Add user controls to disable motion effects for vestibular disorder support',
      'no-reduced-motion-css': 'Implement @media (prefers-reduced-motion: reduce) CSS rules to disable motion'
    };
    return suggestions[violationType] || 'Provide motion sensitivity controls for accessibility';
  }

}

module.exports = SeizurePreventionScanner;