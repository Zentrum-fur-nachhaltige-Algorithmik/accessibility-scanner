/**
 * Screen Reader Scanner.
 * WCAG 1.3.1, 2.4.1 (EN 301 549 9.1.3.1, 9.2.4.1).
 * Reports the two structural defects axe-core has no rule for: a data table
 * with no header cells, and a repeated block of navigation with no way past it.
 * Heading structure and landmarks are analysed for the report payload only.
 */
const BaseScanner = require('../core/base-scanner');

class ScreenReaderScanner extends BaseScanner {
  constructor() {
    super('screen-reader', {
      wcagCriteria: ['1.3.1', '2.4.1'],
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
    const [headingStructure, landmarks, tables] = await Promise.all([
      this.analyzeHeadingStructure(page),
      this.analyzeLandmarks(page),
      this.analyzeTables(page),
    ]);

    const pageTitle = await page.title();

    const euCompliance = this.calculateEUCompliance({ headingStructure, landmarks, tables });

    return {
      scannerId: this.id,
      passed: euCompliance.en301549.compliant,
      timestamp: new Date(),
      pageTitle,
      headingStructure,
      landmarks,
      tables,
      euCompliance,
      violations: euCompliance.en301549.violations,
      summary: {
        score: euCompliance.en301549.score,
        headingIssues: headingStructure.issues.length,
        landmarkIssues: landmarks.issues.length,
        tableIssues: tables.problematic.length,
      },
    };
  }

  /**
   * Selector snippet shared by every page.evaluate() below. Kept as a string
   * so it can be `eval`'d inside the browser context (page.evaluate bodies
   * are serialised, so they cannot close over class methods).
   */
  static get selectorHelperScript() {
    return `
      function getElementSelector(element) {
        if (!element || !element.tagName) return '';
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? '#' + element.id : '';
        const className = typeof element.className === 'string' && element.className.trim()
          ? '.' + element.className.trim().split(/\\s+/)[0]
          : '';
        return tagName + id + className;
      }
    `;
  }

  async analyzeHeadingStructure(page) {
    return await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const hierarchy = [];
      const issues = [];
      let lastLevel = 0;
      let h1Count = 0;

      headings.forEach((heading, index) => {
        const level = parseInt(heading.tagName.charAt(1));
        const text = heading.textContent.trim();
        const line = heading.getBoundingClientRect().top + window.scrollY;

        if (level === 1) h1Count++;

        hierarchy.push({
          level,
          text: text || '[Empty heading]',
          line: Math.round(line),
          tagName: heading.tagName,
          id: heading.id || '',
          isEmpty: !text,
        });

        if (!text) {
          issues.push(`Empty heading at position ${index + 1} (${heading.tagName})`);
        }

        if (level > lastLevel + 1 && lastLevel !== 0) {
          issues.push(`${heading.tagName} follows H${lastLevel} (skipping levels)`);
        }

        lastLevel = level;
      });

      if (h1Count === 0) {
        issues.push('No H1 heading found');
      } else if (h1Count > 1) {
        issues.push(`Multiple H1 headings found (${h1Count})`);
      }

      return {
        valid: issues.length === 0,
        issues,
        hierarchy,
        totalHeadings: headings.length,
        h1Count,
      };
    });
  }

  async analyzeLandmarks(page) {
    return await page.evaluate(() => {
      const landmarks = {
        main: document.querySelector('main, [role="main"]') !== null,
        navigation: document.querySelector('nav, [role="navigation"]') !== null,
        banner: document.querySelector('header, [role="banner"]') !== null,
        contentinfo: document.querySelector('footer, [role="contentinfo"]') !== null,
        complementary: document.querySelector('aside, [role="complementary"]') !== null,
        search: document.querySelector('[role="search"]') !== null,
      };

      const issues = [];
      const landmarkElements = document.querySelectorAll(`
        main, [role="main"],
        nav, [role="navigation"],
        header, [role="banner"],
        footer, [role="contentinfo"],
        aside, [role="complementary"],
        [role="search"]
      `);

      if (!landmarks.main) {
        issues.push('No main landmark found');
      }

      if (!landmarks.navigation) {
        issues.push('No navigation landmark found');
      }

      const mainElements = document.querySelectorAll('main, [role="main"]');
      if (mainElements.length > 1) {
        issues.push('Multiple main landmarks found');
      }

      const contentWithoutLandmarks = Array.from(document.querySelectorAll('body > *')).filter(
        (el) => {
          return (
            el.offsetParent !== null &&
            el.textContent.trim().length > 0 &&
            !el.closest(
              'main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]'
            )
          );
        }
      );

      if (contentWithoutLandmarks.length > 0) {
        issues.push('Content found outside of landmarks');
      }

      // SC 2.4.1 Bypass Blocks, evidence gate
      //
      // 2.4.1 asks for a mechanism to bypass a repeated block, not for a
      // specific landmark (a missing <main> is axe-core's `landmark-one-main`).
      // Fire only when there is a repeated block worth bypassing and no
      // bypass mechanism works.
      const totalText = (document.body.textContent || '').trim().length;
      function precedingTextLength(el) {
        try {
          const range = document.createRange();
          range.setStart(document.body, 0);
          range.setEndBefore(el);
          return range.toString().trim().length;
        } catch (e) {
          return Number.MAX_SAFE_INTEGER;
        }
      }

      // A "block of repeated content": a banner/navigation region holding a
      // link cluster, sitting at the very top of the document (<=10% of the
      // page's text precedes it) and outside <main>.
      const REPEATED_BLOCK_MIN_LINKS = 5;
      const blockCandidates = Array.from(
        document.querySelectorAll('header, [role="banner"], nav, [role="navigation"]')
      ).filter(
        (el) =>
          !el.closest('main, [role="main"]') &&
          el.querySelectorAll('a[href]').length >= REPEATED_BLOCK_MIN_LINKS &&
          (totalText === 0 || precedingTextLength(el) <= totalText * 0.1)
      );

      // Bypass mechanisms, in the order WCAG accepts them.
      function skipLinkTargetExists(a) {
        const href = a.getAttribute('href') || '';
        if (!href.startsWith('#') || href.length < 2) return false;
        const id = decodeURIComponent(href.slice(1));
        if (document.getElementById(id)) return true;
        try {
          return !!document.querySelector(`a[name="${CSS.escape(id)}"]`);
        } catch (e) {
          return false;
        }
      }

      const firstBlock = blockCandidates[0] || null;
      const inPageLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
      const skipLinkCandidates = firstBlock
        ? inPageLinks.filter(
            (a) => firstBlock.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING
          )
        : [];
      const workingSkipLinks = skipLinkCandidates.filter((a) => {
        if (!skipLinkTargetExists(a)) return false;
        const cs = getComputedStyle(a);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      });

      const bypass = {
        repeatedBlock: firstBlock
          ? {
              tag: firstBlock.tagName.toLowerCase(),
              id: firstBlock.id || '',
              linkCount: firstBlock.querySelectorAll('a[href]').length,
            }
          : null,
        hasMainLandmark: landmarks.main,
        skipLinkCandidates: skipLinkCandidates.length,
        workingSkipLinks: workingSkipLinks.length,
        brokenSkipLinks: skipLinkCandidates
          .filter((a) => !skipLinkTargetExists(a))
          .map((a) => a.getAttribute('href'))
          .slice(0, 5),
      };
      bypass.satisfied = !firstBlock || landmarks.main || workingSkipLinks.length > 0;

      return {
        ...landmarks,
        issues,
        bypass,
        landmarkCount: landmarkElements.length,
      };
    });
  }

  /**
   * Analyze data tables for programmatic header association (SC 1.3.1).
   *
   * axe-core has no rule that catches a data table built entirely from
   * <td> (its `th-has-data-cells` / `td-headers-attr` rules only apply once
   * headers already exist). This check fires only on positive evidence that
   * the table carries tabular data.
   */
  async analyzeTables(page) {
    return await page.evaluate((helperScript) => {
      eval(helperScript);
      const problematic = [];
      const tables = Array.from(document.querySelectorAll('table'));

      for (const table of tables) {
        const role = (table.getAttribute('role') || '').toLowerCase();
        // Author explicitly declared it a layout table.
        if (role === 'presentation' || role === 'none') continue;
        if (table.closest('[aria-hidden="true"]')) continue;
        if (table.offsetParent === null && getComputedStyle(table).position !== 'fixed') continue;

        const rows = Array.from(table.rows || []);
        if (rows.length < 3) continue; // too small to be a data grid
        const maxCols = Math.max(0, ...rows.map((r) => r.cells.length));
        if (maxCols < 2) continue;

        // Layout tables carry page furniture inside their cells. A genuine
        // data table's cells hold values, not sections/forms/headings.
        const cells = Array.from(table.querySelectorAll('td, th'));
        const carriesFurniture = cells.some((c) =>
          c.querySelector(
            'table, form, nav, header, footer, article, section, h1, h2, h3, h4, h5, h6'
          )
        );
        if (carriesFurniture) continue;

        const headerCells = table.querySelectorAll('th, [role="columnheader"], [role="rowheader"]');

        // SC 1.3.1 only requires relationships that are CONVEYED VISUALLY to
        // be programmatically determinable. A two-column key/value table
        // (opening hours, price list, contact facts) conveys exactly one
        // relationship ("the two cells on this line belong together"), and
        // that relationship is already exposed by the row itself. There is no
        // visually marked header to lose. Requiring <th> there flags healthy
        // markup, so a missing header is only a defect when the table
        // actually presents a header axis:
        //   (a) merged cells (colspan/rowspan): the layout only parses with
        //       headers to anchor the spans;
        //   (b) a visually emphasised first row (bold/strong or its own
        //       background): a header row the author drew but did not mark up
        //       (WCAG F91);
        //   (c) three or more columns: each cell's meaning then depends on
        //       its column, and the column's meaning is conveyed visually by
        //       the top row.
        const hasSpans = Array.from(table.querySelectorAll('td, th')).some(
          (c) => c.colSpan > 1 || c.rowSpan > 1
        );
        const firstRow = rows[0];
        const firstRowCells = firstRow ? Array.from(firstRow.cells) : [];
        const bodyRowBg = rows[1]
          ? window.getComputedStyle(rows[1].cells[0] || rows[1]).backgroundColor
          : '';
        const firstRowEmphasised =
          firstRowCells.length > 0 &&
          firstRowCells.every((c) => {
            const cs = window.getComputedStyle(c);
            const bold = parseInt(cs.fontWeight, 10) >= 600 || !!c.querySelector('strong, b');
            const ownBg = cs.backgroundColor;
            const rowBg = window.getComputedStyle(firstRow).backgroundColor;
            const distinctBg =
              (ownBg !== bodyRowBg && ownBg !== 'rgba(0, 0, 0, 0)') ||
              (rowBg !== bodyRowBg && rowBg !== 'rgba(0, 0, 0, 0)');
            return bold || distinctBg;
          });
        const presentsHeaderAxis = hasSpans || firstRowEmphasised || maxCols >= 3;

        if (headerCells.length === 0 && presentsHeaderAxis) {
          problematic.push({
            selector: getElementSelector(table),
            rows: rows.length,
            columns: maxCols,
            issue: 'Data table has no <th> or role="columnheader"/"rowheader" cells',
            severity: 'high',
          });
        }
      }

      return { total: tables.length, problematic };
    }, ScreenReaderScanner.selectorHelperScript);
  }

  /**
   * Build one violation in the shape the rest of the codebase expects:
   *   { criterion, element, type, issue, description, severity, suggestion }
   * `clause` is kept as an alias of `criterion` because report-generator.js
   * renders the screen-reader report off `v.clause`.
   */
  static violation({ criterion, type, element, description, severity, suggestion, details }) {
    return {
      criterion,
      clause: criterion,
      type,
      issue: type,
      element: element || null,
      description,
      severity,
      suggestion,
      details: details || [],
    };
  }

  calculateEUCompliance(analysisResults) {
    const violations = [];
    const V = ScreenReaderScanner.violation;
    let score = 100;

    // Heading-structure findings are not emitted as violations: axe-core
    // reports them (`heading-order`, `empty-heading`, `page-has-heading-one`).
    // The analysis stays in the result payload for the report.

    // SC 1.3.1: data tables with no programmatic header cells. axe has no
    // rule for a table built purely from <td>, so it is reported here.
    for (const table of analysisResults.tables?.problematic || []) {
      violations.push(
        V({
          criterion: '9.1.3.1',
          type: 'table-missing-header-association',
          element: table.selector,
          description: `Info and Relationships - data table (${table.rows}×${table.columns}) has no header cells, so no row/column association is exposed`,
          severity: 'high',
          suggestion:
            'Mark header cells as <th> with scope="col"/"row" (or headers/id for multi-level headers); add role="presentation" if the table is only for layout',
          details: [table.issue],
        })
      );
      score -= 10;
    }

    // SC 2.4.1 Bypass Blocks. Evidence-gated: only when a repeated
    // navigation block exists at the top of the page and no bypass mechanism
    // (main landmark or a working skip link) is available.
    const bypass = analysisResults.landmarks.bypass;
    if (bypass && bypass.repeatedBlock && !bypass.satisfied) {
      violations.push(
        V({
          criterion: '9.2.4.1',
          type: 'missing-skip-link',
          element:
            bypass.repeatedBlock.tag +
            (bypass.repeatedBlock.id ? `#${bypass.repeatedBlock.id}` : ''),
          description: `Bypass Blocks - a <${bypass.repeatedBlock.tag}> navigation block with ${bypass.repeatedBlock.linkCount} links precedes the page content, but there is no way to skip it`,
          severity: 'high',
          suggestion:
            'Add a skip link whose target id exists (and is focusable), or wrap the page content in <main>',
          details: [
            `Navigation block: <${bypass.repeatedBlock.tag}> with ${bypass.repeatedBlock.linkCount} links`,
            `Main landmark: ${bypass.hasMainLandmark ? 'present' : 'absent'}`,
            `Skip links before the block: ${bypass.skipLinkCandidates} (working: ${bypass.workingSkipLinks})`,
            ...(bypass.brokenSkipLinks.length
              ? [`Broken skip-link targets: ${bypass.brokenSkipLinks.join(', ')}`]
              : []),
          ],
        })
      );
      score -= 10;
    }

    const accessibilityStatement = false; // Would need to check for actual statement
    const contactMechanism = false; // Would need to check for contact info

    return {
      en301549: {
        compliant: violations.length === 0,
        score: Math.max(0, score),
        violations,
      },
      eaaCompliance: {
        ready: accessibilityStatement && contactMechanism,
        missingRequirements: [
          ...(!accessibilityStatement ? ['No accessibility statement found'] : []),
          ...(!contactMechanism ? ['Contact mechanism not provided'] : []),
        ],
      },
    };
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  createErrorReport(url, errorMessage) {
    return {
      url,
      timestamp: new Date(),
      pageTitle: '',
      error: errorMessage,
      headingStructure: { valid: false, issues: [], hierarchy: [] },
      landmarks: { main: false, navigation: false, issues: [], bypass: null },
      tables: { total: 0, problematic: [] },
    };
  }
}

module.exports = ScreenReaderScanner;
