#!/usr/bin/env node

/**
 * WCAG 2.2 coverage matrix generator.
 * Maps every success criterion to one primary mechanism (axe-core, deterministic
 * scanner, LLM scanner, manual review) and to the fixtures and harness results
 * that prove it. Exits non-zero when a criterion is mapped but not evidenced.
 *
 * Usage:
 *   node scripts/coverage-matrix.js            # update README.md and tests/data/coverage-matrix.json
 *   node scripts/coverage-matrix.js --check    # fail if either is stale
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEST_SITES = path.join(ROOT, 'test-sites');
const README = path.join(ROOT, 'README.md');
const OUT_JSON = path.join(ROOT, 'tests', 'data', 'coverage-matrix.json');

// ---------------------------------------------------------------------------
// Mechanism vocabulary
// ---------------------------------------------------------------------------

const MECHANISM = {
  AXE: 'axe-core',
  DETERMINISTIC: 'deterministic',
  LLM: 'llm',
  HYBRID: 'hybrid',
  MANUAL: 'MANUAL',
  NOT_APPLICABLE: 'NOT-APPLICABLE-STATIC',
};

/**
 * Criteria that no single-page static scan can decide, with the one-line
 * justification the matrix is required to carry. Anything listed here is
 * not counted as automated coverage.
 *
 * Keep this list short: every entry is an audit gap a human has to close by hand.
 */
const MANUAL_OVERRIDES = {
  '1.2.4': {
    mechanism: MECHANISM.MANUAL,
    justification:
      'Captions (Live): requires a running live stream; a static page ' +
      'exposes no signal about whether a future broadcast will be captioned.',
  },
  '1.3.2': {
    mechanism: MECHANISM.MANUAL,
    justification:
      'Meaningful Sequence: the correct reading order is defined by authorial ' +
      'meaning; DOM-vs-visual order mismatches are routinely intentional, so any ' +
      'static heuristic is a noise generator. axe-core likewise ships no 1.3.2 rule.',
  },
  '2.5.5': {
    mechanism: MECHANISM.MANUAL,
    justification:
      'Target Size (Enhanced) (AAA): the AA minimum (2.5.8, 24x24 with the ' +
      'spacing exception) is automated in input-modalities; the 44x44 AAA size ' +
      'is a design review item.',
  },
  '2.4.6': {
    mechanism: MECHANISM.MANUAL,
    justification:
      'Headings and Labels: whether a heading or a label describes its topic is a ' +
      'judgement about meaning. An empty heading is axe-core `empty-heading` and an ' +
      'unnamed control is axe-core `label`; what is left needs a reader. axe-core ' +
      'ships no 2.4.6 rule either.',
  },
  '2.4.8': {
    mechanism: MECHANISM.MANUAL,
    justification:
      'Location (AAA): whether a user can determine their position requires the ' +
      'surrounding set of pages and its information architecture, not one page.',
  },
  '3.3.6': {
    mechanism: MECHANISM.MANUAL,
    justification:
      'Error Prevention (All) (AAA): reversibility, checkability and confirmation of a ' +
      'submission is server-side behaviour that is not observable from the page.',
  },
  '4.1.1': {
    mechanism: MECHANISM.NOT_APPLICABLE,
    justification:
      'Parsing: removed from WCAG 2.2; retained in the list only so the ' +
      'numbering stays complete. Not a conformance requirement any more.',
  },
};

// ---------------------------------------------------------------------------
// 1. Criterion list
// ---------------------------------------------------------------------------

/**
 * @returns {{sc: string, level: 'A'|'AA'|'AAA'|'REMOVED', title: string}[]}
 */
function parseCriteria() {
  return require(path.join(ROOT, 'src', 'data', 'wcag22-criteria.json'));
}

// ---------------------------------------------------------------------------
// 2. Scanner → criteria
// ---------------------------------------------------------------------------

/**
 * Instantiate every scanner and read its declared `wcagCriteria`.
 * LLM scanners are built with a stub client so they register without an API key.
 */
function collectScanners() {
  const { createAllScanners } = require(path.join(ROOT, 'src', 'core', 'scanner-registry.js'));
  const scanners = createAllScanners({ llmClient: {} });

  const { trustTier, trustReason } = require(path.join(ROOT, 'src', 'core', 'scanner-trust.js'));

  return scanners.map((s) => ({
    id: s.id,
    criteria: (s.wcagCriteria || []).filter((c) => /^\d+\.\d+\.\d+$/.test(c)),
    kind: s.id === 'axe-core' ? 'axe' : s.id.startsWith('llm-') ? 'llm' : 'deterministic',
    exclusive: Boolean(s.needsExclusiveAccess),
    trust: trustTier(s.id),
    trustReason: trustReason(s.id),
  }));
}

// ---------------------------------------------------------------------------
// 3. axe-core rule coverage
// ---------------------------------------------------------------------------

function collectAxeCriteria() {
  const axe = require('axe-core');
  const rules = axe.getRules([
    'wcag2a',
    'wcag2aa',
    'wcag2aaa',
    'wcag21a',
    'wcag21aa',
    'wcag21aaa',
    'wcag22a',
    'wcag22aa',
    'best-practice',
  ]);

  /** @type {Map<string, string[]>} criterion → axe rule ids */
  const byCriterion = new Map();
  for (const rule of rules) {
    for (const tag of rule.tags || []) {
      const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
      if (!m) continue;
      const sc = `${m[1]}.${m[2]}.${parseInt(m[3], 10)}`;
      if (!byCriterion.has(sc)) byCriterion.set(sc, []);
      byCriterion.get(sc).push(rule.ruleId);
    }
  }
  return byCriterion;
}

// ---------------------------------------------------------------------------
// 4. Test fixtures
// ---------------------------------------------------------------------------

function collectFixtures() {
  const { parseDirectory } = require('./harness/wcag-metadata-parser');

  // parseDirectory logs warnings for unparseable files; keep the output clean.
  const origErr = console.error;
  console.error = () => {};
  let parsed;
  try {
    ({ parsed } = parseDirectory(TEST_SITES));
  } finally {
    console.error = origErr;
  }

  /** @type {Map<string, {good: string[], bad: string[]}>} */
  const byCriterion = new Map();
  for (const meta of parsed) {
    for (const c of meta.criterion || []) {
      if (!byCriterion.has(c)) byCriterion.set(c, { good: [], bad: [] });
      const bucket = byCriterion.get(c);
      if (meta.testType === 'good') bucket.good.push(meta.file);
      else if (meta.testType === 'bad') bucket.bad.push(meta.file);
    }
  }
  return { byCriterion, fileCount: parsed.length };
}

// ---------------------------------------------------------------------------
// 5. Harness coverage
// ---------------------------------------------------------------------------

/**
 * Which criteria each harness actually asserts on.
 *
 * The harness modules export their scanner→criteria tables (and guard their
 * `main()` behind `require.main === module`), so this reads the real tables
 * rather than regex-scraping source.
 *
 * `axe-e2e` is `tests/e2e/axe-core.test.js`, which runs the axe adapter
 * over EVERY good/bad fixture; it therefore verifies any criterion axe-core has
 * a rule for, provided fixtures exist for it.
 *
 * @returns {Map<string, string[]>} criterion → harness ids
 */
function collectHarnessCoverage(axeByCriterion, fixturesByCriterion, scanners) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  const add = (sc, harness) => {
    if (!map.has(sc)) map.set(sc, new Set());
    map.get(sc).add(harness);
  };

  const byScannerId = new Map(scanners.map((s) => [s.id, s]));

  /**
   * A harness table entry may declare its criteria inline, or (as the
   * concurrent harness does) leave them out and read each scanner's own
   * `wcagCriteria` at run time. Resolve both shapes the same way.
   */
  const criteriaOf = (id, def) =>
    def && Array.isArray(def.criteria) && def.criteria.length
      ? def.criteria
      : byScannerId.get(id)?.criteria || [];

  const tryRequire = (rel) => {
    const p = path.join(ROOT, 'scripts', 'harness', rel);
    if (!fs.existsSync(p)) return null;
    try {
      return require(p);
    } catch (e) {
      console.warn(`coverage-matrix: could not load harness ${rel}: ${e.message}`);
      return null;
    }
  };

  const exclusive = tryRequire('exclusive.js');
  for (const [id, def] of Object.entries(exclusive?.EXCLUSIVE_SCANNERS || {})) {
    for (const c of criteriaOf(id, def)) add(c, 'exclusive');
  }

  const concurrent = tryRequire('concurrent.js');
  for (const [id, def] of Object.entries(concurrent?.CONCURRENT_SCANNERS || {})) {
    for (const c of criteriaOf(id, def)) add(c, 'concurrent');
  }

  const llm = tryRequire('llm.js');
  for (const [id, def] of Object.entries(llm?.SCANNER_TESTS || {})) {
    for (const c of criteriaOf(id, def)) add(c, 'llm');
  }

  // Golden corpus: real, healthy pages on which the listed criteria's rules
  // must stay silent (false-positive guard, not a detection guard).
  const golden = tryRequire('golden.js');
  for (const c of golden?.GOLDEN_CRITERIA || []) add(c, 'golden');

  for (const sc of axeByCriterion.keys()) {
    const fx = fixturesByCriterion.get(sc);
    if (fx && fx.good.length > 0) add(sc, 'axe-e2e');
  }

  const out = new Map();
  for (const [sc, set] of map) out.set(sc, [...set].sort());
  return out;
}

// ---------------------------------------------------------------------------
// 6. Recorded harness outcomes: how well, not only whether it is tested
// ---------------------------------------------------------------------------

const RAW_DIR = path.join(ROOT, 'tests', 'data', 'harness');

/**
 * Read every checked-in `harness-*.json` produced by the three harnesses
 * (`--json <path>`) and reduce them to a per-criterion detection verdict.
 *
 * This is the difference between "a harness has an entry for 4.1.2" and "a
 * harness actually detects the 4.1.2 bad file and stays clean on the good one".
 * Recorded rather than executed, because the matrix must be regenerable without
 * launching a browser or spending money on LLM calls.
 *
 * @returns {Map<string, {tp: boolean|null, fpClean: boolean|null, runs: number}>}
 */
function collectHarnessOutcomes() {
  /** @type {Map<string, {badTotal:number, badDetected:number, goodTotal:number, goodClean:number, from:Set<string>}>} */
  const acc = new Map();

  if (!fs.existsSync(RAW_DIR)) return new Map();

  const files = fs.readdirSync(RAW_DIR).filter((f) => /^harness-.*\.json$/.test(f));
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf-8'));
    } catch (e) {
      console.warn(`coverage-matrix: ignoring unreadable ${f}: ${e.message}`);
      continue;
    }
    const harnessName = data.harness || f.replace(/^harness-|\.json$/g, '');
    for (const r of data.results || data.records || []) {
      for (const c of r.criteria || r.expected || []) {
        if (!acc.has(c)) {
          acc.set(c, {
            badTotal: 0,
            badDetected: 0,
            goodTotal: 0,
            goodClean: 0,
            from: new Set(),
          });
        }
        const a = acc.get(c);
        a.from.add(harnessName);
        const isBad = r.expectViolations === true || r.kind === 'bad';
        const passed = r.status === 'PASS' || r.pass === true;
        if (isBad) {
          a.badTotal++;
          if (passed) a.badDetected++;
        } else {
          a.goodTotal++;
          if (passed) a.goodClean++;
        }
      }
    }
  }

  const out = new Map();
  for (const [c, a] of acc) {
    out.set(c, {
      tp: a.badTotal === 0 ? null : a.badDetected > 0,
      fpClean: a.goodTotal === 0 ? null : a.goodClean === a.goodTotal,
      runs: a.badTotal + a.goodTotal,
      from: [...a.from].sort(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildRows() {
  const criteria = parseCriteria();
  const scanners = collectScanners();
  const axeByCriterion = collectAxeCriteria();
  const { byCriterion: fixtures, fileCount } = collectFixtures();
  const harnesses = collectHarnessCoverage(axeByCriterion, fixtures, scanners);
  const outcomes = collectHarnessOutcomes();

  const rows = criteria.map(({ sc, level, title }) => {
    const det = scanners.filter((s) => s.kind === 'deterministic' && s.criteria.includes(sc));
    const llm = scanners.filter((s) => s.kind === 'llm' && s.criteria.includes(sc));
    const axeRules = axeByCriterion.get(sc) || [];
    const fx = fixtures.get(sc) || { good: [], bad: [] };
    const harness = harnesses.get(sc) || [];

    const override = MANUAL_OVERRIDES[sc];

    let mechanism = null;
    let justification = override ? override.justification : '';
    let supporting = [];

    if (override) {
      mechanism = override.mechanism;
    } else {
      // Trust-tiered coverage: an EXPERIMENTAL scanner does not count towards
      // completeness (it is quarantined out of the default profiles), but it is
      // never silently dropped: a criterion covered only by experimental
      // scanners is reported as `experimental:<ids>` with the quarantine reason,
      // so the gap is visible instead of vanishing.
      const provenDet = det.filter((s) => s.trust === 'proven');
      const provenLlm = llm.filter((s) => s.trust === 'proven');
      const quarantined = [...det, ...llm].filter((s) => s.trust !== 'proven');

      const detIds = provenDet.map((s) => s.id);
      const llmIds = provenLlm.map((s) => s.id);
      const hasAxe = axeRules.length > 0;

      if (!hasAxe && detIds.length === 0 && llmIds.length === 0 && quarantined.length > 0) {
        mechanism = `experimental:${quarantined.map((s) => s.id).join('+')}`;
        justification =
          `Only experimental scanners cover this criterion: ` +
          quarantined.map((s) => `${s.id}: ${s.trustReason}`).join(' ;; ');
        supporting = [];
      } else if (hasAxe && (detIds.length || llmIds.length)) {
        const primaryCustom = detIds[0] || llmIds[0];
        mechanism = `${MECHANISM.HYBRID}:axe-core+${primaryCustom}`;
        supporting = [...detIds, ...llmIds].filter((id) => id !== primaryCustom);
      } else if (hasAxe) {
        mechanism = MECHANISM.AXE;
      } else if (detIds.length && llmIds.length) {
        mechanism = `${MECHANISM.HYBRID}:${detIds[0]}+${llmIds[0]}`;
        supporting = [...detIds.slice(1), ...llmIds.slice(1)];
      } else if (detIds.length) {
        mechanism = `${MECHANISM.DETERMINISTIC}:${detIds[0]}`;
        supporting = detIds.slice(1);
      } else if (llmIds.length) {
        mechanism = `${MECHANISM.LLM}:${llmIds[0]}`;
        supporting = llmIds.slice(1);
      } else {
        mechanism = null; // UNMAPPED: validate() turns this into a build failure
      }

      if (mechanism && !mechanism.startsWith('experimental:') && quarantined.length > 0) {
        supporting = [...supporting, ...quarantined.map((s) => `${s.id} (experimental)`)];
      }
    }

    const isManual = mechanism === MECHANISM.MANUAL || mechanism === MECHANISM.NOT_APPLICABLE;
    const isExperimentalOnly = Boolean(mechanism && mechanism.startsWith('experimental:'));

    return {
      sc,
      level,
      title,
      mechanism,
      supporting,
      justification,
      isManual,
      isExperimentalOnly,
      axeRules,
      deterministic: det.map((s) => s.id),
      llm: llm.map((s) => s.id),
      fixtures: fx,
      harness,
      outcome: outcomes.get(sc) || null,
    };
  });

  return { rows, scanners, fileCount, outcomeCount: outcomes.size };
}

// ---------------------------------------------------------------------------
// Validation: these are build failures
// ---------------------------------------------------------------------------

function validate(rows) {
  const errors = [];

  for (const r of rows) {
    if (!r.mechanism) {
      errors.push(
        `${r.sc} (${r.level}) "${r.title}" is UNMAPPED: no axe rule, no scanner, and ` +
          `no MANUAL_OVERRIDES entry. Add a scanner or an override with a justification.`
      );
      continue;
    }

    if ((r.isManual || r.isExperimentalOnly) && !r.justification.trim()) {
      errors.push(`${r.sc} is ${r.mechanism} but carries no justification.`);
      continue;
    }

    // Automatable A and AA criteria carry the full evidence burden.
    // Experimental-only criteria are explicitly NOT counted as covered, so they
    // are exempt from the harness and fixture burden; the quarantine reason is
    // the evidence, and the gap is reported in the summary instead.
    if (!r.isManual && !r.isExperimentalOnly && (r.level === 'A' || r.level === 'AA')) {
      if (r.fixtures.bad.length === 0 || r.fixtures.good.length === 0) {
        errors.push(
          `${r.sc} (${r.level}) is automated via ${r.mechanism} but lacks a good+bad ` +
            `fixture pair (good=${r.fixtures.good.length}, bad=${r.fixtures.bad.length}).`
        );
      }
      if (r.harness.length === 0) {
        errors.push(
          `${r.sc} (${r.level}) is automated via ${r.mechanism} but no harness asserts ` +
            `on it (exclusive/concurrent/llm/axe-e2e all absent).`
        );
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function mechanismBucket(mechanism) {
  if (!mechanism) return 'UNMAPPED';
  if (mechanism === MECHANISM.MANUAL) return 'MANUAL';
  if (mechanism === MECHANISM.NOT_APPLICABLE) return 'NOT-APPLICABLE-STATIC';
  if (mechanism === MECHANISM.AXE) return 'axe-core';
  if (mechanism.startsWith('hybrid:')) return 'hybrid';
  if (mechanism.startsWith('deterministic:')) return 'deterministic';
  if (mechanism.startsWith('llm:')) return 'llm';
  if (mechanism.startsWith('experimental:')) return 'experimental-only';
  return 'UNKNOWN';
}

const START = '<!-- coverage-matrix:start -->';
const END = '<!-- coverage-matrix:end -->';

/** Summary block spliced into README.md between the marker comments. */
function renderSummary(rows) {
  const counts = {};
  const countsByLevel = {};
  for (const r of rows) {
    const b = mechanismBucket(r.mechanism);
    counts[b] = (counts[b] || 0) + 1;
    countsByLevel[r.level] = countsByLevel[r.level] || {};
    countsByLevel[r.level][b] = (countsByLevel[r.level][b] || 0) + 1;
  }
  const at = (lvl, b) => (countsByLevel[lvl] && countsByLevel[lvl][b]) || 0;
  const bucketOrder = [
    'axe-core',
    'hybrid',
    'deterministic',
    'llm',
    'experimental-only',
    'MANUAL',
    'NOT-APPLICABLE-STATIC',
    'UNMAPPED',
  ];
  const L = [];
  L.push('| Mechanism | Criteria | A | AA | AAA | Removed |');
  L.push('|---|---:|---:|---:|---:|---:|');
  for (const b of bucketOrder) {
    if (!counts[b]) continue;
    L.push(
      `| ${b} | ${counts[b]} | ${at('A', b)} | ${at('AA', b)} | ${at('AAA', b)} | ${at('REMOVED', b)} |`
    );
  }
  const n = (lvl) => rows.filter((r) => r.level === lvl).length;
  L.push(`| total | ${rows.length} | ${n('A')} | ${n('AA')} | ${n('AAA')} | ${n('REMOVED')} |`);
  L.push('');
  const aa = rows.filter((r) => r.level === 'A' || r.level === 'AA');
  const automated = aa.filter((r) => !r.isManual && !r.isExperimentalOnly).length;
  const manual = aa.filter((r) => r.isManual).length;
  const experimental = aa.filter((r) => r.isExperimentalOnly).length;
  L.push(
    `A and AA: ${automated} of ${aa.length} criteria are covered by proven mechanisms, ` +
      `${manual} need manual review, ${experimental} are covered only by experimental scanners ` +
      'and do not count as covered.'
  );
  L.push('');
  L.push(
    'Full matrix with fixtures, harness evidence and justifications: tests/data/coverage-matrix.json.'
  );
  return L.join('\n');
}

function spliceReadme(readme, summary) {
  const i = readme.indexOf(START);
  const j = readme.indexOf(END);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`README.md is missing the ${START} / ${END} markers`);
  }
  return readme.slice(0, i + START.length) + '\n' + summary + '\n' + readme.slice(j);
}

function renderJson(rows, scanners, fileCount) {
  return JSON.stringify({ fixtureCount: fileCount, scanners, rows }, null, 2) + '\n';
}

function main() {
  const checkOnly = process.argv.slice(2).includes('--check');
  const { rows, scanners, fileCount } = buildRows();
  const errors = validate(rows);

  const readme = fs.readFileSync(README, 'utf-8');
  const nextReadme = spliceReadme(readme, renderSummary(rows));
  const json = renderJson(rows, scanners, fileCount);
  const currentJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, 'utf-8') : '';

  if (checkOnly) {
    if (nextReadme !== readme || json !== currentJson) {
      console.error(
        'coverage-matrix: README.md or tests/data/coverage-matrix.json is stale; run: npm run coverage-matrix'
      );
      process.exit(1);
    }
  } else {
    fs.writeFileSync(README, nextReadme);
    fs.writeFileSync(OUT_JSON, json);
    console.log(`Updated README.md and ${path.relative(ROOT, OUT_JSON)} (${rows.length} criteria)`);
  }

  const buckets = {};
  for (const r of rows) {
    const b = mechanismBucket(r.mechanism);
    buckets[b] = (buckets[b] || 0) + 1;
  }
  console.log('Mechanism counts:', buckets);

  if (errors.length > 0) {
    console.error(`\ncoverage-matrix: ${errors.length} structural gap(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('coverage-matrix: complete, every criterion mapped and evidenced.');
}

if (require.main === module) {
  main();
}

module.exports = { buildRows, validate, parseCriteria, MANUAL_OVERRIDES, mechanismBucket };
