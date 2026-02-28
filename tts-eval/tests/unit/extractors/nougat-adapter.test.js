import { describe, it, expect } from 'vitest';
import { NougatAdapter } from '../../../lib/extractors/nougat-adapter.js';

describe('NougatAdapter', () => {
  it('has correct name', () => {
    const adapter = new NougatAdapter();
    expect(adapter.name).toBe('nougat');
  });

  it('getCacheKey returns paperId_nougat', () => {
    const adapter = new NougatAdapter();
    expect(adapter.getCacheKey('2303.16681')).toBe('2303.16681_nougat');
  });

  it('isAvailable returns boolean', () => {
    const adapter = new NougatAdapter();
    expect(typeof adapter.isAvailable()).toBe('boolean');
  });

  it('normalizes \\( \\) to $', () => {
    const adapter = new NougatAdapter();
    const result = adapter._normalizeDelimiters('The value \\(x\\) is \\(y + z\\).');
    expect(result).toContain('$x$');
    expect(result).toContain('$y + z$');
  });

  it('normalizes \\[ \\] to $$', () => {
    const adapter = new NougatAdapter();
    const result = adapter._normalizeDelimiters('Formula:\n\\[E = mc^2\\]');
    expect(result).toContain('$$E = mc^2$$');
  });

  it('respects useModal option', () => {
    const local = new NougatAdapter({ useModal: false });
    const modal = new NougatAdapter({ useModal: true });
    expect(local.useModal).toBe(false);
    expect(modal.useModal).toBe(true);
  });
});
