/**
 * Browser-injectable contrast utilities for page.evaluate().
 * Exposes __parseRgb, __getLuminance, __getContrastRatio, __blendOver, __resolveBackground,
 * __getEffectiveBackgroundColor, __isColorTransparent, __isInactive, __getRenderedBorder,
 * __isLargeText, __hasAlternativeIdentifier. All ratios use WCAG 2.x relative luminance.
 */

const injectableCode = `
  function __parseRgb(rgbString) {
    if (!rgbString) return null;
    if (rgbString === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    // Handle hex
    const hexMatch = rgbString.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1
      };
    }
    // Handle rgb/rgba (both the comma syntax and the CSS Color 4
    // space-separated "rgb(0 0 0 / 50%)" syntax)
    const match = rgbString.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)/);
    if (!match) return null;
    let alpha = 1;
    if (match[4] !== undefined) {
      alpha = match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    }
    return {
      r: parseInt(match[1]),
      g: parseInt(match[2]),
      b: parseInt(match[3]),
      a: alpha
    };
  }

  function __getLuminance(rgb) {
    const { r, g, b } = rgb;
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function __getContrastRatio(color1, color2) {
    const lum1 = __getLuminance(color1);
    const lum2 = __getLuminance(color2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  // Alpha-composite \`fg\` over an opaque \`bg\` (simple source-over). A
  // translucent colour does NOT render as its own rgb triple, so comparing
  // rgba(0,0,0,0.7) directly against anything is meaningless: it has to be
  // flattened against whatever is actually behind it first.
  function __blendOver(fg, bg) {
    const a = (fg && fg.a !== undefined) ? fg.a : 1;
    if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
    return {
      r: Math.round(fg.r * a + bg.r * (1 - a)),
      g: Math.round(fg.g * a + bg.g * (1 - a)),
      b: Math.round(fg.b * a + bg.b * (1 - a)),
      a: 1
    };
  }

  // Resolve what is ACTUALLY painted behind (and including) an element:
  // walks ancestors, alpha-composites every translucent layer it passes, and
  // stops at the first fully opaque one. The canvas default is white.
  //
  // When any layer paints a background-image (a gradient, or a bitmap) the
  // rendered colour cannot be derived from the CSSOM at all. Rather than
  // silently assuming white (which manufactures confident 1:1 "violations"
  // for white text on a dark gradient) the result is flagged
  // \`indeterminate\` so callers can report "needs review" instead.
  function __resolveBackground(element) {
    const layers = [];
    let current = element;
    let indeterminate = false;
    let indeterminateSource = null;

    while (current && current.nodeType === 1) {
      const styles = window.getComputedStyle(current);
      const bgImage = styles.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        indeterminate = true;
        indeterminateSource = String(bgImage).slice(0, 160);
        break;
      }
      const parsed = __parseRgb(styles.backgroundColor);
      if (parsed && parsed.a > 0) {
        layers.push(parsed);
        if (parsed.a >= 1) break;
      }
      current = current.parentElement;
    }

    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) result = __blendOver(layers[i], result);
    result.indeterminate = indeterminate;
    result.indeterminateSource = indeterminateSource;
    return result;
  }

  // Backwards-compatible wrapper: always returns an opaque { r, g, b, a: 1 }.
  // Callers that need to know whether the value is trustworthy should use
  // __resolveBackground and check \`.indeterminate\`.
  function __getEffectiveBackgroundColor(element) {
    const bg = __resolveBackground(element);
    return { r: bg.r, g: bg.g, b: bg.b, a: 1 };
  }

  function __isColorTransparent(colorStr) {
    if (!colorStr) return true;
    if (colorStr === 'transparent') return true;
    const parsed = __parseRgb(colorStr);
    if (!parsed) return true;
    return parsed.a === 0;
  }

  // WCAG 1.4.3 and 1.4.11 both carve out inactive (disabled) components:
  // "Text ... that is part of an inactive user interface component ... has no
  // contrast requirement" (1.4.3 Incidental) and "Inactive user interface
  // components" (1.4.11 exception). A greyed-out control is intended design,
  // not a defect.
  function __isInactive(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.disabled === true) return true;
    if (typeof element.closest === 'function') {
      if (element.closest('[aria-disabled="true"], fieldset[disabled], [inert]')) return true;
    }
    return false;
  }

  // A border is only painted when its style is not none/hidden AND its used
  // width is > 0. \`border: none\` still computes a border-color (CSS's initial
  // value is \`currentColor\`, i.e. the text colour), so a border-color on its
  // own is never evidence that a border exists.
  // Returns the first actually-painted, non-transparent side, or null.
  function __getRenderedBorder(styles) {
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    for (const side of sides) {
      const borderStyle = styles['border' + side + 'Style'];
      const borderWidth = parseFloat(styles['border' + side + 'Width']);
      const borderColor = styles['border' + side + 'Color'];
      if (borderStyle && borderStyle !== 'none' && borderStyle !== 'hidden' &&
          borderWidth > 0 && !__isColorTransparent(borderColor)) {
        return {
          color: borderColor,
          side: side.toLowerCase(),
          width: styles['border' + side + 'Width'],
          style: borderStyle
        };
      }
    }
    return null;
  }

  // WCAG large text: 18pt (24px) or 14pt (18.66px) bold.
  function __isLargeText(styles) {
    const px = parseFloat(styles.fontSize);
    if (!px) return false;
    const pt = px * 0.75;
    const weight = styles.fontWeight;
    const bold = weight === 'bold' || parseInt(weight, 10) >= 700;
    return pt >= 18 || (pt >= 14 && bold);
  }

  // SC 1.4.11 applies to "the visual information required to identify user
  // interface components". Where a component paints a border that itself
  // reaches the threshold against the adjacent background, THAT border is the
  // boundary the user perceives, and the fill is then not additionally required
  // to contrast with the page. Standard accessible form styling (a white input
  // on a white page with a dark 2px border) depends on this.
  function __hasCompliantBorder(styles, backdrop, threshold) {
    const rendered = __getRenderedBorder(styles);
    if (!rendered) return null;
    const parsed = __parseRgb(rendered.color);
    if (!parsed) return null;
    const flattened = __blendOver(parsed, backdrop);
    const ratio = __getContrastRatio(flattened, backdrop);
    return ratio >= threshold ? { ratio: ratio, border: rendered } : null;
  }

  /**
   * SC 1.4.11 asks that the visual information needed to IDENTIFY a
   * component has 3:1 contrast, not that every painted edge does. A button
   * whose border is faint but whose label text or icon glyph clearly stands
   * out is identified by that text/glyph; the border is decoration.
   * Returns { by: 'text'|'icon'|null, ratio }.
   */
  function __hasAlternativeIdentifier(el, backdrop, threshold) {
    const styles = window.getComputedStyle(el);
    const ownBg = __parseRgb(styles.backgroundColor);
    const surface = (ownBg && ownBg.a > 0) ? __blendOver(ownBg, backdrop) : backdrop;

    // 1. Visible text label (against the surface it sits on; 4.5:1 because it is text)
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    if (!text.trim()) text = (el.innerText || '').trim();
    if (text.trim()) {
      const fg = __parseRgb(styles.color);
      if (fg) {
        const ratio = __getContrastRatio(__blendOver(fg, surface), surface);
        if (ratio >= Math.max(threshold, 4.5)) return { by: 'text', ratio };
      }
    }

    // 2. Icon glyph: inline SVG strokes/fills, or icon-font pseudo-element
    for (const svg of el.querySelectorAll('svg')) {
      if (svg.getAttribute('aria-hidden') === 'true' && !el.getAttribute('aria-label') && text.trim()) continue;
      const ss = window.getComputedStyle(svg);
      const parts = [svg, ...svg.querySelectorAll('path, line, circle, rect, polygon, polyline, ellipse, use')];
      for (const part of parts) {
        const ps = window.getComputedStyle(part);
        for (const prop of ['stroke', 'fill']) {
          let v = ps[prop];
          if (!v || v === 'none') continue;
          if (/currentcolor/i.test(v)) v = ss.color;
          const c = __parseRgb(v);
          if (!c || c.a === 0) continue;
          const ratio = __getContrastRatio(__blendOver(c, surface), surface);
          if (ratio >= threshold) return { by: 'icon', ratio };
        }
      }
    }
    for (const pseudo of ['::before', '::after']) {
      const ps = window.getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal' || ps.content === '""') continue;
      const c = __parseRgb(ps.color);
      if (!c) continue;
      const ratio = __getContrastRatio(__blendOver(c, surface), surface);
      if (ratio >= threshold) return { by: 'icon', ratio };
    }
    return { by: null, ratio: null };
  }
`;

module.exports = { injectableCode };
