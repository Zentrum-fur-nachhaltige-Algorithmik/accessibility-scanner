import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const TextResizeScanner = require('../../src/scanners/text-resize');

describe('TextResizeScanner', () => {
  let scanner;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new TextResizeScanner();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('produces zero violations on good-text-resize.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-text-resize.html`);
    try {
      const result = await scanner.scan(page);
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 90000);

  it('produces zero violations on good-zoom-200-percent.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-zoom-200-percent.html`);
    try {
      const result = await scanner.scan(page);
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 90000);

  it('produces zero violations on good-reflow.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-reflow.html`);
    try {
      const result = await scanner.scan(page);
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 90000);

  it('reports the text that the enlargement cuts off, with the measured overshoot', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-text-resize.html`);
    try {
      const result = await scanner.scan(page);
      const clipped = result.violations.filter((v) => v.type === 'text-overflow');
      expect(clipped.length).toBeGreaterThan(0);
      for (const v of clipped) {
        expect(v.wcagCriteria).toBe('1.4.4');
        expect(v.details.clippedCharacters).toBeGreaterThan(0);
        expect(v.details.clippedTextSamples.length).toBeGreaterThan(0);
        expect(Math.max(v.details.overshootX, v.details.overshootY)).toBeGreaterThan(2);
      }
    } finally {
      await page.close();
    }
  }, 90000);

  it('reports nothing that the reference viewport already showed', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-text-resize.html`);
    try {
      const result = await scanner.scan(page);
      for (const v of result.violations) {
        expect(v.affectedViewports).toEqual(['desktop-200%']);
      }
    } finally {
      await page.close();
    }
  }, 90000);

  it('reports one finding per element across viewports', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-text-resize.html`);
    try {
      const result = await scanner.scan(page);
      const keys = result.violations.map((v) => `${v.type}::${v.blockedKey || v.element}`);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await page.close();
    }
  }, 90000);
});
