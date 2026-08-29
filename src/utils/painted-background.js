/**
 * Browser-injectable resolution of what is actually painted behind text.
 * Exposes __paintedBackdrops(element, textRect) and __decideTextContrast(element),
 * which walk the ancestor chain, composite every translucent layer, resolve
 * gradient colour stops, drop background images that did not load and sample the
 * pixels of same-origin ones. Requires the __parseRgb, __getLuminance,
 * __getContrastRatio, __blendOver and __isLargeText helpers of browser-contrast.js.
 */

const injectableCode = `
  const __imageProbes = new Map();

  // An image that fails to load paints nothing, so the layer below it is what
  // the user sees. One probe per URL, reused across elements.
  function __probeBackgroundImage(url) {
    if (__imageProbes.has(url)) return __imageProbes.get(url);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ok: img.naturalWidth > 0 && img.naturalHeight > 0, img });
      img.onerror = () => resolve({ ok: false, img: null });
      img.src = url;
      if (img.complete) resolve({ ok: img.naturalWidth > 0 && img.naturalHeight > 0, img });
    });
    __imageProbes.set(url, p);
    return p;
  }

  // Split a comma separated CSS list without breaking inside function calls,
  // which every gradient and every url() with a comma in it contains.
  function __splitTopLevel(value) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        out.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(value.slice(start).trim());
    return out.filter(Boolean);
  }

  // Colour stops of a gradient. getComputedStyle serialises every colour in a
  // gradient as rgb()/rgba(), so the stops are readable without a CSS parser.
  function __gradientStops(layer) {
    const found = String(layer).match(/rgba?\\([^)]*\\)/g) || [];
    const stops = [];
    for (const token of found) {
      const c = __parseRgb(token);
      if (c) stops.push(c);
    }
    return stops;
  }

  function __sameColor(a, b) {
    return a.r === b.r && a.g === b.g && a.b === b.b && (a.a || 1) === (b.a || 1);
  }

  function __dedupeColors(list) {
    const out = [];
    for (const c of list) if (!out.some((o) => __sameColor(o, c))) out.push(c);
    return out;
  }

  function __withOpacity(color, opacity) {
    const a = (color.a === undefined ? 1 : color.a) * opacity;
    return { r: color.r, g: color.g, b: color.b, a: a };
  }

  function __cssLength(value, reference) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (s.endsWith('%')) return (parseFloat(s) / 100) * reference;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Rectangle a no-repeat background image paints inside the element's padding
   * box, from the computed background-size and background-position. Returns null
   * when the layer tiles, in which case it covers the whole box.
   */
  function __paintedImageRect(styles, box, natural) {
    const repeat = String(styles.backgroundRepeat).split(' ');
    const repeatX = repeat[0] !== 'no-repeat';
    const repeatY = (repeat[1] || repeat[0]) !== 'no-repeat';
    if (repeatX && repeatY) return null;

    const sizeRaw = String(styles.backgroundSize).split(' ');
    let w;
    let h;
    if (sizeRaw[0] === 'cover' || sizeRaw[0] === 'contain') {
      const scaleW = box.width / natural.width;
      const scaleH = box.height / natural.height;
      const scale = sizeRaw[0] === 'cover' ? Math.max(scaleW, scaleH) : Math.min(scaleW, scaleH);
      w = natural.width * scale;
      h = natural.height * scale;
    } else {
      w = sizeRaw[0] === 'auto' ? natural.width : __cssLength(sizeRaw[0], box.width);
      h = !sizeRaw[1] || sizeRaw[1] === 'auto' ? natural.height : __cssLength(sizeRaw[1], box.height);
      if (w === null || h === null) return null;
    }

    const posRaw = String(styles.backgroundPosition).split(' ');
    const x = __cssLength(posRaw[0], box.width - w);
    const y = __cssLength(posRaw[1] === undefined ? '50%' : posRaw[1], box.height - h);
    if (x === null || y === null) return null;

    return {
      left: box.left + (repeatX ? -1e6 : x),
      top: box.top + (repeatY ? -1e6 : y),
      width: repeatX ? 2e6 : w,
      height: repeatY ? 2e6 : h,
      imageLeft: box.left + x,
      imageTop: box.top + y,
      imageWidth: w,
      imageHeight: h,
    };
  }

  /**
   * Darkest and lightest pixel of the part of a loaded image that lies under
   * \`target\`. Returns null when the canvas is tainted by a cross-origin image,
   * where the pixels cannot be read at all.
   */
  function __sampleImage(img, painted, target) {
    const scaleX = img.naturalWidth / painted.imageWidth;
    const scaleY = img.naturalHeight / painted.imageHeight;
    let sx = Math.floor((target.left - painted.imageLeft) * scaleX);
    let sy = Math.floor((target.top - painted.imageTop) * scaleY);
    let sw = Math.ceil(target.width * scaleX);
    let sh = Math.ceil(target.height * scaleY);
    sx = Math.max(0, Math.min(sx, img.naturalWidth - 1));
    sy = Math.max(0, Math.min(sy, img.naturalHeight - 1));
    sw = Math.max(1, Math.min(sw, img.naturalWidth - sx));
    sh = Math.max(1, Math.min(sh, img.naturalHeight - sy));

    const maxSide = 32;
    const dw = Math.max(1, Math.min(maxSide, sw));
    const dh = Math.max(1, Math.min(maxSide, sh));
    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    let data;
    try {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      data = ctx.getImageData(0, 0, dw, dh).data;
    } catch (e) {
      return null;
    }

    let darkest = null;
    let lightest = null;
    let darkestLum = Infinity;
    let lightestLum = -Infinity;
    for (let i = 0; i < data.length; i += 4) {
      const c = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] / 255 };
      if (c.a === 0) continue;
      const lum = __getLuminance(c);
      if (lum < darkestLum) {
        darkestLum = lum;
        darkest = c;
      }
      if (lum > lightestLum) {
        lightestLum = lum;
        lightest = c;
      }
    }
    if (!darkest) return [];
    return __dedupeColors([darkest, lightest]);
  }

  /** Bounding box of the text an element paints, or its own box when it has none. */
  function __textRect(element) {
    let best = null;
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width <= 0 && r.height <= 0) continue;
        best = best
          ? {
              left: Math.min(best.left, r.left),
              top: Math.min(best.top, r.top),
              right: Math.max(best.right, r.right),
              bottom: Math.max(best.bottom, r.bottom),
            }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    }
    if (best) {
      return {
        left: best.left,
        top: best.top,
        width: Math.max(1, best.right - best.left),
        height: Math.max(1, best.bottom - best.top),
      };
    }
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: Math.max(1, box.width), height: Math.max(1, box.height) };
  }

  function __intersects(a, b) {
    return (
      a.left < b.left + b.width &&
      a.left + a.width > b.left &&
      a.top < b.top + b.height &&
      a.top + a.height > b.top
    );
  }

  /**
   * Every colour the backdrop of \`element\` can have where its text is painted.
   * Walks the ancestors, composites each translucent layer over the one below
   * and stops at the first opaque one; the canvas default is white. A layer
   * whose image is loaded but unreadable contributes black and white, so the
   * caller sees the whole range the ratio can take.
   */
  async function __paintedBackdrops(element) {
    const target = __textRect(element);
    const stack = [];
    let unresolved = null;
    let unresolvedSource = null;
    let current = element;

    while (current && current.nodeType === 1) {
      const styles = window.getComputedStyle(current);
      const opacity = Number.isFinite(parseFloat(styles.opacity)) ? parseFloat(styles.opacity) : 1;
      let opaque = false;

      const bgImage = styles.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        const box = current.getBoundingClientRect();
        for (const layer of __splitTopLevel(bgImage)) {
          if (/gradient\\(/i.test(layer)) {
            const stops = __dedupeColors(__gradientStops(layer));
            if (!stops.length) {
              unresolved = 'gradient';
              unresolvedSource = layer.slice(0, 160);
              stack.push({ colors: [{ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }] });
              opaque = true;
              break;
            }
            stack.push({ colors: stops.map((c) => __withOpacity(c, opacity)) });
            if (stops.every((c) => (c.a === undefined ? 1 : c.a) >= 1)) {
              opaque = true;
              break;
            }
            continue;
          }
          const urlMatch = layer.match(/url\\((['"]?)(.*?)\\1\\)/i);
          if (!urlMatch) continue;
          const probe = await __probeBackgroundImage(urlMatch[2]);
          if (!probe.ok) continue;
          const natural = { width: probe.img.naturalWidth, height: probe.img.naturalHeight };
          const painted = __paintedImageRect(styles, box, natural);
          if (painted && !__intersects(painted, target)) continue;
          const sampled = painted
            ? __sampleImage(probe.img, painted, target)
            : __sampleImage(
                probe.img,
                { imageLeft: box.left, imageTop: box.top, imageWidth: box.width || natural.width, imageHeight: box.height || natural.height },
                target
              );
          if (sampled && sampled.length) {
            stack.push({ colors: sampled.map((c) => __withOpacity(c, opacity)) });
            if (sampled.every((c) => c.a >= 1)) {
              opaque = true;
              break;
            }
            continue;
          }
          if (sampled && sampled.length === 0) continue;
          unresolved = 'image';
          unresolvedSource = urlMatch[2].slice(0, 160);
          stack.push({ colors: [{ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }] });
          opaque = true;
          break;
        }
      }
      if (opaque) break;

      const bgColor = __parseRgb(styles.backgroundColor);
      if (bgColor && bgColor.a > 0) {
        const layer = __withOpacity(bgColor, opacity);
        stack.push({ colors: [layer] });
        if (layer.a >= 1) break;
      }
      current = current.parentElement;
    }

    let candidates = [{ r: 255, g: 255, b: 255, a: 1 }];
    for (let i = stack.length - 1; i >= 0; i--) {
      const next = [];
      for (const base of candidates) for (const c of stack[i].colors) next.push(__blendOver(c, base));
      candidates = __dedupeColors(next).slice(0, 16);
    }
    return { candidates, unresolved, unresolvedSource, textRect: target };
  }

  /**
   * SC 1.4.3 for one element: the ratio of its text against every colour its
   * backdrop can have, against the 4.5:1 or 3:1 the font size and weight ask
   * for. \`decision\` is 'pass' when the lowest ratio clears the threshold,
   * 'fail' when the highest does not, and 'review' when the backdrop could not
   * be pinned down to one side of it.
   */
  async function __decideTextContrast(element) {
    const styles = window.getComputedStyle(element);
    const fg = __parseRgb(styles.color);
    if (!fg) return { decision: 'review', reason: 'no computed text colour' };
    const { candidates, unresolved, unresolvedSource } = await __paintedBackdrops(element);
    if (!candidates.length) return { decision: 'review', reason: 'no backdrop resolved' };

    const large = __isLargeText(styles);
    const threshold = large ? 3 : 4.5;
    let min = Infinity;
    let max = -Infinity;
    let worst = null;
    for (const bg of candidates) {
      const ratio = __getContrastRatio(__blendOver(fg, bg), bg);
      if (ratio < min) {
        min = ratio;
        worst = bg;
      }
      if (ratio > max) max = ratio;
    }

    const decision = min >= threshold ? 'pass' : max < threshold ? 'fail' : 'review';
    return {
      decision,
      threshold,
      large,
      minRatio: Math.round(min * 100) / 100,
      maxRatio: Math.round(max * 100) / 100,
      foreground: 'rgb(' + fg.r + ', ' + fg.g + ', ' + fg.b + ')',
      background: worst ? 'rgb(' + worst.r + ', ' + worst.g + ', ' + worst.b + ')' : null,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      unresolved,
      unresolvedSource,
    };
  }
`;

module.exports = { injectableCode };
