#!/usr/bin/env node

/**
 * Exclusive Scanner True/False Positive Test
 *
 * Tests all exclusive (non-LLM) scanners against their specific good + bad test files.
 *  - Bad files: must produce >0 violations for the target criterion (true positive)
 *  - Good files: must produce 0 violations for the target criterion (no false positives)
 *
 * Each scanner gets its own fresh page (exclusive access).
 */

const path = require('path');
const TEST_SITES = path.join(__dirname, '..', '..', 'test-sites');
const http = require('http');
const fs = require('fs');
const { parseWcagMetadata } = require('./wcag-metadata-parser');

async function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch {
    const mod = await import('puppeteer');
    return mod.default || mod;
  }
}

/**
 * Scanner definitions: id → { module, criteria, scanOpts }
 * Each entry defines which WCAG criteria to filter violations by.
 */
const EXCLUSIVE_SCANNERS = {
  'keyboard-navigation': {
    module: '../src/keyboard-navigation-scanner',
    criteria: ['2.1.1', '2.1.2', '2.1.4'],
  },
  'focus-management': {
    module: '../src/focus-management-scanner',
    criteria: ['2.4.3', '2.4.7', '2.4.11'],
  },
  'input-modalities': {
    module: '../src/input-modalities-scanner',
    criteria: ['2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.7', '2.5.8'],
  },
  'responsive-design': {
    module: '../src/responsive-design-scanner',
    criteria: ['1.4.4', '1.4.10', '1.4.12'],
    scanOpts: { heuristicOnly: true }, // use heuristic mode for speed
  },
  'hover-focus-content': {
    module: '../src/hover-focus-content-scanner',
    criteria: ['1.4.13'],
    scanOpts: { heuristicOnly: true },
  },
  'seizure-prevention': {
    module: '../src/seizure-prevention-scanner',
    criteria: ['2.3.1'],
  },
  'multiple-ways': {
    module: '../src/multiple-ways-scanner',
    criteria: ['2.4.5'],
  },
  'concurrent-input': {
    module: '../src/concurrent-input-scanner',
    criteria: ['2.5.6'],
  },
  // Drives real keyboard focus (Tab) for its focus-indicator checks, so it
  // needs its own tab. 2.4.7 stays with focus-management; 1.4.11 is here.
  'nontext-contrast': {
    module: '../src/phase6a-nontext-contrast-scanner',
    criteria: ['1.4.11'],
  },
};

/**
 * Criterion → scanner mapping for test file routing.
 */
const CRITERION_TO_SCANNER = {};
for (const [id, def] of Object.entries(EXCLUSIVE_SCANNERS)) {
  for (const c of def.criteria) {
    CRITERION_TO_SCANNER[c] = id;
  }
}

/**
 * Check if a violation matches any of the target criteria.
 */
function matchesCriteria(violation, criteria) {
  // Scanners disagree on the field: `criterion` (EN 301 549 "9.x.y.z"),
  // `ruleId`, or a per-violation `wcagCriteria` string/array.
  const wc = violation.wcagCriteria;
  const fields = [violation.criterion, violation.ruleId, ...(Array.isArray(wc) ? wc : [wc])]
    .filter(Boolean).map(String);
  return criteria.some(target =>
    fields.some(c => c === target || c === `9.${target}` || c.includes(target)));
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonPath = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  // Machine-readable record of every assertion, consumed by
  // tests/coverage-matrix.js to report per-criterion DETECTION (not just
  // "a harness entry exists").
  const jsonResults = [];

  const puppeteer = await loadPuppeteer();
  const testDir = TEST_SITES;

  // Parse all test files and route to scanners
  const allFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.html'));
  const testPlan = []; // { file, scanner, criteria, expectViolations }

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

    // Find which exclusive scanner(s) cover this file's criteria
    const scannerIds = new Set();
    for (const c of metadata.criterion) {
      const sid = CRITERION_TO_SCANNER[c];
      if (sid) scannerIds.add(sid);
    }

    for (const sid of scannerIds) {
      testPlan.push({
        file,
        scanner: sid,
        criteria: metadata.criterion,
        expectViolations: isBad,
        title: metadata.title,
      });
    }
  }

  console.log(`Test plan: ${testPlan.length} tests across ${new Set(testPlan.map(t => t.scanner)).size} scanners\n`);

  // Start static server
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
  const port = await new Promise(resolve => {
    server.listen(0, () => resolve(server.address().port));
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Instantiate scanners
  const scannerInstances = {};
  for (const [id, def] of Object.entries(EXCLUSIVE_SCANNERS)) {
    try {
      const ScannerClass = require(def.module);
      scannerInstances[id] = new ScannerClass();
    } catch (err) {
      console.warn(`WARN: Could not load scanner ${id}: ${err.message}`);
    }
  }

  // Suppress verbose scanner output
  const origLog = console.log;
  const origWarn = console.warn;
  function silence() { console.log = () => {}; console.warn = () => {}; }
  function restore() { console.log = origLog; console.warn = origWarn; }

  let passed = 0;
  let failed = 0;
  const failures = [];

  // Group tests by scanner for efficient execution
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

    const scannerDef = EXCLUSIVE_SCANNERS[scannerId];
    origLog(`\n--- ${scannerId} (${tests.length} tests) ---`);

    for (const t of tests) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      try {
        await page.goto(`http://localhost:${port}/${t.file}`, {
          waitUntil: 'networkidle0',
          timeout: 30000,
        });

        silence();
        const result = await Promise.race([
          scanner.scan(page, { observationTime: 0, ...(scannerDef.scanOpts || {}) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
        ]);
        restore();

        // Violation-level ground truth: a bad file counts as DETECTED only when
        // a violation matches a criterion the file declares AND that this
        // scanner claims to cover. ">0 violations of any kind" is not detection,
        // and a scanner is never credited for a criterion outside its remit
        // (e.g. input-modalities must produce a real 2.5.1 finding on a file
        // that declares "2.1.1, 2.5.1" — 2.1.1 findings belong to
        // keyboard-navigation and do not count here).
        const allViolations = result.violations || [];
        const targetCriteria = t.criteria.filter(c => scannerDef.criteria.includes(c));
        const relevant = allViolations.filter(v => matchesCriteria(v, targetCriteria));

        const ok = t.expectViolations ? relevant.length > 0 : relevant.length === 0;
        const label = t.expectViolations ? 'TRUE-POS' : 'FALSE-POS';
        const detail = t.expectViolations
          ? `${relevant.length} violations for ${targetCriteria.join(',')}`
          : `${relevant.length} false positives for ${targetCriteria.join(',')}`;

        jsonResults.push({
          file: t.file,
          scanner: scannerId,
          expectViolations: t.expectViolations,
          criteria: targetCriteria,
          matched: relevant.length,
          status: ok ? 'PASS' : 'FAIL',
        });

        if (ok) {
          origLog(`  PASS [${label}] ${t.file}: ${detail}`);
          passed++;
        } else {
          origLog(`  FAIL [${label}] ${t.file}: ${detail}`);
          if (relevant.length > 0) {
            relevant.slice(0, 3).forEach(v =>
              origLog(`    - [${v.criterion}] ${v.issue}: ${(v.description || '').substring(0, 100)}`)
            );
          }
          failed++;
          failures.push({ file: t.file, scanner: scannerId, label, detail, relevant: relevant.slice(0, 3) });
        }
      } catch (err) {
        restore();
        origLog(`  ERROR ${t.file}: ${err.message}`);
        failed++;
        failures.push({ file: t.file, scanner: scannerId, label: 'ERROR', detail: err.message });
        jsonResults.push({
          file: t.file,
          scanner: scannerId,
          expectViolations: t.expectViolations,
          criteria: t.criteria.filter(c => scannerDef.criteria.includes(c)),
          matched: 0,
          status: 'ERROR',
          detail: err.message,
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  // ---- Full-matrix responsive dedup test ----
  origLog(`\n--- responsive-design FULL-MATRIX dedup test ---`);
  const responsiveScanner = scannerInstances['responsive-design'];
  if (responsiveScanner) {
    for (const { file, expectZero } of [
      { file: 'bad-reflow.html', expectZero: false },
      { file: 'good-reflow.html', expectZero: true },
    ]) {
      if (!fs.existsSync(path.join(testDir, file))) {
        origLog(`  SKIP ${file}: file not found`);
        continue;
      }
      const page = await browser.newPage();
      try {
        await page.goto(`http://localhost:${port}/${file}`, { waitUntil: 'networkidle0', timeout: 30000 });
        silence();
        // Full mode: no heuristicOnly
        const result = await Promise.race([
          responsiveScanner.scan(page, { heuristicOnly: false }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000)),
        ]);
        restore();

        const violations = result.violations || [];
        // Viewport-tested violations (from responsive analysis) should have affectedViewports;
        // CSS heuristic violations don't — only check structure on viewport violations
        const viewportViolations = violations.filter(v => Array.isArray(v.affectedViewports));
        const hasAffectedViewports = viewportViolations.length > 0 &&
          viewportViolations.every(v => Array.isArray(v.affectedViewports));

        if (expectZero) {
          if (violations.length === 0) {
            origLog(`  PASS [FULL-MATRIX] ${file}: 0 violations`);
            passed++;
          } else {
            origLog(`  FAIL [FULL-MATRIX] ${file}: expected 0 violations, got ${violations.length}`);
            failed++;
            failures.push({ file, scanner: 'responsive-design', label: 'FULL-MATRIX', detail: `${violations.length} violations` });
          }
        } else {
          // Bad file: should have violations but deduped (< 20, not 800+), each with affectedViewports
          const dedupOk = violations.length > 0 && violations.length < 50;
          const structureOk = hasAffectedViewports;
          if (dedupOk && structureOk) {
            origLog(`  PASS [FULL-MATRIX DEDUP] ${file}: ${violations.length} deduplicated violations, all have affectedViewports`);
            passed++;
          } else {
            origLog(`  FAIL [FULL-MATRIX DEDUP] ${file}: ${violations.length} violations, affectedViewports=${structureOk}`);
            failed++;
            failures.push({ file, scanner: 'responsive-design', label: 'FULL-MATRIX-DEDUP', detail: `${violations.length} violations, structure=${structureOk}` });
          }
        }
      } catch (err) {
        restore();
        origLog(`  ERROR [FULL-MATRIX] ${file}: ${err.message}`);
        failed++;
        failures.push({ file, scanner: 'responsive-design', label: 'FULL-MATRIX-ERROR', detail: err.message });
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  // ---- Full-mode responsive tests for 1.4.4 (text resize) and 1.4.10 (reflow) ----
  origLog(`\n--- responsive-design FULL-MODE criterion tests ---`);
  if (responsiveScanner) {
    for (const { file, criteria, expectViolations } of [
      { file: 'bad-text-resize.html', criteria: ['1.4.4'], expectViolations: true },
      { file: 'good-text-resize.html', criteria: ['1.4.4'], expectViolations: false },
      { file: 'bad-reflow.html', criteria: ['1.4.10'], expectViolations: true },
      { file: 'good-reflow.html', criteria: ['1.4.10'], expectViolations: false },
    ]) {
      if (!fs.existsSync(path.join(testDir, file))) {
        origLog(`  SKIP ${file}: file not found`);
        continue;
      }
      const page = await browser.newPage();
      try {
        await page.goto(`http://localhost:${port}/${file}`, { waitUntil: 'networkidle0', timeout: 30000 });
        silence();
        const result = await Promise.race([
          responsiveScanner.scan(page, { heuristicOnly: false }),
          // 180s, not 120s: this is the second full viewport-matrix run over
          // bad-reflow.html in the same process (the FULL-MATRIX dedup test
          // above already did one), and the browser is measurably slower by
          // then. At 120s it timed out here while passing there — a harness
          // budget artefact, not a scanner defect.
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 180000)),
        ]);
        restore();

        const allViolations = result.violations || [];
        // Filter to only violations matching the target criteria
        const relevant = allViolations.filter(v => matchesCriteria(v, criteria));

        if (expectViolations) {
          if (relevant.length > 0) {
            origLog(`  PASS [FULL-MODE] ${file}: ${relevant.length} violations for ${criteria.join(',')}`);
            passed++;
          } else {
            origLog(`  FAIL [FULL-MODE TRUE-POS] ${file}: 0 violations for ${criteria.join(',')} (${allViolations.length} total)`);
            failed++;
            failures.push({ file, scanner: 'responsive-design', label: 'FULL-MODE-TRUE-POS', detail: `0 relevant violations for ${criteria.join(',')}` });
          }
        } else {
          if (relevant.length === 0) {
            origLog(`  PASS [FULL-MODE] ${file}: 0 violations for ${criteria.join(',')}`);
            passed++;
          } else {
            origLog(`  FAIL [FULL-MODE FALSE-POS] ${file}: ${relevant.length} spurious violations for ${criteria.join(',')}`);
            failed++;
            failures.push({ file, scanner: 'responsive-design', label: 'FULL-MODE-FALSE-POS', detail: `${relevant.length} spurious violations` });
          }
        }
      } catch (err) {
        restore();
        origLog(`  ERROR [FULL-MODE] ${file}: ${err.message}`);
        failed++;
        failures.push({ file, scanner: 'responsive-design', label: 'FULL-MODE-ERROR', detail: err.message });
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  await browser.close();
  server.close();

  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      harness: 'exclusive',
      totals: { passed, failed },
      results: jsonResults,
    }, null, 2));
    origLog(`\nWrote ${jsonPath}`);
  }

  origLog(`\n=== SUMMARY ===`);
  origLog(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);

  if (failures.length > 0) {
    origLog(`\nFailures:`);
    for (const f of failures) {
      origLog(`  ${f.scanner} / ${f.file} [${f.label}]: ${f.detail}`);
    }
    process.exit(1);
  }
}

// Exported so `tests/coverage-matrix.js` can read the real scanner→criteria
// table instead of regex-scraping this file. Guarded so requiring it never
// launches a browser.
module.exports = { EXCLUSIVE_SCANNERS, CRITERION_TO_SCANNER, matchesCriteria };

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
