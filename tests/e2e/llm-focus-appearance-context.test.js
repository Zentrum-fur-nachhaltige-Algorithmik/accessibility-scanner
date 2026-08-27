import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const LLMFocusAppearanceScanner = require('../../src/scanners/llm/focus-appearance');

/** The scanner requires *an* llmClient; these tests never call it. */
const stubClient = { predict: async () => { throw new Error('LLM must not be called in this test'); } };

// The FP-6 page in miniature: a :focus-visible-only ring (invisible to
// element.focus()), a link INSIDE a sticky header (must not count as obscured
// by its own ancestor) and a fixed cookie bar that really does cover content.
const PAGE = `<!doctype html><html><head><style>
  body { margin: 0; }
  :focus-visible { outline: 2px solid #1f3d32; }
  :focus:not(:focus-visible) { outline: none; }
  header.header { position: sticky; top: 0; height: 60px; background: #fff; }
  .cookie { position: fixed; left: 0; right: 0; bottom: 0; height: 200px; background: #fff; z-index: 9; }
  main { height: 400px; background: #fff; }
  .covered { position: absolute; top: 300px; left: 0; }
</style></head><body>
  <header class="header"><nav><a class="nav__link" href="/a">A</a><button class="menu-btn" aria-label="Menü">M</button></nav></header>
  <main><a class="covered" href="/c">Behind the cookie bar</a></main>
  <div class="cookie">Cookies</div>
</body></html>`;

describe('llm-focus-appearance: measured context', () => {
  let page, scanner, ctx;

  beforeAll(async () => {
    await launchBrowser();
    page = await getPage();
    await page.setViewport({ width: 1024, height: 500 });
    await page.setContent(PAGE, { waitUntil: 'load' });
    scanner = new LLMFocusAppearanceScanner(stubClient);
    ctx = await scanner.collectFocusContext(page);
  }, 60000);

  afterAll(async () => { await page.close(); await closeBrowser(); });

  it('sees the :focus-visible ring that element.focus() misses', async () => {
    const menu = ctx.stops.find((s) => s.selector.includes('menu-btn'));
    expect(menu, JSON.stringify(ctx.stops)).toBeTruthy();
    expect(menu.indicatorVisible).toBe(true);
    expect(menu.outlineWidthPx).toBeGreaterThanOrEqual(2);
    expect(menu.indicatorContrast).toBeGreaterThanOrEqual(3);
  });

  it('never treats an ancestor as an obscuring element', () => {
    const link = ctx.stops.find((s) => s.selector.includes('nav__link'));
    expect(link.obscured.measured).toBe(true);
    // The link lives inside the sticky header — that is not occlusion.
    expect(link.obscured.anyPartObscured).toBe(false);
  });

  it('detects a real fixed overlay covering a focused element', () => {
    const covered = ctx.stops.find((s) => s.selector.includes('covered'));
    expect(covered.obscured.anyPartObscured).toBe(true);
    expect(covered.obscured.coveredBy).toContain('cookie');
    expect(covered.obscured.covererPosition).toBe('fixed');
  });
});

describe('llm-focus-appearance: code guards', () => {
  const scanner = new LLMFocusAppearanceScanner(stubClient);
  const goodStop = (sel) => ({
    selector: sel, tag: 'button', text: sel, indicatorVisible: true,
    indicatorReasons: ['outline'], outline: 'solid 2px rgb(31,61,50)',
    outlineWidthPx: 2, indicatorContrast: 11.19, lowContrastIndicator: false,
    obscured: { measured: true, sampledPoints: 9, coveredPoints: 0, anyPartObscured: false, entirelyObscured: false, coveredBy: null },
  });

  it('marks a fully compliant page as such', () => {
    const g = scanner.evaluateGuards([goodStop('.menu-btn'), goodStop('.nav__link')]);
    expect(g.allIndicatorsCompliant).toBe(true);
    expect(g.noneObscured).toBe(true);
    expect(g.minIndicatorContrast).toBe(11.19);
  });

  it('rejects the FP-6 claim ".menu-btn has no focus indicator"', () => {
    const g = scanner.evaluateGuards([goodStop('.menu-btn'), goodStop('.nav__link')]);
    const v = { ruleId: '2.4.13', description: 'The .menu-btn element has no visible focus indicator', nodes: [{ selector: '.menu-btn' }] };
    expect(scanner.rejectionReason(v, g)).toMatch(/tab stops/);
  });

  it('rejects an obscuring claim when nothing was measured as covered', () => {
    const g = scanner.evaluateGuards([goodStop('.menu-btn')]);
    const v = { ruleId: '2.4.12', description: 'Sticky header may cover focused elements', nodes: [] };
    expect(scanner.rejectionReason(v, g)).toMatch(/no tab stop was covered/);
  });

  it('rejects a per-element FP-6 claim even when the page as a whole fails', () => {
    // Evergreen home: 8 footer links really do fail (1.41:1), the menu button
    // does not — the old scanner reported exactly the compliant one.
    const weakFooter = { ...goodStop('.footer__list a'), indicatorVisible: false, indicatorReasons: [], indicatorContrast: 1.41, lowContrastIndicator: true };
    const g = scanner.evaluateGuards([goodStop('header.header > button.menu-btn'), weakFooter]);
    expect(g.allIndicatorsCompliant).toBe(false);
    const fp6 = { ruleId: '2.4.13', description: 'The `.menu-btn` element has no visible focus indicator', nodes: [{ selector: '.menu-btn' }] };
    expect(scanner.rejectionReason(fp6, g)).toMatch(/11\.19:1/);
    // …while the genuine footer finding survives.
    const real = { ruleId: '2.4.13', description: 'Footer links have an insufficient focus indicator at 1.41:1', nodes: [{ selector: '.footer__list a' }] };
    expect(scanner.rejectionReason(real, g)).toBeNull();
  });

  it('keeps findings when the measurement supports them', () => {
    const weak = { ...goodStop('.thin'), outlineWidthPx: 1, indicatorContrast: 1.2, lowContrastIndicator: true, indicatorVisible: false, indicatorReasons: [] };
    const obscured = { ...goodStop('.hidden-link'), obscured: { measured: true, sampledPoints: 9, coveredPoints: 4, anyPartObscured: true, entirelyObscured: false, coveredBy: 'div.cookie' } };
    const g = scanner.evaluateGuards([weak, obscured]);
    expect(g.allIndicatorsCompliant).toBe(false);
    expect(g.noneObscured).toBe(false);
    expect(scanner.rejectionReason({ ruleId: '2.4.13', description: '.thin has a 1px outline at 1.2:1 — insufficient focus indicator', nodes: [] }, g)).toBeNull();
    expect(scanner.rejectionReason({ ruleId: '2.4.12', description: '.hidden-link is covered by div.cookie', nodes: [] }, g)).toBeNull();
  });

  it('states the measured facts in the prompt instead of a fixed/sticky dump', () => {
    const g = scanner.evaluateGuards([goodStop('.menu-btn')]);
    const prompt = scanner.buildPrompt([goodStop('.menu-btn')], g);
    expect(prompt).toContain('VERIFIED BY MEASUREMENT');
    expect(prompt).toContain('Do NOT report a missing');
    expect(prompt).toContain('Do NOT report 2.4.12 obscuring');
    expect(prompt).not.toContain('el.focus()');
  });
});
