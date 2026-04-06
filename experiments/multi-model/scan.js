#!/usr/bin/env node

/**
 * Multi-Model A11y Experiment — Scanner
 *
 * Scans all generated HTML files from experiments/multi-model/generated/{model}/
 * using the full scanner profile. Produces per-model and cross-model reports.
 */

// Load .env manually
const envPath = require('path').resolve(__dirname, '../../.env');
try {
  const envContent = require('fs').readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e) {
  console.warn('Warning: Could not read .env file:', e.message);
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const ScanPipeline = require('../../src/scan-pipeline');
const { registerAllScanners } = require('../../src/scanner-registry');

const GENERATED_DIR = path.join(__dirname, 'generated');
const RESULTS_DIR = path.join(__dirname, 'results');

const EAA_SCANNERS = [
  'accessibility-statement',
  'contact-mechanism',
  'compliance-monitoring',
  'eaa-procedure',
];

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// ── HTTP Server ─────────────────────────────────────────────────────────────

function createServer(rootDir) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url === '/' ? '/index.html' : req.url);
    const filePath = path.join(rootDir, urlPath);
    if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

function startServer(srv) {
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
    srv.on('error', reject);
  });
}

function stopServer(srv) {
  return new Promise(resolve => srv.close(resolve));
}

// ── File Discovery ──────────────────────────────────────────────────────────

function discoverModels() {
  if (!fs.existsSync(GENERATED_DIR)) throw new Error(`No generated/ directory found at ${GENERATED_DIR}`);
  return fs.readdirSync(GENERATED_DIR)
    .filter(d => fs.statSync(path.join(GENERATED_DIR, d)).isDirectory())
    .sort();
}

function discoverFiles(modelSlug) {
  const modelDir = path.join(GENERATED_DIR, modelSlug);
  const files = [];
  for (const dir of fs.readdirSync(modelDir)) {
    const dirPath = path.join(modelDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const parts = dir.split('-');
    const tech = parts[0];
    const css = parts.slice(1).join('-');
    for (const file of fs.readdirSync(dirPath).filter(f => f.endsWith('.html'))) {
      const page = path.basename(file, '.html');
      files.push({
        tech, css, page,
        relPath: `${modelSlug}/${dir}/${file}`,
        fullPath: path.join(dirPath, file),
      });
    }
  }
  return files;
}

function validateHTML(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hasDoctype = content.trim().toLowerCase().startsWith('<!doctype html');
    const hasClosingHtml = content.includes('</html>');
    const size = content.length;
    return { valid: hasDoctype && hasClosingHtml && size > 100, size, hasDoctype, hasClosingHtml };
  } catch {
    return { valid: false, size: 0, hasDoctype: false, hasClosingHtml: false };
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function computeAggregates(results) {
  if (results.length === 0) return null;
  const scores = results.map(r => r.scanResult.accessibilityScore);
  const violations = results.map(r => r.scanResult.totalViolations);
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byCriterion = {};
  const byScanner = {};

  for (const r of results) {
    for (const v of r.scanResult.violations) {
      const sev = v.severity || v.impact || 'moderate';
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
      const crit = v.wcagCriteria || v.criterion || 'unknown';
      byCriterion[crit] = (byCriterion[crit] || 0) + 1;
      const scanner = v.scannerId || 'unknown';
      byScanner[scanner] = (byScanner[scanner] || 0) + 1;
    }
  }

  return {
    count: results.length,
    meanScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    medianScore: Math.round(median),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    totalViolations: violations.reduce((a, b) => a + b, 0),
    meanViolations: +(violations.reduce((a, b) => a + b, 0) / violations.length).toFixed(1),
    bySeverity,
    topCriteria: Object.entries(byCriterion).sort((a, b) => b[1] - a[1]).slice(0, 10),
    topScanners: Object.entries(byScanner).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

// ── Report Generation ───────────────────────────────────────────────────────

function generateCrossModelReport(modelResults) {
  let md = `# Multi-Model A11y Experiment — Scan Results\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Scan Profile:** full (all scanners including LLM)\n`;
  md += `**EAA Scanners Excluded:** ${EAA_SCANNERS.join(', ')}\n\n`;

  // Cross-model comparison table
  md += `## Model Comparison\n\n`;
  md += `| Model | Pages | Mean Score | Median | Min | Max | Mean Violations | Critical | Serious |\n`;
  md += `|-------|-------|-----------|--------|-----|-----|----------------|----------|--------|\n`;

  const allScanned = [];
  for (const { slug, scanned, agg } of modelResults) {
    if (!agg) {
      md += `| ${slug} | 0 | — | — | — | — | — | — | — |\n`;
      continue;
    }
    md += `| ${slug} | ${agg.count} | ${agg.meanScore}% | ${agg.medianScore}% | ${agg.minScore}% | ${agg.maxScore}% | ${agg.meanViolations} | ${agg.bySeverity.critical} | ${agg.bySeverity.serious} |\n`;
    allScanned.push(...scanned);
  }
  md += `\n`;

  // By Technology (across all models)
  if (allScanned.length > 0) {
    md += `## By Technology (all models combined)\n\n`;
    md += `| Technology | Mean Score | Mean Violations |\n`;
    md += `|-----------|-----------|----------------|\n`;
    const byTech = {};
    for (const r of allScanned) {
      if (!byTech[r.tech]) byTech[r.tech] = [];
      byTech[r.tech].push(r);
    }
    for (const [tech, items] of Object.entries(byTech).sort()) {
      const agg = computeAggregates(items);
      md += `| ${tech} | ${agg.meanScore}% | ${agg.meanViolations} |\n`;
    }
    md += `\n`;

    // Heatmap: model x tech
    md += `## Score Heatmap (Model × Technology)\n\n`;
    const techs = [...new Set(allScanned.map(r => r.tech))].sort();
    md += `| Model | ${techs.join(' | ')} |\n`;
    md += `|-------|${techs.map(() => '------').join('|')}|\n`;
    for (const { slug, scanned } of modelResults) {
      const cells = techs.map(t => {
        const match = scanned.find(r => r.tech === t);
        if (!match) return '—';
        return `${match.scanResult.accessibilityScore}% (${match.scanResult.totalViolations}v)`;
      });
      md += `| ${slug} | ${cells.join(' | ')} |\n`;
    }
    md += `\n`;

    // Top failing criteria across all models
    const overallAgg = computeAggregates(allScanned);
    md += `## Top 10 Failed WCAG Criteria (all models)\n\n`;
    md += `| Criterion | Count |\n|-----------|-------|\n`;
    for (const [crit, count] of overallAgg.topCriteria) {
      md += `| ${crit} | ${count} |\n`;
    }
    md += `\n`;
  }

  // Per-file detail
  md += `## All Files\n\n`;
  md += `| Model | Tech | Score | Violations | Critical | Serious |\n`;
  md += `|-------|------|-------|-----------|----------|--------|\n`;
  for (const { slug, scanned } of modelResults) {
    for (const r of scanned.sort((a, b) => a.scanResult.accessibilityScore - b.scanResult.accessibilityScore)) {
      const sev = { critical: 0, serious: 0 };
      for (const v of r.scanResult.violations) {
        const s = v.severity || v.impact || 'moderate';
        if (s === 'critical') sev.critical++;
        if (s === 'serious') sev.serious++;
      }
      md += `| ${slug} | ${r.tech}-${r.css} | ${r.scanResult.accessibilityScore}% | ${r.scanResult.totalViolations} | ${sev.critical} | ${sev.serious} |\n`;
    }
  }

  return md;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const filterModel = process.argv[2];

  let modelSlugs = discoverModels();
  if (filterModel) {
    modelSlugs = modelSlugs.filter(s => s.includes(filterModel));
    if (modelSlugs.length === 0) throw new Error(`No model matching "${filterModel}". Found: ${discoverModels().join(', ')}`);
  }

  console.log(`\n=== Multi-Model A11y Experiment Scanner ===`);
  console.log(`Models: ${modelSlugs.join(', ')}\n`);

  // Start server serving the entire generated/ directory
  const server = createServer(GENERATED_DIR);
  const baseUrl = await startServer(server);
  console.log(`Fixture server at ${baseUrl}`);

  // Initialize pipeline once
  console.log('Initializing scan pipeline (full profile)...');
  const pipeline = new ScanPipeline();
  const scanners = registerAllScanners(pipeline);
  console.log(`Registered ${scanners.length} scanners\n`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const modelResults = [];

  for (const slug of modelSlugs) {
    console.log(`\n── Scanning: ${slug} ──`);

    const files = discoverFiles(slug);
    console.log(`  Found ${files.length} HTML files`);

    // Validate
    for (const f of files) {
      f.validation = validateHTML(f.fullPath);
    }
    const valid = files.filter(f => f.validation.valid);
    const invalid = files.filter(f => !f.validation.valid);
    if (invalid.length > 0) {
      console.log(`  ⚠ ${invalid.length} invalid files skipped: ${invalid.map(f => f.relPath).join(', ')}`);
    }

    if (valid.length === 0) {
      console.log(`  No valid files to scan.`);
      modelResults.push({ slug, scanned: [], agg: null });
      continue;
    }

    const scanned = [];
    for (let i = 0; i < valid.length; i++) {
      const f = valid[i];
      const url = `${baseUrl}/${f.relPath}`;
      process.stdout.write(`  [${i + 1}/${valid.length}] ${f.tech}-${f.css}/${f.page}... `);

      try {
        const scanResult = await pipeline.scan(url, { timeout: 120000 });

        // Filter EAA scanners
        const filteredViolations = scanResult.violations.filter(v => !EAA_SCANNERS.includes(v.scannerId));
        const filteredScanners = { ...scanResult.scanners };
        for (const eaa of EAA_SCANNERS) delete filteredScanners[eaa];

        const scannerEntries = Object.values(filteredScanners);
        const passed = scannerEntries.filter(s => s.passed).length;

        f.scanResult = {
          ...scanResult,
          violations: filteredViolations,
          totalViolations: filteredViolations.length,
          scanners: filteredScanners,
          accessibilityScore: scannerEntries.length > 0 ? Math.round((passed / scannerEntries.length) * 100) : 0,
          rawScore: scanResult.accessibilityScore,
          rawViolations: scanResult.totalViolations,
        };

        console.log(`${f.scanResult.accessibilityScore}% | ${f.scanResult.totalViolations}v (raw: ${scanResult.totalViolations})`);
        scanned.push(f);
      } catch (err) {
        console.log(`ERROR: ${err.message.slice(0, 100)}`);
        f.scanError = err.message;
      }
    }

    const agg = scanned.length > 0 ? computeAggregates(scanned) : null;
    modelResults.push({ slug, scanned, agg });

    // Write per-model JSON
    const modelReport = {
      metadata: { model: slug, timestamp: new Date().toISOString(), scannerCount: scanners.length, eaaExcluded: EAA_SCANNERS },
      files: files.map(f => ({ tech: f.tech, css: f.css, page: f.page, relPath: f.relPath, validation: f.validation, scanResult: f.scanResult || null, scanError: f.scanError || null })),
    };
    fs.writeFileSync(path.join(RESULTS_DIR, `${slug}.json`), JSON.stringify(modelReport, null, 2));
    console.log(`  → ${RESULTS_DIR}/${slug}.json`);
  }

  await pipeline.close();
  await stopServer(server);

  // Write cross-model summary
  const summaryMd = generateCrossModelReport(modelResults);
  const summaryPath = path.join(RESULTS_DIR, 'scan-summary.md');
  fs.writeFileSync(summaryPath, summaryMd);
  console.log(`\n✓ Cross-model summary: ${summaryPath}`);

  // Write combined JSON
  const combinedJson = {
    metadata: { timestamp: new Date().toISOString(), models: modelSlugs, scannerCount: scanners.length, eaaExcluded: EAA_SCANNERS },
    models: modelResults.map(({ slug, scanned, agg }) => ({ slug, aggregate: agg, files: scanned.map(f => ({ tech: f.tech, css: f.css, page: f.page, score: f.scanResult.accessibilityScore, violations: f.scanResult.totalViolations })) })),
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'scan-report.json'), JSON.stringify(combinedJson, null, 2));
  console.log(`✓ Combined JSON: ${RESULTS_DIR}/scan-report.json\n`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
