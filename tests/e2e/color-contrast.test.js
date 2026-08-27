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

  it('detects violations in bad-color-contrast.html', async () => {
    const url = `${getBaseUrl()}/bad-color-contrast.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);

      expect(result).toBeDefined();
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('finds no color-contrast violations in good-accessibility.html', async () => {
    const url = `${getBaseUrl()}/good-accessibility.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);

      expect(result).toBeDefined();
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
