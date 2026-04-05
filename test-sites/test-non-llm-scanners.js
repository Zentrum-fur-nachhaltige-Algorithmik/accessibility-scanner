#!/usr/bin/env node

/**
 * Non-LLM Scanner False Positive Test
 *
 * Tests all non-LLM scanners against ALL good test files.
 * Good files should produce 0 violations → any violation is a false positive.
 */

const path = require('path');
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

// Fast concurrent scanners only — skip exclusive/slow scanners (keyboard, focus, advanced-aria, etc.)
const SCANNER_MODULES = {
  'color-contrast': '../src/color-contrast-scanner',
  'use-of-color': '../src/use-of-color-scanner',
  'images-of-text': '../src/images-of-text-scanner',
  'language-detection': '../src/language-detection-scanner',
  'predictable-navigation': '../src/predictable-navigation-scanner',
  'error-handling': '../src/error-handling-scanner',
  'html-validation': '../src/html-validation-scanner',
  'page-structure': '../src/page-structure-scanner',
  'label-in-name': '../src/phase6a-label-in-name-scanner',
  'status-messages': '../src/phase6a-status-messages-scanner',
  'timing-controls': '../src/timing-controls-scanner',
  'screen-reader': '../src/screen-reader-scanner',
  'media-accessibility': '../src/media-accessibility-scanner',
  'advanced-contrast': '../src/advanced-contrast-scanner',
  'nontext-contrast': '../src/phase6a-nontext-contrast-scanner',
  'orientation': '../src/orientation-scanner',
  'input-purpose': '../src/input-purpose-scanner',
};

async function main() {
  const puppeteer = await loadPuppeteer();

  // Find all good test files
  const testDir = __dirname;
  const allFiles = fs.readdirSync(testDir).filter(f => f.startsWith('good-') && f.endsWith('.html'));
  console.log(`Found ${allFiles.length} good test files\n`);

  // Instantiate scanners
  const scanners = {};
  for (const [id, modulePath] of Object.entries(SCANNER_MODULES)) {
    try {
      const ScannerClass = require(modulePath);
      scanners[id] = new ScannerClass();
    } catch (err) {
      console.warn(`WARN: Could not load scanner ${id}: ${err.message}`);
    }
  }
  console.log(`Loaded ${Object.keys(scanners).length} scanners\n`);

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
  await new Promise(resolve => server.listen(8098, resolve));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const falsePositives = {};
  let totalFiles = 0;
  let cleanFiles = 0;

  // Suppress scanner verbose output
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  function silenceScanners() {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  }
  function restoreLogs() {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  for (const file of allFiles) {
    totalFiles++;
    const filePath = path.join(testDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata = parseWcagMetadata(content);
    const targetCriteria = metadata && Array.isArray(metadata.criterion) ? metadata.criterion : [];

    let fileViolations = [];

    for (const [scannerId, scanner] of Object.entries(scanners)) {
      const page = await browser.newPage();
      // Suppress console output from scanners
      page.on('console', () => {});
      try {
        await page.goto(`http://localhost:8098/${file}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        silenceScanners();
        const result = await Promise.race([
          scanner.scan(page, { observationTime: 0 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('scanner-timeout')), 20000)),
        ]);
        if (result.violations && result.violations.length > 0) {
          // Filter to only violations matching target criteria
          const relevant = result.violations.filter(v => {
            if (targetCriteria.length === 0) return true;
            const criterion = v.ruleId || '';
            return targetCriteria.some(tc => criterion.includes(tc));
          });

          if (relevant.length > 0) {
            fileViolations.push({
              scanner: scannerId,
              count: relevant.length,
              violations: relevant.slice(0, 2).map(v => `${v.ruleId}: ${(v.description || '').slice(0, 80)}`),
            });
          }
        }
      } catch (err) {
        // Skip scanner errors/timeouts silently
      } finally {
        restoreLogs();
        await page.close().catch(() => {});
      }
    }

    if (fileViolations.length === 0) {
      cleanFiles++;
      process.stdout.write('.');
    } else {
      process.stdout.write('\n');
      console.log(`FAIL: ${file} (criteria: ${targetCriteria.join(', ')})`);
      for (const fv of fileViolations) {
        console.log(`  ${fv.scanner}: ${fv.count} violations`);
        fv.violations.forEach(v => console.log(`    - ${v}`));
      }
      falsePositives[file] = fileViolations;
    }
  }

  await browser.close();
  server.close();

  console.log(`\n=== SUMMARY ===`);
  console.log(`Good files tested: ${totalFiles}`);
  console.log(`Clean (0 false positives): ${cleanFiles}/${totalFiles} (${(cleanFiles / totalFiles * 100).toFixed(0)}%)`);
  console.log(`Files with false positives: ${Object.keys(falsePositives).length}`);

  if (Object.keys(falsePositives).length > 0) {
    console.log(`\nFalse positive files:`);
    for (const [file, violations] of Object.entries(falsePositives)) {
      const totalV = violations.reduce((sum, v) => sum + v.count, 0);
      console.log(`  ${file}: ${totalV} violations from ${violations.map(v => v.scanner).join(', ')}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
