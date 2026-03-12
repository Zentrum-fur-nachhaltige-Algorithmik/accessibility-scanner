/**
 * LLM Semantic Text Scanner
 *
 * Covers criteria requiring semantic text analysis:
 * - 3.1.3 Unusual Words (AAA)
 * - 3.1.4 Abbreviations (AAA)
 * - 3.1.6 Pronunciation (AAA)
 * - 2.4.9 Link Purpose (Link Only) (AAA)
 * - 2.4.10 Section Headings (AAA)
 * - 1.3.6 Identify Purpose (AAA)
 */

const LLMBaseScanner = require('./llm-base-scanner');

class LLMSemanticTextScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-semantic-text', {
      wcagCriteria: ['3.1.3', '3.1.4', '3.1.6', '2.4.9', '2.4.10', '1.3.6'],
      wcagPrinciple: 'understandable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const html = await this.extractRelevantHTML(page, 'body', 12000);

    const prompt = `Check this HTML for these WCAG 2.2 AAA criteria:

1. **3.1.3 Unusual Words**: Are jargon/idioms/technical terms defined? Look for terms used without <dfn>, glossary, or title attributes.
2. **3.1.4 Abbreviations**: Are abbreviations expanded on first use? Look for abbreviations without <abbr title="...">.
3. **3.1.6 Pronunciation**: Are words whose meaning depends on pronunciation disambiguated? (e.g., "read" past vs present)
4. **2.4.9 Link Purpose (Link Only)**: Can every link's purpose be determined from the link text alone (without surrounding context)?
5. **2.4.10 Section Headings**: Does each content section have a descriptive heading?
6. **1.3.6 Identify Purpose**: Do UI components, icons, and regions have programmatically determinable purpose (landmark roles, aria-label)?

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
        criteriaChecked: ['3.1.3', '3.1.4', '3.1.6', '2.4.9', '2.4.10', '1.3.6'],
      },
    };
  }
}

module.exports = LLMSemanticTextScanner;
