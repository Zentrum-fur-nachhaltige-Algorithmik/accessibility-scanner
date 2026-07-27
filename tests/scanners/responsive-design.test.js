import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const ResponsiveDesignScanner = require('../../src/responsive-design-scanner');

describe('ResponsiveDesignScanner', () => {
  let scanner;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new ResponsiveDesignScanner();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('produces zero violations on good-reflow.html in heuristic-only mode', async () => {
    const url = `${getBaseUrl()}/good-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result).toBeDefined();
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('produces zero violations on good-text-resize.html in heuristic-only mode', async () => {
    const url = `${getBaseUrl()}/good-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result).toBeDefined();
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('produces zero text-spacing violations on good-text-spacing.html in heuristic-only mode', async () => {
    const url = `${getBaseUrl()}/good-text-spacing.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result).toBeDefined();
      // Only check text-spacing-specific violations (this file is designed for text-spacing compliance)
      const textSpacingViolations = result.violations.filter(v =>
        v.issue && v.issue.startsWith('text-spacing-')
      );
      expect(textSpacingViolations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('does not flag sr-only elements on good-skip-links.html', async () => {
    const url = `${getBaseUrl()}/good-skip-links.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result).toBeDefined();
      // No violations should reference sr-only elements
      for (const v of result.violations) {
        expect(v.element).not.toMatch(/sr-only|visually-hidden/);
      }
    } finally {
      await page.close();
    }
  }, 60000);

  it('deduplicates violations (no duplicate element+issue+criterion keys)', async () => {
    const url = `${getBaseUrl()}/bad-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result).toBeDefined();

      // Check for duplicates
      const keys = result.violations.map(v => `${v.element}::${v.issue}::${v.criterion}`);
      const unique = new Set(keys);
      expect(keys.length).toBe(unique.size);
    } finally {
      await page.close();
    }
  }, 60000);

  it('detects violations in bad-reflow.html', async () => {
    const url = `${getBaseUrl()}/bad-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result).toBeDefined();
      expect(result.violations.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60000);
});
