/**
 * LLM Auth Scanner
 *
 * Covers authentication accessibility criteria:
 * - 3.3.8 Accessible Authentication (Minimum) (AA)
 * - 3.3.9 Accessible Authentication (Enhanced) (AAA)
 */

const LLMBaseScanner = require('./base');

class LLMAuthScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-auth', {
      wcagCriteria: ['3.3.8', '3.3.9'],
      wcagPrinciple: 'understandable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    // Pre-check: does this page contain auth-related elements?
    const hasAuth = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="password"], input[autocomplete*="password"], form[action*="login"], form[action*="auth"], form[action*="signin"]');
      const captchas = document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="recaptcha"], iframe[src*="captcha"]');
      return inputs.length > 0 || captchas.length > 0;
    });

    if (!hasAuth) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: { totalIssues: 0, note: 'No authentication elements detected' },
      };
    }

    const prompt = `Check this HTML for WCAG 2.2 authentication accessibility:

1. **3.3.8 Accessible Authentication (Minimum - AA)**:
   - Is pasting blocked on password/auth fields? (onpaste="return false" or similar)
   - Is autocomplete="off" set on password fields?
   - Is there a CAPTCHA without an accessible alternative (audio, logic-based)?
   - Is there a cognitive function test (transcribing text, solving puzzles)?
   Exception: if a mechanism like copy-paste or password manager support exists, that's acceptable.

2. **3.3.9 Accessible Authentication (Enhanced - AAA)**:
   - ANY cognitive function test fails this (no exceptions except object recognition or personal content).
   - Object recognition CAPTCHAs also fail at AAA level.

Check for: onpaste handlers, autocomplete attributes, CAPTCHA elements, cognitive test patterns.
Return violations as JSON.`;

    const { violations: raw, summary: ctx } = await this.analyzePageChunked(page, prompt);
    const violations = this.convertViolations(raw);

    return {
      scannerId: this.id,
      passed: violations.length === 0,
      violations,
      summary: {
        totalIssues: violations.length,
        llmModel: ctx.llmModel || 'unknown',
        criteriaChecked: ['3.3.8', '3.3.9'],
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMAuthScanner;
