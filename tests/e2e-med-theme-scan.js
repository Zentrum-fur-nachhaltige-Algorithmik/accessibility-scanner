#!/usr/bin/env node

/**
 * End-to-end acceptance scan of a med-websites theme.
 *
 * Serves the frozen snapshot of a real med-websites theme export
 * (`test-sites/realworld/med-theme.html`, captured from the
 * dr-mauermann-urologe preview deployment) over a local server and runs the
 * full scan pipeline against it, then prints the findings grouped by scanner
 * and rule so a human can judge whether the report is dominated by true
 * positives — the sprint's stated acceptance bar for real-page precision.
 *
 * This is a REVIEW tool, not a pass/fail test: it makes no assertions. The
 * pass/fail regression guards for the same corpus live in
 * `test-sites/test-realworld.js`.
 *
 * Usage:
 *   node tests/e2e-med-theme-scan.js                    # standard profile, no LLM unless key present
 *   node tests/e2e-med-theme-scan.js --no-llm
 *   node tests/e2e-med-theme-scan.js --file med-theme.html --profile standard
 *   node tests/e2e-med-theme-scan.js --json out.json
 */

const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, 'test-sites', 'realworld');

// Load .env so LLM scanners register when a key is configured.
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  const file = arg('--file', 'med-theme.html');
  const profileName = arg('--profile', 'standard');
  const jsonPath = arg('--json');
  const noLlm = process.argv.includes('--no-llm');
  if (noLlm) delete process.env.OPENROUTER_API_KEY;

  const filePath = path.join(CORPUS, file);
  if (!fs.existsSync(filePath)) {
    console.error(`Not found: ${filePath}`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const p = path.join(CORPUS, decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]));
    if (!p.startsWith(CORPUS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(p));
  });
  const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
  const url = `http://localhost:${port}/${file}`;

  const ScanPipeline = require(path.join(ROOT, 'src', 'scan-pipeline'));
  const { registerAllScanners, getProfile } = require(path.join(ROOT, 'src', 'scanner-registry'));

  const pipeline = new ScanPipeline();
  registerAllScanners(pipeline);
  const { scannerIds, options } = getProfile(profileName);

  console.log(`\nScanning ${file} (profile: ${profileName}, LLM: ${process.env.OPENROUTER_API_KEY ? 'on' : 'off'})\n`);
  const started = Date.now();
  const result = await pipeline.scan(url, { ...options, scannerIds });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  await pipeline.close();
  server.close();

  const violations = result.violations || [];
  const real = violations.filter((v) => (v.severity || 'violation') !== 'info');
  const info = violations.filter((v) => (v.severity || 'violation') === 'info');

  console.log(`=== ${file} — ${elapsed}s ===`);
  console.log(`Score: ${result.accessibilityScore}`);
  console.log(`Findings: ${real.length} violations + ${info.length} informational\n`);

  const byScanner = {};
  for (const v of real) {
    const s = v.scannerId || 'unknown';
    byScanner[s] = byScanner[s] || {};
    const key = v.issue || v.type || v.ruleId || v.axeRuleId || 'unclassified';
    byScanner[s][key] = (byScanner[s][key] || 0) + 1;
  }

  console.log('--- violations by scanner / rule ---');
  for (const [s, rules] of Object.entries(byScanner).sort((a, b) =>
    Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)
  )) {
    const total = Object.values(rules).reduce((x, y) => x + y, 0);
    console.log(`\n${s} (${total})`);
    for (const [rule, n] of Object.entries(rules).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(3)}  ${rule}`);
    }
  }

  console.log('\n--- one example per rule (for human judgement) ---');
  const seen = new Set();
  for (const v of real) {
    const key = `${v.scannerId}|${v.issue || v.type || v.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sel = v.element || (v.nodes && v.nodes[0] && v.nodes[0].selector) || '?';
    console.log(`\n[${v.scannerId}] ${v.issue || v.type || v.ruleId} — ${v.severity || v.impact}`);
    console.log(`   selector: ${String(sel).slice(0, 110)}`);
    console.log(`   ${String(v.description || v.help || '').replace(/\s+/g, ' ').slice(0, 240)}`);
  }

  const errored = Object.entries(result.scanners || {})
    .filter(([, s]) => s.error)
    .map(([id, s]) => `${id}: ${s.error}`);
  if (errored.length) {
    console.log(`\n--- SCANNER ERRORS (${errored.length}) ---`);
    for (const e of errored) console.log(`   ${e}`);
  } else {
    console.log('\nNo scanner errors.');
  }

  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    console.log(`\nWrote ${jsonPath}`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
