#!/usr/bin/env node
/**
 * Run selected extractors on all available papers, caching results.
 *
 * Usage:
 *   node scripts/run-multi-extract.js --extractors mistral,pymupdf
 *   node scripts/run-multi-extract.js --extractors all
 *   node scripts/run-multi-extract.js --extractors mistral --papers 2303.16681
 */

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { getExtractor, getAvailableExtractors, listExtractors } from '../lib/extractors/registry.js';

async function main() {
  const args = process.argv.slice(2);
  const extractorArg = getArg(args, '--extractors') || config.extractors.default;
  const paperArg = getArg(args, '--papers');

  // Resolve extractor names
  let extractorNames;
  if (extractorArg === 'all') {
    const available = await getAvailableExtractors();
    extractorNames = available.map(a => a.name);
    console.log(`Available extractors: ${extractorNames.join(', ')}`);
  } else {
    extractorNames = extractorArg.split(',').map(s => s.trim());
    // Validate names
    const known = listExtractors();
    for (const name of extractorNames) {
      if (!known.includes(name)) {
        console.error(`ERROR: Unknown extractor "${name}". Known: ${known.join(', ')}`);
        process.exit(1);
      }
    }
  }

  // Resolve paper IDs
  let paperIds;
  if (paperArg) {
    paperIds = paperArg.split(',').map(s => s.trim());
  } else {
    paperIds = discoverPapers();
  }

  if (paperIds.length === 0) {
    console.error('ERROR: No papers found. Run download-papers.js first.');
    process.exit(1);
  }

  console.log(`\nRunning ${extractorNames.length} extractor(s) on ${paperIds.length} paper(s):`);
  console.log(`  Extractors: ${extractorNames.join(', ')}`);
  console.log(`  Papers: ${paperIds.join(', ')}`);
  console.log('');

  const results = {};

  for (const extractorName of extractorNames) {
    console.log(`\n=== ${extractorName} ===`);
    results[extractorName] = {};

    let extractor;
    try {
      extractor = await getExtractor(extractorName);
    } catch (err) {
      console.error(`  ERROR: Failed to load ${extractorName}: ${err.message}`);
      continue;
    }

    if (!extractor.isAvailable()) {
      console.warn(`  WARN: ${extractorName} is not available (missing deps/API keys). Skipping.`);
      continue;
    }

    for (const paperId of paperIds) {
      const pdfPath = path.join(config.paths.arxivPapers, paperId, 'paper.pdf');
      if (!fs.existsSync(pdfPath)) {
        console.warn(`  WARN: PDF not found for ${paperId}, skipping.`);
        continue;
      }

      try {
        const result = await extractor.extractWithCache(paperId, pdfPath);
        results[extractorName][paperId] = {
          pages: result.pages.length,
          latencyMs: result.metadata.latencyMs,
          cached: result.metadata.cached,
        };
        console.log(
          `  ${paperId}: ${result.pages.length} pages, ` +
          `${result.metadata.cached ? 'cached' : result.metadata.latencyMs + 'ms'}`
        );
      } catch (err) {
        console.error(`  ERROR: ${paperId} failed: ${err.message}`);
        results[extractorName][paperId] = { error: err.message };
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(results, null, 2));
}

function discoverPapers() {
  const papersDir = config.paths.arxivPapers;
  if (!fs.existsSync(papersDir)) return [];

  return fs.readdirSync(papersDir).filter(dir => {
    const metaPath = path.join(papersDir, dir, 'metadata.json');
    const pdfPath = path.join(papersDir, dir, 'paper.pdf');
    return fs.existsSync(metaPath) && fs.existsSync(pdfPath);
  });
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
