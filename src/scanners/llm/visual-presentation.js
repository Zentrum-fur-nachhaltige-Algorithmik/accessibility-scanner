/**
 * LLM Visual Presentation Scanner
 * Covers 1.4.7 Low or No Background Audio, 1.4.8 Visual Presentation and
 * 1.4.9 Images of Text (No Exception) (all AAA).
 */

const LLMBaseScanner = require('./base');

class LLMVisualPresentationScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-visual-presentation',
      {
        wcagCriteria: ['1.4.7', '1.4.8', '1.4.9'],
        wcagPrinciple: 'perceivable',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    // Pre-compute the style facts the LLM cannot derive from raw HTML.
    const styleData = await page.evaluate(() => {
      const isVisible = (el) => {
        const s = window.getComputedStyle(el);
        return (
          s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0
        );
      };

      // Text blocks: measured presentation properties (1.4.8)
      const blocks = [];
      const candidates = document.querySelectorAll('p, li, dd, blockquote');
      for (const el of candidates) {
        if (blocks.length >= 30) break;
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        if (text.length < 80 || !isVisible(el)) continue;
        const s = window.getComputedStyle(el);
        const fontSize = parseFloat(s.fontSize) || 16;
        const lineHeightPx =
          s.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(s.lineHeight) || fontSize * 1.2;
        blocks.push({
          tag: el.tagName.toLowerCase(),
          textStart: text.slice(0, 60),
          fontSizePx: Math.round(fontSize),
          lineHeightRatio: Math.round((lineHeightPx / fontSize) * 100) / 100,
          textAlign: s.textAlign,
          containerWidthPx: Math.round(el.clientWidth),
          // Average glyph width in body text is roughly 0.5em.
          approxCharsPerLine: Math.round(el.clientWidth / (fontSize * 0.5)),
          hasMaxWidth: s.maxWidth !== 'none',
        });
      }

      // Media elements (1.4.7)
      const media = Array.from(document.querySelectorAll('audio, video')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        src: el.currentSrc || el.getAttribute('src') || '',
        autoplay: el.hasAttribute('autoplay'),
        controls: el.hasAttribute('controls'),
        muted: el.hasAttribute('muted'),
        loop: el.hasAttribute('loop'),
      }));

      // Images that might contain text (1.4.9)
      const images = Array.from(document.querySelectorAll('img'))
        .filter(isVisible)
        .slice(0, 20)
        .map((el) => ({
          src: (el.getAttribute('src') || '').split('/').pop(),
          alt: el.getAttribute('alt') || '',
          width: el.clientWidth,
          height: el.clientHeight,
        }));

      // Color-change mechanism (1.4.8 bullet 1)
      const hasThemeMechanism = !!document.querySelector(
        '[class*="theme-toggle" i], [id*="theme-toggle" i], ' +
          '[class*="dark-mode" i], [id*="dark-mode" i], ' +
          '[class*="contrast" i][role="switch"], [aria-label*="contrast" i], ' +
          '[aria-label*="dark mode" i], [aria-label*="theme" i]'
      );

      return { blocks, media, images, hasThemeMechanism };
    });

    const prompt = `Check this HTML for WCAG 2.2 AAA visual presentation criteria.

You are given MEASURED computed-style data below. Base every 1.4.8 judgment on
this data, never on guesses from class names or raw CSS.

**Measured text blocks (${styleData.blocks.length}):**
${JSON.stringify(styleData.blocks, null, 1)}

**Media elements (${styleData.media.length}):**
${JSON.stringify(styleData.media)}

**Visible images (${styleData.images.length}):**
${JSON.stringify(styleData.images)}

**Theme/contrast switch mechanism detected:** ${styleData.hasThemeMechanism}

1. **1.4.7 Low or No Background Audio**: Flag ONLY audio/video elements listed
   above where the markup evidences speech content with background audio and no
   way to turn the background off, in practice: autoplay audio without
   controls, or explicit markup describing background music behind narration.
   If the media list is empty, there is NOTHING to flag for 1.4.7.

2. **1.4.8 Visual Presentation**: flag only what the measured data shows:
   - Line length: THREE or more text blocks with approxCharsPerLine > 80 and
     hasMaxWidth=false. One or two long blocks are not a pattern, do not flag.
   - Justified text: text blocks with textAlign="justify" (flag each block).
   - Line spacing: THREE or more body-text blocks with lineHeightRatio < 1.5.
   - Color mechanism: do NOT flag a missing theme switcher on its own: pages
     using default/inherited colors satisfy this via user-agent settings. Only
     mention it (as "moderate") when the page ALSO fails another 1.4.8 bullet
     and hard-codes colors throughout.

3. **1.4.9 Images of Text (No Exception)**: Flag ONLY images where the evidence
   is strong that the image renders text: alt text that duplicates a heading or
   sentence-length wording, or a filename clearly indicating rendered text
   (e.g. "headline.png", "quote-banner.jpg"). Logotypes (logos containing the
   brand name) are EXEMPT: never flag logos, favicons, or icons. Photographs
   with descriptive alt text are NOT images of text.

Do NOT flag:
- Anything for which the measured data above shows no evidence
- Blocks you cannot see in the data (the data is authoritative; the HTML
  excerpt may be truncated)
- Navigation, buttons, badges, code snippets, or headings for line-length or
  line-height rules: those rules apply to body text blocks only
- Missing zoom/resize capability (that is 1.4.4, not checked here)

IMPORTANT: Err on the side of NOT flagging. Each violation must cite the
specific measured values or attributes that prove it (e.g. "3 blocks with
approxCharsPerLine 96-112 and no max-width"). If you cannot cite measured
evidence, do not report the violation.

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
        criteriaChecked: ['1.4.7', '1.4.8', '1.4.9'],
        measuredBlocks: styleData.blocks.length,
        mediaElements: styleData.media.length,
        themeMechanism: styleData.hasThemeMechanism,
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMVisualPresentationScanner;
