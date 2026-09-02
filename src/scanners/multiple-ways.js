/**
 * Multiple Ways Scanner.
 * WCAG 2.4.5 (EN 301 549 9.2.4.5).
 *
 * "More than one way is available to locate a web page WITHIN A SET OF WEB
 * PAGES". The set is the subject of the clause and this scan sees one page, so
 * the criterion cannot be decided here: a compliant site may serve a page that
 * itself carries only one mechanism. The scanner counts what this page offers
 * and asks the question with the inventory attached.
 */

const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');

class MultipleWaysScanner extends BaseScanner {
  constructor() {
    super('multiple-ways', {
      wcagCriteria: ['2.4.5'],
      wcagPrinciple: 'operable',
    });
  }

  async scan(page, options = {}) {
    const data = await page.evaluate((injectedCode) => {
      eval(injectedCode);
      const mechanisms = [];
      const allLinks = Array.from(document.querySelectorAll('a[href]'));

      const breadcrumbs = Array.from(
        document.querySelectorAll(
          '[class*="breadcrumb"], [aria-label*="breadcrumb" i], ol[class*="breadcrumb"]'
        )
      );

      // 1. A navigation region with a link cluster.
      for (const nav of document.querySelectorAll('nav, [role="navigation"]')) {
        if (!__isRendered(nav)) continue;
        if (breadcrumbs.includes(nav)) continue; // counted as a breadcrumb below
        const links = nav.querySelectorAll('a[href]');
        if (links.length > 2) {
          mechanisms.push({ type: 'nav', linkCount: links.length });
          break;
        }
      }

      // 2. A search field. Presence, not rendering: a search behind a header
      // toggle is a mechanism the site offers, and so is a plain text input
      // named q or suche, which is how most search forms are written.
      const searchFields = Array.from(
        document.querySelectorAll(
          'input[type="search"], [role="search"], [role="search"] input, ' +
            'input[name="q"], input[name="s"], input[name="search"], input[name="suche"], ' +
            'input[name="query"], form[role="search"] input, form[action*="search"] input[type="text"]'
        )
      );
      if (searchFields.length > 0) mechanisms.push({ type: 'search' });

      // 3. A link to a sitemap. The mechanism is named by its destination, so
      // this is the one place a word is the evidence.
      const sitemapLinks = allLinks.filter((a) => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        return /sitemap|site-map/.test(href) || /\bsite\s?map\b/i.test(a.textContent || '');
      });
      if (sitemapLinks.length > 0) mechanisms.push({ type: 'sitemap' });

      // 4. A table of contents: three or more same-document links that resolve
      // to a target, gathered in one list or navigation region.
      const inPage = allLinks.filter((a) => {
        const href = a.getAttribute('href') || '';
        if (!href.startsWith('#') || href.length < 2) return false;
        try {
          return !!document.getElementById(decodeURIComponent(href.slice(1)));
        } catch (e) {
          return false;
        }
      });
      const byContainer = new Map();
      for (const link of inPage) {
        const container = link.closest('nav, ol, ul, [role="directory"]');
        if (!container) continue;
        byContainer.set(container, (byContainer.get(container) || 0) + 1);
      }
      const tocCount = Math.max(0, ...byContainer.values());
      if (tocCount >= 3) mechanisms.push({ type: 'toc', linkCount: tocCount });

      // 5. A breadcrumb trail with at least two working steps.
      for (const bc of breadcrumbs) {
        const functional = Array.from(bc.querySelectorAll('a[href]')).filter((a) => {
          const href = (a.getAttribute('href') || '').trim();
          return href && href !== '#' && href !== '#!' && !href.startsWith('javascript:');
        });
        if (functional.length >= 2) {
          mechanisms.push({ type: 'breadcrumb', linkCount: functional.length });
          break;
        }
      }

      // 6. A footer link block listing pages of the site (technique G126).
      for (const footer of document.querySelectorAll('footer, [role="contentinfo"]')) {
        const footerLinks = footer.querySelectorAll('a[href]');
        if (footerLinks.length > 3) {
          mechanisms.push({ type: 'footer-nav', linkCount: footerLinks.length });
          break;
        }
      }

      // 2.4.5 exempts a web page that is a step in a process. The structural
      // evidence for a step is that the page's purpose is to submit data: a
      // form that posts, or that asks for a password or a one-time code,
      // holding at least two fields.
      const isProcessStep = Array.from(document.querySelectorAll('form')).some((form) => {
        const fields = form.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
        );
        if (fields.length < 2) return false;
        const method = (form.getAttribute('method') || '').toLowerCase();
        const secret = form.querySelector(
          'input[type="password"], input[autocomplete*="one-time"]'
        );
        return method === 'post' || !!secret;
      });

      // Evidence that this page is part of a larger site: at least two
      // same-origin links to distinct paths (fragment, javascript:, mailto:
      // and tel: links point at no other page), or a breadcrumb trail, whose
      // structure places the page inside a hierarchy even when its crumbs are
      // placeholders in a static preview.
      const internalPaths = new Set();
      for (const link of allLinks) {
        const raw = (link.getAttribute('href') || '').trim();
        if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) continue;
        let url;
        try {
          url = new URL(raw, document.baseURI);
        } catch (e) {
          continue;
        }
        if (url.origin !== location.origin) continue;
        internalPaths.add(url.pathname);
      }
      const breadcrumbSteps = Math.max(
        0,
        ...breadcrumbs.map((bc) => bc.querySelectorAll('a, li').length)
      );
      const hasEvidenceOfLargerSite = internalPaths.size >= 2 || breadcrumbSteps >= 2;

      const uniqueTypes = [...new Set(mechanisms.map((m) => m.type))];
      return {
        mechanisms,
        uniqueTypes,
        count: uniqueTypes.length,
        isProcessStep,
        hasEvidenceOfLargerSite,
      };
    }, renderedCode);

    // SC 2.4.5 is defined over a set of web pages in a site or process, so a
    // single page scanned in isolation cannot decide it on its own: another
    // page of the same site may carry the missing mechanism. It is reported
    // only when the caller has not opted out of multi-page criteria
    // (`options.singlePageContext` / `options.skipMultiPageCriteria`, set when
    // scanning a standalone page), the page shows evidence of belonging to a
    // larger site, and it is not a step in a process.
    const singlePageContext =
      options.singlePageContext === true || options.skipMultiPageCriteria === true;
    const applies = !singlePageContext && data.hasEvidenceOfLargerSite && !data.isProcessStep;

    const needsReview = [];
    if (applies && data.count < 2) {
      needsReview.push(
        this.formatViolation(
          '2.4.5',
          'moderate',
          `This page offers ${data.count} way(s) to locate a page of the site (${data.uniqueTypes.join(', ') || 'none'}). ` +
            'WCAG 2.4.5 asks for more than one way within the set of pages, which a single page cannot show.',
          [],
          'https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html',
          'info',
          {
            verdict: 'needs-review',
            dossier: {
              question: 'Does the site offer a second way to reach its pages?',
              element: { selector: 'document', html: null, role: null, name: null },
              measurements: {
                mechanismCount: data.count,
                mechanisms: data.uniqueTypes.join(', ') || 'none',
                isProcessStep: data.isProcessStep,
              },
              context: { found: data.mechanisms },
            },
          }
        )
      );
    }

    return {
      scannerId: this.id,
      passed: true,
      violations: [],
      needsReview,
      summary: {
        openQuestions: needsReview.length,
        mechanisms: data.uniqueTypes,
        mechanismCount: data.count,
        isProcessStep: data.isProcessStep,
        details: data.mechanisms,
      },
    };
  }
}

module.exports = MultipleWaysScanner;
