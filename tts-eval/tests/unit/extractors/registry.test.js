import { describe, it, expect } from 'vitest';
import { getExtractor, listExtractors, getAvailableExtractors } from '../../../lib/extractors/registry.js';

describe('Extractor Registry', () => {
  it('listExtractors returns all registered names', () => {
    const names = listExtractors();
    expect(names).toContain('mistral');
    expect(names).toContain('pymupdf');
    expect(names).toContain('pymupdf-hybrid');
    expect(names).toContain('nougat');
    expect(names).toContain('marker');
    expect(names).toContain('mathpix');
    expect(names.length).toBe(6);
  });

  it('getExtractor returns mistral adapter', async () => {
    const ext = await getExtractor('mistral');
    expect(ext.name).toBe('mistral');
    expect(typeof ext.extract).toBe('function');
    expect(typeof ext.isAvailable).toBe('function');
    expect(typeof ext.getCacheKey).toBe('function');
  });

  it('getExtractor throws for unknown name', async () => {
    await expect(getExtractor('nonexistent')).rejects.toThrow('Unknown extractor: "nonexistent"');
  });

  it('getAvailableExtractors returns at least mistral when API key set', async () => {
    const available = await getAvailableExtractors();
    const names = available.map(a => a.name);
    // Mistral is available if MISTRAL_API_KEY is set
    if (process.env.MISTRAL_API_KEY) {
      expect(names).toContain('mistral');
    }
    // All returned extractors should report isAvailable() === true
    for (const { extractor } of available) {
      expect(extractor.isAvailable()).toBe(true);
    }
  });

  it('getExtractor passes options to adapter', async () => {
    const ext = await getExtractor('mistral', { paperId: 'test-123' });
    expect(ext.options.paperId).toBe('test-123');
  });
});
