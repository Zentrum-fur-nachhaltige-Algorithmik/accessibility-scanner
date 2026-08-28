#!/usr/bin/env node

/**
 * concurrent.js: true/false-positive harness for the concurrent (non-exclusive) deterministic
 * scanners. A bad file passes only if a violation matches a criterion that both the file
 * declares and the scanner claims; a good file passes when no such violation is reported.
 *
 * Usage:
 *   node scripts/harness/concurrent.js
 *   node scripts/harness/concurrent.js --json /path/to/out.json
 *   node scripts/harness/concurrent.js --only color-contrast
 */

const path = require('path');
const TEST_SITES = path.join(__dirname, '..', '..', 'test-sites');
const http = require('http');
const fs = require('fs');
const { parseWcagMetadata } = require('./wcag-metadata-parser');
const { FILE_TO_SCANNERS } = require('./exclusive');

/** Fixtures an exclusive scanner claims by name; the concurrent plan skips them. */
const CLAIMED_FILES = new Set(Object.keys(FILE_TO_SCANNERS));

async function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch {
    const mod = await import('puppeteer');
    return mod.default || mod;
  }
}

/**
 * Concurrent (non-exclusive) deterministic scanner definitions: id -> { module, scanOpts }.
 * Criteria are not hardcoded here; they are read from each scanner's own
 * `wcagCriteria` constructor metadata at instantiation time. Routing is
 * many-to-many: a test file runs against every scanner whose criteria
 * intersect the file's declared criteria. Each test gets a fresh page so one
 * fixture's DOM mutations cannot leak into the next.
 *
 * Excludes axe-core (covered by tests/e2e/axe-core.test.js) and every scanner
 * covered by scripts/harness/exclusive.js.
 */
const CONCURRENT_SCANNERS = {
  // SC 1.4.6 is only measured for a scan that asks for AAA; SC 1.4.3 is
  // axe-core's, see src/scanners/color-contrast.js.
  'color-contrast': {
    module: '../../src/scanners/color-contrast',
    scanOpts: { wcagLevel: 'AAA' },
  },
  'use-of-color': { module: '../../src/scanners/use-of-color' },
  'images-of-text': { module: '../../src/scanners/images-of-text' },
  'screen-reader': { module: '../../src/scanners/screen-reader' },
  'media-accessibility': { module: '../../src/scanners/media-accessibility' },
  orientation: { module: '../../src/scanners/orientation' },
  'input-purpose': { module: '../../src/scanners/input-purpose' },
  'language-detection': { module: '../../src/scanners/language-detection' },
  'error-handling': { module: '../../src/scanners/error-handling' },
  'page-structure': { module: '../../src/scanners/page-structure' },
  'label-in-name': { module: '../../src/scanners/label-in-name' },
  'advanced-aria': { module: '../../src/scanners/advanced-aria' },
  'timing-controls': { module: '../../src/scanners/timing-controls' },
};

/**
 * Does a violation belong to any of `criteria`?
 *
 * The deterministic scanners emit three different violation shapes, and the
 * matcher has to read all of them or it silently scores real detections as
 * misses:
 *
 *   1. `criterion` / `ruleId`: a per-violation criterion (most scanners,
 *      EN 301 549 "9.x.y.z" or bare "x.y.z"). Most precise; preferred.
 *   2. `wcagCriteria`: a per-violation array (nontext-contrast, label-in-name).
 *   3. neither: the violation carries only element/measurement fields
 *      (color-contrast). The only sound attribution left is the scanner's own
 *      declared criteria, which the caller passes as `scannerCriteria`. This is
 *      safe because the caller has already intersected the file's declared
 *      criteria with the scanner's, so a scanner is never credited for a
 *      criterion it does not claim.
 */
function matchesCriteria(violation, criteria, scannerCriteria = null) {
  const hit = (value) => {
    const c = String(value || '');
    return c && criteria.some((target) => c.includes(target) || c === `9.${target}`);
  };

  if (violation.criterion || violation.ruleId) {
    return hit(violation.criterion) || hit(violation.ruleId);
  }
  if (Array.isArray(violation.wcagCriteria) && violation.wcagCriteria.length) {
    return violation.wcagCriteria.some(hit);
  }
  if (Array.isArray(scannerCriteria) && scannerCriteria.length) {
    return scannerCriteria.some(hit);
  }
  return false;
}

/**
 * Intersect a test file's declared WCAG criteria with a scanner's own
 * claimed wcagCriteria. Both are plain "x.y.z" strings from consistent
 * sources (WCAG-TEST comment blocks / BaseScanner constructor metadata),
 * so exact-string membership is the right check; it stops a scanner being
 * credited for a criterion it does not claim to cover.
 */
function intersectCriteria(fileCriteria, scannerCriteria) {
  return fileCriteria.filter((c) => scannerCriteria.includes(c));
}

function parseArgs(argv) {
  const opts = { json: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') {
      opts.json = argv[++i];
    } else if (argv[i] === '--only') {
      opts.only = argv[++i];
    }
  }
  return opts;
}

async function main() {
  const { json: jsonPath, only: onlyScanner } = parseArgs(process.argv.slice(2));

  const puppeteer = await loadPuppeteer();
  const testDir = TEST_SITES;

  // ---- Instantiate scanners first to read each one's real wcagCriteria ----
  const scannerInstances = {};
  const scannerCriteria = {}; // id -> string[] (from instance.wcagCriteria)

  for (const [id, def] of Object.entries(CONCURRENT_SCANNERS)) {
    if (onlyScanner && id !== onlyScanner) continue;
    try {
      const ScannerClass = require(def.module);
      const instance = new ScannerClass();
      scannerInstances[id] = instance;
      scannerCriteria[id] = Array.isArray(instance.wcagCriteria) ? instance.wcagCriteria : [];
    } catch (err) {
      console.warn(`WARN: Could not load scanner ${id}: ${err.message}`);
    }
  }

  // ---- Build criterion -> scanners map (many-to-many) from real metadata ----
  const CRITERION_TO_SCANNERS = {};
  for (const [id, criteria] of Object.entries(scannerCriteria)) {
    for (const c of criteria) {
      if (!CRITERION_TO_SCANNERS[c]) CRITERION_TO_SCANNERS[c] = [];
      CRITERION_TO_SCANNERS[c].push(id);
    }
  }
  const ALL_CRITERIA = Object.keys(CRITERION_TO_SCANNERS).sort();

  // ---- Parse all test files and route to scanners ----
  const allFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.html'));
  const parsedFiles = []; // { file, metadata, isGood, isBad }
  const testPlan = []; // { file, scanner, criteria (intersected), expectViolations, title }

  for (const file of allFiles) {
    const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
    let metadata;
    try {
      metadata = parseWcagMetadata(content);
    } catch (e) {
      continue;
    }
    if (!metadata) continue;

    const isGood = metadata.testType === 'good';
    const isBad = metadata.testType === 'bad';
    if (!isGood && !isBad) continue;

    parsedFiles.push({ file, metadata, isGood, isBad });

    // A fixture an exclusive scanner claims by name belongs to that scanner
    // alone (see FILE_TO_SCANNERS in exclusive.js).
    if (CLAIMED_FILES.has(file)) continue;

    for (const [sid, criteria] of Object.entries(scannerCriteria)) {
      const intersection = intersectCriteria(metadata.criterion, criteria);
      if (intersection.length === 0) continue;

      testPlan.push({
        file,
        scanner: sid,
        criteria: intersection,
        expectViolations: isBad,
        title: metadata.title,
      });
    }
  }

  console.log(
    `Test plan: ${testPlan.length} tests across ${new Set(testPlan.map((t) => t.scanner)).size} scanners\n`
  );

  // ---- Group files by criterion for byCriterion.files (independent of routing) ----
  const filesByCriterion = {};
  for (const c of ALL_CRITERIA) filesByCriterion[c] = { bad: [], good: [] };
  for (const { file, metadata, isGood, isBad } of parsedFiles) {
    for (const c of metadata.criterion) {
      if (!filesByCriterion[c]) continue; // criterion not covered by any concurrent scanner
      if (isBad) filesByCriterion[c].bad.push(file);
      if (isGood) filesByCriterion[c].good.push(file);
    }
  }

  // ---- Start static server ----
  const server = http.createServer((req, res) => {
    const filePath = path.join(testDir, req.url.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(filePath));
  });
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port));
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Suppress verbose scanner output
  const origLog = console.log;
  const origWarn = console.warn;
  function silence() {
    console.log = () => {};
    console.warn = () => {};
  }
  function restore() {
    console.log = origLog;
    console.warn = origWarn;
  }

  let passed = 0;
  let failed = 0;
  let errored = 0;
  const failures = [];
  const results = [];

  // Per-criterion detection bookkeeping: c -> { truePositive: bool, falsePositiveHit: bool }
  const criterionStats = {};
  for (const c of ALL_CRITERIA)
    criterionStats[c] = { truePositive: false, falsePositiveHit: false };

  // Group tests by scanner for readable console output
  const byScanner = {};
  for (const t of testPlan) {
    if (!byScanner[t.scanner]) byScanner[t.scanner] = [];
    byScanner[t.scanner].push(t);
  }

  for (const [scannerId, tests] of Object.entries(byScanner)) {
    const scanner = scannerInstances[scannerId];
    if (!scanner) {
      origLog(`SKIP ${scannerId}: scanner not loaded`);
      continue;
    }

    origLog(`\n--- ${scannerId} (${tests.length} tests) ---`);

    for (const t of tests) {
      const page = await browser.newPage();
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
      await page.setViewport({ width: 1920, height: 1080 });

      let status;
      let detail;
      let matched = null;

      try {
        await page.goto(`http://localhost:${port}/${t.file}`, {
          waitUntil: 'networkidle0',
          timeout: 30000,
        });

        silence();
        const result = await Promise.race([
          scanner.scan(page, {
            observationTime: 0,
            heuristicOnly: true,
            ...(CONCURRENT_SCANNERS[scannerId].scanOpts || {}),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
        ]);
        restore();

        const allViolations = result.violations || [];
        const relevant = allViolations.filter((v) =>
          matchesCriteria(v, t.criteria, scannerCriteria[scannerId])
        );
        matched = relevant.length;

        const ok = t.expectViolations ? relevant.length > 0 : relevant.length === 0;
        const label = t.expectViolations ? 'TRUE-POS' : 'FALSE-POS';
        detail = t.expectViolations
          ? `${relevant.length} violations`
          : `${relevant.length} false positives`;
        status = ok ? 'PASS' : 'FAIL';

        if (ok) {
          origLog(`  PASS [${label}] ${t.file}: ${detail}`);
          passed++;
        } else {
          origLog(`  FAIL [${label}] ${t.file}: ${detail}`);
          if (relevant.length > 0) {
            relevant
              .slice(0, 3)
              .forEach((v) =>
                origLog(
                  `    - [${v.criterion}] ${v.issue}: ${(v.description || '').substring(0, 100)}`
                )
              );
          }
          failed++;
          failures.push({ file: t.file, scanner: scannerId, label, detail });
        }

        // Per-criterion detection bookkeeping (finer grain than the
        // aggregate `matched` count above: a single test can carry several
        // intersected criteria).
        for (const c of t.criteria) {
          const matchedForC = allViolations.some((v) =>
            matchesCriteria(v, [c], scannerCriteria[scannerId])
          );
          if (!criterionStats[c])
            criterionStats[c] = { truePositive: false, falsePositiveHit: false };
          if (t.expectViolations) {
            if (matchedForC) criterionStats[c].truePositive = true;
          } else {
            if (matchedForC) criterionStats[c].falsePositiveHit = true;
          }
        }
      } catch (err) {
        restore();
        status = 'ERROR';
        detail = err.message;
        origLog(`  ERROR ${t.file}: ${err.message}`);
        errored++;
        failures.push({ file: t.file, scanner: scannerId, label: 'ERROR', detail: err.message });
      } finally {
        await page.close().catch(() => {});
      }

      results.push({
        file: t.file,
        scanner: scannerId,
        expectViolations: t.expectViolations,
        criteria: t.criteria,
        matched,
        status,
        detail,
      });
    }
  }

  await browser.close();
  server.close();

  // ---- Build byCriterion summary ----
  const byCriterion = {};
  for (const c of ALL_CRITERIA) {
    const stats = criterionStats[c] || { truePositive: false, falsePositiveHit: false };
    const files = filesByCriterion[c] || { bad: [], good: [] };
    byCriterion[c] = {
      scanners: CRITERION_TO_SCANNERS[c] || [],
      truePositive: files.bad.length > 0 ? stats.truePositive : false,
      falsePositiveClean: files.good.length > 0 ? !stats.falsePositiveHit : false,
      files: { bad: files.bad, good: files.good },
    };
  }

  // ---- Per-scanner bad/good tallies ----
  const perScanner = {};
  for (const id of Object.keys(CONCURRENT_SCANNERS)) {
    if (onlyScanner && id !== onlyScanner) continue;
    perScanner[id] = { badTotal: 0, badDetected: 0, goodTotal: 0, goodClean: 0 };
  }
  for (const r of results) {
    const p = perScanner[r.scanner];
    if (!p) continue;
    if (r.expectViolations) {
      p.badTotal++;
      if (r.status === 'PASS') p.badDetected++;
    } else {
      p.goodTotal++;
      if (r.status === 'PASS') p.goodClean++;
    }
  }

  origLog(`\n=== SUMMARY ===`);
  origLog(
    `Total: ${passed + failed + errored} | Passed: ${passed} | Failed: ${failed} | Errored: ${errored}`
  );

  if (failures.length > 0) {
    origLog(`\nFailures:`);
    for (const f of failures) {
      origLog(`  ${f.scanner} / ${f.file} [${f.label}]: ${f.detail}`);
    }
  }

  origLog(`\nPer-scanner:`);
  for (const [id, p] of Object.entries(perScanner)) {
    origLog(
      `  ${id}: bad ${p.badDetected}/${p.badTotal} detected, good ${p.goodClean}/${p.goodTotal} clean`
    );
  }

  const noTruePositive = ALL_CRITERIA.filter(
    (c) => byCriterion[c].files.bad.length > 0 && !byCriterion[c].truePositive
  );
  if (noTruePositive.length > 0) {
    origLog(`\nCriteria with NO scanner detecting their bad file(s) (truePositive=false):`);
    for (const c of noTruePositive) {
      origLog(
        `  ${c} (scanners: ${byCriterion[c].scanners.join(', ') || 'none'}; bad files: ${byCriterion[c].files.bad.join(', ')})`
      );
    }
  }

  if (jsonPath) {
    const output = {
      generatedAt: new Date().toISOString(),
      harness: 'concurrent',
      totals: { passed, failed, errored },
      byCriterion,
      results,
    };
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
    origLog(`\nJSON summary written to ${jsonPath}`);
  }

  if (failed > 0 || errored > 0) {
    process.exit(1);
  }
}

// Exported so `scripts/coverage-matrix.js` can read the real scanner list instead
// of regex-scraping this file. Criteria are absent here (read from each
// scanner's own metadata at run time), so the matrix resolves them from the
// scanner registry by id. Guarded so requiring this module never launches a
// browser.
module.exports = { CONCURRENT_SCANNERS, matchesCriteria, intersectCriteria };

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
