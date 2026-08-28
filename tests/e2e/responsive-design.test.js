import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const ResponsiveDesignScanner = require('../../src/scanners/responsive-design');

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

  it('produces zero violations on good-reflow.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-reflow.html`);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('produces zero 1.4.12 violations on good-text-spacing.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-text-spacing.html`);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result.violations.filter((v) => v.criterion === '9.1.4.12')).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('produces zero violations on good-fluid-container-and-truncation.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-fluid-container-and-truncation.html`);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('does not flag sr-only elements on good-skip-links.html', async () => {
    const page = await getPage(`${getBaseUrl()}/good-skip-links.html`);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      for (const v of result.violations) {
        expect(v.element || '').not.toMatch(/sr-only|visually-hidden/);
      }
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports one finding per element and issue on bad-reflow.html', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-reflow.html`);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result.violations.length).toBeGreaterThan(0);
      const keys = result.violations.map((v) => `${v.element}::${v.issue}::${v.criterion}`);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports the authored px width that overflows the 320px reference viewport', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-reflow.html`);
    try {
      const violations = await scanner.measureReflow(page);
      const fixed = violations.filter((v) => v.issue === 'fixed-width-element');
      expect(fixed.length).toBeGreaterThan(0);
      for (const v of fixed) {
        expect(v.description).toMatch(/(width|min-width): \d+(\.\d+)?px/);
        expect(v.criterion).toBe('9.1.4.10');
      }
      expect(violations.some((v) => v.issue === 'reflow-failure')).toBe(true);
    } finally {
      await page.close();
    }
  }, 60000);

  it('does not call fluid content wider than 320px a fixed-width element', async () => {
    // The table in good-text-spacing.html renders about 626px wide at the
    // reference viewport. Its computed width is a px length, but nothing in the
    // cascade declares one.
    const page = await getPage(`${getBaseUrl()}/good-text-spacing.html`);
    try {
      const violations = await scanner.measureReflow(page);
      expect(violations.filter((v) => v.issue === 'fixed-width-element')).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports text-spacing-failure only for text the injected spacing clips', async () => {
    const badPage = await getPage(`${getBaseUrl()}/bad-text-spacing.html`);
    try {
      await badPage.setViewport({ width: 1280, height: 800 });
      const violations = await scanner.measureTextSpacing(badPage);
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) {
        expect(v.issue).toBe('text-spacing-failure');
        expect(v.criterion).toBe('9.1.4.12');
        expect(v.element).toBeTruthy(); // one finding per element, not a page-level boolean
      }
    } finally {
      await badPage.close();
    }

    const goodPage = await getPage(`${getBaseUrl()}/good-text-spacing.html`);
    try {
      await goodPage.setViewport({ width: 1280, height: 800 });
      expect(await scanner.measureTextSpacing(goodPage)).toEqual([]);
    } finally {
      await goodPage.close();
    }
  }, 120000);

  it('does not claim 1.4.4, which text-resize owns', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-text-resize.html`);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(scanner.wcagCriteria).toEqual(['1.4.10', '1.4.12']);
      for (const v of result.violations) {
        expect(['9.1.4.10', '9.1.4.12']).toContain(v.criterion);
      }
    } finally {
      await page.close();
    }
  }, 60000);
});
