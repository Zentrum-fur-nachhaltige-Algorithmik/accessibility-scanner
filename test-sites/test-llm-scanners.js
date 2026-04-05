#!/usr/bin/env node

/**
 * LLM Scanner Smoke Test
 *
 * Tests each LLM scanner against 2 bad + 2 good files.
 * Success criteria: >80% detection rate on bad, <20% false positive on good.
 */

const path = require('path');
const http = require('http');
const fs = require('fs');
const { parseWcagMetadata } = require('./wcag-metadata-parser');

// Load .env if present
const envPath = path.join(__dirname, '..', '.env');
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
  // Try different import strategies
  try {
    return require('puppeteer');
  } catch {
    const mod = await import('puppeteer');
    return mod.default || mod;
  }
}

// Scanner → test file mappings
const SCANNER_TESTS = {
  'llm-semantic-text': {
    bad: ['bad-language-aaa.html', 'bad-navigation-aaa.html'],
    good: ['good-language-aaa.html', 'good-navigation-aaa.html'],
    criteria: ['3.1.3', '3.1.4', '3.1.6', '2.4.9', '2.4.10', '1.3.6'],
  },
  'llm-auth': {
    bad: ['bad-accessible-auth.html', 'bad-accessible-auth-enhanced.html'],
    good: ['good-accessible-auth.html', 'good-accessible-auth-enhanced.html'],
    criteria: ['3.3.8', '3.3.9'],
  },
  'llm-media-alternatives': {
    bad: ['bad-media-aaa.html', 'bad-media-alternatives.html'],
    good: ['good-media-aaa.html', 'good-accessibility.html'],
    criteria: ['1.2.6', '1.2.7', '1.2.8', '1.2.9'],
  },
  'llm-visual-presentation': {
    bad: ['bad-visual-presentation.html', 'bad-low-background-audio.html'],
    good: ['good-visual-presentation.html', 'good-low-background-audio.html'],
    criteria: ['1.4.7', '1.4.8', '1.4.9'],
  },
  'llm-behavioral': {
    bad: ['bad-timing-aaa.html', 'bad-change-on-request.html'],
    good: ['good-timing-aaa.html', 'good-change-on-request.html'],
    criteria: ['2.2.3', '2.2.4', '2.2.5', '2.2.6', '3.2.5', '3.3.5'],
  },
  'llm-focus-appearance': {
    bad: ['bad-focus-appearance.html', 'bad-focus-not-obscured-enhanced.html'],
    good: ['good-focus-appearance.html', 'good-focus-not-obscured-enhanced.html'],
    criteria: ['2.4.12', '2.4.13'],
  },
  'llm-sensory-characteristics': {
    bad: ['bad-sensory-characteristics.html'],
    good: ['good-sensory-characteristics.html'],
    criteria: ['1.3.3'],
  },
  'llm-reading-level': {
    bad: ['bad-reading-level.html'],
    good: ['good-reading-level.html'],
    criteria: ['3.1.5'],
  },
};

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY not set. Cannot test LLM scanners.');
    process.exit(1);
  }

  const puppeteer = await loadPuppeteer();
  const { LLMClient } = require('../src/llm-client');
  const LLMSemanticTextScanner = require('../src/llm-semantic-text-scanner');
  const LLMAuthScanner = require('../src/llm-auth-scanner');
  const LLMMediaAlternativesScanner = require('../src/llm-media-alternatives-scanner');
  const LLMVisualPresentationScanner = require('../src/llm-visual-presentation-scanner');
  const LLMBehavioralScanner = require('../src/llm-behavioral-scanner');
  const LLMFocusAppearanceScanner = require('../src/llm-focus-appearance-scanner');
  const LLMSensoryCharacteristicsScanner = require('../src/llm-sensory-characteristics-scanner');
  const LLMReadingLevelScanner = require('../src/llm-reading-level-scanner');

  const client = new LLMClient({
    apiKey: process.env.OPENROUTER_API_KEY,
    maxRetries: 3,
    timeoutMs: 60000,
  });

  const scanners = {
    'llm-semantic-text': new LLMSemanticTextScanner(client),
    'llm-auth': new LLMAuthScanner(client),
    'llm-media-alternatives': new LLMMediaAlternativesScanner(client),
    'llm-visual-presentation': new LLMVisualPresentationScanner(client),
    'llm-behavioral': new LLMBehavioralScanner(client),
    'llm-focus-appearance': new LLMFocusAppearanceScanner(client),
    'llm-sensory-characteristics': new LLMSensoryCharacteristicsScanner(client),
    'llm-reading-level': new LLMReadingLevelScanner(client),
  };

  // Start static file server
  const staticServer = http.createServer((req, res) => {
    const filePath = path.join(__dirname, req.url.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(filePath));
  });

  await new Promise(resolve => staticServer.listen(8099, resolve));
  console.log('Static server on port 8099\n');

  // Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = {};
  let totalTests = 0;
  let totalPassed = 0;

  for (const [scannerId, testConfig] of Object.entries(SCANNER_TESTS)) {
    const scanner = scanners[scannerId];
    console.log(`\n=== ${scannerId} ===`);
    console.log(`Criteria: ${testConfig.criteria.join(', ')}`);

    results[scannerId] = { bad: [], good: [] };

    // Test bad files (should find violations)
    for (const file of testConfig.bad) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        console.log(`  SKIP (not found): ${file}`);
        continue;
      }

      totalTests++;
      const page = await browser.newPage();
      try {
        await page.goto(`http://localhost:8099/${file}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const result = await scanner.scan(page);
        const detected = result.violations.length > 0;
        const status = detected ? 'PASS' : 'FAIL';
        if (detected) totalPassed++;

        console.log(`  [BAD]  ${file}: ${status} (${result.violations.length} violations)`);
        if (result.violations.length > 0) {
          result.violations.slice(0, 3).forEach(v => {
            console.log(`         - ${v.ruleId}: ${v.description.slice(0, 80)}`);
          });
        }

        results[scannerId].bad.push({ file, detected, violations: result.violations.length });
      } catch (err) {
        console.log(`  [BAD]  ${file}: ERROR - ${err.message}`);
        results[scannerId].bad.push({ file, detected: false, error: err.message });
      } finally {
        await page.close();
      }
    }

    // Test good files (should NOT find violations)
    for (const file of testConfig.good) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        console.log(`  SKIP (not found): ${file}`);
        continue;
      }

      totalTests++;
      const page = await browser.newPage();
      try {
        await page.goto(`http://localhost:8099/${file}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const result = await scanner.scan(page);

        // Filter violations to only count those matching the file's target criteria
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const metadata = parseWcagMetadata(fileContent);
        const targetCriteria = metadata && Array.isArray(metadata.criterion) ? metadata.criterion : [];

        let relevantViolations = result.violations;
        if (targetCriteria.length > 0) {
          relevantViolations = result.violations.filter(v => {
            const criterion = v.ruleId || '';
            return targetCriteria.some(tc => criterion.includes(tc));
          });
          const filtered = result.violations.length - relevantViolations.length;
          if (filtered > 0) {
            console.log(`         (filtered ${filtered} out-of-scope violations)`);
          }
        }

        const clean = relevantViolations.length === 0;
        const status = clean ? 'PASS' : 'FAIL';
        if (clean) totalPassed++;

        console.log(`  [GOOD] ${file}: ${status} (${relevantViolations.length} relevant / ${result.violations.length} total violations)`);
        if (relevantViolations.length > 0) {
          relevantViolations.slice(0, 2).forEach(v => {
            console.log(`         - FALSE POS: ${v.ruleId}: ${v.description.slice(0, 80)}`);
          });
        }

        results[scannerId].good.push({ file, clean, violations: relevantViolations.length });
      } catch (err) {
        console.log(`  [GOOD] ${file}: ERROR - ${err.message}`);
        results[scannerId].good.push({ file, clean: false, error: err.message });
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
  staticServer.close();

  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}/${totalTests} (${(totalPassed / totalTests * 100).toFixed(0)}%)`);

  for (const [scannerId, res] of Object.entries(results)) {
    const badDetected = res.bad.filter(r => r.detected).length;
    const goodClean = res.good.filter(r => r.clean).length;
    const detectionRate = res.bad.length > 0 ? (badDetected / res.bad.length * 100).toFixed(0) : 'N/A';
    const fpRate = res.good.length > 0 ? ((res.good.length - goodClean) / res.good.length * 100).toFixed(0) : 'N/A';
    console.log(`  ${scannerId}: detection=${detectionRate}%, false_positive=${fpRate}%`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
