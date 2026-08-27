/**
 * LLM Semantic Text Scanner
 * Covers 3.1.3 Unusual Words, 3.1.4 Abbreviations, 3.1.6 Pronunciation, 2.4.9 Link
 * Purpose (Link Only), 2.4.10 Section Headings and 1.3.6 Identify Purpose (all AAA).
 */

const LLMBaseScanner = require('./base');

class LLMSemanticTextScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-semantic-text',
      {
        wcagCriteria: ['3.1.3', '3.1.4', '3.1.6', '2.4.9', '2.4.10', '1.3.6'],
        wcagPrinciple: 'understandable',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    const prompt = `Check this HTML for these WCAG 2.2 AAA criteria. Be STRICT about real violations but do NOT flag false positives.

1. **3.1.3 Unusual Words**: Are domain-specific jargon, idioms, or technical terms used WITHOUT a definition mechanism (<dfn>, glossary link, title attribute)? Only flag terms that a general audience would not understand. Do NOT flag common tech terms like "API", "URL", "PDF", "FAQ": these are universally understood.

2. **3.1.4 Abbreviations**: Are abbreviations used WITHOUT <abbr title="..."> on at least their first occurrence? Do NOT flag universally known abbreviations (FAQ, PDF, URL, HTML, CSS, API). Only flag domain-specific or uncommon abbreviations.

3. **3.1.6 Pronunciation**: Are there words where pronunciation is ambiguous AND affects meaning (e.g., "lead" metal vs. verb, "read" past vs present) without disambiguation? This is rare: only flag clear cases.

4. **2.4.9 Link Purpose (Link Only)**: Can each link's purpose be determined from the link text ALONE? Flag only truly ambiguous links like "click here", "read more", "learn more", "here", "more info". Do NOT flag links with descriptive text like "View product details", "Download annual report", "Read customer reviews", "Purchase Widget Pro", etc.: these ARE descriptive enough. Single well-known words like "FAQ", "Help", "Home" are also acceptable.

5. **2.4.10 Section Headings**: Does each major content section have a heading? Only flag sections with substantial content (multiple paragraphs or complex content) that lack any heading. Do NOT flag small utility sections (footers, nav bars).

6. **1.3.6 Identify Purpose**: Do key UI regions use landmark roles (header/banner, nav/navigation, main, footer/contentinfo)? Do interactive icons have aria-label or visible text? Only flag pages that are clearly missing basic landmark structure.

IMPORTANT: Err on the side of NOT flagging. Only report clear, unambiguous violations. If an element is borderline compliant, do NOT report it.

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
        criteriaChecked: ['3.1.3', '3.1.4', '3.1.6', '2.4.9', '2.4.10', '1.3.6'],
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMSemanticTextScanner;
