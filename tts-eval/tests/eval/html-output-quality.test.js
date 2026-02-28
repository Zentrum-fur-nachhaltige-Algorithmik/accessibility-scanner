import { describe, it, expect, vi } from 'vitest';
import { assembleHtml } from '../../lib/html-assembler.js';
import { getPaperIds, loadPaperCachedOcr, loadPaperMetadata } from '../helpers/load-paper-data.js';
import {
  parseHtml,
  validateMathmlWellFormedness,
  extractAriaLabels,
  validateTocLinks,
  extractDocStructure,
} from '../helpers/dom-helpers.js';

const paperIds = getPaperIds();

describe.skipIf(paperIds.length === 0)('HTML output quality', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  describe.each(paperIds)('paper %s', (paperId) => {
    let html;
    let formulaStats;

    const setup = (() => {
      let done = false;
      return () => {
        if (done) return;
        const ocrResult = loadPaperCachedOcr(paperId);
        const metadata = loadPaperMetadata(paperId);
        const result = assembleHtml(ocrResult, metadata.title);
        html = result.html;
        formulaStats = result.formulaStats;
        done = true;
      };
    })();

    it('MathML elements are well-formed', () => {
      setup();
      const mathResult = validateMathmlWellFormedness(html);
      expect(mathResult.total).toBeGreaterThan(0);
      if (mathResult.total > 0) {
        const validRate = mathResult.valid / mathResult.total;
        expect(validRate).toBeGreaterThanOrEqual(0.95);
      }
    });

    it('formula-error spans have aria-labels', () => {
      setup();
      const doc = parseHtml(html);
      const errorSpans = doc.querySelectorAll('.formula-error');
      for (const span of errorSpans) {
        expect(span.getAttribute('aria-label')).toBeTruthy();
        expect(span.getAttribute('role')).toBe('math');
      }
    });

    it('TOC links are intact', () => {
      setup();
      const tocResult = validateTocLinks(html);
      if (tocResult.hasNav) {
        expect(tocResult.broken).toBe(0);
        expect(tocResult.valid).toBeGreaterThan(0);
      }
    });

    it('has correct document structure', () => {
      setup();
      const structure = extractDocStructure(html);
      expect(structure.lang).toBe('en');
      expect(structure.charset).toBe('UTF-8');
      expect(structure.title).toBeTruthy();
      expect(structure.hasMain).toBe(true);
    });

    it('formula-error count matches formulaStats', () => {
      setup();
      const structure = extractDocStructure(html);
      expect(structure.formulaErrorCount).toBe(formulaStats.failed);
    });

    it('has navigation landmark', () => {
      setup();
      const doc = parseHtml(html);
      const nav = doc.querySelector('nav[aria-label]');
      if (nav) {
        expect(nav.getAttribute('aria-label')).toBeTruthy();
      }
    });

    it('has conversion statistics footer', () => {
      setup();
      const doc = parseHtml(html);
      const footer = doc.querySelector('footer[aria-label="Conversion statistics"]');
      expect(footer).toBeTruthy();
    });
  });
});
