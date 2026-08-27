/**
 * Browser-injectable "is this element actually rendered / reachable?" helpers.
 *
 * These run inside page.evaluate(). Inject `injectableCode` (e.g. via
 * `eval(renderedCode)` at the top of the evaluate callback, the same way
 * `src/utils/browser-contrast.js` is used) and call:
 *
 *   __isRendered(el)          — painted and not hidden by any ancestor:
 *                               display/visibility/opacity/hidden/inert/
 *                               aria-hidden/content-visibility, off-canvas.
 *   __isFocusable(el)         — structurally keyboard-reachable (not
 *                               disabled, tabindex !== -1, focusable tag or
 *                               [tabindex]) REGARDLESS of whether it is
 *                               painted right now.
 *   __isFocusableRendered(el) — __isFocusable + __isRendered.
 *   __isInteractiveTarget(el) — a pointer target in the WCAG 2.5.8 sense:
 *                               native control / interactive role / tabindex>=0
 *                               — no class-name guessing, no tabindex="-1".
 *   __isSrOnly(el)            — visually hidden but exposed to AT (clip/1px).
 *
 * Why this exists: almost every false positive on healthy pages traced back to
 * scanners measuring elements that are not rendered at all (a `display:none`
 * mobile menu, an off-canvas drawer, a `tabindex="-1"` skip-link target). One
 * shared definition of "rendered" keeps that decision out of each scanner.
 */

const injectableCode = `
  function __isSrOnly(el) {
    if (!el || el.nodeType !== 1) return false;
    const s = window.getComputedStyle(el);
    if (s.position !== 'absolute' && s.position !== 'fixed') return false;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w > 1 || h > 1) return false;
    return s.overflow === 'hidden' || /rect\\(/.test(s.clip) || s.clipPath !== 'none';
  }

  function __isRendered(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (typeof el.checkVisibility === 'function') {
      // Chrome 105+: display:none ancestors, visibility, content-visibility, opacity
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    } else {
      let n = el;
      while (n && n.nodeType === 1) {
        const s = window.getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || parseFloat(s.opacity) === 0) return false;
        n = n.parentElement;
      }
    }
    const rects = el.getClientRects();
    if (!rects.length) return false;
    // Off-canvas: every box entirely outside the scrollable document.
    const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    const sx = window.scrollX, sy = window.scrollY;
    let inside = false;
    for (const r of rects) {
      if (r.width === 0 && r.height === 0) continue;
      if (r.right + sx > 0 && r.bottom + sy > 0 && r.left + sx < docW && r.top + sy < docH) { inside = true; break; }
    }
    if (!inside) return false;
    // Clipped to nothing by an overflow:hidden ancestor (e.g. collapsed accordion)
    let p = el.parentElement;
    const mine = el.getBoundingClientRect();
    while (p && p !== document.body) {
      const s = window.getComputedStyle(p);
      if ((s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
        const pr = p.getBoundingClientRect();
        if (s.overflowX !== 'visible' && (mine.right <= pr.left || mine.left >= pr.right)) return false;
        if (s.overflowY !== 'visible' && (mine.bottom <= pr.top || mine.top >= pr.bottom)) return false;
      }
      p = p.parentElement;
    }
    return true;
  }

  const __INTERACTIVE_ROLES = new Set(['button','link','checkbox','radio','switch','tab','menuitem','menuitemcheckbox','menuitemradio','option','slider','spinbutton','textbox','combobox','searchbox','treeitem','gridcell','scrollbar']);

  function __isNativelyInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'area') return el.hasAttribute('href');
    if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
    if (tag === 'input') return el.type !== 'hidden';
    if (tag === 'iframe' || tag === 'embed' || tag === 'object') return true;
    if (tag === 'audio' || tag === 'video') return el.hasAttribute('controls');
    return false;
  }

  function __isInteractiveTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest('fieldset[disabled]')) return false;
    if (__isNativelyInteractive(el)) return true;
    const role = (el.getAttribute('role') || '').trim().split(/\\s+/)[0];
    if (role && __INTERACTIVE_ROLES.has(role)) return true;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && parseInt(ti, 10) >= 0) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // Structural keyboard reachability only — says nothing about whether the
  // element is painted right now. Split out from __isFocusableRendered because
  // controls that are deliberately hidden UNTIL focused (skip links parked
  // off-canvas with translateY(-100%), reveal-on-scroll CTAs) are reachable by
  // Tab even though they are invisible while unfocused: a focus walk has to be
  // able to record their unfocused baseline before it starts.
  function __isFocusable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled || el.closest('fieldset[disabled]')) return false;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && parseInt(ti, 10) < 0) return false;
    return !!(__isNativelyInteractive(el) || ti !== null || el.isContentEditable);
  }

  function __isFocusableRendered(el) {
    return __isFocusable(el) && __isRendered(el);
  }
`;

module.exports = { injectableCode };
