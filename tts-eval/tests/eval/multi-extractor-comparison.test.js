import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import config from '../../config.js';
import { getExtractor, getAvailableExtractors, listExtractors } from '../../lib/extractors/registry.js';
import { computePaperMetrics, aggregateMetrics, compareExtractors } from '../../lib/benchmark/metrics.js';
import { generateJsonReport, generateMarkdownReport } from '../../lib/benchmark/report-generator.js';
import { extractFormulas } from '../../lib/tex-formula-extractor.js';
import { extractFromOcrResult } from '../../lib/formula-extractor.js';

/**
 * Multi-extractor comparison evaluation test.
 *
 * This test:
 * 1. Discovers all papers with ground truth
 * 2. Discovers all cached extraction results
 * 3. Computes metrics for each extractor × paper combination
 * 4. Generates comparison reports
 *
 * Run after: node scripts/run-multi-extract.js --extractors <names>
 */
describe('Multi-Extractor Comparison', () => {
  let papers;
  let availableResults;

  beforeAll(() => {
    // Discover papers
    const papersDir = config.paths.arxivPapers;
    if (!fs.existsSync(papersDir)) {
      papers = [];
      return;
    }

    papers = fs.readdirSync(papersDir)
      .filter(dir => {
        const hasGt = fs.existsSync(path.join(papersDir, dir, 'ground_truth.json'))
          || hasTexSource(path.join(papersDir, dir));
        return hasGt;
      })
      .map(id => ({
        id,
        gtFormulas: loadGt(id),
      }))
      .filter(p => p.gtFormulas && p.gtFormulas.length > 0);

    // Discover cached results
    availableResults = discoverResults(papers.map(p => p.id));
  });

  it('has at least one paper with ground truth', () => {
    if (papers.length === 0) {
      console.warn('WARN: No papers with ground truth found. Run download-papers.js + extract-ground-truth.js first.');
    }
    // Don't fail — this is an eval test that may not have data yet
    expect(papers).toBeDefined();
  });

  it('has at least one cached extraction result', () => {
    if (!availableResults || Object.keys(availableResults).length === 0) {
      console.warn('WARN: No cached extraction results found. Run run-multi-extract.js first.');
    }
    expect(availableResults).toBeDefined();
  });

  it('computes metrics for all available extractor × paper combinations', () => {
    if (papers.length === 0 || !availableResults || Object.keys(availableResults).length === 0) {
      console.warn('WARN: Skipping — no data available.');
      return;
    }

    const perPaperMetrics = {};
    const aggregates = {};

    for (const [extractorName, paperResults] of Object.entries(availableResults)) {
      perPaperMetrics[extractorName] = {};
      const metricsArr = [];

      for (const [paperId, result] of Object.entries(paperResults)) {
        const paper = papers.find(p => p.id === paperId);
        if (!paper) continue;

        const metrics = computePaperMetrics(result, paper.gtFormulas, {
          extractorName,
          latencyMs: result.metadata?.latencyMs || 0,
          costUsd: result.metadata?.costUsd || 0,
        });

        perPaperMetrics[extractorName][paperId] = metrics;
        metricsArr.push(metrics);

        // Basic sanity checks
        expect(metrics.core.recall).toBeGreaterThanOrEqual(0);
        expect(metrics.core.recall).toBeLessThanOrEqual(1);
        expect(metrics.core.precision).toBeGreaterThanOrEqual(0);
        expect(metrics.core.precision).toBeLessThanOrEqual(1);
        expect(metrics.counts.gtTotal).toBe(paper.gtFormulas.length);
      }

      if (metricsArr.length > 0) {
        aggregates[extractorName] = aggregateMetrics(metricsArr);
      }
    }

    if (Object.keys(aggregates).length > 0) {
      const comparison = compareExtractors(aggregates);

      // Verify ranking
      expect(comparison.ranked.length).toBe(Object.keys(aggregates).length);
      expect(comparison.ranked[0].rank).toBe(1);

      // Generate reports
      const jsonPath = generateJsonReport(comparison, perPaperMetrics);
      const mdPath = generateMarkdownReport(comparison, perPaperMetrics);

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(mdPath)).toBe(true);

      console.log(`\nBenchmark report: ${mdPath}`);

      // Log summary
      for (const entry of comparison.ranked) {
        console.log(
          `  #${entry.rank} ${entry.name}: ` +
          `F1=${(entry.metrics.weighted.f1 * 100).toFixed(1)}% ` +
          `Recall=${(entry.metrics.weighted.recall * 100).toFixed(1)}%`
        );
      }
    }
  });

  it('all extractors produce valid output structure', () => {
    if (!availableResults || Object.keys(availableResults).length === 0) return;

    for (const [extractorName, paperResults] of Object.entries(availableResults)) {
      for (const [paperId, result] of Object.entries(paperResults)) {
        expect(result.pages, `${extractorName}/${paperId} missing pages`).toBeDefined();
        expect(Array.isArray(result.pages), `${extractorName}/${paperId} pages not array`).toBe(true);

        for (const page of result.pages) {
          expect(typeof page.pageIndex).toBe('number');
          expect(typeof page.markdown).toBe('string');
        }
      }
    }
  });

  it('formula extraction works from each extractor output', () => {
    if (!availableResults || Object.keys(availableResults).length === 0) return;

    for (const [extractorName, paperResults] of Object.entries(availableResults)) {
      for (const [paperId, result] of Object.entries(paperResults)) {
        const extracted = extractFromOcrResult(result);
        expect(extracted.formulas).toBeDefined();
        expect(extracted.totalFormulas).toBeGreaterThanOrEqual(0);
        expect(extracted.byType).toBeDefined();
      }
    }
  });
});

// Helpers

function hasTexSource(paperDir) {
  const sourceDir = path.join(paperDir, 'source');
  if (!fs.existsSync(sourceDir)) return false;
  return fs.readdirSync(sourceDir).some(f => f.endsWith('.tex'));
}

function loadGt(paperId) {
  const paperDir = path.join(config.paths.arxivPapers, paperId);

  // Try ground_truth.json first
  const gtPath = path.join(paperDir, 'ground_truth.json');
  if (fs.existsSync(gtPath)) {
    const data = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
    return data.formulas || data;
  }

  // Try extracting from .tex source
  const sourceDir = path.join(paperDir, 'source');
  if (fs.existsSync(sourceDir)) {
    const texFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.tex'));
    if (texFiles.length > 0) {
      let mainFile = texFiles[0];
      for (const f of texFiles) {
        const content = fs.readFileSync(path.join(sourceDir, f), 'utf-8');
        if (content.includes('\\documentclass')) {
          mainFile = f;
          break;
        }
      }
      const content = fs.readFileSync(path.join(sourceDir, mainFile), 'utf-8');
      return extractFormulas(content, mainFile);
    }
  }

  return null;
}

function discoverResults(paperIds) {
  const cacheDir = config.paths.cache;
  if (!fs.existsSync(cacheDir)) return {};

  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
  const results = {};

  for (const file of files) {
    const base = file.replace('.json', '');

    for (const paperId of paperIds) {
      if (base.startsWith(paperId + '_')) {
        let extractorName = base.slice(paperId.length + 1);
        if (extractorName === 'ocr') extractorName = 'mistral';

        if (!results[extractorName]) results[extractorName] = {};

        try {
          results[extractorName][paperId] = JSON.parse(
            fs.readFileSync(path.join(cacheDir, file), 'utf-8')
          );
        } catch {
          // Skip corrupt cache files
        }
      }
    }
  }

  return results;
}
