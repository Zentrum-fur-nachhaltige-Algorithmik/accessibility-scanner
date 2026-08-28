/**
 * Browser-injectable "is this element rendered / reachable?" helpers.
 * Exposes __isRendered, __isFocusable, __isFocusableRendered, __isInteractiveTarget,
 * __isKeyboardReachable and __isSrOnly; `eval()` the exported string inside `page.evaluate`.
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

  // Structural keyboard reachability only; says nothing about whether the
  // element is painted right now. Split out from __isFocusableRendered because
  // controls that are hidden until focused (skip links parked
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

  // Can Tab still land on this element, or inside it? Deliberately ignores
  // aria-hidden: this is the question aria-hidden itself raises, since an
  // element removed from the accessibility tree but left in the tab order is
  // focus the user cannot have announced.
  function __isKeyboardReachable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[hidden], [inert]')) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    }
    if (!el.getClientRects().length) return false;
    if (__isFocusable(el)) return true;
    return Array.from(el.querySelectorAll('*')).some(__isFocusable);
  }
`;

module.exports = { injectableCode };
