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
  }, 120000);

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
  }, 120000);

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
  }, 120000);

  it('emits only rules with a WCAG basis', async () => {
    // mobile-small-text-400-zoom (px font < 12px) and landscape-excessive-height
    // (page taller than 8 viewports) were removed: browser zoom scales px text,
    // and no criterion limits page length (1.3.4 is about *locking* orientation).
    // Both fired on every healthy page of the golden corpus.
    const url = `${getBaseUrl()}/good-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const types = (result.violations || []).map(v => v.type);
      expect(types).not.toContain('mobile-small-text-400-zoom');
      expect(types).not.toContain('landscape-excessive-height');
    } finally {
      await page.close();
    }
  }, 120000);

  it('only reports overflow:hidden containers that really swallow text', async () => {
    const url = `${getBaseUrl()}/bad-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const clips = (result.violations || []).filter(v => v.type === 'mobile-overflow-hidden-400-zoom');
      expect(clips.length).toBeGreaterThan(0);
      for (const v of clips) {
        // measured evidence, not scrollWidth > clientWidth
        expect(v.details.clippedCharacters).toBeGreaterThan(0);
        expect(v.details.clippedTextSamples.length).toBeGreaterThan(0);
      }
      // one finding per element across all five device profiles
      const keys = clips.map(v => v.element);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await page.close();
    }
  }, 120000);

  it('does not flag a table inside an overflow-x:auto wrapper', async () => {
    const url = `${getBaseUrl()}/good-text-resize.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const tableFPs = (result.violations || []).filter(v => v.type === 'table-not-responsive');
      expect(tableFPs).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120000);

  it('leaves target-size findings to input-modalities (2.5.8)', async () => {
    // The 44px touch-target check was removed from this scanner (FP-1). It used
    // the AAA threshold, counted non-interactive elements and multiplied every
    // hit by five device profiles. bad-target-size.html is therefore no longer
    // this scanner's fixture — it is asserted by input-modalities.
    const url = `${getBaseUrl()}/bad-target-size.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const types = (result.violations || []).map(v => v.type);
      expect(types).not.toContain('touch-target-too-small');
      expect(types).not.toContain('touch-targets-too-close');
    } finally {
      await page.close();
    }
  }, 120000);

  it('detects reflow violations in bad-reflow.html', async () => {
    const url = `${getBaseUrl()}/bad-reflow.html`;
    const page = await getPage(url);
    try {
      const result = await scanner.scan(page);
      const real = (result.violations || []).filter(v => v.severity !== 'info');
      expect(real.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 120000);
});
