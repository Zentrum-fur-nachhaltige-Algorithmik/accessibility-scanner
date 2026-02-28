import { describe, it, expect } from 'vitest';
import { computePaperMetrics, aggregateMetrics, compareExtractors } from '../../../lib/benchmark/metrics.js';

// Helper: create a fake extractor result with known formulas
function makeExtractorResult(formulas) {
  const markdown = formulas.map(f => {
    if (f.type === 'display') return `$$${f.latex}$$`;
    return `$${f.latex}$`;
  }).join(' text between formulas ');

  return {
    pages: [{ pageIndex: 0, markdown }],
  };
}

// Helper: create GT formulas with tier assignments
function makeGt(formulas) {
  return formulas.map((f, i) => ({
    type: f.type || 'inline',
    latex: f.latex,
    position: i * 100,
    index: i,
    tier: f.tier || 1,
  }));
}

describe('computePaperMetrics', () => {
  it('computes perfect recall for identical formulas', () => {
    const gt = makeGt([
      { latex: 'x^2', type: 'inline' },
      { latex: 'a + b', type: 'inline' },
    ]);
    const result = makeExtractorResult([
      { latex: 'x^2', type: 'inline' },
      { latex: 'a + b', type: 'inline' },
    ]);

    const metrics = computePaperMetrics(result, gt, { extractorName: 'test' });

    expect(metrics.core.recall).toBe(1.0);
    expect(metrics.core.precision).toBe(1.0);
    expect(metrics.core.f1).toBe(1.0);
    expect(metrics.character.exactMatchRate).toBe(1.0);
    expect(metrics.counts.gtTotal).toBe(2);
    expect(metrics.counts.matched).toBe(2);
  });

  it('computes zero recall when no formulas detected', () => {
    const gt = makeGt([
      { latex: 'x^2', type: 'inline' },
      { latex: 'a + b', type: 'inline' },
    ]);
    const result = { pages: [{ pageIndex: 0, markdown: 'no formulas here' }] };

    const metrics = computePaperMetrics(result, gt, { extractorName: 'test' });

    expect(metrics.core.recall).toBe(0);
    expect(metrics.counts.matched).toBe(0);
    expect(metrics.counts.gtTotal).toBe(2);
  });

  it('computes partial recall', () => {
    const gt = makeGt([
      { latex: 'x^2', type: 'inline' },
      { latex: 'a + b', type: 'inline' },
      { latex: '\\frac{1}{2}', type: 'display', tier: 2 },
    ]);
    // Only extract 1 of 3 formulas
    const result = makeExtractorResult([
      { latex: 'x^2', type: 'inline' },
    ]);

    const metrics = computePaperMetrics(result, gt, { extractorName: 'test' });

    expect(metrics.core.recall).toBeCloseTo(1 / 3, 2);
    expect(metrics.core.precision).toBe(1.0);
    expect(metrics.counts.matched).toBe(1);
  });

  it('tracks per-tier metrics', () => {
    const gt = makeGt([
      { latex: 'x', type: 'inline', tier: 1 },
      { latex: 'y', type: 'inline', tier: 1 },
      { latex: '\\frac{a}{b}', type: 'display', tier: 2 },
    ]);
    const result = makeExtractorResult([
      { latex: 'x', type: 'inline' },
      { latex: 'y', type: 'inline' },
    ]);

    const metrics = computePaperMetrics(result, gt, { extractorName: 'test' });

    expect(metrics.perTier[1].gtCount).toBe(2);
    expect(metrics.perTier[1].recall).toBe(1.0);
    expect(metrics.perTier[2].gtCount).toBe(1);
    expect(metrics.perTier[2].recall).toBe(0);
  });

  it('tracks per-type metrics', () => {
    const gt = makeGt([
      { latex: 'x', type: 'inline' },
      { latex: 'y = mx + b', type: 'display' },
    ]);
    const result = makeExtractorResult([
      { latex: 'x', type: 'inline' },
    ]);

    const metrics = computePaperMetrics(result, gt, { extractorName: 'test' });

    expect(metrics.perType.inline.gtCount).toBe(1);
    expect(metrics.perType.inline.recall).toBe(1.0);
    expect(metrics.perType.display.gtCount).toBe(1);
  });

  it('records operational metrics', () => {
    const gt = makeGt([{ latex: 'x', type: 'inline' }]);
    const result = makeExtractorResult([{ latex: 'x', type: 'inline' }]);

    const metrics = computePaperMetrics(result, gt, {
      extractorName: 'test',
      latencyMs: 5000,
      costUsd: 0.15,
    });

    expect(metrics.operational.latencyMs).toBe(5000);
    expect(metrics.operational.costUsd).toBe(0.15);
  });

  it('computes edit distance histogram', () => {
    const gt = makeGt([
      { latex: 'x^2', type: 'inline' },
      { latex: 'abcdefghijklmnopqrst', type: 'inline' },
    ]);
    const result = makeExtractorResult([
      { latex: 'x^2', type: 'inline' }, // exact match
      { latex: 'abcdefghijklmnopqXXX', type: 'inline' }, // ~3 edits
    ]);

    const metrics = computePaperMetrics(result, gt, { extractorName: 'test' });

    expect(metrics.character.editDistHistogram.exact).toBeGreaterThanOrEqual(1);
  });
});

describe('aggregateMetrics', () => {
  it('throws on empty array', () => {
    expect(() => aggregateMetrics([])).toThrow('Cannot aggregate empty');
  });

  it('aggregates single paper correctly', () => {
    const gt = makeGt([
      { latex: 'x', type: 'inline' },
      { latex: 'y', type: 'inline' },
    ]);
    const result = makeExtractorResult([
      { latex: 'x', type: 'inline' },
      { latex: 'y', type: 'inline' },
    ]);

    const pm = computePaperMetrics(result, gt, { extractorName: 'test', latencyMs: 1000, costUsd: 0.01 });
    const agg = aggregateMetrics([pm]);

    expect(agg.extractor).toBe('test');
    expect(agg.paperCount).toBe(1);
    expect(agg.weighted.recall).toBe(1.0);
    expect(agg.weighted.f1).toBe(1.0);
    expect(agg.operational.totalLatencyMs).toBe(1000);
    expect(agg.operational.totalCostUsd).toBe(0.01);
  });

  it('aggregates multiple papers with weighted average', () => {
    // Paper 1: 2 GT, 2 matched
    const gt1 = makeGt([{ latex: 'a', type: 'inline' }, { latex: 'b', type: 'inline' }]);
    const res1 = makeExtractorResult([{ latex: 'a', type: 'inline' }, { latex: 'b', type: 'inline' }]);
    const pm1 = computePaperMetrics(res1, gt1, { extractorName: 'test', latencyMs: 500 });

    // Paper 2: 3 GT, 1 matched
    const gt2 = makeGt([
      { latex: 'x', type: 'inline' },
      { latex: 'y', type: 'inline' },
      { latex: 'z', type: 'inline' },
    ]);
    const res2 = makeExtractorResult([{ latex: 'x', type: 'inline' }]);
    const pm2 = computePaperMetrics(res2, gt2, { extractorName: 'test', latencyMs: 700 });

    const agg = aggregateMetrics([pm1, pm2]);

    // Weighted recall: (2+1) / (2+3) = 3/5 = 0.6
    expect(agg.weighted.recall).toBeCloseTo(0.6, 2);
    expect(agg.counts.totalGt).toBe(5);
    expect(agg.counts.totalMatched).toBe(3);
    expect(agg.operational.totalLatencyMs).toBe(1200);
  });
});

describe('compareExtractors', () => {
  it('ranks extractors by F1', () => {
    const aggA = {
      extractor: 'extA',
      weighted: { recall: 0.9, precision: 0.8, f1: 0.85, conversionRate: 0.9, charAccuracy: 0.95, exactMatchRate: 0.7 },
      macro: { recall: 0.9, precision: 0.8, f1: 0.85 },
      perTier: {},
      perType: {},
      editDistHistogram: { exact: 10, '1-5': 5, '6-20': 2, '21-50': 1, '50+': 0 },
      operational: { totalLatencyMs: 5000, avgLatencyMs: 2500, totalCostUsd: 0.02, avgCostUsd: 0.01 },
      counts: { totalGt: 100, totalOcr: 90, totalMatched: 80, totalConverted: 75 },
      paperCount: 2,
    };

    const aggB = {
      extractor: 'extB',
      weighted: { recall: 0.5, precision: 0.9, f1: 0.65, conversionRate: 0.8, charAccuracy: 0.85, exactMatchRate: 0.5 },
      macro: { recall: 0.5, precision: 0.9, f1: 0.65 },
      perTier: {},
      perType: {},
      editDistHistogram: { exact: 5, '1-5': 3, '6-20': 4, '21-50': 2, '50+': 1 },
      operational: { totalLatencyMs: 2000, avgLatencyMs: 1000, totalCostUsd: 0, avgCostUsd: 0 },
      counts: { totalGt: 100, totalOcr: 50, totalMatched: 45, totalConverted: 40 },
      paperCount: 2,
    };

    const comparison = compareExtractors({ extA: aggA, extB: aggB });

    expect(comparison.ranked[0].name).toBe('extA');
    expect(comparison.ranked[1].name).toBe('extB');
    expect(comparison.ranked[0].rank).toBe(1);
    expect(comparison.ranked[1].rank).toBe(2);
    expect(comparison.recommendations.length).toBeGreaterThan(0);
  });

  it('identifies free extractors', () => {
    const aggFree = {
      extractor: 'free',
      weighted: { recall: 0.4, precision: 0.4, f1: 0.4, conversionRate: 0.5, charAccuracy: 0.6, exactMatchRate: 0.3 },
      macro: { recall: 0.4, precision: 0.4, f1: 0.4 },
      perTier: {},
      perType: {},
      editDistHistogram: { exact: 3, '1-5': 2, '6-20': 1, '21-50': 0, '50+': 0 },
      operational: { totalLatencyMs: 1000, avgLatencyMs: 500, totalCostUsd: 0, avgCostUsd: 0 },
      counts: { totalGt: 50, totalOcr: 30, totalMatched: 20, totalConverted: 15 },
      paperCount: 1,
    };

    const comparison = compareExtractors({ free: aggFree });

    const freeRec = comparison.recommendations.find(r => r.includes('free extractor'));
    expect(freeRec).toBeTruthy();
  });
});
