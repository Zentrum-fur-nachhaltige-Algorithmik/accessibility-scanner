/**
 * Violation helpers for the audit UI.
 *
 * Scanner output is heterogeneous: some scanners emit the `formatViolation()`
 * shape from BaseScanner (scannerId / ruleId / impact / description / nodes),
 * axe-core adds its own fields, and a few scanners emit raw objects collected
 * inside page.evaluate() (element / currentRatio / ...). Everything here is
 * therefore defensive and never assumes a field exists.
 */

export const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor', 'best-practice', 'info'];

export const SEVERITY_LABELS = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
  'best-practice': 'Best practice',
  info: 'Manual check',
};

/** Placeholder for empty cells and unknown values. */
export const NOT_AVAILABLE = 'n/a';

/** Which finding-data colour a severity is rendered in. */
export const SEVERITY_TONE = {
  critical: 'serious',
  serious: 'serious',
  moderate: 'moderate',
  minor: 'moderate',
  'best-practice': 'neutral',
  info: 'neutral',
};

/**
 * A finding the scanners could not decide (verdict 'needs-review'). It carries
 * an evidence dossier instead of a verdict, is never a failure, and is never
 * counted or scored.
 */
export function isNeedsReview(violation) {
  return violation?.verdict === 'needs-review';
}

/** Only findings the scanners could prove. */
export function onlyViolations(violations) {
  const list = Array.isArray(violations) ? violations : [];
  return list.filter((violation) => !isNeedsReview(violation));
}

/** The open questions of a scan result, whatever list they arrive in. */
export function needsReviewItems(result) {
  const list = Array.isArray(result?.needsReview) ? result.needsReview : [];
  return list;
}

/** The one decision a reviewer has to make about a needs-review finding. */
export function reviewQuestion(violation) {
  return violation?.dossier?.question || violationText(violation);
}

/** Flat [label, value] pairs of what the scanner did measure. */
export function reviewMeasurements(violation) {
  const measurements = violation?.dossier?.measurements;
  if (!measurements || typeof measurements !== 'object') return [];
  return Object.entries(measurements)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)]);
}

/**
 * What the producer said about the question: an LLM scanner's own evidence and
 * the model id that wrote it. Flat [label, value] pairs, like the measurements.
 */
export function reviewContext(violation) {
  const context = violation?.dossier?.context;
  if (!context || typeof context !== 'object') return [];
  const labels = { evidence: 'Evidence', model: 'Model', axeRuleId: 'axe rule' };
  return Object.entries(context)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [labels[key] || key, String(value)]);
}

/** Mirrors normalizeSeverity() in src/report-generator.js. */
export function normalizeSeverity(violation) {
  const raw = String(violation?.severity || violation?.impact || 'moderate').toLowerCase();
  if (raw === 'critical' || raw === 'error') return 'critical';
  if (raw === 'serious' || raw === 'major' || raw === 'high') return 'serious';
  if (raw === 'moderate' || raw === 'warning') return 'moderate';
  if (raw === 'minor' || raw === 'low') return 'minor';
  if (raw === 'best-practice') return 'best-practice';
  if (raw === 'info' || raw === 'incomplete') return 'info';
  return 'moderate';
}

function joinCriteria(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value ? String(value) : '';
}

export function violationCriterion(violation) {
  return (
    violation?.criterion ||
    violation?.clause ||
    joinCriteria(violation?.wcagCriteria) ||
    violation?.wcagCriterion ||
    ''
  );
}

export function violationRule(violation) {
  return violation?.ruleId || violation?.rule || violation?.type || '';
}

export const WCAG_PRINCIPLES = [
  ['perceivable', 'Perceivable'],
  ['operable', 'Operable'],
  ['understandable', 'Understandable'],
  ['robust', 'Robust'],
];

/**
 * Map a finding to its WCAG principle via its success criterion.
 *
 * Mirrors classifyWcagPrinciple() in src/report-generator.js, including the
 * EN 301 549 form: that standard nests the WCAG success criteria under its own
 * clause 9 ("9.1.4.10" is WCAG "1.4.10"), so the leading "9." is optional in
 * the pattern. Without it every EN-prefixed id reads as principle 9 and falls
 * through to the default bucket.
 *
 * Deliberately NOT read from `result.categories`: the pipeline builds those
 * counts from `violation.wcagPrinciple`, which the scanners never set, so
 * every finding is counted as "robust" there.
 *
 * @returns {'perceivable'|'operable'|'understandable'|'robust'|'eaa'|'other'}
 */
export function violationPrinciple(violation) {
  const criterion = String(
    violation?.criterion || joinCriteria(violation?.wcagCriteria) || violation?.clause || ''
  ).trim();

  if (/^EAA-/i.test(criterion)) return 'eaa';

  const match = criterion.match(/^(?:9\.)?([1-4])\./);
  if (match) {
    const principle = Number(match[1]);
    if (principle === 1) return 'perceivable';
    if (principle === 2) return 'operable';
    if (principle === 3) return 'understandable';
    if (principle === 4) return 'robust';
  }
  return 'other';
}

/**
 * Findings per WCAG principle. The four principles are always listed (a zero
 * is information too); EAA procedures and unmappable ids are only shown when
 * they occur; an id we cannot map belongs in "Unclassified", never in a
 * guessed principle.
 */
export function principleCounts(violations) {
  const list = Array.isArray(violations) ? violations : [];
  const counts = {
    perceivable: 0,
    operable: 0,
    understandable: 0,
    robust: 0,
    eaa: 0,
    other: 0,
  };

  for (const violation of onlyViolations(list)) counts[violationPrinciple(violation)] += 1;

  const rows = WCAG_PRINCIPLES.map(([key, label]) => ({
    key,
    label,
    count: counts[key],
  }));
  if (counts.eaa) {
    rows.push({ key: 'eaa', label: 'EU/EAA procedures', count: counts.eaa });
  }
  if (counts.other) {
    rows.push({ key: 'other', label: 'Unclassified', count: counts.other });
  }
  return rows;
}

export function violationText(violation) {
  const text =
    violation?.description || violation?.issue || violation?.message || violation?.type || '';
  if (text) return String(text);
  // Raw contrast findings carry no prose: synthesise a readable sentence.
  if (violation?.currentRatio != null && violation?.requiredRatio != null) {
    return `Contrast ratio ${violation.currentRatio}:1 is below the required ${violation.requiredRatio}:1.`;
  }
  return 'Finding without description (see details).';
}

export function violationElement(violation) {
  return violation?.element || violation?.selector || violation?.nodes?.[0]?.selector || '';
}

export function violationRemediation(violation) {
  const text =
    violation?.suggestion ||
    violation?.recommendation ||
    violation?.axeHelp ||
    violation?.help ||
    '';
  if (text) return String(text);
  if (violation?.suggestedForeground) {
    return `Suggested foreground colour: ${violation.suggestedForeground}.`;
  }
  return '';
}

export function violationHelpUrl(violation) {
  const url = violation?.helpUrl || violation?.href || '';
  return /^https?:\/\//i.test(url) ? url : '';
}

export function violationDetails(violation) {
  const details = violation?.details;
  if (Array.isArray(details)) return details.filter(Boolean).map(String);
  if (typeof details === 'string' && details.trim()) return [details];
  return [];
}

const ACRONYMS = {
  llm: 'LLM',
  aria: 'ARIA',
  html: 'HTML',
  css: 'CSS',
  eaa: 'EAA',
  eu: 'EU',
  spa: 'SPA',
  wcag: 'WCAG',
  axe: 'axe',
  core: 'core',
  ui: 'UI',
};

/** Scanner ids whose display name is not derived from the id. */
const SCANNER_NAMES = {
  'axe-core': 'axe-core',
};

/** 'label-in-name' -> 'Label in name'; 'llm-behavioral' -> 'LLM behavioral'. */
export function scannerLabel(scannerId) {
  if (!scannerId) return 'No module assigned';
  if (SCANNER_NAMES[scannerId]) return SCANNER_NAMES[scannerId];
  const words = String(scannerId).split(/[-_]/).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return lower;
    })
    .join(' ');
}

/** Counts per severity, ordered worst-first, zero buckets omitted. */
export function severityCounts(violations) {
  const counts = {};
  for (const violation of onlyViolations(violations)) {
    const severity = normalizeSeverity(violation);
    counts[severity] = (counts[severity] || 0) + 1;
  }
  return SEVERITY_ORDER.filter((severity) => counts[severity]).map((severity) => ({
    severity,
    label: SEVERITY_LABELS[severity],
    count: counts[severity],
  }));
}

function worstSeverityRank(violations) {
  let rank = SEVERITY_ORDER.length;
  for (const violation of violations) {
    const index = SEVERITY_ORDER.indexOf(normalizeSeverity(violation));
    if (index >= 0 && index < rank) rank = index;
  }
  return rank;
}

function sortBySeverity(violations) {
  return [...violations].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(normalizeSeverity(a)) - SEVERITY_ORDER.indexOf(normalizeSeverity(b))
  );
}

function criterionKey(violation) {
  const criterion = violationCriterion(violation);
  const rule = violationRule(violation);
  return `${criterion}\u0000${rule}`;
}

function criterionLabel(violation) {
  const criterion = violationCriterion(violation);
  const rule = violationRule(violation);
  if (criterion && rule && rule !== criterion) return `${criterion}: ${rule}`;
  return criterion || rule || 'No criterion given';
}

/**
 * Group violations for display.
 *
 * @param {Array} violations
 * @param {'criterion'|'scanner'} mode
 * @returns {Array<{key, label, note, count, severities, items, subgroups}>}
 *   `subgroups` is populated in scanner mode (criteria inside a scanner),
 *   `items` in criterion mode.
 */
export function groupViolations(violations, mode = 'criterion') {
  const list = onlyViolations(violations);
  const buckets = new Map();

  for (const violation of list) {
    const key = mode === 'scanner' ? violation?.scannerId || '' : criterionKey(violation);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(violation);
  }

  const groups = [];
  for (const [key, items] of buckets) {
    const first = items[0];
    const isUnattributed = mode === 'scanner' && !key;
    groups.push({
      key: key || '__unattributed__',
      label:
        mode === 'scanner'
          ? isUnattributed
            ? 'Findings without module assignment'
            : scannerLabel(key)
          : criterionLabel(first),
      note: isUnattributed ? 'These findings were reported without a scan module.' : '',
      count: items.length,
      severities: severityCounts(items),
      rank: worstSeverityRank(items),
      items: mode === 'scanner' ? [] : sortBySeverity(items),
      subgroups:
        mode === 'scanner'
          ? groupViolations(items, 'criterion').map((subgroup) => ({
              ...subgroup,
              key: `${key || '__unattributed__'}::${subgroup.key}`,
            }))
          : [],
    });
  }

  groups.sort((a, b) => a.rank - b.rank || b.count - a.count || a.label.localeCompare(b.label));
  return groups;
}

/**
 * Verdict for a score. The wording never claims full conformity: an automated
 * assessment can only report what it was able to detect.
 *
 * @returns {{label: string, seal: string, tone: 'pass'|'moderate'|'serious'|'neutral'}}
 */
export function scoreBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) {
    return { label: 'No result', seal: 'NO RESULT', tone: 'neutral' };
  }
  if (value >= 90) {
    return {
      label: 'No barriers detected automatically',
      seal: 'NO BARRIERS',
      tone: 'pass',
    };
  }
  if (value >= 50) {
    return {
      label: 'Partially conformant (automated check)',
      seal: 'PARTIALLY CONFORMANT',
      tone: 'moderate',
    };
  }
  return {
    label: 'Not conformant: significant barriers detected',
    seal: 'NOT CONFORMANT',
    tone: 'serious',
  };
}

function formatWith(isoString, options) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', options).format(date);
  } catch {
    return date.toISOString();
  }
}

/** "27 Jul 2026, 16:49" */
export function formatDateTime(isoString) {
  return formatWith(isoString, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "27 Jul 2026" */
export function formatDate(isoString) {
  return formatWith(isoString, { dateStyle: 'medium' });
}

export function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes > 0) return `${minutes} min ${rest} s`;
  return `${rest} s`;
}

export function countScannerErrors(result) {
  const scanners = result?.scanners || {};
  return Object.values(scanners).filter((entry) => entry && entry.error).length;
}
