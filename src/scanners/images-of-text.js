/**
 * Images of Text Scanner.
 * WCAG 1.4.5, 1.4.9 (EN 301 549 9.1.4.5, 9.1.4.9).
 * Reports images whose own source proves they render text: an SVG referenced by
 * an <img>, an <object> or a CSS background whose markup contains a text run.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');

class ImagesOfTextScanner extends BaseScanner {
  constructor() {
    super('images-of-text', {
      wcagCriteria: ['1.4.5', '1.4.9'],
      wcagPrinciple: 'perceivable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const result = await page.evaluate(async (injectedCode) => {
      eval(injectedCode);

      // Only images the scan can read the source of are decidable. A raster
      // image would need OCR, which this scanner does not have, so a
      // photograph, a screenshot and a logo are all left alone.
      const MAX_SOURCES = 40;

      function getSelector(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '')
        );
      }

      /** The SVG source behind a URL, or null when it is not readable SVG. */
      async function svgSource(url) {
        if (!url) return null;
        if (url.startsWith('data:')) {
          const head = url.slice(5, url.indexOf(','));
          if (!/image\/svg\+xml/i.test(head)) return null;
          const body = url.slice(url.indexOf(',') + 1);
          try {
            return /;base64/i.test(head)
              ? atob(body.replace(/\s+/g, ''))
              : decodeURIComponent(body);
          } catch (e) {
            return null; // truncated or invalid encoding: nothing is proven
          }
        }
        let parsed;
        try {
          parsed = new URL(url, document.baseURI);
        } catch (e) {
          return null;
        }
        if (parsed.origin !== location.origin) return null; // unreadable, undecidable
        if (!/\.svg$/i.test(parsed.pathname)) return null;
        try {
          const res = await fetch(parsed.href);
          if (!res.ok) return null;
          return await res.text();
        } catch (e) {
          return null;
        }
      }

      /** The text runs an SVG paints, ignoring markup that is not rendered. */
      function svgTextRuns(source) {
        let doc;
        try {
          doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        } catch (e) {
          return [];
        }
        if (!doc || doc.querySelector('parsererror')) return [];
        const runs = [];
        for (const node of doc.querySelectorAll('text, textPath')) {
          if (node.closest('defs, clipPath, mask, symbol')) continue;
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) runs.push(text);
        }
        return runs;
      }

      // 1.4.5 exempts logotypes. A brand mark is the image of a link that
      // leads back to the site root, which is how a site's logo is marked up.
      function isLogotype(el) {
        const link = el.closest('a[href]');
        if (!link) return false;
        let href;
        try {
          href = new URL(link.getAttribute('href'), document.baseURI);
        } catch (e) {
          return false;
        }
        return href.origin === location.origin && (href.pathname === '/' || href.pathname === '');
      }

      const candidates = [];
      for (const img of document.querySelectorAll('img, object[data], embed[src]')) {
        const url =
          img.tagName === 'OBJECT' ? img.getAttribute('data') : img.getAttribute('src') || img.src;
        candidates.push({ el: img, url, via: 'source' });
      }
      for (const el of document.querySelectorAll('*')) {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') continue;
        const m = bg.match(/url\((['"]?)([^)]*?)\1\)/);
        if (m && m[2]) candidates.push({ el, url: m[2], via: 'background-image' });
      }

      const violations = [];
      const sources = new Map();
      const reported = new Set();
      let inspected = 0;

      for (const candidate of candidates) {
        if (!__isRendered(candidate.el)) continue;
        if (reported.has(candidate.el)) continue;
        if (!sources.has(candidate.url)) {
          if (sources.size >= MAX_SOURCES) continue;
          sources.set(candidate.url, await svgSource(candidate.url));
        }
        const source = sources.get(candidate.url);
        if (!source) continue;
        inspected++;
        const runs = svgTextRuns(source);
        if (runs.length === 0) continue;
        if (isLogotype(candidate.el)) continue;
        reported.add(candidate.el);
        const text = runs.join(' ');
        violations.push({
          criterion: '9.1.4.5',
          // The finding fails 1.4.5 and, since the image is not a logotype,
          // 1.4.9 as well.
          wcagCriteria: ['1.4.5', '1.4.9'],
          element: getSelector(candidate.el),
          issue: 'image-of-text',
          description: `The image rendered by this ${candidate.via} is an SVG that paints the text "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}", which the user cannot resize, recolour or select`,
          severity: 'serious',
          detectedText: text.substring(0, 200),
          suggestion:
            'Render the text as HTML text styled with CSS, and keep the image for what is not text.',
        });
      }

      return { violations, imagesInspected: inspected, sourcesRead: sources.size };
    }, renderedCode);

    return {
      scannerId: this.id,
      criterion: '9.1.4.5',
      passed: result.violations.length === 0,
      violations: result.violations,
      summary: {
        imagesWithReadableText: result.imagesInspected,
        sourcesRead: result.sourcesRead,
        violationCount: result.violations.length,
      },
    };
  }
}

module.exports = ImagesOfTextScanner;
