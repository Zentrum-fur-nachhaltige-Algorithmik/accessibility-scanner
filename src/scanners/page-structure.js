/**
 * Page Structure Scanner.
 * WCAG 2.4.4, 2.4.9 (EN 301 549 9.2.4.4, 9.2.4.9).
 * Reports links whose accessible name does not identify where they go.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedUtils } = require('../utils/rendered');
const { injectableCode: accnameUtils } = require('../utils/accessible-name');
const log = require('../utils/logger').createLogger('page-structure');

class PageStructureScanner extends BaseScanner {
  constructor() {
    super('page-structure', {
      wcagCriteria: ['2.4.4', '2.4.9'],
      wcagPrinciple: 'operable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const links = await this.testLinkPurpose(page);

    return {
      scannerId: this.id,
      criteria: ['9.2.4.4', '9.2.4.9'],
      passed: links.violations.length === 0,
      violations: links.violations,
      summary: {
        totalLinks: links.totalLinks,
        violationCount: links.violations.length,
      },
    };
  }

  /**
   * SC 2.4.4 (In Context) and SC 2.4.9 (Link Only).
   */
  async testLinkPurpose(page) {
    const result = await page.evaluate((injectedCode) => {
      eval(injectedCode);

      // 2.4.9 asks whether the link text ALONE identifies the purpose. These
      // are the phrases that name an action without naming its target, in the
      // two languages this scanner reads. A phrase in a third language goes
      // unrecognised, which is why this reports 2.4.9 (AAA, advisory) and
      // never a 2.4.4 failure.
      const NAMES_NOTHING = new Set([
        'click here',
        'here',
        'read more',
        'more',
        'learn more',
        'view more',
        'view',
        'details',
        'download',
        'continue',
        'link',
        'this',
        'go',
        'hier',
        'hier klicken',
        'mehr',
        'mehr erfahren',
        'mehr lesen',
        'weiterlesen',
        'weiter',
        'weitere informationen',
        'klicken sie hier',
        'herunterladen',
        'ansehen',
      ]);

      // The programmatically determined context of a link: the enclosing
      // list item, cell, paragraph, heading or caption, minus the text of
      // every link inside it. What is left is what a screen reader can offer
      // in addition to the link's own name.
      const CONTEXT = 'li, td, th, p, dd, figcaption, blockquote, caption, h1, h2, h3, h4, h5, h6';
      function contextWords(link) {
        const container = link.parentElement && link.parentElement.closest(CONTEXT);
        if (!container) return '';
        const clone = container.cloneNode(true);
        clone.querySelectorAll('a[href]').forEach((a) => a.remove());
        return __visibleLabelNormalize(clone.textContent || '');
      }

      function getSelector(link, index) {
        if (link.id) return `a#${link.id}`;
        if (typeof link.className === 'string' && link.className.trim()) {
          return `a.${link.className.trim().split(/\s+/)[0]}`;
        }
        return `a:nth-of-type(${index + 1})`;
      }

      const violations = [];
      const links = Array.from(document.querySelectorAll('a[href]')).filter(__isRendered);

      links.forEach((link, index) => {
        const nameInfo = __accessibleNameInfo(link);
        const name = (nameInfo.name || '').trim();
        if (!name) return; // no accessible name at all: axe-core `link-name`

        const normalized = __visibleLabelNormalize(name);
        const selector = getSelector(link, index);

        // A name the author wrote (aria-label, aria-labelledby, title) is a
        // decision, not an accident of the markup, so shortness alone is not
        // evidence against it.
        const authored =
          nameInfo.source === 'aria-label' ||
          nameInfo.source === 'aria-labelledby' ||
          nameInfo.source === 'title';

        // Nothing to read: the name carries no letter or digit at all, or a
        // single one. Two characters can be a word ("UK") and one ideograph is
        // a word already, so both are left alone; the shape this catches is
        // the "v / t / e" of a navigation box and a bare arrow glyph. It is
        // reported only when the context adds no word either, which is what
        // makes it a 2.4.4 failure and not only a 2.4.9 one.
        const ideographic =
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name);
        if (!authored && !ideographic && normalized.length < 2) {
          if (contextWords(link).length > 0) return;
          violations.push({
            criterion: '9.2.4.4',
            wcagCriteria: ['2.4.4', '2.4.9'],
            element: selector,
            issue: 'link-name-identifies-nothing',
            severity: 'serious',
            description: `Link named "${name}" carries no word, and its surrounding list item, cell or paragraph adds none, so nothing identifies where it goes`,
            suggestion:
              'Name the destination in the link text, or in an aria-label when the visible text has to stay short.',
          });
          return;
        }

        if (NAMES_NOTHING.has(normalized)) {
          violations.push({
            criterion: '9.2.4.9',
            wcagCriteria: ['2.4.9'],
            element: selector,
            issue: 'link-purpose-needs-context',
            severity: 'moderate',
            description: `Link text "${name}" names an action but not its target, so the purpose is only available from the surrounding text`,
            suggestion:
              'Put the destination into the link text itself, for example "Read more about the 2026 timetable".',
          });
        }
      });

      return { totalLinks: links.length, violations };
    }, `${renderedUtils}\n${accnameUtils}`);

    log.debug(`    ${result.totalLinks} links, ${result.violations.length} without a purpose`);
    return result;
  }
}

module.exports = PageStructureScanner;
