import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'child_process';
import { getPaperIds, loadPaperGt } from '../helpers/load-paper-data.js';
import { convertWithTemml, convertWithLatex2mathml, convertToMathml } from '../../lib/mathml-converter.js';
import config from '../../config.js';

// Check python3 + latex2mathml availability
let hasPythonLatex2mathml = false;
try {
  execSync('python3 -c "import latex2mathml"', { encoding: 'utf-8', timeout: 5000 });
  hasPythonLatex2mathml = true;
} catch { /* unavailable */ }

const paperIds = getPaperIds();

/**
 * Categorize a conversion failure by error type.
 */
function categorizeFailure(error) {
  if (!error) return 'success';
  const msg = error.toLowerCase();
  if (msg.includes('unrecognized') || msg.includes('undefined control') || msg.includes('unknown')) {
    return 'unsupported_command';
  }
  if (msg.includes('parse') || msg.includes('expected') || msg.includes('missing')) {
    return 'syntax_error';
  }
  if (msg.includes('environment') || msg.includes('begin') || msg.includes('end')) {
    return 'unknown_environment';
  }
  if (msg.includes('malformed')) {
    return 'malformed_output';
  }
  return 'other';
}

describe.skipIf(paperIds.length === 0)('conversion failure analysis', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  describe.each(paperIds)('paper %s', (paperId) => {
    let gt;
    let results;

    const setup = (() => {
      let done = false;
      return () => {
        if (done) return;
        gt = loadPaperGt(paperId);
        results = gt.formulas.map(f => {
          const displayMode = f.type === 'display';
          const temmlResult = convertWithTemml(f.latex, displayMode);
          const fullResult = convertToMathml(f.latex, displayMode);
          return {
            formula: f,
            temml: temmlResult,
            full: fullResult,
          };
        });
        done = true;
      };
    })();

    it('reports conversion results', () => {
      setup();
      const temmlSuccess = results.filter(r => r.temml.mathml !== null).length;
      const fullSuccess = results.filter(r => r.full.mathml !== null).length;
      const total = results.length;

      console.log(`  [${paperId}] temml: ${temmlSuccess}/${total} (${(100 * temmlSuccess / total).toFixed(1)}%), ` +
        `cascade: ${fullSuccess}/${total} (${(100 * fullSuccess / total).toFixed(1)}%)`);

      expect(total).toBeGreaterThan(0);
    });

    it('categorizes conversion failures', () => {
      setup();
      const categories = {
        unsupported_command: 0,
        syntax_error: 0,
        unknown_environment: 0,
        malformed_output: 0,
        other: 0,
      };

      for (const r of results) {
        if (r.full.mathml === null) {
          const cat = categorizeFailure(r.full.error);
          categories[cat]++;
        }
      }

      const totalFailures = Object.values(categories).reduce((a, b) => a + b, 0);
      const fullFailures = results.filter(r => r.full.mathml === null).length;
      expect(totalFailures).toBe(fullFailures);
    });

    it('meets conversion rate threshold', () => {
      setup();
      const fullSuccess = results.filter(r => r.full.mathml !== null).length;
      const rate = fullSuccess / results.length;
      expect(rate).toBeGreaterThanOrEqual(config.thresholds.conversionSuccessTarget);
    });

    it('meets loss threshold', () => {
      setup();
      const fullFailures = results.filter(r => r.full.mathml === null).length;
      const lossRate = fullFailures / results.length;
      expect(lossRate).toBeLessThanOrEqual(config.thresholds.totalLossMax);
    });

    it('provides per-tier conversion rates', () => {
      setup();
      const tierStats = {};
      for (const r of results) {
        const tier = r.formula.tier;
        if (!tierStats[tier]) tierStats[tier] = { total: 0, success: 0 };
        tierStats[tier].total++;
        if (r.full.mathml !== null) tierStats[tier].success++;
      }

      for (const [tier, stats] of Object.entries(tierStats)) {
        const rate = stats.success / stats.total;
        console.log(`    Tier ${tier}: ${stats.success}/${stats.total} (${(100 * rate).toFixed(1)}%)`);
        // Tier 1-2 should have high conversion rate
        if (Number(tier) <= 2) {
          expect(rate).toBeGreaterThanOrEqual(0.8);
        }
      }
    });

    if (hasPythonLatex2mathml) {
      it('measures fallback coverage', () => {
        setup();
        const temmlFails = results.filter(r => r.temml.mathml === null);
        if (temmlFails.length > 0) {
          const fallbackRecovery = temmlFails.filter(r => r.full.mathml !== null).length;
          const coverage = fallbackRecovery / temmlFails.length;
          console.log(`    Fallback recovery: ${fallbackRecovery}/${temmlFails.length} (${(100 * coverage).toFixed(1)}%)`);
        }
      });
    }
  });
});
