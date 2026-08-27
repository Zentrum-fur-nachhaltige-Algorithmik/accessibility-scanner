const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { findStatementLink } = require('../utils/accessibility-statement');
const log = require('../utils/logger').createLogger('compliance-monitoring');

/**
 * Compliance Monitoring Scanner for EAA Procedural Requirements
 * Implements European Accessibility Act monitoring requirements
 * EN 301 549 criteria 12.1.3 (Accessibility procedures)
 */
class ComplianceMonitoringScanner extends BaseScanner {
  constructor() {
    super('compliance-monitoring', {
      wcagCriteria: ['EN 301 549 12.4'],
      wcagPrinciple: 'robust',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * This scanner may navigate to sub-pages to find monitoring information,
   * so it uses the provided page as a starting point.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      timeout: TIMEOUTS.navigation,
      searchDepth: 3,
    };

    const scanOptions = { ...defaultOptions, ...options };

    const monitoringResults = await this.analyzeComplianceMonitoring(page, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['EAA-Monitoring', 'EN-301-549-12.1.3'],
      passed: monitoringResults.violations.length === 0,
      violations: monitoringResults.violations,
      summary: {
        monitoringProcedureDocumented: monitoringResults.monitoringProcedureDocumented,
        regularAuditsScheduled: monitoringResults.regularAuditsScheduled,
        issueTrackingSystem: monitoringResults.issueTrackingSystem,
        userFeedbackIntegrated: monitoringResults.userFeedbackIntegrated,
        continuousImprovementEvidence: monitoringResults.continuousImprovementEvidence,
        gatedOnMissingStatement: monitoringResults.gatedOnMissingStatement || false,
      },
    };
  }

  /**
   * Analyze compliance monitoring procedures
   */
  async analyzeComplianceMonitoring(page, options) {
    log.debug('Analyzing compliance monitoring procedures...');

    const violations = [];

    // Every rule below asks whether the PUBLISHED accessibility statement
    // documents a monitoring procedure, an audit schedule, issue tracking,
    // feedback integration or improvement evidence (EN 301 549 clause 12.2.2).
    // With no statement on the site there is nothing to judge, and
    // `accessibility-statement` already reports the one real defect — so stay
    // silent instead of adding five more findings for the same root cause.
    const statementLink = await findStatementLink(page);
    if (!statementLink.found) {
      return {
        violations: [],
        gatedOnMissingStatement: true,
        monitoringProcedureDocumented: false,
        regularAuditsScheduled: false,
        issueTrackingSystem: false,
        userFeedbackIntegrated: false,
        continuousImprovementEvidence: false,
      };
    }

    let monitoringProcedureDocumented = false;
    let regularAuditsScheduled = false;
    let issueTrackingSystem = false;
    let userFeedbackIntegrated = false;
    let continuousImprovementEvidence = false;

    // 1. Check main page for monitoring information
    const mainPageAnalysis = await this.analyzePageForMonitoring(page);

    // 2. Look for dedicated monitoring/compliance pages
    const monitoringPageAnalysis = await this.findAndAnalyzeMonitoringPages(page, options);

    // Combine results from main page and dedicated pages
    const combinedAnalysis = {
      monitoringProcedure:
        mainPageAnalysis.monitoringProcedure || monitoringPageAnalysis.monitoringProcedure,
      regularAudits: mainPageAnalysis.regularAudits || monitoringPageAnalysis.regularAudits,
      issueTracking: mainPageAnalysis.issueTracking || monitoringPageAnalysis.issueTracking,
      userFeedback: mainPageAnalysis.userFeedback || monitoringPageAnalysis.userFeedback,
      continuousImprovement:
        mainPageAnalysis.continuousImprovement || monitoringPageAnalysis.continuousImprovement,
    };

    // Set results
    monitoringProcedureDocumented = combinedAnalysis.monitoringProcedure;
    regularAuditsScheduled = combinedAnalysis.regularAudits;
    issueTrackingSystem = combinedAnalysis.issueTracking;
    userFeedbackIntegrated = combinedAnalysis.userFeedback;
    continuousImprovementEvidence = combinedAnalysis.continuousImprovement;

    // Generate violations for missing elements
    if (!monitoringProcedureDocumented) {
      violations.push({
        criterion: 'EAA-Monitoring',
        issue: 'no-monitoring-procedure',
        description: 'No documented accessibility monitoring procedures found',
        suggestion:
          'Document and publish accessibility monitoring procedures including regular review processes',
        severity: 'major',
      });
    }

    if (!regularAuditsScheduled) {
      violations.push({
        criterion: 'EAA-Monitoring',
        issue: 'no-audit-schedule',
        description: 'No evidence of regular accessibility audits or scheduled reviews',
        suggestion:
          'Implement and document regular accessibility audit schedule (e.g., quarterly or annually)',
        severity: 'major',
      });
    }

    if (!issueTrackingSystem) {
      violations.push({
        criterion: 'EAA-Monitoring',
        issue: 'no-issue-tracking',
        description: 'No accessibility issue tracking system evident',
        suggestion:
          'Implement public accessibility issue tracker or document issue management process',
        severity: 'major',
      });
    }

    if (!userFeedbackIntegrated) {
      violations.push({
        criterion: 'EAA-Monitoring',
        issue: 'no-user-feedback',
        description: 'No evidence of user feedback integration into accessibility improvements',
        suggestion:
          'Document how user accessibility feedback is collected and integrated into improvements',
        severity: 'major',
      });
    }

    if (!continuousImprovementEvidence) {
      violations.push({
        criterion: 'EAA-Monitoring',
        issue: 'no-improvement-evidence',
        description: 'No evidence of continuous accessibility improvement efforts',
        suggestion:
          'Publish accessibility improvement roadmap or changelog showing ongoing enhancements',
        severity: 'major',
      });
    }

    return {
      violations,
      monitoringProcedureDocumented,
      regularAuditsScheduled,
      issueTrackingSystem,
      userFeedbackIntegrated,
      continuousImprovementEvidence,
    };
  }

  /**
   * Analyze current page for monitoring information
   */
  async analyzePageForMonitoring(page) {
    log.debug('  Analyzing current page for monitoring procedures...');

    const analysis = await page.evaluate(() => {
      const pageText = document.body.textContent.toLowerCase();

      // Check for monitoring procedures
      const monitoringPatterns = [
        /accessibility\s+monitoring/i,
        /monitoring\s+procedures?/i,
        /accessibility\s+review/i,
        /compliance\s+monitoring/i,
        /accessibility\s+oversight/i,
      ];

      let monitoringProcedure = false;
      for (const pattern of monitoringPatterns) {
        if (pattern.test(pageText)) {
          monitoringProcedure = true;
          break;
        }
      }

      // Check for regular audits
      const auditPatterns = [
        /regular\s+audit/i,
        /quarterly\s+audit/i,
        /annual\s+audit/i,
        /accessibility\s+audit/i,
        /audit\s+schedule/i,
        /periodic\s+review/i,
        /monthly\s+review/i,
        /we\s+conduct.*audit/i,
      ];

      let regularAudits = false;
      for (const pattern of auditPatterns) {
        if (pattern.test(pageText)) {
          regularAudits = true;
          break;
        }
      }

      // Check for issue tracking
      const trackingPatterns = [
        /issue\s+track/i,
        /bug\s+track/i,
        /accessibility\s+issues?/i,
        /issue\s+management/i,
        /track.*issues?/i,
        /public\s+issue/i,
        /github.*issues?/i,
        /jira/i,
        /trello/i,
      ];

      let issueTracking = false;
      for (const pattern of trackingPatterns) {
        if (pattern.test(pageText)) {
          issueTracking = true;
          break;
        }
      }

      // Also check for links to issue trackers
      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const link of links) {
        const href = link.getAttribute('href').toLowerCase();
        const text = link.textContent.toLowerCase();

        if (
          (href.includes('github.com') && (href.includes('issues') || text.includes('issues'))) ||
          href.includes('jira') ||
          href.includes('trello') ||
          text.includes('issue tracker') ||
          text.includes('bug tracker')
        ) {
          issueTracking = true;
          break;
        }
      }

      // Check for user feedback integration
      const feedbackPatterns = [
        /user\s+feedback/i,
        /feedback.*integrate/i,
        /user.*input/i,
        /feedback.*review/i,
        /integrate.*feedback/i,
        /accessibility\s+feedback/i,
        /user\s+suggestions?/i,
      ];

      let userFeedback = false;
      for (const pattern of feedbackPatterns) {
        if (pattern.test(pageText)) {
          userFeedback = true;
          break;
        }
      }

      // Check for continuous improvement
      const improvementPatterns = [
        /continuous\s+improvement/i,
        /ongoing\s+improvement/i,
        /accessibility\s+improvement/i,
        /improvement.*roadmap/i,
        /enhancement.*plan/i,
        /accessibility.*updates?/i,
        /changelog/i,
        /what.*new/i,
        /recent.*update/i,
        /improvement.*log/i,
      ];

      let continuousImprovement = false;
      for (const pattern of improvementPatterns) {
        if (pattern.test(pageText)) {
          continuousImprovement = true;
          break;
        }
      }

      return {
        monitoringProcedure,
        regularAudits,
        issueTracking,
        userFeedback,
        continuousImprovement,
      };
    });

    return analysis;
  }

  /**
   * Find and analyze dedicated monitoring/compliance pages
   */
  async findAndAnalyzeMonitoringPages(page, options) {
    log.debug('  Looking for dedicated monitoring/compliance pages...');

    // Find potential monitoring pages
    const monitoringPages = await this.findMonitoringPages(page);

    let combinedAnalysis = {
      monitoringProcedure: false,
      regularAudits: false,
      issueTracking: false,
      userFeedback: false,
      continuousImprovement: false,
    };

    // Analyze each found page
    for (const pageInfo of monitoringPages) {
      try {
        log.debug(`  Analyzing monitoring page: ${pageInfo.url}`);
        await page.goto(pageInfo.url, { waitUntil: 'networkidle0', timeout: options.timeout });

        const pageAnalysis = await this.analyzePageForMonitoring(page);

        // Combine results (OR operation - if any page has evidence, mark as true)
        combinedAnalysis.monitoringProcedure =
          combinedAnalysis.monitoringProcedure || pageAnalysis.monitoringProcedure;
        combinedAnalysis.regularAudits =
          combinedAnalysis.regularAudits || pageAnalysis.regularAudits;
        combinedAnalysis.issueTracking =
          combinedAnalysis.issueTracking || pageAnalysis.issueTracking;
        combinedAnalysis.userFeedback = combinedAnalysis.userFeedback || pageAnalysis.userFeedback;
        combinedAnalysis.continuousImprovement =
          combinedAnalysis.continuousImprovement || pageAnalysis.continuousImprovement;
      } catch (error) {
        log.debug(`  Could not analyze ${pageInfo.url}: ${error.message}`);
      }
    }

    return combinedAnalysis;
  }

  /**
   * Find potential monitoring/compliance pages
   */
  async findMonitoringPages(page) {
    const potentialPages = await page.evaluate(() => {
      const monitoringPatterns = [
        'accessibility monitoring',
        'monitoring',
        'compliance',
        'audit',
        'quality assurance',
        'qa',
        'issues',
        'feedback',
        'improvements',
        'roadmap',
        'changelog',
        'updates',
      ];

      const links = Array.from(document.querySelectorAll('a[href]'));
      const foundPages = [];

      for (const link of links) {
        const text = link.textContent.toLowerCase().trim();
        const href = link.getAttribute('href').toLowerCase();

        for (const pattern of monitoringPatterns) {
          if (text.includes(pattern) || href.includes(pattern)) {
            // Avoid duplicate pages and external links
            if (
              !foundPages.some((p) => p.url === link.href) &&
              !link.href.startsWith('mailto:') &&
              !link.href.startsWith('tel:') &&
              !link.href.includes('twitter.com') &&
              !link.href.includes('facebook.com') &&
              !link.href.includes('linkedin.com')
            ) {
              foundPages.push({
                url: link.href,
                text: link.textContent.trim(),
                pattern: pattern,
              });
            }
            break;
          }
        }
      }

      // Limit to prevent too many page navigations
      return foundPages.slice(0, 5);
    });

    return potentialPages;
  }

  get needsExclusiveAccess() {
    return true;
  }
}

module.exports = ComplianceMonitoringScanner;
