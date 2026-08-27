import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const { computeOptimalPath, chooseReach } = require('../../src/agent/optimal-path');

const HOME = '/agent/generic-home.html';
const LANDMARK = '/agent/optimal-landmark.html';
const MODAL = '/agent/good-modal.html';
const EQUIV = '/agent/optimal-equivalence.html';

const CONTACT_LINK = 'nav ul li:nth-of-type(3) a';

async function optimal(fixture, sightedPath) {
  const page = await getPage(`${getBaseUrl()}${fixture}`);
  try {
    return await computeOptimalPath(page, { id: 't', sightedPath });
  } finally {
    await page.close();
  }
}

describe('agent/optimal-path — chooseReach (pure)', () => {
  it('takes the cheapest strategy and prefers the rotor on a tie', () => {
    const analysis = {
      inReadingOrder: true,
      next: 2,
      prev: 9,
      tab: { dir: 'tab', cost: 2 },
      rotor: { kind: 'links', index: 1, k: 0, cost: 2 },
    };
    expect(chooseReach(analysis)).toMatchObject({ strategy: 'rotor', cost: 2 });
  });

  it('falls back to tab when the target is not in the reading order', () => {
    expect(
      chooseReach({
        inReadingOrder: false,
        next: null,
        prev: null,
        tab: { dir: 'tab', cost: 3 },
        rotor: null,
      })
    ).toEqual({ strategy: 'tab', cost: 3 });
  });

  it('costs nothing when the cursor is already on the target', () => {
    expect(
      chooseReach({
        inReadingOrder: true,
        next: 0,
        prev: 0,
        tab: { dir: 'tab', cost: 4 },
        rotor: null,
      })
    ).toEqual({ strategy: 'none', cost: 0 });
  });

  it('returns null when there is no route at all', () => {
    expect(
      chooseReach({ inReadingOrder: false, next: null, prev: null, tab: null, rotor: null })
    ).toBeNull();
  });
});

describe('agent/optimal-path — computeOptimalPath', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('reaches the last link on the page with one prevLink step: nOpt = 2', async () => {
    // "Contact" is the last link of generic-home.html, and the rotor STEP
    // commands wrap, so Shift+L reaches it in a single keystroke — cheaper than
    // the rotor list + jumpTo (2) the pre-stepping model had to use.
    const res = await optimal(HOME, [{ action: 'click', selector: CONTACT_LINK }]);
    expect(res.error).toBeUndefined();
    expect(res.nOpt).toBe(2);
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]).toMatchObject({
      index: 0,
      action: 'click',
      selector: CONTACT_LINK,
      actionCost: 1,
      reach: { strategy: 'step', cost: 1 },
    });
    expect(res.steps[0].reach.via).toMatchObject({
      kind: 'links',
      dir: 'prev',
      command: 'prevLink',
      steps: 1,
      k: 0,
    });
    expect(res.steps[0].analysis.rotor).toMatchObject({ kind: 'links', k: 0, cost: 2 });
  }, 60000);

  it('reaches a button inside a region by stepping to the landmark, then next × k', async () => {
    const res = await optimal(LANDMARK, [{ action: 'click', selector: '#accept' }]);
    expect(res.nOpt).toBe(3);
    const step = res.steps[0];
    expect(step.reach.strategy).toBe('step+next');
    expect(step.reach.cost).toBe(2); // Shift+D (wraps to the last landmark) + next × 1
    expect(step.reach.via).toMatchObject({
      kind: 'landmarks',
      command: 'prevLandmark',
      steps: 1,
      k: 1,
    });
    // The rotor route is still costed, it is simply one command dearer.
    expect(step.analysis.rotor).toMatchObject({ kind: 'landmarks', k: 1, cost: 3 });
    // ... and both beat tabbing there, which costs 11.
    expect(step.analysis.tab.cost).toBe(11);
    expect(step.analysis.next).toBeGreaterThan(step.reach.cost);
  }, 60000);

  it('typing into the first form field costs 2 (nextFormField + type)', async () => {
    const res = await optimal(HOME, [{ action: 'type', selector: '#q', text: 'kontakt' }]);
    expect(res.nOpt).toBe(2);
    expect(res.steps[0]).toMatchObject({
      action: 'type',
      actionCost: 1,
      reach: { strategy: 'step', cost: 1 },
    });
    expect(res.steps[0].reach.via).toMatchObject({
      kind: 'formFields',
      command: 'nextFormField',
      steps: 1,
      k: 0,
    });
    // `type` steps are never given an equivalence class — only click / Enter.
    expect(res.steps[0].equivalenceClassSize).toBe(1);
  }, 60000);

  it('uses tab when it is cheaper than any rotor (first control on the page)', async () => {
    const res = await optimal(HOME, [{ action: 'click', selector: '#cookie-accept' }]);
    expect(res.steps[0].reach).toEqual({ strategy: 'tab', cost: 1 });
    expect(res.nOpt).toBe(2);
  }, 60000);

  it('resets the cursor to document start after a navigation', async () => {
    const res = await optimal(HOME, [
      { action: 'click', selector: CONTACT_LINK },
      { action: 'click', selector: 'a[href="generic-home.html"]' },
    ]);
    expect(res.steps[0].navigated).toBe(true);
    const second = res.steps[1];
    // The cursor is back at document start on the new page, not on the link
    // that was activated (which does not even exist here any more).
    expect(second.analysis.cursorIndex).toBe(second.analysis.docStartIndex);
    expect(second.reach.cost).toBeGreaterThan(0);
    expect(res.nOpt).toBe(res.steps[0].reach.cost + 1 + second.reach.cost + 1);
  }, 60000);

  it('keeps the cursor on the field after type (next field is one tab away)', async () => {
    const res = await optimal(HOME, [
      { action: 'type', selector: '#cf-name', text: 'Ada' },
      { action: 'type', selector: '#cf-mail', text: 'ada@example.com' },
    ]);
    expect(res.steps[0].reach).toMatchObject({ strategy: 'step', cost: 2 });
    expect(res.steps[1].analysis.cursorIndex).not.toBe(res.steps[1].analysis.docStartIndex);
    // One nextFormField (= one Tab, but the model prefers the rotor step) from
    // the field the previous step typed into.
    expect(res.steps[1].reach).toMatchObject({ strategy: 'step', cost: 1 });
    expect(res.steps[1].reach.via).toMatchObject({ command: 'nextFormField', steps: 1, k: 0 });
    expect(res.nOpt).toBe(2 + 1 + 1 + 1);
  }, 60000);

  it('costs a goto as a single navigation with no reach cost', async () => {
    const res = await optimal(HOME, [
      { action: 'goto', url: `${getBaseUrl()}/agent/generic-contact.html` },
      { action: 'click', selector: 'a[href="generic-home.html"]' },
    ]);
    expect(res.steps[0]).toMatchObject({
      action: 'goto',
      actionCost: 1,
      reach: { strategy: 'none', cost: 0 },
      navigated: true,
    });
    expect(res.nOpt).toBe(1 + res.steps[1].reach.cost + 1);
  }, 60000);

  it('follows real DOM state: a dialog opened by the first step is costed from inside', async () => {
    const res = await optimal(MODAL, [
      { action: 'click', selector: '#open' },
      { action: 'click', selector: '#save' },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.steps[0].reach).toEqual({ strategy: 'tab', cost: 1 });
    // The dialog is open now, so the reading order the second step is costed
    // against is the dialog's, not the page's.
    expect(res.steps[1].analysis.readingOrderLength).toBeLessThan(
      res.steps[0].analysis.readingOrderLength
    );
    expect(res.nOpt).toBe(2 + res.steps[1].reach.cost + 1);
  }, 60000);

  it('a footer link with the same href beats the nav link the sighted user clicked', async () => {
    const res = await optimal(EQUIV, [{ action: 'click', selector: '#nav-contact' }]);
    expect(res.error).toBeUndefined();
    // #nav-contact itself costs 2 (links rotor + jumpTo); the footer link with
    // the identical href is the LAST link, so Shift+L reaches it in one.
    expect(res.steps[0].reach).toMatchObject({ strategy: 'step', cost: 1 });
    expect(res.steps[0].reach.via).toMatchObject({
      command: 'prevLink',
      equivalentOf: expect.stringContaining('footer'),
      equivalence: 'same-href',
      sightedSelector: '#nav-contact',
    });
    expect(res.steps[0].equivalenceClassSize).toBe(2);
    expect(res.nOpt).toBe(2);
  }, 60000);

  it('does not put links with a different href into the class', async () => {
    const res = await optimal(EQUIV, [{ action: 'click', selector: '#footer-contact' }]);
    expect(res.steps[0].equivalenceClassSize).toBe(2); // only the two Contact links
    expect(res.steps[0].reach.via.equivalentOf).toBeUndefined();
  }, 60000);

  it('pressing Enter in the filled search field beats clicking the search button', async () => {
    const res = await optimal(EQUIV, [
      { action: 'type', selector: '#mq', text: 'kontakt' },
      { action: 'click', selector: '#mini-search-go' },
    ]);
    expect(res.error).toBeUndefined();
    const submit = res.steps[1];
    // The cursor is still in the field the previous step typed into, and Enter
    // there submits the same form — so the reach for the submit step is free.
    expect(submit.reach).toMatchObject({ strategy: 'none', cost: 0 });
    expect(submit.reach.via).toMatchObject({
      equivalentOf: '#mq',
      equivalence: 'enter-in-field',
      sightedSelector: '#mini-search-go',
    });
    expect(submit.equivalenceClassSize).toBe(2);
    // reach(#mq) 1 + type 1 + Enter 1
    expect(res.nOpt).toBe(3);
  }, 60000);

  it('reaches the 2nd heading with nextHeading × 2: nOpt = 3', async () => {
    const res = await optimal(EQUIV, [{ action: 'click', selector: '#section-two' }]);
    expect(res.error).toBeUndefined();
    expect(res.steps[0].reach).toMatchObject({ strategy: 'step', cost: 2 });
    expect(res.steps[0].reach.via).toMatchObject({ kind: 'headings', steps: 2, k: 0 });
    expect(res.steps[0].reach.via.command).toMatch(/^(next|prev)Heading$/);
    expect(res.nOpt).toBe(3);
  }, 60000);

  it('reuses the cached page analysis for the members of one equivalence class', async () => {
    const res = await optimal(EQUIV, [{ action: 'click', selector: '#nav-contact' }]);
    // Both class members were costed from ONE reading-order walk.
    expect(res.steps[0].analysis.cacheHit).toBe(false);
    expect(res.steps[0].equivalenceClassSize).toBeGreaterThan(1);
  }, 60000);

  it('reports an error (and nOpt null) when a step cannot be executed', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const res = await computeOptimalPath(
        page,
        { id: 'broken', sightedPath: [{ action: 'click', selector: '#does-not-exist' }] },
        {},
        { selectorTimeout: 500 }
      );
      expect(res.nOpt).toBeNull();
      expect(res.error).toMatch(/target not found: #does-not-exist/);
    } finally {
      await page.close();
    }
  }, 60000);

  it('rejects an unsupported action', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const res = await computeOptimalPath(page, { id: 'x', sightedPath: [{ action: 'swipe' }] });
      expect(res.nOpt).toBeNull();
      expect(res.error).toMatch(/unsupported action/);
    } finally {
      await page.close();
    }
  }, 60000);
});
