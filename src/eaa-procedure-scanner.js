const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');
const {
  findStatementLink,
  missingStatementViolation,
} = require('./utils/accessibility-statement');

/**
 * EAA Procedure Scanner for EU European Accessibility Act 2025 compliance
 * Tests procedural requirements beyond WCAG technical standards
 * Legal compliance for EU market accessibility obligations
 */
class EAAProcedureScanner extends BaseScanner {
  constructor() {
    super('eaa-procedure', {
      wcagCriteria: ['EN 301 549 12.1', 'EN 301 549 12.2', 'EN 301 549 12.4'],
      wcagPrinciple: 'robust'
    });
    this.screenshotDir = path.join(__dirname, '../tmp/eaa-procedure-screenshots');
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * This scanner navigates to sub-pages to find statements, contact info, etc.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      testAccessibilityStatement: true,
      testContactMechanism: true,
      testFeedbackProcess: true,
      testComplianceMonitoring: true,
      searchDepth: 3,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    const eaaResults = await this.performEAAProcedureAnalysis(page, null, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["EAA-Statement", "EAA-Contact", "EAA-Feedback", "EAA-Monitoring"],
      passed: eaaResults.violations.length === 0,
      violations: eaaResults.violations,
      summary: {
        accessibilityStatementPresent: eaaResults.accessibilityStatementPresent,
        contactMechanismAvailable: eaaResults.contactMechanismAvailable,
        feedbackProcessImplemented: eaaResults.feedbackProcessImplemented,
        complianceMonitoringActive: eaaResults.complianceMonitoringActive,
        euLegalCompliance: eaaResults.euLegalCompliance,
        gatedOnMissingStatement: !eaaResults.accessibilityStatementPresent
      },
      visualEvidence: eaaResults.visualEvidence
    };
  }

  /**
   * @deprecated Use scan(page, options) via ScanPipeline instead
   * Scan EAA procedural compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} EAAProcedureReport
   */
  async scanEAAProcedure(url, options = {}) {
    const defaultOptions = {
      testAccessibilityStatement: true,
      testContactMechanism: true,
      testFeedbackProcess: true,
      testComplianceMonitoring: true,
      searchDepth: 3,
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

      const eaaResults = await this.performEAAProcedureAnalysis(page, scanDir, scanOptions);

      await page.close();

      return {
        scannerId: this.id,
        criteria: ["EAA-Statement", "EAA-Contact", "EAA-Feedback", "EAA-Monitoring"],
        passed: eaaResults.violations.length === 0,
        violations: eaaResults.violations,
        summary: {
          accessibilityStatementPresent: eaaResults.accessibilityStatementPresent,
          contactMechanismAvailable: eaaResults.contactMechanismAvailable,
          feedbackProcessImplemented: eaaResults.feedbackProcessImplemented,
          complianceMonitoringActive: eaaResults.complianceMonitoringActive,
          euLegalCompliance: eaaResults.euLegalCompliance
        },
        screenshotPath: scanDir,
        visualEvidence: eaaResults.visualEvidence
      };

    } catch (error) {
      throw new Error(`EAA procedure scan failed: ${error.message}`);
    }
  }

  /**
   * Perform comprehensive EAA procedural analysis
   */
  async performEAAProcedureAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let accessibilityStatementPresent = false;
    let contactMechanismAvailable = false;
    let feedbackProcessImplemented = false;
    let complianceMonitoringActive = false;

    console.log('Starting EAA procedural analysis...');

    // Take initial screenshot (only if scanDir provided)
    if (scanDir) {
      const initialScreenshot = path.join(scanDir, 'eaa-procedure-analysis.png');
      await page.screenshot({ path: initialScreenshot, fullPage: true });
    }

    // 1. Test accessibility statement presence and compliance
    if (options.testAccessibilityStatement) {
      const statementResults = await this.analyzeAccessibilityStatement(page, scanDir, violations, options);
      accessibilityStatementPresent = statementResults.present;
    }

    // Steps 2-4 all judge what the accessibility statement declares (feedback
    // process, accessibility contact point, monitoring procedure — EN 301 549
    // clause 12.2.2). With no statement published they have nothing to read,
    // and step 1 has already reported the single root cause. Running them
    // anyway is what turned one missing statement into four findings here and
    // twelve across the EAA scanner group.
    const statementGate = accessibilityStatementPresent || !options.testAccessibilityStatement;

    // 2. Test contact mechanism availability
    if (options.testContactMechanism && statementGate) {
      const contactResults = await this.analyzeContactMechanism(page, scanDir, violations, options);
      contactMechanismAvailable = contactResults.available;
    }

    // 3. Test feedback process implementation
    if (options.testFeedbackProcess && statementGate) {
      const feedbackResults = await this.analyzeFeedbackProcess(page, scanDir, violations, options);
      feedbackProcessImplemented = feedbackResults.implemented;
    }

    // 4. Test compliance monitoring procedures
    if (options.testComplianceMonitoring && statementGate) {
      const monitoringResults = await this.analyzeComplianceMonitoring(page, scanDir, violations, options);
      complianceMonitoringActive = monitoringResults.active;
    }

    // Calculate overall EU legal compliance
    const euLegalCompliance = accessibilityStatementPresent &&
                             contactMechanismAvailable &&
                             feedbackProcessImplemented;

    // Generate visual evidence
    visualEvidence.push({
      type: 'eaa-procedure',
      screenshot: scanDir ? 'eaa-procedure-analysis.png' : null,
      accessibilityStatementPresent: accessibilityStatementPresent,
      contactMechanismAvailable: contactMechanismAvailable,
      feedbackProcessImplemented: feedbackProcessImplemented,
      complianceMonitoringActive: complianceMonitoringActive,
      euLegalCompliance: euLegalCompliance
    });

    console.log(`EAA procedural analysis complete: ${violations.length} violations found`);
    console.log(`EU Legal Compliance Status: ${euLegalCompliance ? 'COMPLIANT' : 'NON-COMPLIANT'}`);

    return {
      violations,
      visualEvidence,
      accessibilityStatementPresent,
      contactMechanismAvailable,
      feedbackProcessImplemented,
      complianceMonitoringActive,
      euLegalCompliance
    };
  }

  /**
   * Analyze accessibility statement presence and compliance
   */
  async analyzeAccessibilityStatement(page, scanDir, violations, options) {
    console.log('Analyzing accessibility statement compliance...');

    // Detection of the LINK is shared with the other three EAA scanners
    // (src/utils/accessibility-statement.js) so they cannot disagree about
    // whether a statement exists. A statement may also live inline on the page,
    // which is what the embedded check below covers — narrowly: the old version
    // treated any 200-character block containing the word "accessible" as a
    // statement.
    const statementLink = await findStatementLink(page);

    const currentPageAnalysis = await page.evaluate(() => {
      const statementKeywords = [
        'accessibility statement', 'accessibility policy', 'accessibility information',
        'erklärung zur barrierefreiheit', 'barrierefreiheitserklärung'
      ];

      const pageText = document.body.textContent.toLowerCase();
      const hasAccessibilityContent = statementKeywords.some((k) => pageText.includes(k));

      let statementFound = false;
      let statementContent = null;

      for (const element of document.querySelectorAll('section, div, article, main')) {
        const elementText = element.textContent.toLowerCase();
        if (elementText.length <= 200) continue;
        if (!statementKeywords.some((k) => elementText.includes(k))) continue;
        statementFound = true;
        statementContent = {
          type: 'embedded',
          length: elementText.length,
          hasWCAG: elementText.includes('wcag'),
          hasContactInfo: elementText.includes('contact') || elementText.includes('email'),
          hasComplianceDate: elementText.includes('20') && elementText.includes('date'),
          hasKnownIssues: elementText.includes('known') || elementText.includes('limitation')
        };
        break;
      }

      return { issues: [], statementFound, statementContent, hasAccessibilityContent };
    });

    if (!currentPageAnalysis.statementFound && statementLink.found) {
      currentPageAnalysis.statementFound = true;
      currentPageAnalysis.statementContent = { type: 'linked', links: [statementLink] };
    }

    let present = currentPageAnalysis.statementFound;

    // If no statement found on current page, search linked pages
    if (!present && options.searchDepth > 0) {
      try {
        console.log('Searching linked pages for accessibility statement...');

        const linkedPageResults = await page.evaluate(async () => {
          const links = document.querySelectorAll('a[href]');
          const accessibilityLinks = [];

          for (const link of links) {
            const linkText = link.textContent.toLowerCase();
            const href = link.getAttribute('href');

            if ((linkText.includes('accessibility') ||
                 linkText.includes('statement') ||
                 href.toLowerCase().includes('accessibility')) &&
                !href.startsWith('mailto:') &&
                !href.startsWith('tel:')) {
              accessibilityLinks.push({
                text: linkText.trim(),
                href: href
              });
            }
          }

          return accessibilityLinks.slice(0, 3); // Limit to 3 links
        });

        // Visit accessibility statement links
        for (const statementLink of linkedPageResults) {
          try {
            if (statementLink.href.startsWith('/') || statementLink.href.startsWith(page.url())) {
              const newPage = await this.browser.newPage();
              const fullUrl = statementLink.href.startsWith('/') ?
                new URL(statementLink.href, page.url()).href : statementLink.href;

              await newPage.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 10000 });

              // Take screenshot of accessibility statement (only if scanDir provided)
              if (scanDir) {
                const statementScreenshot = path.join(scanDir, 'accessibility-statement.png');
                await newPage.screenshot({ path: statementScreenshot, fullPage: true });
              }

              const statementPageAnalysis = await newPage.evaluate(() => {
                const pageText = document.body.textContent.toLowerCase();

                return {
                  hasWCAG: pageText.includes('wcag') || pageText.includes('web content accessibility'),
                  hasContactInfo: pageText.includes('contact') && pageText.includes('@'),
                  hasComplianceLevel: pageText.includes('aa') || pageText.includes('level'),
                  hasLastUpdated: pageText.includes('updated') || pageText.includes('reviewed'),
                  hasKnownLimitations: pageText.includes('limitation') || pageText.includes('known'),
                  contentLength: pageText.length
                };
              });

              if (statementPageAnalysis.contentLength > 500) {
                present = true;

                // Validate statement quality
                if (!statementPageAnalysis.hasWCAG) {
                  violations.push({
                    criterion: "EAA-Statement",
                    element: 'accessibility statement',
                    issue: 'statement-missing-wcag-reference',
                    description: 'Accessibility statement lacks WCAG compliance reference',
                    severity: 'warning',
                    suggestion: 'Include WCAG 2.2 AA compliance level and reference in statement'
                  });
                }

                if (!statementPageAnalysis.hasContactInfo) {
                  violations.push({
                    criterion: "EAA-Statement",
                    element: 'accessibility statement',
                    issue: 'statement-missing-contact',
                    description: 'Accessibility statement lacks contact information',
                    severity: 'error',
                    suggestion: 'Include contact details for accessibility feedback and support'
                  });
                }

                if (!statementPageAnalysis.hasLastUpdated) {
                  violations.push({
                    criterion: "EAA-Statement",
                    element: 'accessibility statement',
                    issue: 'statement-missing-update-date',
                    description: 'Accessibility statement lacks last updated date',
                    severity: 'warning',
                    suggestion: 'Include last review/update date for transparency'
                  });
                }
              }

              await newPage.close();
              break; // Found statement, stop searching
            }
          } catch (error) {
            console.log(`Failed to load statement page: ${error.message}`);
          }
        }
      } catch (error) {
        console.log(`Statement search failed: ${error.message}`);
      }
    }

    // One finding, `serious`, shared shape with the accessibility-statement
    // scanner so ScanPipeline can collapse the duplicate (see
    // src/utils/accessibility-statement.js). `severity: 'error'` used to map to
    // `critical` in src/severity.js.
    if (!present) {
      violations.push(missingStatementViolation());
    }

    return { present };
  }

  /**
   * Analyze contact mechanism availability
   */
  async analyzeContactMechanism(page, scanDir, violations, options) {
    console.log('Analyzing contact mechanism availability...');

    const contactAnalysis = await page.evaluate(() => {
      const issues = [];
      let available = false;
      const contactMethods = {
        email: false,
        phone: false,
        form: false,
        chat: false,
        feedback: false
      };

      // Look for email contacts
      const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
      if (emailLinks.length > 0) {
        contactMethods.email = true;
        available = true;
      }

      // Look for phone contacts
      const phoneLinks = document.querySelectorAll('a[href^="tel:"]');
      if (phoneLinks.length > 0) {
        contactMethods.phone = true;
        available = true;
      }

      // Look for contact forms
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        const formText = form.textContent.toLowerCase();
        if (formText.includes('contact') || formText.includes('feedback') ||
            formText.includes('support') || formText.includes('help')) {
          contactMethods.form = true;
          available = true;
        }
      });

      // Look for chat or messaging systems
      const chatElements = document.querySelectorAll('[class*="chat"], [id*="chat"], [class*="message"], [id*="intercom"]');
      if (chatElements.length > 0) {
        contactMethods.chat = true;
        available = true;
      }

      // Look for feedback mechanisms
      const feedbackElements = document.querySelectorAll('a, button');
      feedbackElements.forEach(element => {
        const text = element.textContent.toLowerCase();
        if (text.includes('feedback') || text.includes('report') || text.includes('accessibility')) {
          contactMethods.feedback = true;
          available = true;
        }
      });

      // Look for accessibility-specific contact information
      const pageText = document.body.textContent.toLowerCase();
      const hasAccessibilityContact = pageText.includes('accessibility') &&
                                     (pageText.includes('contact') || pageText.includes('email') ||
                                      pageText.includes('feedback'));

      return { issues, available, contactMethods, hasAccessibilityContact };
    });

    // Validate contact mechanism quality
    if (!contactAnalysis.available) {
      violations.push({
        criterion: "EAA-Contact",
        element: 'website',
        issue: 'no-contact-mechanism',
        description: 'No contact mechanism found for accessibility feedback',
        severity: 'error',
        suggestion: 'Provide email, phone, or contact form for accessibility support'
      });
    } else {
      // Check for accessibility-specific contact
      if (!contactAnalysis.hasAccessibilityContact) {
        violations.push({
          criterion: "EAA-Contact",
          element: 'contact information',
          issue: 'no-accessibility-specific-contact',
          description: 'No accessibility-specific contact information found',
          severity: 'warning',
          suggestion: 'Provide dedicated contact method for accessibility feedback and issues'
        });
      }

      // Recommend multiple contact methods
      const methodCount = Object.values(contactAnalysis.contactMethods).filter(Boolean).length;
      if (methodCount < 2) {
        violations.push({
          criterion: "EAA-Contact",
          element: 'contact methods',
          issue: 'limited-contact-options',
          description: 'Limited contact options available for accessibility feedback',
          severity: 'warning',
          suggestion: 'Provide multiple contact methods (email, phone, form) for better accessibility'
        });
      }
    }

    return { available: contactAnalysis.available };
  }

  /**
   * Analyze feedback process implementation
   */
  async analyzeFeedbackProcess(page, scanDir, violations, options) {
    console.log('Analyzing feedback process implementation...');

    const feedbackAnalysis = await page.evaluate(() => {
      const issues = [];
      let implemented = false;
      const feedbackFeatures = {
        feedbackForm: false,
        reportIssue: false,
        accessibilityFeedback: false,
        responseCommitment: false,
        publicFeedback: false
      };

      // Look for feedback forms
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        const formText = form.textContent.toLowerCase();
        if (formText.includes('feedback') || formText.includes('report') ||
            formText.includes('issue') || formText.includes('problem')) {
          feedbackFeatures.feedbackForm = true;
          implemented = true;
        }
      });

      // Look for "report issue" or "report problem" functionality
      const reportElements = document.querySelectorAll('a, button');
      reportElements.forEach(element => {
        const text = element.textContent.toLowerCase();
        if (text.includes('report') && (text.includes('issue') || text.includes('problem') ||
            text.includes('bug') || text.includes('accessibility'))) {
          feedbackFeatures.reportIssue = true;
          implemented = true;
        }
      });

      // Look for accessibility-specific feedback
      const pageText = document.body.textContent.toLowerCase();
      if (pageText.includes('accessibility') && pageText.includes('feedback')) {
        feedbackFeatures.accessibilityFeedback = true;
        implemented = true;
      }

      // Look for response commitment
      if (pageText.includes('respond') || pageText.includes('reply') ||
          pageText.includes('within') || pageText.includes('business days')) {
        feedbackFeatures.responseCommitment = true;
      }

      // Look for public feedback or transparency
      if (pageText.includes('public') && pageText.includes('feedback') ||
          pageText.includes('transparent') || pageText.includes('open')) {
        feedbackFeatures.publicFeedback = true;
      }

      return { issues, implemented, feedbackFeatures };
    });

    // Validate feedback process quality
    if (!feedbackAnalysis.implemented) {
      violations.push({
        criterion: "EAA-Feedback",
        element: 'website',
        issue: 'no-feedback-process',
        description: 'No feedback process found for accessibility issues',
        severity: 'error',
        suggestion: 'Implement feedback mechanism for users to report accessibility barriers'
      });
    } else {
      // Check for response commitment
      if (!feedbackAnalysis.feedbackFeatures.responseCommitment) {
        violations.push({
          criterion: "EAA-Feedback",
          element: 'feedback process',
          issue: 'no-response-commitment',
          description: 'Feedback process lacks response time commitment',
          severity: 'warning',
          suggestion: 'Specify response timeframe for accessibility feedback (e.g., within 5 business days)'
        });
      }

      // Check for accessibility-specific feedback
      if (!feedbackAnalysis.feedbackFeatures.accessibilityFeedback) {
        violations.push({
          criterion: "EAA-Feedback",
          element: 'feedback process',
          issue: 'no-accessibility-specific-feedback',
          description: 'No accessibility-specific feedback mechanism found',
          severity: 'warning',
          suggestion: 'Provide dedicated feedback channel for accessibility-related issues'
        });
      }
    }

    return { implemented: feedbackAnalysis.implemented };
  }

  /**
   * Analyze compliance monitoring procedures
   */
  async analyzeComplianceMonitoring(page, scanDir, violations, options) {
    console.log('Analyzing compliance monitoring procedures...');

    const monitoringAnalysis = await page.evaluate(() => {
      const issues = [];
      let active = false;
      const monitoringFeatures = {
        complianceStatement: false,
        auditInformation: false,
        updateSchedule: false,
        improvementPlan: false,
        publicReporting: false
      };

      const pageText = document.body.textContent.toLowerCase();

      // Look for compliance monitoring statements
      if (pageText.includes('compliance') && (pageText.includes('monitor') ||
          pageText.includes('review') || pageText.includes('audit'))) {
        monitoringFeatures.complianceStatement = true;
        active = true;
      }

      // Look for audit information
      if (pageText.includes('audit') || pageText.includes('assessment') ||
          pageText.includes('evaluation')) {
        monitoringFeatures.auditInformation = true;
        active = true;
      }

      // Look for update schedule
      if (pageText.includes('schedule') || pageText.includes('regular') ||
          pageText.includes('annually') || pageText.includes('quarterly')) {
        monitoringFeatures.updateSchedule = true;
      }

      // Look for improvement plan
      if (pageText.includes('improvement') || pageText.includes('roadmap') ||
          pageText.includes('plan') || pageText.includes('enhance')) {
        monitoringFeatures.improvementPlan = true;
      }

      // Look for public reporting
      if (pageText.includes('public') && (pageText.includes('report') ||
          pageText.includes('transparency') || pageText.includes('progress'))) {
        monitoringFeatures.publicReporting = true;
      }

      return { issues, active, monitoringFeatures };
    });

    // Validate monitoring procedures
    if (!monitoringAnalysis.active) {
      violations.push({
        criterion: "EAA-Monitoring",
        element: 'website',
        issue: 'no-compliance-monitoring',
        description: 'No compliance monitoring procedures documented',
        severity: 'warning',
        suggestion: 'Document accessibility compliance monitoring and review procedures'
      });
    } else {
      // Check for improvement plan
      if (!monitoringAnalysis.monitoringFeatures.improvementPlan) {
        violations.push({
          criterion: "EAA-Monitoring",
          element: 'monitoring procedures',
          issue: 'no-improvement-plan',
          description: 'No accessibility improvement plan documented',
          severity: 'warning',
          suggestion: 'Include accessibility improvement roadmap and planned enhancements'
        });
      }

      // Check for update schedule
      if (!monitoringAnalysis.monitoringFeatures.updateSchedule) {
        violations.push({
          criterion: "EAA-Monitoring",
          element: 'monitoring procedures',
          issue: 'no-update-schedule',
          description: 'No regular review schedule for accessibility compliance',
          severity: 'warning',
          suggestion: 'Establish and document regular accessibility review schedule'
        });
      }
    }

    return { active: monitoringAnalysis.active };
  }

  get needsExclusiveAccess() {
    return true;
  }

}

module.exports = EAAProcedureScanner;
