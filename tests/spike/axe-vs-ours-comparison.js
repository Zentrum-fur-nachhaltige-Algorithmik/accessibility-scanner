/**
 * Head-to-head: axe-core vs. our PROFILES.fast scanners.
 *
 * Runs both engines on all test-sites/*.html + 1 experiment file.
 * Compares: violation counts, speed, detection rate, false-positive rate.
 *
 * Usage:  node tests/spike/axe-vs-ours-comparison.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { AxePuppeteer } = require('@axe-core/puppeteer');

const ScanPipeline = require('../../src/scan-pipeline');
const { registerAllScanners, getProfile } = require('../../src/scanner-registry');

// ── Fixture server ──────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(PROJECT_ROOT, urlPath);
    if (!filePath.startsWith(PROJECT_ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

// ── Discover test files ─────────────────────────────────────────────────

function discoverTestFiles() {
  const dir = path.join(PROJECT_ROOT, 'test-sites');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort()
    .map(f => ({ label: f.replace('.html', ''), path: `/test-sites/${f}` }));
  files.push({ label: 'experiment-form', path: '/experiments/haiku-a11y/generated/html-tailwind/form.html' });
  return files;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Fixture server on ${baseUrl}`);

  const allFiles = discoverTestFiles();

  // Sample: 10 good, 10 bad, 1 experiment for manageable runtime with our scanners
  const goodFiles = allFiles.filter(f => f.label.startsWith('good-'));
  const badFiles = allFiles.filter(f => f.label.startsWith('bad-'));
  const otherFiles = allFiles.filter(f => !f.label.startsWith('good-') && !f.label.startsWith('bad-'));

  // Pick evenly spaced samples
  const sampleN = (arr, n) => {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
  };
  const testFiles = [...sampleN(goodFiles, 10), ...sampleN(badFiles, 10), ...otherFiles];
  const total = testFiles.length;
  console.log(`Testing ${total} files (sampled from ${allFiles.length})\n`);

  // ── Phase 1: axe-core ─────────────────────────────────────────────────

  console.log('Phase 1: Running axe-core...');
  const axeStart = Date.now();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const axeResults = {};
  for (let i = 0; i < total; i++) {
    const file = testFiles[i];
    process.stdout.write(`\r  axe-core ${i + 1}/${total}: ${file.label.padEnd(50)}`);
    const page = await browser.newPage();
    const t0 = Date.now();
    try {
      await page.goto(`${baseUrl}${file.path}`, { waitUntil: 'networkidle0', timeout: 15000 });
      const result = await new AxePuppeteer(page).analyze();
      axeResults[file.label] = {
        violations: result.violations.length,
        nodes: result.violations.reduce((n, v) => n + v.nodes.length, 0),
        ruleIds: result.violations.map(v => v.id),
        impact: {},
        ms: Date.now() - t0,
      };
      for (const v of result.violations) {
        axeResults[file.label].impact[v.impact] = (axeResults[file.label].impact[v.impact] || 0) + 1;
      }
    } catch (err) {
      axeResults[file.label] = { error: err.message, ms: Date.now() - t0 };
    }
    await page.close();
  }
  await browser.close();
  const axeTotalMs = Date.now() - axeStart;
  console.log(`\r  axe-core done in ${(axeTotalMs / 1000).toFixed(1)}s                                          `);

  // ── Phase 2: our scanners (concurrent-only subset to avoid hangs) ─────

  // Exclusive scanners (keyboard, focus, responsive, hover-focus, input-modalities)
  // hang or take 30-60s per page. Use only the 18 concurrent scanners.
  const CONCURRENT_ONLY = [
    'color-contrast', 'use-of-color', 'images-of-text', 'advanced-contrast',
    'nontext-contrast', 'screen-reader', 'media-accessibility',
    'language-detection', 'predictable-navigation', 'error-handling',
    'html-validation', 'page-structure', 'label-in-name',
    'status-messages', 'advanced-aria', 'timing-controls',
    'orientation', 'input-purpose',
  ];

  console.log(`Phase 2: Running our ${CONCURRENT_ONLY.length} concurrent scanners...`);
  const oursStart = Date.now();

  const ourResults = {};
  for (let i = 0; i < total; i++) {
    const file = testFiles[i];
    process.stdout.write(`\r  ours ${i + 1}/${total}: ${file.label.padEnd(50)}`);
    const url = `${baseUrl}${file.path}`;
    const t0 = Date.now();
    // Fresh pipeline per file to avoid stale browser state
    const pipeline = new ScanPipeline();
    registerAllScanners(pipeline);
    try {
      const scanPromise = pipeline.scan(url, {
        scannerIds: CONCURRENT_ONLY,
        heuristicOnly: true,
        observationTime: 0,
        timeout: 30000,
      });
      // Hard timeout to prevent hangs
      const result = await Promise.race([
        scanPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT after 45s')), 45000)),
      ]);
      ourResults[file.label] = {
        violations: result.totalViolations,
        score: result.accessibilityScore,
        scannerResults: {},
        ms: Date.now() - t0,
      };
      if (result.scanners) {
        for (const [id, data] of Object.entries(result.scanners)) {
          ourResults[file.label].scannerResults[id] = {
            violations: data.violationCount || 0,
            passed: data.passed,
          };
        }
      }
    } catch (err) {
      ourResults[file.label] = { error: err.message, ms: Date.now() - t0 };
    }
    await pipeline.close();
  }
  const oursTotalMs = Date.now() - oursStart;
  console.log(`\r  ours done in ${(oursTotalMs / 1000).toFixed(1)}s                                              `);

  server.close();

  // ═══════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(110));
  console.log('COMPARISON: axe-core vs. our PROFILES.fast scanners');
  console.log('═'.repeat(110));

  // ── Speed comparison ──────────────────────────────────────────────────

  console.log('\n── SPEED ──');
  console.log(`  axe-core total : ${(axeTotalMs / 1000).toFixed(1)}s  (${(axeTotalMs / total).toFixed(0)}ms avg/file)`);
  console.log(`  ours total     : ${(oursTotalMs / 1000).toFixed(1)}s  (${(oursTotalMs / total).toFixed(0)}ms avg/file)`);
  console.log(`  ratio          : ours is ${(oursTotalMs / axeTotalMs).toFixed(1)}x ${oursTotalMs > axeTotalMs ? 'slower' : 'faster'} than axe-core`);

  // Per-file speed percentiles
  const axeSpeeds = Object.values(axeResults).filter(r => !r.error).map(r => r.ms).sort((a, b) => a - b);
  const oursSpeeds = Object.values(ourResults).filter(r => !r.error).map(r => r.ms).sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.floor(arr.length * p)] || 0;
  console.log(`\n  Per-file latency (ms):`)
  console.log(`                   p50      p90      p99      max`);
  console.log(`  axe-core    ${String(pct(axeSpeeds, 0.5)).padStart(8)} ${String(pct(axeSpeeds, 0.9)).padStart(8)} ${String(pct(axeSpeeds, 0.99)).padStart(8)} ${String(axeSpeeds[axeSpeeds.length - 1] || 0).padStart(8)}`);
  console.log(`  ours        ${String(pct(oursSpeeds, 0.5)).padStart(8)} ${String(pct(oursSpeeds, 0.9)).padStart(8)} ${String(pct(oursSpeeds, 0.99)).padStart(8)} ${String(oursSpeeds[oursSpeeds.length - 1] || 0).padStart(8)}`);

  // ── Violation comparison table ────────────────────────────────────────

  const hdr = `${'File'.padEnd(48)} ${'axe-V'.padStart(6)} ${'axe-N'.padStart(6)} ${'axe-ms'.padStart(7)} ${'our-V'.padStart(6)} ${'our-ms'.padStart(7)} ${'score'.padStart(6)}`;
  console.log(`\n── VIOLATIONS PER FILE ──`);
  console.log(`  ${hdr}`);
  console.log(`  ${'─'.repeat(hdr.length)}`);

  const groups = [
    { title: 'good-*', items: testFiles.filter(f => f.label.startsWith('good-')) },
    { title: 'bad-*', items: testFiles.filter(f => f.label.startsWith('bad-')) },
    { title: 'other', items: testFiles.filter(f => !f.label.startsWith('good-') && !f.label.startsWith('bad-')) },
  ];

  for (const group of groups) {
    if (group.items.length === 0) continue;
    console.log(`\n  ── ${group.title} ──`);
    for (const file of group.items) {
      const a = axeResults[file.label] || {};
      const o = ourResults[file.label] || {};
      if (a.error || o.error) {
        console.log(`  ${file.label.padEnd(48)} ${a.error ? 'ERR' : ''} / ${o.error ? 'ERR' : ''}`);
        continue;
      }
      const line = `${file.label.padEnd(48)} ${String(a.violations || 0).padStart(6)} ${String(a.nodes || 0).padStart(6)} ${String(a.ms || 0).padStart(7)} ${String(o.violations || 0).padStart(6)} ${String(o.ms || 0).padStart(7)} ${String(o.score != null ? o.score + '%' : 'N/A').padStart(6)}`;
      console.log(`  ${line}`);
    }
  }

  // ── Aggregate comparison ──────────────────────────────────────────────

  console.log(`\n── AGGREGATE ──`);

  for (const prefix of ['good-', 'bad-']) {
    const labels = testFiles.filter(f => f.label.startsWith(prefix)).map(f => f.label);
    const axeViolations = labels.map(l => axeResults[l]?.violations || 0);
    const oursViolations = labels.map(l => ourResults[l]?.violations || 0);
    const axeWithV = axeViolations.filter(v => v > 0).length;
    const oursWithV = oursViolations.filter(v => v > 0).length;
    const axeSum = axeViolations.reduce((a, b) => a + b, 0);
    const oursSum = oursViolations.reduce((a, b) => a + b, 0);
    const axeAvg = (axeSum / labels.length).toFixed(1);
    const oursAvg = (oursSum / labels.length).toFixed(1);

    console.log(`\n  ${prefix}* files (${labels.length} total):`);
    console.log(`                  axe-core          ours`);
    console.log(`    With violations: ${String(axeWithV).padStart(4)}           ${String(oursWithV).padStart(4)}`);
    console.log(`    Total violations: ${String(axeSum).padStart(4)}           ${String(oursSum).padStart(4)}`);
    console.log(`    Avg violations:  ${axeAvg.padStart(5)}          ${oursAvg.padStart(5)}`);

    if (prefix === 'good-') {
      console.log(`    → False positive indicator: axe ${axeWithV}/${labels.length} files, ours ${oursWithV}/${labels.length} files`);
    }
    if (prefix === 'bad-') {
      console.log(`    → Detection rate: axe ${axeWithV}/${labels.length} (${((axeWithV / labels.length) * 100).toFixed(1)}%), ours ${oursWithV}/${labels.length} (${((oursWithV / labels.length) * 100).toFixed(1)}%)`);

      // Which bad-* files did each engine miss?
      const axeMissed = labels.filter(l => (axeResults[l]?.violations || 0) === 0);
      const oursMissed = labels.filter(l => (ourResults[l]?.violations || 0) === 0);
      if (axeMissed.length > 0) {
        console.log(`    axe-core missed (0 violations):`);
        for (const l of axeMissed) console.log(`      - ${l}`);
      }
      if (oursMissed.length > 0) {
        console.log(`    ours missed (0 violations):`);
        for (const l of oursMissed) console.log(`      - ${l}`);
      }
    }
  }

  // Experiment file
  const expAxe = axeResults['experiment-form'] || {};
  const expOurs = ourResults['experiment-form'] || {};
  console.log(`\n  experiment-form:`);
  console.log(`    axe-core : ${expAxe.violations || 0} violations in ${expAxe.ms || '?'}ms`);
  console.log(`    ours     : ${expOurs.violations || 0} violations in ${expOurs.ms || '?'}ms (score: ${expOurs.score ?? 'N/A'}%)`);

  // ── Noise ratio ───────────────────────────────────────────────────────

  console.log(`\n── NOISE RATIO (violations on good-* files / violations on bad-* files) ──`);
  const goodLabels = testFiles.filter(f => f.label.startsWith('good-')).map(f => f.label);
  const badLabels = testFiles.filter(f => f.label.startsWith('bad-')).map(f => f.label);
  const axeGoodSum = goodLabels.map(l => axeResults[l]?.violations || 0).reduce((a, b) => a + b, 0);
  const axeBadSum = badLabels.map(l => axeResults[l]?.violations || 0).reduce((a, b) => a + b, 0);
  const oursGoodSum = goodLabels.map(l => ourResults[l]?.violations || 0).reduce((a, b) => a + b, 0);
  const oursBadSum = badLabels.map(l => ourResults[l]?.violations || 0).reduce((a, b) => a + b, 0);

  console.log(`  axe-core : ${axeGoodSum} good / ${axeBadSum} bad = ${(axeGoodSum / axeBadSum).toFixed(2)} noise ratio`);
  console.log(`  ours     : ${oursGoodSum} good / ${oursBadSum} bad = ${oursBadSum > 0 ? (oursGoodSum / oursBadSum).toFixed(2) : 'N/A'} noise ratio`);
  console.log(`  (lower is better — 0.0 = no FPs, 1.0 = equal noise on good and bad files)`);

  console.log('\n' + '═'.repeat(110));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
