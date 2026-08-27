import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getBrowser } = require('../helpers/browser-pool');
const { createRequestRecorder } = require('../../src/agent/oracle');
const {
  computeBfsOptimum,
  compareOptima,
  transitionsFor,
  reachCommands,
  typeTextsOf,
  isLocalOrigin,
} = require('../../src/agent/bfs-optimum');

const CONTACT_ORACLE = { type: 'urlMatches', pattern: 'bfs-contact\\.html' };

/** home → Products → Contact, while the footer links straight to Contact. */
const SHORTCUT_TASK = {
  id: 'bfs-shortcut',
  description: 'Get to the page where you can contact us.',
  oracle: CONTACT_ORACLE,
  sightedPath: [
    { action: 'click', selector: 'a[href="bfs-products.html"]' },
    { action: 'click', selector: 'a[href="bfs-contact.html"]' },
  ],
};

/** The same two-click task, but on a page without the footer shortcut. */
const DEEP_TASK = { ...SHORTCUT_TASK, id: 'bfs-deep' };

const SIMPLE_TASK = {
  id: 'bfs-simple',
  description: 'Get to the page where you can contact us.',
  oracle: CONTACT_ORACLE,
  sightedPath: [{ action: 'click', selector: 'a[href="bfs-contact.html"]' }],
};

const POST_TASK = {
  id: 'bfs-post',
  description: 'Fill in your name and then go to the contact page.',
  oracle: CONTACT_ORACLE,
  sightedPath: [
    { action: 'type', selector: '#pf-name', text: 'Ada' },
    { action: 'click', selector: 'a[href="bfs-contact.html"]' },
  ],
};

describe('agent/bfs-optimum: cost model (pure)', () => {
  it('turns a reach strategy into exactly `cost` env commands', () => {
    expect(reachCommands({ strategy: 'none', cost: 0 })).toEqual([]);
    expect(
      reachCommands({ strategy: 'rotor', cost: 2, via: { kind: 'links', index: 4, k: 0 } })
    ).toEqual([{ type: 'links' }, { type: 'jumpTo', arg: 4 }]);
    expect(
      reachCommands({
        strategy: 'step',
        cost: 2,
        via: { kind: 'headings', dir: 'next', command: 'nextHeading', steps: 2, k: 0 },
      })
    ).toEqual([{ type: 'nextHeading' }, { type: 'nextHeading' }]);
    expect(
      reachCommands({
        strategy: 'step+next',
        cost: 3,
        via: { kind: 'landmarks', dir: 'prev', command: 'prevLandmark', steps: 1, k: 2 },
      })
    ).toEqual([{ type: 'prevLandmark' }, { type: 'next' }, { type: 'next' }]);
    const withNext = reachCommands({
      strategy: 'rotor+next',
      cost: 4,
      via: { kind: 'landmarks', index: 1, k: 2 },
    });
    expect(withNext).toHaveLength(4);
    expect(withNext.slice(2)).toEqual([{ type: 'next' }, { type: 'next' }]);
    expect(reachCommands({ strategy: 'tab', cost: 3 })).toHaveLength(3);
    expect(reachCommands({ strategy: 'shiftTab', cost: 2 })).toEqual([
      { type: 'shiftTab' },
      { type: 'shiftTab' },
    ]);
    expect(reachCommands({ strategy: 'prev', cost: 5 }).every((c) => c.type === 'prev')).toBe(true);
  });

  it('collects the distinct texts the task types', () => {
    expect(typeTextsOf(POST_TASK)).toEqual(['Ada']);
    expect(typeTextsOf(SIMPLE_TASK)).toEqual([]);
    expect(
      typeTextsOf({
        sightedPath: [
          { action: 'type', selector: '#a', text: 'x' },
          { action: 'type', selector: '#b', text: 'x' },
          { action: 'type', selector: '#c', text: 'y' },
        ],
      })
    ).toEqual(['x', 'y']);
  });

  it('recognises a localhost origin (POST forms are only safe there)', () => {
    expect(isLocalOrigin('http://127.0.0.1:8080/a.html')).toBe(true);
    expect(isLocalOrigin('http://localhost:8765/')).toBe(true);
    expect(isLocalOrigin('https://www.gov.uk/')).toBe(false);
    expect(isLocalOrigin('not a url')).toBe(false);
  });

  it('builds activate / type / type+activate transitions, cheapest first', () => {
    const analysis = {
      candidates: [
        {
          selector: '#link',
          phrase: 'link, Contact',
          actionable: true,
          textField: false,
          enterAllowed: false,
          analysis: {
            inReadingOrder: true,
            next: 7,
            prev: 3,
            tab: null,
            rotor: { kind: 'links', index: 2, k: 0, cost: 2 },
          },
        },
        {
          selector: '#field',
          phrase: 'textbox, Name',
          actionable: false,
          textField: true,
          enterAllowed: true,
          analysis: {
            inReadingOrder: true,
            next: 4,
            prev: 9,
            tab: { dir: 'tab', cost: 1 },
            rotor: null,
          },
        },
      ],
    };
    const ts = transitionsFor(analysis, ['Ada']);
    expect(ts.map((t) => [t.kind, t.selector, t.cost])).toEqual([
      ['type', '#field', 2],
      ['activate', '#link', 3],
      ['type+activate', '#field', 3],
    ]);
    // The command list is exactly as long as the transition costs.
    for (const t of ts) expect(t.cmds).toHaveLength(t.cost);
    expect(ts[1].cmds).toEqual([
      { type: 'links' },
      { type: 'jumpTo', arg: 2 },
      { type: 'activate' },
    ]);
    expect(ts[2].cmds).toEqual([
      { type: 'tab' },
      { type: 'type', arg: 'Ada' },
      { type: 'activate' },
    ]);
  });

  it('emits no type transitions when the task never types', () => {
    const analysis = {
      candidates: [
        {
          selector: '#field',
          actionable: false,
          textField: true,
          enterAllowed: true,
          analysis: { inReadingOrder: true, next: 1, prev: 9, tab: null, rotor: null },
        },
      ],
    };
    expect(transitionsFor(analysis, [])).toEqual([]);
  });

  it('drops candidates with no screen-reader route at all', () => {
    const analysis = {
      candidates: [
        {
          selector: '#ghost',
          actionable: true,
          textField: false,
          enterAllowed: false,
          analysis: { inReadingOrder: false, next: null, prev: null, tab: null, rotor: null },
        },
      ],
    };
    expect(transitionsFor(analysis, ['x'])).toEqual([]);
  });
});

/**
 * The module defaults are a within-page validator (`maxPages: 1`), so the
 * fixtures whose whole point is a route across several pages have to ask for
 * the exhaustive budgets explicitly.
 */
const CROSS_PAGE = { maxPages: 40, maxDepth: 12, maxEdges: 600, timeoutMs: 120000 };

describe('agent/bfs-optimum: search against real pages', () => {
  let base;
  let browser;

  beforeAll(async () => {
    base = await startFixtureServer();
    await launchBrowser();
    browser = getBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('finds a route the guided optimum cannot see (footer shortcut)', async () => {
    const res = await compareOptima(browser, `${base}/agent/bfs-shortcut.html`, SHORTCUT_TASK, {
      ...CROSS_PAGE,
    });
    expect(res.error).toBeUndefined();
    // Guided: reach + activate, twice (home → Products → Contact).
    expect(res.nOptGuided).toBe(5);
    // BFS: the footer "Contact" link is the last link of the page, so one
    // Shift+L plus one activate reaches the goal.
    expect(res.nOptBfs).toBe(2);
    expect(res.nOptBfs).toBeLessThan(res.nOptGuided);
    expect(res.delta).toBe(3);
    expect(res.bfsPath).toEqual([{ type: 'prevLink' }, { type: 'activate' }]);
    expect(res.explored.reason).toBe('optimal');
    expect(res.explored.truncated).toBe(false);
    expect(res.bestFound.via.selector).toMatch(/footer/);
  }, 180000);

  it('stops as soon as the guided optimum cannot be beaten', async () => {
    const res = await computeBfsOptimum(browser, `${base}/agent/bfs-simple.html`, SIMPLE_TASK);
    expect(res.error).toBeUndefined();
    expect(res.nOptGuided).toBe(2); // nextLink + activate
    expect(res.nOptBfs).toBe(res.nOptGuided);
    expect(res.explored.reason).toBe('bounded-by-guided');
    expect(res.explored.truncated).toBe(false);
    // A single state expansion is enough to prove it.
    expect(res.explored.states).toBe(1);
    expect(res.path).toEqual([{ type: 'nextLink' }, { type: 'activate' }]);
  }, 180000);

  it('agrees with the guided optimum when there is no shortcut', async () => {
    const res = await computeBfsOptimum(
      browser,
      `${base}/agent/bfs-deep.html`,
      DEEP_TASK,
      CROSS_PAGE
    );
    expect(res.nOptGuided).toBe(4);
    expect(res.nOptBfs).toBe(4);
    expect(res.explored.reason).toBe('bounded-by-guided');
    // The guided bound (4) prunes every depth-2 edge before it runs.
    expect(res.explored.depthReached).toBe(1);
  }, 180000);

  it('reports truncated:true (and no proven optimum) when the state budget is tiny', async () => {
    const res = await computeBfsOptimum(browser, `${base}/agent/bfs-deep.html`, DEEP_TASK, {
      ...CROSS_PAGE,
      maxStates: 1,
    });
    expect(res.explored.truncated).toBe(true);
    expect(res.explored.reason).toBe('maxStates');
    expect(res.nOptBfs).toBeNull();
    expect(res.bestFound).toBeNull();
    expect(res.explored.skipped.some((s) => s.reason === 'maxStates')).toBe(true);
  }, 180000);

  it('never submits a POST form without allowSubmit', async () => {
    let recorder = null;
    const res = await computeBfsOptimum(browser, `${base}/agent/bfs-post.html`, POST_TASK, {
      ...CROSS_PAGE,
      // The fixture server is localhost, which the search treats as a safe
      // sandbox; turn that off so the real-site guard is what is under test.
      localhostIsSafe: false,
      onPage: (page) => {
        recorder = createRequestRecorder(page);
      },
    });
    expect(res.error).toBeUndefined();
    expect(recorder.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(recorder.requests.some((r) => /bfs-post-thanks/.test(r.url))).toBe(false);
    // ... and it says so, for both the submit button and Enter in the field.
    expect(
      res.explored.skipped.some((s) => s.selector === '#pf-submit' && s.reason === 'post-form')
    ).toBe(true);
    expect(
      res.explored.skipped.some((s) => s.selector === '#pf-name' && s.reason === 'post-form-enter')
    ).toBe(true);
    // The rest of the page is still searched: the contact link is found.
    expect(res.nOptBfs).toBe(2);
  }, 180000);

  it('does submit the POST form when allowSubmit is set', async () => {
    let recorder = null;
    const res = await computeBfsOptimum(browser, `${base}/agent/bfs-post.html`, POST_TASK, {
      ...CROSS_PAGE,
      allowSubmit: true,
      onPage: (page) => {
        recorder = createRequestRecorder(page);
      },
    });
    expect(res.error).toBeUndefined();
    expect(
      recorder.requests.some((r) => r.method === 'POST' && /bfs-post-thanks/.test(r.url))
    ).toBe(true);
    expect(res.explored.skipped.some((s) => s.reason === 'post-form')).toBe(false);
  }, 180000);

  it('returns 0 when the oracle is already true at state 0', async () => {
    const res = await computeBfsOptimum(browser, `${base}/agent/bfs-contact.html`, {
      ...SIMPLE_TASK,
      id: 'already-true',
    });
    expect(res.nOptBfs).toBe(0);
    expect(res.path).toEqual([]);
    expect(res.explored.reason).toBe('already-true-at-state-0');
  }, 180000);

  it('reports an error instead of throwing on a malformed task', async () => {
    const res = await computeBfsOptimum(browser, `${base}/agent/bfs-simple.html`, {
      id: 'bad',
      description: 'x',
      oracle: CONTACT_ORACLE,
      sightedPath: [],
    });
    expect(res.nOptBfs).toBeNull();
    expect(res.error).toMatch(/sightedPath/);
  }, 60000);
});
