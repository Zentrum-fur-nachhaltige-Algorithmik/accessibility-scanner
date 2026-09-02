/**
 * LLM Focus Appearance Scanner
 * Covers 2.4.12 Focus Not Obscured (Enhanced) and 2.4.13 Focus Appearance (AAA).
 * Focus states come from a real keyboard tab walk plus a per-element hit test;
 * findings become needs-review questions carrying that measurement, and a
 * 2.4.13 question is rejected in code when the indicator measures as sufficient.
 */

const LLMBaseScanner = require('./base');
const { tabWalk, cleanupTabWalk, TAB_ATTR } = require('../../utils/keyboard-focus');

/** Tab stops to inspect. Enough to cover a page's chrome + main content. */
const MAX_TAB_STOPS = 25;

/** WCAG 2.4.13 minimum indicator thickness (perimeter of 2 CSS px). */
const MIN_INDICATOR_PX = 2;

/** WCAG 2.4.13 / 1.4.11 minimum indicator contrast. */
const MIN_INDICATOR_CONTRAST = 3;

/** Claims the code guard rejects when the measurement contradicts them. */
const MISSING_INDICATOR_CLAIM =
  /(no|missing|lack|without|absent|removed|invisible|not visible|insufficient|inadequate|too (thin|small|weak))[^.]{0,40}(focus|outline|indicator|ring)|focus[^.]{0,30}(indicator|ring|outline)[^.]{0,40}(missing|absent|removed|not (visible|present)|none)|outline:?\s*(none|0)|kein[a-z]*\s+fokus/i;

class LLMFocusAppearanceScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-focus-appearance',
      {
        wcagCriteria: ['2.4.12', '2.4.13'],
        wcagPrinciple: 'operable',
      },
      llmClient
    );
  }

  /**
   * Walk the page with real Tab presses and, for every stop, record
   *   - the unfocused/focused computed-style diff and the resulting indicator
   *     decision (`__a11yIndicator`, i.e. the shared hasVisibleFocusIndicator
   *     logic incl. the 3:1 outline contrast check), and
   *   - a computed occlusion hit test of the focused element.
   *
   * @returns {Promise<{stops: Object[], truncated: boolean}>}
   */
  async collectFocusContext(page) {
    const stops = [];
    let truncated = false;

    try {
      for await (const step of tabWalk(page, { maxSteps: MAX_TAB_STOPS, settleMs: 80 })) {
        if (step.stuck) break;
        if (!step.rendered) continue;

        const occlusion = await this.measureOcclusion(page, step.tabId);
        const ind = step.indicator || {};
        const width = parseFloat(step.after && step.after.outlineWidth) || 0;

        stops.push({
          selector: step.selector,
          tag: step.tag,
          text: step.text,
          // Measured focus indicator (keyboard focus → :focus-visible applies).
          indicatorVisible: !!ind.visible,
          indicatorReasons: ind.reasons || [],
          outline: ind.outline || null,
          outlineWidthPx: width,
          indicatorContrast: ind.ratio == null ? null : Math.round(ind.ratio * 100) / 100,
          lowContrastIndicator: !!ind.lowContrast,
          obscured: occlusion,
        });

        if (stops.length >= MAX_TAB_STOPS) {
          truncated = true;
          break;
        }
      }
    } finally {
      await cleanupTabWalk(page);
    }

    return { stops, truncated };
  }

  /**
   * Hit-test the focused element at 9 points. A coverer only counts when it is
   * (or sits inside) a fixed/sticky box that is NOT an ancestor of the element:
   * an element is never obscured by its own ancestor.
   */
  async measureOcclusion(page, tabId) {
    return page.evaluate(
      (ATTR, id) => {
        const el = document.querySelector(`[${ATTR}="${CSS.escape(id)}"]`);
        if (!el) return { measured: false };
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { measured: false };
        const inset = Math.min(2, r.width / 4, r.height / 4);
        const xs = [r.left + inset, r.left + r.width / 2, r.right - inset];
        const ys = [r.top + inset, r.top + r.height / 2, r.bottom - inset];
        const vw = window.innerWidth,
          vh = window.innerHeight;
        let sampled = 0,
          covered = 0,
          coverer = null,
          position = null;

        for (const x of xs) {
          for (const y of ys) {
            if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
            sampled++;
            const hit = document.elementFromPoint(x, y);
            if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
            let n = hit,
              overlay = null;
            while (n && n !== document.body) {
              const pos = window.getComputedStyle(n).position;
              // `n.contains(el)` → n is an ancestor of the focused element and
              // therefore cannot obscure it.
              if ((pos === 'fixed' || pos === 'sticky') && !n.contains(el)) {
                overlay = n;
                break;
              }
              n = n.parentElement;
            }
            if (!overlay) continue;
            covered++;
            if (!coverer) {
              position = window.getComputedStyle(overlay).position;
              const cls =
                typeof overlay.className === 'string' && overlay.className.trim()
                  ? '.' + overlay.className.trim().split(/\s+/)[0]
                  : '';
              coverer = overlay.tagName.toLowerCase() + (overlay.id ? '#' + overlay.id : '') + cls;
            }
          }
        }
        return {
          measured: true,
          sampledPoints: sampled,
          coveredPoints: covered,
          // 2.4.12 (AAA) fails when ANY part is hidden; 2.4.11 (AA) only when all is.
          anyPartObscured: covered > 0,
          entirelyObscured: sampled > 0 && covered === sampled,
          coveredBy: coverer,
          covererPosition: position,
        };
      },
      TAB_ATTR,
      String(tabId)
    );
  }

  /**
   * Code guard: what the measurement already decides, the model may not
   * contradict. Returns the facts plus the rejection predicates.
   */
  evaluateGuards(stops, truncated = false) {
    // Page-global guards need the WHOLE tab order measured; a walk cut off at
    // MAX_TAB_STOPS leaves unmeasured elements, so only per-element guards apply.
    const complete = !truncated;
    const withIndicator = stops.filter((s) => s.indicatorVisible);
    const strongOutline = stops.filter((s) => this.isCompliantStop(s));

    return {
      stops,
      tabStops: stops.length,
      // Every tab stop has a keyboard-focus indicator that is thick enough and
      // contrasty enough → 2.4.13 cannot fail for a missing/weak indicator.
      allIndicatorsCompliant: complete && stops.length > 0 && strongOutline.length === stops.length,
      allIndicatorsVisible: complete && stops.length > 0 && withIndicator.length === stops.length,
      indicatorsMissing: stops.filter((s) => !s.indicatorVisible).map((s) => s.selector),
      lowContrastIndicators: stops.filter((s) => s.lowContrastIndicator).map((s) => s.selector),
      minIndicatorContrast: stops.reduce(
        (m, s) =>
          s.indicatorContrast == null
            ? m
            : m == null
              ? s.indicatorContrast
              : Math.min(m, s.indicatorContrast),
        null
      ),
      // No tab stop is covered anywhere → 2.4.12 cannot fail.
      noneObscured:
        complete &&
        stops.length > 0 &&
        stops.every((s) => !(s.obscured && s.obscured.anyPartObscured)),
      obscuredStops: stops
        .filter((s) => s.obscured && s.obscured.anyPartObscured)
        .map((s) => ({
          selector: s.selector,
          coveredBy: s.obscured.coveredBy,
          points: `${s.obscured.coveredPoints}/${s.obscured.sampledPoints}`,
        })),
    };
  }

  buildPrompt(stops, guards) {
    const facts = [];
    if (guards.allIndicatorsCompliant) {
      facts.push(
        `VERIFIED BY MEASUREMENT: all ${guards.tabStops} keyboard tab stops on this page show a focus indicator of at least ${MIN_INDICATOR_PX}px with at least ${MIN_INDICATOR_CONTRAST}:1 contrast` +
          (guards.minIndicatorContrast != null
            ? ` (lowest measured ratio ${guards.minIndicatorContrast}:1)`
            : '') +
          `. Do NOT report a missing, removed, weak or insufficient focus indicator: such a finding would be false and will be rejected.`
      );
    } else if (guards.allIndicatorsVisible) {
      facts.push(
        `VERIFIED BY MEASUREMENT: every keyboard tab stop shows a visible focus indicator. Only its thickness/contrast can be at issue, never its absence.`
      );
    }
    if (guards.noneObscured) {
      facts.push(
        `VERIFIED BY MEASUREMENT: no tab stop was covered by any fixed/sticky element (hit-tested at 9 points per element while actually focused). Do NOT report 2.4.12 obscuring.`
      );
    } else if (guards.obscuredStops.length) {
      facts.push(
        `MEASURED obscuring (element : coverer : covered sample points): ${guards.obscuredStops.map((o) => `${o.selector} : ${o.coveredBy} : ${o.points}`).join('; ')}`
      );
    }

    return `Check this page for WCAG 2.2 AAA focus criteria. Report ONLY 2.4.12 and 2.4.13.

The data below was MEASURED in a real browser by pressing Tab (so \`:focus-visible\` rules applied) and hit-testing each focused element. It overrides anything the HTML or CSS text may suggest: never infer a focus problem from a stylesheet rule when the measurement for that element says otherwise.

${facts.length ? facts.join('\n') + '\n' : ''}
1. **2.4.12 Focus Not Obscured (Enhanced)**: no part of the focused element may be hidden by author content. Judge this ONLY from the \`obscured\` measurement of each tab stop below (\`anyPartObscured: true\` + \`coveredBy\`). An element is never obscured by one of its own ancestors, and elements that are not covered in the measurement are not violations.

2. **2.4.13 Focus Appearance**: the indicator must be at least a ${MIN_INDICATOR_PX}px thick perimeter and reach ${MIN_INDICATOR_CONTRAST}:1 against adjacent colours. Judge this ONLY from \`indicatorVisible\`, \`outline\`, \`outlineWidthPx\` and \`indicatorContrast\` below. \`indicatorVisible: true\` means the focused/unfocused computed-style diff proved an indicator exists.

Measured keyboard tab stops (focused state):
${JSON.stringify(stops)}

Everything you report becomes a question for a human reviewer, never an automatic failure.

Return violations as JSON; return an empty array when the measurements show no failure.`;
  }

  async scan(page, options = {}) {
    const { stops, truncated } = await this.collectFocusContext(page);
    const guards = this.evaluateGuards(stops, truncated);

    // Nothing keyboard-reachable → neither criterion can be evaluated, and no
    // LLM call is worth paying for.
    if (stops.length === 0) {
      return this.reviewResult([], {
        llmModel: 'not-called',
        criteriaChecked: ['2.4.12', '2.4.13'],
        tabStops: 0,
        skippedReason: 'no keyboard-reachable elements',
      });
    }

    const prompt = this.buildPrompt(stops, guards);
    const { violations: raw, summary: ctx } = await this.analyzePageChunked(page, prompt);
    const converted = this.convertViolations(raw, {
      model: ctx.llmModel,
      measurements: { tabStops: stops.length, tabStopsTruncated: truncated },
      bySelector: this._dossierData(stops),
    });

    // Code guard: drop questions the measurement already answered.
    const needsReview = [];
    const rejected = [];
    for (const v of converted) {
      const reason = this.rejectionReason(v, guards);
      if (reason) rejected.push({ ruleId: v.ruleId, description: v.description, reason });
      else needsReview.push(v);
    }

    return this.reviewResult(needsReview, {
      llmModel: ctx.llmModel || 'unknown',
      criteriaChecked: ['2.4.12', '2.4.13'],
      wcagLevel: 'AAA',
      tabStops: stops.length,
      tabStopsTruncated: truncated,
      allIndicatorsCompliant: guards.allIndicatorsCompliant,
      minIndicatorContrast: guards.minIndicatorContrast,
      obscuredStops: guards.obscuredStops.length,
      guardRejected: rejected.length,
      guardRejectedDetails: rejected,
      analyzedFraction: ctx.analyzedFraction,
      rawChars: ctx.rawChars,
      skeletonChars: ctx.skeletonChars,
      chunkCount: ctx.chunkCount,
      truncated: ctx.truncated,
    });
  }

  /** selector -> the tab stop's own measured focus state, for its dossier. */
  _dossierData(stops) {
    const out = {};
    for (const s of stops) {
      out[s.selector] = {
        element: { html: null, role: null, name: s.text || null },
        measurements: {
          tag: s.tag,
          indicatorVisible: s.indicatorVisible,
          outline: s.outline,
          outlineWidthPx: s.outlineWidthPx,
          indicatorContrast: s.indicatorContrast,
          lowContrastIndicator: s.lowContrastIndicator,
          obscuredPoints: s.obscured
            ? `${s.obscured.coveredPoints ?? 0}/${s.obscured.sampledPoints ?? 0}`
            : null,
          obscuredBy: s.obscured ? s.obscured.coveredBy : null,
        },
      };
    }
    return out;
  }

  /**
   * Find the measured tab stops a violation is talking about. Matching is by
   * the last simple selector the model quoted (`.menu-btn`, `button.menu-btn`,
   * `#id`) because the model rewrites the long descendant selectors.
   *
   * @returns {Object[]} matched stops (empty when the citation is unusable)
   */
  matchStops(v, stops) {
    const cited = [];
    for (const n of v.nodes || []) if (n && n.selector) cited.push(String(n.selector));
    // Selectors quoted inside the prose, e.g. "the `.menu-btn` element".
    for (const m of String(v.description || '').matchAll(/[.#][A-Za-z_][\w-]{2,}/g))
      cited.push(m[0]);
    if (cited.length === 0) return [];

    const keys = new Set();
    for (const c of cited) {
      const last =
        c
          .trim()
          .split(/[\s>+~]+/)
          .pop() || '';
      for (const m of last.matchAll(/[.#][A-Za-z_][\w-]*/g)) keys.add(m[0]);
    }
    if (keys.size === 0) return [];
    return stops.filter((s) => [...keys].some((k) => s.selector.includes(k)));
  }

  /**
   * @returns {string|null} why the finding is rejected, or null to keep it.
   */
  rejectionReason(v, guards) {
    const text = `${v.description || ''} ${(v.nodes || []).map((n) => n.selector || '').join(' ')}`;
    const criterion = v.ruleId;
    const stops = guards.stops || [];
    const matched = this.matchStops(v, stops);

    if (criterion === '2.4.13' && MISSING_INDICATOR_CLAIM.test(text)) {
      if (guards.allIndicatorsCompliant) {
        return (
          `measured: all ${guards.tabStops} tab stops have a >=${MIN_INDICATOR_PX}px indicator at >=${MIN_INDICATOR_CONTRAST}:1` +
          (guards.minIndicatorContrast != null ? ` (min ${guards.minIndicatorContrast}:1)` : '')
        );
      }
      // Per-element guard: the page as a whole may fail, but THIS element's
      // indicator was measured under real keyboard focus and is compliant.
      if (matched.length > 0 && matched.every((s) => this.isCompliantStop(s))) {
        const s = matched[0];
        return (
          `measured under real keyboard focus: ${s.selector} shows ${s.outline}` +
          (s.indicatorContrast != null ? ` at ${s.indicatorContrast}:1` : '')
        );
      }
    }

    if (
      criterion === '2.4.13' &&
      guards.allIndicatorsVisible &&
      /missing|absent|removed|no (visible )?focus|not visible|outline:?\s*(none|0)/i.test(text)
    ) {
      return 'measured: every tab stop showed a visible focus indicator under real keyboard focus';
    }

    if (criterion === '2.4.12') {
      if (guards.noneObscured) {
        return 'measured: no tab stop was covered by a fixed/sticky element (9-point hit test, ancestors excluded)';
      }
      if (matched.length > 0 && matched.every((s) => !(s.obscured && s.obscured.anyPartObscured))) {
        return `measured: ${matched[0].selector} was not covered at any of its ${matched[0].obscured.sampledPoints || 0} sampled points while focused`;
      }
    }

    return null;
  }

  /** A tab stop whose measured indicator satisfies 2.4.13 on its own. */
  isCompliantStop(s) {
    return (
      !!s.indicatorVisible &&
      (s.outlineWidthPx >= MIN_INDICATOR_PX ||
        (s.indicatorReasons || []).includes('outline-auto')) &&
      (s.indicatorContrast == null || s.indicatorContrast >= MIN_INDICATOR_CONTRAST)
    );
  }
}

module.exports = LLMFocusAppearanceScanner;
