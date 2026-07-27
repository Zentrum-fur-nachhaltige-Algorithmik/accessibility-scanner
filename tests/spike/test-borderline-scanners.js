/**
 * Borderline scanner comparison: use-of-color & media-accessibility vs axe-core.
 *
 * Runs both scanners on experiment-generated HTML files and compares
 * their findings against axe-core output. Decision: keep scanner if it
 * finds unique true positives that axe misses, delete if it only adds noise.
 *
 * Usage: node tests/spike/test-borderline-scanners.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const AxeCoreAdapter = require('../../src/axe-core-adapter');
const UseOfColorScanner = require('../../src/use-of-color-scanner');
const MediaAccessibilityScanner = require('../../src/media-accessibility-scanner');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// WCAG criteria that axe-core covers
const AXE_WCAG_CRITERIA = new Set([
  '1.1.1', '1.2.1', '1.2.2', '1.3.1', '1.3.4', '1.3.5',
  '1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.6',
  '2.1.1', '2.1.3', '2.2.1', '2.2.2', '2.2.4',
  '2.4.1', '2.4.2', '2.4.4', '2.4.9', '2.5.3', '2.5.8',
  '3.1.1', '3.1.2', '3.2.5', '3.3.2',
  '4.1.1', '4.1.2',
]);

function isAxeCovered(wcagCriteria) {
  if (!wcagCriteria) return false;
  const list = Array.isArray(wcagCriteria) ? wcagCriteria : [wcagCriteria];
  return list.every(c => AXE_WCAG_CRITERIA.has(c));
}

// Gather sample files: mix of haiku + multi-model experiment files
function gatherSampleFiles() {
  const files = [];
  const haikuDir = path.join(PROJECT_ROOT, 'experiments/haiku-a11y/generated');
  const multiDir = path.join(PROJECT_ROOT, 'experiments/multi-model/generated');

  // 5 haiku files
  const haikuCombos = ['html-tailwind', 'html-bootstrap', 'react-tailwind', 'vue-tailwind', 'svelte-vanilla'];
  for (const combo of haikuCombos) {
    const formPath = path.join(haikuDir, combo, 'form.html');
    if (fs.existsSync(formPath)) {
      files.push({ path: formPath, label: `haiku/${combo}/form.html` });
    }
  }

  // 3 multi-model files
  const models = ['gemini-3.1-flash-lite', 'gemma-4-31b-it', 'kimi-k2.5'];
  for (const model of models) {
    const modelDir = path.join(multiDir, model);
    if (!fs.existsSync(modelDir)) continue;
    const subDirs = fs.readdirSync(modelDir).filter(d =>
      fs.statSync(path.join(modelDir, d)).isDirectory()
    );
    if (subDirs.length > 0) {
      const formPath = path.join(modelDir, subDirs[0], 'form.html');
      if (fs.existsSync(formPath)) {
        files.push({ path: formPath, label: `multi-model/${model}/${subDirs[0]}/form.html` });
      }
    }
  }

  // 2 test-sites good/bad files for reference
  files.push(
    { path: path.join(PROJECT_ROOT, 'test-sites/good-accessibility.html'), label: 'test-sites/good-accessibility.html' },
    { path: path.join(PROJECT_ROOT, 'test-sites/bad-image-alt.html'), label: 'test-sites/bad-image-alt.html' },
  );

  return files;
}

async function main() {
  const files = gatherSampleFiles();
  console.log(`\nScanning ${files.length} files...\n`);

  // Create file server
  const server = http.createServer((req, res) => {
    const filePath = path.join(PROJECT_ROOT, decodeURIComponent(req.url));
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  const axeAdapter = new AxeCoreAdapter();
  const useOfColor = new UseOfColorScanner();
  const media = new MediaAccessibilityScanner();

  const results = [];

  for (const file of files) {
    const relPath = path.relative(PROJECT_ROOT, file.path);
    const url = `${baseUrl}/${relPath}`;

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

      // Run all three
      const [axeResult, uocResult, mediaResult] = await Promise.allSettled([
        axeAdapter.scan(page),
        useOfColor.scan(page),
        media.scan(page),
      ]);

      const axeViolations = axeResult.status === 'fulfilled' ? axeResult.value.violations.filter(v => v.severity !== 'info') : [];
      const uocViolations = uocResult.status === 'fulfilled' ? (uocResult.value.violations || []) : [];
      const mediaViolations = mediaResult.status === 'fulfilled' ? (mediaResult.value.violations || []) : [];

      // Find unique violations: criteria NOT covered by axe-core
      const uocUnique = uocViolations.filter(v => !isAxeCovered(v.wcagCriteria));
      const mediaUnique = mediaViolations.filter(v => !isAxeCovered(v.wcagCriteria));

      const row = {
        file: file.label,
        axe: axeViolations.length,
        useOfColor: uocViolations.length,
        useOfColorUnique: uocUnique.length,
        media: mediaViolations.length,
        mediaUnique: mediaUnique.length,
      };
      results.push(row);

      console.log(`${file.label}`);
      console.log(`  axe-core: ${row.axe} violations`);
      console.log(`  use-of-color: ${row.useOfColor} total, ${row.useOfColorUnique} unique (not in axe)`);
      console.log(`  media-accessibility: ${row.media} total, ${row.mediaUnique} unique (not in axe)`);

      if (uocUnique.length > 0) {
        console.log(`  use-of-color unique findings:`);
        for (const v of uocUnique.slice(0, 3)) {
          console.log(`    - [${v.wcagCriteria}] ${v.description || v.type || v.ruleId}`);
        }
      }
      if (mediaUnique.length > 0) {
        console.log(`  media-accessibility unique findings:`);
        for (const v of mediaUnique.slice(0, 3)) {
          console.log(`    - [${v.wcagCriteria}] ${v.description || v.type || v.ruleId}`);
        }
      }
      console.log();
    } catch (err) {
      console.log(`${file.label}: ERROR - ${err.message}\n`);
      results.push({ file: file.label, axe: 'ERR', useOfColor: 'ERR', useOfColorUnique: 'ERR', media: 'ERR', mediaUnique: 'ERR' });
    } finally {
      await page.close();
    }
  }

  await browser.close();
  server.close();

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log('File'.padEnd(55), 'axe'.padStart(5), 'UoC'.padStart(5), 'UoC-U'.padStart(6), 'Media'.padStart(6), 'Med-U'.padStart(6));
  console.log('-'.repeat(83));
  for (const r of results) {
    console.log(
      r.file.padEnd(55),
      String(r.axe).padStart(5),
      String(r.useOfColor).padStart(5),
      String(r.useOfColorUnique).padStart(6),
      String(r.media).padStart(6),
      String(r.mediaUnique).padStart(6),
    );
  }

  const totalUocUnique = results.reduce((s, r) => s + (typeof r.useOfColorUnique === 'number' ? r.useOfColorUnique : 0), 0);
  const totalMediaUnique = results.reduce((s, r) => s + (typeof r.mediaUnique === 'number' ? r.mediaUnique : 0), 0);
  console.log('-'.repeat(83));
  console.log(`\nTotal unique use-of-color findings: ${totalUocUnique}`);
  console.log(`Total unique media-accessibility findings: ${totalMediaUnique}`);
  console.log(`\nRECOMMENDATION:`);
  if (totalUocUnique === 0) console.log('  use-of-color: DELETE — no unique value over axe-core');
  else console.log(`  use-of-color: KEEP — ${totalUocUnique} unique findings across ${files.length} files`);
  if (totalMediaUnique === 0) console.log('  media-accessibility: DELETE — no unique value over axe-core');
  else console.log(`  media-accessibility: KEEP — ${totalMediaUnique} unique findings across ${files.length} files`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
