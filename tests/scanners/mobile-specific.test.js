import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const MobileSpecificScanner = require('../../src/phase6d-mobile-specific-scanner');

describe('MobileSpecificScanner', () => {
  let scanner;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new MobileSpecificScanner();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('does not flag standard form controls as touch-target-too-small on good-accessibility.html', async () => {
    const url = `${getBaseUrl()}/good-accessibility.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();

      // Filter to touch-target violations on standard form controls
      const touchFPs = (result.violations || []).filter(v =>
        v.type === 'touch-target-too-small' &&
        v.details &&
        ['input', 'select', 'textarea', 'button'].includes(v.details.elementType) &&
        v.details.width >= 24 && v.details.height >= 24
      );
      expect(touchFPs).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('does not flag responsive elements as mobile-fixed-width-400-zoom on good-reflow.html', async () => {
    const url = `${getBaseUrl()}/good-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();

      const fixedWidthFPs = (result.violations || []).filter(v =>
        v.type === 'mobile-fixed-width-400-zoom'
      );
      expect(fixedWidthFPs).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('does not flag sr-only elements on good-skip-links.html', async () => {
    const url = `${getBaseUrl()}/good-skip-links.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();

      for (const v of result.violations || []) {
        expect(v.element).not.toMatch(/sr-only|visually-hidden/);
      }
    } finally {
      await page.close();
    }
  }, 60000);

  it('detects violations in bad-target-size.html', async () => {
    const url = `${getBaseUrl()}/bad-target-size.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      expect(result).toBeDefined();
      expect(result.violations.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 120000);
});
