import { describe, it, expect } from 'vitest';
import {
  extractFormulasFromMarkdown,
  extractFromOcrResult,
} from '../../lib/formula-extractor.js';
import { loadOcrSample, loadOcrResultSample } from '../helpers/load-fixtures.js';

describe('extractFormulasFromMarkdown', () => {
  it('extracts inline formulas from simple page', () => {
    const md = loadOcrSample('page-simple');
    const formulas = extractFormulasFromMarkdown(md);
    const inlines = formulas.filter(f => f.type === 'inline');
    expect(inlines.length).toBeGreaterThan(0);
    expect(inlines.some(f => f.latex === 'x + y = z')).toBe(true);
  });

  it('extracts display formulas from simple page', () => {
    const md = loadOcrSample('page-simple');
    const formulas = extractFormulasFromMarkdown(md);
    const displays = formulas.filter(f => f.type === 'display');
    expect(displays.length).toBeGreaterThan(0);
    expect(displays.some(f => f.latex.includes('\\sum'))).toBe(true);
  });

  it('extracts both inline and display from mixed page', () => {
    const md = loadOcrSample('page-mixed');
    const formulas = extractFormulasFromMarkdown(md);
    expect(formulas.filter(f => f.type === 'inline').length).toBeGreaterThan(0);
    expect(formulas.filter(f => f.type === 'display').length).toBeGreaterThan(0);
  });

  it('masks code blocks — no formulas from inside code', () => {
    const md = loadOcrSample('page-code-blocks');
    const formulas = extractFormulasFromMarkdown(md);
    // $x^2$ inside python code block should NOT be extracted
    // But $x^2 + y^2 = r^2$ before the code block should be
    expect(formulas.some(f => f.latex === 'x^2 + y^2 = r^2')).toBe(true);
    // $not_a_formula$ inside inline code should NOT be extracted
    expect(formulas.every(f => f.latex !== 'not_a_formula')).toBe(true);
    // Formulas after code block should be extracted
    expect(formulas.some(f => f.latex === '\\alpha + \\beta = \\gamma')).toBe(true);
    expect(formulas.some(f => f.latex === 'E = mc^2')).toBe(true);
  });

  it('skips dollar amounts', () => {
    const md = 'The price is $100 and the other is $200.';
    const formulas = extractFormulasFromMarkdown(md);
    expect(formulas.every(f => f.latex !== '100')).toBe(true);
    expect(formulas.every(f => f.latex !== '200')).toBe(true);
  });

  it('assigns sequential indices', () => {
    const md = loadOcrSample('page-mixed');
    const formulas = extractFormulasFromMarkdown(md);
    formulas.forEach((f, i) => {
      expect(f.index).toBe(i);
    });
  });

  it('includes position and raw fields', () => {
    const md = loadOcrSample('page-simple');
    const formulas = extractFormulasFromMarkdown(md);
    for (const f of formulas) {
      expect(typeof f.position).toBe('number');
      expect(typeof f.raw).toBe('string');
      expect(f.raw.length).toBeGreaterThan(0);
    }
  });

  it('provides context with [FORMULA] marker', () => {
    const md = loadOcrSample('page-simple');
    const formulas = extractFormulasFromMarkdown(md);
    for (const f of formulas) {
      expect(f.context).toContain('[FORMULA]');
    }
  });
});

describe('extractFromOcrResult', () => {
  it('extracts formulas from all pages', () => {
    const ocrResult = loadOcrResultSample();
    const result = extractFromOcrResult(ocrResult);
    expect(result.totalFormulas).toBeGreaterThan(0);
    expect(result.formulas.length).toBe(result.totalFormulas);
  });

  it('assigns pageIndex to each formula', () => {
    const ocrResult = loadOcrResultSample();
    const result = extractFromOcrResult(ocrResult);
    // Should have formulas from both pages
    const pageIndices = new Set(result.formulas.map(f => f.pageIndex));
    expect(pageIndices.size).toBe(2);
    expect(pageIndices.has(0)).toBe(true);
    expect(pageIndices.has(1)).toBe(true);
  });

  it('provides byType counts', () => {
    const ocrResult = loadOcrResultSample();
    const result = extractFromOcrResult(ocrResult);
    expect(result.byType.inline + result.byType.display).toBe(result.totalFormulas);
  });

  it('assigns globally sequential indices', () => {
    const ocrResult = loadOcrResultSample();
    const result = extractFromOcrResult(ocrResult);
    result.formulas.forEach((f, i) => {
      expect(f.index).toBe(i);
    });
  });
});
