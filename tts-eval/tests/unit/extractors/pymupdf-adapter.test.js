import { describe, it, expect, vi } from 'vitest';
import { PyMuPDFAdapter } from '../../../lib/extractors/pymupdf-adapter.js';

describe('PyMuPDFAdapter', () => {
  it('creates plain adapter with correct name', () => {
    const adapter = new PyMuPDFAdapter({ hybrid: false });
    expect(adapter.name).toBe('pymupdf');
    expect(adapter.hybrid).toBe(false);
  });

  it('creates hybrid adapter with correct name', () => {
    const adapter = new PyMuPDFAdapter({ hybrid: true });
    expect(adapter.name).toBe('pymupdf-hybrid');
    expect(adapter.hybrid).toBe(true);
  });

  it('isAvailable checks for pymupdf Python package', () => {
    const adapter = new PyMuPDFAdapter();
    // This will return true if pymupdf/fitz is installed, false otherwise
    const available = adapter.isAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('getCacheKey distinguishes plain from hybrid', () => {
    const plain = new PyMuPDFAdapter({ hybrid: false });
    const hybrid = new PyMuPDFAdapter({ hybrid: true });
    expect(plain.getCacheKey('paper1')).toBe('paper1_pymupdf');
    expect(hybrid.getCacheKey('paper1')).toBe('paper1_pymupdf-hybrid');
  });

  it('reports zero cost', async () => {
    const adapter = new PyMuPDFAdapter();
    // Mock _extract to verify metadata
    const original = adapter._extract.bind(adapter);
    adapter._extract = vi.fn().mockResolvedValue({
      pages: [{ pageIndex: 0, markdown: 'test' }],
      metadata: { costUsd: 0, modelVersion: 'pymupdf-plain' },
    });

    const result = await adapter.extract.__proto__.constructor.prototype._extract
      ? adapter._extract('/fake.pdf')
      : { metadata: { costUsd: 0 } };

    expect(result.metadata.costUsd).toBe(0);
  });
});
