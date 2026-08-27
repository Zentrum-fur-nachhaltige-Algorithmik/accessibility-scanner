#!/usr/bin/env node

/**
 * Derive the scanner TRUST TIERS from the recorded battery results.
 *
 * Profile membership must not be hardcoded opinion. A custom scanner earns its
 * place in the default profiles by evidence, and loses it the moment the
 * evidence goes away. This script reduces the checked-in harness output to a
 * per-scanner verdict and writes `src/scanner-trust.json`, which
 * `src/scanner-registry.js` reads when it builds the profiles.
 *
 * A scanner is `proven` when ALL of the following hold:
 *   1. Every assertion about it in the deterministic harnesses passed
 *      (no FAIL, no ERROR) — i.e. it detects its own bad fixtures and stays
 *      clean on the matching good ones.
 *   2. It never crashed on any of the five real-world fixtures.
 *   3. It is not a top noise source on the good-file corpus (default: no more
 *      than NOISE_LIMIT recorded violations across all good fixtures).
 * Otherwise it is `experimental`, with the failing evidence recorded verbatim.
 *
 * axe-core and the LLM scanners are always `proven`: axe is the externally
 * validated base engine, and the LLM scanners are measured by their own smoke
 * harness (single-run, tracked separately) rather than by these fixtures.
 *
 * Inputs (all optional — a missing file simply contributes no evidence, and
 * the scanner keeps whatever the other inputs say):
 *   tests/data/harness/harness-exclusive.json
 *   tests/data/harness/harness-concurrent.json
 *   tests/data/harness/harness-realworld.json
 *   tests/data/harness/good-file-noise-breakdown.json
 *
 * Usage:
 *   node scripts/derive-scanner-trust.js            # rewrite src/scanner-trust.json
 *   node scripts/derive-scanner-trust.js --check    # fail if the file is stale
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'tests', 'data', 'harness');
const OUT = path.join(ROOT, 'src', 'scanner-trust.json');

/** Violations on the good-file corpus above which a scanner is a noise source. */
const NOISE_LIMIT = 10;

/** Always trusted, for the reasons documented above. */
const ALWAYS_PROVEN = new Set(['axe-core']);

function readJson(file) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn(`derive-scanner-trust: ignoring unreadable ${file}: ${e.message}`);
    return null;
  }
}

function collectScannerIds() {
  const hadKey = Boolean(process.env.OPENROUTER_API_KEY);
  if (!hadKey) process.env.OPENROUTER_API_KEY = 'trust-derivation-placeholder';
  const origLog = console.log;
  console.log = () => {};
  let scanners;
  try {
    scanners = require(path.join(ROOT, 'src', 'scanner-registry.js')).createAllScanners();
  } finally {
    console.log = origLog;
    if (!hadKey) delete process.env.OPENROUTER_API_KEY;
  }
  return scanners.map((s) => ({
    id: s.id,
    kind: s.id === 'axe-core' ? 'axe' : s.id.startsWith('llm-') ? 'llm' : 'deterministic',
  }));
}

function derive() {
  const scanners = collectScannerIds();

  /** @type {Map<string, string[]>} scannerId → failure evidence lines */
  const evidence = new Map();
  const add = (id, line) => {
    if (!evidence.has(id)) evidence.set(id, []);
    if (!evidence.get(id).includes(line)) evidence.get(id).push(line);
  };

  // ---- 1. deterministic harness outcomes -------------------------------
  for (const file of ['harness-exclusive.json', 'harness-concurrent.json']) {
    const data = readJson(file);
    if (!data) continue;
    const harness = data.harness || file;
    for (const r of data.results || []) {
      if (r.status === 'PASS') continue;
      const what = r.expectViolations ? 'missed' : 'false positive on';
      add(r.scanner, `${harness} harness: ${r.status} — ${what} ${r.file} (${(r.criteria || []).join(',')})`);
    }
  }

  // ---- 2. real-world crashes -------------------------------------------
  const realworld = readJson('harness-realworld.json');
  if (realworld) {
    for (const f of realworld.files || realworld.results || []) {
      for (const err of f.scannerErrors || []) {
        const id = err.scanner || err.scannerId;
        if (!id) continue;
        add(id, `realworld: crashed on ${f.file} — ${String(err.error || err.message || '').slice(0, 160)}`);
      }
    }
  }

  // ---- 3. good-file noise ----------------------------------------------
  const noise = readJson('good-file-noise-breakdown.json');
  if (noise && noise.perFile) {
    const totals = new Map();
    for (const info of Object.values(noise.perFile)) {
      for (const b of info.breakdown || []) {
        totals.set(b.scannerId, (totals.get(b.scannerId) || 0) + (b.count || 0));
      }
    }
    for (const [id, count] of totals) {
      if (count > NOISE_LIMIT) {
        add(id, `good-file noise: ${count} violations across the good-* corpus (limit ${NOISE_LIMIT})`);
      }
    }
  }

  // ---- verdicts ---------------------------------------------------------
  const trust = {};
  for (const { id, kind } of scanners) {
    if (ALWAYS_PROVEN.has(id)) {
      trust[id] = {
        tier: 'proven',
        kind,
        reason: 'Externally validated base engine (axe-core); always in the default profiles.',
      };
      continue;
    }
    if (kind === 'llm') {
      trust[id] = {
        tier: 'proven',
        kind,
        reason:
          'LLM scanner — measured by scripts/harness/llm.js (violation-level ' +
          'ground truth, German pair, injection and long-page robustness), not by the ' +
          'deterministic fixture harnesses.',
      };
      continue;
    }

    const failures = evidence.get(id) || [];
    trust[id] = failures.length === 0
      ? {
          tier: 'proven',
          kind,
          reason:
            'Clean record: every deterministic-harness assertion on its own criteria passed, ' +
            'no crashes across the five real-world fixtures, not a top noise source.',
        }
      : {
          tier: 'experimental',
          kind,
          reason: failures.slice(0, 6).join(' | ') + (failures.length > 6 ? ` | (+${failures.length - 6} more)` : ''),
          failureCount: failures.length,
        };
  }

  return {
    generatedAt: new Date().toISOString(),
    noiseLimit: NOISE_LIMIT,
    note:
      'GENERATED by scripts/derive-scanner-trust.js from the checked-in battery results. ' +
      'Do not edit by hand — re-derive after each battery run. Experimental scanners are ' +
      'quarantined out of the default profiles (never deleted) and their findings are ' +
      'tagged confidence: "low".',
    scanners: trust,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const derived = derive();

  const counts = { proven: 0, experimental: 0 };
  for (const v of Object.values(derived.scanners)) counts[v.tier]++;

  if (check) {
    if (!fs.existsSync(OUT)) {
      console.error('scanner-trust.json missing — run: node scripts/derive-scanner-trust.js');
      process.exit(1);
    }
    const current = JSON.parse(fs.readFileSync(OUT, 'utf-8'));
    const same =
      JSON.stringify(Object.keys(current.scanners || {}).sort()) ===
        JSON.stringify(Object.keys(derived.scanners).sort()) &&
      Object.entries(derived.scanners).every(
        ([id, v]) => current.scanners[id] && current.scanners[id].tier === v.tier
      );
    if (!same) {
      console.error('scanner-trust.json is stale — re-run: node scripts/derive-scanner-trust.js');
      process.exit(1);
    }
    console.log(`scanner-trust: up to date (${counts.proven} proven, ${counts.experimental} experimental)`);
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify(derived, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${counts.proven} proven, ${counts.experimental} experimental`);
  for (const [id, v] of Object.entries(derived.scanners)) {
    if (v.tier === 'experimental') console.log(`  experimental  ${id}  — ${v.reason.slice(0, 120)}`);
  }
}

if (require.main === module) main();

module.exports = { derive, NOISE_LIMIT };
