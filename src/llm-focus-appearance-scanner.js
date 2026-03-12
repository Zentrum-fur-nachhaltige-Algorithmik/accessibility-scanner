/**
 * LLM Focus Appearance Scanner
 *
 * Covers AAA focus criteria:
 * - 2.4.12 Focus Not Obscured (Enhanced) (AAA)
 * - 2.4.13 Focus Appearance (AAA)
 */

const LLMBaseScanner = require('./llm-base-scanner');

class LLMFocusAppearanceScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-focus-appearance', {
      wcagCriteria: ['2.4.12', '2.4.13'],
      wcagPrinciple: 'operable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const html = await this.extractRelevantHTML(page, 'html', 12000);

    // Also extract computed styles for focus indicators
    const focusStyles = await page.evaluate(() => {
      const results = [];
      const focusable = document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      for (const el of Array.from(focusable).slice(0, 20)) {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || '';
        const computed = window.getComputedStyle(el);
        results.push({
          tag,
          type,
          outline: computed.outline,
          outlineOffset: computed.outlineOffset,
          boxShadow: computed.boxShadow,
          border: computed.border,
        });
      }
      return results;
    });

    // Check for obscuring elements
    const obscuringElements = await page.evaluate(() => {
      const fixed = document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
      const results = [];
      for (const el of fixed) {
        const rect = el.getBoundingClientRect();
        const computed = window.getComputedStyle(el);
        results.push({
          tag: el.tagName.toLowerCase(),
          className: el.className,
          position: computed.position,
          zIndex: computed.zIndex,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        });
      }
      return results;
    });

    const prompt = `Check this HTML for WCAG 2.2 AAA focus criteria:

1. **2.4.12 Focus Not Obscured (Enhanced)**: At AAA level, NO PART of the focused element can be obscured by other content. Check for:
   - position:fixed/sticky elements that could cover focused elements
   - Cookie banners, floating toolbars, chat widgets overlapping focus
   - Popover menus or dropdowns that could cover nearby focusable elements

Fixed/sticky elements found: ${JSON.stringify(obscuringElements)}

2. **2.4.13 Focus Appearance**: Focus indicators must:
   - Have an area of at least a 2px thick perimeter of the unfocused element
   - Have contrast ratio of at least 3:1 between focused and unfocused states
   - Have contrast ratio of at least 3:1 against adjacent colors

Focus styles found on interactive elements: ${JSON.stringify(focusStyles)}

HTML being analyzed:
Check for CSS that removes or minimizes focus indicators (outline: none, outline: 0, :focus { outline: none }).

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
        criteriaChecked: ['2.4.12', '2.4.13'],
        focusableElementsChecked: focusStyles.length,
        obscuringElements: obscuringElements.length,
      },
    };
  }
}

module.exports = LLMFocusAppearanceScanner;
