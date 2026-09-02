import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  startFixtureServer,
  startCrossOriginServer,
  stopFixtureServer,
  getBaseUrl,
} = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const { injectableCode: styleSheetCode } = require('../../src/utils/stylesheets');
const OrientationScanner = require('../../src/scanners/orientation');
const NonTextContrastScanner = require('../../src/scanners/nontext-contrast');
const UseOfColorScanner = require('../../src/scanners/use-of-color');

/**
 * A stylesheet on another origin renders but its `cssRules` throws, so every
 * rule that reads document.styleSheets sees a page with no CSS. These fixtures
 * put the declarations the four readers look for on the second origin.
 */
describe('cross-origin stylesheets', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await startCrossOriginServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('reads a cross-origin sheet the CSSOM refuses to expose', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-cross-origin-css.html`);
    try {
      const facts = await page.evaluate(async (code) => {
        eval(code);
        const linked = Array.from(document.styleSheets).find(
          (sheet) => sheet.href && sheet.href.includes('cross-origin-cues.css')
        );
        let opaque = false;
        try {
          void linked.cssRules;
        } catch (e) {
          opaque = true;
        }
        const { sheets, unreadable } = await __readStyleSheets();
        const selectors = [];
        const widths = [];
        for (const sheet of sheets) {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.selectorText) selectors.push(rule.selectorText);
            const width = rule.style && rule.style.getPropertyValue('width');
            if (width) widths.push(width);
          }
        }
        return { crossOrigin: !!linked, opaque, unreadable, selectors, widths };
      }, styleSheetCode);

      // The fixture really is served from the second origin and really is opaque.
      expect(facts.crossOrigin).toBe(true);
      expect(facts.opaque).toBe(true);
      expect(facts.unreadable).toEqual([]);
      // What the four readers look for, now visible: the hover and focus cue
      // (use-of-color) and the authored width (responsive-design).
      expect(facts.selectors.join(' ')).toContain(':hover');
      expect(facts.widths).toContain('1200px');
    } finally {
      await page.close();
    }
  }, 60000);

  it('orientation measures a lock declared in a cross-origin sheet', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-cross-origin-css.html`);
    try {
      const result = await new OrientationScanner().scan(page);
      expect(result.summary.unreadableStyleSheets).toBe(0);
      expect(result.violations.map((v) => v.issue)).toContain('orientation-lock-css');
    } finally {
      await page.close();
    }
  }, 90000);

  it('nontext-contrast measures a state colour declared in a cross-origin sheet', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-cross-origin-css.html`);
    try {
      const result = await new NonTextContrastScanner().scan(page, {
        checkInteractiveElements: false,
        checkGraphicalObjects: false,
        checkFocusIndicators: false,
      });
      expect(result.violations.map((v) => v.type)).toContain(
        'insufficient-interactive-state-contrast'
      );
    } finally {
      await page.close();
    }
  }, 90000);

  it('use-of-color asks a reviewer when the sheet cannot be read at all', async () => {
    const page = await getPage(`${getBaseUrl()}/good-unreadable-stylesheet.html`);
    try {
      const result = await new UseOfColorScanner().scan(page);
      expect(result.violations).toEqual([]);
      expect(result.summary.unreadableStyleSheets).toBeGreaterThan(0);
      expect(result.needsReview).toHaveLength(1);
      const finding = result.needsReview[0];
      expect(finding.verdict).toBe('needs-review');
      expect(finding.ruleId).toBe('link-color-only');
      expect(finding.dossier.question).toMatch(/no-cors-cues\.css/);
    } finally {
      await page.close();
    }
  }, 60000);
});
