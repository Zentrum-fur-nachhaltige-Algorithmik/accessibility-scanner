#!/usr/bin/env node
/**
 * Download formula-density-stratified papers to expand the benchmark corpus.
 *
 * Tiers:
 *   Low:    10-50 formulas   (3 papers) — cs.CL, econ.TH
 *   Medium: 100-300 formulas (4 papers) — stat.ML, math.CO
 *   High:   500+ formulas    (3 papers) — math.RA, hep-th
 *
 * Uses existing arxiv-downloader.js + tex-formula-extractor.js.
 *
 * Usage:
 *   node scripts/expand-corpus.js
 *   node scripts/expand-corpus.js --dry-run     # preview without downloading
 *   node scripts/expand-corpus.js --tier high    # download only high-density
 */

import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { queryArxiv, downloadAndValidatePaper } from '../lib/arxiv-downloader.js';
import { extractFormulas } from '../lib/tex-formula-extractor.js';

const TIER_CONFIG = {
  low: {
    min: config.corpus.densityTiers.low.min,
    max: config.corpus.densityTiers.low.max,
    target: config.corpus.targetPerTier,
    categories: ['cs.CL', 'econ.TH', 'cs.IR'],
  },
  medium: {
    min: config.corpus.densityTiers.medium.min,
    max: config.corpus.densityTiers.medium.max,
    target: config.corpus.targetPerTier + 1, // 4 papers
    categories: ['stat.ML', 'math.CO', 'cs.LG'],
  },
  high: {
    min: config.corpus.densityTiers.high.min,
    max: Infinity,
    target: config.corpus.targetPerTier,
    categories: ['math.RA', 'hep-th', 'math.AP'],
  },
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tierFilter = getArg(args, '--tier');

  const tiers = tierFilter ? { [tierFilter]: TIER_CONFIG[tierFilter] } : TIER_CONFIG;

  if (!tiers || (tierFilter && !TIER_CONFIG[tierFilter])) {
    console.error(`ERROR: Unknown tier "${tierFilter}". Use: low, medium, high`);
    process.exit(1);
  }

  // Check existing papers
  const existingPapers = discoverExistingPapers();
  console.log(`Existing papers: ${existingPapers.length}`);

  const results = { downloaded: [], skipped: [], failed: [] };

  for (const [tierName, tierCfg] of Object.entries(tiers)) {
    console.log(`\n=== Tier: ${tierName} (${tierCfg.min}-${tierCfg.max === Infinity ? '∞' : tierCfg.max} formulas) ===`);
    console.log(`  Target: ${tierCfg.target} papers from ${tierCfg.categories.join(', ')}`);

    let downloaded = 0;

    for (const category of tierCfg.categories) {
      if (downloaded >= tierCfg.target) break;

      console.log(`\n  Searching ${category}...`);

      let papers;
      try {
        papers = await queryArxiv(category, 30);
      } catch (err) {
        console.error(`  ERROR: arXiv query failed for ${category}: ${err.message}`);
        continue;
      }

      console.log(`  Found ${papers.length} candidates`);

      for (const paper of papers) {
        if (downloaded >= tierCfg.target) break;

        const arxivId = paper.id;

        // Skip if already downloaded
        if (existingPapers.includes(arxivId)) {
          console.log(`  ${arxivId}: already downloaded, skipping`);
          results.skipped.push(arxivId);
          continue;
        }

        if (dryRun) {
          console.log(`  ${arxivId}: ${paper.title} [DRY RUN]`);
          continue;
        }

        try {
          const result = await downloadAndValidatePaper(arxivId, paper.title);
          if (!result) {
            console.log(`  ${arxivId}: validation failed (formula count or page count), skipping`);
            continue;
          }

          // Check if formula count matches tier
          const formulaCount = result.formulaCount || 0;
          if (formulaCount >= tierCfg.min && formulaCount <= tierCfg.max) {
            console.log(`  ${arxivId}: ${formulaCount} formulas — matches ${tierName} tier`);
            results.downloaded.push({ id: arxivId, tier: tierName, formulas: formulaCount });
            downloaded++;
          } else {
            console.log(`  ${arxivId}: ${formulaCount} formulas — outside ${tierName} range, skipping`);
          }
        } catch (err) {
          console.error(`  ERROR: ${arxivId}: ${err.message}`);
          results.failed.push({ id: arxivId, error: err.message });
        }

        // Rate limiting: 3s between arXiv requests
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log(`\n  ${tierName} tier: ${downloaded}/${tierCfg.target} papers downloaded`);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Downloaded: ${results.downloaded.length}`);
  console.log(`  Skipped: ${results.skipped.length}`);
  console.log(`  Failed: ${results.failed.length}`);

  if (results.downloaded.length > 0) {
    console.log('\n  New papers:');
    for (const p of results.downloaded) {
      console.log(`    ${p.id}: ${p.formulas} formulas (${p.tier})`);
    }
  }

  // Write manifest
  const manifestPath = path.join(config.paths.data, 'corpus-manifest.json');
  const allPapers = [...discoverExistingPapersWithMetadata(), ...results.downloaded];
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalPapers: allPapers.length,
    papers: allPapers,
  }, null, 2));
  console.log(`\n  Manifest: ${manifestPath}`);
}

function discoverExistingPapers() {
  const papersDir = config.paths.arxivPapers;
  if (!fs.existsSync(papersDir)) return [];
  return fs.readdirSync(papersDir).filter(dir => {
    return fs.existsSync(path.join(papersDir, dir, 'metadata.json'));
  });
}

function discoverExistingPapersWithMetadata() {
  const papersDir = config.paths.arxivPapers;
  if (!fs.existsSync(papersDir)) return [];

  return discoverExistingPapers().map(id => {
    const metaPath = path.join(papersDir, id, 'metadata.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      return {
        id,
        tier: categorizeTier(meta.formulaCount || 0),
        formulas: meta.formulaCount || 0,
      };
    } catch {
      return { id, tier: 'unknown', formulas: 0 };
    }
  });
}

function categorizeTier(count) {
  if (count >= config.corpus.densityTiers.high.min) return 'high';
  if (count >= config.corpus.densityTiers.medium.min) return 'medium';
  if (count >= config.corpus.densityTiers.low.min) return 'low';
  return 'sparse';
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
