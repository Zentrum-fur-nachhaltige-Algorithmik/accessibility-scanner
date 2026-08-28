import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const {
  computeOptimalPath,
  chooseReach,
  analyzeInPage,
  EVIDENCE_NOT_IN_READING_ORDER,
} = require('../../src/agent/optimal-path');

const HOME = '/agent/generic-home.html';
const LANDMARK = '/agent/optimal-landmark.html';
const MODAL = '/agent/good-modal.html';
const EQUIV = '/agent/optimal-equivalence.html';
const READ = '/agent/optimal-read.html';
const KEYS = '/agent/quick-keys.html';

const CONTACT_LINK = 'nav ul li:nth-of-type(3) a';

/**
 * Like `optimal`, but on a page whose `evaluate` counts how often the in-page
 * analysis really ran, and reporting the url the page ended on (the proof that
 * the steps were executed even when the analysis came from the cache).
 */
async function optimalCounted(fixture, sightedPath, options) {
  const page = await getPage(`${getBaseUrl()}${fixture}`);
  const evaluate = page.evaluate.bind(page);
  let analyses = 0;
  page.evaluate = (fn, ...args) => {
    if (fn === analyzeInPage) analyses += 1;
    return evaluate(fn, ...args);
  };
  try {
    const res = await computeOptimalPath(page, { id: 't', sightedPath }, {}, options);
    return { res, analyses, url: page.url() };
  } finally {
    await page.close();
  }
}

async function optimal(fixture, sightedPath, task = {}) {
  const page = await getPage(`${getBaseUrl()}${fixture}`);
  try {
    return await computeOptimalPath(page, { id: 't', sightedPath, ...task });
  } finally {
    await page.close();
  }
}

describe('agent/optimal-path: chooseReach (pure)', () => {
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

describe('agent/optimal-path: computeOptimalPath', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('reaches the last link on the page with one prevLink step: nOpt = 2', async () => {
    // "Contact" is the last link of generic-home.html and the rotor step
    // commands wrap, so Shift+L reaches it in one keystroke, cheaper than the
    // rotor list + jumpTo (2).
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

  it('reaches the only button of a page with one nextButton: nOpt = 2', async () => {
    const res = await optimal(LANDMARK, [{ action: 'click', selector: '#accept' }]);
    expect(res.nOpt).toBe(2);
    const step = res.steps[0];
    expect(step.reach).toMatchObject({ strategy: 'step', cost: 1 });
    expect(step.reach.via).toMatchObject({ kind: 'buttons', command: 'nextButton', steps: 1, k: 0 });
    // The rotor route to the same element is one command dearer, ...
    expect(step.analysis.rotor.cost).toBe(2);
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
    // `type` steps are never given an equivalence class, only click / Enter.
    expect(res.steps[0].equivalenceClassSize).toBe(1);
  }, 60000);

  it('reaches the first control of the page in one command (button step, tab as dear)', async () => {
    const res = await optimal(HOME, [{ action: 'click', selector: '#cookie-accept' }]);
    // One Tab and one B both land on it; on a tie the quick-nav key wins.
    expect(res.steps[0].analysis.tab).toEqual({ dir: 'tab', cost: 1 });
    expect(res.steps[0].reach).toMatchObject({ strategy: 'step', cost: 1 });
    expect(res.steps[0].reach.via).toMatchObject({ kind: 'buttons', command: 'nextButton' });
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
    expect(res.steps[0].reach).toMatchObject({ strategy: 'step', cost: 1 });
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
    // the identical href is the last link, so Shift+L reaches it in one.
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
    // there submits the same form, so the reach for the submit step is free.
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

  it('reaches the 2nd heading with one levelled heading step: nOpt = 2', async () => {
    const res = await optimal(EQUIV, [{ action: 'click', selector: '#section-two' }]);
    expect(res.error).toBeUndefined();
    // It is the only level-2 heading, so the digit key reaches it in one press,
    // while plain nextHeading has to pass the h1 first.
    expect(res.steps[0].reach).toMatchObject({ strategy: 'stepLevel', cost: 1 });
    expect(res.steps[0].reach.via).toMatchObject({
      kind: 'headings',
      level: 2,
      command: 'nextHeading',
      steps: 1,
      k: 0,
    });
    expect(res.steps[0].analysis.step).toMatchObject({ kind: 'headings', steps: 2, cost: 2 });
    expect(res.nOpt).toBe(2);
  }, 60000);

  it('reaches the last button with one prevButton, past seven other buttons', async () => {
    const res = await optimal(KEYS, [{ action: 'click', selector: '#b4' }], {
      description: 'Press the fourth button',
    });
    expect(res.error).toBeUndefined();
    expect(res.steps[0].reach).toMatchObject({ strategy: 'step', cost: 1 });
    expect(res.steps[0].reach.via).toMatchObject({
      kind: 'buttons',
      dir: 'prev',
      command: 'prevButton',
      steps: 1,
      k: 0,
    });
    expect(res.nOpt).toBe(2);
  }, 60000);

  it('picks the level of the target heading over the plain heading step', async () => {
    // Four h3 sit between the h1 and the only h2, so nextHeading needs five
    // presses (or prevHeading two); the digit key 2 needs one.
    const res = await optimal(KEYS, [{ action: 'click', selector: '#contact' }], {
      description: 'Open the contact section',
    });
    expect(res.error).toBeUndefined();
    expect(res.steps[0].reach).toMatchObject({ strategy: 'stepLevel', cost: 1 });
    expect(res.steps[0].reach.via).toMatchObject({
      kind: 'headings',
      level: 2,
      command: 'nextHeading',
      steps: 1,
      k: 0,
    });
    expect(res.steps[0].analysis.step.cost).toBeGreaterThan(1);
    expect(res.nOpt).toBe(2);
  }, 60000);

  it('searches with a word of the task description when that is the cheapest route', async () => {
    const res = await optimal(KEYS, [], {
      description: 'What are the ordination hours?',
      kind: 'information',
      evidence: 'Monday 08:00 to 12:00',
    });
    expect(res.error).toBeUndefined();
    expect(res.optimalPathError).toBeUndefined();
    const read = res.steps[0];
    expect(read.action).toBe('read');
    expect(read.reach).toMatchObject({ strategy: 'find', cost: 2 });
    expect(read.reach.via).toMatchObject({ word: 'ordination', findNexts: 0, k: 0 });
    // find (2) + hearing it (0), against 5 for the cheapest keystroke route.
    expect(res.nOpt).toBe(2);
    expect(res.readDistance).toBe(2);
    expect(read.analysis.stepLevel.cost).toBeGreaterThan(2);
  }, 60000);

  it('never searches with a word the task description does not contain', async () => {
    // Same page, same answer: only the wording of the task changed, so
    // "ordination" is knowledge the user does not have and `find` is out.
    const res = await optimal(KEYS, [], {
      description: 'Give me the winter timetable',
      kind: 'information',
      evidence: 'Monday 08:00 to 12:00',
    });
    expect(res.error).toBeUndefined();
    expect(res.steps[0].analysis.find).toBeNull();
    expect(res.steps[0].reach.strategy).not.toMatch(/^find/);
    expect(res.nOpt).toBe(5);
  }, 60000);

  it('reuses the cached page analysis for the members of one equivalence class', async () => {
    const res = await optimal(EQUIV, [{ action: 'click', selector: '#nav-contact' }]);
    // Both class members were costed from one reading-order walk.
    expect(res.steps[0].analysis.cacheHit).toBe(false);
    expect(res.steps[0].equivalenceClassSize).toBeGreaterThan(1);
  }, 60000);

  it('serves a shared analysisCache across pages without skipping the steps', async () => {
    const analysisCache = new Map();
    const sightedPath = [{ action: 'click', selector: CONTACT_LINK }];

    const first = await optimalCounted(HOME, sightedPath, { analysisCache });
    expect(first.res.error).toBeUndefined();
    expect(first.analyses).toBe(1);
    expect(first.res.steps[0].analysis.cacheHit).toBe(false);
    expect(analysisCache.size).toBe(1);

    // A second, unrelated page in the same state: same (url, fingerprint), so
    // the reading-order walk is not repeated ...
    const second = await optimalCounted(HOME, sightedPath, { analysisCache });
    expect(second.analyses).toBe(0);
    expect(second.res.nOpt).toBe(first.res.nOpt);
    expect(second.res.steps[0].reach).toEqual(first.res.steps[0].reach);
    expect(second.res.steps[0].analysis.cacheHit).toBe(true);
    // ... but the step itself still ran for real.
    expect(second.url).toContain('generic-contact.html');
    expect(first.url).toContain('generic-contact.html');

    // Without the cache the analysis runs again, with the same result.
    const third = await optimalCounted(HOME, sightedPath, {});
    expect(third.analyses).toBe(1);
    expect(third.res.nOpt).toBe(first.res.nOpt);
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

  it('appends a read step for an information task: nOpt = navigation + read', async () => {
    // The answer sits on the contact page, three commands into its reading
    // order. Costing only the `goto` would price "find the phone number" at 1.
    const res = await optimal(
      HOME,
      [{ action: 'goto', url: `${getBaseUrl()}/agent/generic-contact.html` }],
      { kind: 'information', evidence: 'Phone +49 30 1234567' }
    );
    expect(res.error).toBeUndefined();
    expect(res.optimalPathError).toBeUndefined();
    expect(res.steps).toHaveLength(2);

    const read = res.steps[1];
    expect(read).toMatchObject({
      index: 1,
      action: 'read',
      evidence: 'Phone +49 30 1234567',
      // Hearing the phrase IS the goal, so there is no action to pay for.
      actionCost: 0,
      selector: expect.stringContaining('p'),
    });
    // The phrase really carries the evidence, container and text in one stop.
    expect(read.phrase.toLowerCase()).toContain('phone +49 30 1234567');
    expect(read.phrase).toMatch(/^paragraph, /);
    // Reached with the ordinary strategies: nextHeading, then next x k.
    expect(read.reach).toMatchObject({ strategy: 'step+next', cost: 2 });
    expect(read.reach.via).toMatchObject({ kind: 'headings', command: 'nextHeading', k: 1 });
    // ... which is at most as dear as walking there with `next` alone.
    expect(read.analysis.next).toBeGreaterThanOrEqual(read.reach.cost);

    expect(res.readDistance).toBe(2);
    // goto (1 + 0) + read (2 + 0)
    expect(res.nOpt).toBe(3);
  }, 60000);

  it('costs the cheapest matching phrase and reports the read step from document start', async () => {
    const res = await optimal(READ, [], { kind: 'information', evidence: 'Phone 555 0100' });
    expect(res.error).toBeUndefined();
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0].action).toBe('read');
    expect(res.steps[0].analysis.cursorIndex).toBe(res.steps[0].analysis.docStartIndex);
    expect(res.nOpt).toBe(res.readDistance);
    expect(res.readDistance).toBeGreaterThan(0);
  }, 60000);

  it('matches the evidence case-insensitively and across whitespace runs', async () => {
    const res = await optimal(READ, [], {
      kind: 'information',
      evidence: '  phone   555\n0100  ',
    });
    expect(res.optimalPathError).toBeUndefined();
    expect(res.steps[0].action).toBe('read');
  }, 60000);

  it('reads an answer that is split over two adjacent nodes, one `next` more', async () => {
    // "Mobile 555 0111<br>Mon to Fri" is one visual line but two spoken
    // phrases. Hearing it means reaching the first and reading on.
    const split = await optimal(READ, [], {
      kind: 'information',
      evidence: 'Mobile 555 0111 Mon to Fri',
    });
    expect(split.optimalPathError).toBeUndefined();
    expect(split.steps).toHaveLength(1);
    const read = split.steps[0];
    expect(read.action).toBe('read');
    expect(read.spanPhrases).toBe(2);
    expect(read.reach.via.spanPhrases).toBe(2);
    expect(read.phrase.toLowerCase()).toContain('mobile 555 0111');
    expect(read.phrase.toLowerCase()).toContain('mon to fri');

    // Exactly one command more than reaching the first of the two phrases.
    const first = await optimal(READ, [], { kind: 'information', evidence: 'Mobile 555 0111' });
    expect(first.steps[0].spanPhrases).toBe(1);
    expect(read.reach.cost).toBe(first.steps[0].reach.cost + 1);
    expect(split.readDistance).toBe(first.readDistance + 1);
  }, 60000);

  it('reports evidence-not-in-reading-order when the text is never spoken', async () => {
    // "Fax 555 0199" is CSS-generated content: a sighted user reads it, the
    // screen reader never says it.
    const res = await optimal(READ, [], { kind: 'information', evidence: 'Fax 555 0199' });
    expect(res.error).toBeUndefined();
    expect(res.optimalPathError).toBe(EVIDENCE_NOT_IN_READING_ORDER);
    expect(res.nOptPartial).toBe(true);
    expect(res.readDistance).toBeNull();
    // The navigation part survives, so the task is still measurable.
    expect(res.nOpt).toBe(0);
    expect(res.steps.every((s) => s.action !== 'read')).toBe(true);
  }, 60000);

  it('leaves action tasks untouched (no read step, no readDistance)', async () => {
    const res = await optimal(HOME, [{ action: 'click', selector: CONTACT_LINK }], {
      kind: 'action',
      evidence: 'Phone +49 30 1234567',
    });
    expect(res.steps).toHaveLength(1);
    expect(res.readDistance).toBeUndefined();
    expect(res.nOpt).toBe(2);
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
