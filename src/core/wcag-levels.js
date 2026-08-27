/**
 * WCAG 2.2 success criterion to conformance level (A / AA / AAA).
 * Source: src/data/wcag22-criteria.json, shared with scripts/coverage-matrix.js
 * so runtime and coverage matrix cannot disagree about a criterion's level.
 */
const CRITERIA = require('../data/wcag22-criteria.json');

const LEVELS = new Map(CRITERIA.map((c) => [c.sc, c.level]));

const RANK = { A: 0, AA: 1, AAA: 2 };

/**
 * Accepts '2.5.5', '9.2.5.5' (EN 301 549 clause), 'wcag255' / 'wcag2414' (axe tag),
 * or a string starting with one of those ('1.4.3 Contrast'). Returns 'x.y.z' or null.
 */
function normalizeCriterion(input) {
  if (input == null) return null;
  const s = String(input).trim();
  let m = s.match(/^wcag(\d)(\d)(\d+)$/i);
  if (m) return `${m[1]}.${m[2]}.${parseInt(m[3], 10)}`;
  m = s.match(/^(?:9\.)?(\d+\.\d+\.\d+)(?!\d)/);
  if (m) return m[1];
  return null;
}

/** @returns {'A'|'AA'|'AAA'|null} */
function levelOf(criterion) {
  const sc = normalizeCriterion(criterion);
  if (!sc) return null;
  const lvl = LEVELS.get(sc);
  return lvl && lvl !== 'REMOVED' ? lvl : null;
}

function criteriaOfViolation(v) {
  const raw = [];
  if (Array.isArray(v.wcagCriteria)) raw.push(...v.wcagCriteria);
  else if (v.wcagCriteria) raw.push(v.wcagCriteria);
  if (v.criterion) raw.push(v.criterion);
  if (Array.isArray(v.axeTags)) raw.push(...v.axeTags.filter((t) => /^wcag\d{3,}$/i.test(t)));
  const out = new Set();
  for (const r of raw) {
    const sc = normalizeCriterion(r);
    if (sc) out.add(sc);
  }
  return [...out];
}

/**
 * Level a violation must be attributed to. If every criterion it cites is
 * AAA the finding is AAA; otherwise the LOWEST level among them (a finding
 * that fails 1.4.3 (AA) and 1.4.6 (AAA) is an AA failure).
 * Falls back to axe level tags (wcag2a/wcag2aa/wcag2aaa/wcag21aa/wcag22aa)
 * when no criterion is known. Returns null when nothing is known.
 */
function levelOfViolation(v) {
  if (!v) return null;
  const levels = criteriaOfViolation(v).map(levelOf).filter(Boolean);
  if (levels.length === 0 && Array.isArray(v.axeTags)) {
    for (const t of v.axeTags) {
      const m = String(t).match(/^wcag2\d*(a{1,3})$/i);
      if (m) levels.push(m[1].toUpperCase());
    }
  }
  if (levels.length === 0) return null;
  return levels.reduce((best, l) => (RANK[l] < RANK[best] ? l : best));
}

module.exports = { levelOf, levelOfViolation, normalizeCriterion, criteriaOfViolation, LEVELS };
