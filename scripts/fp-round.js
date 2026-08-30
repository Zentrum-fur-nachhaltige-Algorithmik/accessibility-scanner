#!/usr/bin/env node

/**
 * fp-round.js: one round of widening the real-world corpus.
 *
 *   node scripts/fp-round.js scan <url | test-sites/realworld/x.html> --out findings.json
 *   node scripts/fp-round.js diff live.json snapshot.json
 *
 * `scan` runs the standard profile without the paid scanners against a live
 * URL or a snapshot (served from its directory) and writes every finding with
 * the (rule, selector) key the precision gate uses, so the labels written for
 * it match tests/data/realworld-labels.json. `diff` lists what only the live
 * page or only the snapshot reports: the live page has its scripts, the
 * snapshot is what the gate can replay.
 */

const fs = require('fs');
const path = require('path');

const { startServer, scanFile } = require('./harness/realworld');
const { getProfile } = require('../src/core/scanner-registry');

function ruleOf(v) {
  return v.ruleId || v.issue || v.type || v.criterion || 'unknown';
}

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

function normalise(v) {
  return {
    scanner: v.scannerId || v.scanner || null,
    rule: ruleOf(v),
    selector: selectorOf(v),
    criterion: v.criterion || v.wcag || null,
    severity: v.severity || v.impact || null,
    description: v.description || v.issue || v.message || null,
    html: v.html || (Array.isArray(v.nodes) && v.nodes[0] && v.nodes[0].html) || null,
    evidence: v.evidence || v.measured || v.details || null,
  };
}

async function scan(target, out) {
  delete process.env.OPENROUTER_API_KEY;
  const { scannerIds: profileIds } = getProfile('standard', { includeExperimental: true });
  const scannerIds = profileIds ? profileIds.filter((id) => !id.startsWith('llm-')) : profileIds;

  let url = target;
  let server = null;
  let snapshot = null;
  if (!/^https?:\/\//.test(target)) {
    const file = path.resolve(target);
    const started = await startServer(path.dirname(file));
    server = started.server;
    url = `http://localhost:${started.port}/${path.basename(file)}`;
    snapshot = path.basename(file);
  }
  const t0 = Date.now();
  try {
    const { result, timedOut, error } = await scanFile(url, scannerIds, {});
    if (timedOut || !result) throw new Error(error || 'scan failed');
    const violations = result.violations || [];
    const report = {
      target,
      snapshot,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      total: violations.length,
      bestPractices: (result.bestPractices || []).length,
      scanners: Object.fromEntries(
        Object.entries(result.scanners || {}).map(([id, s]) => [
          id,
          {
            status: s.status || (s.error ? 'error' : 'ok'),
            violations: (s.violations || []).length,
            ...(s.error ? { error: s.error } : {}),
          },
        ])
      ),
      findings: violations.map(normalise),
    };
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    const byRule = new Map();
    for (const f of report.findings) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1);
    console.log(
      `${target}: ${report.total} findings in ${Math.round(report.durationMs / 1000)}s -> ${out}`
    );
    for (const [rule, n] of Array.from(byRule).sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(4)}  ${rule}`);
    const broken = Object.entries(report.scanners).filter(([, s]) => s.status !== 'ok');
    if (broken.length)
      console.log(
        `  scanners not ok: ${broken.map(([id, s]) => `${id} (${s.status})`).join(', ')}`
      );
  } finally {
    if (server) server.close();
  }
}

function diff(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  const key = (f) => `${f.rule}|${f.selector}`;
  const inB = new Set(b.findings.map(key));
  const inA = new Set(a.findings.map(key));
  const onlyA = a.findings.filter((f) => !inB.has(key(f)));
  const onlyB = b.findings.filter((f) => !inA.has(key(f)));
  const summarise = (list) => {
    const m = new Map();
    for (const f of list) m.set(f.rule, (m.get(f.rule) || 0) + 1);
    return Array.from(m)
      .sort((x, y) => y[1] - x[1])
      .map(([r, n]) => `${n} ${r}`)
      .join(', ');
  };
  console.log(
    `${path.basename(aPath)}: ${a.total} findings, ${path.basename(bPath)}: ${b.total} findings`
  );
  console.log(`only in ${path.basename(aPath)} (${onlyA.length}): ${summarise(onlyA) || '-'}`);
  console.log(`only in ${path.basename(bPath)} (${onlyB.length}): ${summarise(onlyB) || '-'}`);
}

async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'scan') {
    const outIdx = argv.indexOf('--out');
    const out = outIdx !== -1 ? argv[outIdx + 1] : null;
    if (!argv[1] || !out) throw new Error('usage: scan <url|file> --out findings.json');
    await scan(argv[1], out);
  } else if (cmd === 'diff') {
    if (!argv[1] || !argv[2]) throw new Error('usage: diff a.json b.json');
    diff(argv[1], argv[2]);
  } else {
    console.log(
      'Usage: node scripts/fp-round.js scan <url|file> --out findings.json | diff a.json b.json'
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
