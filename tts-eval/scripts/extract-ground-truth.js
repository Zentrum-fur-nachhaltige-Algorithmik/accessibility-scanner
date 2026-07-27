#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { processTexFiles, cleanFormula } from '../lib/tex-formula-extractor.js';
import { findMainTexFile } from '../lib/arxiv-downloader.js';

console.log('=== Ground Truth Extraction ===\n');

const papersDir = config.paths.arxivPapers;
const paperDirs = fs.readdirSync(papersDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

if (paperDirs.length === 0) {
  console.error('ERROR: No papers found. Run download-papers.js first.');
  process.exit(1);
}

let totalFormulas = 0;
const summary = [];

for (const paperId of paperDirs) {
  const paperDir = path.join(papersDir, paperId);
  const metadataPath = path.join(paperDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    console.log(`  SKIP: ${paperId} (no metadata.json)`);
    continue;
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log(`Processing ${paperId}: ${metadata.title}`);

  // Find .tex files
  const sourceDir = path.join(paperDir, 'source');
  if (!fs.existsSync(sourceDir)) {
    console.log(`  SKIP: No source directory`);
    continue;
  }

  const texFiles = findTexFilesRecursive(sourceDir);
  if (texFiles.length === 0) {
    console.log(`  SKIP: No .tex files`);
    continue;
  }

  const mainFile = findMainTexFile(texFiles);
  console.log(`  Main file: ${path.basename(mainFile)}`);
  console.log(`  Total .tex files: ${texFiles.length}`);

  // Extract formulas
  const result = processTexFiles(texFiles, mainFile);

  // Clean formulas
  for (const f of result.formulas) {
    f.latex = cleanFormula(f.latex);
  }

  // Filter out empty/trivial formulas
  result.formulas = result.formulas.filter(f => f.latex.length > 0);
  result.totalFormulas = result.formulas.length;

  // Re-count tiers
  result.tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const f of result.formulas) {
    result.tierCounts[f.tier]++;
  }

  // Build output
  const output = {
    paperId,
    title: metadata.title,
    totalFormulas: result.totalFormulas,
    formulas: result.formulas.map(f => ({
      index: f.index,
      type: f.type,
      latex: f.latex,
      latexOriginal: f.latexOriginal !== f.latex ? f.latexOriginal : undefined,
      tier: f.tier,
      lineNumber: f.lineNumber,
      context: f.context,
    })),
    customMacros: result.customMacros,
    tierCounts: result.tierCounts,
    extractedAt: new Date().toISOString(),
  };

  const outPath = path.join(paperDir, 'formulas_gt.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`  Total formulas: ${result.totalFormulas}`);
  console.log(`  Tiers: T1=${result.tierCounts[1]} T2=${result.tierCounts[2]} T3=${result.tierCounts[3]} T4=${result.tierCounts[4]}`);
  console.log(`  Display: ${result.formulas.filter(f => f.type === 'display').length}`);
  console.log(`  Inline: ${result.formulas.filter(f => f.type === 'inline').length}`);
  console.log(`  Saved: ${outPath}\n`);

  totalFormulas += result.totalFormulas;
  summary.push({
    paperId,
    total: result.totalFormulas,
    tierCounts: result.tierCounts,
  });
}

console.log('=== Summary ===');
console.log(`Total papers: ${summary.length}`);
console.log(`Total formulas: ${totalFormulas}`);
for (const s of summary) {
  console.log(`  ${s.paperId}: ${s.total} formulas (T1=${s.tierCounts[1]} T2=${s.tierCounts[2]} T3=${s.tierCounts[3]} T4=${s.tierCounts[4]})`);
}

function findTexFilesRecursive(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTexFilesRecursive(fullPath));
    } else if (entry.name.endsWith('.tex')) {
      results.push(fullPath);
    }
  }
  return results;
}
