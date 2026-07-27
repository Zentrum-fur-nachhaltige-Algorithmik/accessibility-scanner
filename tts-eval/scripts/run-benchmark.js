#!/usr/bin/env node
/**
 * Compute benchmark metrics and generate comparison reports.
 * Reads cached extraction results and ground-truth formulas,
 * then produces JSON + markdown reports.
 *
 * Usage:
 *   node scripts/run-benchmark.js
 *   node scripts/run-benchmark.js --extractors mistral,pymupdf
 *   node scripts/run-benchmark.js --papers 2303.16681
 */

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { computePaperMetrics, aggregateMetrics, compareExtractors } from '../lib/benchmark/metrics.js';
import { generateJsonReport, generateMarkdownReport } from '../lib/benchmark/report-generator.js';
import { extractFormulas, classifyTier } from '../lib/tex-formula-extractor.js';
import { listExtractors } from '../lib/extractors/registry.js';

async function main() {
  const args = process.argv.slice(2);
  const extractorArg = getArg(args, '--extractors');
  const paperArg = getArg(args, '--papers');

  // Discover papers with ground truth
  let paperIds;
  if (paperArg) {
    paperIds = paperArg.split(',').map(s => s.trim());
  } else {
    paperIds = discoverPapersWithGt();
  }

  if (paperIds.length === 0) {
    console.error('ERROR: No papers with ground truth found.');
    process.exit(1);
  }

  // Discover extractors with cached results
  let extractorNames;
  if (extractorArg) {
    extractorNames = extractorArg.split(',').map(s => s.trim());
  } else {
    extractorNames = discoverCachedExtractors(paperIds);
  }

  if (extractorNames.length === 0) {
    console.error('ERROR: No cached extraction results found. Run run-multi-extract.js first.');
    process.exit(1);
  }

  console.log(`Benchmarking ${extractorNames.length} extractor(s) on ${paperIds.length} paper(s):`);
  console.log(`  Extractors: ${extractorNames.join(', ')}`);
  console.log(`  Papers: ${paperIds.join(', ')}`);
  console.log('');

  // Load ground truth for each paper
  const groundTruths = {};
  for (const paperId of paperIds) {
    const gt = loadGroundTruth(paperId);
    if (gt) {
      groundTruths[paperId] = gt;
      console.log(`  GT loaded: ${paperId} — ${gt.length} formulas`);
    } else {
      console.warn(`  WARN: No ground truth for ${paperId}, skipping.`);
    }
  }

  const validPapers = Object.keys(groundTruths);
  if (validPapers.length === 0) {
    console.error('ERROR: No papers with valid ground truth.');
    process.exit(1);
  }

  // Compute per-paper metrics for each extractor
  const perPaperMetrics = {};
  const aggregates = {};

  for (const extractorName of extractorNames) {
    console.log(`\n=== ${extractorName} ===`);
    perPaperMetrics[extractorName] = {};
    const paperResults = [];

    for (const paperId of validPapers) {
      const cached = loadCachedResult(paperId, extractorName);
      if (!cached) {
        console.warn(`  WARN: No cached result for ${extractorName}/${paperId}, skipping.`);
        continue;
      }

      const gt = groundTruths[paperId];
      const metrics = computePaperMetrics(cached, gt, {
        extractorName,
        latencyMs: cached.metadata?.latencyMs || 0,
        costUsd: cached.metadata?.costUsd || 0,
      });

      perPaperMetrics[extractorName][paperId] = metrics;
      paperResults.push(metrics);

      console.log(
        `  ${paperId}: recall=${(metrics.core.recall * 100).toFixed(1)}% ` +
        `precision=${(metrics.core.precision * 100).toFixed(1)}% ` +
        `F1=${(metrics.core.f1 * 100).toFixed(1)}%`
      );
    }

    if (paperResults.length > 0) {
      aggregates[extractorName] = aggregateMetrics(paperResults);
    }
  }

  if (Object.keys(aggregates).length === 0) {
    console.error('ERROR: No metrics computed. Check cache and ground truth.');
    process.exit(1);
  }

  // Compare and generate reports
  const comparison = compareExtractors(aggregates);
  const jsonPath = generateJsonReport(comparison, perPaperMetrics);
  const mdPath = generateMarkdownReport(comparison, perPaperMetrics);

  console.log('\n=== Reports Generated ===');
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Markdown: ${mdPath}`);
  console.log('');

  // Print summary
  console.log('=== Rankings ===');
  for (const entry of comparison.ranked) {
    console.log(
      `  #${entry.rank} ${entry.name}: ` +
      `F1=${(entry.metrics.weighted.f1 * 100).toFixed(1)}% ` +
      `Recall=${(entry.metrics.weighted.recall * 100).toFixed(1)}% ` +
      `Cost=${entry.metrics.operational.totalCostUsd === 0 ? 'free' : '$' + entry.metrics.operational.totalCostUsd.toFixed(3)}`
    );
  }

  console.log('\nRecommendations:');
  for (const rec of comparison.recommendations) {
    console.log(`  - ${rec}`);
  }
}

function discoverPapersWithGt() {
  const papersDir = config.paths.arxivPapers;
  if (!fs.existsSync(papersDir)) return [];

  return fs.readdirSync(papersDir).filter(dir => {
    const gtPath = path.join(papersDir, dir, 'ground_truth.json');
    if (fs.existsSync(gtPath)) return true;
    // Fall back to .tex source
    const sourceDir = path.join(papersDir, dir, 'source');
    if (fs.existsSync(sourceDir)) {
      return fs.readdirSync(sourceDir).some(f => f.endsWith('.tex'));
    }
    return false;
  });
}

function discoverCachedExtractors(paperIds) {
  const cacheDir = config.paths.cache;
  if (!fs.existsSync(cacheDir)) return [];

  const files = fs.readdirSync(cacheDir);
  const extractorSet = new Set();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const base = file.replace('.json', '');

    for (const paperId of paperIds) {
      // Match ${paperId}_${extractorName} pattern
      if (base.startsWith(paperId + '_')) {
        const extractorName = base.slice(paperId.length + 1);
        // Also match legacy 'ocr' -> 'mistral'
        if (extractorName === 'ocr') {
          extractorSet.add('mistral');
        } else {
          extractorSet.add(extractorName);
        }
      }
    }
  }

  return [...extractorSet];
}

function loadGroundTruth(paperId) {
  // Try ground_truth.json first
  const gtPath = path.join(config.paths.arxivPapers, paperId, 'ground_truth.json');
  if (fs.existsSync(gtPath)) {
    const data = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
    return data.formulas || data;
  }

  // Try extracting from .tex source
  const sourceDir = path.join(config.paths.arxivPapers, paperId, 'source');
  if (fs.existsSync(sourceDir)) {
    const texFiles = fs.readdirSync(sourceDir)
      .filter(f => f.endsWith('.tex'))
      .map(f => path.join(sourceDir, f));

    if (texFiles.length > 0) {
      // Find main tex file
      let mainFile = texFiles[0];
      for (const f of texFiles) {
        const content = fs.readFileSync(f, 'utf-8');
        if (content.includes('\\documentclass')) {
          mainFile = f;
          break;
        }
      }

      const content = fs.readFileSync(mainFile, 'utf-8');
      const formulas = extractFormulas(content, path.basename(mainFile));
      return formulas;
    }
  }

  return null;
}

function loadCachedResult(paperId, extractorName) {
  const cacheDir = config.paths.cache;

  // Try adapter-style cache key
  const adapterPath = path.join(cacheDir, `${paperId}_${extractorName}.json`);
  if (fs.existsSync(adapterPath)) {
    return JSON.parse(fs.readFileSync(adapterPath, 'utf-8'));
  }

  // For mistral, also check legacy cache
  if (extractorName === 'mistral') {
    const legacyPath = path.join(cacheDir, `${paperId}_ocr.json`);
    if (fs.existsSync(legacyPath)) {
      return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
    }
  }

  return null;
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
