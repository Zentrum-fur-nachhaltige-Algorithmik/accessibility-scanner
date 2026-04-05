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

const BaseScanner = require('./base-scanner');

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
          const label = nav.getAttribute('aria-label')
            || nav.getAttribute('aria-labelledby')
            || '';
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
      const searchForms = document.querySelectorAll(
        'form[role="search"], [role="search"]'
      );
      const searchInputs = document.querySelectorAll(
        'input[type="search"]'
      );
      if (searchForms.length > 0 || searchInputs.length > 0) {
        mechanisms.push({ type: 'search' });
      }

      // 3. Sitemap link
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      const sitemapLinks = allLinks.filter(a =>
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

      // 5. Breadcrumb
      const breadcrumbs = document.querySelectorAll(
        '[class*="breadcrumb"], [aria-label*="breadcrumb" i], ' +
        'nav[aria-label*="Breadcrumb" i], ol[class*="breadcrumb"]'
      );
      if (breadcrumbs.length > 0) {
        mechanisms.push({ type: 'breadcrumb' });
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
      const indexLinks = allLinks.filter(a =>
        /\b(index|a[\s-]?z|alle seiten|all pages)\b/i.test(a.textContent)
      );
      if (indexLinks.length > 0) {
        mechanisms.push({ type: 'index' });
      }

      // Process page heuristic: checkout/wizard/auth steps are exempt
      const isProcess = (() => {
        const url = window.location.href.toLowerCase();
        const bodyText = (document.body?.textContent || '').slice(0, 2000).toLowerCase();
        const processPatterns = [
          /checkout/i, /payment/i, /step\s*\d/i, /wizard/i,
          /sign[\s-]?in/i, /log[\s-]?in/i, /register/i, /registration/i,
          /reset[\s-]?password/i, /verify/i, /confirmation/i,
        ];
        return processPatterns.some(p => p.test(url) || p.test(bodyText));
      })();

      // Deduplicate by type
      const uniqueTypes = [...new Set(mechanisms.map(m => m.type))];

      return {
        mechanisms,
        uniqueTypes,
        count: uniqueTypes.length,
        isProcess,
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

    const violations = [];

    if (data.count < 2) {
      violations.push(this.formatViolation(
        '2.4.5',
        data.count === 0 ? 'serious' : 'moderate',
        `Page provides ${data.count} navigation mechanism(s) (${data.uniqueTypes.join(', ') || 'none'}). ` +
        'WCAG 2.4.5 requires at least 2 ways to locate a page (e.g., navigation menu, search, sitemap, table of contents, breadcrumb).',
        [],
        'https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html'
      ));
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
