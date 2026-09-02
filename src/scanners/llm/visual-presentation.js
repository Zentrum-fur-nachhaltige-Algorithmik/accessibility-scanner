/**
 * LLM Visual Presentation Scanner
 * Covers 1.4.8 Visual Presentation and 1.4.9 Images of Text (No Exception),
 * both AAA. 1.4.7 Low or No Background Audio is manual: whether speech has
 * background sound behind it is a property of the audio track, not of the page.
 *
 * The 1.4.8 clauses that are numbers (at most 80 characters per line, line
 * spacing of at least 1.5) are measured here in code and travel with the
 * question; the model is asked only what a measurement cannot answer, namely
 * which blocks are body text and whether the page offers the user a way to
 * choose colours and width.
 */

const LLMBaseScanner = require('./base');

/** 1.4.8 clause: no more than 80 characters per line. */
const MAX_CHARS_PER_LINE = 80;

/** 1.4.8 clause: line spacing at least 1.5 within a paragraph. */
const MIN_LINE_HEIGHT_RATIO = 1.5;

class LLMVisualPresentationScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-visual-presentation',
      {
        wcagCriteria: ['1.4.8', '1.4.9'],
        wcagPrinciple: 'perceivable',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    const styleData = await this._measure(page);
    const clauses = this.clauseSummary(styleData.blocks);

    const prompt = `Judge this page against WCAG 2.2 criteria 1.4.8 and 1.4.9 (both AAA). Everything you report becomes a question for a human reviewer, never an automatic failure.

The presentation data below was MEASURED in the browser: the characters per line come from the rendered line boxes, the line spacing from computed styles. Never re-estimate those numbers and never report a block the data does not show.

**Measured text blocks (${styleData.blocks.length}):**
${JSON.stringify(styleData.blocks, null, 1)}

**Measured against the 1.4.8 clauses:** ${clauses.blocksOverLineLength} block(s) render more than ${MAX_CHARS_PER_LINE} characters per line without a max-width, ${clauses.blocksUnderLineHeight} block(s) have line spacing below ${MIN_LINE_HEIGHT_RATIO}, ${clauses.justifiedBlocks} block(s) are justified.

**Visible images (${styleData.images.length}):**
${JSON.stringify(styleData.images)}

**Colour/theme selection mechanism detected:** ${styleData.hasThemeMechanism}

1. **1.4.8 Visual Presentation**: the criterion applies to BLOCKS OF TEXT, not to navigation, buttons, badges, code samples or headings. Say which measured blocks are blocks of text, and raise a question for those where the measurement above already shows a failed clause (line length, line spacing, justification), or where the user is given no mechanism to select foreground and background colours. Do not restate the numbers; name the block and which clause it concerns.

2. **1.4.9 Images of Text (No Exception)**: ask only about images where the evidence is strong that the image renders text: alt text that duplicates a heading or reads as a sentence, or a filename clearly indicating rendered text (e.g. "headline.png", "quote-banner.jpg"). Logotypes, favicons and icons are exempt: never ask about them. Photographs with descriptive alt text are not images of text.

Do NOT report:
- Anything for which the measured data above shows no evidence
- Blocks you cannot see in the data (the data is authoritative; the HTML excerpt may be truncated)
- Missing zoom or resize capability (that is 1.4.4, not checked here)

Each finding must cite the measured block or image it rests on. Return violations as JSON.`;

    const { violations: raw, summary: ctx } = await this.analyzePageChunked(page, prompt);
    const described = await this.describeElements(
      page,
      raw.map((v) => v && v.selector)
    );
    const needsReview = this.convertViolations(raw, {
      model: ctx.llmModel,
      measurements: {
        ...clauses,
        maxCharsPerLineClause: MAX_CHARS_PER_LINE,
        minLineHeightRatioClause: MIN_LINE_HEIGHT_RATIO,
        colourSelectionMechanism: styleData.hasThemeMechanism,
      },
      bySelector: Object.fromEntries(
        Object.entries(described).map(([selector, element]) => [selector, { element }])
      ),
    });

    return this.reviewResult(needsReview, {
      llmModel: ctx.llmModel || 'unknown',
      criteriaChecked: ['1.4.8', '1.4.9'],
      measuredBlocks: styleData.blocks.length,
      themeMechanism: styleData.hasThemeMechanism,
      clauses,
      analyzedFraction: ctx.analyzedFraction,
      rawChars: ctx.rawChars,
      skeletonChars: ctx.skeletonChars,
      chunkCount: ctx.chunkCount,
      truncated: ctx.truncated,
    });
  }

  /**
   * The 1.4.8 clauses this scanner decides in code, over the measured blocks.
   *
   * @param {Object[]} blocks
   * @returns {Object} flat counts and extremes
   */
  clauseSummary(blocks) {
    const perLine = blocks.map((b) => b.charsPerLine).filter((n) => typeof n === 'number' && n > 0);
    const ratios = blocks.map((b) => b.lineHeightRatio).filter((n) => typeof n === 'number');
    return {
      blocksMeasured: blocks.length,
      maxCharsPerLine: perLine.length ? Math.max(...perLine) : null,
      blocksOverLineLength: blocks.filter(
        (b) => b.charsPerLine > MAX_CHARS_PER_LINE && !b.hasMaxWidth
      ).length,
      minLineHeightRatio: ratios.length ? Math.min(...ratios) : null,
      blocksUnderLineHeight: blocks.filter((b) => b.lineHeightRatio < MIN_LINE_HEIGHT_RATIO).length,
      justifiedBlocks: blocks.filter((b) => b.textAlign === 'justify').length,
    };
  }

  /**
   * Measure each text block's rendered presentation.
   *
   * Characters per line come from a Range over the block's contents: its
   * client rects are the rendered line boxes, so dividing the text length by
   * the number of lines is the page's real line length. Deriving it from the
   * container width and half the font size, as this scanner used to, assumes a
   * glyph width no proportional font has.
   */
  async _measure(page) {
    return page.evaluate(() => {
      const isVisible = (el) => {
        const s = window.getComputedStyle(el);
        return (
          s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0
        );
      };

      /** Rendered line count of an element, from the line boxes of a Range. */
      const renderedLines = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set();
        for (const r of range.getClientRects()) {
          if (r.width === 0 && r.height === 0) continue;
          tops.add(Math.round(r.top));
        }
        range.detach && range.detach();
        return tops.size;
      };

      const blocks = [];
      for (const el of document.querySelectorAll('p, li, dd, blockquote')) {
        if (blocks.length >= 30) break;
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        if (text.length < 80 || !isVisible(el)) continue;
        const s = window.getComputedStyle(el);
        const fontSize = parseFloat(s.fontSize) || 16;
        const lineHeightPx =
          s.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(s.lineHeight) || fontSize * 1.2;
        const lines = renderedLines(el);
        blocks.push({
          tag: el.tagName.toLowerCase(),
          textStart: text.slice(0, 60),
          fontSizePx: Math.round(fontSize),
          lineHeightRatio: Math.round((lineHeightPx / fontSize) * 100) / 100,
          textAlign: s.textAlign,
          containerWidthPx: Math.round(el.clientWidth),
          renderedLines: lines,
          charsPerLine: lines > 0 ? Math.round(text.length / lines) : null,
          hasMaxWidth: s.maxWidth !== 'none',
        });
      }

      const images = Array.from(document.querySelectorAll('img'))
        .filter(isVisible)
        .slice(0, 20)
        .map((el) => ({
          src: (el.getAttribute('src') || '').split('/').pop(),
          alt: el.getAttribute('alt') || '',
          width: el.clientWidth,
          height: el.clientHeight,
        }));

      const hasThemeMechanism = !!document.querySelector(
        '[class*="theme-toggle" i], [id*="theme-toggle" i], ' +
          '[class*="dark-mode" i], [id*="dark-mode" i], ' +
          '[class*="contrast" i][role="switch"], [aria-label*="contrast" i], ' +
          '[aria-label*="dark mode" i], [aria-label*="theme" i]'
      );

      return { blocks, images, hasThemeMechanism };
    });
  }
}

module.exports = LLMVisualPresentationScanner;
