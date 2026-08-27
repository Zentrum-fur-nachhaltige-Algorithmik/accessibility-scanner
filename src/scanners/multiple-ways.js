/**
 * Multiple Ways Scanner.
 * WCAG 2.4.5 (EN 301 549 9.2.4.5).
 * Counts navigation mechanisms (nav, search, sitemap, TOC, breadcrumb, footer nav, index)
 * and only asserts a violation when the page shows evidence of belonging to a larger site.
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
          // Skip breadcrumb navs, counted separately
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

      // Evidence that this page is part of a larger multi-page site (same
      // logic as the 2.4.5 check in page-structure.js): either (a) at least
      // 2 same-origin links to distinct paths (fragment-only, "javascript:",
      // "mailto:" and "tel:" links do not count, since none of them point at
      // another page), or (b) a breadcrumb-shaped trail with >= 2 steps.
      // (b) is independent of link functionality: a breadcrumb's structure
      // (Home > Section > Subsection) signals a position within a page
      // hierarchy even in a static preview whose crumbs are placeholders.
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

    // SC 2.4.5 is defined over a set of web pages in a site or process, so a
    // single page scanned in isolation cannot prove or disprove it: another
    // page of the same site may supply the missing mechanism.
    //
    // A full-severity violation therefore requires both:
    //  1. no explicit opt-out (`options.singlePageContext` or
    //     `options.skipMultiPageCriteria`, set by callers scanning a
    //     standalone page), and
    //  2. `data.hasEvidenceOfLargerSite`: real distinct internal links or a
    //     breadcrumb trail. Without that evidence a page with < 2 mechanisms
    //     is as likely a single-page site (out of scope) as a multi-page site
    //     missing navigation aids.
    // Every other case downgrades to an informational, low-confidence note.
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
        // No evidence this page is part of a larger site: emit an
        // informational, low-confidence note for whole-site review instead.
        const violation = this.formatViolation(
          '2.4.5',
          'minor',
          `This page provides ${data.count} navigation mechanism(s) (${data.uniqueTypes.join(', ') || 'none'}). ` +
            'WCAG 2.4.5 (Multiple Ways) is evaluated across an entire site or process, not one page in isolation. ' +
            'This cannot be confirmed as a violation without checking whether other pages of the site provide search, ' +
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
