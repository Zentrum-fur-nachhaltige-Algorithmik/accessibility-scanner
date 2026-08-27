const BaseScanner = require('./base-scanner');
const {
  findStatementLink,
  missingStatementViolation,
} = require('./utils/accessibility-statement');

/**
 * Accessibility Statement Scanner for EAA Procedural Requirements
 * Implements European Accessibility Act compliance checking
 * EN 301 549 criteria 12.1.1 (Accessibility and compatibility features)
 */
class AccessibilityStatementScanner extends BaseScanner {
  constructor() {
    super('accessibility-statement', {
      wcagCriteria: ['EN 301 549 12.1'],
      wcagPrinciple: 'robust'
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * This scanner needs to follow links to find the accessibility statement,
   * so it will navigate from the provided starting page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      searchDepth: 3,
      timeout: 30000,
      language: 'auto'
    };

    const scanOptions = { ...defaultOptions, ...options };

    const statementResults = await this.analyzeAccessibilityStatement(page, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["EAA-Statement", "EN-301-549-12.1.1"],
      passed: statementResults.violations.length === 0,
      violations: statementResults.violations,
      summary: {
        statementExists: statementResults.statementExists,
        statementAccessible: statementResults.statementAccessible,
        statementComplete: statementResults.statementComplete,
        contactMechanismProvided: statementResults.contactMechanismProvided,
        lastUpdated: statementResults.lastUpdated,
        complianceLevel: statementResults.complianceLevel,
        knownIssuesListed: statementResults.knownIssuesListed,
        feedbackMechanismAvailable: statementResults.feedbackMechanismAvailable
      }
    };
  }

  /**
   * Analyze accessibility statement presence and completeness
   */
  async analyzeAccessibilityStatement(page, options) {
    console.log('Analyzing accessibility statement...');

    const violations = [];
    let statementExists = false;
    let statementAccessible = false;
    let statementComplete = false;
    let contactMechanismProvided = false;
    let lastUpdated = null;
    let complianceLevel = null;
    let knownIssuesListed = false;
    let feedbackMechanismAvailable = false;

    // 1. Look for accessibility statement link on main page
    const statementLinkResults = await this.findAccessibilityStatementLink(page);

    if (!statementLinkResults.found) {
      // Exactly ONE finding, and not `critical`. Every other rule in this
      // scanner (and in eaa-procedure / contact-mechanism /
      // compliance-monitoring) describes a property OF the statement — missing
      // contact, missing review date, missing monitoring procedure — and is
      // undecidable while no statement exists. See
      // src/utils/accessibility-statement.js.
      violations.push(missingStatementViolation());

      return {
        violations,
        statementExists: false,
        statementAccessible: false,
        statementComplete: false,
        contactMechanismProvided: false,
        lastUpdated: null,
        complianceLevel: null,
        knownIssuesListed: false,
        feedbackMechanismAvailable: false
      };
    }

    statementExists = true;

    // 2. Navigate to accessibility statement page
    try {
      await page.goto(statementLinkResults.url, { waitUntil: 'networkidle0', timeout: options.timeout });
      statementAccessible = true;
      console.log(`  Found accessibility statement at: ${statementLinkResults.url}`);
    } catch (error) {
      violations.push({
        criterion: "EAA-Statement",
        issue: "inaccessible-statement",
        description: `Accessibility statement link found but page is not accessible: ${error.message}`,
        element: statementLinkResults.selector,
        suggestion: "Ensure accessibility statement page loads correctly and is accessible",
        severity: "serious"
      });

      return {
        violations,
        statementExists: true,
        statementAccessible: false,
        statementComplete: false,
        contactMechanismProvided: false,
        lastUpdated: null,
        complianceLevel: null,
        knownIssuesListed: false,
        feedbackMechanismAvailable: false
      };
    }

    // 3. Analyze statement content
    const contentAnalysis = await this.analyzeStatementContent(page);

    // Check last updated date
    lastUpdated = contentAnalysis.lastUpdated;
    if (!contentAnalysis.lastUpdated || this.isStatementOutdated(contentAnalysis.lastUpdated)) {
      violations.push({
        criterion: "EAA-Statement",
        issue: "outdated-statement",
        description: "No last updated date found or statement is older than 12 months",
        element: "main",
        suggestion: "Add last updated date and ensure statement is reviewed at least annually",
        severity: "major"
      });
    }

    // Check compliance level
    complianceLevel = contentAnalysis.complianceLevel;
    if (!contentAnalysis.complianceLevel) {
      violations.push({
        criterion: "EAA-Statement",
        issue: "incomplete-content",
        description: "Accessibility statement lacks required information: compliance level",
        element: "main",
        suggestion: "Add compliance level (A, AA, AAA, partial, or non-compliant)",
        severity: "major"
      });
    }

    // Check contact mechanism
    contactMechanismProvided = contentAnalysis.contactMechanism;
    if (!contentAnalysis.contactMechanism) {
      violations.push({
        criterion: "EAA-Statement",
        issue: "missing-contact",
        description: "No contact mechanism provided for accessibility issues",
        element: "main",
        suggestion: "Add contact information (email, phone, or feedback form) for accessibility issues",
        severity: "serious"
      });
    }

    // Check known issues
    knownIssuesListed = contentAnalysis.knownIssues;

    // Check feedback mechanism
    feedbackMechanismAvailable = contentAnalysis.feedbackMechanism;

    // Statement is complete if no violations found
    statementComplete = violations.length === 0;

    return {
      violations,
      statementExists,
      statementAccessible,
      statementComplete,
      contactMechanismProvided,
      lastUpdated,
      complianceLevel,
      knownIssuesListed,
      feedbackMechanismAvailable
    };
  }

  /**
   * Find accessibility statement link on the page
   */
  async findAccessibilityStatementLink(page) {
    console.log('  Looking for accessibility statement link...');
    // Detection lives in src/utils/accessibility-statement.js so that all four
    // EAA scanners agree on whether a statement exists — they used to disagree,
    // which is how one missing statement became a dozen findings.
    return findStatementLink(page);
  }

  /**
   * Analyze content of accessibility statement page
   */
  async analyzeStatementContent(page) {
    console.log('  Analyzing statement content...');

    const contentAnalysis = await page.evaluate(() => {
      const pageText = document.body.textContent.toLowerCase();

      // Look for last updated date
      let lastUpdated = null;
      const datePatterns = [
        /last updated[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{4})/i,
        /updated[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{4})/i,
        /([0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2})/i,
        /([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{4})/i
      ];

      // Check time elements first
      const timeElements = document.querySelectorAll('time[datetime]');
      if (timeElements.length > 0) {
        const datetime = timeElements[0].getAttribute('datetime');
        lastUpdated = new Date(datetime);
      } else {
        // Fall back to text parsing
        for (const pattern of datePatterns) {
          const match = pageText.match(pattern);
          if (match) {
            try {
              lastUpdated = new Date(match[1] || match[0]);
              break;
            } catch (e) {
              // Continue to next pattern
            }
          }
        }
      }

      // Look for compliance level
      let complianceLevel = null;
      const compliancePatterns = [
        /wcag\s+2\.1\s+(aaa)/i,
        /wcag\s+2\.1\s+(aa)/i,
        /wcag\s+2\.1\s+(a)/i,
        /wcag\s+(aaa)/i,
        /wcag\s+(aa)/i,
        /wcag\s+(a)/i,
        /(fully\s+compliant)/i,
        /(partially\s+compliant)/i,
        /(non[‑\-\s]*compliant)/i
      ];

      for (const pattern of compliancePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          const level = match[1].toLowerCase();
          if (level.includes('aaa')) complianceLevel = 'AAA';
          else if (level.includes('aa')) complianceLevel = 'AA';
          else if (level === 'a') complianceLevel = 'A';
          else if (level.includes('fully')) complianceLevel = 'AA';
          else if (level.includes('partial')) complianceLevel = 'partial';
          else if (level.includes('non')) complianceLevel = 'non-compliant';
          break;
        }
      }

      // Look for contact mechanism
      const contactPatterns = [
        /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,  // Email
        /\+?[0-9\s\-()]{10,}/,             // Phone
        /contact\s+us/i,
        /feedback/i,
        /report\s+issue/i
      ];

      let contactMechanism = false;
      for (const pattern of contactPatterns) {
        if (pattern.test(pageText)) {
          contactMechanism = true;
          break;
        }
      }

      // Also check for actual form elements or mailto links
      const emailLinks = document.querySelectorAll('a[href^="mailto:"]');
      const phoneLinks = document.querySelectorAll('a[href^="tel:"]');
      const forms = document.querySelectorAll('form');

      if (emailLinks.length > 0 || phoneLinks.length > 0 || forms.length > 0) {
        contactMechanism = true;
      }

      // Look for known issues section
      const knownIssuesPatterns = [
        /known\s+issues/i,
        /limitations/i,
        /exceptions/i,
        /accessibility\s+barriers/i
      ];

      let knownIssues = false;
      for (const pattern of knownIssuesPatterns) {
        if (pattern.test(pageText)) {
          knownIssues = true;
          break;
        }
      }

      // Look for feedback mechanism
      const feedbackPatterns = [
        /feedback/i,
        /report\s+problem/i,
        /contact\s+us/i,
        /accessibility\s+support/i
      ];

      let feedbackMechanism = false;
      for (const pattern of feedbackPatterns) {
        if (pattern.test(pageText)) {
          feedbackMechanism = true;
          break;
        }
      }

      return {
        lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
        complianceLevel,
        contactMechanism,
        knownIssues,
        feedbackMechanism
      };
    });

    // Convert lastUpdated back to Date object if it exists
    if (contentAnalysis.lastUpdated) {
      contentAnalysis.lastUpdated = new Date(contentAnalysis.lastUpdated);
    }

    return contentAnalysis;
  }

  /**
   * Check if statement is outdated (older than 12 months)
   */
  isStatementOutdated(lastUpdated) {
    if (!lastUpdated) return true;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    return lastUpdated < twelveMonthsAgo;
  }

  get needsExclusiveAccess() {
    return true;
  }

}

module.exports = AccessibilityStatementScanner;
