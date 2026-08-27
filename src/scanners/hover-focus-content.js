const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');

/**
 * Hover/Focus Content Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criterion 9.1.4.13 (Content on Hover or Focus)
 * Checks: dismissable, hoverable, persistent
 * Hybrid: heuristic CSS/DOM check + interactive hover/focus simulation
 */
class HoverFocusContentScanner extends BaseScanner {
  constructor() {
    super('hover-focus-content', {
      wcagCriteria: ['1.4.13'],
      wcagPrinciple: 'perceivable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  async scan(page, options = {}) {
    if (options.heuristicOnly) {
      return this.heuristicScan(page);
    }
    return this.fullScan(page, options);
  }

  /**
   * Heuristic scan — concurrent-compatible, pure CSS/DOM analysis
   */
  async heuristicScan(page) {
    console.log('Running heuristic hover/focus content check...');

    const result = await page.evaluate((renderedCode) => {
      eval(renderedCode);
      const violations = [];

      function getSelector(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '')
        );
      }

      const norm = (sel) =>
        sel
          .replace(/\s+/g, ' ')
          .replace(/\s*([>+~,])\s*/g, '$1')
          .trim()
          .toLowerCase();

      /** Does this element currently count as NOT rendered (so a :hover rule could reveal it)? */
      function isHiddenNow(el) {
        if (!__isRendered(el)) return true;
        const cs = window.getComputedStyle(el);
        return cs.pointerEvents === 'none' && parseFloat(cs.opacity) === 0;
      }

      /** Would applying this declaration block to a hidden element make it rendered? */
      function revealsHidden(style, el) {
        const cs = window.getComputedStyle(el);
        const reveals = [];
        if (cs.display === 'none' && style.display && style.display !== 'none')
          reveals.push('display');
        if (
          (cs.visibility === 'hidden' || cs.visibility === 'collapse') &&
          style.visibility === 'visible'
        )
          reveals.push('visibility');
        if (parseFloat(cs.opacity) === 0 && style.opacity && parseFloat(style.opacity) > 0)
          reveals.push('opacity');
        // Off-canvas brought on-canvas
        for (const side of ['left', 'right', 'top', 'bottom']) {
          const v = style[side];
          if (!v) continue;
          const cur = parseFloat(cs[side]);
          if (
            !isNaN(cur) &&
            cur <= -Math.max(el.offsetWidth, el.offsetHeight, 50) &&
            !String(v).trim().startsWith('-')
          )
            reveals.push(side);
        }
        if (
          style.transform &&
          cs.transform !== 'none' &&
          (style.transform === 'none' || /translate[XY3d]*\(\s*0(px|%)?/.test(style.transform))
        )
          reveals.push('transform');
        return reveals;
      }

      // 1. Walk every stylesheet once: collect :hover rules that REVEAL hidden targets,
      //    and the normalized set of all :focus/:focus-within/:focus-visible selectors.
      const hoverContentSelectors = [];
      const focusSelectors = new Set();
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
            try {
              walk(rule.cssRules);
            } catch (e) {
              /* */
            }
            continue;
          }
          if (!(rule instanceof CSSStyleRule)) continue;
          const sel = rule.selectorText || '';
          if (!/:hover|:focus/i.test(sel)) continue;
          const parts = sel.split(',').map((x) => x.trim());
          for (const part of parts) {
            if (/:focus(-within|-visible)?/i.test(part))
              focusSelectors.add(norm(part.replace(/:focus(-within|-visible)?/gi, ':focus')));
          }
          for (const part of parts) {
            if (!/:hover/i.test(part)) continue;
            let targets;
            try {
              targets = document.querySelectorAll(part.replace(/:hover/gi, ''));
            } catch (e) {
              continue;
            }
            const revealed = [];
            for (const t of targets) {
              if (!isHiddenNow(t)) continue;
              const r = revealsHidden(rule.style, t);
              if (r.length) revealed.push({ el: t, via: r });
            }
            if (!revealed.length) continue;
            const sameRuleFocus = parts.some((x) => /:focus/i.test(x));
            hoverContentSelectors.push({
              selector: part,
              normalized: norm(part.replace(/:hover/gi, ':focus')),
              type: 'hover',
              hasFocusEquivalent: sameRuleFocus,
              revealed: revealed.map((x) => getSelector(x.el)),
              revealedEls: revealed.map((x) => x.el),
            });
          }
        }
      };
      try {
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules || sheet.rules;
          } catch (e) {
            continue;
          }
          if (rules) walk(rules);
        }
      } catch (e) {
        /* stylesheet access error */
      }

      // Focus equivalents may live in ANY sheet; compare normalized selectors.
      for (const entry of hoverContentSelectors) {
        if (entry.hasFocusEquivalent) continue;
        if (focusSelectors.has(entry.normalized)) {
          entry.hasFocusEquivalent = true;
          continue;
        }
        // Also accept a :focus-within on any ancestor compound of the hover subject
        // (e.g. ".menu:hover .sub" vs ".menu:focus-within .sub" already normalized above).
      }

      // Flag hover-only content (no focus equivalent)
      for (const entry of hoverContentSelectors) {
        if (!entry.hasFocusEquivalent) {
          violations.push({
            criterion: '9.1.4.13',
            element: entry.selector,
            issue: 'hover-only-no-focus',
            description: `Content (${entry.revealed.slice(0, 3).join(', ')}) is revealed on :hover but has no :focus / :focus-within equivalent — keyboard users cannot access it`,
            severity: 'serious',
            suggestion: 'Add a :focus or :focus-within CSS rule that shows the same content.',
          });
        }
      }

      // 2. pointer-events:none on hover-revealed elements
      for (const entry of hoverContentSelectors) {
        for (const el of entry.revealedEls) {
          const style = window.getComputedStyle(el);
          if (style.pointerEvents === 'none') {
            violations.push({
              criterion: '9.1.4.13',
              element: getSelector(el),
              issue: 'hover-content-not-hoverable',
              description:
                'Hover-revealed content has pointer-events:none — users cannot move pointer to read it',
              severity: 'serious',
              suggestion:
                'Remove pointer-events:none from hover-revealed content to make it hoverable.',
            });
          }
        }
      }
      for (const e of hoverContentSelectors) delete e.revealedEls;

      // 3. Flag title attributes on interactive elements
      const interactiveWithTitle = document.querySelectorAll(
        'a[title], button[title], input[title], [role="button"][title], [tabindex][title]'
      );
      interactiveWithTitle.forEach((el) => {
        if (!__isRendered(el)) return;
        const title = el.getAttribute('title');
        if (!title || title.length < 5) return; // Skip trivially short titles
        const text = el.textContent.trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        if (text.includes(title) || ariaLabel.includes(title)) return; // info already accessible

        violations.push({
          criterion: '9.1.4.13',
          element: getSelector(el),
          issue: 'title-attribute-as-content',
          description: `title="${title.substring(0, 50)}..." conveys content that is not dismissable or hoverable`,
          severity: 'moderate',
          suggestion:
            'Use a visible tooltip pattern instead of the title attribute, with Escape to dismiss.',
        });
      });

      // 4. Inline mouseenter/mouseover handlers without focus equivalents (rendered elements only)
      document.querySelectorAll('[onmouseenter], [onmouseover]').forEach((el) => {
        if (!__isRendered(el)) return;
        const hasFocusHandler = el.hasAttribute('onfocus') || el.hasAttribute('onfocusin');
        if (!hasFocusHandler) {
          violations.push({
            criterion: '9.1.4.13',
            element: getSelector(el),
            issue: 'hover-only-no-focus',
            description:
              'Element has mouseenter/mouseover handler but no focus handler — content not accessible via keyboard',
            severity: 'serious',
            suggestion:
              'Add onfocus/onfocusin handlers that show the same content as the hover handler.',
          });
        }
      });

      // 5. setTimeout auto-dismiss patterns in inline scripts
      let hasAutoClose = false;
      document.querySelectorAll('script:not([src])').forEach((script) => {
        const code = script.textContent || '';
        const autoClosePattern =
          /setTimeout\s*\([^)]*(?:display\s*=\s*['"]none|\.hide\(|\.remove\(|classList\.remove|\.close\(|opacity\s*=\s*['"]?0)/i;
        if (autoClosePattern.test(code)) hasAutoClose = true;
      });
      if (hasAutoClose) {
        violations.push({
          criterion: '9.1.4.13',
          element: 'script',
          issue: 'hover-content-not-persistent',
          description:
            'JavaScript uses setTimeout to auto-hide content — content is not persistent until user dismisses it',
          severity: 'serious',
          suggestion:
            'Remove auto-close timers. Content should remain visible until the user dismisses it or moves focus/pointer away.',
        });
      }

      // Dismissability (Escape) is only decided by the interactive path in fullScan():
      // grepping inline scripts for "Escape" is blind to external bundles and produced
      // a page-level false positive on nearly every real site (FP-11).
      const hasEscapeHandler = null;

      return {
        violations,
        hoverSelectors: hoverContentSelectors.map((e) => e.selector),
        hoverContentCount: hoverContentSelectors.length,
        hasAutoClose,
        hasEscapeHandler,
      };
    }, renderedCode);

    return {
      scannerId: this.id,
      criteria: ['9.1.4.13'],
      passed: result.violations.length === 0,
      violations: result.violations,
      hoverSelectors: result.hoverSelectors || [],
      summary: {
        heuristicOnly: true,
        hoverContentCount: result.hoverContentCount,
        hasAutoClose: result.hasAutoClose,
        hasEscapeHandler: result.hasEscapeHandler,
        violationCount: result.violations.length,
      },
    };
  }

  /**
   * Full interactive scan — hover and focus elements to test dismissable/hoverable/persistent
   */
  async fullScan(page, options = {}) {
    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);
    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `hover-focus-scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    console.log('Running full interactive hover/focus content check...');

    // Run heuristic first to collect violations and identify hover content
    const heuristicResult = await this.heuristicScan(page);
    const violations = [...heuristicResult.violations];

    // Find hover-triggered elements to test interactively: subjects of the CSS
    // :hover rules that reveal content, plus the usual class-name candidates.
    const hoverTriggers = await page.evaluate(
      (renderedCode, hoverSelectors) => {
        eval(renderedCode);
        const triggers = [];
        const seen = new Set();
        const sel = (el) =>
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string'
            ? `.${el.className.split(' ')[0]}`
            : '');
        const add = (el) => {
          if (seen.has(el) || !__isRendered(el)) return;
          seen.add(el);
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          triggers.push({
            selector: sel(el),
            rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          });
        };
        for (const hs of hoverSelectors) {
          // subject = compound that carries :hover
          const m = hs.match(/^(.*?)(?=:hover)/i);
          if (!m) continue;
          try {
            document.querySelectorAll(m[1].trim() || '*').forEach(add);
          } catch (e) {
            /* */
          }
        }
        document
          .querySelectorAll(
            '[class*="tooltip"], [class*="dropdown"], [class*="popup"], [class*="popover"], [data-tooltip], [aria-describedby]'
          )
          .forEach(add);
        return triggers.slice(0, 10);
      },
      renderedCode,
      heuristicResult.hoverSelectors || []
    );

    const snapshotScript = `
      (function () {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
          out.push(el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : (el.offsetWidth > 0 || el.offsetHeight > 0));
        }
        return out;
      })()
    `;

    // Test each hover trigger interactively
    for (const [i, trigger] of hoverTriggers.entries()) {
      try {
        // Pre/post diff: which elements became rendered because of the hover?
        await page.mouse.move(0, 0);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const before = await page.evaluate(snapshotScript);
        await page.mouse.move(trigger.rect.x, trigger.rect.y);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const hoverContent = await page.evaluate(
          (beforeVis, triggerSel) => {
            const els = [...document.querySelectorAll('body *')].filter(
              (el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'
            );
            const trigger = document.querySelector(triggerSel);
            for (let i = 0; i < els.length && i < beforeVis.length; i++) {
              const el = els[i];
              const vis = el.checkVisibility
                ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                : el.offsetWidth > 0 || el.offsetHeight > 0;
              if (vis && !beforeVis[i]) {
                // outermost newly revealed element
                if (
                  el.parentElement &&
                  els.indexOf(el.parentElement) !== -1 &&
                  !beforeVis[els.indexOf(el.parentElement)]
                )
                  continue;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                if (trigger && trigger === el) continue;
                // 1.4.13 exception: dismissal is only required when the revealed
                // content obscures or replaces OTHER content. Check whether any
                // unrelated rendered text sits under the revealed box.
                let obscures = false;
                const pad = 2;
                for (const other of els) {
                  if (other === el || el.contains(other) || other.contains(el)) continue;
                  if (
                    !(other.checkVisibility
                      ? other.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                      : other.offsetWidth > 0)
                  )
                    continue;
                  const hasOwnText = [...other.childNodes].some(
                    (n) => n.nodeType === 3 && n.textContent.trim()
                  );
                  const isGraphic = /^(img|svg|video|canvas|input|button|select|textarea)$/i.test(
                    other.tagName
                  );
                  if (!hasOwnText && !isGraphic) continue;
                  const o = other.getBoundingClientRect();
                  if (o.width === 0 || o.height === 0) continue;
                  if (
                    o.left < rect.right - pad &&
                    o.right > rect.left + pad &&
                    o.top < rect.bottom - pad &&
                    o.bottom > rect.top + pad
                  ) {
                    obscures = true;
                    break;
                  }
                }
                // A close control inside the revealed content is an accepted dismiss mechanism.
                const revealedAll = els.filter(
                  (x, j) =>
                    j < beforeVis.length &&
                    !beforeVis[j] &&
                    (x.checkVisibility
                      ? x.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                      : x.offsetWidth > 0)
                );
                const controls = new Set();
                for (const r of revealedAll) {
                  if (r.matches('button, [role="button"], a[href]')) controls.add(r);
                  r.querySelectorAll('button, [role="button"], a[href]').forEach((c) =>
                    controls.add(c)
                  );
                }
                const hasCloseControl = [...controls].some((b) => {
                  const name = (
                    (b.getAttribute('aria-label') || '') +
                    ' ' +
                    (b.textContent || '') +
                    ' ' +
                    (b.className || '')
                  ).toLowerCase();
                  return /close|schlie|dismiss|×|✕|✖/.test(name);
                });
                return {
                  found: true,
                  obscures,
                  hasCloseControl,
                  contentRect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
                  contentSelector:
                    el.tagName.toLowerCase() +
                    (el.id ? `#${el.id}` : '') +
                    (el.className && typeof el.className === 'string'
                      ? `.${el.className.split(' ')[0]}`
                      : ''),
                };
              }
            }
            return { found: false };
          },
          before,
          trigger.selector
        );

        if (hoverContent && hoverContent.found) {
          // Test hoverable: move pointer to the revealed content
          await page.mouse.move(hoverContent.contentRect.x, hoverContent.contentRect.y);
          await new Promise((resolve) => setTimeout(resolve, 300));

          const contentStillVisible = await page.evaluate((contentSel) => {
            const el = document.querySelector(contentSel);
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              parseFloat(style.opacity) > 0
            );
          }, hoverContent.contentSelector);

          if (!contentStillVisible) {
            // Check if already flagged by heuristic
            const alreadyFlagged = violations.some(
              (v) =>
                v.issue === 'hover-content-not-hoverable' &&
                v.element === hoverContent.contentSelector
            );
            if (!alreadyFlagged) {
              violations.push({
                criterion: '9.1.4.13',
                element: hoverContent.contentSelector,
                issue: 'hover-content-not-hoverable',
                description:
                  'Hover-triggered content disappears when pointer moves to it — content is not hoverable',
                severity: 'serious',
                suggestion:
                  'Ensure hover content remains visible when the pointer moves from trigger to content.',
              });
            }
          }

          // Test dismissable: press Escape
          await page.mouse.move(trigger.rect.x, trigger.rect.y);
          await new Promise((resolve) => setTimeout(resolve, 400));
          await page.keyboard.press('Escape');
          await new Promise((resolve) => setTimeout(resolve, 300));

          const dismissedByEscape = await page.evaluate((contentSel) => {
            const el = document.querySelector(contentSel);
            if (!el) return true;
            const style = window.getComputedStyle(el);
            return (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              parseFloat(style.opacity) === 0
            );
          }, hoverContent.contentSelector);

          if (!dismissedByEscape && hoverContent.obscures && !hoverContent.hasCloseControl) {
            const alreadyFlagged = violations.some(
              (v) => v.issue === 'hover-content-not-dismissable' && v.element !== 'document'
            );
            if (!alreadyFlagged) {
              violations.push({
                criterion: '9.1.4.13',
                element: trigger.selector,
                issue: 'hover-content-not-dismissable',
                description: `Hover-triggered content (${hoverContent.contentSelector}) obscures other content and is not dismissed by pressing Escape`,
                severity: 'serious',
                suggestion:
                  'Add Escape key handler to dismiss hover/focus-triggered content without moving the pointer.',
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Error testing hover trigger ${trigger.selector}:`, error.message);
      }
    }

    return {
      scannerId: this.id,
      criteria: ['9.1.4.13'],
      passed: violations.length === 0,
      violations,
      summary: {
        hoverTriggersFound: hoverTriggers.length,
        heuristicViolations: heuristicResult.violations.length,
        interactiveViolations: violations.length - heuristicResult.violations.length,
        violationCount: violations.length,
      },
      screenshotPath: scanDir,
    };
  }
}

module.exports = HoverFocusContentScanner;
