/**
 * One severity vocabulary for the scoring pipeline and the report.
 *
 * Scanners emit a zoo of values: axe impacts (critical/serious/moderate/minor),
 * legacy words (error/major/high/warning), the BaseScanner.formatViolation
 * default 'violation', and null. Before this module the pipeline and the
 * report normalised them differently: 'violation' weighed 0 in the score but
 * rendered as Moderate in the report.
 */
const KNOWN = ['critical', 'serious', 'moderate', 'minor', 'best-practice', 'info'];

const SEVERITY_WEIGHTS = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
  'best-practice': 0,
  info: 0,
};

function mapWord(raw) {
  if (raw == null) return null;
  const s = String(raw).toLowerCase();
  if (s === 'critical' || s === 'error') return 'critical';
  if (s === 'serious' || s === 'major' || s === 'high') return 'serious';
  if (s === 'moderate' || s === 'warning' || s === 'medium') return 'moderate';
  if (s === 'minor' || s === 'low') return 'minor';
  if (s === 'best-practice') return 'best-practice';
  if (s === 'info') return 'info';
  return null;
}

/** @returns {'critical'|'serious'|'moderate'|'minor'|'best-practice'|'info'} */
function normalizeSeverity(violation) {
  if (!violation) return 'moderate';
  return mapWord(violation.severity) || mapWord(violation.impact) || 'moderate';
}

function severityWeight(violation) {
  return SEVERITY_WEIGHTS[normalizeSeverity(violation)] || 0;
}

function isHardViolation(violation) {
  const sev = normalizeSeverity(violation);
  return sev !== 'best-practice' && sev !== 'info';
}

/** Rule identity, using the same field order as the golden-corpus harness. */
function ruleKey(violation) {
  if (!violation) return 'unclassified';
  return String(
    violation.issue || violation.type || violation.ruleId || violation.axeRuleId || 'unclassified'
  );
}

/**
 * How much repeated instances of ONE rule may modulate that rule's penalty.
 *
 * WCAG conformance is judged per success criterion, not per node: an audit
 * records "1.4.11 fails", once, however many footer links share the offending
 * rule. The instance count is triage detail — useful, but it may not dominate
 * the score. So repeats add `log10(n)/2`, capped at +50 %:
 * 1 node -> x1.00, 3 -> x1.24, 8 -> x1.45, 100+ -> x1.50.
 */
const BREADTH_CAP = 1.5;
const BREADTH_SCALE = 0.5;

/**
 * Severity-weighted penalty for a set of violations — the input to the score.
 *
 * Two properties the old `sum of per-violation weights` lacked:
 *
 * 1. **Instances of one rule are one defect.** A single footer rule with a
 *    1.41:1 focus ring produces eight `insufficient-focus-indicator-contrast`
 *    findings; that is one CSS line to fix, not eight independent barriers.
 *    Repeats therefore add sub-linearly (`1 + log10(n)/2`, capped at x1.5)
 *    instead of multiplying the weight by the node count.
 * 2. **Breadth over depth.** Because repeats saturate, a page failing five
 *    different criteria always scores worse than a page failing one criterion
 *    fifty times — which is the ranking an auditor wants.
 *
 * Grouping is by (rule, severity), so the same rule reported at two severities
 * is not silently merged into one.
 */
function violationPenalty(violations) {
  const groups = new Map();
  for (const v of violations || []) {
    const severity = normalizeSeverity(v);
    const weight = SEVERITY_WEIGHTS[severity] || 0;
    if (weight === 0) continue; // info / best-practice never move the score
    const key = `${ruleKey(v)}::${severity}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { weight, n: 1 });
  }

  let penalty = 0;
  for (const { weight, n } of groups.values()) {
    penalty += weight * Math.min(BREADTH_CAP, 1 + BREADTH_SCALE * Math.log10(n));
  }
  return penalty;
}

/**
 * Penalty -> 0..100.
 *
 * `100 - penalty` clipped at 0 stopped discriminating exactly where a score is
 * most useful: every page past 100 penalty points scored 0, so "one bad
 * template" and "no accessibility work at all" looked identical, and the score
 * was 0 on essentially every real site. Exponential decay is monotone, never
 * reaches 0, and agrees with the old subtraction to first order for small
 * penalties (2 -> 98, 5 -> 95, 10 -> 90.5), so existing expectations for
 * lightly-broken pages are unchanged.
 */
function scoreFromPenalty(penalty) {
  return Math.round(100 * Math.exp(-Math.max(0, penalty) / 100));
}

module.exports = {
  normalizeSeverity,
  severityWeight,
  isHardViolation,
  ruleKey,
  violationPenalty,
  scoreFromPenalty,
  SEVERITY_WEIGHTS,
  KNOWN_SEVERITIES: KNOWN,
};
