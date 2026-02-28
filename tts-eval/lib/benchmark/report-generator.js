import fs from 'fs';
import path from 'path';
import config from '../../config.js';

/**
 * Generate a JSON benchmark report.
 *
 * @param {Object} comparison - Output of compareExtractors()
 * @param {Object} perPaperMetrics - { extractorName: { paperId: metrics, ... }, ... }
 * @returns {string} Path to saved JSON file
 */
export function generateJsonReport(comparison, perPaperMetrics) {
  const report = {
    type: 'multi-extractor-benchmark',
    generatedAt: new Date().toISOString(),
    comparison,
    perPaper: perPaperMetrics,
  };

  const dir = config.paths.outputReports;
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(dir, `benchmark-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

/**
 * Generate a markdown benchmark report.
 *
 * @param {Object} comparison - Output of compareExtractors()
 * @param {Object} perPaperMetrics - { extractorName: { paperId: metrics, ... }, ... }
 * @returns {string} Path to saved markdown file
 */
export function generateMarkdownReport(comparison, perPaperMetrics) {
  const lines = [];

  lines.push('# Multi-Extractor Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${comparison.timestamp}`);
  lines.push('');

  // 1. Summary table
  lines.push('## Summary (sorted by F1)');
  lines.push('');
  lines.push('| Rank | Extractor | Recall | Precision | F1 | ExactMatch | CharAcc | ConvRate | Avg Latency | Avg Cost |');
  lines.push('|------|-----------|--------|-----------|-----|------------|---------|----------|-------------|----------|');

  for (const entry of comparison.ranked) {
    const m = entry.metrics;
    lines.push(
      `| ${entry.rank} | ${entry.name} ` +
      `| ${pct(m.weighted.recall)} | ${pct(m.weighted.precision)} | ${pct(m.weighted.f1)} ` +
      `| ${pct(m.weighted.exactMatchRate)} | ${pct(m.weighted.charAccuracy)} | ${pct(m.weighted.conversionRate)} ` +
      `| ${fmtMs(m.operational.avgLatencyMs)} | ${fmtUsd(m.operational.avgCostUsd)} |`
    );
  }
  lines.push('');

  // 2. Per-tier breakdown
  lines.push('## Per-Tier Recall');
  lines.push('');
  lines.push('| Extractor | Tier 1 | Tier 2 | Tier 3 | Tier 4 |');
  lines.push('|-----------|--------|--------|--------|--------|');

  for (const entry of comparison.ranked) {
    const t = entry.metrics.perTier;
    lines.push(
      `| ${entry.name} ` +
      `| ${tierCell(t[1])} | ${tierCell(t[2])} | ${tierCell(t[3])} | ${tierCell(t[4])} |`
    );
  }
  lines.push('');

  // 3. Per-paper breakdown
  lines.push('## Per-Paper Breakdown');
  lines.push('');

  for (const entry of comparison.ranked) {
    const paperData = perPaperMetrics[entry.name];
    if (!paperData) continue;

    lines.push(`### ${entry.name}`);
    lines.push('');
    lines.push('| Paper | GT | OCR | Matched | Recall | Precision | F1 | CharAcc | Latency |');
    lines.push('|-------|----|-----|---------|--------|-----------|-----|---------|---------|');

    for (const [paperId, pm] of Object.entries(paperData)) {
      lines.push(
        `| ${paperId} | ${pm.counts.gtTotal} | ${pm.counts.ocrTotal} | ${pm.counts.matched} ` +
        `| ${pct(pm.core.recall)} | ${pct(pm.core.precision)} | ${pct(pm.core.f1)} ` +
        `| ${pct(pm.character.charAccuracy)} | ${fmtMs(pm.operational.latencyMs)} |`
      );
    }
    lines.push('');
  }

  // 4. Edit distance distribution
  lines.push('## Edit Distance Distribution');
  lines.push('');
  lines.push('| Extractor | Exact | 1-5 | 6-20 | 21-50 | 50+ |');
  lines.push('|-----------|-------|-----|------|-------|-----|');

  for (const entry of comparison.ranked) {
    const h = entry.metrics.editDistHistogram;
    lines.push(
      `| ${entry.name} | ${h.exact} | ${h['1-5']} | ${h['6-20']} | ${h['21-50']} | ${h['50+']} |`
    );
  }
  lines.push('');

  // 5. Recommendations
  lines.push('## Recommendations');
  lines.push('');
  for (const rec of comparison.recommendations) {
    lines.push(`- ${rec}`);
  }
  lines.push('');

  const markdown = lines.join('\n');

  const dir = config.paths.outputReports;
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(dir, `benchmark-${timestamp}.md`);
  fs.writeFileSync(filePath, markdown);
  return filePath;
}

// Formatting helpers
function pct(v) {
  if (v == null || isNaN(v)) return '-';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtMs(v) {
  if (v == null || isNaN(v)) return '-';
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

function fmtUsd(v) {
  if (v == null || isNaN(v) || v === 0) return 'free';
  return `$${v.toFixed(3)}`;
}

function tierCell(t) {
  if (!t || t.gtCount === 0) return '-';
  return `${pct(t.recall)} (${t.matchedCount}/${t.gtCount})`;
}
