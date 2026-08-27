/**
 * ScanPipeline
 * Orchestrates scanner execution against a single URL. One Chromium per
 * process, recycled after a number of scans; one isolated browser context per
 * scan so cookies, storage and cache never leak between targets. Concurrent
 * scanners share one page; exclusive scanners each get a fresh tab.
 */
const puppeteer = require('puppeteer');
const { classifyWcagPrinciple } = require('../utils/wcag-principle');

class ScanPipeline {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxScansPerBrowser] relaunch Chromium after this many scans (default 50)
   */
  constructor(options = {}) {
    this.browser = null;
    this.scanners = new Map();
    this.maxScansPerBrowser = options.maxScansPerBrowser ?? 50;
    this.scanCount = 0;
    this.activeScans = 0;
  }

  /**
   * Register a scanner instance.
   * @param {import('./base-scanner')} scanner
   */
  register(scanner) {
    this.scanners.set(scanner.id, scanner);
  }

  /**
   * Register multiple scanners at once.
   * @param {import('./base-scanner')[]} scanners
   */
  registerAll(scanners) {
    for (const scanner of scanners) {
      this.register(scanner);
    }
  }

  /**
   * Run selected (or all) scanners against a URL.
   *
   * @param {string} url
   * @param {Object} options
   * @param {string[]} options.scannerIds - subset of scanner ids to run (default: all)
   * @param {number}   options.timeout - navigation timeout (default: 30000)
   * @param {string}   options.screenshotDir - directory for scanner screenshots
   * @returns {Promise<PipelineResult>}
   */
  async scan(url, options = {}) {
    const { scannerIds = null, timeout = 30000, screenshotDir = null, ...scannerOptions } = options;

    await this.ensureBrowser();
    this.activeScans += 1;
    const context = await this.browser.createBrowserContext();

    const selected = scannerIds
      ? scannerIds.map((id) => this.scanners.get(id)).filter(Boolean)
      : Array.from(this.scanners.values());

    if (selected.length === 0) {
      throw new Error('No scanners selected or registered');
    }

    const concurrent = selected.filter((s) => !s.needsExclusiveAccess);
    const exclusive = selected.filter((s) => s.needsExclusiveAccess);

    const page = await context.newPage();
    this.autoDismissDialogs(page);
    await page.setViewport({ width: 1920, height: 1080 });

    const passedOptions = { ...scannerOptions, screenshotDir, timeout };
    const allResults = [];

    try {
      // Navigate once for concurrent scanners
      await this.navigateWithCSPFallback(page, url, { timeout });

      // Run concurrent scanners in parallel. LLM scanners get a warm-up
      // stagger: they all send an identical shared page-context prefix, so
      // awaiting the FIRST one alone lets the provider's implicit prompt cache
      // populate for that prefix. Fired all at once they would instead race
      // and every one of them would miss. Order of allResults is preserved.
      const llmIdx = [];
      const otherIdx = [];
      concurrent.forEach((s, i) => (s.id.startsWith('llm-') ? llmIdx : otherIdx).push(i));
      const concurrentResults = new Array(concurrent.length);
      const nonLlmDone = Promise.allSettled(
        otherIdx.map((i) => concurrent[i].scan(page, passedOptions))
      );
      if (llmIdx.length > 0) {
        [concurrentResults[llmIdx[0]]] = await Promise.allSettled([
          concurrent[llmIdx[0]].scan(page, passedOptions),
        ]);
        const rest = await Promise.allSettled(
          llmIdx.slice(1).map((i) => concurrent[i].scan(page, passedOptions))
        );
        llmIdx.slice(1).forEach((i, k) => {
          concurrentResults[i] = rest[k];
        });
      }
      (await nonLlmDone).forEach((r, k) => {
        concurrentResults[otherIdx[k]] = r;
      });
      concurrentResults.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
        } else {
          // Name the scanner that failed: assembleResult keys summaries by
          // scannerId, so a shared placeholder id would let one failure
          // overwrite another.
          allResults.push({
            scannerId: concurrent[i].id,
            passed: false,
            violations: [],
            error: result.reason?.message || String(result.reason),
          });
        }
      });

      // Run exclusive scanners in parallel batches, each in its own tab
      const tabConcurrency = options.tabConcurrency || 2;

      for (let i = 0; i < exclusive.length; i += tabConcurrency) {
        const batch = exclusive.slice(i, i + tabConcurrency);
        const batchResults = await Promise.allSettled(
          batch.map(async (scanner) => {
            const tab = await context.newPage();
            this.autoDismissDialogs(tab);
            await tab.setViewport({ width: 1920, height: 1080 });
            try {
              await tab.goto(url, { waitUntil: 'networkidle0', timeout });
              return await scanner.scan(tab, passedOptions);
            } finally {
              await tab.close().catch(() => {});
            }
          })
        );
        batchResults.forEach((result, k) => {
          if (result.status === 'fulfilled') {
            allResults.push(result.value);
          } else {
            allResults.push({
              scannerId: batch[k].id,
              passed: false,
              violations: [],
              error: result.reason?.message || String(result.reason),
            });
          }
        });
      }
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      this.activeScans -= 1;
      this.scanCount += 1;
      await this.recycleBrowserIfDue();
    }

    return this.assembleResult(url, allResults);
  }

  /**
   * Auto-dismiss JS dialogs (alert/confirm/prompt/beforeunload).
   * Scanners click page elements, which can open a modal dialog. Puppeteer
   * leaves dialogs open while no 'dialog' listener is attached, and an open
   * dialog blocks the renderer main thread, so every later evaluate() on that
   * page (from any concurrent scanner) hangs forever.
   */
  autoDismissDialogs(page) {
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  }

  async navigateWithCSPFallback(page, url, options = {}) {
    const timeout = options.timeout || 30000;
    await page.goto(url, { waitUntil: 'networkidle0', timeout });
  }

  /**
   * Assemble individual scanner results into a unified pipeline result.
   */
  assembleResult(url, scannerResults) {
    const allViolations = [];
    const scannerSummaries = {};

    const { trustTier, trustReason } = require('./scanner-trust');
    const { levelOfViolation } = require('./wcag-levels');

    for (const result of scannerResults) {
      const tier = trustTier(result.scannerId);

      if (result.violations) {
        for (const v of result.violations) {
          // Quarantined scanners still report, but never at full confidence, so
          // a report can present them separately ("experimental check, low
          // confidence") instead of mixing them into the headline findings.
          if (tier === 'experimental') {
            v.experimental = true;
            v.confidence = 'low';
          }
          // Conformance level. A finding whose every criterion is AAA is
          // advisory for an AA audit: it is kept, but as 'info' so it neither
          // drives the score nor sits among the AA failures in the report.
          const level = levelOfViolation(v);
          if (level) v.wcagLevel = level;
          if (level === 'AAA' && v.severity !== 'info') {
            v.originalSeverity = v.severity ?? null;
            v.severity = 'info';
            v.aaa = true;
          }
          allViolations.push(v);
        }
      }

      scannerSummaries[result.scannerId] = {
        passed: result.passed,
        violationCount: result.violations?.length || 0,
        summary: result.summary || {},
        error: result.error || null,
        trustTier: tier,
        trustReason: tier === 'experimental' ? trustReason(result.scannerId) : undefined,
      };
    }

    const violations = this.dedupeProcedureFindings(
      this.reconcileIncompleteReviews(allViolations, scannerResults)
    );
    const categories = this.categorizeViolations(violations);

    return {
      url,
      timestamp: new Date().toISOString(),
      accessibilityScore: this.computeViolationWeightedScore(violations),
      totalViolations: violations.length,
      violations,
      scanners: scannerSummaries,
      categories,
    };
  }

  /**
   * Drop the axe-core `incomplete` placeholders that the LLM incomplete
   * reviewer has since decided are compliant.
   *
   * `AxeCoreAdapter` forwards every `incomplete` node as a `severity: 'info'`
   * "Manual review required" line. `llm-incomplete-reviewer` re-examines those
   * nodes with measured evidence and records the ones it cleared in
   * `summary.suppressed`. Without this reconciliation the reader sees both the
   * adjudicated verdict AND the original to-do item for the same element.
   *
   * Only axe's own informational entries are ever removed. A real axe
   * violation, or any finding from another scanner, is untouched.
   */
  reconcileIncompleteReviews(violations, scannerResults) {
    const reviewer = scannerResults.find((r) => r.scannerId === 'llm-incomplete-reviewer');
    const suppressed = reviewer?.summary?.suppressed;
    if (!Array.isArray(suppressed) || suppressed.length === 0) return violations;

    const keys = new Set(suppressed.map((s) => `${s.axeRuleId}|${s.selector}`));

    return violations.filter((v) => {
      if (v.source !== 'axe-core') return true;
      if ((v.severity || '') !== 'info') return true;
      const selector = v.nodes?.[0]?.selector || '';
      return !keys.has(`${v.ruleId}|${selector}`);
    });
  }

  /**
   * Violation-weighted score, 0..100.
   *
   * Severity weights and the aggregation both live in src/core/severity.js:
   * repeated instances of one rule count sub-linearly (they are one defect
   * with one fix) and the penalty is mapped through exponential decay rather
   * than subtracted and clipped at 0, so pages with many findings still rank.
   */
  computeViolationWeightedScore(violations) {
    const { violationPenalty, scoreFromPenalty } = require('./severity');
    return scoreFromPenalty(violationPenalty(violations));
  }

  /**
   * Collapse the EAA/EN 301 549 procedural findings that several scanners
   * report about the same site-wide fact.
   *
   * `accessibility-statement`, `eaa-procedure`, `contact-mechanism` and
   * `compliance-monitoring` overlap by design: they all read the same footer
   * and the same statement page. A missing statement is one defect, but it
   * arrived from two scanners as two findings; these rules carry no element
   * identity (they are about the website, not a node), so identity is
   * (criterion, rule, element).
   */
  dedupeProcedureFindings(violations) {
    const { ruleKey } = require('./severity');
    const seen = new Map();
    const out = [];

    for (const v of violations) {
      const criterion = String(v.criterion || '');
      const isProcedural = criterion.startsWith('EAA-') || criterion.startsWith('EN 301 549');
      if (!isProcedural) {
        out.push(v);
        continue;
      }
      const key = `${criterion}|${ruleKey(v)}|${v.element || ''}`;
      const first = seen.get(key);
      if (first) {
        first.alsoReportedBy = [...(first.alsoReportedBy || []), v.scannerId].filter(Boolean);
        continue;
      }
      seen.set(key, v);
      out.push(v);
    }

    return out;
  }

  /**
   * Bucket violations by WCAG principle for the scan API's `categories` field.
   *
   * Classifies from the criterion with the same helper the report generator
   * uses; `wcagPrinciple` is scanner-level metadata and is not set on
   * individual violations.
   */
  categorizeViolations(violations) {
    const categories = {
      perceivable: { violations: 0 },
      operable: { violations: 0 },
      understandable: { violations: 0 },
      robust: { violations: 0 },
      eaa: { violations: 0 },
      other: { violations: 0 },
    };

    for (const v of violations) {
      const principle = classifyWcagPrinciple(v);
      if (categories[principle]) {
        categories[principle].violations++;
      } else {
        categories.other.violations++;
      }
    }

    return categories;
  }

  async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
  }

  /** Relaunch Chromium after maxScansPerBrowser scans, once no scan is using it. */
  async recycleBrowserIfDue() {
    if (this.activeScans === 0 && this.scanCount >= this.maxScansPerBrowser) {
      this.scanCount = 0;
      await this.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = ScanPipeline;
