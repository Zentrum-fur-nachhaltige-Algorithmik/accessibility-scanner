/**
 * Measured text-clipping detection (WCAG 1.4.4 Resize Text / 1.4.10 Reflow).
 *
 * Why this exists
 * ---------------
 * The old checks in `phase6a-text-resize-scanner` and
 * `phase6d-mobile-specific-scanner` inferred "text is cut off" from
 * `el.scrollWidth > el.clientWidth` on any element with `overflow-x: hidden`.
 * That is not evidence of content loss:
 *
 *   - `scrollWidth` is rounded to integers and is driven by *boxes*, not text —
 *     a grid child whose border box sticks out by 3px makes `scrollWidth`
 *     exceed `clientWidth` while every glyph stays inside the scrollport
 *     (`div.hours` on the golden corpus: 281 vs 278, zero clipped characters).
 *   - Elements that clip a decorative/absolutely positioned box report the same
 *     way.
 *
 * What WCAG actually requires is that *information is not lost*. So we measure
 * the glyphs: for every text node inside a clipping container we take the
 * `Range.getClientRects()` (the real painted line boxes) and compare them with
 * the container's padding box — the box `overflow: hidden` clips at. Only text
 * that provably lies outside the scrollport, on an axis the user cannot scroll
 * (`hidden`/`clip`, not `auto`/`scroll`), is reported.
 *
 * Exposes `__findClippedText()` in page context; returns one entry per
 * innermost clipping container that actually swallows text.
 */

const injectableCode = `
if (typeof window.__findClippedText !== 'function') {
  window.__TEXT_CLIP_TOLERANCE = 2; // px — sub-pixel layout rounding

  window.__clipModeOf = function (styleValue) {
    if (styleValue === 'hidden' || styleValue === 'clip') return 'clip';
    if (styleValue === 'auto' || styleValue === 'scroll') return 'scroll';
    return 'visible';
  };

  /** Nearest ancestor (inclusive) that establishes any kind of overflow container. */
  window.__nearestOverflowContainer = function (node) {
    let p = node.nodeType === 1 ? node : node.parentElement;
    while (p && p !== document.documentElement) {
      const s = window.getComputedStyle(p);
      if (window.__clipModeOf(s.overflowX) !== 'visible' || window.__clipModeOf(s.overflowY) !== 'visible') return p;
      p = p.parentElement;
    }
    return null;
  };

  window.__isRenderedForClip = function (el) {
    // __isRendered comes from utils/rendered.js when the caller eval()s it in
    // the same scope; typeof on an undeclared identifier is safe.
    try { if (typeof __isRendered === 'function') return __isRendered(el); } catch (e) { /* not injected */ }
    if (!el || !el.getClientRects().length) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) !== 0;
  };

  /** sr-only / visually-hidden text is clipped on purpose and is read by AT. */
  window.__isVisuallyHiddenText = function (el) {
    let p = el;
    while (p && p !== document.body) {
      const cls = typeof p.className === 'string' ? p.className : '';
      if (/\\b(sr-only|visually-hidden|screen-reader-text|a11y-hidden)\\b/.test(cls)) return true;
      const s = window.getComputedStyle(p);
      const w = parseFloat(s.width), h = parseFloat(s.height);
      if ((s.position === 'absolute' || s.position === 'fixed') && w <= 1 && h <= 1) return true;
      if (s.clipPath && s.clipPath.indexOf('inset(50%') === 0) return true;
      p = p.parentElement;
    }
    return false;
  };

  /**
   * @param {Object} [opts]
   *   opts.root       — subtree to scan (default document.body)
   *   opts.minChars   — ignore clipped runs shorter than this (default 2)
   * @returns {Array<{selector, axis, overshootX, overshootY, clippedChars, samples[], scrollWidth, clientWidth, scrollHeight, clientHeight, whiteSpace, textOverflow}>}
   */
  window.__findClippedText = function (opts) {
    const options = opts || {};
    const minChars = options.minChars == null ? 2 : options.minChars;
    const root = options.root || document.body;
    if (!root) return [];
    const TOL = window.__TEXT_CLIP_TOLERANCE;
    const out = [];

    function selectorOf(el) {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? '#' + el.id : '';
      const cls = (typeof el.className === 'string' && el.className.trim())
        ? '.' + el.className.trim().split(/\\s+/)[0] : '';
      return tag + id + cls;
    }

    const containers = [];
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const s = window.getComputedStyle(el);
      const clipX = window.__clipModeOf(s.overflowX) === 'clip';
      const clipY = window.__clipModeOf(s.overflowY) === 'clip';
      if (!clipX && !clipY) continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      if (!window.__isRenderedForClip(el)) continue;
      if (window.__isVisuallyHiddenText(el)) continue;
      containers.push({ el: el, style: s, clipX: clipX, clipY: clipY });
    }

    for (const c of containers) {
      const el = c.el;
      const s = c.style;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // overflow clips at the padding edge
      const left = r.left + (parseFloat(s.borderLeftWidth) || 0);
      const right = r.right - (parseFloat(s.borderRightWidth) || 0);
      const top = r.top + (parseFloat(s.borderTopWidth) || 0);
      const bottom = r.bottom - (parseFloat(s.borderBottomWidth) || 0);

      let overshootX = 0, overshootY = 0, clippedChars = 0;
      const samples = [];

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue ? node.nodeValue.trim() : '';
        if (text.length < minChars) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        // Only the innermost overflow container owns this text; an outer one
        // must not report what an inner scroll container already handles.
        if (window.__nearestOverflowContainer(parent) !== el) continue;
        if (!window.__isRenderedForClip(parent)) continue;
        if (window.__isVisuallyHiddenText(parent)) continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        for (let k = 0; k < rects.length; k++) {
          const rc = rects[k];
          if (rc.width < 1 && rc.height < 1) continue;
          let dx = 0, dy = 0;
          if (c.clipX) dx = Math.max(rc.right - right, left - rc.left);
          if (c.clipY) dy = Math.max(rc.bottom - bottom, top - rc.top);
          if (dx > TOL || dy > TOL) {
            overshootX = Math.max(overshootX, dx);
            overshootY = Math.max(overshootY, dy);
            clippedChars += text.length;
            if (samples.length < 3) samples.push(text.slice(0, 60));
            break;
          }
        }
      }

      if (!samples.length) continue;
      // An author who wrote -webkit-line-clamp or text-overflow: ellipsis
      // truncated on purpose and at every viewport alike (a teaser, a one-line
      // label). The full text stays in the DOM for assistive technology, so this
      // is a design decision, not a resize failure — callers report it as a hint.
      const lineClamp = s.webkitLineClamp || s['-webkit-line-clamp'] || 'none';
      const truncationDeclared = (lineClamp && lineClamp !== 'none') || s.textOverflow === 'ellipsis';

      out.push({
        truncationDeclared: !!truncationDeclared,
        lineClamp: lineClamp,
        selector: selectorOf(el),
        axis: overshootX > TOL && overshootY > TOL ? 'both' : (overshootX > TOL ? 'horizontal' : 'vertical'),
        overshootX: Math.round(overshootX),
        overshootY: Math.round(overshootY),
        clippedChars: clippedChars,
        samples: samples,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        whiteSpace: s.whiteSpace,
        textOverflow: s.textOverflow,
        height: s.height,
        overflow: s.overflow
      });
    }

    return out;
  };
}
`;

module.exports = { injectableCode };
