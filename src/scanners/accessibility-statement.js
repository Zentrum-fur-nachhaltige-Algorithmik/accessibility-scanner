/**
 * Accessibility Statement Scanner.
 * Directive (EU) 2016/2102 Art. 7(1) and its national EAA transpositions
 * (AT BaFG, DE BFSG), which oblige a site to publish an accessibility
 * statement. Two different questions live here:
 *
 *   1. Is a statement linked at all? Measurable, so it is a violation.
 *   2. Does the statement say what the law asks it to say (conformance status,
 *      feedback contact, review date)? Reading a legal declaration is not a
 *      measurement, so every finding about the CONTENT of a statement is a
 *      needs-review question carrying the text a reviewer needs.
 *
 * Everything is read on the statement page itself; no other page of the site is
 * audited as if it were the statement.
 */
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const log = require('../utils/logger').createLogger('accessibility-statement');
const {
  findStatementLink,
  missingStatementViolation,
} = require('../utils/accessibility-statement');

/** The clause every finding of this scanner is charged to. */
const STATEMENT_CRITERION = 'EAA-Statement (2016/2102 Art. 7)';

const HELP_URL = 'https://eur-lex.europa.eu/eli/dir/2016/2102/oj';

/** Twelve months, the review interval the directive asks for. */
function isOlderThanAYear(date) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  return date < twelveMonthsAgo;
}

class AccessibilityStatementScanner extends BaseScanner {
  constructor() {
    super('accessibility-statement', {
      // Not a WCAG success criterion: the coverage matrix reads only "x.y.z"
      // entries, so this scanner claims no criterion there and is never
      // credited with WCAG coverage it does not have.
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
      criteria: [STATEMENT_CRITERION],
      passed: results.violations.length === 0,
      violations: results.violations,
      needsReview: results.needsReview,
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
   * A question about the content of a statement, with the evidence a reviewer
   * needs in order to answer it without opening the page again.
   */
  question(ruleId, description, question, dossier) {
    return {
      ...this.formatViolation(
        ruleId,
        'moderate',
        description,
        [{ selector: dossier.selector }],
        HELP_URL,
        'info',
        {
          verdict: 'needs-review',
          dossier: {
            question,
            element: { selector: dossier.selector, html: null, role: null, name: null },
            measurements: dossier.measurements || {},
            context: dossier.context || {},
          },
        }
      ),
      criterion: STATEMENT_CRITERION,
      // The scanner's own field name for a rule id; the harnesses and the
      // precision check read it.
      issue: ruleId,
      element: dossier.selector,
    };
  }

  /**
   * Find the statement, read it where it lives, and report what it omits.
   */
  async analyzeAccessibilityStatement(page, options) {
    const violations = [];
    const needsReview = [];
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
      // Exactly ONE finding. Every other rule of this scanner describes a
      // property OF the statement (missing contact, missing review date,
      // missing conformance status) and is undecidable while no statement
      // exists. See src/utils/accessibility-statement.js.
      violations.push(missingStatementViolation());
      return { violations, needsReview, ...empty };
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
        // link is one question about the link, not three about its content.
        const status = response ? response.status() : 0;
        if (status >= 400) throw new Error(`HTTP ${status}`);
      } catch (error) {
        // A transport failure on another origin is as likely to be the
        // scanning environment (no route to that host) as a dead statement,
        // and the statement of a site is often published on a sibling domain.
        // Only a status code, or a failure on the origin that was just
        // scanned successfully, is evidence about the link.
        if (!/^HTTP \d/.test(error.message) && !this.isSameOrigin(page.url(), statementUrl)) {
          return { violations, needsReview, ...empty, statementExists: true, statementUrl };
        }
        // The path was only ever resolved against a loopback address or a
        // file, so its status says nothing about the site's statement: a
        // single-page snapshot serves no other path of the site. Unverifiable
        // is an artefact of the scan, not a finding about the page.
        if (!this.isRealOrigin(statementUrl)) {
          return { violations, needsReview, ...empty, statementExists: true, statementUrl };
        }
        // Even with a status code, a fetch is one attempt from one network:
        // whether the statement is reachable for the public is a question, not
        // a measurement this scan can close.
        needsReview.push(
          this.question(
            'inaccessible-statement',
            `The linked accessibility statement did not load: ${error.message}`,
            'Is the linked accessibility statement reachable for the public?',
            {
              selector: statementLink.selector,
              measurements: { statementUrl, error: error.message },
              context: { linkText: statementLink.text, scannedFrom: page.url() },
            }
          )
        );
        return { violations, needsReview, ...empty, statementExists: true };
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
      return { violations, needsReview, ...empty };
    }

    const evidence = {
      selector: 'main',
      context: {
        statementUrl,
        headings: content.headings,
        excerpt: content.excerpt,
        datesFound: content.dateFindings,
        contactCandidates: content.contactCandidates,
      },
    };

    if (!content.conformanceStatus) {
      needsReview.push(
        this.question(
          'incomplete-content',
          'No conformance status (fully / partially / not compliant, or a WCAG level) was found in the statement',
          'Does the statement declare a conformance status?',
          { ...evidence, measurements: { conformanceStatusFound: false } }
        )
      );
    }

    if (!content.contactMechanism) {
      needsReview.push(
        this.question(
          'missing-contact',
          'No feedback contact for accessibility problems was found in the statement',
          'Does the statement name a feedback contact?',
          {
            ...evidence,
            measurements: { contactCandidates: content.contactCandidates.length },
          }
        )
      );
    }

    if (!lastUpdated || isOlderThanAYear(lastUpdated)) {
      needsReview.push(
        this.question(
          'outdated-statement',
          lastUpdated
            ? `The newest review date read from the statement is ${lastUpdated.toISOString().slice(0, 10)}, more than twelve months ago`
            : 'No preparation or review date was read from the statement',
          'When was this statement prepared or last reviewed?',
          {
            ...evidence,
            measurements: {
              newestDateFound: lastUpdated ? lastUpdated.toISOString().slice(0, 10) : null,
              dateCandidates: content.dateFindings.length,
            },
          }
        )
      );
    }

    return {
      violations,
      needsReview,
      statementExists: true,
      statementAccessible: true,
      statementUrl,
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
   * Read the declarations the directive asks for off the statement page, and
   * collect the evidence a reviewer needs to decide the ones that are missing.
   */
  async analyzeStatementContent(page) {
    return page.evaluate(() => {
      const text = (document.body.textContent || '').replace(/\s+/g, ' ');

      // The region the statement itself lives in. A <time> in the site footer
      // or in a "latest news" rail is not the review date of the statement.
      const region =
        document.querySelector('main, [role="main"], article, .accessibility-statement') ||
        document.body;

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
      // in its heading, and it is the one part of the model statement that a
      // guide or a marketing page about accessibility never carries.
      const selfIdentifies =
        /accessibility statement|accessibility policy|erkl[äa]e?rung zur barrierefreiheit|barrierefreiheitserkl[äa]e?rung|d[ée]claration d'accessibilit[ée]|verklaring toegankelijkheid/i.test(
          text
        );

      // Feedback contact point: a way to reach somebody, not the word
      // "contact" somewhere in a sentence.
      const contactCandidates = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(mailto:|tel:)/i.test(href)) {
          contactCandidates.push({ kind: href.split(':')[0].toLowerCase(), text: label, href });
        } else if (/kontakt|contact|feedback|barriere\s*melden|report/i.test(`${label} ${href}`)) {
          contactCandidates.push({ kind: 'link', text: label, href });
        }
        if (contactCandidates.length >= 8) break;
      }
      if (document.querySelector('form')) {
        contactCandidates.push({ kind: 'form', text: '', href: '' });
      }
      const contactMechanism = contactCandidates.length > 0;

      // Preparation / review date. A <time datetime> inside the statement
      // region is the machine readable one; otherwise a date has to sit next
      // to wording that says it is the review date, so a copyright year or an
      // article date is not mistaken for one.
      const dates = [];
      const dateFindings = [];
      const pushDate = (value, source, context) => {
        const d = new Date(value);
        if (isNaN(d.getTime())) return;
        dates.push(d);
        if (dateFindings.length < 8) {
          dateFindings.push({ date: d.toISOString().slice(0, 10), source, context });
        }
      };

      for (const time of region.querySelectorAll('time[datetime]')) {
        if (time.closest('footer, [role="contentinfo"]')) continue;
        pushDate(
          time.getAttribute('datetime'),
          'time[datetime]',
          (time.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        );
      }

      const MONTHS = {
        januar: 1,
        jänner: 1,
        january: 1,
        jan: 1,
        februar: 2,
        february: 2,
        feb: 2,
        märz: 3,
        maerz: 3,
        march: 3,
        mar: 3,
        mrz: 3,
        april: 4,
        apr: 4,
        mai: 5,
        may: 5,
        juni: 6,
        june: 6,
        jun: 6,
        juli: 7,
        july: 7,
        jul: 7,
        august: 8,
        aug: 8,
        september: 9,
        sept: 9,
        sep: 9,
        oktober: 10,
        october: 10,
        okt: 10,
        oct: 10,
        november: 11,
        nov: 11,
        dezember: 12,
        december: 12,
        dez: 12,
        dec: 12,
      };
      const monthNames = Object.keys(MONTHS).join('|');
      // "12. Mai 2025", "12 May 2025", "May 12, 2025".
      const DMY_WORD = new RegExp(`(\\d{1,2})\\.?\\s+(${monthNames})\\.?\\s+(\\d{4})`, 'i');
      const MDY_WORD = new RegExp(`(${monthNames})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i');
      const iso2 = (n) => String(n).padStart(2, '0');

      // `stand` only on a word boundary: "Zustand des Gebäudes ... 01.01.2024"
      // is not a review date.
      const REVIEW_WORDING =
        /(last\s+(updated|reviewed|review)|updated\s+on|reviewed\s+on|prepared\s+on|erstellt\s+am|erstellt|zuletzt\s+(gepr[üu]ft|[üu]berpr[üu]ft|aktualisiert)|letzte\s+([üu]berpr[üu]fung|aktualisierung)|\bstand\b)/gi;
      let match;
      while ((match = REVIEW_WORDING.exec(text)) !== null) {
        // The date can stand before the wording ("wurde am 12. Mai 2025
        // erstellt") as well as after it, so the window reaches both ways.
        const context = text.slice(Math.max(0, match.index - 90), match.index + 120);
        const iso = context.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) {
          pushDate(`${iso[1]}-${iso[2]}-${iso[3]}`, 'iso', context.slice(0, 80));
          continue;
        }
        const dmy = context.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
        if (dmy) {
          pushDate(`${dmy[3]}-${iso2(dmy[2])}-${iso2(dmy[1])}`, 'numeric', context.slice(0, 80));
          continue;
        }
        const dmyWord = context.match(DMY_WORD);
        if (dmyWord) {
          pushDate(
            `${dmyWord[3]}-${iso2(MONTHS[dmyWord[2].toLowerCase()])}-${iso2(dmyWord[1])}`,
            'month-name',
            context.slice(0, 80)
          );
          continue;
        }
        const mdyWord = context.match(MDY_WORD);
        if (mdyWord) {
          pushDate(
            `${mdyWord[3]}-${iso2(MONTHS[mdyWord[1].toLowerCase()])}-${iso2(mdyWord[2])}`,
            'month-name',
            context.slice(0, 80)
          );
        }
      }

      const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

      const headings = Array.from(region.querySelectorAll('h1, h2, h3, [role="heading"]'))
        .slice(0, 12)
        .map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      return {
        conformanceStatus: conformance ? conformance[0].trim() : null,
        selfIdentifies,
        contactMechanism,
        contactCandidates,
        lastUpdated: newest ? newest.toISOString() : null,
        dateFindings,
        headings,
        excerpt: (region.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      };
    });
  }

  get needsExclusiveAccess() {
    return true;
  }
}

module.exports = AccessibilityStatementScanner;
