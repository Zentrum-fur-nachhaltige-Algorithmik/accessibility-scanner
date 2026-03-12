/**
 * LLM Behavioral Scanner
 *
 * Covers criteria about application behavior and timing:
 * - 2.2.3 No Timing (AAA)
 * - 2.2.4 Interruptions (AAA)
 * - 2.2.5 Re-authentication (AAA)
 * - 2.2.6 Timeouts (AAA)
 * - 3.2.5 Change on Request (AAA)
 * - 3.3.5 Help (AAA)
 */

const LLMBaseScanner = require('./llm-base-scanner');

class LLMBehavioralScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-behavioral', {
      wcagCriteria: ['2.2.3', '2.2.4', '2.2.5', '2.2.6', '3.2.5', '3.3.5'],
      wcagPrinciple: 'operable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const html = await this.extractRelevantHTML(page, 'body', 12000);

    const prompt = `Check this HTML for WCAG 2.2 AAA behavioral/timing issues:

1. **2.2.3 No Timing**: Are there any time limits on content (even with extensions)? Timed quizzes, countdown timers, auto-advancing slides? At AAA, no timing is allowed for non-essential activities.

2. **2.2.4 Interruptions**: Can interruptions (notifications, alerts, popups) be postponed or suppressed? Look for auto-appearing modals, notification systems, or auto-refresh without user control.

3. **2.2.5 Re-authentication**: After a session timeout, is all user data preserved when re-authenticating? Look for session timeout JavaScript, form data that would be lost.

4. **2.2.6 Timeouts**: Are users warned about inactivity timeouts that will cause data loss? Look for session management code without timeout warnings.

5. **3.2.5 Change on Request**: Are all context changes user-initiated? Look for auto-redirects (meta refresh, window.location changes), auto-submitting forms, content that updates without user action.

6. **3.3.5 Help**: Is context-sensitive help available? For forms: are there help texts, tooltips, instructions, or links to documentation? Complex UI should have help mechanisms.

Return violations as JSON.`;

    const result = await this.analyzeWithLLM(html, prompt);
    const violations = this.convertViolations(result.violations || []);

    return {
      scannerId: this.id,
      passed: violations.length === 0,
      violations,
      summary: {
        totalIssues: violations.length,
        llmModel: result.model || 'unknown',
        criteriaChecked: ['2.2.3', '2.2.4', '2.2.5', '2.2.6', '3.2.5', '3.3.5'],
      },
    };
  }
}

module.exports = LLMBehavioralScanner;
