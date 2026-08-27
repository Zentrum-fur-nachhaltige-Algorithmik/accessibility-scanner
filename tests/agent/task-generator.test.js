import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getBrowser } = require('../helpers/browser-pool');
const {
  generateTasks,
  mergeCandidates,
  intentOf,
  deterministicOracle,
  withGeneratorMeta,
  isPlausible,
  pickExplorationLinks,
  PROPOSE_TASKS_TOOL,
  PROPOSE_ORACLE_TOOL,
  ORACLE_TYPES,
} = require('../../src/agent/task-generator');
const { loadTasks, saveTasks } = require('../../src/agent/task');

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

/* ------------------------------------------------------------------ */
/* The LLM double                                                      */
/* ------------------------------------------------------------------ */

/**
 * One fake client for the whole pipeline. It dispatches on which tool it was
 * offered: `propose_tasks` → the proposal, `propose_oracle` → an oracle spec,
 * anything else → the sighted-agent action script for the goal in the message.
 *
 * Sighted actions address elements BY NAME and read the number out of the
 * rendered observation, exactly as a real model has to.
 */
function fakeLlm({ proposal, solutions, oracle }) {
  const calls = { propose: 0, oracle: 0, sighted: 0 };
  const cursors = new Map();
  return {
    calls,
    chat: vi.fn(async (messages, options) => {
      const toolNames = (options.tools || []).map((t) => t.function.name);
      const ok = (name, args) => ({
        success: true,
        message: { content: null },
        toolCalls: [{ id: 'c', name, arguments: args, argumentsRaw: JSON.stringify(args) }],
        usage: { promptTokens: 100, completionTokens: 20, cost: 0.0002 },
        model: 'fake',
      });

      if (toolNames.includes('propose_tasks')) {
        calls.propose += 1;
        return ok('propose_tasks', proposal);
      }
      if (toolNames.includes('propose_oracle')) {
        calls.oracle += 1;
        const text = String(messages[0].content);
        const entry = Object.entries(oracle || {}).find(([description]) =>
          text.includes(description)
        );
        if (!entry) return { success: false, error: 'no scripted oracle' };
        return ok('propose_oracle', entry[1]);
      }

      calls.sighted += 1;
      const text = lastUserText(messages);
      const goalLine = text.split('\n')[0];
      const key = Object.keys(solutions).find((k) => goalLine.includes(k));
      if (!key) throw new Error(`no scripted solution for: ${goalLine}`);
      const script = solutions[key];
      const i = cursors.get(key) || 0;
      cursors.set(key, i + 1);
      const step = script[Math.min(i, script.length - 1)];

      if (step.name === null) {
        // A turn with no tool call: costs a step, changes nothing.
        return {
          success: true,
          message: { content: 'thinking…' },
          toolCalls: [],
          usage: { promptTokens: 100, completionTokens: 20, cost: 0.0002 },
          model: 'fake',
        };
      }
      const args = { ...(step.arguments || {}) };
      if (step.target !== undefined) {
        const id = idFromRendered(text, step.target);
        if (id == null) throw new Error(`"${step.target}" not in the view for "${key}"`);
        args.id = id;
      }
      return ok(step.name, args);
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
  return line ? Number(line.match(/\[(\d+)\]/)[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Pure units                                                          */
/* ------------------------------------------------------------------ */

describe('agent/task-generator — tool schemas', () => {
  it('propose_tasks enforces the candidate shape', () => {
    const p = PROPOSE_TASKS_TOOL.function.parameters;
    expect(p.required).toEqual(['siteType', 'tasks']);
    const item = p.properties.tasks.items;
    expect(item.required).toEqual(['id', 'description', 'weight', 'expectedOutcome']);
    expect(item.properties.weight).toMatchObject({ minimum: 1, maximum: 3 });
    expect(p.properties.tasks.maxItems).toBe(10);
  });

  it('propose_oracle is restricted to the oracle catalog', () => {
    const types = PROPOSE_ORACLE_TOOL.function.parameters.properties.type.enum;
    expect(types).toEqual(ORACLE_TYPES);
    expect(types).toContain('urlMatches');
    expect(types).toContain('all');
    expect(types).toContain('any');
    expect(types).toContain('not');
  });
});

describe('agent/task-generator — merging and intent', () => {
  it('buckets descriptions into coarse intents', () => {
    expect(intentOf('Close the cookie notice.')).toBe('cookie');
    expect(intentOf('Search the site for a form.')).toBe('search');
    expect(intentOf('Find out how to contact them.')).toBe('contact');
    expect(intentOf('Log in to your account.')).toBe('login');
    expect(intentOf('Find out what a passport costs.')).toBeNull();
  });

  it('keeps the generic template and drops the duplicate proposal, with a reason', () => {
    const dropped = [];
    const merged = mergeCandidates({
      proposed: [
        { id: 'accept-cookies', description: 'Accept the cookie banner.', weight: 2 },
        { id: 'passport-cost', description: 'Find out what a passport costs.', weight: 3 },
      ],
      genericTasks: [
        {
          id: 'generic-cookie-banner-dismiss',
          template: 'cookie-banner-dismiss',
          description: 'Close the cookie notice so that you can use the website.',
          weight: 1,
        },
      ],
      maxTasks: 8,
      dropped,
    });
    expect(merged.map((c) => c.id)).toEqual(['generic-cookie-banner-dismiss', 'passport-cost']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ id: 'accept-cookies' });
    expect(dropped[0].reason).toMatch(/duplicate-intent \(cookie\)/);
  });

  it('drops the generic login task when the proposal does not corroborate it', () => {
    const dropped = [];
    const genericTasks = [
      {
        id: 'generic-login',
        template: 'login',
        description: 'Get to the place where you can log in with your user account.',
        weight: 1,
      },
    ];
    const merged = mergeCandidates({
      proposed: [{ id: 'passport-cost', description: 'Find out what a passport costs.' }],
      genericTasks,
      maxTasks: 8,
      dropped,
    });
    expect(merged.map((c) => c.id)).toEqual(['passport-cost']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].id).toBe('generic-login');
    expect(dropped[0].reason).toMatch(/generic-login-not-corroborated/);
  });

  it('keeps the generic login task when the llm proposed a login-like one', () => {
    const dropped = [];
    const merged = mergeCandidates({
      proposed: [{ id: 'sign-in', description: 'Sign in to your account.' }],
      genericTasks: [
        {
          id: 'generic-login',
          template: 'login',
          description: 'Get to the place where you can log in with your user account.',
          weight: 1,
        },
      ],
      maxTasks: 8,
      dropped,
    });
    // The generic one survives; the proposal is deduplicated into it.
    expect(merged.map((c) => c.id)).toEqual(['generic-login']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toMatch(/duplicate-intent \(login\)/);
  });

  it('respects maxTasks and puts the generic (cheap, certain) tasks first', () => {
    const merged = mergeCandidates({
      proposed: [
        { id: 'a', description: 'x' },
        { id: 'b', description: 'y' },
      ],
      genericTasks: [{ id: 'g1', description: 'g' }],
      maxTasks: 2,
      dropped: [],
    });
    expect(merged.map((c) => c.id)).toEqual(['g1', 'a']);
  });
});

describe('agent/task-generator — deterministic oracle', () => {
  const base = {
    url: 'http://s/a',
    title: 'A',
    headings: ['One'],
    statusTexts: [],
    formValues: {},
    storageKeys: [],
  };

  it('prefers the new url', () => {
    expect(
      deterministicOracle({ before: base, after: { ...base, url: 'http://s/b?x=1' } })
    ).toEqual({ type: 'urlMatches', pattern: '/b\\?x=1' });
  });

  it('falls back to a newly appeared status text', () => {
    expect(
      deterministicOracle({
        before: base,
        after: { ...base, statusTexts: ['Your message has been sent.'] },
      })
    ).toEqual({ type: 'elementWithText', text: 'Your message has been sent\\.' });
  });

  it('then to a new heading, then to the title', () => {
    expect(
      deterministicOracle({ before: base, after: { ...base, headings: ['One', 'Thank you'] } })
    ).toEqual({ type: 'elementWithText', text: 'Thank you' });
    expect(deterministicOracle({ before: base, after: { ...base, title: 'B page' } })).toEqual({
      type: 'titleMatches',
      pattern: 'B page',
    });
  });

  it('returns null when nothing observable changed', () => {
    expect(deterministicOracle({ before: base, after: { ...base } })).toBeNull();
  });
});

describe('agent/task-generator — plausibility and ambiguity weighting', () => {
  const s = {
    url: 'u',
    title: 't',
    headings: [],
    statusTexts: [],
    formValues: {},
    storageKeys: [],
  };

  it('needs done plus an observable change', () => {
    expect(isPlausible(s, s, { stoppedBy: 'done' })).toBe(false);
    expect(isPlausible(s, { ...s, url: 'v' }, { stoppedBy: 'done' })).toBe(true);
    expect(isPlausible(s, { ...s, url: 'v' }, { stoppedBy: 'budget' })).toBe(false);
    expect(isPlausible(s, { ...s, statusTexts: ['sent'] }, { stoppedBy: 'done' })).toBe(true);
  });

  it('lowers the weight and flags a task the sighted agent struggled with', () => {
    const t = withGeneratorMeta(
      { id: 'x', weight: 3 },
      { sightedAgentSteps: 9, pathLength: 2, ratio: 4.5, retries: 0 }
    );
    expect(t.ambiguous).toBe(true);
    expect(t.weight).toBe(2);
  });

  it('never lowers below 1 and leaves unambiguous tasks alone', () => {
    expect(withGeneratorMeta({ id: 'x', weight: 1 }, { ratio: 10 }).weight).toBe(1);
    const fine = withGeneratorMeta({ id: 'x', weight: 3 }, { ratio: 2 });
    expect(fine.weight).toBe(3);
    expect(fine.ambiguous).toBeUndefined();
  });
});

describe('agent/task-generator — exploration links', () => {
  const view = {
    elements: [
      { href: 'http://s/a', region: 'navigation "Main"' },
      { href: 'http://s/b', region: null },
      { href: 'http://other/c', region: 'navigation "Main"' },
      { href: 'http://s/a', region: 'navigation "Main"' },
      { href: 'http://s/', region: 'navigation "Main"' },
    ],
  };

  it('takes same-origin links, navigation first, deduped, without the start page', () => {
    expect(pickExplorationLinks(view, 'http://s/', 4)).toEqual(['http://s/a', 'http://s/b']);
  });

  it('respects the limit and copes with junk', () => {
    expect(pickExplorationLinks(view, 'http://s/', 1)).toEqual(['http://s/a']);
    expect(pickExplorationLinks(view, 'http://s/', 0)).toEqual([]);
    expect(pickExplorationLinks(null, 'http://s/', 3)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* End to end against the mini-site, with the fake LLM                 */
/* ------------------------------------------------------------------ */

describe('agent/task-generator — end to end (fake llm, real browser)', () => {
  let result;
  let llm;

  beforeAll(async () => {
    llm = fakeLlm({
      proposal: {
        siteType: 'small demo company website',
        tasks: [
          {
            id: 'see-the-product-range',
            description: 'Find out what this company sells.',
            weight: 3,
            expectedOutcome: 'A page listing the product range is shown.',
          },
          {
            id: 'find-the-postal-address',
            description: 'Find out where this company is based.',
            weight: 3,
            expectedOutcome: 'The postal address is visible.',
          },
          {
            id: 'book-a-flight',
            description: 'Book a flight to the moon.',
            weight: 1,
            expectedOutcome: 'A booking confirmation is shown.',
          },
          {
            id: 'read-the-welcome-text',
            description: 'Read the welcome message on the front page.',
            weight: 1,
            expectedOutcome: 'The welcome message is on screen.',
          },
        ],
      },
      solutions: {
        // straightforward: one click, agent solves it in 2 turns → ratio 2, not ambiguous
        'Find out what this company sells.': [
          { name: 'click', target: 'Products' },
          { name: 'done', arguments: { summary: 'The product overview is shown.' } },
        ],
        // the agent flounders: 4 wasted turns for a one-click path → ratio > 3
        'Find out where this company is based.': [
          { name: null },
          { name: null },
          { name: null },
          { name: 'click', target: 'Contact' },
          { name: 'done', arguments: { summary: 'The address is on the contact page.' } },
        ],
        // impossible: the agent gives up without doing anything
        'Book a flight to the moon.': [
          { name: 'done', arguments: { summary: 'This website does not sell flights.' } },
        ],
        // acts, but nothing observable changes → no plausible end state
        'Read the welcome message on the front page.': [
          { name: 'press', arguments: { key: 'Escape' } },
          { name: 'done', arguments: { summary: 'I read it.' } },
        ],
      },
      oracle: {
        'Find out what this company sells.': { type: 'titleMatches', pattern: 'Products' },
        'Find out where this company is based.': {
          type: 'urlMatches',
          pattern: 'generic-contact',
        },
      },
    });

    result = await generateTasks({
      browser: getBrowser(),
      url: `${baseUrl}${HOME}`,
      llm,
      model: 'fake',
      logger: { info: () => {} },
      options: { generic: false, explore: 2, maxTasks: 8, sightedMaxSteps: 8 },
    });
  }, 300000);

  it('reports the site type and the pages it explored', () => {
    expect(result.siteType).toBe('small demo company website');
    expect(result.explored.length).toBeGreaterThanOrEqual(1);
    expect(result.url).toContain(HOME);
  });

  it('detects the cookie banner and turns it into a precondition', () => {
    expect(result.preconditions).toEqual([{ action: 'click', selector: '#cookie-accept' }]);
    for (const task of result.tasks) {
      expect(task.preconditions).toEqual([{ action: 'click', selector: '#cookie-accept' }]);
    }
  });

  it('makes exactly one proposal call', () => {
    expect(llm.calls.propose).toBe(1);
  });

  it('keeps the tasks it could solve AND validate', () => {
    expect(result.tasks.map((t) => t.id)).toEqual([
      'see-the-product-range',
      'find-the-postal-address',
    ]);
  });

  it('produces replayable sighted paths and a validated oracle per task', () => {
    const products = result.tasks.find((t) => t.id === 'see-the-product-range');
    expect(products.sightedPath).toEqual([{ action: 'click', selector: expect.any(String) }]);
    // The deterministic candidate wins when it validates.
    expect(products.oracle).toEqual({
      type: 'urlMatches',
      pattern: '/agent/generic-products\\.html',
    });
    expect(products.meta.oracleOrigin).toBe('deterministic');
  });

  it('records the ambiguity signal per task', () => {
    const easy = result.tasks.find((t) => t.id === 'see-the-product-range');
    expect(easy.generator).toMatchObject({ sightedAgentSteps: 2, pathLength: 1, ratio: 2 });
    expect(easy.ambiguous).toBeUndefined();
    expect(easy.weight).toBe(3);
  });

  it('lowers the weight of a task even the sighted agent struggled with', () => {
    const hard = result.tasks.find((t) => t.id === 'find-the-postal-address');
    expect(hard.generator.sightedAgentSteps).toBe(5);
    expect(hard.generator.pathLength).toBe(1);
    expect(hard.generator.ratio).toBeGreaterThan(3);
    expect(hard.ambiguous).toBe(true);
    expect(hard.weight).toBe(2); // proposed 3, lowered by one
  });

  it('drops the impossible task and the duplicate, each with a reason', () => {
    const byId = Object.fromEntries(result.dropped.map((d) => [d.id, d.reason]));
    expect(byId['book-a-flight']).toMatch(/no replayable actions/);
    expect(byId['read-the-welcome-text']).toMatch(/without a plausible end state/);
  });

  it('reports token usage and cost', () => {
    expect(result.usage.calls).toBeGreaterThan(3);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.costKnown).toBe(true);
    expect(result.usage.cost).toBeGreaterThan(0);
  });

  it('writes a tasks.json that task.js can load back unchanged', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gen-tasks-')), 'tasks.json');
    saveTasks(file, result.tasks, result.url);
    const loaded = loadTasks(file);
    expect(loaded.url).toBe(result.url);
    expect(loaded.tasks.map((t) => t.id)).toEqual(result.tasks.map((t) => t.id));
    for (const t of loaded.tasks) {
      expect(t.description).not.toMatch(/#|data-testid|querySelector/);
      expect(t.sightedPath.length).toBeGreaterThan(0);
      expect(t.generator).toBeTruthy();
    }
  });
});
