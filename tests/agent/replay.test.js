import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage, getBrowser } = require('../helpers/browser-pool');
const {
  replaySightedPath,
  runPreconditions,
  validateTask,
  measureOptimalPath,
} = require('../../src/agent/replay');
const { createRequestRecorder } = require('../../src/agent/oracle');
const {
  validateTaskShape,
  isValidTaskShape,
  parseTasks,
  loadTasks,
  saveTasks,
} = require('../../src/agent/task');

const HOME = '/agent/generic-home.html';
const BASIC = '/agent/oracle-basic.html';
const READ = '/agent/optimal-read.html';

// Task schema (no browser needed)

const baseTask = () => ({
  id: 't1',
  description: 'Close the cookie notice.',
  oracle: { type: 'urlMatches', pattern: 'x' },
  sightedPath: [{ action: 'click', selector: '#a' }],
});

describe('agent/task: schema', () => {
  it('applies defaults (weight 1, empty preconditions)', () => {
    const t = validateTaskShape(baseTask());
    expect(t.weight).toBe(1);
    expect(t.preconditions).toEqual([]);
  });

  it('does not mutate the input task', () => {
    const input = baseTask();
    validateTaskShape(input);
    expect(input.weight).toBeUndefined();
  });

  it('requires id, description, oracle and a non-empty sightedPath', () => {
    expect(() => validateTaskShape({ ...baseTask(), id: '' })).toThrow(/id/);
    expect(() => validateTaskShape({ ...baseTask(), description: '' })).toThrow(/description/);
    expect(() => validateTaskShape({ ...baseTask(), oracle: undefined })).toThrow(/oracle/);
    expect(() => validateTaskShape({ ...baseTask(), sightedPath: [] })).toThrow(/sightedPath/);
  });

  it('rejects descriptions that leak selectors', () => {
    expect(() =>
      validateTaskShape({ ...baseTask(), description: 'Click the button with #cookie-accept' })
    ).toThrow(/plain user language/);
  });

  it('rejects unknown oracle types and bad steps', () => {
    expect(() => validateTaskShape({ ...baseTask(), oracle: { type: 'nope' } })).toThrow(
      /unknown predicate type/
    );
    expect(() =>
      validateTaskShape({ ...baseTask(), sightedPath: [{ action: 'swipe', selector: '#a' }] })
    ).toThrow(/action must be one of/);
    expect(() => validateTaskShape({ ...baseTask(), sightedPath: [{ action: 'click' }] })).toThrow(
      /selector is required/
    );
    expect(() =>
      validateTaskShape({ ...baseTask(), sightedPath: [{ action: 'type', selector: '#a' }] })
    ).toThrow(/text is required/);
    expect(() => validateTaskShape({ ...baseTask(), weight: 0 })).toThrow(/weight/);
  });

  it('isValidTaskShape does not throw', () => {
    expect(isValidTaskShape(baseTask())).toBe(true);
    expect(isValidTaskShape({})).toBe(false);
  });

  it('parseTasks accepts both an array and { url, tasks } and rejects duplicate ids', () => {
    expect(parseTasks([baseTask()]).tasks).toHaveLength(1);
    const wrapped = parseTasks({ url: 'https://example.com', tasks: [baseTask()] });
    expect(wrapped.url).toBe('https://example.com');
    expect(() => parseTasks([baseTask(), baseTask()])).toThrow(/duplicate task id/);
    expect(() => parseTasks({ tasks: 'nope' })).toThrow(/expected an array/);
  });

  it('saveTasks / loadTasks round-trip', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-agent-tasks-'));
    const file = path.join(dir, 'tasks.json');
    saveTasks(file, [baseTask()], 'https://example.com');
    const loaded = loadTasks(file);
    expect(loaded.url).toBe('https://example.com');
    expect(loaded.tasks[0].id).toBe('t1');
    expect(loaded.tasks[0].weight).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loadTasks reports invalid JSON clearly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-agent-tasks-'));
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{not json');
    expect(() => loadTasks(file)).toThrow(/invalid JSON/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Replay

describe('agent/replay', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('replays a click path and reports oracle before/after', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const task = validateTaskShape({
        id: 'nav',
        description: 'Open the products page from the main menu.',
        oracle: { type: 'urlMatches', pattern: 'generic-products\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(2) a' }],
      });
      const res = await replaySightedPath(page, task);
      expect(res).toMatchObject({ ok: true, nSighted: 1, oracleBefore: false, oracleAfter: true });
      expect(res.error).toBeUndefined();
      expect(page.url()).toContain('generic-products.html');
    } finally {
      await page.close();
    }
  });

  it('replays type + press (Enter) and a goto step', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const task = validateTaskShape({
        id: 'search',
        description: 'Search the website for the word contact.',
        oracle: { type: 'urlMatches', pattern: '[?&]q=kontakt' },
        sightedPath: [
          { action: 'type', selector: '#q', text: 'kontakt' },
          { action: 'press', selector: '#q', key: 'Enter' },
        ],
      });
      const res = await replaySightedPath(page, task);
      expect(res.ok).toBe(true);
      expect(res.nSighted).toBe(2);

      const gotoTask = validateTaskShape({
        id: 'goto',
        description: 'Look at the contact page.',
        oracle: { type: 'titleMatches', pattern: 'contact' },
        sightedPath: [{ action: 'goto', url: `${getBaseUrl()}/agent/generic-contact.html` }],
      });
      const res2 = await replaySightedPath(page, gotoTask);
      expect(res2.ok).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('fails with a clear error when a selector is missing', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const task = validateTaskShape({
        id: 'broken',
        description: 'Open a page that does not exist.',
        oracle: { type: 'urlMatches', pattern: 'never' },
        sightedPath: [{ action: 'click', selector: '#this-does-not-exist' }],
      });
      const res = await replaySightedPath(page, task, {}, { selectorTimeout: 800 });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/selector not found: #this-does-not-exist/);
      expect(res.error).toMatch(/sightedPath\[0\] click/);
    } finally {
      await page.close();
    }
  }, 30000);

  it('reports "oracle still false" when the path runs but does not reach the goal', async () => {
    const page = await getPage(`${getBaseUrl()}${BASIC}`);
    try {
      const task = validateTaskShape({
        id: 'wrong-oracle',
        description: 'Reach a state this page never reaches.',
        oracle: { type: 'elementVisible', selector: '#dlg' },
        sightedPath: [{ action: 'click', selector: '#fill' }],
      });
      const res = await replaySightedPath(page, task);
      expect(res.ok).toBe(false);
      expect(res.oracleAfter).toBe(false);
      expect(res.error).toMatch(/oracle still false/);
    } finally {
      await page.close();
    }
  });

  it('uses the request recorder from ctx', async () => {
    const page = await getPage(`${getBaseUrl()}${BASIC}`);
    try {
      const recorder = createRequestRecorder(page);
      const task = validateTaskShape({
        id: 'ping',
        description: 'Send the request to the server.',
        oracle: { type: 'requestSent', urlPattern: 'oracle-ping\\.json', method: 'POST' },
        sightedPath: [{ action: 'click', selector: '#ping' }],
      });
      const res = await replaySightedPath(page, task, { recorder });
      recorder.stop();
      expect(res).toMatchObject({ ok: true, oracleBefore: false, oracleAfter: true });
    } finally {
      await page.close();
    }
  });

  it('runPreconditions dismisses the cookie banner before state 0', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const task = validateTaskShape({
        id: 'with-pre',
        description: 'Open the products page from the main menu.',
        preconditions: [{ action: 'click', selector: '#cookie-accept' }],
        oracle: { type: 'urlMatches', pattern: 'generic-products\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(2) a' }],
      });
      const pre = await runPreconditions(page, task);
      expect(pre.ok).toBe(true);
      expect(await page.$eval('#cookie-banner', (el) => el.style.display)).toBe('none');
      const res = await replaySightedPath(page, task);
      expect(res.ok).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('runPreconditions reports a failing precondition instead of throwing', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const task = validateTaskShape({
        id: 'bad-pre',
        description: 'Open the products page from the main menu.',
        preconditions: [{ action: 'click', selector: '#nope' }],
        oracle: { type: 'urlMatches', pattern: 'generic-products\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(2) a' }],
      });
      const pre = await runPreconditions(page, task, { selectorTimeout: 500 });
      expect(pre.ok).toBe(false);
      expect(pre.error).toMatch(/selector not found/);
    } finally {
      await page.close();
    }
  }, 30000);

  describe('validateTask', () => {
    it('accepts a sound task over repeated fresh pages', async () => {
      const task = {
        id: 'contact',
        description: 'Find the page with the contact details of this company.',
        oracle: { type: 'urlMatches', pattern: 'generic-contact\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(3) a' }],
      };
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, task, { repeats: 2 });
      expect(res).toMatchObject({ valid: true, nSighted: 1 });
      expect(res.reasons).toEqual([]);
      // ... and it measures nOpt while replaying: "Contact" is the last link,
      // so one prevLink step plus activate.
      expect(res.nOpt).toBe(2);
      expect(res.optimalPath).toHaveLength(1);
      expect(res.optimalPath[0]).toMatchObject({
        index: 0,
        action: 'click',
        actionCost: 1,
        reach: { strategy: 'step', cost: 1 },
      });
      expect(res.optimalPath[0].reach.via.kind).toBe('links');
      expect(res.optimalPath[0].reach.via.command).toBe('prevLink');
      expect(res.optimalPathError).toBeUndefined();
    }, 120000);

    it('adds the read step of an information task to nOpt and reports readDistance', async () => {
      const task = {
        id: 'phone',
        description: 'Find out which phone number the office can be reached on.',
        kind: 'information',
        evidence: 'Phone 555 0100',
        oracle: { type: 'elementWithText', text: 'Phone\\s+555\\s+0100' },
        sightedPath: [{ action: 'goto', url: `${getBaseUrl()}${READ}` }],
      };
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${READ}`, task, { repeats: 2 });
      expect(res.valid).toBe(true);
      expect(res.optimalPathError).toBeUndefined();
      expect(res.nOptPartial).toBeUndefined();
      // The navigation part is empty here, so nOpt IS the reading distance.
      expect(res.readDistance).toBeGreaterThan(0);
      expect(res.nOpt).toBe(1 + res.readDistance); // goto + read
      const read = res.optimalPath[res.optimalPath.length - 1];
      expect(read).toMatchObject({ action: 'read', actionCost: 0, evidence: 'Phone 555 0100' });
    }, 120000);

    it('keeps nOpt partial when the evidence is on the page but never spoken', async () => {
      // "Fax 555 0199" only exists as CSS-generated content.
      const task = {
        id: 'fax',
        description: 'Find out which fax number the office can be reached on.',
        kind: 'information',
        evidence: 'Fax 555 0199',
        // The oracle looks at the visual text, which the sighted user reads.
        oracle: { type: 'titleMatches', pattern: 'Read Fixture' },
        sightedPath: [{ action: 'goto', url: `${getBaseUrl()}${READ}` }],
      };
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${READ}`, task, { repeats: 2 });
      // The task stays valid: this is a barrier, not a broken task.
      expect(res.valid).toBe(true);
      expect(res.optimalPathError).toBe('evidence-not-in-reading-order');
      expect(res.nOptPartial).toBe(true);
      expect(res.readDistance).toBeNull();
      expect(res.nOpt).toBe(1); // the goto only
      expect(res.optimalPath.some((s) => s.action === 'read')).toBe(false);
    }, 120000);

    it('measures the same nOpt fused into the last repeat as on a page of its own', async () => {
      const task = {
        id: 'contact-nopt-equal',
        description: 'Find the page with the contact details of this company.',
        oracle: { type: 'urlMatches', pattern: 'generic-contact\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(3) a' }],
      };
      const url = `${getBaseUrl()}${HOME}`;
      // The default path: the nOpt walk rides along on the last repeat.
      const fused = await validateTask(getBrowser(), url, task, { repeats: 2 });
      // The standalone measurement on its own fresh context (what the fused
      // walk replaces): identical state 0, so it must produce identical numbers.
      const standalone = await measureOptimalPath(
        getBrowser(),
        url,
        validateTaskShape(task),
        {},
        null
      );

      expect(fused.valid).toBe(true);
      expect(fused.nOpt).toBe(standalone.nOpt);
      expect(fused.nOpt).not.toBeNull();
      expect(fused.optimalPath).toHaveLength(standalone.steps.length);
      expect(fused.optimalPath.map((s) => [s.action, s.reach.strategy, s.reach.cost])).toEqual(
        standalone.steps.map((s) => [s.action, s.reach.strategy, s.reach.cost])
      );
      expect(fused.optimalPathError).toBeUndefined();
      expect(fused.timings.nOptMs).toBeGreaterThanOrEqual(0);
      expect(fused.timings.validateMs).toBeGreaterThanOrEqual(0);
    }, 120000);

    it('falls back to a clean repeat when the fused nOpt walk fails', async () => {
      const optimalPath = require('../../src/agent/optimal-path');
      const original = optimalPath.computeOptimalPath;
      optimalPath.computeOptimalPath = async () => ({ nOpt: null, steps: [], error: 'boom' });
      const task = {
        id: 'contact-nopt-fallback',
        description: 'Find the page with the contact details of this company.',
        oracle: { type: 'urlMatches', pattern: 'generic-contact\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(3) a' }],
      };
      let res;
      try {
        res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, task, { repeats: 2 });
      } finally {
        optimalPath.computeOptimalPath = original;
      }
      // A failed nOpt walk never invalidates the task: the repeat is redone as
      // a plain replay, exactly as before the two were fused.
      expect(res.valid).toBe(true);
      expect(res.reasons).toEqual([]);
      expect(res.nOpt).toBeNull();
      expect(res.optimalPathError).toBe('boom');
    }, 120000);

    it('skips the nOpt measurement when computeOptimal is false', async () => {
      const task = {
        id: 'contact-no-opt',
        description: 'Find the page with the contact details of this company.',
        oracle: { type: 'urlMatches', pattern: 'generic-contact\\.html' },
        sightedPath: [{ action: 'click', selector: 'nav ul li:nth-of-type(3) a' }],
      };
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, task, {
        repeats: 1,
        computeOptimal: false,
      });
      expect(res.valid).toBe(true);
      expect(res.nOpt).toBeNull();
      expect(res.optimalPath).toBeNull();
    }, 60000);

    it('rejects a task whose oracle is already true at state 0', async () => {
      const task = {
        id: 'trivial',
        description: 'Be on the home page of the website.',
        oracle: { type: 'urlMatches', pattern: 'generic-home\\.html' },
        sightedPath: [{ action: 'click', selector: '#cookie-accept' }],
      };
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, task, { repeats: 1 });
      expect(res.valid).toBe(false);
      expect(res.nOpt).toBeNull(); // no nOpt for a task that is not valid
      expect(res.reasons.join(' ')).toMatch(/already true at state 0/);
    }, 60000);

    it('rejects a task whose path cannot be executed', async () => {
      const task = {
        id: 'unreachable',
        description: 'Reach a page that does not exist.',
        oracle: { type: 'urlMatches', pattern: 'nowhere\\.html' },
        sightedPath: [{ action: 'click', selector: '#missing-control' }],
      };
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, task, {
        repeats: 1,
        options: { selectorTimeout: 800 },
      });
      expect(res.valid).toBe(false);
      expect(res.reasons.join(' ')).toMatch(/selector not found/);
    }, 60000);

    it('rejects a structurally invalid task without opening a page', async () => {
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, { id: 'x' }, {});
      expect(res).toMatchObject({ valid: false, nSighted: 0, nOpt: null, optimalPath: null });
      expect(res.reasons[0]).toMatch(/description/);
    });
  });
});
