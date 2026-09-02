/**
 * LLM Reading Level Scanner
 * Covers 3.1.5 Reading Level (Level AAA) as page-level judgement.
 *
 * The readability numbers are measured here in code (sentence length,
 * syllables per word, Flesch for English, Wiener Sachtextformel for German)
 * and travel with the question as measurements. The model is never asked to
 * estimate them: it answers whether a lower-secondary reader could follow the
 * text and whether a simpler version or summary exists.
 */

const LLMBaseScanner = require('./base');

/** Below this, there is not enough prose to say anything about reading level. */
const MIN_WORDS = 50;

class LLMReadingLevelScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-reading-level',
      {
        wcagCriteria: ['3.1.5'],
        wcagPrinciple: 'understandable',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    const textData = await this._collectText(page);

    if (textData.words.length < MIN_WORDS) {
      return this.reviewResult([], {
        criteriaChecked: ['3.1.5'],
        skipped: 'insufficient text content to assess reading level',
        totalWords: textData.words.length,
      });
    }

    const measurements = {
      lang: textData.lang || 'not declared',
      ...this.readability(textData.words, textData.sentenceCount, textData.lang),
      glossary: textData.hasGlossary,
      simplifiedVersion: textData.hasSimplifiedVersion,
      summarySection: textData.hasSummary,
      inlineDefinitions: textData.hasDefinitions,
    };

    const prompt = `Judge this page against WCAG 2.2 criterion 3.1.5 (Reading Level, Level AAA).

The criterion asks for a supplemental, easier version when the text requires reading ability beyond lower secondary education (roughly age 12 to 15).

Two questions, both about MEANING, not about counting:

1. Could a reader at lower secondary level follow the main content of this page: is the subject matter explained as it goes, or does it assume knowledge and vocabulary a general reader does not have?

2. If it does assume that: does the page offer a way through anyway, that is a plain-language or "Einfache Sprache" version, a summary or abstract of the content, a glossary, or inline definitions of the terms it relies on?

Report a finding ONLY when the answer to 1 is no AND the answer to 2 is no. Never report numbers: sentence length, syllable counts and readability indexes are measured elsewhere and are not your job. Never report navigation text, button labels or other UI chrome, and never report text that is unavoidably technical for its subject and defines its terms.

**Page language:** ${textData.lang || 'not specified'}

**Sample of the densest paragraphs:**
${textData.longestParagraphs.map((p, i) => `[Paragraph ${i + 1}]: ${p.slice(0, 500)}`).join('\n\n')}

Use criterion "3.1.5". Return violations as JSON; an empty array when a lower-secondary reader could follow the page or a simpler version exists.`;

    const { violations: raw, summary: ctx } = await this.analyzePageChunked(page, prompt);
    const needsReview = this.convertViolations(raw, { model: ctx.llmModel, measurements });

    return this.reviewResult(needsReview, {
      llmModel: ctx.llmModel || 'unknown',
      criteriaChecked: ['3.1.5'],
      analyzedFraction: ctx.analyzedFraction,
      rawChars: ctx.rawChars,
      skeletonChars: ctx.skeletonChars,
      chunkCount: ctx.chunkCount,
      truncated: ctx.truncated,
      readability: measurements,
    });
  }

  /**
   * Readability of the page's own prose, in code.
   *
   * Flesch Reading Ease for English, Amstad's German Flesch plus the Wiener
   * Sachtextformel (variant 1) for German: WSTF reads directly as a school
   * grade, which is what 3.1.5's "lower secondary" threshold is stated in.
   *
   * @param {string[]} words
   * @param {number} sentenceCount
   * @param {string} lang - document language, may be empty
   * @returns {Object} flat measurements
   */
  readability(words, sentenceCount, lang) {
    const sentences = Math.max(1, sentenceCount);
    const syllables = words.map((w) => this.countSyllables(w));
    const totalSyllables = syllables.reduce((a, b) => a + b, 0);
    const asl = words.length / sentences;
    const asw = totalSyllables / words.length;
    const round = (n) => Math.round(n * 10) / 10;

    const out = {
      totalWords: words.length,
      totalSentences: sentences,
      avgWordsPerSentence: round(asl),
      avgSyllablesPerWord: Math.round(asw * 100) / 100,
      longWordsPercent: round((words.filter((w) => w.length > 6).length / words.length) * 100),
    };

    if (/^de/i.test(lang || '')) {
      const ms = (syllables.filter((s) => s >= 3).length / words.length) * 100;
      const iw = (words.filter((w) => w.length > 6).length / words.length) * 100;
      const es = (syllables.filter((s) => s === 1).length / words.length) * 100;
      out.wienerSachtextformel = round(
        0.1935 * ms + 0.1672 * asl + 0.1297 * iw - 0.0327 * es - 0.875
      );
      out.fleschDe = round(180 - asl - 58.5 * asw);
      out.readabilityFormula = 'Wiener Sachtextformel 1 (school grade), Flesch-DE (Amstad)';
    } else {
      out.fleschReadingEase = round(206.835 - 1.015 * asl - 84.6 * asw);
      out.fleschKincaidGrade = round(0.39 * asl + 11.8 * asw - 15.59);
      out.readabilityFormula = 'Flesch Reading Ease, Flesch-Kincaid Grade Level';
    }
    return out;
  }

  /**
   * Syllables of one word, by counting vowel groups. A heuristic, shared by
   * the English and the German formulas: both count spoken syllables, and both
   * indexes are read as bands rather than as exact values.
   *
   * @param {string} word
   * @returns {number} at least 1
   */
  countSyllables(word) {
    const w = word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, '');
    if (!w) return 1;
    const groups = w.match(/[aeiouyäöüà-æè-ïò-öù-ü]+/g);
    let count = groups ? groups.length : 1;
    // Silent final "e" in English ("more", "table"); never below one syllable.
    if (/[^aeiou]e$/.test(w) && count > 1) count--;
    return Math.max(1, count);
  }

  /** Main-content prose plus the simplification mechanisms the page offers. */
  async _collectText(page) {
    return page.evaluate(() => {
      const main = document.querySelector('main, [role="main"]') || document.body;
      const clone = main.cloneNode(true);

      clone
        .querySelectorAll(
          'nav, header, footer, script, style, noscript, ' +
            '[role="navigation"], [role="banner"], [role="contentinfo"]'
        )
        .forEach((el) => el.remove());

      const text = clone.textContent.replace(/\s+/g, ' ').trim();
      const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim().length > 10).length;
      const words = text.split(/\s+/).filter((w) => /\w/.test(w));

      const hasGlossary = !!document.querySelector(
        '[class*="glossar" i], [id*="glossar" i], [class*="glossary" i], ' +
          '[id*="glossary" i], dl, [role="definition"]'
      );
      const hasSimplifiedVersion = !!document.querySelector(
        '[class*="simple" i], [class*="plain" i], [class*="easy-read" i], ' +
          '[class*="simplified" i], [class*="einfache-sprache" i], ' +
          '[aria-label*="simplified" i], [aria-label*="plain language" i], ' +
          '[aria-label*="einfache sprache" i], details summary'
      );
      const hasSummary = !!document.querySelector(
        '[class*="summary" i], [class*="abstract" i], [class*="tldr" i], ' +
          '[class*="overview" i], [class*="zusammenfassung" i]'
      );
      const hasDefinitions = document.querySelectorAll('dfn, abbr[title]').length > 2;

      const longestParagraphs = Array.from(clone.querySelectorAll('p, article, section > div'))
        .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 100)
        .sort((a, b) => b.length - a.length)
        .slice(0, 5);

      return {
        words,
        sentenceCount,
        hasGlossary,
        hasSimplifiedVersion,
        hasSummary,
        hasDefinitions,
        longestParagraphs,
        lang: document.documentElement.lang || '',
      };
    });
  }
}

module.exports = LLMReadingLevelScanner;
