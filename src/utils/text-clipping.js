/**
 * Measured text-clipping detection (WCAG 1.4.4 Resize Text / 1.4.10 Reflow).
 * Exposes `__findClippedText()` in page context.
 * Compares each text node's `Range.getClientRects()` with the padding box of its
 * clipping container; only glyphs outside a non-scrollable axis are reported.
 */

const injectableCode = `
if (typeof window.__findClippedText !== 'function') {
  window.__TEXT_CLIP_TOLERANCE = 2; // px, sub-pixel layout rounding

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

  /** sr-only / visually-hidden text is clipped by design and is read by AT. */
  window.__isVisuallyHiddenText = function (el) {
    let p = el;
    while (p && p !== document.body) {
      const cls = typeof p.className === 'string' ? p.className : '';
      if (/\\b(sr-only|visually-hidden|screen-reader-text|a11y-hidden)\\b/.test(cls)) return true;
      const s = window.getComputedStyle(p);
      const w = parseFloat(s.width), h = parseFloat(s.height);
      if ((s.position === 'absolute' || s.position === 'fixed') && w <= 1 && h <= 1) return true;
      // The clipping rectangle keeps nothing: the classic sr-only pattern,
      // which a min-height or a padding elsewhere in the cascade can grow
      // past the 1px test above.
      if (s.clip && /^rect\\((\\s*0(px)?\\s*,?){4}\\)$/.test(s.clip.replace(/\\s+/g, ' '))) return true;
      if (s.clipPath && (s.clipPath.indexOf('inset(50%') === 0 || s.clipPath.indexOf('inset(100%') === 0)) return true;
      p = p.parentElement;
    }
    return false;
  };

  /**
   * A slide track: a direct child of the container whose own children lie side
   * by side in one row that spans the container's whole scrollable width. That
   * is the geometry of a carousel and the row is what a prev/next affordance
   * moves. A block that merely overflows its box, three footer columns that do
   * not wrap, has no such row of its own.
   */
  window.__hasSlideTrack = function (el) {
    const box = el.getBoundingClientRect();
    if (box.width < 1) return false;
    for (let i = 0; i < el.children.length; i++) {
      const track = el.children[i];
      if (track.children.length < 3) continue;
      const kids = [];
      for (let k = 0; k < track.children.length; k++) {
        const kr = track.children[k].getBoundingClientRect();
        if (kr.width > 0 && kr.height > 0) kids.push(kr);
      }
      if (kids.length < 3) continue;
      let inRow = true;
      for (let k = 1; k < kids.length; k++) {
        if (kids[k].left < kids[k - 1].right - 1) { inRow = false; break; }
        if (Math.abs(kids[k].top - kids[0].top) > kids[0].height) { inRow = false; break; }
      }
      if (!inRow) continue;
      const span = kids[kids.length - 1].right - kids[0].left;
      if (span > box.width * 1.2 && span >= el.scrollWidth * 0.9) return true;
    }
    return false;
  };

  /**
   * Can the user bring what the container clips on \`axis\` into view?
   *
   * SC 1.4.10 and 1.4.12 forbid loss of content and functionality, not the
   * clip itself. A container loses nothing when it can be scrolled on the
   * clipped axis and the user has a way to move it: the axis scrolls
   * natively, or it holds a slide track, which is what a carousel's prev/next
   * affordance pans. A fixed height box that swallows the end of a paragraph
   * offers neither.
   */
  window.__isPannableContainer = function (el, axis) {
    const horizontal = axis !== 'vertical';
    const prop = horizontal ? 'scrollLeft' : 'scrollTop';
    const extent = horizontal
      ? el.scrollWidth - el.clientWidth
      : el.scrollHeight - el.clientHeight;
    if (extent <= 2) return false;
    const before = el[prop];
    el[prop] = before + 50;
    const moved = el[prop] !== before;
    el[prop] = before;
    if (!moved) return false;

    const s = window.getComputedStyle(el);
    const overflow = horizontal ? s.overflowX : s.overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return true;
    return horizontal && window.__hasSlideTrack(el);
  };

  /**
   * @param {Object} [opts]
   *   opts.root: subtree to scan (default document.body)
   *   opts.minChars: ignore clipped runs shorter than this (default 2)
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
      // -webkit-line-clamp or text-overflow: ellipsis truncates at every
      // viewport alike (a teaser, a one-line label) and the full text stays in
      // the DOM for assistive technology, so this is a design decision, not a
      // resize failure: callers report it as a hint.
      const lineClamp = s.webkitLineClamp || s['-webkit-line-clamp'] || 'none';
      const truncationDeclared = (lineClamp && lineClamp !== 'none') || s.textOverflow === 'ellipsis';

      const axis =
        overshootX > TOL && overshootY > TOL ? 'both' : overshootX > TOL ? 'horizontal' : 'vertical';
      const pannable =
        axis === 'both'
          ? window.__isPannableContainer(el, 'horizontal') &&
            window.__isPannableContainer(el, 'vertical')
          : window.__isPannableContainer(el, axis);

      out.push({
        pannable: pannable,
        truncationDeclared: !!truncationDeclared,
        lineClamp: lineClamp,
        selector: selectorOf(el),
        axis: axis,
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
