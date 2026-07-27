#!/usr/bin/env node

/**
 * Generate a detailed violation report with file paths for manual validation.
 * Run after scan-experiment.js completes.
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const GENERATED_DIR = path.join(__dirname, 'generated');
const REPORT_PATH = path.join(RESULTS_DIR, 'experiment-report.json');
const OUTPUT_PATH = path.join(RESULTS_DIR, 'detailed-violations.md');

// Windows base path for file links
const WIN_BASE = 'C:\\Users\\T14\\Desktop\\accessability\\experiments\\haiku-a11y\\generated';

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error('experiment-report.json not found. Run scan-experiment.js first.');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
  const files = report.files.filter(f => f.scanResult);

  let md = `# Detailed Violation Report — Haiku + a11y-code Experiment\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Scanned Files:** ${files.length}\n\n`;

  // === SECTION 1: Scanner Errors ===
  md += `## 1. Scanner Errors\n\n`;
  md += `These are scanner-level errors (scanner crashed or failed to complete).\n\n`;

  let hasErrors = false;
  for (const f of files) {
    const scanners = f.scanResult.scanners || {};
    const errors = Object.entries(scanners)
      .filter(([_, s]) => s.error)
      .map(([id, s]) => ({ scannerId: id, error: s.error }));

    if (errors.length > 0) {
      hasErrors = true;
      const winPath = `${WIN_BASE}\\${f.relPath.replace(/\//g, '\\\\')}`;
      md += `### ${f.relPath}\n`;
      md += `**File:** \`${winPath}\`\n\n`;
      md += `| Scanner | Error |\n|---------|-------|\n`;
      for (const e of errors) {
        md += `| ${e.scannerId} | ${e.error.replace(/\|/g, '\\|').substring(0, 200)} |\n`;
      }
      md += `\n`;
    }
  }
  if (!hasErrors) {
    md += `No scanner errors found.\n\n`;
  }

  // === SECTION 2: All Violations Grouped by File ===
  md += `## 2. All Violations by File\n\n`;

  let totalViolations = 0;
  const allViolationsByType = {};

  for (const f of files) {
    const violations = f.scanResult.violations || [];
    if (violations.length === 0) continue;

    totalViolations += violations.length;
    const winPath = `${WIN_BASE}\\${f.relPath.replace(/\//g, '\\\\')}`;

    md += `### ${f.relPath} (Score: ${f.scanResult.accessibilityScore}%, ${violations.length} violations)\n`;
    md += `**File:** \`${winPath}\`\n\n`;

    // Group violations by scanner
    const byScanner = {};
    for (const v of violations) {
      const sid = v.scannerId || 'unknown';
      if (!byScanner[sid]) byScanner[sid] = [];
      byScanner[sid].push(v);

      // Track global violation types
      const typeKey = `${sid}:${v.id || v.rule || v.description?.substring(0, 60) || 'unknown'}`;
      if (!allViolationsByType[typeKey]) {
        allViolationsByType[typeKey] = { count: 0, files: [], sample: v };
      }
      allViolationsByType[typeKey].count++;
      allViolationsByType[typeKey].files.push(f.relPath);
    }

    for (const [scanner, scanViolations] of Object.entries(byScanner).sort()) {
      md += `#### Scanner: ${scanner}\n\n`;
      md += `| # | Severity | WCAG | Rule/ID | Description | Element |\n`;
      md += `|---|----------|------|---------|-------------|--------|\n`;
      for (let i = 0; i < scanViolations.length; i++) {
        const v = scanViolations[i];
        const severity = v.severity || v.impact || '-';
        const wcag = v.wcagCriteria || v.criterion || '-';
        const rule = v.id || v.rule || '-';
        const desc = (v.description || v.message || '-').replace(/\|/g, '\\|').substring(0, 120);
        const element = (v.element || v.selector || v.html || '-').replace(/\|/g, '\\|').substring(0, 80);
        md += `| ${i + 1} | ${severity} | ${wcag} | ${rule} | ${desc} | \`${element}\` |\n`;
      }
      md += `\n`;
    }
    md += `---\n\n`;
  }

  md += `**Total Violations:** ${totalViolations}\n\n`;

  // === SECTION 3: Violation Type Summary (for false positive analysis) ===
  md += `## 3. Violation Types Summary\n\n`;
  md += `Grouped by violation type across all files. High-count types are likely real patterns; single-occurrence types may be false positives.\n\n`;

  const sortedTypes = Object.entries(allViolationsByType)
    .sort((a, b) => b[1].count - a[1].count);

  md += `| # | Scanner:Rule | Count | Files Affected | Severity | WCAG | Sample Description |\n`;
  md += `|---|-------------|-------|----------------|----------|------|-------------------|\n`;
  for (let i = 0; i < sortedTypes.length; i++) {
    const [typeKey, data] = sortedTypes[i];
    const v = data.sample;
    const severity = v.severity || v.impact || '-';
    const wcag = v.wcagCriteria || v.criterion || '-';
    const desc = (v.description || v.message || '-').replace(/\|/g, '\\|').substring(0, 100);
    const uniqueFiles = [...new Set(data.files)].length;
    md += `| ${i + 1} | ${typeKey} | ${data.count} | ${uniqueFiles}/${files.length} | ${severity} | ${wcag} | ${desc} |\n`;
  }
  md += `\n`;

  // === SECTION 4: Files with Zero Violations ===
  const cleanFiles = files.filter(f => (f.scanResult.violations || []).length === 0);
  if (cleanFiles.length > 0) {
    md += `## 4. Clean Files (Zero Violations)\n\n`;
    for (const f of cleanFiles) {
      const winPath = `${WIN_BASE}\\${f.relPath.replace(/\//g, '\\\\')}`;
      md += `- **${f.relPath}** — Score: ${f.scanResult.accessibilityScore}% — \`${winPath}\`\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(OUTPUT_PATH, md);
  console.log(`Detailed report written to: ${OUTPUT_PATH}`);
  console.log(`Total violations: ${totalViolations}`);
  console.log(`Unique violation types: ${sortedTypes.length}`);
  console.log(`Clean files: ${cleanFiles.length}/${files.length}`);
}

main();
