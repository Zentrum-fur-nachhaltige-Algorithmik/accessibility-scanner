import { describe, it, expect } from 'vitest';
import { MarkerAdapter } from '../../../lib/extractors/marker-adapter.js';

describe('MarkerAdapter', () => {
  it('has correct name', () => {
    const adapter = new MarkerAdapter();
    expect(adapter.name).toBe('marker');
  });

  it('getCacheKey returns paperId_marker', () => {
    const adapter = new MarkerAdapter();
    expect(adapter.getCacheKey('2303.16681')).toBe('2303.16681_marker');
  });

  it('isAvailable returns boolean', () => {
    const adapter = new MarkerAdapter();
    expect(typeof adapter.isAvailable()).toBe('boolean');
  });

  it('respects useModal option', () => {
    const local = new MarkerAdapter({ useModal: false });
    const modal = new MarkerAdapter({ useModal: true });
    expect(local.useModal).toBe(false);
    expect(modal.useModal).toBe(true);
  });
});
