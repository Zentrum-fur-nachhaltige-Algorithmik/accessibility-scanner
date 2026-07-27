#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { runPipeline } from '../lib/pipeline.js';

console.log('=== End-to-End Pipeline ===\n');

const papersDir = config.paths.arxivPapers;
const paperDirs = fs.readdirSync(papersDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

if (paperDirs.length === 0) {
  console.error('ERROR: No papers found. Run download-papers.js first.');
  process.exit(1);
}

const results = [];

for (const paperId of paperDirs) {
  try {
    const result = await runPipeline(paperId);
    results.push(result);
  } catch (err) {
    console.error(`  ERROR processing ${paperId}: ${err.message}`);
  }
}

console.log('\n=== Pipeline Summary ===');
let totalFormulas = 0;
let totalConverted = 0;
let totalFailed = 0;

for (const r of results) {
  console.log(`${r.paperId}: ${r.formulaStats.total} formulas, ${r.formulaStats.converted} converted, ${r.formulaStats.failed} failed`);
  console.log(`  Output: ${r.outputPath}`);
  totalFormulas += r.formulaStats.total;
  totalConverted += r.formulaStats.converted;
  totalFailed += r.formulaStats.failed;
}

const convRate = totalFormulas > 0 ? ((totalConverted / totalFormulas) * 100).toFixed(1) : 0;
console.log(`\nTotal: ${totalFormulas} formulas, ${totalConverted} converted (${convRate}%), ${totalFailed} failed`);
