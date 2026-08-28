#!/usr/bin/env node

/**
 * precision-check.js: precision gate over the frozen real-world corpus.
 *
 * Runs the same pipeline as scripts/harness/realworld.js over the eleven
 * snapshots, matches every finding to tests/data/realworld-labels.json by
 * (snapshot, rule id, node selector) and reports, per rule id, how many of the
 * findings a human judged to be real. A rule with at least MIN_LABELLED
 * labelled findings must report no false one.
 *
 * Usage:
 *   node scripts/precision-check.js
 *   node scripts/precision-check.js --only wiki-medical-de.html
 *   node scripts/precision-check.js --json /tmp/precision.json
 */

const path = require('path');
const fs = require('fs');

const { FIXTURES, FIXTURE_DIR, PROFILE, startServer, scanFile } = require('./harness/realworld');
const { getProfile } = require('../src/core/scanner-registry');

const LABELS_PATH = path.join(__dirname, '..', 'tests', 'data', 'realworld-labels.json');
const EVIDENCE_PATH = path.join(
  __dirname,
  '..',
  'tests',
  'data',
  'harness',
  'harness-precision.json'
);

/** A rule needs this many judged findings before its precision is a gate. */
const MIN_LABELLED = 3;

/** Rule id of a finding, whichever field the producing scanner uses. */
function ruleOf(v) {
  return v.ruleId || v.issue || v.type || v.criterion || 'unknown';
}

/** Node selector of a finding, whichever field the producing scanner uses. */
function selectorOf(v) {
  if (v.element) return String(v.element);
  if (v.selector) return String(v.selector);
  if (Array.isArray(v.nodes) && v.nodes[0]) {
    const n = v.nodes[0];
    if (typeof n === 'string') return n;
    if (n.selector) return String(n.selector);
  }
  return '';
}

function parseArgs(argv) {
  const out = { only: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--json') out.json = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/precision-check.js [--only <file>] [--json <path>]');
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The labels judge a deterministic run; the paid scanners never take part.
  delete process.env.OPENROUTER_API_KEY;

  const labelFile = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'));
  const labels = new Map();
  for (const l of labelFile.labels) {
    labels.set(`${l.snapshot}|${l.rule}|${l.selector}`, l);
  }

  const { scannerIds: profileIds } = getProfile(PROFILE, { includeExperimental: true });
  const scannerIds = profileIds ? profileIds.filter((id) => !id.startsWith('llm-')) : profileIds;

  let fixtures = FIXTURES.filter((f) => fs.existsSync(path.join(FIXTURE_DIR, f.file)));
  if (args.only) fixtures = fixtures.filter((f) => f.file === args.only);
  if (fixtures.length === 0) {
    console.error('No snapshots to run.');
    process.exit(1);
  }

  const { server, port } = await startServer(FIXTURE_DIR);
  console.log(`Serving ${FIXTURE_DIR} on http://localhost:${port}`);
  console.log(
    `Labels: ${labelFile.labels.length} from ${path.relative(process.cwd(), LABELS_PATH)}\n`
  );

  /** rule id -> { reported, true, false, review, unlabelled } */
  const perRule = new Map();
  const unlabelled = [];
  const perFile = [];
  /** Label keys that at least one finding matched. */
  const hit = new Set();

  const realLog = console.log;
  const realWarn = console.warn;
  const realErr = console.error;

  for (const fx of fixtures) {
    const url = `http://localhost:${port}/${fx.file}`;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    const { result, error } = await scanFile(url, scannerIds, {});
    console.log = realLog;
    console.warn = realWarn;
    console.error = realErr;

    if (!result) {
      console.log(`${fx.file.padEnd(30)} SCAN FAILED: ${error}`);
      perFile.push({ file: fx.file, error });
      continue;
    }

    const violations = result.violations || [];
    for (const v of violations) {
      const rule = ruleOf(v);
      const selector = selectorOf(v);
      const key = `${fx.file}|${rule}|${selector}`;
      const label = labels.get(key);
      if (label) hit.add(key);
      const verdict = label ? label.verdict : 'unlabelled';
      if (!perRule.has(rule))
        perRule.set(rule, {
          reported: 0,
          true: 0,
          false: 0,
          review: 0,
          unlabelled: 0,
          scanners: new Set(),
        });
      const row = perRule.get(rule);
      if (v.scannerId) row.scanners.add(v.scannerId);
      row.reported++;
      row[verdict]++;
      if (!label) unlabelled.push({ snapshot: fx.file, rule, selector });
    }
    perFile.push({ file: fx.file, findings: violations.length });
    console.log(`${fx.file.padEnd(30)} ${String(violations.length).padStart(4)} findings`);
  }

  server.close();

  const rows = [...perRule.entries()]
    .map(([rule, r]) => {
      const judged = r.true + r.false;
      return {
        rule,
        ...r,
        scanners: [...r.scanners].sort(),
        judged,
        precision: judged ? r.true / judged : null,
      };
    })
    .sort((a, b) => b.reported - a.reported || a.rule.localeCompare(b.rule));

  console.log(
    '\nrule id                                 reported  true false review unlab  precision'
  );
  for (const r of rows) {
    const p = r.precision === null ? '    -' : r.precision.toFixed(2).padStart(5);
    console.log(
      `${r.rule.padEnd(38)} ${String(r.reported).padStart(8)} ${String(r.true).padStart(5)} ${String(r.false).padStart(5)} ${String(r.review).padStart(6)} ${String(r.unlabelled).padStart(5)} ${p}`
    );
  }

  // A labelled finding nobody reports any more: a false one gone is the point
  // of the exercise, a true one gone is a regression.
  const scanned = new Set(fixtures.map((f) => f.file));
  const missingTrue = labelFile.labels.filter(
    (l) =>
      l.verdict === 'true' &&
      scanned.has(l.snapshot) &&
      !hit.has(`${l.snapshot}|${l.rule}|${l.selector}`)
  );

  const failures = [];
  for (const r of rows) {
    if (r.judged >= MIN_LABELLED && r.precision < 1) {
      failures.push(
        `${r.rule} (${r.scanners.join(', ') || 'unknown scanner'}): precision ${r.precision.toFixed(2)} ` +
          `(${r.false} of ${r.judged} judged findings are false)`
      );
    }
  }

  if (unlabelled.length) {
    console.log(`\n${unlabelled.length} finding(s) carry no label. Judge them and add them to`);
    console.log(path.relative(process.cwd(), LABELS_PATH) + ':');
    const shown = unlabelled.slice(0, 40);
    for (const u of shown) console.log(`  ${u.snapshot} | ${u.rule} | ${u.selector}`);
    if (unlabelled.length > shown.length)
      console.log(`  ... and ${unlabelled.length - shown.length} more`);
  }

  if (missingTrue.length) {
    console.log(`\n${missingTrue.length} finding(s) labelled true are no longer reported:`);
    for (const l of missingTrue.slice(0, 40))
      console.log(`  ${l.snapshot} | ${l.rule} | ${l.selector}`);
    if (missingTrue.length > 40) console.log(`  ... and ${missingTrue.length - 40} more`);
  }

  const evidence = {
    recordedAt: new Date().toISOString(),
    profile: PROFILE,
    labelsRecordedAt: labelFile.recordedAt,
    snapshots: perFile,
    rules: rows.map((r) => ({
      rule: r.rule,
      scanners: r.scanners,
      reported: r.reported,
      true: r.true,
      false: r.false,
      review: r.review,
      unlabelled: r.unlabelled,
      precision: r.precision,
    })),
    missingTrue: missingTrue.map((l) => ({
      snapshot: l.snapshot,
      rule: l.rule,
      selector: l.selector,
    })),
    failures,
    passed: failures.length === 0,
  };
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`\nEvidence: ${path.relative(process.cwd(), EVIDENCE_PATH)}`);
  if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(evidence, null, 2));

  if (failures.length) {
    console.log('\nFAIL');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('\nPASS: no rule with judged findings reports a false one.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
