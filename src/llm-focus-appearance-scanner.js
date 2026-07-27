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
    // Focus each focusable element and read its FOCUSED-state computed
    // style, paired with the unfocused baseline for the same element, so
    // the LLM can diff them directly instead of receiving only the resting
    // state (where outline is trivially "none" and :focus rules never fire).
    const focusStyles = await page.evaluate(() => {
      const results = [];
      const focusable = document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      for (const el of Array.from(focusable).slice(0, 20)) {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || '';

        const unfocusedComputed = window.getComputedStyle(el);
        const unfocused = {
          outline: unfocusedComputed.outline,
          outlineOffset: unfocusedComputed.outlineOffset,
          boxShadow: unfocusedComputed.boxShadow,
          border: unfocusedComputed.border,
        };

        let focused = unfocused;
        try {
          el.focus();
          const focusedComputed = window.getComputedStyle(el);
          focused = {
            outline: focusedComputed.outline,
            outlineOffset: focusedComputed.outlineOffset,
            boxShadow: focusedComputed.boxShadow,
            border: focusedComputed.border,
          };
        } catch {
          // Element could not receive focus (disabled/detached) — fall back
          // to the unfocused snapshot for both.
        } finally {
          el.blur();
        }

        results.push({ tag, type, unfocused, focused });
      }
      return results;
    });

    // Detect obscuring elements via computed position (catches class-based
    // and stylesheet-based fixed/sticky elements, not just inline styles).
    // Bounded to avoid pathological pages with huge DOMs.
    const obscuringElements = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      const limit = Math.min(all.length, 2000);
      const results = [];
      for (let i = 0; i < limit; i++) {
        const el = all[i];
        const computed = window.getComputedStyle(el);
        if (computed.position === 'fixed' || computed.position === 'sticky') {
          const rect = el.getBoundingClientRect();
          results.push({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className : '',
            position: computed.position,
            zIndex: computed.zIndex,
            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          });
        }
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

Each entry below shows FOCUSED-state computed styles (the element was actually focused via el.focus() before these were read, so they reflect real :focus/:focus-visible CSS) alongside the UNFOCUSED baseline for the same element — compare the two to see what actually changes on focus: ${JSON.stringify(focusStyles)}

HTML being analyzed:
Check for CSS that removes or minimizes focus indicators (outline: none, outline: 0, :focus { outline: none }).

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
        criteriaChecked: ['2.4.12', '2.4.13'],
        focusableElementsChecked: focusStyles.length,
        obscuringElements: obscuringElements.length,
        analyzedFraction: ctx.analyzedFraction,
        rawChars: ctx.rawChars,
        skeletonChars: ctx.skeletonChars,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }
}

module.exports = LLMFocusAppearanceScanner;
