import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const ColorContrastScanner = require('../../src/scanners/color-contrast');

describe('ColorContrastScanner', () => {
  let scanner;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new ColorContrastScanner();
  });

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('detects enhanced-contrast violations in bad-color-contrast.html', async () => {
    const url = `${getBaseUrl()}/bad-color-contrast.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { wcagLevel: 'AAA' });

      expect(result).toBeDefined();
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.every((v) => v.wcagCriteria === '1.4.6')).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('reports nothing for a scan that does not ask for AAA', async () => {
    const url = `${getBaseUrl()}/bad-color-contrast.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);

      expect(result.violations).toEqual([]);
      expect(result.summary.evaluated).toBe(false);
    } finally {
      await page.close();
    }
  });

  it('finds no enhanced-contrast violations in good-contrast-enhanced.html', async () => {
    const url = `${getBaseUrl()}/good-contrast-enhanced.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { wcagLevel: 'AAA' });

      expect(result).toBeDefined();
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
