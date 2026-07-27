import { describe, it, expect, vi } from 'vitest';
import { assembleHtml } from '../../lib/html-assembler.js';
import { loadOcrResultSample } from '../helpers/load-fixtures.js';
import { parseHtml, validateTocLinks, extractDocStructure } from '../helpers/dom-helpers.js';

describe('assembleHtml', () => {
  // Suppress converter warnings in test output
  let warnSpy;
  function setup() {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  }
  function teardown() {
    warnSpy?.mockRestore();
  }

  it('produces valid HTML document', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'Test Paper');
    teardown();

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');

    // Should be parseable by linkedom
    const doc = parseHtml(html);
    expect(doc).toBeTruthy();
  });

  it('sets lang="en" and charset', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'Test Paper');
    teardown();

    const structure = extractDocStructure(html);
    expect(structure.lang).toBe('en');
    expect(structure.charset).toBe('UTF-8');
  });

  it('includes title', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'My Test Title');
    teardown();

    const structure = extractDocStructure(html);
    expect(structure.title).toBe('My Test Title');
  });

  it('has <main> element', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'Test');
    teardown();

    const structure = extractDocStructure(html);
    expect(structure.hasMain).toBe(true);
  });

  it('contains MathML <math> elements', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html, formulaStats } = assembleHtml(ocrResult, 'Test');
    teardown();

    if (formulaStats.converted > 0) {
      expect(html).toContain('<math');
    }
  });

  it('creates formula-error spans for failed conversions', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html, formulaStats } = assembleHtml(ocrResult, 'Test');
    teardown();

    const structure = extractDocStructure(html);
    expect(structure.formulaErrorCount).toBe(formulaStats.failed);
  });

  it('builds TOC with valid links', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'Test');
    teardown();

    const tocResult = validateTocLinks(html);
    if (tocResult.hasNav) {
      expect(tocResult.broken).toBe(0);
      expect(tocResult.valid).toBeGreaterThan(0);
    }
  });

  it('returns accurate formulaStats', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { formulaStats } = assembleHtml(ocrResult, 'Test');
    teardown();

    expect(formulaStats.total).toBeGreaterThan(0);
    expect(formulaStats.converted + formulaStats.failed).toBe(formulaStats.total);
    expect(formulaStats.fallbackLevel1).toBeLessThanOrEqual(formulaStats.converted);
  });

  it('escapes HTML in title', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, '<script>alert("xss")</script>');
    teardown();

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes page break dividers', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'Test');
    teardown();

    // 2 pages => at least 1 page break
    expect(html).toContain('page-break');
  });

  it('includes conversion statistics footer', () => {
    setup();
    const ocrResult = loadOcrResultSample();
    const { html } = assembleHtml(ocrResult, 'Test');
    teardown();

    expect(html).toContain('Conversion statistics');
    expect(html).toContain('Formulas:');
  });

  it('handles empty pages gracefully', () => {
    setup();
    const emptyResult = { pages: [{ pageIndex: 0, markdown: '' }] };
    const { html, formulaStats } = assembleHtml(emptyResult, 'Empty');
    teardown();

    expect(html).toContain('<!DOCTYPE html>');
    expect(formulaStats.total).toBe(0);
  });
});
