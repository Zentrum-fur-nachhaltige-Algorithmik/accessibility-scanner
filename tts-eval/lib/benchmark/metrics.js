import { matchHungarian, similarity, normalizeLatex } from '../formula-matcher.js';
import { extractFromOcrResult } from '../formula-extractor.js';
import { convertToMathml } from '../mathml-converter.js';
import { classifyTier } from '../tex-formula-extractor.js';

/**
 * Compute edit distance between two normalized LaTeX strings.
 * Returns the raw Levenshtein distance (not normalized).
 */
function editDistance(a, b) {
  const na = normalizeLatex(a);
  const nb = normalizeLatex(b);
  if (na === nb) return 0;
  const n = na.length;
  const m = nb.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[n][m];
}

/**
 * Compute comprehensive metrics for a single paper: one extractor vs ground truth.
 *
 * @param {Object} extractorResult - { pages: [{ pageIndex, markdown }] } from extractor
 * @param {Array} gtFormulas - Ground truth formulas from tex-formula-extractor
 * @param {Object} options - { extractorName, latencyMs, costUsd }
 * @returns {Object} Full metrics object
 */
export function computePaperMetrics(extractorResult, gtFormulas, options = {}) {
  // Extract formulas from the extractor's output
  const ocrExtracted = extractFromOcrResult(extractorResult);
  const ocrFormulas = ocrExtracted.formulas;

  // Match using Hungarian algorithm
  const matchResult = matchHungarian(gtFormulas, ocrFormulas);

  // Core metrics
  const totalGt = gtFormulas.length;
  const totalOcr = ocrFormulas.length;
  const totalMatched = matchResult.matched.length;

  const recall = totalGt > 0 ? totalMatched / totalGt : 0;
  const precision = totalOcr > 0 ? totalMatched / totalOcr : 0;
  const f1 = (recall + precision) > 0 ? 2 * recall * precision / (recall + precision) : 0;

  // Character-level metrics on matched pairs
  const similarities = matchResult.matched.map(m => m.similarity);
  const charAccuracy = similarities.length > 0
    ? similarities.reduce((s, v) => s + v, 0) / similarities.length
    : 0;
  const exactMatchCount = matchResult.matched.filter(m => m.similarity === 1.0).length;
  const exactMatchRate = totalMatched > 0 ? exactMatchCount / totalMatched : 0;

  // Edit distance histogram
  const editDistances = matchResult.matched.map(m => editDistance(m.gtLatex, m.ocrLatex));
  const editDistHistogram = {
    exact: editDistances.filter(d => d === 0).length,
    '1-5': editDistances.filter(d => d >= 1 && d <= 5).length,
    '6-20': editDistances.filter(d => d >= 6 && d <= 20).length,
    '21-50': editDistances.filter(d => d >= 21 && d <= 50).length,
    '50+': editDistances.filter(d => d > 50).length,
  };

  // Conversion rate (LaTeX → MathML)
  let convertedCount = 0;
  let conversionFailCount = 0;
  for (const formula of ocrFormulas) {
    const result = convertToMathml(formula.latex, formula.type === 'display');
    if (result.mathml) {
      convertedCount++;
    } else {
      conversionFailCount++;
    }
  }
  const conversionRate = totalOcr > 0 ? convertedCount / totalOcr : 0;
  const lossRate = totalGt > 0 ? (totalGt - totalMatched) / totalGt : 0;

  // Per-tier metrics
  const tierMetrics = {};
  for (const tier of [1, 2, 3, 4]) {
    const gtInTier = gtFormulas.filter(f => (f.tier || classifyTier(f.latex, f.type)) === tier);
    const matchedInTier = matchResult.matched.filter(m => {
      const gtF = gtFormulas[m.gtIndex];
      return (gtF.tier || classifyTier(gtF.latex, gtF.type)) === tier;
    });

    const tierRecall = gtInTier.length > 0 ? matchedInTier.length / gtInTier.length : 0;
    const tierSims = matchedInTier.map(m => m.similarity);
    const tierAvgSim = tierSims.length > 0
      ? tierSims.reduce((s, v) => s + v, 0) / tierSims.length
      : 0;
    const tierExact = matchedInTier.filter(m => m.similarity === 1.0).length;
    const tierExactRate = matchedInTier.length > 0 ? tierExact / matchedInTier.length : 0;

    tierMetrics[tier] = {
      gtCount: gtInTier.length,
      matchedCount: matchedInTier.length,
      recall: tierRecall,
      avgSimilarity: tierAvgSim,
      exactMatchRate: tierExactRate,
    };
  }

  // Per-type metrics (inline vs display)
  const typeMetrics = {};
  for (const type of ['inline', 'display']) {
    const gtOfType = gtFormulas.filter(f => f.type === type);
    const matchedOfType = matchResult.matched.filter(m => {
      const gtF = gtFormulas[m.gtIndex];
      return gtF.type === type;
    });
    typeMetrics[type] = {
      gtCount: gtOfType.length,
      matchedCount: matchedOfType.length,
      recall: gtOfType.length > 0 ? matchedOfType.length / gtOfType.length : 0,
    };
  }

  return {
    extractor: options.extractorName || 'unknown',
    core: { recall, precision, f1, conversionRate, lossRate },
    character: { charAccuracy, exactMatchRate, exactMatchCount, editDistHistogram },
    perTier: tierMetrics,
    perType: typeMetrics,
    operational: {
      latencyMs: options.latencyMs || 0,
      costUsd: options.costUsd || 0,
    },
    counts: {
      gtTotal: totalGt,
      ocrTotal: totalOcr,
      matched: totalMatched,
      unmatchedGt: matchResult.unmatchedGt.length,
      unmatchedOcr: matchResult.unmatchedOcr.length,
      converted: convertedCount,
      conversionFailed: conversionFailCount,
    },
    matchStrategy: matchResult.strategy,
  };
}

/**
 * Aggregate metrics across multiple papers for a single extractor.
 *
 * @param {Array} paperMetrics - Array of per-paper metric objects
 * @returns {Object} Aggregated metrics
 */
export function aggregateMetrics(paperMetrics) {
  if (paperMetrics.length === 0) {
    throw new Error('Cannot aggregate empty metrics array');
  }

  const extractor = paperMetrics[0].extractor;

  // Weighted averages by formula count
  let totalGt = 0;
  let totalOcr = 0;
  let totalMatched = 0;
  let totalConverted = 0;
  let weightedCharAcc = 0;
  let totalExactMatch = 0;
  let totalLatency = 0;
  let totalCost = 0;

  const aggEditHist = { exact: 0, '1-5': 0, '6-20': 0, '21-50': 0, '50+': 0 };
  const aggTier = {};
  const aggType = { inline: { gtCount: 0, matchedCount: 0 }, display: { gtCount: 0, matchedCount: 0 } };

  for (const pm of paperMetrics) {
    totalGt += pm.counts.gtTotal;
    totalOcr += pm.counts.ocrTotal;
    totalMatched += pm.counts.matched;
    totalConverted += pm.counts.converted;
    weightedCharAcc += pm.character.charAccuracy * pm.counts.matched;
    totalExactMatch += pm.character.exactMatchCount;
    totalLatency += pm.operational.latencyMs;
    totalCost += pm.operational.costUsd;

    for (const [bucket, count] of Object.entries(pm.character.editDistHistogram)) {
      aggEditHist[bucket] = (aggEditHist[bucket] || 0) + count;
    }

    for (const [tier, tm] of Object.entries(pm.perTier)) {
      if (!aggTier[tier]) aggTier[tier] = { gtCount: 0, matchedCount: 0, simSum: 0, exactCount: 0 };
      aggTier[tier].gtCount += tm.gtCount;
      aggTier[tier].matchedCount += tm.matchedCount;
      aggTier[tier].simSum += tm.avgSimilarity * tm.matchedCount;
      aggTier[tier].exactCount += Math.round(tm.exactMatchRate * tm.matchedCount);
    }

    for (const type of ['inline', 'display']) {
      if (pm.perType[type]) {
        aggType[type].gtCount += pm.perType[type].gtCount;
        aggType[type].matchedCount += pm.perType[type].matchedCount;
      }
    }
  }

  const recall = totalGt > 0 ? totalMatched / totalGt : 0;
  const precision = totalOcr > 0 ? totalMatched / totalOcr : 0;
  const f1 = (recall + precision) > 0 ? 2 * recall * precision / (recall + precision) : 0;
  const charAccuracy = totalMatched > 0 ? weightedCharAcc / totalMatched : 0;
  const exactMatchRate = totalMatched > 0 ? totalExactMatch / totalMatched : 0;
  const conversionRate = totalOcr > 0 ? totalConverted / totalOcr : 0;

  // Macro averages
  const macroRecall = paperMetrics.reduce((s, pm) => s + pm.core.recall, 0) / paperMetrics.length;
  const macroPrecision = paperMetrics.reduce((s, pm) => s + pm.core.precision, 0) / paperMetrics.length;
  const macroF1 = paperMetrics.reduce((s, pm) => s + pm.core.f1, 0) / paperMetrics.length;

  // Finalize tier metrics
  const tierMetrics = {};
  for (const [tier, t] of Object.entries(aggTier)) {
    tierMetrics[tier] = {
      gtCount: t.gtCount,
      matchedCount: t.matchedCount,
      recall: t.gtCount > 0 ? t.matchedCount / t.gtCount : 0,
      avgSimilarity: t.matchedCount > 0 ? t.simSum / t.matchedCount : 0,
      exactMatchRate: t.matchedCount > 0 ? t.exactCount / t.matchedCount : 0,
    };
  }

  // Finalize type metrics
  const typeMetrics = {};
  for (const [type, t] of Object.entries(aggType)) {
    typeMetrics[type] = {
      gtCount: t.gtCount,
      matchedCount: t.matchedCount,
      recall: t.gtCount > 0 ? t.matchedCount / t.gtCount : 0,
    };
  }

  return {
    extractor,
    paperCount: paperMetrics.length,
    weighted: { recall, precision, f1, conversionRate, charAccuracy, exactMatchRate },
    macro: { recall: macroRecall, precision: macroPrecision, f1: macroF1 },
    perTier: tierMetrics,
    perType: typeMetrics,
    editDistHistogram: aggEditHist,
    operational: {
      totalLatencyMs: totalLatency,
      avgLatencyMs: totalLatency / paperMetrics.length,
      totalCostUsd: totalCost,
      avgCostUsd: totalCost / paperMetrics.length,
    },
    counts: { totalGt, totalOcr, totalMatched, totalConverted },
  };
}

/**
 * Compare multiple extractors side-by-side.
 *
 * @param {Object} extractorAggregates - { extractorName: aggregatedMetrics, ... }
 * @returns {Object} Comparison with ranking
 */
export function compareExtractors(extractorAggregates) {
  const extractors = Object.entries(extractorAggregates).map(([name, agg]) => ({
    name,
    ...agg,
  }));

  // Sort by weighted F1 descending
  const ranked = [...extractors].sort((a, b) => b.weighted.f1 - a.weighted.f1);

  // Generate recommendations
  const recommendations = [];
  const best = ranked[0];
  if (best) {
    recommendations.push(`Best overall F1: ${best.name} (${(best.weighted.f1 * 100).toFixed(1)}%)`);
  }

  // Best recall
  const bestRecall = [...extractors].sort((a, b) => b.weighted.recall - a.weighted.recall)[0];
  if (bestRecall && bestRecall.name !== best?.name) {
    recommendations.push(`Best recall: ${bestRecall.name} (${(bestRecall.weighted.recall * 100).toFixed(1)}%)`);
  }

  // Best cost-effectiveness (F1 / cost, excluding free extractors)
  const paidExtractors = extractors.filter(e => e.operational.totalCostUsd > 0);
  if (paidExtractors.length > 0) {
    const bestValue = paidExtractors.sort(
      (a, b) => (b.weighted.f1 / b.operational.avgCostUsd) - (a.weighted.f1 / a.operational.avgCostUsd)
    )[0];
    recommendations.push(`Best cost-effectiveness (paid): ${bestValue.name}`);
  }

  // Free extractors
  const freeExtractors = extractors.filter(e => e.operational.totalCostUsd === 0);
  if (freeExtractors.length > 0) {
    const bestFree = freeExtractors.sort((a, b) => b.weighted.f1 - a.weighted.f1)[0];
    recommendations.push(`Best free extractor: ${bestFree.name} (F1: ${(bestFree.weighted.f1 * 100).toFixed(1)}%)`);
  }

  return {
    ranked: ranked.map((e, i) => ({ rank: i + 1, name: e.name, metrics: e })),
    recommendations,
    timestamp: new Date().toISOString(),
  };
}
