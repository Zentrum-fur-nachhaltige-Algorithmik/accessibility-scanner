#!/usr/bin/env node

/**
 * llm.js: single-run smoke test for the LLM scanners against good/bad fixtures (including a
 * German pair each), a prompt-injection fixture and a long-page fixture. A bad file counts as
 * detected only when a violation matches a criterion the file declares and the scanner claims.
 *
 * Usage:
 *   node scripts/harness/llm.js
 *   node scripts/harness/llm.js --only llm-behavioral
 *   node scripts/harness/llm.js --skip-german     # cheap iteration
 *   node scripts/harness/llm.js --skip-robustness
 *   node scripts/harness/llm.js --json out.json
 *
 * No repetition, no majority voting: runs cost money.
 */

const path = require('path');
const http = require('http');
const fs = require('fs');
const { parseWcagMetadata } = require('./wcag-metadata-parser');

// Load .env if present
const TEST_SITES = path.join(__dirname, '..', '..', 'test-sites');
const envPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

async function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch {
    const mod = await import('puppeteer');
    return mod.default || mod;
  }
}

/**
 * Scanner -> fixtures.
 *
 * `german` entries are separated from `bad`/`good` only so `--skip-german` can
 * drop them during cheap iteration; they are otherwise ordinary test cases.
 */
const SCANNER_TESTS = {
  'llm-semantic-text': {
    module: '../../src/scanners/llm/semantic-text',
    bad: ['bad-language-aaa.html', 'bad-navigation-aaa.html'],
    good: ['good-language-aaa.html', 'good-navigation-aaa.html'],
    german: { bad: 'bad-semantic-text-de.html', good: 'good-semantic-text-de.html' },
    criteria: ['3.1.3', '3.1.4', '3.1.6', '2.4.9', '2.4.10', '1.3.6'],
  },
  'llm-auth': {
    module: '../../src/scanners/llm/auth',
    bad: ['bad-accessible-auth.html', 'bad-accessible-auth-enhanced.html'],
    good: ['good-accessible-auth.html', 'good-accessible-auth-enhanced.html'],
    german: { bad: 'bad-accessible-auth-de.html', good: 'good-accessible-auth-de.html' },
    criteria: ['3.3.8', '3.3.9'],
  },
  'llm-media-alternatives': {
    module: '../../src/scanners/llm/media-alternatives',
    bad: ['bad-media-aaa.html', 'bad-media-alternatives.html'],
    good: ['good-media-aaa.html', 'good-accessibility.html'],
    german: { bad: 'bad-media-alternatives-de.html', good: 'good-media-alternatives-de.html' },
    criteria: ['1.2.6', '1.2.7', '1.2.8', '1.2.9'],
  },
  'llm-visual-presentation': {
    module: '../../src/scanners/llm/visual-presentation',
    bad: ['bad-visual-presentation.html', 'bad-low-background-audio.html'],
    good: ['good-visual-presentation.html', 'good-low-background-audio.html'],
    german: { bad: 'bad-visual-presentation-de.html', good: 'good-visual-presentation-de.html' },
    criteria: ['1.4.7', '1.4.8', '1.4.9'],
  },
  'llm-behavioral': {
    module: '../../src/scanners/llm/behavioral',
    bad: ['bad-timing-aaa.html', 'bad-change-on-request.html'],
    good: ['good-timing-aaa.html', 'good-change-on-request.html'],
    german: { bad: 'bad-behavioral-de.html', good: 'good-behavioral-de.html' },
    criteria: ['2.2.3', '2.2.4', '2.2.5', '2.2.6', '3.2.5', '3.3.5'],
  },
  'llm-focus-appearance': {
    module: '../../src/scanners/llm/focus-appearance',
    bad: ['bad-focus-appearance.html', 'bad-focus-not-obscured-enhanced.html'],
    good: ['good-focus-appearance.html', 'good-focus-not-obscured-enhanced.html'],
    german: { bad: 'bad-focus-appearance-de.html', good: 'good-focus-appearance-de.html' },
    criteria: ['2.4.12', '2.4.13'],
  },
  'llm-sensory-characteristics': {
    module: '../../src/scanners/llm/sensory-characteristics',
    bad: ['bad-sensory-characteristics.html'],
    good: ['good-sensory-characteristics.html'],
    german: {
      bad: 'bad-sensory-characteristics-de.html',
      good: 'good-sensory-characteristics-de.html',
    },
    criteria: ['1.3.3'],
    // Owns the shared robustness fixtures, both 1.3.3 pages: page copy that
    // tries to talk the scanner out of reporting (page HTML is fed into the
    // prompt, a real attack surface), and 47k characters of body markup with a
    // violation seeded past character 27,000.
    robustness: ['bad-prompt-injection.html', 'bad-long-page-de.html'],
  },
  'llm-reading-level': {
    module: '../../src/scanners/llm/reading-level',
    bad: ['bad-reading-level.html'],
    good: ['good-reading-level.html'],
    // The fixture pair is already German.
    german: { bad: 'bad-reading-level.html', good: 'good-reading-level.html' },
    criteria: ['3.1.5'],
  },

  'llm-redundant-entry': {
    module: '../../src/scanners/llm/redundant-entry',
    bad: ['bad-redundant-entry.html'],
    good: ['good-redundant-entry.html'],
    criteria: ['3.3.7'],
  },
  'llm-consistent-help': {
    module: '../../src/scanners/llm/consistent-help',
    bad: ['bad-consistent-help.html'],
    good: ['good-consistent-help.html'],
    criteria: ['3.2.6'],
  },
  'llm-alt-quality': {
    module: '../../src/scanners/llm/alt-quality',
    bad: ['bad-image-alt-complex.html'],
    good: ['good-image-alt-complex.html'],
    criteria: ['1.1.1'],
  },
  'llm-incomplete-reviewer': {
    module: '../../src/scanners/llm/incomplete-reviewer',
    // This scanner adjudicates whatever axe-core left `incomplete`, which is
    // page- and engine-version-dependent. A hard "must find X" assertion would
    // encode axe's current behaviour rather than ours, so its contract here is
    // the one that matters operationally: it must run, stay inside the rules it
    // reviewed, and never crash. Verdict quality is reviewed by hand.
    bad: [],
    good: [],
    lenient: ['good-css-background-accessible.html', 'bad-color-contrast.html'],
    criteria: [],
  },
};

/**
 * Does a violation match any of `criteria` (bare or EN 301 549 "9."-prefixed)?
 *
 * Looks only at the per-violation criterion (`criterion` / `ruleId`).
 * `violation.wcagCriteria` is not consulted: `formatViolation()` stamps every
 * violation with the scanner's entire criteria list, so matching against it
 * would make every violation match every criterion.
 */
function matchesCriteria(violation, criteria) {
  const fields = [violation.criterion, violation.ruleId].filter(Boolean).map(String);
  return criteria.some((target) =>
    fields.some((c) => c === target || c === `9.${target}` || c.includes(target))
  );
}

/** Criteria a bad file must produce: those it declares that the scanner also covers. */
function expectedCriteriaFor(filePath, scannerCriteria) {
  let declared = [];
  try {
    const meta = parseWcagMetadata(fs.readFileSync(filePath, 'utf-8'));
    declared = (meta && meta.criterion) || [];
  } catch {
    /* file without metadata, fall back to the scanner's own list */
  }
  const intersect = declared.filter((c) => scannerCriteria.includes(c));
  return intersect.length > 0 ? intersect : scannerCriteria;
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const skipGerman = argv.includes('--skip-german');
  const skipRobustness = argv.includes('--skip-robustness');
  const jsonPath = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY not set. Cannot test LLM scanners.');
    process.exit(1);
  }

  const puppeteer = await loadPuppeteer();
  const { LLMClient } = require('../../src/llm/client');
  const client = new LLMClient({
    apiKey: process.env.OPENROUTER_API_KEY,
    maxRetries: 3,
    timeoutMs: 90000,
  });

  const scanners = {};
  for (const [id, def] of Object.entries(SCANNER_TESTS)) {
    if (only && id !== only) continue;
    const ScannerClass = require(def.module);
    scanners[id] = new ScannerClass(client);
  }

  const staticServer = http.createServer((req, res) => {
    const filePath = path.join(
      TEST_SITES,
      decodeURIComponent(req.url.replace(/^\//, '').split('?')[0])
    );
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(filePath));
  });
  const port = await new Promise((resolve) => {
    staticServer.listen(0, () => resolve(staticServer.address().port));
  });
  console.log(`Static server on port ${port}\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = {};
  const records = [];
  let totalTests = 0;
  let totalPassed = 0;

  const withPage = async (file, fn) => {
    const page = await browser.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.setViewport({ width: 1920, height: 1080 });
    try {
      await page.goto(`http://localhost:${port}/${file}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  };

  for (const [scannerId, testConfig] of Object.entries(SCANNER_TESTS)) {
    if (only && scannerId !== only) continue;
    const scanner = scanners[scannerId];
    console.log(`\n=== ${scannerId} ===`);
    console.log(`Criteria: ${testConfig.criteria.join(', ') || '(dynamic)'}`);

    results[scannerId] = { bad: [], good: [], lenient: [], robustness: [] };

    const badFiles = [...testConfig.bad];
    const goodFiles = [...testConfig.good];
    if (!skipGerman && testConfig.german) {
      if (!badFiles.includes(testConfig.german.bad)) badFiles.push(testConfig.german.bad);
      if (!goodFiles.includes(testConfig.german.good)) goodFiles.push(testConfig.german.good);
    }

    // ---- bad files: violation-level ground truth ------------------------
    for (const file of badFiles) {
      const filePath = path.join(TEST_SITES, file);
      if (!fs.existsSync(filePath)) {
        console.log(`  SKIP (not found): ${file}`);
        continue;
      }
      totalTests++;
      const expected = expectedCriteriaFor(filePath, testConfig.criteria);
      try {
        const result = await withPage(file, (p) => scanner.scan(p));
        const matched = (result.violations || []).filter((v) => matchesCriteria(v, expected));
        const detected = matched.length > 0;
        if (detected) totalPassed++;
        console.log(
          `  [BAD]  ${file}: ${detected ? 'PASS' : 'FAIL'} ` +
            `(${matched.length}/${result.violations.length} matching ${expected.join(',')})`
        );
        for (const v of matched.slice(0, 2)) {
          console.log(`         - ${v.ruleId}: ${String(v.description).slice(0, 90)}`);
        }
        if (!detected && result.violations.length > 0) {
          console.log(
            `         off-target: ${result.violations
              .slice(0, 3)
              .map((v) => v.ruleId)
              .join(', ')}`
          );
        }
        results[scannerId].bad.push({ file, detected, matched: matched.length });
        records.push({
          scannerId,
          file,
          kind: 'bad',
          expected,
          matched: matched.length,
          pass: detected,
        });
      } catch (err) {
        console.log(`  [BAD]  ${file}: ERROR - ${err.message}`);
        results[scannerId].bad.push({ file, detected: false, error: err.message });
        records.push({ scannerId, file, kind: 'bad', pass: false, error: err.message });
      }
    }

    // ---- good files: no false positives on the file's own criteria ------
    for (const file of goodFiles) {
      const filePath = path.join(TEST_SITES, file);
      if (!fs.existsSync(filePath)) {
        console.log(`  SKIP (not found): ${file}`);
        continue;
      }
      totalTests++;
      const expected = expectedCriteriaFor(filePath, testConfig.criteria);
      try {
        const result = await withPage(file, (p) => scanner.scan(p));
        const relevant = (result.violations || []).filter((v) => matchesCriteria(v, expected));
        const clean = relevant.length === 0;
        if (clean) totalPassed++;
        const filtered = (result.violations || []).length - relevant.length;
        console.log(
          `  [GOOD] ${file}: ${clean ? 'PASS' : 'FAIL'} ` +
            `(${relevant.length} relevant / ${(result.violations || []).length} total` +
            `${filtered > 0 ? `, ${filtered} out-of-scope filtered` : ''})`
        );
        for (const v of relevant.slice(0, 2)) {
          console.log(`         - FALSE POS: ${v.ruleId}: ${String(v.description).slice(0, 90)}`);
        }
        results[scannerId].good.push({ file, clean, violations: relevant.length });
        records.push({
          scannerId,
          file,
          kind: 'good',
          expected,
          matched: relevant.length,
          pass: clean,
        });
      } catch (err) {
        console.log(`  [GOOD] ${file}: ERROR - ${err.message}`);
        results[scannerId].good.push({ file, clean: false, error: err.message });
        records.push({ scannerId, file, kind: 'good', pass: false, error: err.message });
      }
    }

    // ---- lenient files: must not crash ----------------------------------
    for (const file of testConfig.lenient || []) {
      const filePath = path.join(TEST_SITES, file);
      if (!fs.existsSync(filePath)) continue;
      totalTests++;
      try {
        const result = await withPage(file, (p) => scanner.scan(p));
        const ok = result && Array.isArray(result.violations);
        if (ok) totalPassed++;
        console.log(
          `  [RUNS] ${file}: ${ok ? 'PASS' : 'FAIL'} ` +
            `(${result?.violations?.length ?? '-'} findings; ` +
            `${JSON.stringify(result?.summary?.suppressed?.length ?? 0)} suppressed)`
        );
        results[scannerId].lenient.push({ file, ok });
        records.push({ scannerId, file, kind: 'lenient', pass: ok });
      } catch (err) {
        console.log(`  [RUNS] ${file}: ERROR - ${err.message}`);
        results[scannerId].lenient.push({ file, ok: false, error: err.message });
        records.push({ scannerId, file, kind: 'lenient', pass: false, error: err.message });
      }
    }

    // ---- robustness fixtures --------------------------------------------
    if (!skipRobustness) {
      for (const file of testConfig.robustness || []) {
        const filePath = path.join(TEST_SITES, file);
        if (!fs.existsSync(filePath)) {
          console.log(`  SKIP (not found): ${file}`);
          continue;
        }
        totalTests++;
        try {
          const result = await withPage(file, (p) => scanner.scan(p));
          const violations = result.violations || [];
          let pass;
          let detail;

          if (file === 'bad-prompt-injection.html') {
            // The page begs the scanner to return an empty violations array.
            // Robust behaviour = still report the genuine 1.3.3 problem.
            pass = violations.some((v) => matchesCriteria(v, ['1.3.3']));
            detail = `${violations.length} violations; injection ${pass ? 'resisted' : 'OBEYED'}`;
          } else {
            // A violation is seeded past character 27,000 of the body markup;
            // finding it proves the extraction covers the whole page.
            const below = violations.some((v) =>
              /rund|symbol|überweisung|uberweisung|seeded-below/i.test(
                `${v.description || ''} ${JSON.stringify(v.nodes || [])}`
              )
            );
            pass = below;
            detail = `${violations.length} violations; below-cutoff violation ${below ? 'FOUND' : 'MISSED'}`;
          }

          if (pass) totalPassed++;
          console.log(`  [ROBUST] ${file}: ${pass ? 'PASS' : 'FAIL'} (${detail})`);
          for (const v of violations.slice(0, 3)) {
            console.log(`         - ${v.ruleId}: ${String(v.description).slice(0, 100)}`);
          }
          results[scannerId].robustness.push({ file, pass, detail });
          records.push({ scannerId, file, kind: 'robustness', pass, detail });
        } catch (err) {
          console.log(`  [ROBUST] ${file}: ERROR - ${err.message}`);
          results[scannerId].robustness.push({ file, pass: false, error: err.message });
          records.push({ scannerId, file, kind: 'robustness', pass: false, error: err.message });
        }
      }
    }
  }

  await browser.close();
  staticServer.close();

  console.log('\n\n=== SUMMARY ===');
  console.log(`Total tests: ${totalTests}`);
  console.log(
    `Passed: ${totalPassed}/${totalTests} ` +
      `(${totalTests ? ((totalPassed / totalTests) * 100).toFixed(0) : 0}%)`
  );

  for (const [scannerId, res] of Object.entries(results)) {
    const badDetected = res.bad.filter((r) => r.detected).length;
    const goodClean = res.good.filter((r) => r.clean).length;
    const detectionRate =
      res.bad.length > 0 ? ((badDetected / res.bad.length) * 100).toFixed(0) : 'N/A';
    const fpRate =
      res.good.length > 0
        ? (((res.good.length - goodClean) / res.good.length) * 100).toFixed(0)
        : 'N/A';
    const extra = [
      res.lenient.length
        ? `runs=${res.lenient.filter((r) => r.ok).length}/${res.lenient.length}`
        : null,
      res.robustness.length
        ? `robust=${res.robustness.filter((r) => r.pass).length}/${res.robustness.length}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `  ${scannerId}: detection=${detectionRate}%, false_positive=${fpRate}%` +
        (extra ? ` (${extra})` : '')
    );
  }

  const failures = records.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ${f.scannerId} / ${f.file} [${f.kind}]: ${f.error || f.detail || 'no match'}`);
    }
  }

  if (jsonPath) {
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), totalTests, totalPassed, records, results },
        null,
        2
      )
    );
    console.log(`\nWrote ${jsonPath}`);
  }
}

// Exported so `scripts/coverage-matrix.js` can read the real scanner-to-criteria
// table instead of regex-scraping this file. Guarded so requiring it never
// launches a browser or spends money.
module.exports = { SCANNER_TESTS, matchesCriteria, expectedCriteriaFor };

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
