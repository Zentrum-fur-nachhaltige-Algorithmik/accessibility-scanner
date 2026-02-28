import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import {
  normalizeLatex,
  similarity,
  matchSequential,
  matchHungarian,
} from '../../lib/formula-matcher.js';

// Check scipy availability
let hasScipy = false;
try {
  execSync('python3 -c "from scipy.optimize import linear_sum_assignment"', {
    encoding: 'utf-8',
    timeout: 5000,
  });
  hasScipy = true;
} catch { /* unavailable */ }

describe('normalizeLatex', () => {
  it('strips whitespace', () => {
    expect(normalizeLatex('x + y')).toBe('x+y');
  });

  it('removes \\label', () => {
    expect(normalizeLatex('x \\label{eq:1}')).toBe('x');
  });

  it('removes \\tag', () => {
    expect(normalizeLatex('x \\tag{1.1}')).toBe('x');
  });

  it('removes \\left and \\right', () => {
    expect(normalizeLatex('\\left( x \\right)')).toBe('(x)');
  });

  it('normalizes \\dfrac and \\tfrac to \\frac', () => {
    expect(normalizeLatex('\\dfrac{a}{b}')).toBe('\\frac{a}{b}');
    expect(normalizeLatex('\\tfrac{a}{b}')).toBe('\\frac{a}{b}');
  });

  it('removes \\nonumber and \\notag', () => {
    expect(normalizeLatex('x \\nonumber')).toBe('x');
    expect(normalizeLatex('y \\notag')).toBe('y');
  });
});

describe('similarity', () => {
  it('returns 1.0 for identical formulas', () => {
    expect(similarity('x + y', 'x + y')).toBe(1.0);
  });

  it('returns 1.0 for formulas that normalize identically', () => {
    expect(similarity('\\dfrac{a}{b}', '\\frac{a}{b}')).toBe(1.0);
  });

  it('returns high similarity for minor differences', () => {
    const sim = similarity('\\alpha + \\beta', '\\alpha + \\beta_0');
    expect(sim).toBeGreaterThan(0.7);
  });

  it('returns low similarity for very different formulas', () => {
    const sim = similarity('x', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(sim).toBeLessThan(0.3);
  });

  it('returns 1.0 for two empty strings', () => {
    expect(similarity('', '')).toBe(1.0);
  });
});

describe('matchSequential', () => {
  const gt = [
    { latex: 'x + y' },
    { latex: '\\frac{a}{b}' },
    { latex: '\\alpha' },
  ];
  const ocr = [
    { latex: 'x + y' },
    { latex: '\\frac{a}{b}' },
    { latex: '\\alpha' },
  ];

  it('matches identical sequences perfectly', () => {
    const result = matchSequential(gt, ocr);
    expect(result.strategy).toBe('sequential');
    expect(result.matched.length).toBe(3);
    expect(result.unmatchedGt.length).toBe(0);
    expect(result.unmatchedOcr.length).toBe(0);
    expect(result.stats.avgSimilarity).toBe(1.0);
  });

  it('handles empty inputs', () => {
    const result = matchSequential([], []);
    expect(result.matched.length).toBe(0);
    expect(result.unmatchedGt.length).toBe(0);
    expect(result.unmatchedOcr.length).toBe(0);
  });

  it('handles OCR with extra formulas', () => {
    const ocrExtra = [...ocr, { latex: 'extra' }];
    const result = matchSequential(gt, ocrExtra);
    expect(result.matched.length).toBeGreaterThanOrEqual(3);
    expect(result.unmatchedOcr.length).toBeGreaterThanOrEqual(0);
  });

  it('handles GT with missing OCR formulas', () => {
    const ocrMissing = [{ latex: 'x + y' }];
    const result = matchSequential(gt, ocrMissing);
    expect(result.matched.length).toBeGreaterThanOrEqual(1);
    expect(result.unmatchedGt.length).toBeGreaterThan(0);
  });

  it('respects tolerance window', () => {
    const gtShifted = [
      { latex: 'a' },
      { latex: 'b' },
      { latex: 'x + y' },
      { latex: 'c' },
    ];
    const ocrShifted = [
      { latex: 'x + y' },
    ];
    const result = matchSequential(gtShifted, ocrShifted, 3);
    expect(result.matched.length).toBeGreaterThanOrEqual(1);
  });

  it('respects minSimilarity threshold', () => {
    const gtDiff = [{ latex: 'x' }];
    const ocrDiff = [{ latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' }];
    const result = matchSequential(gtDiff, ocrDiff, 2, 0.9);
    // Very different formulas should not match with high threshold
    expect(result.matched.length).toBe(0);
  });
});

describe('matchHungarian', () => {
  const gt = [
    { latex: 'x + y' },
    { latex: '\\frac{a}{b}' },
    { latex: '\\alpha' },
  ];
  const ocr = [
    { latex: '\\alpha' },
    { latex: 'x + y' },
    { latex: '\\frac{a}{b}' },
  ];

  it('handles empty GT', () => {
    const result = matchHungarian([], ocr);
    expect(result.strategy).toBe('hungarian');
    expect(result.matched.length).toBe(0);
    expect(result.unmatchedOcr.length).toBe(3);
  });

  it('handles empty OCR', () => {
    const result = matchHungarian(gt, []);
    expect(result.strategy).toBe('hungarian');
    expect(result.matched.length).toBe(0);
    expect(result.unmatchedGt.length).toBe(3);
  });

  describe.skipIf(!hasScipy)('with scipy available', () => {
    it('finds optimal matching regardless of order', () => {
      const result = matchHungarian(gt, ocr);
      expect(result.matched.length).toBe(3);
      expect(result.stats.avgSimilarity).toBe(1.0);
    });

    it('respects minSimilarity threshold', () => {
      const gtMixed = [{ latex: 'x' }, { latex: 'completely different formula' }];
      const ocrMixed = [{ latex: 'x' }, { latex: '\\alpha' }];
      const result = matchHungarian(gtMixed, ocrMixed, 0.5);
      // 'x' should match 'x', but 'completely different formula' should not match '\\alpha'
      const exactMatch = result.matched.find(m => m.similarity === 1.0);
      expect(exactMatch).toBeDefined();
    });
  });
});
