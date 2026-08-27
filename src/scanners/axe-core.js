/**
 * Axe-core Adapter.
 * WCAG 2.0 to 2.2 A/AA/AAA rules as shipped by axe-core.
 * Wraps @axe-core/puppeteer as a BaseScanner and converts its violations and
 * incomplete results into the pipeline's unified violation format.
 */

const BaseScanner = require('../core/base-scanner');
const { AxePuppeteer } = require('@axe-core/puppeteer');
const { isHardViolation } = require('../core/severity');
const log = require('../utils/logger').createLogger('axe-core');

/**
 * Map axe-core tags to WCAG success criteria strings.
 * Tags like 'wcag143' → '1.4.3'. Level tags ('wcag2a', 'wcag2aa', 'wcag2aaa',
 * 'wcag21aa', 'wcag22aa') are not criteria and are skipped here. They stay on
 * the violation as `axeTags`, where src/wcag-levels.js levelOfViolation() reads
 * them as the conformance-level fallback.
 */
function extractWcagCriteria(tags) {
  const criteria = [];
  for (const tag of tags) {
    const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
    if (m) {
      criteria.push(`${m[1]}.${m[2]}.${parseInt(m[3], 10)}`);
    }
  }
  return criteria;
}

/**
 * True for axe rules that are Deque best practices rather than WCAG failures.
 *
 * axe-core ships about 30 such rules ('region', 'landmark-one-main',
 * 'page-has-heading-one', 'scrollable-region-focusable', ...). They carry the
 * 'best-practice' tag and NO 'wcag*' tag, and axe's own UI renders them in a
 * separate "Best practices" bucket.
 *
 * The guard is "has best-practice AND no wcag tag": a handful of rules
 * (e.g. 'aria-allowed-role') are tagged both, and those stay violations.
 */
function isBestPracticeOnly(tags) {
  const t = tags || [];
  return t.includes('best-practice') && !t.some((tag) => /^wcag/.test(tag));
}

/**
 * Map axe-core impact levels to our normalized severity.
 */
function mapImpactToSeverity(impact) {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'serious';
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    default:
      return 'moderate';
  }
}

class AxeCoreAdapter extends BaseScanner {
  constructor() {
    super('axe-core', {
      wcagCriteria: [], // dynamic per-rule
      wcagPrinciple: 'robust',
    });
  }

  /**
   * axe-puppeteer refuses to inject axe-core into a document whose
   * `document.readyState` is not 'complete' and throws "Page/Frame is not ready".
   * A single stalled subresource pins the main document at 'interactive'
   * indefinitely, e.g. a third-party <iframe> whose host does not resolve leaves
   * an error frame that never fires `load`, so the parent never completes either.
   * Without this guard the whole scan crashes and reports zero violations for a
   * page that is otherwise perfectly scannable.
   *
   * Give the document a short grace period, then abort outstanding loads with
   * window.stop() (which settles readyState) and scan whatever did load.
   */
  async _ensurePageReady(page, timeoutMs = 2000) {
    const isComplete = () => page.evaluate(() => document.readyState === 'complete');
    try {
      if (await isComplete()) return true;

      await page
        .waitForFunction(() => document.readyState === 'complete', { timeout: timeoutMs })
        .catch(() => null);
      if (await isComplete()) return true;

      // Still stalled: abort pending loads so the document can settle.
      await page.evaluate(() => window.stop());
      await page
        .waitForFunction(() => document.readyState === 'complete', { timeout: timeoutMs })
        .catch(() => null);

      const ready = await isComplete();
      log.warn(
        '[axe-core] Page never reached readyState "complete" (stalled subresource); ' +
          `aborted pending loads and ${ready ? 'continued' : 'proceeding anyway'}.`
      );
      return ready;
    } catch (e) {
      // Page closed / detached: let the analyze() call surface the real error.
      return false;
    }
  }

  async scan(page, options = {}) {
    await this._ensurePageReady(page);

    const axeBuilder = new AxePuppeteer(page)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .options({ resultTypes: ['violations', 'incomplete'] });

    const axeResults = await axeBuilder.analyze();

    const violations = [];

    // Convert definitive violations
    for (const rule of axeResults.violations) {
      for (const node of rule.nodes) {
        violations.push(this._convertNode(rule, node, 'violation'));
      }
    }

    // Convert incomplete results as info severity
    for (const rule of axeResults.incomplete || []) {
      for (const node of rule.nodes) {
        violations.push(this._convertNode(rule, node, 'incomplete'));
      }
    }

    return {
      scannerId: this.id,
      // 'info' (axe incomplete) and 'best-practice' (Deque advice, not a WCAG
      // failure) do not make a page fail, the same rule the score uses.
      passed: violations.filter(isHardViolation).length === 0,
      violations,
      summary: {
        engine: 'axe-core',
        version: axeResults.testEngine?.version || 'unknown',
        rulesRun:
          (axeResults.violations?.length || 0) +
          (axeResults.passes?.length || 0) +
          (axeResults.incomplete?.length || 0) +
          (axeResults.inapplicable?.length || 0),
        violationRules: axeResults.violations?.length || 0,
        incompleteRules: axeResults.incomplete?.length || 0,
        totalNodes: violations.length,
      },
    };
  }

  /**
   * Convert a single axe-core node result into the unified violation format.
   */
  _convertNode(rule, node, resultType) {
    const wcagCriteria = extractWcagCriteria(rule.tags);
    const isIncomplete = resultType === 'incomplete';

    return {
      // Core fields
      scannerId: this.id,
      ruleId: rule.id,
      impact: isIncomplete ? 'minor' : node.impact || rule.impact || 'moderate',
      severity: isIncomplete
        ? 'info'
        : isBestPracticeOnly(rule.tags)
          ? 'best-practice'
          : mapImpactToSeverity(node.impact || rule.impact),
      description: isIncomplete ? `[Needs manual review] ${rule.help}` : rule.help,
      nodes: [
        { selector: Array.isArray(node.target) ? node.target.join(' ') : String(node.target) },
      ],
      wcagCriteria,

      // axe-core specific fields
      axeRuleId: rule.id,
      axeHelp: rule.help,
      axeHelpUrl: rule.helpUrl,
      axeTags: rule.tags,

      // Our scanner fields (null for axe results)
      type: null,
      category: null,
      recommendation: isIncomplete
        ? 'Manual review required: axe-core could not fully evaluate this element.'
        : node.failureSummary || null,

      // Metadata
      source: 'axe-core',
      confidence: isIncomplete ? 'low' : 'high',
    };
  }
}

module.exports = AxeCoreAdapter;
