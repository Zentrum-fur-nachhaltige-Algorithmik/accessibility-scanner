const puppeteer = require('puppeteer');

/**
 * ScanPipeline — orchestrates scanner execution against a single URL.
 *
 * - Manages ONE browser instance for the lifetime of the pipeline.
 * - Partitions scanners into concurrent (page.evaluate only) and
 *   exclusive (viewport/keyboard/navigation changes).
 * - Re-navigates between exclusive scanners to reset page state.
 */
class ScanPipeline {
  constructor() {
    this.browser = null;
    this.scanners = new Map();
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
   * @param {string[]} options.scannerIds — subset of scanner ids to run (default: all)
   * @param {number}   options.timeout    — navigation timeout (default: 30000)
   * @param {string}   options.screenshotDir — directory for scanner screenshots
   * @returns {Promise<PipelineResult>}
   */
  async scan(url, options = {}) {
    const {
      scannerIds = null,
      timeout = 30000,
      screenshotDir = null,
      ...scannerOptions
    } = options;

    await this.ensureBrowser();

    const selected = scannerIds
      ? scannerIds.map((id) => this.scanners.get(id)).filter(Boolean)
      : Array.from(this.scanners.values());

    if (selected.length === 0) {
      throw new Error('No scanners selected or registered');
    }

    const concurrent = selected.filter((s) => !s.needsExclusiveAccess);
    const exclusive = selected.filter((s) => s.needsExclusiveAccess);

    const page = await this.browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const passedOptions = { ...scannerOptions, screenshotDir, timeout };
    const allResults = [];

    try {
      // Navigate once for concurrent scanners
      await this.navigateWithCSPFallback(page, url, { timeout });

      // Run concurrent scanners in parallel
      const concurrentResults = await Promise.allSettled(
        concurrent.map((s) => s.scan(page, passedOptions))
      );
      for (const result of concurrentResults) {
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
        } else {
          allResults.push({
            scannerId: 'unknown',
            passed: false,
            violations: [],
            error: result.reason?.message || String(result.reason),
          });
        }
      }

      // Run exclusive scanners sequentially, re-navigating between each
      for (const scanner of exclusive) {
        try {
          await page.goto(url, { waitUntil: 'networkidle0', timeout });
          const result = await scanner.scan(page, passedOptions);
          allResults.push(result);
        } catch (err) {
          allResults.push({
            scannerId: scanner.id,
            passed: false,
            violations: [],
            error: err.message,
          });
        }
      }
    } finally {
      await page.close().catch(() => {});
    }

    return this.assembleResult(url, allResults);
  }

  /**
   * Navigate with CSP fallback.
   * Will be enhanced in Phase 5 with full CSP strategy from csp-strategy.js.
   */
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

    for (const result of scannerResults) {
      if (result.violations) {
        allViolations.push(...result.violations);
      }
      scannerSummaries[result.scannerId] = {
        passed: result.passed,
        violationCount: result.violations?.length || 0,
        summary: result.summary || {},
        error: result.error || null,
      };
    }

    const categories = this.categorizeViolations(allViolations);
    const totalScanners = scannerResults.length;
    const passedScanners = scannerResults.filter((r) => r.passed).length;

    return {
      url,
      timestamp: new Date().toISOString(),
      accessibilityScore: totalScanners > 0
        ? Math.round((passedScanners / totalScanners) * 100)
        : 0,
      totalViolations: allViolations.length,
      violations: allViolations,
      scanners: scannerSummaries,
      categories,
    };
  }

  categorizeViolations(violations) {
    const categories = {
      perceivable: { violations: 0 },
      operable: { violations: 0 },
      understandable: { violations: 0 },
      robust: { violations: 0 },
    };

    for (const v of violations) {
      const principle = v.wcagPrinciple || 'robust';
      if (categories[principle]) {
        categories[principle].violations++;
      } else {
        categories.robust.violations++;
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

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = ScanPipeline;
