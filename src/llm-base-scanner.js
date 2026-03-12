/**
 * LLMBaseScanner — base class for scanners that use LLM analysis.
 *
 * Extends BaseScanner with LLM capabilities for semantic checks that
 * regex/DOM analysis cannot handle.
 */

const BaseScanner = require('./base-scanner');

class LLMBaseScanner extends BaseScanner {
  /**
   * @param {string} id       — unique scanner identifier
   * @param {Object} metadata — WCAG metadata
   * @param {import('./llm-client')} llmClient — LLM client instance
   */
  constructor(id, metadata, llmClient) {
    super(id, metadata);
    if (!llmClient) {
      throw new Error(`${id}: LLMBaseScanner requires an llmClient instance`);
    }
    this.llmClient = llmClient;
  }

  /**
   * Send HTML snippet to LLM for analysis.
   *
   * @param {string} htmlSnippet — HTML to analyze
   * @param {string} prompt — analysis prompt
   * @param {string} [systemPrompt] — system role prompt
   * @returns {Promise<Object>} Parsed JSON response
   */
  async analyzeWithLLM(htmlSnippet, prompt, systemPrompt) {
    const fullPrompt = `Analyze the following HTML for accessibility issues.\n\nHTML:\n\`\`\`html\n${htmlSnippet}\n\`\`\`\n\n${prompt}`;

    const defaultSystem = `You are an accessibility auditor. Analyze HTML for WCAG 2.2 compliance issues.
Respond ONLY with valid JSON. Do not include markdown code fences or explanations.
Format: { "violations": [{ "criterion": "X.Y.Z", "description": "...", "impact": "critical|serious|moderate|minor", "selector": "..." }], "summary": "..." }`;

    const result = await this.llmClient.predict(fullPrompt, {
      systemPrompt: systemPrompt || defaultSystem,
      temperature: 0,
      forceJson: true,
    });

    if (!result.success) {
      throw new Error(`${this.id}: LLM analysis failed: ${result.error}`);
    }

    let parsed;
    try {
      let content = result.content;
      if (typeof content === 'string') {
        // Strip markdown code fences if present
        content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        // Attempt to fix truncated JSON by closing open arrays/objects
        try {
          parsed = JSON.parse(content);
        } catch {
          // Try to recover truncated JSON
          let fixed = content;
          const openBraces = (fixed.match(/{/g) || []).length;
          const closeBraces = (fixed.match(/}/g) || []).length;
          const openBrackets = (fixed.match(/\[/g) || []).length;
          const closeBrackets = (fixed.match(/]/g) || []).length;
          // Remove trailing incomplete entries (e.g., trailing comma or partial object)
          fixed = fixed.replace(/,\s*(?:{\s*"[^"]*":\s*)?$/, '');
          for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
          for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
          parsed = JSON.parse(fixed);
          console.warn(`${this.id}: Recovered truncated JSON response`);
        }
      } else {
        parsed = content;
      }
    } catch (e) {
      console.error(`${this.id}: Failed to parse LLM response: ${e.message}`);
      // Return empty violations rather than crashing the scan
      parsed = { violations: [], summary: 'LLM response could not be parsed' };
    }

    return parsed;
  }

  /**
   * Extract relevant HTML from a page, truncated to stay within token limits.
   *
   * @param {import('puppeteer').Page} page — Puppeteer page
   * @param {string} [selector='body'] — CSS selector for content to extract
   * @param {number} [maxLength=15000] — Max characters to extract
   * @returns {Promise<string>} Truncated HTML string
   */
  async extractRelevantHTML(page, selector = 'body', maxLength = 15000) {
    const html = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.outerHTML : document.documentElement.outerHTML;
    }, selector);

    if (html.length <= maxLength) return html;

    // Truncate intelligently at a tag boundary if possible
    const truncated = html.slice(0, maxLength);
    const lastTagClose = truncated.lastIndexOf('>');
    if (lastTagClose > maxLength * 0.8) {
      return truncated.slice(0, lastTagClose + 1) + '\n<!-- ... truncated -->';
    }
    return truncated + '\n<!-- ... truncated -->';
  }

  /**
   * Convert LLM violation objects to standard scanner violations.
   *
   * @param {Object[]} llmViolations — from LLM response
   * @returns {Object[]} Standard violation format
   */
  convertViolations(llmViolations) {
    if (!Array.isArray(llmViolations)) return [];

    return llmViolations.map(v => this.formatViolation(
      v.criterion || 'llm-detected',
      v.impact || 'moderate',
      v.description || 'LLM-detected accessibility issue',
      v.selector ? [{ selector: v.selector }] : [],
      v.helpUrl || ''
    ));
  }
}

module.exports = LLMBaseScanner;
