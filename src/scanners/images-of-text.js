/**
 * Images of Text Scanner.
 * WCAG 1.4.5, 1.4.9 (EN 301 549 9.1.4.5, 9.1.4.9).
 * Reports images whose own source proves they render text: an SVG referenced by
 * an <img>, an <object> or a CSS background whose markup contains a text run.
 *
 * Whether the presentation of that text is essential is not readable from the
 * page, and SC 1.4.5 exempts it when it is, so the recognised essential cases
 * (a logotype, a label inside a chart or diagram, a font specimen) produce
 * nothing and everything else is a question for a reviewer.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');

class ImagesOfTextScanner extends BaseScanner {
  constructor() {
    super('images-of-text', {
      // 1.4.9 (AAA, no exception) is a different measurement: it asks whether
      // the image is a logotype and nothing else. Nothing here tests it.
      wcagCriteria: ['1.4.5'],
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

      // SC 1.4.5 exempts a logotype and text whose particular presentation is
      // essential to the information conveyed. Three shapes of that exception
      // are readable from the page.

      /** The site's own name, from <title>, og:site_name or the site root link. */
      function siteNames() {
        const names = [];
        const title = (document.title || '').trim();
        if (title) names.push(title.split(/\s*[|\u2013-]\s*/)[0].trim());
        const og = document.querySelector('meta[property="og:site_name"]');
        if (og && og.content) names.push(og.content.trim());
        return names.filter(Boolean).map((n) => n.toLowerCase());
      }
      const SITE_NAMES = siteNames();

      function isLogotype(el, runs) {
        const link = el.closest('a[href]');
        if (link) {
          let href = null;
          try {
            href = new URL(link.getAttribute('href'), document.baseURI);
          } catch (e) {
            href = null;
          }
          if (
            href &&
            href.origin === location.origin &&
            (href.pathname === '/' || href.pathname === '')
          ) {
            return true;
          }
        }
        // A brand mark in the page header, painting the site's own name.
        if (!el.closest('header, [role="banner"]')) return false;
        const painted = runs.join(' ').trim().toLowerCase();
        if (!painted) return false;
        return SITE_NAMES.some((name) => name && (name === painted || painted.includes(name)));
      }

      /**
       * A label inside a chart, diagram or map: the text sits at a position
       * that carries meaning, so it cannot be lifted out into running text.
       */
      function isInsideDiagram(el, source) {
        const figure = el.closest('figure');
        if (figure && figure.querySelector('figcaption')) return true;
        const role = el.getAttribute('role');
        if (role !== 'img' && role !== 'graphics-document') return false;
        let doc;
        try {
          doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        } catch (e) {
          return false;
        }
        if (!doc || !doc.documentElement || doc.querySelector('parsererror')) return false;
        const shapes = doc.querySelectorAll('path, line, polyline, polygon, rect, circle, g');
        const texts = doc.querySelectorAll('text, textPath');
        return shapes.length >= texts.length;
      }

      /**
       * A font specimen: the image IS the typeface being shown, so the text
       * has to be the picture.
       */
      function isFontSpecimen(el, source) {
        const context = [
          el.getAttribute('alt') || '',
          el.getAttribute('aria-label') || '',
          typeof el.className === 'string' ? el.className : '',
          el.closest('figure') ? el.closest('figure').textContent : '',
          source.slice(0, 2000),
        ]
          .join(' ')
          .toLowerCase();
        return /font-specimen|specimen|schriftmuster|typeface|schriftart/.test(context);
      }

      /** Is the same text also on the page as real text near the image? */
      function repeatedAsText(el, runs) {
        const painted = runs.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (painted.length < 3) return false;
        const scope = el.closest('figure, section, article, header, main') || document.body;
        const text = (scope.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return text.includes(painted);
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

      const questions = [];
      const sources = new Map();
      const reported = new Set();
      let inspected = 0;
      let exempt = 0;

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
        if (
          isLogotype(candidate.el, runs) ||
          isInsideDiagram(candidate.el, source) ||
          isFontSpecimen(candidate.el, source)
        ) {
          exempt++;
          continue;
        }
        // The same words in real text beside the image: nothing is lost.
        if (repeatedAsText(candidate.el, runs)) continue;
        reported.add(candidate.el);
        const text = runs.join(' ');
        questions.push({
          element: getSelector(candidate.el),
          via: candidate.via,
          text: text.substring(0, 200),
          html: candidate.el.outerHTML ? candidate.el.outerHTML.substring(0, 200) : null,
          name: candidate.el.getAttribute('alt') || candidate.el.getAttribute('aria-label') || null,
        });
      }

      return { questions, imagesInspected: inspected, exempt, sourcesRead: sources.size };
    }, renderedCode);

    return {
      scannerId: this.id,
      criterion: '9.1.4.5',
      passed: true,
      violations: [],
      // Whether the particular presentation of this text is essential is a
      // judgement about the content, not a measurement of the page.
      needsReview: result.questions.map((q) => this._toNeedsReview(q)),
      summary: {
        imagesWithReadableText: result.imagesInspected,
        sourcesRead: result.sourcesRead,
        essentialExceptions: result.exempt,
        openQuestions: result.questions.length,
      },
    };
  }

  _toNeedsReview(question) {
    return this.formatViolation(
      'image-of-text',
      'moderate',
      `The image rendered by this ${question.via} is an SVG that paints the text "${question.text.substring(0, 80)}${question.text.length > 80 ? '...' : ''}", which the user cannot resize, recolour or select`,
      [{ selector: question.element }],
      'https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html',
      'info',
      {
        verdict: 'needs-review',
        dossier: {
          question: `Is this presentation essential (WCAG 1.4.5)? The image paints "${question.text.substring(0, 80)}" and the same words are not on the page as text.`,
          element: {
            selector: question.element,
            html: question.html,
            role: 'img',
            name: question.name,
          },
          measurements: { renderedText: question.text, via: question.via },
          context: {
            exceptions: 'logotype, a label inside a chart or diagram, a font specimen',
          },
        },
      }
    );
  }
}

module.exports = ImagesOfTextScanner;
