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

  it('produces zero fixed-size violations on good-text-resize.html', async () => {
    const url = `${getBaseUrl()}/good-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();

      const fixedSizeViolations = (result.violations || []).filter((v) => v.type === 'fixed-size');
      expect(fixedSizeViolations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('does not flag responsive elements on good-reflow.html', async () => {
    const url = `${getBaseUrl()}/good-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();

      const fixedSizeViolations = (result.violations || []).filter((v) => v.type === 'fixed-size');
      expect(fixedSizeViolations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports no clipped text on good-text-resize.html', async () => {
    const url = `${getBaseUrl()}/good-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const clipped = (result.violations || []).filter((v) => v.type === 'text-overflow');
      expect(clipped).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('treats px font sizes / px widths in CSS as info, never as violations', async () => {
    // WCAG 1.4.4 is satisfied by browser zoom, which scales px text. A px
    // declaration is a hint at most — only measured clipping/overflow counts.
    const url = `${getBaseUrl()}/bad-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const cssSmells = (result.violations || []).filter((v) =>
        [
          'small-fixed-font',
          'fixed-width',
          'fixed-min-width',
          'restrictive-max-width',
          'overflow-hidden-fixed',
        ].includes(v.type)
      );
      expect(cssSmells.length).toBeGreaterThan(0);
      for (const v of cssSmells) expect(v.severity).toBe('info');
    } finally {
      await page.close();
    }
  }, 60000);

  it('detects violations in bad-text-resize.html', async () => {
    const url = `${getBaseUrl()}/bad-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();
      // must be real, measured findings — not just `info` CSS hints
      const real = (result.violations || []).filter((v) => v.severity !== 'info');
      expect(real.length).toBeGreaterThan(0);

      // fixed-height/fixed-width containers with overflow:hidden really do
      // swallow text at 200%/400% — with measured evidence attached
      const clipped = real.filter((v) => v.type === 'text-overflow');
      expect(clipped.length).toBeGreaterThan(0);
      for (const v of clipped) {
        expect(v.details.clippedCharacters).toBeGreaterThan(0);
        expect(v.details.clippedTextSamples.length).toBeGreaterThan(0);
        expect(Math.max(v.details.overshootX, v.details.overshootY)).toBeGreaterThan(2);
      }
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports one finding per element across viewports (dedup)', async () => {
    const url = `${getBaseUrl()}/bad-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const keys = (result.violations || [])
        .filter((v) => v.type === 'text-overflow')
        .map((v) => `${v.type}::${v.element}`);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await page.close();
    }
  }, 60000);
});
