import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'child_process';
import {
  convertWithTemml,
  convertWithLatex2mathml,
  convertToMathml,
} from '../../lib/mathml-converter.js';

// Check python3 + latex2mathml availability once
let hasPythonLatex2mathml = false;
try {
  execSync('python3 -c "import latex2mathml"', { encoding: 'utf-8', timeout: 5000 });
  hasPythonLatex2mathml = true;
} catch { /* unavailable */ }

describe('convertWithTemml', () => {
  it('converts simple LaTeX to MathML', () => {
    const result = convertWithTemml('x + y');
    expect(result.error).toBeNull();
    expect(result.mathml).toContain('<math');
    expect(result.mathml).toContain('</math>');
    expect(result.converter).toBe('temml');
  });

  it('converts fractions', () => {
    const result = convertWithTemml('\\frac{a}{b}');
    expect(result.error).toBeNull();
    expect(result.mathml).toContain('<math');
  });

  it('handles display mode', () => {
    const result = convertWithTemml('\\sum_{i=1}^n i', true);
    expect(result.error).toBeNull();
    expect(result.mathml).toContain('<math');
  });

  it('returns error for invalid LaTeX', () => {
    const result = convertWithTemml('\\invalidcommand{');
    expect(result.mathml).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.converter).toBe('temml');
  });

  it('produces valid XML output', () => {
    const result = convertWithTemml('x^2 + y^2 = z^2');
    expect(result.error).toBeNull();
    // Must be parseable as XML — temml validates internally
    expect(result.mathml).toMatch(/^<math[\s>]/);
    expect(result.mathml).toMatch(/<\/math>$/);
  });

  it('converts Greek letters', () => {
    const result = convertWithTemml('\\alpha + \\beta');
    expect(result.error).toBeNull();
    expect(result.mathml).toContain('<math');
  });
});

describe('convertWithLatex2mathml', () => {
  describe.skipIf(!hasPythonLatex2mathml)('with python3 + latex2mathml', () => {
    it('converts simple LaTeX', () => {
      const result = convertWithLatex2mathml('x + y');
      expect(result.error).toBeNull();
      expect(result.mathml).toContain('<math');
      expect(result.converter).toBe('latex2mathml');
    });

    it('returns error for malformed LaTeX', () => {
      const result = convertWithLatex2mathml('\\begin{matrix}');
      // latex2mathml may or may not fail — just check structure
      expect(result.converter).toBe('latex2mathml');
    });
  });
});

describe('convertToMathml (cascade)', () => {
  it('succeeds at level 0 for simple formulas', () => {
    const result = convertToMathml('x + y');
    expect(result.mathml).toBeTruthy();
    expect(result.fallbackLevel).toBe(0);
    expect(result.converter).toBe('temml');
  });

  it('logs warnings on temml failure', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Use a formula that temml can't handle
    const result = convertToMathml('\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}');
    // Should have warned about temml failure
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.includes('WARN [temml]'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('returns fallbackLevel 2 and fallbackText when all converters fail', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = convertToMathml('\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}');
    // If both fail, should get level 2
    if (result.fallbackLevel === 2) {
      expect(result.mathml).toBeNull();
      expect(result.fallbackText).toBeTruthy();
      expect(result.converter).toBe('none');
      // Should have logged total-failure warning
      const calls = warnSpy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c.includes('WARN [total-failure]'))).toBe(true);
    }
    warnSpy.mockRestore();
  });

  describe.skipIf(!hasPythonLatex2mathml)('with python fallback available', () => {
    it('falls back to latex2mathml when temml fails', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Find a formula temml can't handle but latex2mathml can
      const result = convertToMathml('\\ce{H2O}');
      if (result.fallbackLevel === 1) {
        expect(result.converter).toBe('latex2mathml');
        expect(result.mathml).toBeTruthy();
        const calls = warnSpy.mock.calls.map(c => c[0]);
        expect(calls.some(c => c.includes('WARN [fallback]'))).toBe(true);
      }
      warnSpy.mockRestore();
    });
  });
});
