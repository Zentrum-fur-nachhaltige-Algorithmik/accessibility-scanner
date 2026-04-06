/**
 * Browser-injectable contrast utility functions.
 *
 * These functions run inside Puppeteer's page.evaluate() context (browser, not Node.js).
 * Import and inject the code string into page.evaluate to use them.
 *
 * Provides: parseRgb, getLuminance, getContrastRatio, getEffectiveBackgroundColor
 */

const injectableCode = `
  function __parseRgb(rgbString) {
    if (!rgbString) return null;
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
    // Handle rgb/rgba
    const match = rgbString.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    if (!match) return null;
    return {
      r: parseInt(match[1]),
      g: parseInt(match[2]),
      b: parseInt(match[3]),
      a: match[4] ? parseFloat(match[4]) : 1
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

  function __getEffectiveBackgroundColor(element) {
    let current = element;
    while (current && current !== document.documentElement) {
      const bgColor = window.getComputedStyle(current).backgroundColor;
      const parsed = __parseRgb(bgColor);
      if (parsed && parsed.a > 0) {
        return parsed;
      }
      current = current.parentElement;
    }
    // Default to white
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function __isColorTransparent(colorStr) {
    if (!colorStr) return true;
    if (colorStr === 'transparent') return true;
    const parsed = __parseRgb(colorStr);
    if (!parsed) return true;
    return parsed.a === 0;
  }
`;

module.exports = { injectableCode };
