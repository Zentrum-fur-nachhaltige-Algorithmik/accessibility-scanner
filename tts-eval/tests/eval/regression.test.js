import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getPaperIds, loadPaperGt, loadPaperOcr, loadPaperCachedOcr, loadPaperMetadata } from '../helpers/load-paper-data.js';
import { matchHungarian, matchSequential } from '../../lib/formula-matcher.js';
import { convertToMathml } from '../../lib/mathml-converter.js';
import { assembleHtml } from '../../lib/html-assembler.js';
import config from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(__dirname, '..', 'baselines', 'regression-baseline.json');
const isBaselineUpdate = process.env.BASELINE_UPDATE === '1';

// Check scipy
let hasScipy = false;
try {
  execSync('python3 -c "from scipy.optimize import linear_sum_assignment"', {
    encoding: 'utf-8',
    timeout: 5000,
  });
  hasScipy = true;
} catch { /* unavailable */ }

const paperIds = getPaperIds();

/**
 * Compute comprehensive metrics for a paper.
 */
function computeMetrics(paperId) {
  const gt = loadPaperGt(paperId);
  const ocr = loadPaperOcr(paperId);
  const ocrCached = loadPaperCachedOcr(paperId);
  const metadata = loadPaperMetadata(paperId);

  // Matching
  const gtFormulas = gt.formulas.map(f => ({ latex: f.latex }));
  const ocrFormulas = ocr.formulas.map(f => ({ latex: f.latex }));
  const matchResult = hasScipy
    ? matchHungarian(gtFormulas, ocrFormulas)
    : matchSequential(gtFormulas, ocrFormulas);

  const recall = gt.formulas.length > 0
    ? matchResult.matched.length / gt.formulas.length
    : 1;

  // Conversion
  let temmlSuccess = 0;
  let cascadeSuccess = 0;
  let cascadeFailed = 0;
  const tierConversion = {};

  for (const f of gt.formulas) {
    const result = convertToMathml(f.latex, f.type === 'display');
    const tier = f.tier;
    if (!tierConversion[tier]) tierConversion[tier] = { total: 0, success: 0 };
    tierConversion[tier].total++;

    if (result.mathml) {
      cascadeSuccess++;
      tierConversion[tier].success++;
      if (result.fallbackLevel === 0) temmlSuccess++;
    } else {
      cascadeFailed++;
    }
  }

  const total = gt.formulas.length;
  const conversionRate = total > 0 ? cascadeSuccess / total : 1;
  const lossRate = total > 0 ? cascadeFailed / total : 0;
  const fallbackCoverage = total > 0 ? (cascadeSuccess) / total : 1;

  // HTML assembly
  const { formulaStats } = assembleHtml(ocrCached, metadata.title);

  // Per-tier rates
  const tierRates = {};
  for (const [tier, stats] of Object.entries(tierConversion)) {
    tierRates[tier] = stats.total > 0 ? stats.success / stats.total : 1;
  }

  return {
    paperId,
    recall,
    conversionRate,
    lossRate,
    fallbackCoverage,
    cascadeFailed,
    tierRates,
    formulaStats,
    totalFormulas: total,
    matched: matchResult.matched.length,
  };
}

describe.skipIf(paperIds.length === 0)('regression testing', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  let allMetrics;
  const getMetrics = (() => {
    let done = false;
    return () => {
      if (done) return;
      allMetrics = {};
      for (const id of paperIds) {
        allMetrics[id] = computeMetrics(id);
      }
      done = true;
    };
  })();

  // Write baseline if BASELINE_UPDATE=1
  afterAll(() => {
    if (isBaselineUpdate && allMetrics) {
      const baseline = {
        generatedAt: new Date().toISOString(),
        papers: allMetrics,
      };
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
      console.log(`\nBaseline written to: ${baselinePath}`);
    }
  });

  describe('threshold-based regression', () => {
    it.each(paperIds)('%s: recall > 0 (OCR-dependent)', (paperId) => {
      getMetrics();
      // OCR recall varies by paper and Mistral model quality.
      // Assert basic sanity rather than a fixed threshold.
      console.log(`  [${paperId}] OCR recall: ${(100 * allMetrics[paperId].recall).toFixed(1)}%`);
      expect(allMetrics[paperId].matched).toBeGreaterThan(0);
    });

    it.each(paperIds)('%s: conversion rate >= 80%%', (paperId) => {
      getMetrics();
      expect(allMetrics[paperId].conversionRate).toBeGreaterThanOrEqual(0.80);
    });

    it.each(paperIds)('%s: fallback coverage >= 95%%', (paperId) => {
      getMetrics();
      expect(allMetrics[paperId].fallbackCoverage).toBeGreaterThanOrEqual(0.95);
    });

    it.each(paperIds)('%s: loss <= 2%%', (paperId) => {
      getMetrics();
      expect(allMetrics[paperId].lossRate).toBeLessThanOrEqual(0.02);
    });
  });

  describe('delta-based regression', () => {
    let baseline;
    let hasBaseline = false;

    try {
      if (fs.existsSync(baselinePath)) {
        baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
        hasBaseline = true;
      }
    } catch { /* no baseline yet */ }

    describe.skipIf(!hasBaseline || isBaselineUpdate)('vs baseline', () => {
      it.each(paperIds)('%s: conversion rate no more than 2%% worse', (paperId) => {
        getMetrics();
        const current = allMetrics[paperId];
        const prev = baseline.papers[paperId];
        if (!prev) return; // New paper, no baseline to compare
        expect(current.conversionRate).toBeGreaterThanOrEqual(prev.conversionRate - 0.02);
      });

      it.each(paperIds)('%s: failures no more than +5', (paperId) => {
        getMetrics();
        const current = allMetrics[paperId];
        const prev = baseline.papers[paperId];
        if (!prev) return;
        expect(current.cascadeFailed).toBeLessThanOrEqual(prev.cascadeFailed + 5);
      });

      it.each(paperIds)('%s: per-tier rates no more than 5%% worse', (paperId) => {
        getMetrics();
        const current = allMetrics[paperId];
        const prev = baseline.papers[paperId];
        if (!prev) return;

        for (const [tier, rate] of Object.entries(current.tierRates)) {
          const prevRate = prev.tierRates?.[tier];
          if (prevRate !== undefined) {
            expect(rate).toBeGreaterThanOrEqual(prevRate - 0.05);
          }
        }
      });
    });
  });
});
