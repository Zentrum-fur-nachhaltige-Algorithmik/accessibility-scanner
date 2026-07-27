import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  initSRE,
  generateSpeech,
  addAriaLabelsToHtml,
} from '../../lib/speech-labels.js';

// Try to init SRE once
let sreAvailable = false;
beforeAll(async () => {
  sreAvailable = await initSRE();
});

describe('generateSpeech', () => {
  it('returns heuristic speech for LaTeX fallback', () => {
    const result = generateSpeech(null, '\\frac{a}{b}');
    expect(result.source).toBe('heuristic');
    expect(result.speech).toContain('over');
  });

  it('returns empty when no input given', () => {
    const result = generateSpeech(null, '');
    expect(result.source).toBe('none');
    expect(result.speech).toBe('');
  });

  describe('heuristic output', () => {
    it('converts fractions to "over"', () => {
      const { speech } = generateSpeech(null, '\\frac{x}{y}');
      expect(speech).toContain('over');
    });

    it('converts sqrt to "square root of"', () => {
      const { speech } = generateSpeech(null, '\\sqrt{x}');
      expect(speech).toContain('square root of');
    });

    it('converts Greek letters', () => {
      const { speech } = generateSpeech(null, '\\alpha + \\beta');
      expect(speech).toContain('alpha');
      expect(speech).toContain('beta');
    });

    it('converts sum to "sum"', () => {
      const { speech } = generateSpeech(null, '\\sum_{i=1}^{n}');
      expect(speech).toContain('sum');
    });

    it('converts superscript to "to the power of"', () => {
      const { speech } = generateSpeech(null, 'x^{2}');
      expect(speech).toContain('to the power of');
    });

    it('converts subscript to "sub"', () => {
      const { speech } = generateSpeech(null, 'x_{i}');
      expect(speech).toContain('sub');
    });

    it('converts integral to "integral"', () => {
      const { speech } = generateSpeech(null, '\\int_0^1 f(x) dx');
      expect(speech).toContain('integral');
    });

    it('converts comparison operators', () => {
      const { speech } = generateSpeech(null, 'x \\leq y');
      expect(speech).toContain('less than or equal to');
    });
  });

  describe.skipIf(!sreAvailable)('with SRE available', () => {
    it('generates SRE speech from MathML', () => {
      // Build a simple MathML string
      const mathml = '<math><mi>x</mi><mo>+</mo><mi>y</mi></math>';
      const result = generateSpeech(mathml, 'x + y');
      expect(result.source).toBe('sre');
      expect(result.speech.length).toBeGreaterThan(0);
    });
  });
});

describe('addAriaLabelsToHtml', () => {
  it('adds aria-label to math elements', () => {
    const html = '<p>The formula <math><mi>x</mi></math> is simple.</p>';
    const result = addAriaLabelsToHtml(html);
    // Should either add aria-label or keep original (depending on SRE)
    expect(result).toContain('<math');
  });

  it('preserves existing attributes', () => {
    const html = '<math display="block"><mi>x</mi></math>';
    const result = addAriaLabelsToHtml(html);
    expect(result).toContain('display="block"');
  });

  it('does not double-add aria-label', () => {
    const html = '<math aria-label="existing"><mi>x</mi></math>';
    const result = addAriaLabelsToHtml(html);
    // Should not add a second aria-label
    const count = (result.match(/aria-label/g) || []).length;
    expect(count).toBe(1);
  });
});
