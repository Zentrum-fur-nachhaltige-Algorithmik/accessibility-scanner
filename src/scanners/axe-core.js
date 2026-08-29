/**
 * Axe-core Adapter.
 * WCAG 2.0 to 2.2 A/AA/AAA rules as shipped by axe-core.
 * Wraps @axe-core/puppeteer as a BaseScanner and converts its violations and
 * incomplete results into the pipeline's unified violation format.
 */

const BaseScanner = require('../core/base-scanner');
const { AxePuppeteer } = require('@axe-core/puppeteer');
const { isHardViolation } = require('../core/severity');
const { injectableCode: contrastUtils } = require('../utils/browser-contrast');
const { injectableCode: paintedBackgroundUtils } = require('../utils/painted-background');
const { injectableCode: mediaAudioUtils } = require('../utils/media-audio');
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

  /**
   * Decide SC 1.4.3 for the nodes axe leaves `incomplete` under `color-contrast`.
   *
   * axe stops as soon as the backdrop is not a plain colour it can read from
   * the CSSOM: a translucent fill, a gradient, a background image, an element
   * whose box paints at zero height. None of that says the text fails. The
   * decision is taken in the page: the background stack is composited (alpha
   * and opacity applied, gradient stops resolved, background images that never
   * loaded skipped and same-origin ones sampled under the text) and the ratio
   * is measured against the threshold the font size and weight ask for.
   *
   * @returns {Promise<Map<string, object>>} target selector -> decision
   */
  async _decideContrast(page, incompleteRules) {
    const targets = [];
    for (const rule of incompleteRules || []) {
      if (rule.id !== 'color-contrast') continue;
      for (const node of rule.nodes) {
        // A target of more than one selector points into a frame, whose
        // document this page cannot reach.
        if (!Array.isArray(node.target) || node.target.length !== 1) continue;
        if (typeof node.target[0] !== 'string') continue;
        targets.push(node.target[0]);
      }
    }
    if (targets.length === 0) return new Map();

    const decisions = await page.evaluate(
      async (selectors, contrastCode, paintedCode) => {
        eval(contrastCode);
        eval(paintedCode);
        const out = [];
        for (const selector of selectors) {
          let element = null;
          try {
            element = document.querySelector(selector);
          } catch (e) {
            element = null;
          }
          if (!element) {
            out.push([selector, { decision: 'review', reason: 'element not found' }]);
            continue;
          }
          try {
            out.push([selector, await __decideTextContrast(element)]);
          } catch (e) {
            out.push([selector, { decision: 'review', reason: String(e && e.message) }]);
          }
        }
        return out;
      },
      targets,
      contrastUtils,
      paintedBackgroundUtils
    );

    return new Map(decisions);
  }

  /**
   * Whether the media elements axe leaves `incomplete` under `video-caption`
   * or `no-autoplay-audio` carry audio at all.
   *
   * Both rules name criteria about audio: 1.2.2 asks for captions of the audio
   * of synchronized media, 1.4.2 for a control over audio that starts by
   * itself. A looping background decoration with no audio track is outside
   * both, and axe cannot read the track, which is why it stops.
   *
   * @returns {Promise<Map<string, object>>} target selector -> { decorative, audio }
   */
  async _decideMedia(page, incompleteRules) {
    const MEDIA_RULES = new Set(['video-caption', 'no-autoplay-audio']);
    const targets = [];
    for (const rule of incompleteRules || []) {
      if (!MEDIA_RULES.has(rule.id)) continue;
      for (const node of rule.nodes) {
        if (!Array.isArray(node.target) || node.target.length !== 1) continue;
        if (typeof node.target[0] !== 'string') continue;
        targets.push(node.target[0]);
      }
    }
    if (targets.length === 0) return new Map();

    const states = await page.evaluate(
      (selectors, mediaCode) => {
        eval(mediaCode);
        const out = [];
        for (const selector of selectors) {
          let element = null;
          try {
            element = document.querySelector(selector);
          } catch (e) {
            element = null;
          }
          if (!element) continue;
          out.push([
            selector,
            {
              decorative: element.tagName === 'VIDEO' && __isDecorativeBackgroundVideo(element),
              audio: __mediaAudioState(element),
            },
          ]);
        }
        return out;
      },
      targets,
      mediaAudioUtils
    );

    return new Map(states);
  }

  async scan(page, options = {}) {
    await this._ensurePageReady(page);

    const axeBuilder = new AxePuppeteer(page)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .options({ resultTypes: ['violations', 'incomplete'] });

    const axeResults = await axeBuilder.analyze();

    const contrastDecisions = await this._decideContrast(page, axeResults.incomplete).catch((e) => {
      log.warn(`[axe-core] contrast resolution failed: ${e.message}`);
      return new Map();
    });

    const mediaStates = await this._decideMedia(page, axeResults.incomplete).catch((e) => {
      log.warn(`[axe-core] media audio resolution failed: ${e.message}`);
      return new Map();
    });

    const violations = [];
    // Deque best practices are advice about a criterion nothing fails, so they
    // are reported beside the findings instead of among them.
    const bestPractices = [];
    // Nodes whose criterion could not be decided from the page. Reported
    // separately so an unknown is never counted as a failure.
    const needsReview = [];
    let contrastPassed = 0;

    // Convert definitive violations
    for (const rule of axeResults.violations) {
      const bucket = isBestPracticeOnly(rule.tags) ? bestPractices : violations;
      for (const node of rule.nodes) {
        bucket.push(this._convertNode(rule, node, 'violation'));
      }
    }

    // Convert incomplete results as info severity
    for (const rule of axeResults.incomplete || []) {
      const bucket = isBestPracticeOnly(rule.tags) ? bestPractices : violations;
      for (const node of rule.nodes) {
        if (rule.id === 'video-caption' || rule.id === 'no-autoplay-audio') {
          const target =
            Array.isArray(node.target) && node.target.length === 1 ? node.target[0] : null;
          const state = target ? mediaStates.get(target) : null;
          if (
            state &&
            (state.audio === 'silent' || (state.decorative && state.audio !== 'audio'))
          ) {
            log.debug(
              `[axe-core] ${rule.id} ${target}: no audio track (${state.audio}), criterion does not apply`
            );
            continue;
          }
        }

        if (rule.id === 'color-contrast') {
          const target =
            Array.isArray(node.target) && node.target.length === 1 ? node.target[0] : null;
          const decision = target ? contrastDecisions.get(target) : null;
          if (decision && decision.decision === 'pass') {
            contrastPassed++;
            log.debug(
              `[axe-core] color-contrast ${target}: ${decision.minRatio}:1 against ${decision.background}, ` +
                `threshold ${decision.threshold}:1, not reported`
            );
            continue;
          }
          if (decision && decision.decision === 'fail') {
            violations.push(this._convertContrastFailure(rule, node, decision));
            continue;
          }
          needsReview.push(this._convertNode(rule, node, 'incomplete', decision));
          continue;
        }
        bucket.push(this._convertNode(rule, node, 'incomplete'));
      }
    }

    return {
      scannerId: this.id,
      // 'info' (axe incomplete) does not make a page fail, the same rule the
      // score uses.
      passed: violations.filter(isHardViolation).length === 0,
      violations,
      bestPractices,
      needsReview,
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
        bestPracticeNodes: bestPractices.length,
        needsReviewNodes: needsReview.length,
        contrastResolvedAsPassing: contrastPassed,
      },
    };
  }

  /**
   * Convert a single axe-core node result into the unified violation format.
   */
  _convertNode(rule, node, resultType, measured = null) {
    const wcagCriteria = extractWcagCriteria(rule.tags);
    const isIncomplete = resultType === 'incomplete';

    return {
      measured,
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

  /**
   * An `incomplete` color-contrast node whose ratio the page measurement put
   * below the threshold: a 1.4.3 failure with the measured evidence on it.
   */
  _convertContrastFailure(rule, node, measured) {
    const violation = this._convertNode(rule, node, 'violation', measured);
    violation.impact = 'serious';
    violation.severity = 'serious';
    violation.confidence = 'high';
    violation.description =
      `${rule.help} (measured ${measured.maxRatio}:1 against the composited background ` +
      `${measured.background}, ${measured.fontSize} ${measured.fontWeight}, ` +
      `threshold ${measured.threshold}:1)`;
    violation.recommendation =
      `Text ${measured.foreground} on ${measured.background} reaches ${measured.maxRatio}:1 ` +
      `where SC 1.4.3 asks for ${measured.threshold}:1.`;
    return violation;
  }
}

module.exports = AxeCoreAdapter;
