#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { convertWithTemml } from '../lib/mathml-converter.js';

console.log('=== Converter Evaluation ===\n');

const papersDir = config.paths.arxivPapers;
const paperDirs = fs.readdirSync(papersDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

// Aggregate stats
const stats = {
  total: 0,
  temmlSuccess: 0,
  temmlFailure: 0,
  fallbackSuccess: 0,
  fallbackFailure: 0,
  byTier: {
    1: { total: 0, temmlOk: 0, fallbackOk: 0, failed: 0 },
    2: { total: 0, temmlOk: 0, fallbackOk: 0, failed: 0 },
    3: { total: 0, temmlOk: 0, fallbackOk: 0, failed: 0 },
    4: { total: 0, temmlOk: 0, fallbackOk: 0, failed: 0 },
  },
  byType: {
    inline: { total: 0, temmlOk: 0, failed: 0 },
    display: { total: 0, temmlOk: 0, failed: 0 },
  },
  failures: [],
  sampleSuccesses: [],
};

import { execSync } from 'child_process';

// Check Python fallback availability
let latex2mathmlAvailable = false;
try {
  execSync('python3 -c "import latex2mathml"', { encoding: 'utf-8', timeout: 5000 });
  latex2mathmlAvailable = true;
  console.log('Python latex2mathml: available\n');
} catch {
  console.log('Python latex2mathml: NOT available (fallback disabled)\n');
}

function tryLatex2mathmlSync(latex) {
  if (!latex2mathmlAvailable) return null;
  try {
    const escaped = latex.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const result = execSync(
      `python3 -c "import latex2mathml.converter; print(latex2mathml.converter.convert('${escaped}'))"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const mathml = result.trim();
    if (mathml && mathml.includes('<math')) return mathml;
    return null;
  } catch {
    return null;
  }
}

for (const paperId of paperDirs) {
  const gtPath = path.join(papersDir, paperId, 'formulas_gt.json');
  if (!fs.existsSync(gtPath)) continue;

  const gt = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
  console.log(`Processing ${paperId}: ${gt.totalFormulas} formulas`);

  let paperTemmlOk = 0;
  let paperFallbackOk = 0;
  let paperFailed = 0;

  for (const formula of gt.formulas) {
    stats.total++;
    const tier = formula.tier;
    const type = formula.type;
    stats.byTier[tier].total++;
    stats.byType[type].total++;

    const displayMode = type === 'display';

    // Try temml first
    const result = convertWithTemml(formula.latex, displayMode);

    if (result.mathml) {
      stats.temmlSuccess++;
      stats.byTier[tier].temmlOk++;
      stats.byType[type].temmlOk++;
      paperTemmlOk++;

      // Save a few samples
      if (stats.sampleSuccesses.length < 10) {
        stats.sampleSuccesses.push({
          latex: formula.latex.substring(0, 100),
          tier,
          mathmlLength: result.mathml.length,
        });
      }
    } else {
      stats.temmlFailure++;

      // Try fallback
      const fallbackMathml = tryLatex2mathmlSync(formula.latex);
      if (fallbackMathml) {
        stats.fallbackSuccess++;
        stats.byTier[tier].fallbackOk++;
        paperFallbackOk++;
      } else {
        stats.fallbackFailure++;
        stats.byTier[tier].failed++;
        stats.byType[type].failed++;
        paperFailed++;

        stats.failures.push({
          paperId,
          index: formula.index,
          tier,
          type,
          latex: formula.latex.substring(0, 200),
          temmlError: result.error,
        });
      }
    }
  }

  const paperTotal = gt.totalFormulas;
  const temmlPct = ((paperTemmlOk / paperTotal) * 100).toFixed(1);
  const fallbackPct = ((paperFallbackOk / paperTotal) * 100).toFixed(1);
  const failedPct = ((paperFailed / paperTotal) * 100).toFixed(1);
  console.log(`  temml: ${paperTemmlOk}/${paperTotal} (${temmlPct}%), fallback: ${paperFallbackOk} (${fallbackPct}%), failed: ${paperFailed} (${failedPct}%)`);
}

// Compute summary stats
const totalConverted = stats.temmlSuccess + stats.fallbackSuccess;
const conversionRate = ((totalConverted / stats.total) * 100).toFixed(1);
const temmlRate = ((stats.temmlSuccess / stats.total) * 100).toFixed(1);
const fallbackRate = ((stats.fallbackSuccess / stats.total) * 100).toFixed(1);
const failureRate = ((stats.fallbackFailure / stats.total) * 100).toFixed(1);

console.log('\n=== Summary ===');
console.log(`Total formulas: ${stats.total}`);
console.log(`temml success: ${stats.temmlSuccess} (${temmlRate}%)`);
console.log(`Fallback success: ${stats.fallbackSuccess} (${fallbackRate}%)`);
console.log(`Total converted: ${totalConverted} (${conversionRate}%)`);
console.log(`Total failed: ${stats.fallbackFailure} (${failureRate}%)`);

console.log('\n--- By Tier ---');
for (const [tier, data] of Object.entries(stats.byTier)) {
  if (data.total === 0) continue;
  const pct = (((data.temmlOk + data.fallbackOk) / data.total) * 100).toFixed(1);
  console.log(`  Tier ${tier}: ${data.total} total, temml=${data.temmlOk}, fallback=${data.fallbackOk}, failed=${data.failed} (${pct}% converted)`);
}

console.log('\n--- By Type ---');
for (const [type, data] of Object.entries(stats.byType)) {
  if (data.total === 0) continue;
  const pct = ((data.temmlOk / data.total) * 100).toFixed(1);
  console.log(`  ${type}: ${data.total} total, temml=${data.temmlOk} (${pct}%), failed=${data.failed}`);
}

// Check against thresholds
console.log('\n--- Viability Check ---');
const convSuccessTarget = config.thresholds.conversionSuccessTarget * 100;
const totalLossMax = config.thresholds.totalLossMax * 100;
const passed = parseFloat(conversionRate) >= convSuccessTarget && parseFloat(failureRate) <= totalLossMax;

console.log(`Conversion success: ${conversionRate}% (target: ≥${convSuccessTarget}%) ${parseFloat(conversionRate) >= convSuccessTarget ? 'PASS' : 'FAIL'}`);
console.log(`Total loss: ${failureRate}% (target: ≤${totalLossMax}%) ${parseFloat(failureRate) <= totalLossMax ? 'PASS' : 'FAIL'}`);
console.log(`Overall: ${passed ? 'VIABLE' : 'NEEDS IMPROVEMENT'}`);

// Show first 20 failures
if (stats.failures.length > 0) {
  console.log(`\n--- Sample Failures (${Math.min(20, stats.failures.length)} of ${stats.failures.length}) ---`);
  for (const f of stats.failures.slice(0, 20)) {
    console.log(`  [T${f.tier}/${f.type}] ${f.latex.substring(0, 80)}`);
    console.log(`    Error: ${f.temmlError}`);
  }
}

// Write full report
const report = {
  total: stats.total,
  temmlSuccess: stats.temmlSuccess,
  temmlFailure: stats.temmlFailure,
  fallbackSuccess: stats.fallbackSuccess,
  fallbackFailure: stats.fallbackFailure,
  conversionRate: parseFloat(conversionRate),
  byTier: stats.byTier,
  byType: stats.byType,
  failures: stats.failures,
  sampleSuccesses: stats.sampleSuccesses,
  thresholds: config.thresholds,
  evaluatedAt: new Date().toISOString(),
};

const reportDir = config.paths.outputReports;
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'converter-eval.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport saved: ${reportPath}`);
