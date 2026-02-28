import { describe, it, expect, vi } from 'vitest';
import { assembleHtml } from '../../lib/html-assembler.js';
import { getPaperIds, loadPaperCachedOcr, loadPaperMetadata } from '../helpers/load-paper-data.js';
import { parseHtml, validateMathmlWellFormedness, validateTocLinks, extractDocStructure } from '../helpers/dom-helpers.js';
import config from '../../config.js';

const paperIds = getPaperIds();

describe.skipIf(paperIds.length === 0)('pipeline integration (cached data)', () => {
  // Suppress converter warnings
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  describe.each(paperIds)('paper %s', (paperId) => {
    let html;
    let formulaStats;
    let metadata;

    // Build HTML once per paper
    const setup = (() => {
      let done = false;
      return () => {
        if (done) return;
        const ocrResult = loadPaperCachedOcr(paperId);
        metadata = loadPaperMetadata(paperId);
        const result = assembleHtml(ocrResult, metadata.title);
        html = result.html;
        formulaStats = result.formulaStats;
        done = true;
      };
    })();

    it('produces parseable HTML', () => {
      setup();
      const doc = parseHtml(html);
      expect(doc).toBeTruthy();
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('contains <math> elements', () => {
      setup();
      expect(html).toContain('<math');
    });

    it('has valid document structure', () => {
      setup();
      const structure = extractDocStructure(html);
      expect(structure.lang).toBe('en');
      expect(structure.charset).toBe('UTF-8');
      expect(structure.hasMain).toBe(true);
      expect(structure.title).toBeTruthy();
    });

    it('has well-formed MathML', () => {
      setup();
      const mathResult = validateMathmlWellFormedness(html);
      expect(mathResult.total).toBeGreaterThan(0);
      // Allow some malformed (temml edge cases), but majority should be valid
      const validRate = mathResult.valid / mathResult.total;
      expect(validRate).toBeGreaterThanOrEqual(0.9);
    });

    it('has valid TOC links', () => {
      setup();
      const tocResult = validateTocLinks(html);
      if (tocResult.hasNav) {
        expect(tocResult.broken).toBe(0);
      }
    });

    it('meets loss threshold', () => {
      setup();
      if (formulaStats.total > 0) {
        const lossRate = formulaStats.failed / formulaStats.total;
        expect(lossRate).toBeLessThanOrEqual(config.thresholds.totalLossMax);
      }
    });

    it('reports formula conversion stats', () => {
      setup();
      expect(formulaStats.total).toBeGreaterThan(0);
      expect(formulaStats.converted + formulaStats.failed).toBe(formulaStats.total);
    });
  });
});
