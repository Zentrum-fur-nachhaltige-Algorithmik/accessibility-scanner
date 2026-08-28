/**
 * Accessibility Statement Scanner.
 * EN 301 549 clause 12.2.2 (the accessibility statement of the European
 * Accessibility Act / Directive (EU) 2016/2102).
 * Answers two questions: does the site link a statement, and does that
 * statement carry the three declarations the clause asks for (conformance
 * status, feedback contact point, preparation or review date). Everything is
 * read on the statement page itself; no other page of the site is audited as
 * if it were the statement.
 */
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const log = require('../utils/logger').createLogger('accessibility-statement');
const {
  findStatementLink,
  missingStatementViolation,
} = require('../utils/accessibility-statement');

/** Twelve months, the review interval the directive asks for. */
function isOlderThanAYear(date) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  return date < twelveMonthsAgo;
}

class AccessibilityStatementScanner extends BaseScanner {
  constructor() {
    super('accessibility-statement', {
      wcagCriteria: ['EN 301 549 12.1'],
      wcagPrinciple: 'robust',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page and
   * navigates to the statement it links, so it owns its tab.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = { timeout: TIMEOUTS.navigation, ...options };

    const results = await this.analyzeAccessibilityStatement(page, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['EAA-Statement', 'EN-301-549-12.1.1'],
      passed: results.violations.length === 0,
      violations: results.violations,
      summary: {
        statementExists: results.statementExists,
        statementAccessible: results.statementAccessible,
        statementUrl: results.statementUrl,
        conformanceStatus: results.conformanceStatus,
        contactMechanismProvided: results.contactMechanismProvided,
        lastUpdated: results.lastUpdated,
      },
    };
  }

  /**
   * Find the statement, read it where it lives, and report what it omits.
   */
  async analyzeAccessibilityStatement(page, options) {
    const violations = [];
    const empty = {
      statementExists: false,
      statementAccessible: false,
      statementUrl: null,
      conformanceStatus: null,
      contactMechanismProvided: false,
      lastUpdated: null,
    };

    const statementLink = await findStatementLink(page);

    if (!statementLink.found) {
      // Exactly ONE finding, and not `critical`. Every other rule of this
      // scanner describes a property OF the statement (missing contact,
      // missing review date, missing conformance status) and is undecidable
      // while no statement exists. See src/utils/accessibility-statement.js.
      violations.push(missingStatementViolation());
      return { violations, ...empty };
    }

    const sameDocument = this.isSameDocument(page.url(), statementLink.url);

    // A statement link that carries no origin of its own is only a path until
    // it is resolved against the origin the page was published on, which is
    // not always the origin it is served from.
    const origin = await this.originOfRecord(page);
    const statementUrl = this.isSameOrigin(page.url(), statementLink.url)
      ? this.rebase(statementLink.url, origin)
      : statementLink.url;

    if (!sameDocument) {
      try {
        const response = await page.goto(statementUrl, {
          waitUntil: 'networkidle0',
          timeout: options.timeout,
        });
        // An error page still loads, and its body would then be measured for a
        // review date and a conformance level it can never contain. A broken
        // link is one finding about the link, not three about its content.
        const status = response ? response.status() : 0;
        if (status >= 400) throw new Error(`HTTP ${status}`);
      } catch (error) {
        // A transport failure on another origin is as likely to be the
        // scanning environment (no route to that host) as a dead statement,
        // and the statement of a site is often published on a sibling domain.
        // Only a status code, or a failure on the origin that was just
        // scanned successfully, is evidence about the link.
        if (!/^HTTP \d/.test(error.message) && !this.isSameOrigin(page.url(), statementUrl)) {
          return { violations, ...empty, statementExists: true, statementUrl };
        }
        // The path was only ever resolved against a loopback address or a
        // file, so its status says nothing about the site's statement.
        // Unverifiable is not broken.
        if (!this.isRealOrigin(statementUrl)) {
          return { violations, ...empty, statementExists: true, statementUrl };
        }
        violations.push({
          criterion: 'EAA-Statement',
          issue: 'inaccessible-statement',
          description: `Accessibility statement link found but page is not accessible: ${error.message}`,
          element: statementLink.selector,
          suggestion: 'Ensure accessibility statement page loads correctly and is accessible',
          severity: 'serious',
        });
        return { violations, ...empty, statementExists: true };
      }
    }

    log.debug(`  Reading the accessibility statement at: ${statementLink.url}`);
    const content = await this.analyzeStatementContent(page);
    const lastUpdated = content.lastUpdated ? new Date(content.lastUpdated) : null;

    // A page that neither calls itself a statement nor declares a conformance
    // status is a page about accessibility, not a declaration about this site:
    // a guide, a marketing page, an article, or the page the scan started on
    // when the statement link points back at it. The site has no statement,
    // which is one finding, rather than a statement missing all of its parts.
    if (!content.selfIdentifies && !content.conformanceStatus) {
      violations.push(missingStatementViolation());
      return { violations, ...empty };
    }

    if (!content.conformanceStatus) {
      violations.push({
        criterion: 'EAA-Statement',
        issue: 'incomplete-content',
        description: 'Accessibility statement lacks required information: compliance level',
        element: 'main',
        suggestion: 'Add compliance level (A, AA, AAA, partial, or non-compliant)',
        severity: 'major',
      });
    }

    if (!content.contactMechanism) {
      violations.push({
        criterion: 'EAA-Statement',
        issue: 'missing-contact',
        description: 'No contact mechanism provided for accessibility issues',
        element: 'main',
        suggestion:
          'Add contact information (email, phone, or feedback form) for accessibility issues',
        severity: 'serious',
      });
    }

    if (!lastUpdated || isOlderThanAYear(lastUpdated)) {
      violations.push({
        criterion: 'EAA-Statement',
        issue: 'outdated-statement',
        description: lastUpdated
          ? `The statement was last reviewed on ${lastUpdated.toISOString().slice(0, 10)}, more than twelve months ago`
          : 'The statement names no preparation or review date',
        element: 'main',
        suggestion: 'Add last updated date and ensure statement is reviewed at least annually',
        severity: 'major',
      });
    }

    return {
      violations,
      statementExists: true,
      statementAccessible: true,
      statementUrl: statementLink.url,
      conformanceStatus: content.conformanceStatus,
      contactMechanismProvided: content.contactMechanism,
      lastUpdated,
    };
  }

  /**
   * The origin the page belongs to: the one it was served from, unless the
   * document names another one in its canonical URL or its og:url. A snapshot
   * served from a local server still says where it was published.
   */
  async originOfRecord(page) {
    const declared = await page.evaluate(() => {
      const canonical = document.querySelector('link[rel="canonical"]');
      const og = document.querySelector('meta[property="og:url"]');
      return [canonical && canonical.getAttribute('href'), og && og.getAttribute('content')].find(
        (value) => /^https?:\/\//i.test(value || '')
      );
    });
    if (declared && this.isRealOrigin(declared)) {
      try {
        return new URL(declared).origin;
      } catch {
        // Unparsable canonical: fall back to the serving origin.
      }
    }
    return page.url();
  }

  /** Put a path that was resolved against the serving origin on `origin`. */
  rebase(url, origin) {
    try {
      const target = new URL(url);
      return new URL(target.pathname + target.search + target.hash, origin).href;
    } catch {
      return url;
    }
  }

  /** An address a statement could actually be published at. */
  isRealOrigin(url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return false;
      return !/^(localhost|127(\.\d+){1,3}|0\.0\.0\.0|\[::1\])$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  /** Is the statement published on the origin that was just scanned? */
  isSameOrigin(currentUrl, linkUrl) {
    try {
      return new URL(currentUrl).origin === new URL(linkUrl).origin;
    } catch {
      return false;
    }
  }

  isSameDocument(currentUrl, linkUrl) {
    try {
      const a = new URL(currentUrl);
      const b = new URL(linkUrl);
      return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
    } catch {
      return false;
    }
  }

  /**
   * Read the three declarations clause 12.2.2 asks for off the statement page.
   */
  async analyzeStatementContent(page) {
    return page.evaluate(() => {
      const text = (document.body.textContent || '').replace(/\s+/g, ' ');

      // Conformance status: a WCAG or EN 301 549 level, or one of the three
      // status words the model statement uses, in English or German.
      const CONFORMANCE = [
        /wcag\s*2(\.\d)?\s*(level\s*)?(aaa|aa|a)\b/i,
        /\ben\s*301\s*549\b/i,
        /\b(fully|partially|not)\s+(compliant|conformant)\b/i,
        /\b(voll|teilweise|nicht)\s+(konform|barrierefrei)/i,
        /konformit[äa]tsstatus/i,
      ];
      const conformance = CONFORMANCE.map((re) => text.match(re)).find(Boolean);

      // Does the page call itself a statement? A declaration usually says so
      // in its heading, and it is the one part of clause 12.2.2 that a guide
      // or a marketing page about accessibility never carries.
      const selfIdentifies =
        /accessibility statement|accessibility policy|erkl[äa]e?rung zur barrierefreiheit|barrierefreiheitserkl[äa]e?rung|d[ée]claration d'accessibilit[ée]|verklaring toegankelijkheid/i.test(
          text
        );

      // Feedback contact point: a way to reach somebody, not the word
      // "contact" somewhere in a sentence.
      const contactMechanism =
        document.querySelector('a[href^="mailto:"], a[href^="tel:"]') !== null ||
        document.querySelector('form') !== null ||
        Array.from(document.querySelectorAll('a[href]')).some((a) =>
          /kontakt|contact|feedback|barriere\s*melden|report/i.test(
            `${a.textContent} ${a.getAttribute('href')}`
          )
        );

      // Preparation / review date. A <time datetime> is the machine readable
      // one; otherwise a date has to sit next to wording that says it is the
      // review date, so a copyright year or an article date is not mistaken
      // for one.
      const dates = [];
      const pushDate = (value) => {
        const d = new Date(value);
        if (!isNaN(d.getTime())) dates.push(d);
      };

      for (const time of document.querySelectorAll('time[datetime]')) {
        pushDate(time.getAttribute('datetime'));
      }

      const REVIEW_WORDING =
        /(last\s+(updated|reviewed|review)|updated\s+on|reviewed\s+on|prepared\s+on|erstellt\s+am|zuletzt\s+(gepr[üu]ft|[üu]berpr[üu]ft|aktualisiert)|letzte\s+([üu]berpr[üu]fung|aktualisierung)|stand)/gi;
      let match;
      while ((match = REVIEW_WORDING.exec(text)) !== null) {
        const context = text.slice(match.index, match.index + 120);
        const iso = context.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) {
          pushDate(`${iso[1]}-${iso[2]}-${iso[3]}`);
          continue;
        }
        const dmy = context.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
        if (dmy) {
          pushDate(
            `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`
          );
        }
      }

      const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

      return {
        conformanceStatus: conformance ? conformance[0].trim() : null,
        selfIdentifies,
        contactMechanism,
        lastUpdated: newest ? newest.toISOString() : null,
      };
    });
  }

  get needsExclusiveAccess() {
    return true;
  }
}

module.exports = AccessibilityStatementScanner;
