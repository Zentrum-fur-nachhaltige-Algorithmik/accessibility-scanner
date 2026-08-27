/**
 * LLM axe-incomplete Result Reviewer
 * Reviews axe-core's `incomplete` bucket; criteria are those of the reviewed rules.
 * Re-runs axe itself, builds a per-node evidence dossier, and asks the LLM for
 * a fail / pass / still-uncertain verdict per node.
 */

const LLMBaseScanner = require('./base');
const { AxePuppeteer } = require('@axe-core/puppeteer');
const { injectableCode: contrastCode } = require('../../utils/browser-contrast');
const log = require('../../utils/logger').createLogger('llm-incomplete-reviewer');

/** Cost/latency guards. */
const MAX_NODES = 24; // hard cap on reviewed nodes per page
const BATCH_SIZE = 6; // nodes per LLM call
const MAX_HTML_CHARS = 700;

/**
 * axe rules worth reviewing, with the extra computed evidence each one needs.
 * Anything not listed is left as `info` untouched: an LLM verdict on a rule
 * without designed evidence extraction would be a guess.
 */
const REVIEWABLE_RULES = {
  'color-contrast': { evidence: 'contrast' },
  'color-contrast-enhanced': { evidence: 'contrast' },
  'link-in-text-block': { evidence: 'linkDistinction' },
  'aria-required-children': { evidence: 'subtree' },
  'aria-required-parent': { evidence: 'ancestry' },
  'scrollable-region-focusable': { evidence: 'scrollable' },
  'nested-interactive': { evidence: 'subtree' },
  'label-content-name-mismatch': { evidence: 'nameAndText' },
  'aria-allowed-attr': { evidence: 'attributes' },
  'aria-valid-attr-value': { evidence: 'attributes' },
  'presentation-role-conflict': { evidence: 'attributes' },
  'frame-tested': { evidence: 'attributes' },
};

class LLMIncompleteReviewerScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super(
      'llm-incomplete-reviewer',
      {
        // Populated per-run from the reviewed axe rules' own WCAG tags.
        wcagCriteria: [],
        wcagPrinciple: 'robust',
      },
      llmClient
    );
  }

  async scan(page, options = {}) {
    const incomplete = await this._collectIncomplete(page);

    const reviewable = [];
    for (const rule of incomplete) {
      if (!REVIEWABLE_RULES[rule.id]) continue;
      for (const node of rule.nodes || []) {
        reviewable.push({ rule, node });
      }
    }

    if (reviewable.length === 0) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: {
          totalIssues: 0,
          incompleteRules: incomplete.length,
          incompleteNodes: incomplete.reduce((n, r) => n + (r.nodes || []).length, 0),
          reviewedNodes: 0,
          suppressed: [],
          criteriaChecked: [],
        },
      };
    }

    const capped = reviewable.slice(0, MAX_NODES);
    const allDossiers = await this._buildDossiers(page, capped);

    const violations = [];
    const suppressed = [];
    const uncertain = [];
    const criteriaSeen = new Set();
    let llmModel = 'unknown';
    let failedBatches = 0;
    let decidedInCode = 0;

    // Gradient backgrounds are decided arithmetically, never by the model:
    // an LLM "estimating" a gradient's contrast produces false positives.
    // min ratio passes → pass; max ratio fails → fail;
    // anything in between stays uncertain.
    const dossiers = [];
    for (const d of allDossiers) {
      const g = d.measured && d.measured.contrast && d.measured.contrast.gradientRatio;
      const hasGradient =
        d.measured && d.measured.contrast && d.measured.contrast.hasBackgroundImageInChain;
      if (d.evidenceKind !== 'contrast' || !hasGradient) {
        dossiers.push(d);
        continue;
      }
      decidedInCode++;
      const criteria = this._criteriaFor(d.tags);
      criteria.forEach((c) => criteriaSeen.add(c));
      const enhanced = d.axeRuleId === 'color-contrast-enhanced';
      const large = !!d.measured.contrast.largeText;
      const threshold = enhanced ? (large ? 4.5 : 7) : large ? 3 : 4.5;
      const common = {
        scannerId: this.id,
        ruleId: d.axeRuleId,
        nodes: [{ selector: d.selector }],
        helpUrl: d.helpUrl,
        wcagCriteria: criteria,
        source: 'llm-incomplete-reviewer',
        reviewedAxeRule: d.axeRuleId,
        reviewedSelector: d.selector,
      };
      if (g && g.min >= threshold) {
        suppressed.push({
          axeRuleId: d.axeRuleId,
          selector: d.selector,
          reason: `gradient background: worst-stop contrast ${g.min}:1 >= ${threshold}:1 (computed, ${g.stops} stops)`,
        });
      } else if (g && g.max < threshold) {
        violations.push({
          ...common,
          impact: d.impact || 'moderate',
          severity: 'violation',
          confidence: 'high',
          description:
            `${d.help}: text colour ${d.measured.contrast.color} against every stop of the gradient ` +
            `background is below ${threshold}:1 (best stop ${g.max}:1, computed).`,
        });
      } else {
        uncertain.push({ axeRuleId: d.axeRuleId, selector: d.selector });
        violations.push({
          ...common,
          impact: 'minor',
          severity: 'info',
          confidence: 'low',
          description:
            `[Needs human review] ${d.help}: gradient/image background` +
            (g
              ? ` (contrast ranges ${g.min}:1 to ${g.max}:1 across stops, threshold ${threshold}:1)`
              : ' could not be resolved') +
            '.',
        });
      }
    }

    for (let i = 0; i < dossiers.length; i += BATCH_SIZE) {
      const batch = dossiers.slice(i, i + BATCH_SIZE);
      let parsed;
      try {
        parsed = await this.analyzeWithLLM(
          this._renderBatch(batch),
          this._instructions(),
          SYSTEM_PROMPT
        );
      } catch (e) {
        failedBatches++;
        log.warn(`${this.id}: batch ${i / BATCH_SIZE + 1} failed: ${e.message}`);
        continue;
      }
      llmModel = parsed.model || llmModel;

      const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
      const byRef = new Map();
      for (const v of verdicts) {
        if (v && typeof v.ref !== 'undefined') byRef.set(String(v.ref), v);
      }

      for (const d of batch) {
        const verdict = byRef.get(String(d.ref));
        // No verdict returned for a node → treat as still-uncertain. Never
        // invent a "pass": a missing answer must not silently clear a finding.
        const decision = (verdict?.verdict || 'still-uncertain').toLowerCase();
        const evidence = String(verdict?.evidence || '').trim();
        const criteria = this._criteriaFor(d.tags);
        criteria.forEach((c) => criteriaSeen.add(c));

        if (decision === 'fail' && evidence) {
          violations.push({
            scannerId: this.id,
            ruleId: d.axeRuleId,
            impact: d.impact || 'moderate',
            severity: 'violation',
            description:
              `${d.help}: confirmed by review of the element axe-core could not ` +
              `decide. Evidence: ${evidence}`,
            nodes: [{ selector: d.selector }],
            helpUrl: d.helpUrl,
            wcagCriteria: criteria,
            source: 'llm-incomplete-reviewer',
            confidence: 'medium',
            reviewedAxeRule: d.axeRuleId,
            reviewedSelector: d.selector,
          });
        } else if (decision === 'pass' && evidence) {
          suppressed.push({
            axeRuleId: d.axeRuleId,
            selector: d.selector,
            reason: evidence,
          });
        } else {
          uncertain.push({ axeRuleId: d.axeRuleId, selector: d.selector });
          violations.push({
            scannerId: this.id,
            ruleId: d.axeRuleId,
            impact: 'minor',
            severity: 'info',
            description:
              `[Needs human review] ${d.help}: automated review could not decide` +
              (evidence ? `: ${evidence}` : '.'),
            nodes: [{ selector: d.selector }],
            helpUrl: d.helpUrl,
            wcagCriteria: criteria,
            source: 'llm-incomplete-reviewer',
            confidence: 'low',
            reviewedAxeRule: d.axeRuleId,
            reviewedSelector: d.selector,
          });
        }
      }
    }

    return {
      scannerId: this.id,
      passed: violations.filter((v) => v.severity !== 'info').length === 0,
      violations,
      summary: {
        totalIssues: violations.filter((v) => v.severity !== 'info').length,
        llmModel,
        incompleteRules: incomplete.length,
        incompleteNodes: reviewable.length,
        reviewedNodes: allDossiers.length,
        decidedInCode,
        cappedAt: reviewable.length > MAX_NODES ? MAX_NODES : null,
        promoted: violations.filter((v) => v.severity !== 'info').length,
        suppressed,
        stillUncertain: uncertain.length,
        failedBatches,
        criteriaChecked: [...criteriaSeen].sort(),
      },
    };
  }

  /** Map an axe rule's tags to bare WCAG SC numbers. */
  _criteriaFor(tags = []) {
    const out = [];
    for (const t of tags) {
      const m = t.match(/^wcag(\d)(\d)(\d+)$/);
      if (m) out.push(`${m[1]}.${m[2]}.${parseInt(m[3], 10)}`);
    }
    return out;
  }

  /**
   * Re-runs axe for the incomplete bucket instead of consuming the adapter's
   * output: concurrent scanners have no ordering or data channel between them.
   */
  async _collectIncomplete(page) {
    const results = await new AxePuppeteer(page)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .options({ resultTypes: ['incomplete'] })
      .analyze();
    return results.incomplete || [];
  }

  /**
   * Build one evidence dossier per node, in a single page.evaluate round trip.
   */
  async _buildDossiers(page, entries) {
    const requests = entries.map(({ rule, node }, i) => ({
      ref: i + 1,
      axeRuleId: rule.id,
      help: rule.help,
      helpUrl: rule.helpUrl,
      impact: node.impact || rule.impact || 'moderate',
      tags: rule.tags || [],
      evidenceKind: REVIEWABLE_RULES[rule.id].evidence,
      selector: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
      failureSummary: (node.failureSummary || '').slice(0, 400),
    }));

    const measured = await page.evaluate(
      (reqs, maxHtml, contrastCode) => {
        eval(contrastCode);
        const parseRgb = __parseRgb;
        const ratio = __getContrastRatio;
        /** Colour stops of linear-/radial-/conic-gradient() values (first layer only). */
        function gradientStops(bgImage) {
          if (!bgImage || !/gradient\(/.test(bgImage)) return [];
          const stops = [];
          const re =
            /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|\b(?:transparent|white|black|red|blue|green|gray|grey|silver|navy|teal|maroon|olive|purple|yellow|orange|aqua|fuchsia|lime)\b)/gi;
          let m;
          while ((m = re.exec(bgImage))) {
            const c = parseRgb(m[1].toLowerCase());
            if (c) stops.push(c);
          }
          return stops;
        }
        function bgChain(el) {
          const chain = [];
          let cur = el;
          while (cur && cur !== document.documentElement.parentElement) {
            const cs = getComputedStyle(cur);
            chain.push({
              tag: cur.tagName.toLowerCase(),
              backgroundColor: cs.backgroundColor,
              backgroundImage:
                cs.backgroundImage === 'none' ? null : cs.backgroundImage.slice(0, 120),
              backgroundImageFull: cs.backgroundImage === 'none' ? null : cs.backgroundImage,
              opacity: cs.opacity,
            });
            if (chain.length >= 6) break;
            cur = cur.parentElement;
          }
          return chain;
        }
        function openTag(el) {
          if (!el) return null;
          const attrs = [...el.attributes]
            .map((a) => `${a.name}="${String(a.value).slice(0, 80)}"`)
            .join(' ');
          return `<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`;
        }

        return reqs.map((req) => {
          let el = null;
          try {
            el = document.querySelector(req.selector);
          } catch {
            /* selector not resolvable from this frame */
          }

          if (!el) {
            return { ref: req.ref, resolved: false };
          }

          const cs = getComputedStyle(el);
          const out = {
            ref: req.ref,
            resolved: true,
            html: el.outerHTML.slice(0, maxHtml),
            ancestors: [openTag(el.parentElement), openTag(el.parentElement?.parentElement)].filter(
              Boolean
            ),
            rect: (() => {
              const r = el.getBoundingClientRect();
              return { w: Math.round(r.width), h: Math.round(r.height) };
            })(),
          };

          if (req.evidenceKind === 'contrast') {
            const fg = parseRgb(cs.color);
            const chain = bgChain(el);
            const solid = chain.find((c) => {
              const p = parseRgb(c.backgroundColor);
              return p && p.a > 0;
            });
            const bg = solid ? parseRgb(solid.backgroundColor) : null;
            // Gradient backgrounds: ratio range of the text against every colour
            // stop (composited over the first solid colour when translucent).
            let gradientRatio = null;
            const gradientLayer = chain.find(
              (c) => c.backgroundImageFull && /gradient\(/.test(c.backgroundImageFull)
            );
            if (fg && gradientLayer) {
              const stops = gradientStops(gradientLayer.backgroundImageFull);
              const base = bg || { r: 255, g: 255, b: 255, a: 1 };
              const ratios = stops.map((st) => ratio(fg, st.a < 1 ? __blendOver(st, base) : st));
              if (ratios.length) {
                gradientRatio = {
                  min: Math.round(Math.min(...ratios) * 100) / 100,
                  max: Math.round(Math.max(...ratios) * 100) / 100,
                  stops: stops.length,
                };
              }
            }
            out.contrast = {
              largeText: __isLargeText(cs),
              gradientRatio,
              color: cs.color,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              backgroundChain: chain,
              firstSolidBackground: solid ? solid.backgroundColor : null,
              hasBackgroundImageInChain: chain.some((c) => c.backgroundImage),
              computedRatioAgainstFirstSolid:
                fg && bg ? Math.round(ratio(fg, bg) * 100) / 100 : null,
              textShadow: cs.textShadow === 'none' ? null : cs.textShadow,
            };
          }

          if (req.evidenceKind === 'linkDistinction') {
            const parent = el.parentElement;
            const pcs = parent ? getComputedStyle(parent) : null;
            out.linkDistinction = {
              linkColor: cs.color,
              surroundingColor: pcs ? pcs.color : null,
              textDecorationLine: cs.textDecorationLine,
              fontWeight: cs.fontWeight,
              surroundingFontWeight: pcs ? pcs.fontWeight : null,
              borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle,
              surroundingText: (parent ? parent.textContent : '').trim().slice(0, 240),
            };
          }

          if (req.evidenceKind === 'subtree') {
            out.subtree = [...el.children].slice(0, 12).map((c) => openTag(c));
          }

          if (req.evidenceKind === 'ancestry') {
            const chain = [];
            let cur = el.parentElement;
            while (cur && chain.length < 6) {
              chain.push(openTag(cur));
              cur = cur.parentElement;
            }
            out.ancestry = chain;
          }

          if (req.evidenceKind === 'scrollable') {
            out.scrollable = {
              overflowX: cs.overflowX,
              overflowY: cs.overflowY,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              tabIndex: el.tabIndex,
              focusableDescendants: el.querySelectorAll(
                'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
              ).length,
            };
          }

          if (req.evidenceKind === 'nameAndText') {
            out.nameAndText = {
              visibleText: (el.textContent || '').trim().slice(0, 200),
              ariaLabel: el.getAttribute('aria-label'),
              ariaLabelledby: el.getAttribute('aria-labelledby'),
              title: el.getAttribute('title'),
            };
          }

          if (req.evidenceKind === 'attributes') {
            out.attributes = [...el.attributes].reduce((acc, a) => {
              acc[a.name] = String(a.value).slice(0, 120);
              return acc;
            }, {});
          }

          return out;
        });
      },
      requests,
      MAX_HTML_CHARS,
      contrastCode
    );

    for (const m of measured) {
      for (const c of (m.contrast && m.contrast.backgroundChain) || [])
        delete c.backgroundImageFull;
    }
    const byRef = new Map(measured.map((m) => [m.ref, m]));
    return (
      requests
        .map((r) => ({ ...r, measured: byRef.get(r.ref) }))
        // A node whose selector does not resolve (DOM changed, cross-frame
        // target) cannot be reviewed on evidence. Leave it to a human.
        .filter((r) => r.measured && r.measured.resolved)
    );
  }

  /** Render a batch of dossiers as the shared "context first" block. */
  _renderBatch(batch) {
    return batch
      .map((d) => {
        const m = d.measured;
        const parts = [
          `### NODE ${d.ref}`,
          `axe rule: ${d.axeRuleId}`,
          `axe could not decide because: ${d.failureSummary || '(no summary given)'}`,
          `selector: ${d.selector}`,
          `element (truncated):\n${m.html}`,
        ];
        if (m.ancestors?.length) parts.push(`ancestors (outermost last): ${m.ancestors.join(' ')}`);
        if (m.rect) parts.push(`rendered size: ${m.rect.w}x${m.rect.h}px`);
        for (const key of [
          'contrast',
          'linkDistinction',
          'subtree',
          'ancestry',
          'scrollable',
          'nameAndText',
          'attributes',
        ]) {
          if (m[key]) parts.push(`${key} measurements:\n${JSON.stringify(m[key], null, 1)}`);
        }
        return parts.join('\n');
      })
      .join('\n\n');
  }

  _instructions() {
    return INSTRUCTIONS;
  }
}

/**
 * System prompt. Differs from the base class's violation-shaped one because
 * this scanner asks for per-node verdicts rather than free-form findings.
 */
const SYSTEM_PROMPT = `You are an accessibility auditor adjudicating findings that the axe-core engine started but could not finish.

axe-core already determined that each element below is IN SCOPE for its rule. Your only job is to decide, from the measurements provided, whether that element passes or fails, or whether the measurements are insufficient to decide.

CRITICAL RULES:
1. Decide ONLY from the measurements given in the node dossier. You have no screenshot and no rendered page. If the dossier does not contain the values needed to decide, the answer is "still-uncertain".
2. NEVER answer "pass" or "fail" without quoting the specific measured value that determines it.
3. When in doubt, answer "still-uncertain". A wrong "fail" invents a defect; a wrong "pass" hides one. "still-uncertain" is always safe.
4. Judge ONLY the rule named for that node. Do not comment on any other accessibility problem you notice.
5. Return one verdict object per node, using the node's "ref" number.

Respond ONLY with valid JSON. No markdown fences, no prose.
Format: { "verdicts": [{ "ref": 1, "verdict": "pass|fail|still-uncertain", "evidence": "the measured value(s) that decide it, quoted" }] }`;

const INSTRUCTIONS = `For each NODE above, return a verdict for its axe rule.

Rule-specific decision guidance:

**color-contrast / color-contrast-enhanced (1.4.3 / 1.4.6)**
- \`computedRatioAgainstFirstSolid\` is the true WCAG ratio between the element's text colour and the nearest solid ancestor background.
- Thresholds: color-contrast needs 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px when fontWeight >= 700). color-contrast-enhanced needs 7:1, or 4.5:1 for large text.
- "fail" ONLY when \`hasBackgroundImageInChain\` is false AND the computed ratio is below the applicable threshold, then quote the ratio, the font size and the threshold.
- "pass" ONLY when \`hasBackgroundImageInChain\` is false AND the ratio meets the threshold, and quote the ratio.
- If \`hasBackgroundImageInChain\` is true, or \`firstSolidBackground\` is null, or \`textShadow\` is set: answer "still-uncertain". An image or gradient behind the text makes a single ratio meaningless, which is exactly why axe gave up.

**link-in-text-block (1.4.1)**
- The question is whether the link is distinguishable from surrounding text by something other than colour.
- "pass" when \`textDecorationLine\` includes "underline", OR \`borderBottom\` has a non-zero width with a non-none style, OR \`fontWeight\` is clearly heavier than \`surroundingFontWeight\`.
- "fail" when the ONLY difference is colour: no underline, no border, same weight, and \`linkColor\` differs from \`surroundingColor\`.
- "still-uncertain" when \`surroundingColor\` is null or the link is not inside a text block (e.g. it is the only content of its parent).

**aria-required-children / aria-required-parent / nested-interactive (4.1.2, 1.3.1)**
- Decide only from \`subtree\` / \`ancestry\` open tags.
- "fail" when the required role is demonstrably absent from the listed elements, and name the role you looked for.
- "pass" when a listed element carries the required role.
- "still-uncertain" when the subtree list is truncated (12 children shown) and the required role could plausibly be further down, or when the children are generic wrappers whose contents you cannot see.

**scrollable-region-focusable (2.1.1)**
- "pass" when \`tabIndex\` >= 0, OR \`focusableDescendants\` > 0 (a keyboard user can reach the content and scroll it by focusing what is inside).
- "fail" when \`tabIndex\` < 0 AND \`focusableDescendants\` === 0 AND the content genuinely overflows (\`scrollHeight\` > \`clientHeight\` or \`scrollWidth\` > \`clientWidth\`) with overflow auto/scroll.
- "still-uncertain" otherwise.

**label-content-name-mismatch (2.5.3)**
- "fail" ONLY when \`ariaLabel\` (or the resolved \`aria-labelledby\` text) does not contain the \`visibleText\` as a substring, ignoring case and punctuation.
- Common non-violations to "pass": the accessible name adds extra words around the visible label ("Search products" vs visible "Search"); the visible text is an icon character or empty.
- "still-uncertain" when \`ariaLabelledby\` is set but the referenced text is not shown to you.

**aria-allowed-attr / aria-valid-attr-value / presentation-role-conflict / frame-tested**
- These are almost always "still-uncertain" from static attributes alone. Answer "fail" only when the \`attributes\` dump shows an unambiguous contradiction (e.g. \`aria-labelledby\` pointing at an id you can see does not exist in the shown markup). Otherwise "still-uncertain".

Do NOT flag anything the node's rule is not about. Do NOT answer "pass" merely because you cannot find a problem: "pass" needs positive evidence, exactly like "fail" does.

Return the verdicts JSON now.`;

module.exports = LLMIncompleteReviewerScanner;
