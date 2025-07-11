const puppeteer = require('puppeteer');
const pa11y = require('pa11y');
const ColorContrastScanner = require('./color-contrast-scanner');
const UseOfColorScanner = require('./use-of-color-scanner');
const ImagesOfTextScanner = require('./images-of-text-scanner');
const LanguageDetectionScanner = require('./language-detection-scanner');
const HTMLValidationScanner = require('./html-validation-scanner');
const KeyboardNavigationScanner = require('./keyboard-navigation-scanner');
const InputModalitiesScanner = require('./input-modalities-scanner');
const TimingControlsScanner = require('./timing-controls-scanner');
const SeizurePreventionScanner = require('./seizure-prevention-scanner');
const PredictableNavigationScanner = require('./predictable-navigation-scanner');
const ErrorHandlingScanner = require('./error-handling-scanner');
const EAAProcedureScanner = require('./eaa-procedure-scanner');
const FocusManagementScanner = require('./focus-management-scanner');
const PageStructureScanner = require('./page-structure-scanner');
const AccessibilityStatementScanner = require('./accessibility-statement-scanner');
const ContactMechanismScanner = require('./contact-mechanism-scanner');
const ComplianceMonitoringScanner = require('./compliance-monitoring-scanner');

class EnhancedAccessibilityScanner {
  constructor() {
    this.browser = null;
    this.colorContrastScanner = new ColorContrastScanner();
    this.useOfColorScanner = new UseOfColorScanner();
    this.imagesOfTextScanner = new ImagesOfTextScanner();
    this.languageDetectionScanner = new LanguageDetectionScanner();
    this.htmlValidationScanner = new HTMLValidationScanner();
    this.keyboardNavigationScanner = new KeyboardNavigationScanner();
    this.inputModalitiesScanner = new InputModalitiesScanner();
    this.timingControlsScanner = new TimingControlsScanner();
    this.seizurePreventionScanner = new SeizurePreventionScanner();
    this.predictableNavigationScanner = new PredictableNavigationScanner();
    this.errorHandlingScanner = new ErrorHandlingScanner();
    this.eaaProcedureScanner = new EAAProcedureScanner();
    this.focusManagementScanner = new FocusManagementScanner();
    this.pageStructureScanner = new PageStructureScanner();
    this.accessibilityStatementScanner = new AccessibilityStatementScanner();
    this.contactMechanismScanner = new ContactMechanismScanner();
    this.complianceMonitoringScanner = new ComplianceMonitoringScanner();
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  async enhancedScan(url, options = {}) {
    const defaultOptions = {
      wcagLevel: 'AA',
      includeWarnings: true,
      testKeyboardNav: false,
      includePhase6A: false,
      includePhase6B: false,
      includePhase6D: false,
      includePhase6E: false,
      includePhase6F: false,
      timeout: 30000
    };
    
    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      
      if (!this.isValidUrl(url)) {
        return this.createErrorReport(url, 'Invalid URL format');
      }

      const scanPromises = [
        this.runAxeTests(url, scanOptions),
        this.runPa11yTests(url, scanOptions)
      ];

      // Add keyboard navigation test if enabled
      if (scanOptions.testKeyboardNav) {
        scanPromises.push(this.testKeyboardNavigation(url));
      }

      // Add Phase 6A scans if enabled
      if (scanOptions.includePhase6A) {
        scanPromises.push(
          this.colorContrastScanner.scanColorContrast(url, {
            wcagLevel: scanOptions.wcagLevel,
            includeGradients: true,
            checkLargeText: true,
            ignoreTransparent: true
          }),
          this.useOfColorScanner.scanColorDependency(url),
          this.imagesOfTextScanner.scanImagesOfText(url, {
            useOCR: false,
            skipLogos: true,
            skipDecorative: true
          })
        );
      }

      // Add Phase 6B scans if enabled (Keyboard & Navigation)
      if (scanOptions.includePhase6B) {
        scanPromises.push(
          this.keyboardNavigationScanner.scanKeyboardAccess(url, {
            testAllInteractives: true,
            simulateTabbing: true,
            testCustomControls: true,
            timeout: scanOptions.timeout
          }),
          this.focusManagementScanner.scanFocusManagement(url),
          this.pageStructureScanner.scanPageStructure(url)
        );
      }

      // Add Phase 6D scans if enabled (Language & HTML validation)
      if (scanOptions.includePhase6D) {
        scanPromises.push(
          this.languageDetectionScanner.scanLanguageCompliance(url, {
            timeout: scanOptions.timeout
          }),
          this.htmlValidationScanner.scanHTMLCompliance(url, {
            strictValidation: true,
            checkAccessibilityMarkup: true,
            validateARIA: true,
            timeout: scanOptions.timeout
          })
        );
      }

      // Add Phase 6E scans if enabled (Advanced Interactivity & Timing Controls)
      if (scanOptions.includePhase6E) {
        scanPromises.push(
          this.inputModalitiesScanner.scanInputModalities(url, {
            testPointerGestures: true,
            testPointerCancellation: true,
            testLabelMatching: true,
            testMotionActuation: true,
            timeout: scanOptions.timeout
          }),
          this.timingControlsScanner.scanTimingControls(url, {
            testTimeouts: true,
            testAutoPlay: true,
            testMovingContent: true,
            observationTime: 5000,
            timeout: scanOptions.timeout
          }),
          this.seizurePreventionScanner.scanSeizurePrevention(url, {
            testFlashingContent: true,
            testAnimationTriggers: true,
            testMotionSensitivity: true,
            observationTime: 10000,
            timeout: scanOptions.timeout
          }),
          this.predictableNavigationScanner.scanPredictableNavigation(url, {
            testOnFocus: true,
            testOnInput: true,
            testConsistentNavigation: true,
            testConsistentIdentification: true,
            timeout: scanOptions.timeout
          }),
          this.errorHandlingScanner.scanErrorHandling(url, {
            testErrorIdentification: true,
            testLabelsInstructions: true,
            testErrorSuggestions: true,
            testErrorPrevention: true,
            simulateErrors: true,
            timeout: scanOptions.timeout
          }),
          this.eaaProcedureScanner.scanEAAProcedure(url, {
            testAccessibilityStatement: true,
            testContactMechanism: true,
            testFeedbackProcess: true,
            testComplianceMonitoring: true,
            searchDepth: 2,
            timeout: scanOptions.timeout
          })
        );
      }

      // Add Phase 6F scans if enabled (EAA Procedural Requirements)
      if (scanOptions.includePhase6F) {
        scanPromises.push(
          this.accessibilityStatementScanner.scanAccessibilityStatement(url, {
            searchDepth: 3,
            timeout: scanOptions.timeout,
            language: 'auto'
          }),
          this.contactMechanismScanner.scanContactMechanisms(url, {
            timeout: scanOptions.timeout,
            searchDepth: 3
          }),
          this.complianceMonitoringScanner.scanComplianceMonitoring(url, {
            timeout: scanOptions.timeout,
            searchDepth: 3
          })
        );
      }

      const results = await Promise.all(scanPromises);
      
      // Extract results based on what was included
      let axeResults, pa11yResults, keyboardNavResults;
      let phase6AResults = [];
      let phase6BResults = [];
      let phase6DResults = [];
      let phase6EResults = [];
      let phase6FResults = [];
      
      let resultIndex = 0;
      axeResults = results[resultIndex++];
      pa11yResults = results[resultIndex++];
      keyboardNavResults = scanOptions.testKeyboardNav ? results[resultIndex++] : null;
      
      if (scanOptions.includePhase6A) {
        phase6AResults = results.slice(resultIndex, resultIndex + 3);
        resultIndex += 3;
      }
      
      if (scanOptions.includePhase6B) {
        phase6BResults = results.slice(resultIndex, resultIndex + 3);
        resultIndex += 3;
      }
      
      if (scanOptions.includePhase6D) {
        phase6DResults = results.slice(resultIndex, resultIndex + 2);
        resultIndex += 2;
      }
      
      if (scanOptions.includePhase6E) {
        phase6EResults = results.slice(resultIndex, resultIndex + 6);
        resultIndex += 6;
      }
      
      if (scanOptions.includePhase6F) {
        phase6FResults = results.slice(resultIndex, resultIndex + 3);
        resultIndex += 3;
      }

      if (axeResults.error) {
        return this.createErrorReport(url, axeResults.error);
      }

      // Organize Phase 6A results
      let phase6ACompliance = null;
      if (scanOptions.includePhase6A && phase6AResults.length === 3) {
        const [colorContrastResult, useOfColorResult, imagesOfTextResult] = phase6AResults;
        phase6ACompliance = {
          colorContrast: colorContrastResult,
          useOfColor: useOfColorResult,
          imagesOfText: imagesOfTextResult
        };
      }

      // Organize Phase 6B results
      let phase6BCompliance = null;
      if (scanOptions.includePhase6B && phase6BResults.length === 3) {
        const [keyboardResult, focusResult, pageStructureResult] = phase6BResults;
        phase6BCompliance = {
          keyboardNavigation: keyboardResult,
          focusManagement: focusResult,
          pageStructure: pageStructureResult
        };
      }

      // Organize Phase 6D results
      let phase6DCompliance = null;
      if (scanOptions.includePhase6D && phase6DResults.length === 2) {
        const [languageResult, htmlResult] = phase6DResults;
        phase6DCompliance = {
          language: languageResult,
          htmlValidation: htmlResult
        };
      }

      // Organize Phase 6E results
      let phase6ECompliance = null;
      if (scanOptions.includePhase6E && phase6EResults.length === 6) {
        const [inputModalitiesResult, timingControlsResult, seizurePreventionResult, 
               predictableNavigationResult, errorHandlingResult, eaaProcedureResult] = phase6EResults;
        phase6ECompliance = {
          inputModalities: inputModalitiesResult,
          timingControls: timingControlsResult,
          seizurePrevention: seizurePreventionResult,
          predictableNavigation: predictableNavigationResult,
          errorHandling: errorHandlingResult,
          eaaProcedure: eaaProcedureResult
        };
      }

      // Organize Phase 6F results
      let phase6FCompliance = null;
      if (scanOptions.includePhase6F && phase6FResults.length === 3) {
        const [accessibilityStatementResult, contactMechanismResult, complianceMonitoringResult] = phase6FResults;
        phase6FCompliance = {
          accessibilityStatement: accessibilityStatementResult,
          contactMechanism: contactMechanismResult,
          complianceMonitoring: complianceMonitoringResult
        };
      }

      return this.createDetailedReport(url, axeResults, pa11yResults, keyboardNavResults, scanOptions, phase6ACompliance, phase6BCompliance, phase6DCompliance, phase6ECompliance, phase6FCompliance);

    } catch (error) {
      let errorMessage = 'Unknown error occurred';
      
      if (error.name === 'TimeoutError') {
        errorMessage = 'Failed to load page: Timeout';
      } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = 'Failed to load page: DNS lookup failed';
      } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMessage = 'Failed to load page: Connection refused';
      }

      return this.createErrorReport(url, errorMessage);
    }
  }

  async runAxeTests(url, options) {
    try {
      const page = await this.browser.newPage();
      await page.goto(url, { 
        waitUntil: 'networkidle0',
        timeout: options.timeout 
      });

      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });

      const results = await page.evaluate((wcagLevel, includeWarnings) => {
        return new Promise((resolve) => {
          const axeOptions = {
            tags: [`wcag${wcagLevel.toLowerCase()}`, 'wcag2a', 'wcag2aa'],
            resultTypes: includeWarnings ? ['violations', 'passes', 'incomplete'] : ['violations', 'passes']
          };
          
          axe.run(axeOptions, (err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      }, options.wcagLevel, options.includeWarnings);

      const pageTitle = await page.title();
      await page.close();

      return { ...results, pageTitle };
    } catch (error) {
      return { error: error.message };
    }
  }

  async runPa11yTests(url, options) {
    try {
      const pa11yOptions = {
        standard: `WCAG2${options.wcagLevel}`,
        timeout: options.timeout,
        chromeLaunchConfig: {
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      };

      const results = await pa11y(url, pa11yOptions);
      return results;
    } catch (error) {
      return { error: error.message, issues: [] };
    }
  }

  async testKeyboardNavigation(url) {
    try {
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });

      const keyboardTestResults = await page.evaluate(() => {
        const tabbableElements = [];
        const keyboardTraps = [];
        let currentElement = document.body;
        let tabIndex = 0;
        const maxTabs = 50;

        const getAllTabbableElements = () => {
          const selector = 'a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])';
          return Array.from(document.querySelectorAll(selector))
            .filter(el => !el.hasAttribute('disabled') && !el.hidden && el.offsetParent !== null);
        };

        const allTabbable = getAllTabbableElements();
        
        while (tabIndex < maxTabs && tabIndex < allTabbable.length) {
          const focused = document.activeElement;
          tabbableElements.push({
            tagName: focused.tagName,
            id: focused.id || '',
            className: focused.className || '',
            tabIndex: tabIndex
          });

          focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
          
          const nextFocused = document.activeElement;
          if (nextFocused === focused) {
            keyboardTraps.push(`${focused.tagName}${focused.id ? '#' + focused.id : ''}${focused.className ? '.' + focused.className.split(' ')[0] : ''}`);
            break;
          }
          
          tabIndex++;
        }

        const logicalTabOrder = tabbableElements.length > 0 && 
          tabbableElements.every((el, i) => i === 0 || el.tabIndex >= tabbableElements[i-1].tabIndex);

        return {
          tabbableElements: tabbableElements.length,
          logicalTabOrder,
          keyboardTraps: [...new Set(keyboardTraps)]
        };
      });

      await page.close();
      return keyboardTestResults;
    } catch (error) {
      return {
        tabbableElements: 0,
        logicalTabOrder: false,
        keyboardTraps: [],
        error: error.message
      };
    }
  }

  createDetailedReport(url, axeResults, pa11yResults, keyboardNavResults, options, phase6ACompliance = null, phase6BCompliance = null, phase6DCompliance = null, phase6ECompliance = null, phase6FCompliance = null) {
    const violations = axeResults.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact || 'minor',
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map(node => node.target[0] || 'unknown'),
      wcagCriteria: violation.tags.filter(tag => tag.startsWith('wcag'))
    }));

    const categories = this.categorizeByWCAGPrinciples(violations);
    const wcagCompliance = this.calculateWCAGCompliance(violations, options.wcagLevel);

    const totalChecks = axeResults.passes.length + violations.length;
    const accessibilityScore = totalChecks > 0 
      ? Math.round((axeResults.passes.length / totalChecks) * 100)
      : 0;

    const report = {
      url,
      timestamp: new Date(),
      accessibilityScore,
      violations,
      passes: axeResults.passes.length,
      pageTitle: axeResults.pageTitle || '',
      wcagCompliance,
      categories,
      pa11yIssues: pa11yResults.issues || [],
      scanOptions: options
    };

    if (keyboardNavResults) {
      report.keyboardNavigation = keyboardNavResults;
    }

    // Add Phase 6A compliance results if available
    if (phase6ACompliance) {
      report.phase6ACompliance = phase6ACompliance;
      
      // Calculate overall Phase 6A score
      const phase6ATests = [
        phase6ACompliance.colorContrast,
        phase6ACompliance.useOfColor,
        phase6ACompliance.imagesOfText
      ];
      
      const phase6APassed = phase6ATests.filter(test => test.passed).length;
      const phase6AScore = Math.round((phase6APassed / phase6ATests.length) * 100);
      
      report.phase6AScore = phase6AScore;
      
      // Add Phase 6A violations to overall violation count
      const phase6AViolations = phase6ATests.reduce((total, test) => total + test.violations.length, 0);
      report.phase6AViolations = phase6AViolations;
      
      // Update categories with Phase 6A results (all are perceivable)
      if (report.categories && report.categories.perceivable) {
        report.categories.perceivable.violations += phase6AViolations;
        // Recalculate perceivable score
        const totalPerceivable = report.categories.perceivable.violations + report.categories.perceivable.passes;
        if (totalPerceivable > 0) {
          report.categories.perceivable.score = Math.round((report.categories.perceivable.passes / totalPerceivable) * 100);
        }
      }
    }

    // Add Phase 6B compliance results if available
    if (phase6BCompliance) {
      report.phase6BCompliance = phase6BCompliance;
      
      // Calculate overall Phase 6B score
      const phase6BTests = [
        phase6BCompliance.keyboardNavigation,
        phase6BCompliance.focusManagement,
        phase6BCompliance.pageStructure
      ];
      
      const phase6BPassed = phase6BTests.filter(test => test.passed).length;
      const phase6BScore = Math.round((phase6BPassed / phase6BTests.length) * 100);
      
      report.phase6BScore = phase6BScore;
      
      // Add Phase 6B violations to overall violation count
      const phase6BViolations = phase6BTests.reduce((total, test) => total + test.violations.length, 0);
      report.phase6BViolations = phase6BViolations;
      
      // Update categories with Phase 6B results (all are operable)
      if (report.categories && report.categories.operable) {
        report.categories.operable.violations += phase6BViolations;
        // Recalculate operable score
        const totalOperable = report.categories.operable.violations + report.categories.operable.passes;
        if (totalOperable > 0) {
          report.categories.operable.score = Math.round((report.categories.operable.passes / totalOperable) * 100);
        }
      }
    }

    // Add Phase 6D compliance results if available
    if (phase6DCompliance) {
      report.phase6DCompliance = phase6DCompliance;
      
      // Calculate overall Phase 6D score
      const phase6DTests = [
        phase6DCompliance.language,
        phase6DCompliance.htmlValidation
      ];
      
      const phase6DPassed = phase6DTests.filter(test => test.passed).length;
      const phase6DScore = Math.round((phase6DPassed / phase6DTests.length) * 100);
      
      report.phase6DScore = phase6DScore;
      
      // Add Phase 6D violations to overall violation count
      const phase6DViolations = phase6DTests.reduce((total, test) => total + test.violations.length, 0);
      report.phase6DViolations = phase6DViolations;
      
      // Update categories with Phase 6D results (understandable + robust)
      if (report.categories) {
        // Language violations are understandable
        if (report.categories.understandable) {
          report.categories.understandable.violations += phase6DCompliance.language.violations.length;
          const totalUnderstandable = report.categories.understandable.violations + report.categories.understandable.passes;
          if (totalUnderstandable > 0) {
            report.categories.understandable.score = Math.round((report.categories.understandable.passes / totalUnderstandable) * 100);
          }
        }
        
        // HTML validation violations are robust
        if (report.categories.robust) {
          report.categories.robust.violations += phase6DCompliance.htmlValidation.violations.length;
          const totalRobust = report.categories.robust.violations + report.categories.robust.passes;
          if (totalRobust > 0) {
            report.categories.robust.score = Math.round((report.categories.robust.passes / totalRobust) * 100);
          }
        }
      }
    }

    // Add Phase 6E compliance results if available
    if (phase6ECompliance) {
      report.phase6ECompliance = phase6ECompliance;
      
      // Calculate overall Phase 6E score
      const phase6ETests = [
        phase6ECompliance.inputModalities,
        phase6ECompliance.timingControls,
        phase6ECompliance.seizurePrevention,
        phase6ECompliance.predictableNavigation,
        phase6ECompliance.errorHandling,
        phase6ECompliance.eaaProcedure
      ];
      
      const phase6EPassed = phase6ETests.filter(test => test.passed).length;
      const phase6EScore = Math.round((phase6EPassed / phase6ETests.length) * 100);
      
      report.phase6EScore = phase6EScore;
      
      // Add Phase 6E violations to overall violation count
      const phase6EViolations = phase6ETests.reduce((total, test) => total + test.violations.length, 0);
      report.phase6EViolations = phase6EViolations;
      
      // Update categories with Phase 6E results (across all WCAG principles)
      if (report.categories) {
        // Input modalities and seizure prevention are operable
        const operableViolations = phase6ECompliance.inputModalities.violations.length + 
                                  phase6ECompliance.timingControls.violations.length +
                                  phase6ECompliance.seizurePrevention.violations.length;
        if (report.categories.operable) {
          report.categories.operable.violations += operableViolations;
          const totalOperable = report.categories.operable.violations + report.categories.operable.passes;
          if (totalOperable > 0) {
            report.categories.operable.score = Math.round((report.categories.operable.passes / totalOperable) * 100);
          }
        }
        
        // Predictable navigation and error handling are understandable
        const understandableViolations = phase6ECompliance.predictableNavigation.violations.length +
                                        phase6ECompliance.errorHandling.violations.length;
        if (report.categories.understandable) {
          report.categories.understandable.violations += understandableViolations;
          const totalUnderstandable = report.categories.understandable.violations + report.categories.understandable.passes;
          if (totalUnderstandable > 0) {
            report.categories.understandable.score = Math.round((report.categories.understandable.passes / totalUnderstandable) * 100);
          }
        }
      }
      
      // Add EAA Compliance summary
      report.eaaCompliance = {
        proceduralRequirements: {
          accessibilityStatement: phase6ECompliance.eaaProcedure.summary.accessibilityStatementPresent,
          contactMechanism: phase6ECompliance.eaaProcedure.summary.contactMechanismAvailable,
          feedbackProcess: phase6ECompliance.eaaProcedure.summary.feedbackProcessImplemented,
          complianceMonitoring: phase6ECompliance.eaaProcedure.summary.complianceMonitoringActive
        },
        euLegalCompliance: phase6ECompliance.eaaProcedure.summary.euLegalCompliance,
        overallScore: phase6EScore,
        totalViolations: phase6EViolations,
        criticalSafety: {
          seizureRisk: phase6ECompliance.seizurePrevention.summary.seizureRiskLevel,
          safetyCompliant: phase6ECompliance.seizurePrevention.summary.seizureRiskLevel !== 'HIGH'
        }
      };
    }

    // Add Phase 6F compliance results if available
    if (phase6FCompliance) {
      report.phase6FCompliance = phase6FCompliance;
      
      // Calculate overall Phase 6F score
      const phase6FTests = [
        phase6FCompliance.accessibilityStatement,
        phase6FCompliance.contactMechanism,
        phase6FCompliance.complianceMonitoring
      ];
      
      const phase6FPassed = phase6FTests.filter(test => test.passed).length;
      const phase6FScore = Math.round((phase6FPassed / phase6FTests.length) * 100);
      
      report.phase6FScore = phase6FScore;
      
      // Add Phase 6F violations to overall violation count
      const phase6FViolations = phase6FTests.reduce((total, test) => total + test.violations.length, 0);
      report.phase6FViolations = phase6FViolations;
      
      // Add EAA Compliance summary
      report.eaaCompliance = {
        proceduralRequirements: {
          accessibilityStatement: phase6FCompliance.accessibilityStatement.passed,
          contactMechanism: phase6FCompliance.contactMechanism.passed,
          monitoringProcedures: phase6FCompliance.complianceMonitoring.passed
        },
        overallScore: phase6FScore,
        totalViolations: phase6FViolations
      };
    }

    return report;
  }

  categorizeByWCAGPrinciples(violations) {
    const categories = {
      perceivable: { score: 100, violations: 0, passes: 0 },
      operable: { score: 100, violations: 0, passes: 0 },
      understandable: { score: 100, violations: 0, passes: 0 },
      robust: { score: 100, violations: 0, passes: 0 }
    };

    const principleMapping = {
      perceivable: ['color-contrast', 'image-alt', 'audio-caption', 'video-caption'],
      operable: ['keyboard', 'focus', 'timing', 'seizures', 'navigation'],
      understandable: ['readable', 'predictable', 'input-assistance'],
      robust: ['compatible', 'valid-html', 'name-role-value']
    };

    violations.forEach(violation => {
      let categorized = false;
      
      for (const [principle, keywords] of Object.entries(principleMapping)) {
        if (keywords.some(keyword => violation.id.includes(keyword))) {
          categories[principle].violations++;
          categorized = true;
          break;
        }
      }

      if (!categorized) {
        categories.robust.violations++;
      }
    });

    Object.keys(categories).forEach(principle => {
      const total = categories[principle].violations + categories[principle].passes;
      if (total > 0) {
        categories[principle].score = Math.round((categories[principle].passes / total) * 100);
      }
    });

    return categories;
  }

  calculateWCAGCompliance(violations, level) {
    const criteria = [];
    const levelTags = level === 'AAA' ? ['wcag2a', 'wcag2aa', 'wcag2aaa'] : 
                     level === 'AA' ? ['wcag2a', 'wcag2aa'] : ['wcag2a'];

    const criteriaMap = new Map();

    violations.forEach(violation => {
      violation.wcagCriteria.forEach(criterion => {
        if (levelTags.some(tag => criterion.includes(tag))) {
          const criterionNumber = criterion.replace(/wcag\d+/, '').replace(/[a-z]/g, '');
          if (criterionNumber) {
            criteriaMap.set(criterionNumber, false);
          }
        }
      });
    });

    criteriaMap.forEach((passed, criterion) => {
      criteria.push({
        criterion,
        passed,
        level: this.getCriterionLevel(criterion)
      });
    });

    return {
      level,
      criteria
    };
  }

  getCriterionLevel(criterion) {
    const aaaCriteria = ['2.1.3', '2.2.3', '2.2.4', '2.3.2', '2.4.8', '2.4.9', '2.4.10', '3.1.3', '3.1.4', '3.1.5', '3.1.6', '3.2.5', '3.3.5', '3.3.6'];
    const aaCriteria = ['1.2.4', '1.2.5', '1.4.3', '1.4.4', '1.4.5', '2.4.5', '2.4.6', '2.4.7', '3.1.2', '3.2.3', '3.2.4', '3.3.3', '3.3.4'];
    
    if (aaaCriteria.includes(criterion)) return 'AAA';
    if (aaCriteria.includes(criterion)) return 'AA';
    return 'A';
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  createErrorReport(url, errorMessage) {
    return {
      url,
      timestamp: new Date(),
      accessibilityScore: 0,
      violations: [],
      passes: 0,
      pageTitle: '',
      error: errorMessage,
      wcagCompliance: { level: 'AA', criteria: [] },
      categories: {
        perceivable: { score: 0, violations: 0, passes: 0 },
        operable: { score: 0, violations: 0, passes: 0 },
        understandable: { score: 0, violations: 0, passes: 0 },
        robust: { score: 0, violations: 0, passes: 0 }
      }
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    // Close Phase 6A scanners
    await Promise.all([
      this.colorContrastScanner.close(),
      this.useOfColorScanner.close(),
      this.imagesOfTextScanner.close()
    ]);
    
    // Close Phase 6B scanners
    await Promise.all([
      this.keyboardNavigationScanner.close(),
      this.focusManagementScanner.close(),
      this.pageStructureScanner.close()
    ]);
    
    // Close Phase 6D scanners
    await Promise.all([
      this.languageDetectionScanner.close(),
      this.htmlValidationScanner.close()
    ]);
    
    // Close Phase 6E scanners
    await Promise.all([
      this.inputModalitiesScanner.close(),
      this.timingControlsScanner.close(),
      this.seizurePreventionScanner.close(),
      this.predictableNavigationScanner.close(),
      this.errorHandlingScanner.close(),
      this.eaaProcedureScanner.close()
    ]);
    
    // Close Phase 6F scanners
    await Promise.all([
      this.accessibilityStatementScanner.close(),
      this.contactMechanismScanner.close(),
      this.complianceMonitoringScanner.close()
    ]);
  }
}

module.exports = EnhancedAccessibilityScanner;