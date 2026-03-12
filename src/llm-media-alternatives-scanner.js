/**
 * LLM Media Alternatives Scanner
 *
 * Covers AAA media criteria:
 * - 1.2.6 Sign Language (Recorded) (AAA)
 * - 1.2.7 Extended Audio Description (Recorded) (AAA)
 * - 1.2.8 Media Alternative (Recorded) (AAA)
 * - 1.2.9 Audio-only (Live) (AAA)
 */

const LLMBaseScanner = require('./llm-base-scanner');

class LLMMediaAlternativesScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-media-alternatives', {
      wcagCriteria: ['1.2.6', '1.2.7', '1.2.8', '1.2.9'],
      wcagPrinciple: 'perceivable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const html = await this.extractRelevantHTML(page, 'body', 12000);

    // Pre-check: does this page contain media elements?
    const hasMedia = await page.evaluate(() => {
      const media = document.querySelectorAll('video, audio, iframe[src*="youtube"], iframe[src*="vimeo"], [class*="player"], [class*="stream"]');
      return media.length > 0;
    });

    if (!hasMedia) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: { totalIssues: 0, note: 'No media elements detected' },
      };
    }

    const prompt = `Check this HTML for WCAG 2.2 AAA media accessibility:

1. **1.2.6 Sign Language (Recorded)**: Does recorded video content include sign language interpretation? Look for sign language video track, picture-in-picture interpreter, or separate sign language version link.

2. **1.2.7 Extended Audio Description**: For videos where pauses between dialogue are insufficient for audio description, is there extended audio description (video pauses to allow description)? Look for extended description tracks or alternative versions.

3. **1.2.8 Media Alternative (Recorded)**: Is there a full text alternative (transcript) for all recorded video content? Not just captions, but a complete text document alternative.

4. **1.2.9 Audio-only (Live)**: For live audio content, is there a real-time text alternative (live transcript, text stream)?

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
        criteriaChecked: ['1.2.6', '1.2.7', '1.2.8', '1.2.9'],
      },
    };
  }
}

module.exports = LLMMediaAlternativesScanner;
