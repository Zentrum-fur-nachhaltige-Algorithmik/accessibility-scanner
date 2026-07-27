import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseExtractor } from '../../../lib/extractors/base-extractor.js';
import fs from 'fs';
import path from 'path';

describe('BaseExtractor', () => {
  it('requires a name', () => {
    expect(() => new BaseExtractor()).toThrow('Extractor name is required');
    expect(() => new BaseExtractor('')).toThrow('Extractor name is required');
  });

  it('stores name and options', () => {
    const ext = new BaseExtractor('test', { foo: 'bar' });
    expect(ext.name).toBe('test');
    expect(ext.options.foo).toBe('bar');
  });

  it('getCacheKey returns paperId_name', () => {
    const ext = new BaseExtractor('pymupdf');
    expect(ext.getCacheKey('2303.16681')).toBe('2303.16681_pymupdf');
  });

  it('_extract throws not-implemented', async () => {
    const ext = new BaseExtractor('test');
    await expect(ext._extract('/tmp/test.pdf')).rejects.toThrow('not implemented');
  });

  it('isAvailable throws not-implemented', () => {
    const ext = new BaseExtractor('test');
    expect(() => ext.isAvailable()).toThrow('not implemented');
  });

  it('extract validates pdfPath exists', async () => {
    const ext = new BaseExtractor('test');
    ext._extract = vi.fn();
    await expect(ext.extract('/nonexistent/file.pdf')).rejects.toThrow('PDF not found');
  });

  it('extract validates result structure', async () => {
    const ext = new BaseExtractor('test');
    ext._extract = vi.fn().mockResolvedValue({ pages: 'not-an-array' });

    // Create a temp file to pass the existence check
    const tmpPath = '/tmp/test-base-extractor.pdf';
    fs.writeFileSync(tmpPath, 'fake pdf');

    await expect(ext.extract(tmpPath)).rejects.toThrow('must return { pages: [...] }');
    fs.unlinkSync(tmpPath);
  });

  it('extract attaches metadata with latency', async () => {
    const ext = new BaseExtractor('test');
    ext._extract = vi.fn().mockResolvedValue({
      pages: [{ pageIndex: 0, markdown: 'hello' }],
      metadata: { custom: 'data' },
    });

    const tmpPath = '/tmp/test-base-extractor2.pdf';
    fs.writeFileSync(tmpPath, 'fake pdf');

    const result = await ext.extract(tmpPath);

    expect(result.metadata.extractor).toBe('test');
    expect(result.metadata.totalPages).toBe(1);
    expect(typeof result.metadata.latencyMs).toBe('number');
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.processedAt).toBeTruthy();
    expect(result.metadata.custom).toBe('data');

    fs.unlinkSync(tmpPath);
  });

  it('validates page structure', async () => {
    const ext = new BaseExtractor('test');
    ext._extract = vi.fn().mockResolvedValue({
      pages: [{ pageIndex: 'not-a-number', markdown: 'hello' }],
      metadata: {},
    });

    const tmpPath = '/tmp/test-base-extractor3.pdf';
    fs.writeFileSync(tmpPath, 'fake pdf');

    await expect(ext.extract(tmpPath)).rejects.toThrow('pageIndex must be a number');
    fs.unlinkSync(tmpPath);
  });
});
