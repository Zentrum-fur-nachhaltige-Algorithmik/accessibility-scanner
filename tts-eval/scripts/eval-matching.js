#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { matchSequential, matchHungarian } from '../lib/formula-matcher.js';

console.log('=== Formula Matching Evaluation ===\n');

const papersDir = config.paths.arxivPapers;
const paperDirs = fs.readdirSync(papersDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const results = [];

for (const paperId of paperDirs) {
  const gtPath = path.join(papersDir, paperId, 'formulas_gt.json');
  const ocrPath = path.join(papersDir, paperId, 'ocr_output.json');

  if (!fs.existsSync(gtPath) || !fs.existsSync(ocrPath)) continue;

  const gt = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
  const ocr = JSON.parse(fs.readFileSync(ocrPath, 'utf-8'));

  console.log(`\n${paperId}: GT=${gt.totalFormulas} OCR=${ocr.totalFormulas}`);

  // Run both strategies
  console.log('  Running sequential matching...');
  const startSeq = Date.now();
  const seqResult = matchSequential(gt.formulas, ocr.formulas);
  const seqTime = Date.now() - startSeq;

  console.log(`  Sequential: ${seqResult.matched.length} matched, ` +
    `avg sim=${seqResult.stats.avgSimilarity.toFixed(3)}, ${seqTime}ms`);
  console.log(`    Unmatched GT: ${seqResult.unmatchedGt.length}, Unmatched OCR: ${seqResult.unmatchedOcr.length}`);

  console.log('  Running Hungarian matching...');
  const startHun = Date.now();
  const hunResult = matchHungarian(gt.formulas, ocr.formulas);
  const hunTime = Date.now() - startHun;

  console.log(`  Hungarian: ${hunResult.matched.length} matched, ` +
    `avg sim=${hunResult.stats.avgSimilarity.toFixed(3)}, ${hunTime}ms`);
  console.log(`    Unmatched GT: ${hunResult.unmatchedGt.length}, Unmatched OCR: ${hunResult.unmatchedOcr.length}`);

  // Compare
  const seqRecall = (seqResult.matched.length / gt.totalFormulas * 100).toFixed(1);
  const hunRecall = (hunResult.matched.length / gt.totalFormulas * 100).toFixed(1);
  const winner = hunResult.matched.length > seqResult.matched.length ? 'hungarian' :
    seqResult.matched.length > hunResult.matched.length ? 'sequential' : 'tie';

  console.log(`  Recall: sequential=${seqRecall}%, hungarian=${hunRecall}% → ${winner} wins`);

  // Show some match examples
  const bestMatches = hunResult.matched
    .filter(m => m.similarity > 0.8)
    .slice(0, 3);
  if (bestMatches.length > 0) {
    console.log('  Good matches:');
    for (const m of bestMatches) {
      console.log(`    sim=${m.similarity.toFixed(2)} GT: ${m.gtLatex.substring(0, 50)}`);
      console.log(`                  OCR: ${m.ocrLatex.substring(0, 50)}`);
    }
  }

  // Show similarity distribution
  const simBuckets = { exact: 0, high: 0, medium: 0, low: 0 };
  for (const m of hunResult.matched) {
    if (m.similarity >= 0.95) simBuckets.exact++;
    else if (m.similarity >= 0.8) simBuckets.high++;
    else if (m.similarity >= 0.5) simBuckets.medium++;
    else simBuckets.low++;
  }
  console.log(`  Similarity distribution: exact(≥0.95)=${simBuckets.exact}, ` +
    `high(≥0.8)=${simBuckets.high}, medium(≥0.5)=${simBuckets.medium}, low(<0.5)=${simBuckets.low}`);

  results.push({
    paperId,
    gtCount: gt.totalFormulas,
    ocrCount: ocr.totalFormulas,
    sequential: {
      matched: seqResult.matched.length,
      avgSimilarity: seqResult.stats.avgSimilarity,
      unmatchedGt: seqResult.unmatchedGt.length,
      unmatchedOcr: seqResult.unmatchedOcr.length,
      timeMs: seqTime,
    },
    hungarian: {
      matched: hunResult.matched.length,
      avgSimilarity: hunResult.stats.avgSimilarity,
      unmatchedGt: hunResult.unmatchedGt.length,
      unmatchedOcr: hunResult.unmatchedOcr.length,
      timeMs: hunTime,
      simDistribution: simBuckets,
    },
    winner,
  });
}

// Summary
console.log('\n=== Summary ===');
for (const r of results) {
  console.log(`${r.paperId}: seq=${r.sequential.matched}/${r.gtCount} hun=${r.hungarian.matched}/${r.gtCount} → ${r.winner}`);
}

// Write report
const reportDir = config.paths.outputReports;
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'matching-eval.json');
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\nReport saved: ${reportPath}`);
