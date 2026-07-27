#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { processArxivPaper } from '../lib/mistral-ocr.js';
import { extractFromOcrResult } from '../lib/formula-extractor.js';

console.log('=== Mistral OCR Pipeline ===\n');

if (!config.mistral.apiKey) {
  console.error('ERROR: MISTRAL_API_KEY not set.');
  console.error('Set it via: export MISTRAL_API_KEY=your_key_here');
  process.exit(1);
}

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
  const metadataPath = path.join(papersDir, paperId, 'metadata.json');
  if (!fs.existsSync(metadataPath)) continue;

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log(`Processing ${paperId}: ${metadata.title}`);

  try {
    // Run OCR
    const ocrResult = await processArxivPaper(paperId);

    // Extract formulas from OCR output
    const extraction = extractFromOcrResult(ocrResult);

    // Save OCR output with extracted formulas
    const output = {
      paperId,
      title: metadata.title,
      ocrPages: ocrResult.pages.length,
      ocrLatencyMs: ocrResult.latencyMs,
      ocrModel: ocrResult.model,
      totalFormulas: extraction.totalFormulas,
      formulasByType: extraction.byType,
      formulas: extraction.formulas,
      processedAt: new Date().toISOString(),
    };

    const outPath = path.join(papersDir, paperId, 'ocr_output.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

    console.log(`  Pages: ${ocrResult.pages.length}`);
    console.log(`  Formulas: ${extraction.totalFormulas} (${extraction.byType.inline} inline, ${extraction.byType.display} display)`);
    console.log(`  Latency: ${(ocrResult.latencyMs / 1000).toFixed(1)}s`);
    console.log(`  Saved: ${outPath}\n`);

    results.push({
      paperId,
      pages: ocrResult.pages.length,
      formulas: extraction.totalFormulas,
      latencyMs: ocrResult.latencyMs,
    });

    // Rate limit between papers
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    console.error(`  ERROR: ${err.message}\n`);
  }
}

// Compare with ground truth
console.log('=== OCR vs Ground Truth ===');
for (const r of results) {
  const gtPath = path.join(papersDir, r.paperId, 'formulas_gt.json');
  if (!fs.existsSync(gtPath)) continue;
  const gt = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
  const recall = ((r.formulas / gt.totalFormulas) * 100).toFixed(1);
  console.log(`  ${r.paperId}: OCR=${r.formulas} GT=${gt.totalFormulas} (recall proxy: ${recall}%)`);
}
