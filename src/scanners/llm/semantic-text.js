/**
 * LLM Semantic Text Scanner
 * Covers 3.1.3 Unusual Words, 3.1.4 Abbreviations and 2.4.10 Section Headings
 * (all AAA) as page-level judgement: every finding is a question for a reviewer.
 *
 * 3.1.6 Pronunciation is manual (the page carries no signal a reader could
 * decide it from), 2.4.9 Link Purpose is measured by page-structure, and 1.3.6
 * Identify Purpose asks for personalization semantics this prompt never
 * measured; all three are no longer claimed here.
 */

const LLMBaseScanner = require('./base');

class LLMSemanticTextScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-semantic-text',
      {
        wcagCriteria: ['3.1.3', '3.1.4', '2.4.10'],
        wcagPrinciple: 'understandable',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    const prompt = `Judge this page's text against these WCAG 2.2 AAA criteria. Everything you report becomes a question for a human reviewer, never an automatic failure.

1. **3.1.3 Unusual Words**: Are domain-specific jargon, idioms, or technical terms used WITHOUT a definition mechanism (<dfn>, glossary link, title attribute)? Only flag terms that a general audience would not understand. Do NOT flag common tech terms like "API", "URL", "PDF", "FAQ": these are universally understood.

2. **3.1.4 Abbreviations**: Are abbreviations used WITHOUT <abbr title="..."> on at least their first occurrence? Do NOT flag universally known abbreviations (FAQ, PDF, URL, HTML, CSS, API). Only flag domain-specific or uncommon abbreviations.

3. **2.4.10 Section Headings**: Is each section of content organised under a heading that names it? Ask about a section of content whose topic changes without a heading to announce it. Do NOT ask about utility sections (footers, nav bars) or about how much text a section holds.

IMPORTANT: Err on the side of NOT asking. Only report clear, evidenced cases. If an element is borderline compliant, do NOT report it.

Return violations as JSON.`;

    const { violations: raw, summary: ctx } = await this.analyzePageChunked(page, prompt);
    const described = await this.describeElements(
      page,
      raw.map((v) => v && v.selector)
    );
    const needsReview = this.convertViolations(raw, {
      model: ctx.llmModel,
      bySelector: Object.fromEntries(
        Object.entries(described).map(([selector, element]) => [selector, { element }])
      ),
    });

    return this.reviewResult(needsReview, {
      llmModel: ctx.llmModel || 'unknown',
      criteriaChecked: ['3.1.3', '3.1.4', '2.4.10'],
      analyzedFraction: ctx.analyzedFraction,
      rawChars: ctx.rawChars,
      skeletonChars: ctx.skeletonChars,
      chunkCount: ctx.chunkCount,
      truncated: ctx.truncated,
    });
  }
}

module.exports = LLMSemanticTextScanner;
