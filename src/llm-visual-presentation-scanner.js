/**
 * LLM Visual Presentation Scanner
 *
 * Covers AAA visual criteria:
 * - 1.4.7 Low or No Background Audio (AAA)
 * - 1.4.8 Visual Presentation (AAA)
 * - 1.4.9 Images of Text (No Exception) (AAA)
 */

const LLMBaseScanner = require('./llm-base-scanner');

class LLMVisualPresentationScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-visual-presentation', {
      wcagCriteria: ['1.4.7', '1.4.8', '1.4.9'],
      wcagPrinciple: 'perceivable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const html = await this.extractRelevantHTML(page, 'body', 12000);

    const prompt = `Check this HTML for WCAG 2.2 AAA visual presentation issues:

1. **1.4.7 Low or No Background Audio**: If there's audio content with speech, does the background audio interfere? Check for audio/video elements with background music that might overwhelm foreground speech. Look for audio without volume controls.

2. **1.4.8 Visual Presentation**: Check text blocks for:
   - Lines wider than 80 characters (no max-width constraint)
   - Text-align: justify (justified text)
   - Line-height less than 1.5 for body text
   - No mechanism to change foreground/background colors
   - Text cannot be resized to 200%
   - Fixed width containers that prevent text reflow

3. **1.4.9 Images of Text (No Exception)**: At AAA, images of text are NOT allowed except for:
   - Logotypes (text that is part of a logo or brand name)
   Look for: <img> elements that appear to contain text (filename hints like *-text*, *-heading*, *-banner*), CSS background-image on elements that seem to display text, canvas elements rendering text.

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
        criteriaChecked: ['1.4.7', '1.4.8', '1.4.9'],
      },
    };
  }
}

module.exports = LLMVisualPresentationScanner;
