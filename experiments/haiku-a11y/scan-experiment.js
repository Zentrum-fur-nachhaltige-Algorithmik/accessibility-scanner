#!/usr/bin/env node

/**
 * Haiku a11y-code Skill Experiment — Scanner
 *
 * Scans all generated HTML files from experiments/haiku-a11y/generated/
 * using the full scanner profile and produces JSON + Markdown reports.
 */

// Load .env manually (no dotenv dependency)
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
const { registerAllScanners, getProfile } = require('../../src/scanner-registry');

const GENERATED_DIR = path.join(__dirname, 'generated');
const RESULTS_DIR = path.join(__dirname, 'results');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// EAA scanners that always fail on standalone pages (expected)
const EAA_SCANNERS = [
  'accessibility-statement',
  'contact-mechanism',
  'compliance-monitoring',
  'eaa-procedure',
];

function createServer(rootDir) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url === '/' ? '/index.html' : req.url);
    const filePath = path.join(rootDir, urlPath);

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

function startServer(srv) {
  return new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve(`http://127.0.0.1:${port}`);
    });
    srv.on('error', reject);
  });
}

function stopServer(srv) {
  return new Promise((resolve) => srv.close(resolve));
}

/**
 * Discover all HTML files in the generated directory.
 * Returns array of { tech, css, page, relPath }
 */
function discoverFiles() {
  const files = [];
  const dirs = fs.readdirSync(GENERATED_DIR);

  for (const dir of dirs) {
    const dirPath = path.join(GENERATED_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const [tech, css] = dir.split('-');
    const htmlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.html'));

    for (const file of htmlFiles) {
      const page = path.basename(file, '.html');
      files.push({
        tech,
        css,
        page,
        relPath: `${dir}/${file}`,
        fullPath: path.join(dirPath, file),
      });
    }
  }

  return files;
}

/**
 * Validate that a file contains valid-looking HTML.
 */
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

/**
 * Compute aggregates from scan results.
 */
function computeAggregates(results) {
  const scores = results.map(r => r.scanResult.accessibilityScore);
  const violations = results.map(r => r.scanResult.totalViolations);

  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  // Count violations by severity
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

  // Sort criteria by count descending
  const topCriteria = Object.entries(byCriterion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const topScanners = Object.entries(byScanner)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    count: results.length,
    meanScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    medianScore: Math.round(median),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    totalViolations: violations.reduce((a, b) => a + b, 0),
    meanViolations: +(violations.reduce((a, b) => a + b, 0) / violations.length).toFixed(1),
    bySeverity,
    topCriteria,
    topScanners,
  };
}

/**
 * Group results by a key function and compute aggregates for each group.
 */
function groupAndAggregate(results, keyFn) {
  const groups = {};
  for (const r of results) {
    const key = keyFn(r);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const agg = {};
  for (const [key, items] of Object.entries(groups)) {
    agg[key] = computeAggregates(items);
  }
  return agg;
}

/**
 * Generate Markdown summary report.
 */
function generateMarkdown(allResults, validationResults) {
  const valid = allResults.filter(r => r.validation.valid);
  const invalid = allResults.filter(r => !r.validation.valid);
  const scanned = valid.filter(r => r.scanResult);

  let md = `# Haiku + a11y-code Skill Experiment Results\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Model:** Claude Haiku 4.5\n`;
  md += `**Scan Profile:** full (all 40+ scanners including LLM)\n`;
  md += `**Total Files:** ${allResults.length} | **Valid:** ${valid.length} | **Invalid:** ${invalid.length} | **Scanned:** ${scanned.length}\n\n`;

  if (invalid.length > 0) {
    md += `## Generation Failures\n\n`;
    md += `| File | Issue |\n|------|-------|\n`;
    for (const r of invalid) {
      md += `| ${r.relPath} | size=${r.validation.size}, doctype=${r.validation.hasDoctype}, closing=${r.validation.hasClosingHtml} |\n`;
    }
    md += `\n`;
  }

  if (scanned.length === 0) {
    md += `No files were successfully scanned.\n`;
    return md;
  }

  // Overall aggregate
  const overall = computeAggregates(scanned);
  md += `## Overall Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Mean Score | ${overall.meanScore}% |\n`;
  md += `| Median Score | ${overall.medianScore}% |\n`;
  md += `| Min / Max Score | ${overall.minScore}% / ${overall.maxScore}% |\n`;
  md += `| Total Violations | ${overall.totalViolations} |\n`;
  md += `| Mean Violations/Page | ${overall.meanViolations} |\n`;
  md += `| Critical | ${overall.bySeverity.critical} |\n`;
  md += `| Serious | ${overall.bySeverity.serious} |\n`;
  md += `| Moderate | ${overall.bySeverity.moderate} |\n`;
  md += `| Minor | ${overall.bySeverity.minor} |\n\n`;

  // By Technology
  const byTech = groupAndAggregate(scanned, r => r.tech);
  md += `## By Technology\n\n`;
  md += `| Technology | Mean Score | Mean Violations | Critical | Serious |\n`;
  md += `|-----------|-----------|----------------|----------|--------|\n`;
  for (const [tech, agg] of Object.entries(byTech).sort((a, b) => b[1].meanScore - a[1].meanScore)) {
    md += `| ${tech} | ${agg.meanScore}% | ${agg.meanViolations} | ${agg.bySeverity.critical} | ${agg.bySeverity.serious} |\n`;
  }
  md += `\n`;

  // By CSS Framework
  const byCSS = groupAndAggregate(scanned, r => r.css);
  md += `## By CSS Framework\n\n`;
  md += `| CSS | Mean Score | Mean Violations | Critical | Serious |\n`;
  md += `|-----|-----------|----------------|----------|--------|\n`;
  for (const [css, agg] of Object.entries(byCSS).sort((a, b) => b[1].meanScore - a[1].meanScore)) {
    md += `| ${css} | ${agg.meanScore}% | ${agg.meanViolations} | ${agg.bySeverity.critical} | ${agg.bySeverity.serious} |\n`;
  }
  md += `\n`;

  // By Page Type
  const byPage = groupAndAggregate(scanned, r => r.page);
  md += `## By Page Type\n\n`;
  md += `| Page | Mean Score | Mean Violations | Critical | Serious |\n`;
  md += `|------|-----------|----------------|----------|--------|\n`;
  for (const [page, agg] of Object.entries(byPage).sort((a, b) => b[1].meanScore - a[1].meanScore)) {
    md += `| ${page} | ${agg.meanScore}% | ${agg.meanViolations} | ${agg.bySeverity.critical} | ${agg.bySeverity.serious} |\n`;
  }
  md += `\n`;

  // Heatmap: tech-css x page
  md += `## Score Heatmap (Tech-CSS x Page)\n\n`;
  const pageTypes = [...new Set(scanned.map(r => r.page))].sort();
  md += `| Tech-CSS | ${pageTypes.join(' | ')} |\n`;
  md += `|----------|${pageTypes.map(() => '------').join('|')}|\n`;
  const techCSSGroups = {};
  for (const r of scanned) {
    const key = `${r.tech}-${r.css}`;
    if (!techCSSGroups[key]) techCSSGroups[key] = {};
    techCSSGroups[key][r.page] = r.scanResult;
  }
  for (const [key, pages] of Object.entries(techCSSGroups).sort()) {
    const cells = pageTypes.map(p => {
      if (!pages[p]) return '-';
      const s = pages[p];
      return `${s.accessibilityScore}% (${s.totalViolations}v)`;
    });
    md += `| ${key} | ${cells.join(' | ')} |\n`;
  }
  md += `\n`;

  // Top 10 Failed WCAG Criteria
  md += `## Top 10 Failed WCAG Criteria\n\n`;
  md += `| Criterion | Count |\n|-----------|-------|\n`;
  for (const [crit, count] of overall.topCriteria) {
    md += `| ${crit} | ${count} |\n`;
  }
  md += `\n`;

  // Top 10 Scanners with Most Violations
  md += `## Top 10 Scanners with Most Violations\n\n`;
  md += `| Scanner | Violations |\n|---------|------------|\n`;
  for (const [scanner, count] of overall.topScanners) {
    md += `| ${scanner} | ${count} |\n`;
  }
  md += `\n`;

  // Per-file detail table
  md += `## Per-File Results\n\n`;
  md += `| File | Score | Violations | Critical | Serious | Moderate | Minor |\n`;
  md += `|------|-------|-----------|----------|---------|----------|-------|\n`;
  for (const r of scanned.sort((a, b) => a.scanResult.accessibilityScore - b.scanResult.accessibilityScore)) {
    const v = r.scanResult.violations;
    const sev = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const viol of v) {
      const s = viol.severity || viol.impact || 'moderate';
      sev[s] = (sev[s] || 0) + 1;
    }
    md += `| ${r.relPath} | ${r.scanResult.accessibilityScore}% | ${r.scanResult.totalViolations} | ${sev.critical} | ${sev.serious} | ${sev.moderate} | ${sev.minor} |\n`;
  }

  return md;
}

async function main() {
  console.log('=== Haiku a11y-code Skill Experiment Scanner ===\n');

  // Discover files
  const files = discoverFiles();
  console.log(`Found ${files.length} generated HTML files\n`);

  if (files.length === 0) {
    console.error('No files found in generated/ directory. Run the generation step first.');
    process.exit(1);
  }

  // Validate all files
  console.log('Validating HTML files...');
  for (const f of files) {
    f.validation = validateHTML(f.fullPath);
    const status = f.validation.valid ? 'OK' : 'INVALID';
    console.log(`  [${status}] ${f.relPath} (${f.validation.size} bytes)`);
  }

  const validFiles = files.filter(f => f.validation.valid);
  const invalidFiles = files.filter(f => !f.validation.valid);
  console.log(`\nValid: ${validFiles.length} | Invalid: ${invalidFiles.length}\n`);

  if (validFiles.length === 0) {
    console.error('No valid HTML files to scan.');
    process.exit(1);
  }

  // Start server
  const server = createServer(GENERATED_DIR);
  const baseUrl = await startServer(server);
  console.log(`Fixture server running at ${baseUrl}\n`);

  // Initialize scanner pipeline
  console.log('Initializing scan pipeline (full profile)...');
  const pipeline = new ScanPipeline();
  const scanners = registerAllScanners(pipeline);
  console.log(`Registered ${scanners.length} scanners\n`);

  // Scan each valid file
  const results = [];
  for (let i = 0; i < validFiles.length; i++) {
    const f = validFiles[i];
    const url = `${baseUrl}/${f.relPath}`;
    console.log(`[${i + 1}/${validFiles.length}] Scanning ${f.relPath}...`);

    try {
      const scanResult = await pipeline.scan(url, { timeout: 60000 });

      // Filter out EAA scanner violations (expected failures for standalone pages)
      const filteredViolations = scanResult.violations.filter(
        v => !EAA_SCANNERS.includes(v.scannerId)
      );
      const filteredScanners = { ...scanResult.scanners };
      for (const eaa of EAA_SCANNERS) {
        delete filteredScanners[eaa];
      }

      // Recompute score without EAA scanners
      const scannerEntries = Object.values(filteredScanners);
      const totalScanners = scannerEntries.length;
      const passedScanners = scannerEntries.filter(s => s.passed).length;

      f.scanResult = {
        ...scanResult,
        violations: filteredViolations,
        totalViolations: filteredViolations.length,
        scanners: filteredScanners,
        accessibilityScore: totalScanners > 0 ? Math.round((passedScanners / totalScanners) * 100) : 0,
        rawScore: scanResult.accessibilityScore,
        rawViolations: scanResult.totalViolations,
      };

      console.log(`  Score: ${f.scanResult.accessibilityScore}% | Violations: ${f.scanResult.totalViolations} (raw: ${scanResult.totalViolations})`);
      results.push(f);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      f.scanResult = null;
      f.scanError = err.message;
    }
  }

  // Close pipeline and server
  await pipeline.close();
  await stopServer(server);

  console.log(`\nScanning complete. ${results.length}/${validFiles.length} files scanned.\n`);

  // Ensure results directory exists
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Write raw JSON report
  const jsonReport = {
    metadata: {
      timestamp: new Date().toISOString(),
      model: 'claude-haiku-4-5-20251001',
      scanProfile: 'full',
      scannerCount: scanners.length,
      totalFiles: files.length,
      validFiles: validFiles.length,
      scannedFiles: results.length,
      eaaScannersExcluded: EAA_SCANNERS,
    },
    files: files.map(f => ({
      tech: f.tech,
      css: f.css,
      page: f.page,
      relPath: f.relPath,
      validation: f.validation,
      scanResult: f.scanResult || null,
      scanError: f.scanError || null,
    })),
  };

  const jsonPath = path.join(RESULTS_DIR, 'experiment-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`JSON report: ${jsonPath}`);

  // Write Markdown summary
  const mdReport = generateMarkdown(files, null);
  const mdPath = path.join(RESULTS_DIR, 'experiment-summary.md');
  fs.writeFileSync(mdPath, mdReport);
  console.log(`Markdown report: ${mdPath}`);

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
