/**
 * Shared WCAG principle classification.
 *
 * Violations reach us in three shapes: custom scanners set `criterion`
 * ("9.1.4.3", EN 301 549 clause numbering), the axe adapter sets a
 * `wcagCriteria` array plus a non-numeric `ruleId` ("color-contrast"), and LLM
 * scanners set a bare numeric `ruleId` ("1.3.3") via `formatViolation()`.
 *
 * Both `report-generator.js` (which groups findings by principle in the report)
 * and `scan-pipeline.js` (whose `categories` field is part of the scan API)
 * need the same answer, so the logic lives here rather than being duplicated —
 * and `scan-pipeline` importing `report-generator` just for this would drag in
 * `html-pdf-node` and the whole PDF stack.
 */

/**
 * @param {Object} violation
 * @returns {'perceivable'|'operable'|'understandable'|'robust'|'eaa'|'other'}
 */
function classifyWcagPrinciple(violation) {
  if (!violation) return 'other';

  // An explicit principle, if a scanner ever sets one, always wins.
  const explicit = violation.wcagPrinciple;
  if (
    typeof explicit === 'string' &&
    ['perceivable', 'operable', 'understandable', 'robust', 'eaa'].includes(explicit)
  ) {
    return explicit;
  }

  const candidates = [
    violation.criterion,
    violation.wcagCriteria,
    violation.clause,
    // Last resort: LLM scanners put the bare SC number in ruleId. axe puts a
    // rule NAME there, which simply will not match the numeric pattern below.
    violation.ruleId,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const str = Array.isArray(candidate) ? String(candidate[0] ?? '') : String(candidate);
    if (!str) continue;

    if (str.startsWith('EAA-')) return 'eaa';

    const match = str.match(/^(?:9\.)?([1-4])\./);
    if (match) {
      const p = parseInt(match[1], 10);
      if (p === 1) return 'perceivable';
      if (p === 2) return 'operable';
      if (p === 3) return 'understandable';
      if (p === 4) return 'robust';
    }
  }

  return 'other';
}

module.exports = { classifyWcagPrinciple };
