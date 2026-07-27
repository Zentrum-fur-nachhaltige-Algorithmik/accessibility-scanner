import { describe, it, expect } from 'vitest';
import { MathpixAdapter } from '../../../lib/extractors/mathpix-adapter.js';

describe('MathpixAdapter', () => {
  it('has correct name', () => {
    const adapter = new MathpixAdapter();
    expect(adapter.name).toBe('mathpix');
  });

  it('isAvailable returns false without API keys', () => {
    // Only available if MATHPIX_APP_ID and MATHPIX_APP_KEY are set
    const adapter = new MathpixAdapter();
    const available = adapter.isAvailable();
    if (!process.env.MATHPIX_APP_ID || !process.env.MATHPIX_APP_KEY) {
      expect(available).toBe(false);
    } else {
      expect(available).toBe(true);
    }
  });

  it('getCacheKey returns paperId_mathpix', () => {
    const adapter = new MathpixAdapter();
    expect(adapter.getCacheKey('2303.16681')).toBe('2303.16681_mathpix');
  });

  it('normalizes \\( \\) delimiters to $ $', () => {
    const adapter = new MathpixAdapter();
    const result = adapter._normalizeDelimiters('text \\(x^2\\) more \\(y\\) end');
    expect(result).toContain('$x^2$');
    expect(result).toContain('$y$');
    expect(result).not.toContain('\\(');
  });

  it('normalizes \\[ \\] delimiters to $$ $$', () => {
    const adapter = new MathpixAdapter();
    const result = adapter._normalizeDelimiters('text \\[x^2 + y^2\\] end');
    expect(result).toContain('$$x^2 + y^2$$');
    expect(result).not.toContain('\\[');
  });

  it('estimates cost per page', () => {
    const adapter = new MathpixAdapter();
    expect(adapter._estimateCost(10)).toBe(0.1);
    expect(adapter._estimateCost(0)).toBe(0);
  });
});
