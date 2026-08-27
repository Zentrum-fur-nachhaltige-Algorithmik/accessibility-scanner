/**
 * LLM Media Alternatives Scanner
 *
 * Covers AAA media criteria:
 * - 1.2.6 Sign Language (Recorded) (AAA)
 * - 1.2.7 Extended Audio Description (Recorded) (AAA)
 * - 1.2.8 Media Alternative (Recorded) (AAA)
 * - 1.2.9 Audio-only (Live) (AAA)
 */

const LLMBaseScanner = require('./base');

class LLMMediaAlternativesScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-media-alternatives', {
      wcagCriteria: ['1.2.6', '1.2.7', '1.2.8', '1.2.9'],
      wcagPrinciple: 'perceivable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    // Pre-check: does this page contain media elements or media-related content?
    const hasMedia = await page.evaluate(() => {
      const media = document.querySelectorAll('video, audio, iframe[src*="youtube"], iframe[src*="vimeo"], [class*="player"], [class*="stream"], [class*="media"], [class*="video"], [class*="audio"]');
      if (media.length > 0) return true;
      // Also check for text references to media content
      const text = document.body?.textContent || '';
      return /\b(video|audio|stream|recording|media player|captions?|transcript)\b/i.test(text);
    });

    if (!hasMedia) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: { totalIssues: 0, note: 'No media elements detected' },
      };
    }

    const prompt = `Check this HTML for WCAG 2.2 AAA media accessibility. Only flag CLEAR violations, not borderline cases.

1. **1.2.6 Sign Language (Recorded)**: Does recorded video content include sign language interpretation? Look for: sign language video track, picture-in-picture interpreter overlay, or a link to a separate sign language version. If a page provides a link to a sign language version or mentions sign language interpretation, it PASSES this criterion.

2. **1.2.7 Extended Audio Description**: For pre-recorded video, is there an extended audio description option? Look for: a <track kind="descriptions"> element, a link to an audio-described version, or mention of extended descriptions. If no video elements exist on the page, skip this check.

3. **1.2.8 Media Alternative (Recorded)**: Is there a full text transcript for all recorded video content? Look for: a visible transcript on the page, a link to a transcript document, or a <details> element containing a transcript. Captions alone do NOT satisfy this — a separate full-text document is needed.

4. **1.2.9 Audio-only (Live)**: For live audio-only streams, is there a real-time text alternative? Only flag this if the page actually contains live audio-only content (live stream without video). If media has video, this criterion does not apply.

IMPORTANT: Only flag violations for media elements that actually exist in the HTML. If a page provides transcripts, sign language links, or description tracks alongside its media, those media elements are COMPLIANT. Do not flag media that already has the required alternatives. Do not report violations for criteria that don't apply to the media on the page (e.g., don't flag 1.2.9 for pre-recorded content).

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
        criteriaChecked: ['1.2.6', '1.2.7', '1.2.8', '1.2.9'],
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMMediaAlternativesScanner;
