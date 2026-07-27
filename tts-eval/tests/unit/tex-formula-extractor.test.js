import { describe, it, expect } from 'vitest';
import {
  extractFormulas,
  classifyTier,
  extractCustomMacros,
  expandMacros,
  cleanFormula,
} from '../../lib/tex-formula-extractor.js';
import { loadTexFixture } from '../helpers/load-fixtures.js';

describe('extractFormulas', () => {
  it('extracts inline formulas from tier1 tex', () => {
    const tex = loadTexFixture('tier1');
    const formulas = extractFormulas(tex);
    const inlines = formulas.filter(f => f.type === 'inline');
    expect(inlines.length).toBeGreaterThan(0);
    expect(inlines.some(f => f.latex === 'x + y = z')).toBe(true);
    expect(inlines.some(f => f.latex === '\\alpha')).toBe(true);
  });

  it('extracts display formulas ($$...$$)', () => {
    const tex = loadTexFixture('tier2');
    const formulas = extractFormulas(tex);
    const displays = formulas.filter(f => f.type === 'display');
    expect(displays.length).toBeGreaterThan(0);
    expect(displays.some(f => f.latex.includes('\\frac{d}{dx}'))).toBe(true);
  });

  it('extracts display formulas from environments', () => {
    const tex = loadTexFixture('tier4');
    const formulas = extractFormulas(tex);
    const displays = formulas.filter(f => f.type === 'display');
    expect(displays.some(f => f.latex.includes('f(x) &= x^2'))).toBe(true);
    expect(displays.some(f => f.latex.includes('a + b = c'))).toBe(true);
  });

  it('extracts matrices and cases (tier3)', () => {
    const tex = loadTexFixture('tier3');
    const formulas = extractFormulas(tex);
    expect(formulas.some(f => f.latex.includes('\\begin{pmatrix}'))).toBe(true);
    expect(formulas.some(f => f.latex.includes('\\begin{cases}'))).toBe(true);
  });

  it('strips comments before extraction', () => {
    const tex = loadTexFixture('edge-cases');
    const formulas = extractFormulas(tex);
    // The formula inside the comment should not be extracted
    expect(formulas.every(f => f.latex !== 'fake formula')).toBe(true);
  });

  it('skips escaped dollar signs', () => {
    const tex = loadTexFixture('edge-cases');
    const formulas = extractFormulas(tex);
    // \$100 and \$200 should not produce formulas
    expect(formulas.every(f => f.latex !== '100')).toBe(true);
    expect(formulas.every(f => f.latex !== '200')).toBe(true);
  });

  it('skips pure-number formulas', () => {
    const tex = loadTexFixture('edge-cases');
    const formulas = extractFormulas(tex);
    expect(formulas.every(f => f.latex !== '42')).toBe(true);
  });

  it('assigns sequential indices', () => {
    const tex = loadTexFixture('tier1');
    const formulas = extractFormulas(tex);
    formulas.forEach((f, i) => {
      expect(f.index).toBe(i);
    });
  });

  it('provides context with [FORMULA] marker', () => {
    const tex = loadTexFixture('tier1');
    const formulas = extractFormulas(tex);
    for (const f of formulas) {
      expect(f.context).toContain('[FORMULA]');
    }
  });

  it('assigns line numbers', () => {
    const tex = loadTexFixture('tier1');
    const formulas = extractFormulas(tex);
    for (const f of formulas) {
      expect(f.lineNumber).toBeGreaterThan(0);
    }
  });
});

describe('classifyTier', () => {
  it('tier 1: simple formulas', () => {
    expect(classifyTier('x + y', 'inline')).toBe(1);
    expect(classifyTier('a^2', 'inline')).toBe(1);
    expect(classifyTier('\\alpha', 'inline')).toBe(1);
  });

  it('tier 2: fractions and sums', () => {
    expect(classifyTier('\\frac{a}{b}', 'inline')).toBe(2);
    expect(classifyTier('\\sum_{i=1}^{n} i', 'inline')).toBe(2);
    expect(classifyTier('\\int_0^1 f(x) dx', 'inline')).toBe(2);
    expect(classifyTier('\\prod_{k=1}^n k', 'inline')).toBe(2);
  });

  it('tier 3: matrices, cases, nested fractions', () => {
    expect(classifyTier('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'display')).toBe(3);
    expect(classifyTier('\\begin{cases} 1 \\\\ 0 \\end{cases}', 'display')).toBe(3);
    expect(classifyTier('\\frac{\\frac{a}{b}}{c}', 'inline')).toBe(3);
    expect(classifyTier('\\partial f + \\frac{a}{b}', 'inline')).toBe(3);
  });

  it('tier 4: multi-line environments', () => {
    expect(classifyTier('\\begin{align} a &= b \\\\ c &= d \\end{align}', 'display')).toBe(4);
    expect(classifyTier('\\begin{gather} a \\\\ b \\end{gather}', 'display')).toBe(4);
    expect(classifyTier('\\DeclareMathOperator{\\Foo}{foo}', 'display')).toBe(4);
  });
});

describe('extractCustomMacros', () => {
  it('extracts \\newcommand', () => {
    const tex = '\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\N}{\\mathbb{N}}';
    const macros = extractCustomMacros(tex);
    expect(macros['\\R']).toBeDefined();
    expect(macros['\\R'].expansion).toBe('\\mathbb{R}');
    expect(macros['\\R'].argCount).toBe(0);
    expect(macros['\\N'].expansion).toBe('\\mathbb{N}');
  });

  it('extracts \\renewcommand', () => {
    const tex = '\\renewcommand{\\phi}{\\varphi}';
    const macros = extractCustomMacros(tex);
    expect(macros['\\phi']).toBeDefined();
    expect(macros['\\phi'].expansion).toBe('\\varphi');
  });

  it('extracts \\def', () => {
    const tex = '\\def\\eps{\\varepsilon}';
    const macros = extractCustomMacros(tex);
    expect(macros['\\eps']).toBeDefined();
    expect(macros['\\eps'].expansion).toBe('\\varepsilon');
  });

  it('extracts \\DeclareMathOperator', () => {
    const tex = '\\DeclareMathOperator{\\Sing}{Sing}';
    const macros = extractCustomMacros(tex);
    expect(macros['\\Sing']).toBeDefined();
    expect(macros['\\Sing'].expansion).toBe('\\operatorname{Sing}');
  });

  it('tracks argument count for \\newcommand with args', () => {
    const tex = '\\newcommand{\\norm}[1]{\\left\\| #1 \\right\\|}';
    const macros = extractCustomMacros(tex);
    expect(macros['\\norm']).toBeDefined();
    expect(macros['\\norm'].argCount).toBe(1);
  });
});

describe('expandMacros', () => {
  it('expands zero-arg macros', () => {
    const macros = { '\\R': { expansion: '\\mathbb{R}', argCount: 0 } };
    expect(expandMacros('x \\in \\R', macros)).toBe('x \\in \\mathbb{R}');
  });

  it('does not expand macros with arguments', () => {
    const macros = { '\\norm': { expansion: '\\left\\| #1 \\right\\|', argCount: 1 } };
    expect(expandMacros('\\norm{x}', macros)).toBe('\\norm{x}');
  });

  it('does not expand partial matches', () => {
    const macros = { '\\R': { expansion: '\\mathbb{R}', argCount: 0 } };
    // \Real should not be affected by \R macro
    expect(expandMacros('\\Real', macros)).toBe('\\Real');
  });
});

describe('cleanFormula', () => {
  it('removes \\label', () => {
    expect(cleanFormula('x + y \\label{eq:sum}')).toBe('x + y');
  });

  it('removes \\tag', () => {
    expect(cleanFormula('a = b \\tag{1.1}')).toBe('a = b');
  });

  it('removes \\nonumber and \\notag', () => {
    expect(cleanFormula('x \\nonumber')).toBe('x');
    expect(cleanFormula('y \\notag')).toBe('y');
  });

  it('normalizes whitespace', () => {
    expect(cleanFormula('  x  +  y  ')).toBe('x + y');
  });
});
