import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const { injectableCode: renderedCode } = require('../../src/utils/rendered');
const { collectTabWalk } = require('../../src/utils/keyboard-focus');

// The page the false-positive report is about, in miniature: a :focus-visible
// only focus ring, a display:none mobile nav, an off-canvas drawer, a
// tabindex="-1" skip-link target, an icon button, and two nav links that
// produce the same selector string.
const PAGE = `<!doctype html><html><head><style>
  :focus-visible { outline: 2px solid #1f3d32; }
  :focus:not(:focus-visible) { outline: none; }
  .mobile-nav { display: none; }
  .drawer { position: fixed; top: 0; left: 0; transform: translateX(-100%); width: 200px; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
  .noring { outline: none !important; }
  body { margin: 0 }
</style></head><body>
  <a href="#main" class="skip sr-only">Skip</a>
  <header>
    <nav class="nav"><a class="nav__link" href="/a">A</a><a class="nav__link" href="/b">B</a></nav>
    <button class="menu-btn" aria-label="Menü"><svg width="16" height="16"><path d="M0 0h16"/></svg></button>
    <nav class="mobile-nav"><a href="/m1">M1</a><a href="/m2">M2</a></nav>
    <div class="drawer"><a href="/d">Drawer link</a></div>
  </header>
  <main id="main" tabindex="-1">
    <button class="noring">no ring</button>
    <input id="i" aria-label="field">
    <div hidden><button>hidden btn</button></div>
    <span aria-hidden="true"><a href="/x">aria hidden</a></span>
  </main>
</body></html>`;

describe('utils/rendered', () => {
  let page;
  beforeAll(async () => {
    await launchBrowser();
    page = await getPage();
    await page.setContent(PAGE, { waitUntil: 'load' });
  }, 60000);
  afterAll(async () => {
    await page.close();
    await closeBrowser();
  });

  it('excludes display:none, off-canvas, hidden, aria-hidden and tabindex=-1 from focusable-rendered', async () => {
    const res = await page.evaluate((code) => {
      eval(code);
      const q = (s) => document.querySelector(s);
      return {
        navLink: __isFocusableRendered(q('.nav__link')),
        mobileNav: __isFocusableRendered(q('.mobile-nav a')),
        drawer: __isFocusableRendered(q('.drawer a')),
        hiddenBtn: __isFocusableRendered(q('[hidden] button')),
        ariaHidden: __isFocusableRendered(q('[aria-hidden] a')),
        mainTarget: __isFocusableRendered(q('#main')),
        mainIsTarget: __isInteractiveTarget(q('#main')),
        menuBtnTarget: __isInteractiveTarget(q('.menu-btn')),
        svgTarget: __isInteractiveTarget(q('.menu-btn svg')),
        skipSrOnly: __isSrOnly(q('.skip')),
      };
    }, renderedCode);
    expect(res).toEqual({
      navLink: true,
      mobileNav: false,
      drawer: false,
      hiddenBtn: false,
      ariaHidden: false,
      mainTarget: false,
      mainIsTarget: false,
      menuBtnTarget: true,
      svgTarget: false,
      skipSrOnly: true,
    });
  });

  it('separates structural focusability from being painted', async () => {
    const res = await page.evaluate((code) => {
      eval(code);
      const q = (s) => document.querySelector(s);
      return {
        drawerFocusable: __isFocusable(q('.drawer a')),
        drawerRendered: __isFocusableRendered(q('.drawer a')),
        mobileFocusable: __isFocusable(q('.mobile-nav a')),
        mainTarget: __isFocusable(q('#main')),
      };
    }, renderedCode);
    // Off-canvas / display:none controls stay structurally focusable so a focus
    // walk can record their unfocused baseline; only __isFocusableRendered
    // answers "is it painted right now".
    expect(res).toEqual({
      drawerFocusable: true,
      drawerRendered: false,
      mobileFocusable: true,
      mainTarget: false,
    });
  });
});

// A skip link built the way Tailwind builds them: parked off-canvas while
// unfocused, no outline at all, its only ring a box-shadow. Without an
// unfocused baseline for non-rendered elements the box-shadow diff is
// undetectable and the element looks ring-less.
const RING_PAGE = `<!doctype html><html><head><style>
  body { margin: 0 }
  .skip { position: fixed; top: 0; left: 0; transform: translateY(-100%); background: #fff; }
  .skip:focus-visible { transform: translateY(0); outline: none; box-shadow: 0 0 0 3px #1a56db; }
  .after:focus-visible { outline: 2px solid #1a56db; }
</style></head><body>
  <a href="#m" class="skip">Skip</a>
  <a href="/x" class="after">Next</a>
</body></html>`;

describe('utils/keyboard-focus baseline for hidden-until-focused controls', () => {
  let page;
  beforeAll(async () => {
    await launchBrowser();
    page = await getPage();
    await page.setContent(RING_PAGE, { waitUntil: 'load' });
  }, 60000);
  afterAll(async () => {
    await page.close();
    await closeBrowser();
  });

  it('sees :focus-visible while another tab is in front', async () => {
    // Chromium only matches :focus while the document HAS focus. The scan
    // pipeline runs scanners in parallel tabs and screenshots bring their tab
    // to the front, which would strip the ring from every element measured
    // afterwards; tabWalk pins the page with Emulation.setFocusEmulationEnabled.
    const other = await getPage();
    await other.setContent('<a href="/z">other tab</a>', { waitUntil: 'load' });
    await other.bringToFront();
    try {
      const steps = await collectTabWalk(page, { maxSteps: 10 });
      const next = steps.find((s) => s.text === 'Next');
      expect(next).toBeTruthy();
      expect(next.focusValid).toBe(true);
      expect(next.indicator.visible).toBe(true);
      expect(next.indicator.reasons).toContain('outline');
    } finally {
      await other.close();
      await page.bringToFront();
    }
  }, 60000);

  it('sees the box-shadow ring of an off-canvas skip link', async () => {
    const steps = await collectTabWalk(page, { maxSteps: 10 });
    const skip = steps.find((s) => s.text === 'Skip');
    expect(skip).toBeTruthy();
    expect(skip.indicator.baselineKnown).toBe(true);
    expect(skip.indicator.visible).toBe(true);
    expect(skip.indicator.reasons).toContain('box-shadow');
  }, 60000);
});

describe('utils/keyboard-focus tabWalk', () => {
  let page;
  beforeAll(async () => {
    await launchBrowser();
    page = await getPage();
    await page.setContent(PAGE, { waitUntil: 'load' });
  }, 60000);
  afterAll(async () => {
    await page.close();
    await closeBrowser();
  });

  it('walks every reachable element once, sees :focus-visible rings, and flags the ring-less button', async () => {
    const steps = await collectTabWalk(page, { maxSteps: 20 });
    const tags = steps.map((s) => `${s.tag}:${s.text}`);
    // The browser really does tab to the off-canvas drawer link and the
    // aria-hidden link (that is a defect of such pages); the walk reports
    // them with rendered:false so scanners can decide. display:none and
    // [hidden] are genuinely unreachable.
    expect(tags).toEqual([
      'a:Skip',
      'a:A',
      'a:B',
      'button:Menü',
      'a:Drawer link',
      'button:no ring',
      'input:field',
      'a:aria hidden',
    ]);
    expect(steps.filter((s) => !s.rendered).map((s) => s.text)).toEqual([
      'Drawer link',
      'aria hidden',
    ]);
    expect(new Set(steps.map((s) => s.tabId)).size).toBe(steps.length);
    expect(steps.some((s) => s.stuck)).toBe(false);

    const byText = Object.fromEntries(steps.map((s) => [s.text, s.indicator]));
    expect(byText['A'].visible).toBe(true);
    expect(byText['A'].reasons).toContain('outline');
    expect(byText['B'].visible).toBe(true);
    expect(byText['no ring'].visible).toBe(false);
    // A "no indicator" verdict is only allowed after tabWalk re-measured it
    // (second focused read + blur for a real unfocused baseline).
    expect(byText['no ring'].confirmed).toBe(true);
    expect(byText['no ring'].baselineKnown).toBe(true);
    expect(byText['A'].backdrop).toMatch(/^rgb\(/);
  }, 60000);

  it('removes its markers again', async () => {
    await collectTabWalk(page, { maxSteps: 20 });
    const { cleanupTabWalk } = require('../../src/utils/keyboard-focus');
    await cleanupTabWalk(page);
    const left = await page.evaluate(() => document.querySelectorAll('[data-a11y-tab-id]').length);
    expect(left).toBe(0);
  }, 60000);
});
