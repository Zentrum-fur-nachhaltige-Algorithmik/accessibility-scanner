import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const TextResizeScanner = require('../../src/phase6a-text-resize-scanner');

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

      const fixedSizeViolations = (result.violations || []).filter(v =>
        v.type === 'fixed-size'
      );
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

      const fixedSizeViolations = (result.violations || []).filter(v =>
        v.type === 'fixed-size'
      );
      expect(fixedSizeViolations).toEqual([]);
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
      expect(result.violations.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60000);
});
