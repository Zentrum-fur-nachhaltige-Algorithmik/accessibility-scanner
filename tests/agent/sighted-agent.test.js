import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const {
  runSightedAgent,
  toSightedPath,
  SIGHTED_TOOLS,
  isLocalOrigin,
  submitRefusal,
} = require('../../src/agent/sighted-agent');
const { extractPageView } = require('../../src/agent/page-view');
const { replaySightedPath } = require('../../src/agent/replay');
const { evaluate, createRequestRecorder } = require('../../src/agent/oracle');

const HOME = '/agent/generic-home.html';

let baseUrl;

beforeAll(async () => {
  baseUrl = await startFixtureServer();
  await launchBrowser();
}, 120000);

afterAll(async () => {
  await closeBrowser();
  await stopFixtureServer();
});

/**
 * LLM double: `script` is a list of `{ name, arguments }` (or `{ failure }`),
 * one per turn. The last entry repeats if the agent keeps going.
 */
function fakeLlm(script, { usage = { promptTokens: 7, completionTokens: 3, cost: 0.001 } } = {}) {
  const seen = [];
  let i = 0;
  return {
    seen,
    chat: vi.fn(async (messages, options) => {
      seen.push({ messages, options });
      const entry = script[Math.min(i, script.length - 1)];
      i += 1;
      if (entry && entry.failure) return entry.failure;
      const calls = (Array.isArray(entry) ? entry : [entry]).filter(Boolean).map((c, n) => ({
        id: `call_${n}`,
        name: c.name,
        arguments: 'arguments' in c ? c.arguments : {},
        argumentsRaw: JSON.stringify(c.arguments || {}),
      }));
      return { success: true, message: { content: null }, toolCalls: calls, usage, model: 'fake' };
    }),
  };
}

/** The numeric id the agent will see for the element with this accessible name. */
async function idOf(page, name) {
  const view = await extractPageView(page);
  const el = view.elements.find((e) => e.name === name);
  if (!el) throw new Error(`no element named "${name}" on ${page.url()}`);
  return el.id;
}

/**
 * LLM double that addresses elements BY NAME: it reads the id out of the
 * rendered observation it was just given, exactly as a model would. Element
 * numbers change after every page change, so a script of fixed ids would be
 * wrong the moment the first action changes the DOM.
 */
function fakeLlmByName(script) {
  const seen = [];
  let i = 0;
  return {
    seen,
    chat: vi.fn(async (messages, options) => {
      seen.push({ messages, options });
      const entry = script[Math.min(i, script.length - 1)];
      i += 1;
      const text = lastUserText(messages);
      let args = { ...(entry.arguments || {}) };
      if (entry.target !== undefined) {
        const id = idFromRendered(text, entry.target);
        if (id == null)
          throw new Error(`fakeLlmByName: "${entry.target}" not in the rendered view`);
        args.id = id;
      }
      return {
        success: true,
        message: { content: null },
        toolCalls: [
          { id: 'c0', name: entry.name, arguments: args, argumentsRaw: JSON.stringify(args) },
        ],
        usage: { promptTokens: 7, completionTokens: 3, cost: 0.001 },
        model: 'fake',
      };
    }),
  };
}

function lastUserText(messages) {
  const content = messages.at(-1).content;
  if (typeof content === 'string') return content;
  return (content.find((c) => c.type === 'text') || {}).text || '';
}

function idFromRendered(text, name) {
  const line = text.split('\n').find((l) => new RegExp(`^\\s*\\[\\d+\\].*"${name}"`).test(l));
  if (!line) return null;
  return Number(line.match(/\[(\d+)\]/)[1]);
}

describe('agent/sighted-agent — tools', () => {
  it('exposes exactly click, type, press, goto, back, done', () => {
    expect(SIGHTED_TOOLS.map((t) => t.function.name)).toEqual([
      'click',
      'type',
      'press',
      'goto',
      'back',
      'done',
    ]);
  });

  it('press is restricted to Enter and Escape', () => {
    const press = SIGHTED_TOOLS.find((t) => t.function.name === 'press');
    expect(press.function.parameters.properties.key.enum).toEqual(['Enter', 'Escape']);
  });
});

describe('agent/sighted-agent — solving on a real page', () => {
  let page;

  beforeAll(async () => {
    page = await getPage(`${baseUrl}${HOME}`);
  }, 60000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
  });

  it('records a trajectory whose sightedPath replays and satisfies an oracle', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const llm = fakeLlmByName([
      { name: 'click', target: 'Accept all' },
      { name: 'click', target: 'Contact' },
      { name: 'done', arguments: { summary: 'The contact page shows the postal address.' } },
    ]);

    const run = await runSightedAgent({
      page,
      llm,
      goal: 'Find out how to get in touch with this company.',
      maxSteps: 6,
    });

    expect(run.stoppedBy).toBe('done');
    expect(run.summary).toMatch(/postal address/);
    expect(run.steps).toBe(3);
    expect(run.trajectory).toHaveLength(2);
    expect(run.trajectory[1]).toMatchObject({ action: 'click', titleAfter: 'Contact — Mini Site' });
    expect(run.trajectory[1].urlBefore).toContain(HOME);
    expect(run.trajectory[1].urlAfter).toContain('generic-contact.html');
    expect(run.usage).toMatchObject({ calls: 3, promptTokens: 21, costKnown: true });

    const sightedPath = toSightedPath(run.trajectory);
    expect(sightedPath).toEqual([
      { action: 'click', selector: '#cookie-accept' },
      { action: 'click', selector: expect.any(String) },
    ]);

    // The recorded path really replays on a fresh page and reaches the goal.
    const fresh = await getPage(`${baseUrl}${HOME}`);
    try {
      const task = {
        id: 'contact',
        description: 'Find out how to get in touch with this company.',
        oracle: { type: 'urlMatches', pattern: 'generic-contact' },
        sightedPath,
      };
      const res = await replaySightedPath(fresh, task);
      expect(res.oracleBefore).toBe(false);
      expect(res.ok).toBe(true);
      expect(res.nSighted).toBe(2);
    } finally {
      await fresh.close().catch(() => {});
    }
  }, 60000);

  it('types into a field and submits a GET form (search) on localhost', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const llm = fakeLlmByName([
      { name: 'type', target: 'Search the site', arguments: { text: 'kontakt' } },
      { name: 'click', target: 'Search' },
      { name: 'done', arguments: { summary: 'A result list is shown.' } },
    ]);

    const recorder = createRequestRecorder(page);
    const run = await runSightedAgent({ page, llm, goal: 'Search the site for kontakt.' });
    recorder.stop();

    expect(run.stoppedBy).toBe('done');
    expect(run.blockedSubmits).toBe(0);
    expect(toSightedPath(run.trajectory)).toEqual([
      { action: 'type', selector: '#q', text: 'kontakt' },
      { action: 'click', selector: expect.any(String) },
    ]);
    expect(await evaluate({ type: 'urlMatches', pattern: 'q=kontakt' }, page)).toBe(true);
  }, 60000);

  it('goes back and records the landing url as a replayable goto', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const llm = fakeLlmByName([
      { name: 'click', target: 'Contact' },
      { name: 'back', arguments: {} },
      { name: 'done', arguments: { summary: 'back home' } },
    ]);
    const run = await runSightedAgent({ page, llm, goal: 'Look at the contact page and return.' });
    expect(run.trajectory.map((t) => t.action)).toEqual(['click', 'back']);
    const path = toSightedPath(run.trajectory);
    expect(path[1]).toEqual({ action: 'goto', url: expect.stringContaining(HOME) });
  }, 60000);

  it('navigates directly with goto', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const llm = fakeLlm([
      { name: 'goto', arguments: { url: `${baseUrl}/agent/generic-products.html` } },
      { name: 'done', arguments: { summary: 'products' } },
    ]);
    const run = await runSightedAgent({ page, llm, goal: 'Open the product overview.' });
    expect(run.trajectory[0]).toMatchObject({
      action: 'goto',
      titleAfter: 'Mini Site — Products',
    });
    expect(toSightedPath(run.trajectory)).toEqual([
      { action: 'goto', url: `${baseUrl}/agent/generic-products.html` },
    ]);
  }, 60000);
});

describe('agent/sighted-agent — turn discipline', () => {
  let page;

  beforeAll(async () => {
    page = await getPage(`${baseUrl}${HOME}`);
  }, 60000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
  });

  it('a turn without a tool call costs a step and is fed back as an error', async () => {
    const llm = fakeLlm([[], { name: 'done', arguments: { summary: 'ok' } }]);
    const run = await runSightedAgent({ page, llm, goal: 'Do something.', maxSteps: 4 });
    expect(run.steps).toBe(2);
    expect(run.trajectory).toHaveLength(0);
    const second = llm.seen[1].messages.at(-1).content;
    expect(String(second)).toContain('did not call any tool');
  }, 60000);

  it('rejects an element number that is not on the page', async () => {
    const llm = fakeLlm([
      { name: 'click', arguments: { id: 9999 } },
      { name: 'done', arguments: { summary: 'ok' } },
    ]);
    const run = await runSightedAgent({ page, llm, goal: 'Do something.', maxSteps: 4 });
    expect(String(llm.seen[1].messages.at(-1).content)).toContain('no element [9999]');
    expect(run.trajectory).toHaveLength(0);
  }, 60000);

  it('stops at the budget', async () => {
    const llm = fakeLlm([{ name: 'press', arguments: { key: 'Escape' } }]);
    const run = await runSightedAgent({ page, llm, goal: 'Do something.', maxSteps: 3 });
    expect(run.stoppedBy).toBe('budget');
    expect(run.steps).toBe(3);
  }, 60000);

  it('stops on an LLM error', async () => {
    const llm = fakeLlm([{ failure: { success: false, error: 'boom' } }]);
    const run = await runSightedAgent({ page, llm, goal: 'Do something.', maxSteps: 3 });
    expect(run.stoppedBy).toBe('error');
    expect(run.error).toBe('boom');
  }, 60000);

  it('onStep can stop the run early', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const cookieId = await idOf(page, 'Accept all');
    const llm = fakeLlm([{ name: 'click', arguments: { id: cookieId } }]);
    const run = await runSightedAgent({
      page,
      llm,
      goal: 'Close the cookie notice.',
      maxSteps: 8,
      onStep: () => ({ stop: true, reason: 'oracle' }),
    });
    expect(run.stoppedBy).toBe('oracle');
    expect(run.steps).toBe(1);
  }, 60000);

  it('bounds the message history', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const llm = fakeLlm([{ name: 'press', arguments: { key: 'Escape' } }]);
    await runSightedAgent({ page, llm, goal: 'x', maxSteps: 10, memoryTurns: 2 });
    const last = llm.seen.at(-1).messages;
    // pinned goal + (memoryTurns-1) older pairs + last action + current observation
    expect(last.length).toBeLessThanOrEqual(1 + 2 * 1 + 1 + 1);
  }, 60000);

  it('sends the screenshot as an image part only with vision on', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    const plain = fakeLlm([{ name: 'done', arguments: { summary: 'x' } }]);
    await runSightedAgent({ page, llm: plain, goal: 'x' });
    expect(typeof plain.seen[0].messages.at(-1).content).toBe('string');

    const seeing = fakeLlm([{ name: 'done', arguments: { summary: 'x' } }]);
    await runSightedAgent({ page, llm: seeing, goal: 'x', vision: true });
    const content = seeing.seen[0].messages.at(-1).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  }, 60000);
});

describe('agent/sighted-agent — the submit guard', () => {
  it('recognises local origins', () => {
    expect(isLocalOrigin('http://localhost:8765/x')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:3000/')).toBe(true);
    expect(isLocalOrigin('https://www.gov.uk/')).toBe(false);
    expect(isLocalOrigin('not a url')).toBe(false);
  });

  const postButton = { isSubmit: true, inForm: true, formMethod: 'POST' };
  const getButton = { isSubmit: true, inForm: true, formMethod: 'GET' };

  it('blocks POST submits on foreign origins', () => {
    expect(
      submitRefusal({
        name: 'click',
        target: postButton,
        url: 'https://example.com/',
        allowSubmit: false,
      })
    ).toMatch(/not allowed/);
  });

  it('allows GET submits (site search) everywhere', () => {
    expect(
      submitRefusal({
        name: 'click',
        target: getButton,
        url: 'https://example.com/',
        allowSubmit: false,
      })
    ).toBeNull();
  });

  it('allows everything on localhost and with --allow-submit', () => {
    expect(
      submitRefusal({
        name: 'click',
        target: postButton,
        url: 'http://localhost:1/',
        allowSubmit: false,
      })
    ).toBeNull();
    expect(
      submitRefusal({
        name: 'click',
        target: postButton,
        url: 'https://example.com/',
        allowSubmit: true,
      })
    ).toBeNull();
  });

  it('blocks Enter in a POST form too', () => {
    expect(
      submitRefusal({
        name: 'press',
        lastElement: { inForm: true, formMethod: 'POST' },
        url: 'https://example.com/',
        allowSubmit: false,
      })
    ).toMatch(/Enter/);
    expect(
      submitRefusal({
        name: 'press',
        lastElement: { inForm: true, formMethod: 'GET' },
        url: 'https://example.com/',
        allowSubmit: false,
      })
    ).toBeNull();
  });
});

describe('agent/sighted-agent — toSightedPath', () => {
  it('drops failed steps and collapses repeated navigations', () => {
    const path = toSightedPath([
      { action: 'click', selector: '#a', urlBefore: 'u', urlAfter: 'u' },
      { action: 'click', selector: '#b', error: 'not found' },
      { action: 'goto', url: 'http://x/1', urlAfter: 'http://x/1' },
      { action: 'goto', url: 'http://x/1', urlAfter: 'http://x/1' },
      { action: 'press', key: 'Enter' },
      { action: 'type', selector: '#c', text: 'hi' },
    ]);
    expect(path).toEqual([
      { action: 'click', selector: '#a' },
      { action: 'goto', url: 'http://x/1' },
      { action: 'press', key: 'Enter' },
      { action: 'type', selector: '#c', text: 'hi' },
    ]);
  });

  it('is empty for an empty trajectory', () => {
    expect(toSightedPath([])).toEqual([]);
    expect(toSightedPath(null)).toEqual([]);
  });
});
