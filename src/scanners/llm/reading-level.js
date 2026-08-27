/**
 * LLM Reading Level Scanner
 * Covers 3.1.5 Reading Level (Level AAA).
 * Checks that content does not exceed lower secondary reading level or that a
 * simplified version exists. EN uses Flesch, DE uses Wiener Sachtextformel.
 */

const LLMBaseScanner = require('./base');

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
    // Pre-check: extract prose text and simplification mechanisms
    const textData = await page.evaluate(() => {
      const main = document.querySelector('main, [role="main"]') || document.body;
      const clone = main.cloneNode(true);

      // Strip non-content elements
      clone
        .querySelectorAll(
          'nav, header, footer, script, style, noscript, ' +
            '[role="navigation"], [role="banner"], [role="contentinfo"]'
        )
        .forEach((el) => el.remove());

      const text = clone.textContent.replace(/\s+/g, ' ').trim();
      const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      const avgWordsPerSentence =
        sentences.length > 0 ? Math.round(words.length / sentences.length) : 0;

      // Detect simplification mechanisms
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

      // Sample longest paragraphs (most likely to have readability issues)
      const paragraphs = Array.from(clone.querySelectorAll('p, article, section > div'))
        .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 100)
        .sort((a, b) => b.length - a.length)
        .slice(0, 5);

      // Detect page language
      const lang = document.documentElement.lang || '';

      return {
        totalWords: words.length,
        totalSentences: sentences.length,
        avgWordsPerSentence,
        hasGlossary,
        hasSimplifiedVersion,
        hasSummary,
        hasDefinitions,
        longestParagraphs: paragraphs,
        lang,
      };
    });

    // Short-circuit: too little content to assess
    if (textData.totalWords < 50) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: {
          totalIssues: 0,
          note: 'Insufficient text content to assess reading level',
        },
      };
    }

    const prompt = `Check this HTML for WCAG 2.2 criterion 3.1.5 (Reading Level, Level AAA).

This criterion requires that when text requires reading ability more advanced than lower secondary education level (approximately grade 7-9 / age 12-15), a supplemental version is provided that does not require advanced reading ability.

**Page language:** ${textData.lang || 'not specified'}

**Pre-analysis data:**
- Total words: ${textData.totalWords}
- Total sentences: ${textData.totalSentences}
- Average words per sentence: ${textData.avgWordsPerSentence}
- Glossary present: ${textData.hasGlossary}
- Simplified/plain-language version present: ${textData.hasSimplifiedVersion}
- Summary section present: ${textData.hasSummary}
- Definitions (<dfn>, <abbr title>) present: ${textData.hasDefinitions}

**Sample of densest paragraphs:**
${textData.longestParagraphs.map((p, i) => `[Paragraph ${i + 1}]: ${p.slice(0, 500)}`).join('\n\n')}

**Readability assessment guidelines (language-specific):**
- For English text: Flesch Reading Ease below 50 or Flesch-Kincaid Grade Level above 9 indicates advanced reading level.
- For German text: Wiener Sachtextformel (WSTF) above 10 or Flesch-DE below 40 indicates advanced reading level. Long compound words (Bandwurmwörter), deeply nested subclauses, and nominalization-heavy style are strong indicators.
- For other languages: assess sentence complexity, jargon density, and clause nesting relative to secondary education level.

**Indicators of advanced reading level** (flag only if MULTIPLE are present AND no simplification mechanism exists):
- Dense academic, legal, medical, financial, or technical jargon throughout the main content
- Average sentence length well above 25 words
- Complex nested sentence structures with multiple subordinate clauses
- Extensive domain-specific terminology without definitions
- Passive voice and nominalizations dominating the text

**A page PASSES 3.1.5 if ANY of the following are true:**
- The main content text is written at or below lower secondary education level
- A simplified or plain-language version is provided alongside complex text (e.g., a "Simple version" / "Einfache Sprache" section, a <details> with plain language, a glossary, or a toggle/link to a simplified version)
- The content provides glossary terms, definitions (<dfn>), <abbr> with titles, or explanatory sections alongside complex text
- The text is primarily proper names, titles, or unavoidable technical terms for the subject matter

**Do NOT flag:**
- Navigation text, button labels, or UI chrome
- Content that is already at an appropriate reading level
- Complex text that has an accompanying simplified version, glossary, or summary
- Short snippets of complex text within otherwise simple content
- Technical documentation aimed at professionals that provides adequate definitions

CRITICAL: Only flag pages where the PRIMARY content is clearly above secondary education reading level AND no simplification mechanism whatsoever is provided. If there is a glossary, summary, plain-language alternative, or definition list, the page PASSES even if complex text is present.

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
        criteriaChecked: ['3.1.5'],
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
        textStats: {
          totalWords: textData.totalWords,
          avgWordsPerSentence: textData.avgWordsPerSentence,
          lang: textData.lang,
        },
        simplificationMechanisms: {
          glossary: textData.hasGlossary,
          simplifiedVersion: textData.hasSimplifiedVersion,
          summary: textData.hasSummary,
          definitions: textData.hasDefinitions,
        },
      },
    };
  }
}

module.exports = LLMReadingLevelScanner;
