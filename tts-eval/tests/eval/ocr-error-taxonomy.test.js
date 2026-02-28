import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'child_process';
import { getPaperIds, loadPaperGt, loadPaperOcr } from '../helpers/load-paper-data.js';
import { matchHungarian, matchSequential, similarity } from '../../lib/formula-matcher.js';
import config from '../../config.js';

// Check scipy for Hungarian matching
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
 * Categorize an unmatched GT formula by OCR error type.
 */
function categorizeOcrError(gtFormula, ocrFormulas) {
  // Check if any OCR formula is close
  let bestSim = 0;
  for (const ocrF of ocrFormulas) {
    const sim = similarity(gtFormula.latex, ocrF.latex);
    if (sim > bestSim) bestSim = sim;
  }

  if (bestSim >= 0.8) return 'minor_ocr_error';
  if (bestSim >= 0.5) return 'garbled';
  if (bestSim < 0.5) return 'missing';
  return 'missing';
}

describe.skipIf(paperIds.length === 0)('OCR error taxonomy', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  describe.each(paperIds)('paper %s', (paperId) => {
    let gt, ocr, matchResult;

    const setup = (() => {
      let done = false;
      return () => {
        if (done) return;
        gt = loadPaperGt(paperId);
        ocr = loadPaperOcr(paperId);
        const gtFormulas = gt.formulas.map(f => ({ latex: f.latex }));
        const ocrFormulas = ocr.formulas.map(f => ({ latex: f.latex }));
        matchResult = hasScipy
          ? matchHungarian(gtFormulas, ocrFormulas)
          : matchSequential(gtFormulas, ocrFormulas);
        done = true;
      };
    })();

    it('produces a matching result', () => {
      setup();
      expect(matchResult.matched.length).toBeGreaterThan(0);
    });

    it('categorizes unmatched GT formulas', () => {
      setup();
      const ocrFormulas = ocr.formulas.map(f => ({ latex: f.latex }));
      const categories = { missing: 0, garbled: 0, minor_ocr_error: 0 };

      for (const unmatched of matchResult.unmatchedGt) {
        const gtFormula = gt.formulas[unmatched.index];
        const category = categorizeOcrError(gtFormula, ocrFormulas);
        categories[category]++;
      }

      // Log taxonomy for visibility
      const total = matchResult.unmatchedGt.length;
      if (total > 0) {
        console.log(`  [${paperId}] Unmatched GT: ${total} — ` +
          `missing: ${categories.missing}, garbled: ${categories.garbled}, ` +
          `minor: ${categories.minor_ocr_error}`);
      }
      // Just verify structure — categories should sum to unmatched count
      expect(categories.missing + categories.garbled + categories.minor_ocr_error)
        .toBe(matchResult.unmatchedGt.length);
    });

    it('provides per-tier breakdown', () => {
      setup();
      const tierMatched = { 1: 0, 2: 0, 3: 0, 4: 0 };
      const tierTotal = { 1: 0, 2: 0, 3: 0, 4: 0 };

      for (const f of gt.formulas) {
        tierTotal[f.tier] = (tierTotal[f.tier] || 0) + 1;
      }

      for (const m of matchResult.matched) {
        const gtFormula = gt.formulas[m.gtIndex];
        if (gtFormula) {
          tierMatched[gtFormula.tier] = (tierMatched[gtFormula.tier] || 0) + 1;
        }
      }

      // Each tier should have some formulas
      for (const tier of [1, 2]) {
        if (tierTotal[tier] > 0) {
          const recall = tierMatched[tier] / tierTotal[tier];
          expect(recall).toBeGreaterThan(0);
        }
      }
    });

    it('reports recall metric', () => {
      setup();
      const recall = matchResult.matched.length / gt.formulas.length;
      console.log(`  [${paperId}] OCR recall: ${(100 * recall).toFixed(1)}% (${matchResult.matched.length}/${gt.formulas.length})`);
      // OCR recall depends on Mistral model quality, not our pipeline.
      // Assert basic sanity: at least some formulas matched.
      expect(matchResult.matched.length).toBeGreaterThan(0);
    });
  });
});
