/**
 * Multiple Ways Scanner (deterministic)
 *
 * Covers:
 * - 2.4.5 Multiple Ways (Level AA)
 *
 * Checks that more than one navigation mechanism is available
 * to locate a page within the site (nav, search, sitemap, TOC,
 * breadcrumb, footer nav, index).
 */

const BaseScanner = require('../core/base-scanner');

class MultipleWaysScanner extends BaseScanner {
  constructor() {
    super('multiple-ways', {
      wcagCriteria: ['2.4.5'],
      wcagPrinciple: 'operable',
    });
  }

  async scan(page, options = {}) {
    const data = await page.evaluate(() => {
      const mechanisms = [];

      // 1. Nav elements with real links
      const navs = document.querySelectorAll('nav, [role="navigation"]');
      for (const nav of navs) {
        const links = nav.querySelectorAll('a[href]');
        if (links.length > 2) {
          const label = nav.getAttribute('aria-label') || nav.getAttribute('aria-labelledby') || '';
          // Skip breadcrumb navs — counted separately
          if (/breadcrumb/i.test(label) || /breadcrumb/i.test(nav.className)) continue;
          mechanisms.push({
            type: 'nav',
            label: label.slice(0, 80),
            linkCount: links.length,
          });
        }
      }

      // 2. Search functionality
      const searchForms = document.querySelectorAll('form[role="search"], [role="search"]');
      const searchInputs = document.querySelectorAll('input[type="search"]');
      if (searchForms.length > 0 || searchInputs.length > 0) {
        mechanisms.push({ type: 'search' });
      }

      // 3. Sitemap link
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      const sitemapLinks = allLinks.filter((a) =>
        /sitemap|site[\s-]?map/i.test(a.textContent + ' ' + (a.getAttribute('href') || ''))
      );
      if (sitemapLinks.length > 0) {
        mechanisms.push({ type: 'sitemap' });
      }

      // 4. Table of contents
      const toc = document.querySelectorAll(
        '[class*="toc"], [class*="table-of-contents"], [id*="toc"], ' +
          '[role="directory"], nav[aria-label*="content" i], nav[aria-label*="Inhalt" i]'
      );
      if (toc.length > 0) {
        mechanisms.push({ type: 'toc' });
      }

      // 5. Breadcrumb (validate links are functional, not just href="#")
      const breadcrumbs = document.querySelectorAll(
        '[class*="breadcrumb"], [aria-label*="breadcrumb" i], ' +
          'nav[aria-label*="Breadcrumb" i], ol[class*="breadcrumb"]'
      );
      if (breadcrumbs.length > 0) {
        for (const bc of breadcrumbs) {
          const links = bc.querySelectorAll('a[href]');
          const functional = Array.from(links).filter((a) => {
            const href = (a.getAttribute('href') || '').trim();
            return href && href !== '#' && href !== '#!' && !href.startsWith('javascript:');
          });
          if (functional.length >= 2) {
            mechanisms.push({ type: 'breadcrumb', linkCount: functional.length });
            break;
          }
        }
      }

      // 6. Footer nav with substantial links
      const footers = document.querySelectorAll('footer, [role="contentinfo"]');
      for (const footer of footers) {
        const footerLinks = footer.querySelectorAll('a[href]');
        if (footerLinks.length > 3) {
          mechanisms.push({ type: 'footer-nav', linkCount: footerLinks.length });
          break;
        }
      }

      // 7. A-Z / Index links
      const indexLinks = allLinks.filter((a) =>
        /\b(index|a[\s-]?z|alle seiten|all pages)\b/i.test(a.textContent)
      );
      if (indexLinks.length > 0) {
        mechanisms.push({ type: 'index' });
      }

      // Process page heuristic: checkout/wizard/auth steps are exempt
      // Only match on URL, page title, and H1 to avoid false positives from
      // pages that merely mention these words in body content
      const isProcess = (() => {
        const url = window.location.href.toLowerCase();
        const title = (document.title || '').toLowerCase();
        const h1 = (document.querySelector('h1')?.textContent || '').toLowerCase();
        const processContext = url + ' ' + title + ' ' + h1;
        const processPatterns = [
          /checkout/i,
          /payment/i,
          /step\s*\d/i,
          /wizard/i,
          /sign[\s-]?in/i,
          /log[\s-]?in/i,
          /register/i,
          /registration/i,
          /reset[\s-]?password/i,
          /verify/i,
          /confirmation/i,
        ];
        return processPatterns.some((p) => p.test(processContext));
      })();

      // Deduplicate by type
      const uniqueTypes = [...new Set(mechanisms.map((m) => m.type))];

      // Evidence that this page is actually part of a larger multi-page site
      // (mirrors the self-detection in page-structure-scanner.js's identical
      // 2.4.5/9.2.4.5 check): either (a) at least 2 same-origin links to
      // genuinely distinct paths — fragment-only ("#..."), "javascript:",
      // "mailto:", and "tel:" links don't count, since none of them point at
      // "another page" — or (b) a breadcrumb-shaped trail with >= 2 steps.
      // (b) is deliberately independent of link functionality: a breadcrumb's
      // STRUCTURE (Home > Section > Subsection > ...) signals a position
      // within a page hierarchy even in a static fixture/preview that has no
      // real backing subpages to link to, so its crumbs are placeholders.
      const internalPaths = new Set();
      allLinks.forEach((link) => {
        const raw = (link.getAttribute('href') || '').trim();
        if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) {
          return;
        }
        let url;
        try {
          url = new URL(raw, document.baseURI);
        } catch (e) {
          return;
        }
        if (url.origin !== location.origin) return;
        internalPaths.add(url.pathname);
      });

      let breadcrumbSteps = 0;
      for (const bc of breadcrumbs) {
        const steps = bc.querySelectorAll('a, li').length;
        if (steps > breadcrumbSteps) breadcrumbSteps = steps;
      }

      const hasEvidenceOfLargerSite = internalPaths.size >= 2 || breadcrumbSteps >= 2;

      return {
        mechanisms,
        uniqueTypes,
        count: uniqueTypes.length,
        isProcess,
        hasEvidenceOfLargerSite,
      };
    });

    // Process pages are exempt from 2.4.5
    if (data.isProcess) {
      return {
        scannerId: this.id,
        passed: true,
        violations: [],
        summary: {
          totalIssues: 0,
          note: 'Page appears to be a process step (exempt from 2.4.5)',
          mechanisms: data.uniqueTypes,
        },
      };
    }

    // SC 2.4.5 "Multiple Ways" is defined over a *set of web pages* in a site
    // or process (WCAG: "More than one way is available to locate a Web page
    // within a set of Web pages") — a single page scanned in isolation cannot
    // prove or disprove it, since another page of the same site may supply
    // the missing mechanism. Reporting a full-severity violation from one
    // page alone is a category error and is exactly the false-positive this
    // gate exists to prevent.
    //
    // Two independent signals gate full-severity reporting, mirroring how
    // `page-structure-scanner.js` gates its identical 2.4.5/9.2.4.5 check:
    //  1. An explicit opt-out: a caller that KNOWS it is scanning a
    //     standalone/single page (an isolated fixture, a one-page preview, a
    //     single-page brochure site) sets `options.singlePageContext` or
    //     `options.skipMultiPageCriteria`.
    //  2. Self-detection: even with no opt-out passed (the default — nothing
    //     currently sets one), `data.hasEvidenceOfLargerSite` tells us
    //     whether the page itself looks like part of a larger site (real
    //     distinct internal links, or a breadcrumb trail). Absent that
    //     evidence, a page with < 2 mechanisms is exactly as likely to be a
    //     deliberately single-page site (out of scope for 2.4.5) as it is a
    //     multi-page site missing navigation aids — so it doesn't warrant a
    //     full-severity claim on its own.
    //
    // A full-severity violation therefore requires BOTH: no opt-out, AND
    // real evidence this page belongs to a bigger site. Every other case
    // (opted out, or no such evidence) downgrades to an informational,
    // low-confidence note instead of asserting a violation outright — this
    // is what keeps genuinely single-page fixtures/sites from being flagged
    // for "only 1 way to locate content" while still catching real
    // multi-page-site pages like bad-multiple-ways.html (its breadcrumb
    // trail alone is 5 steps deep, well past the >= 2 threshold).
    const singlePageContext =
      options.singlePageContext === true || options.skipMultiPageCriteria === true;
    const assertFullViolation = !singlePageContext && data.hasEvidenceOfLargerSite;

    const violations = [];

    if (data.count < 2) {
      if (assertFullViolation) {
        violations.push(
          this.formatViolation(
            '2.4.5',
            data.count === 0 ? 'serious' : 'moderate',
            `Page provides ${data.count} navigation mechanism(s) (${data.uniqueTypes.join(', ') || 'none'}). ` +
              'WCAG 2.4.5 requires at least 2 ways to locate a page (e.g., navigation menu, search, sitemap, table of contents, breadcrumb).',
            [],
            'https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html'
          )
        );
      } else {
        // Don't assert a violation from a single page with no evidence it's
        // part of a larger site — downgrade to an informational,
        // low-confidence note that flags it for whole-site review instead.
        const violation = this.formatViolation(
          '2.4.5',
          'minor',
          `This page provides ${data.count} navigation mechanism(s) (${data.uniqueTypes.join(', ') || 'none'}). ` +
            'WCAG 2.4.5 (Multiple Ways) is evaluated across an entire site or process, not one page in isolation — ' +
            'this cannot be confirmed as a violation without checking whether other pages of the site provide search, ' +
            'a sitemap, or another way to locate content.',
          [],
          'https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html',
          'info'
        );
        violation.confidence = 'low';
        violations.push(violation);
      }
    }

    return {
      scannerId: this.id,
      passed: violations.length === 0,
      violations,
      summary: {
        totalIssues: violations.length,
        mechanisms: data.uniqueTypes,
        mechanismCount: data.count,
        details: data.mechanisms,
      },
    };
  }
}

module.exports = MultipleWaysScanner;
