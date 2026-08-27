import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const ResponsiveDesignScanner = require('../../src/responsive-design-scanner');

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('ResponsiveDesignScanner', () => {
  let scanner;
  let scanDir;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new ResponsiveDesignScanner();
    scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'responsive-scan-'));
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
    if (scanDir) fs.rmSync(scanDir, { recursive: true, force: true });
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
  // --- full (non-heuristic) measurement paths -------------------------------

  it('does not report fixed-width-element for fluid content wider than 320px', async () => {
    // good-text-spacing.html contains a fluid table that renders ~626px wide at
    // 320px viewport. Its computed width is a px length, but nothing declares a
    // fixed width — so it must not be reported as a fixed-width element.
    const url = `${getBaseUrl()}/good-text-spacing.html`;
    const page = await getPage(url);
    try {
      const violations = [];
      await scanner.testContentReflow(page, scanDir, violations, {});
      const fixed = violations.filter(v => v.issue === 'fixed-width-element');
      expect(fixed).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports fixed-width-element for authored px widths in bad-reflow.html', async () => {
    const url = `${getBaseUrl()}/bad-reflow.html`;
    const page = await getPage(url);
    try {
      const violations = [];
      await scanner.testContentReflow(page, scanDir, violations, {});
      const fixed = violations.filter(v => v.issue === 'fixed-width-element');
      expect(fixed.length).toBeGreaterThan(0);
      for (const v of fixed) {
        expect(v.description).toMatch(/width: \d+(\.\d+)?px/);
      }
      expect(violations.some(v => v.issue === 'reflow-failure')).toBe(true);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports text-spacing-failure only for text newly clipped by 1.4.12 spacing', async () => {
    const viewport = { width: 1280, height: 800, name: 'Desktop' };

    const badPage = await getPage(`${getBaseUrl()}/bad-text-spacing.html`);
    try {
      const violations = [];
      await badPage.setViewport({ width: viewport.width, height: viewport.height });
      await scanner.testTextSpacing(badPage, scanDir, viewport, violations);
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) {
        expect(v.issue).toBe('text-spacing-failure');
        expect(v.element).toBeTruthy(); // one finding per element, not a page-level boolean
      }
    } finally {
      await badPage.close();
    }

    const goodPage = await getPage(`${getBaseUrl()}/good-text-spacing.html`);
    try {
      const violations = [];
      await goodPage.setViewport({ width: viewport.width, height: viewport.height });
      await scanner.testTextSpacing(goodPage, scanDir, viewport, violations);
      expect(violations).toEqual([]);
    } finally {
      await goodPage.close();
    }
  }, 120000);
  it('no longer reports px font-size rules as a 1.4.4 failure', async () => {
    // Browser zoom scales px text like rem text — a px font-size alone is not a
    // resize failure (the small-text hint lives in the text-resize scanner).
    const url = `${getBaseUrl()}/bad-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page, { heuristicOnly: true });
      expect(result.violations.some(v => v.issue === 'text-resize-fixed-font')).toBe(false);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports text-resize-clip-risk only for measurably clipped text', async () => {
    const badPage = await getPage(`${getBaseUrl()}/bad-text-resize.html`);
    try {
      const result = await scanner.scan(badPage, { heuristicOnly: true });
      const clip = result.violations.filter(v => v.issue === 'text-resize-clip-risk');
      expect(clip.length).toBeGreaterThan(0);
      for (const v of clip) {
        // description carries the measured evidence, not just a CSS property
        expect(v.description).toMatch(/\d+ characters extend \d+px/);
      }
    } finally {
      await badPage.close();
    }

    const goodPage = await getPage(`${getBaseUrl()}/good-text-resize.html`);
    try {
      const result = await scanner.scan(goodPage, { heuristicOnly: true });
      expect(result.violations).toEqual([]);
    } finally {
      await goodPage.close();
    }
  }, 90000);
});
