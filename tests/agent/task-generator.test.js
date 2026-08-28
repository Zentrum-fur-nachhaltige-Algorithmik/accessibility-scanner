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
  keywordsOf,
  matchedKeywords,
  usableEvidence,
  spokenPhraseFor,
  phrasesNear,
  informationOracle,
  navigationOracle,
  isNavigationGoal,
  oracleKey,
  dedupeByOracle,
  PROPOSE_TASKS_TOOL,
  PROPOSE_ORACLE_TOOL,
  JUDGE_OUTCOME_TOOL,
  PICK_EVIDENCE_TOOL,
  ORACLE_TYPES,
} = require('../../src/agent/task-generator');
const { loadTasks, saveTasks } = require('../../src/agent/task');
const { validateTask } = require('../../src/agent/replay');

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

// The LLM double

/**
 * One fake client for the whole pipeline. It dispatches on which tool it was
 * offered: `propose_tasks` → the proposal, `propose_oracle` → an oracle spec,
 * `judge_outcome` → the outcome verdict (satisfied, no quotable evidence unless
 * scripted), `pick_evidence` → the answer snippet, anything else → the
 * sighted-agent action script for the goal in the message.
 *
 * Sighted actions address elements by name and read the number out of the
 * rendered observation, exactly as a real model has to.
 */
function fakeLlm({ proposal, solutions, oracle, judge, evidence }) {
  const calls = { propose: 0, oracle: 0, sighted: 0, judge: 0, evidence: 0 };
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
      if (toolNames.includes('judge_outcome')) {
        calls.judge += 1;
        const text = String(messages[0].content);
        const entry = Object.entries(judge || {}).find(([description]) =>
          text.includes(description)
        );
        // Default: the page is accepted, but nothing on it is quotable, so the
        // task stays an action task.
        return ok('judge_outcome', entry ? entry[1] : { satisfied: true, evidence: '' });
      }
      if (toolNames.includes('pick_evidence')) {
        calls.evidence += 1;
        const text = String(messages[0].content);
        const entry = Object.entries(evidence || {}).find(([description]) =>
          text.includes(description)
        );
        // A scripted array answers the first and the second (phrase-aware) call
        // differently; a plain string always answers the same. An entry may also
        // be `{ text, answer, answerType }` to script the ground-truth answer.
        const asPick = (v) => {
          const o = typeof v === 'string' ? { text: v } : v || {};
          return {
            text: o.text || '',
            answer: o.answer === undefined ? o.text || '' : o.answer,
            answerType: o.answerType || 'text',
          };
        };
        if (!entry) return ok('pick_evidence', asPick(''));
        if (!Array.isArray(entry[1])) return ok('pick_evidence', asPick(entry[1]));
        const key = `evidence:${entry[0]}`;
        const i = cursors.get(key) || 0;
        cursors.set(key, i + 1);
        return ok('pick_evidence', asPick(entry[1][Math.min(i, entry[1].length - 1)]));
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

// Pure units

describe('agent/task-generator: tool schemas', () => {
  it('propose_tasks enforces the candidate shape', () => {
    const p = PROPOSE_TASKS_TOOL.function.parameters;
    expect(p.required).toEqual(['siteType', 'tasks']);
    const item = p.properties.tasks.items;
    expect(item.required).toEqual(['id', 'description', 'weight', 'expectedOutcome', 'keywords']);
    expect(item.properties.keywords).toMatchObject({ minItems: 3, maxItems: 8 });
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

describe('agent/task-generator: merging and intent', () => {
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

describe('agent/task-generator: deterministic oracle', () => {
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

describe('agent/task-generator: plausibility and ambiguity weighting', () => {
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

describe('agent/task-generator: outcome corroboration', () => {
  const cand = {
    description: 'Find out the regular weekly opening hours of the practice.',
    expectedOutcome: 'The opening hours for each weekday are displayed.',
  };

  it('keeps the content words of the task and drops the ones every task uses', () => {
    const words = keywordsOf(cand);
    expect(words).toEqual(expect.arrayContaining(['opening', 'hours', 'weekly', 'practice']));
    // Too short, or says nothing about WHICH page one is on.
    expect(words).not.toContain('the');
    expect(words).not.toContain('page');
    expect(words).not.toContain('displayed');
    expect(words).not.toContain('find');
  });

  it('matches a keyword through a simple stem, in the task own language', () => {
    expect(matchedKeywords(['opening'], 'Wir haben geöffnet')).toEqual([]);
    expect(matchedKeywords(['opening'], 'Opening times')).toEqual(['opening']);
    expect(matchedKeywords(['opening'], 'The practice is open on Monday')).toEqual(['opening']);
    expect(matchedKeywords(['ordinationszeiten'], 'ORDINATIONSZEITEN')).toEqual([
      'ordinationszeiten',
    ]);
    expect(matchedKeywords(['booking'], '')).toEqual([]);
  });

  it('does not let a generic word in the url corroborate anything', () => {
    // The bug this exists for: "/page10/page10.html" corroborating "the booking
    // page opens" because both contain "page".
    expect(
      matchedKeywords(
        keywordsOf({
          description: 'Book an appointment online.',
          expectedOutcome: 'The online booking page opens.',
        }),
        '/page10/page10.html'
      )
    ).toEqual([]);
  });

  it('accepts an evidence snippet only when it really is on the page', () => {
    const view = { title: 'Impressum', headings: [], text: 'Ordinationszeiten Mo bis Fr 8 bis 12' };
    expect(usableEvidence('Ordinationszeiten Mo bis Fr', view)).toBe('Ordinationszeiten Mo bis Fr');
    expect(usableEvidence('  Ordinationszeiten   Mo  ', view)).toBe('Ordinationszeiten Mo');
    expect(usableEvidence('Termine nach Vereinbarung', view)).toBeNull(); // invented
    expect(usableEvidence('Ordinationszeiten', view)).toBeNull(); // one word
    expect(usableEvidence('Ordinationszeiten Mo bis Fr 8 bis 12', view)).toBeNull(); // too many
    expect(usableEvidence('', view)).toBeNull();
  });

  it('places an evidence snippet in a single SPOKEN phrase, not just in the text', () => {
    // What the screen reader really says on such a page: one phrase per node.
    const phrases = [
      'heading, ORDINATIONSZEITEN, level 2',
      'end of heading',
      'MO: 12h30 - 18h30',
      'DI: 8h00 - 12h00',
    ];
    // Visible as one line, spoken as two phrases: never heard as one.
    expect(spokenPhraseFor('ORDINATIONSZEITEN MO: 12h30 - 18h30', phrases)).toBeNull();
    // Inside one phrase, case- and whitespace-tolerant.
    expect(spokenPhraseFor('mo:   12h30 - 18h30', phrases)).toBe('MO: 12h30 - 18h30');
    expect(spokenPhraseFor('', phrases)).toBeNull();
    expect(spokenPhraseFor('MO: 12h30 - 18h30', [])).toBeNull();
    // Punctuation the model drops or adds must not hide a phrase that is spoken as one.
    const footer = ['© Ordination Dr. Elena Brandt, Herrengasse 18/2, 8010 Graz', '8010 Graz'];
    expect(spokenPhraseFor('Herrengasse 18/2 8010 Graz', footer)).toBe(footer[0]);
    expect(spokenPhraseFor('Herrengasse 18 2 8010 Graz', footer)).toBe(footer[0]);
  });

  it('offers the phrases that share a word with the snippet, best first', () => {
    const phrases = [
      'banner',
      'heading, ORDINATIONSZEITEN, level 2',
      'MO: 12h30 - 18h30',
      'link, Kontakt',
    ];
    const offered = phrasesNear('ORDINATIONSZEITEN MO: 12h30 - 18h30', phrases);
    // Most shared words first: three of them are in the times phrase.
    expect(offered[0]).toBe('MO: 12h30 - 18h30');
    expect(offered).toContain('heading, ORDINATIONSZEITEN, level 2');
    expect(offered).not.toContain('banner');
    expect(offered).not.toContain('link, Kontakt');
    // Words with punctuation inside ("08:00") still find their phrase.
    expect(phrasesNear('Montag 08:00 - 16:00', ['Montag', '08:00 - 16:00', 'Team'])).toEqual([
      '08:00 - 16:00',
      'Montag',
    ]);
    // Never more than a handful, and nothing to offer without words.
    expect(phrasesNear('a b', phrases)).toEqual([]);
    expect(phrasesNear('ORDINATIONSZEITEN', new Array(50).fill('ORDINATIONSZEITEN')).length).toBe(
      20
    );
  });

  it('builds an elementWithText oracle, joined with the url when it changed', () => {
    const stayed = { before: { url: 'http://s/a' }, after: { url: 'http://s/a' } };
    expect(informationOracle('Musterstrasse 1', stayed)).toEqual({
      type: 'elementWithText',
      text: 'Musterstrasse\\s+1',
    });
    const moved = { before: { url: 'http://s/' }, after: { url: 'http://s/contact' } };
    expect(informationOracle('Musterstrasse 1', moved)).toEqual({
      type: 'all',
      of: [
        { type: 'urlMatches', pattern: '/contact' },
        { type: 'elementWithText', text: 'Musterstrasse\\s+1' },
      ],
    });
  });

  it('reads a description that only asks to reach a page as a navigation goal', () => {
    expect(
      isNavigationGoal({ description: 'View the legal notice and imprint of the practice.' })
    ).toBe(true);
    expect(
      isNavigationGoal({ description: 'Open the page "Leistungen" from the main menu.' })
    ).toBe(true);
    expect(isNavigationGoal({ description: 'Das Impressum der Praxis aufrufen.' })).toBe(true);
    // A question wins, even when it names a page to open.
    expect(
      isNavigationGoal({ description: 'Open the services page and find out what it offers.' })
    ).toBe(false);
    expect(isNavigationGoal({ description: 'Find out when the practice is open.' })).toBe(false);
    expect(isNavigationGoal({ description: 'Wie viel kostet eine Untersuchung?' })).toBe(false);
    // No verb of either kind: nothing is decided here.
    expect(isNavigationGoal({ description: 'A booking confirmation.' })).toBe(false);
  });

  it('builds the navigation oracle from the destination url plus its heading', () => {
    const solved = {
      before: { url: 'http://s/', headings: ['Home'] },
      after: { url: 'http://s/impressum', headings: ['Impressum', 'Angaben'] },
    };
    expect(navigationOracle(solved)).toEqual({
      type: 'all',
      of: [
        { type: 'urlMatches', pattern: '/impressum' },
        { type: 'elementWithText', text: 'Impressum' },
      ],
    });
    // Without a usable heading the url alone is the oracle.
    expect(
      navigationOracle({
        before: { url: 'http://s/' },
        after: { url: 'http://s/team', headings: [] },
      })
    ).toEqual({ type: 'urlMatches', pattern: '/team' });
  });

  it('offers judge_outcome and pick_evidence with a closed shape', () => {
    const judge = JUDGE_OUTCOME_TOOL.function.parameters;
    expect(judge.required).toEqual(['satisfied', 'evidence']);
    expect(judge.properties.satisfied.type).toBe('boolean');
    const evidence = PICK_EVIDENCE_TOOL.function.parameters;
    expect(evidence.required).toEqual(['text', 'answer', 'answerType']);
    expect(evidence.properties.answerType.enum).toEqual([
      'phone',
      'email',
      'address',
      'hours',
      'text',
    ]);
    expect(evidence.additionalProperties).toBe(false);
  });
});

describe('agent/task-generator: duplicate oracles', () => {
  const t = (id, oracle, score, weight = 1) => ({
    id,
    description: `task ${id}`,
    weight,
    oracle,
    generator: { corroborationScore: score },
  });

  it('is blind to key order', () => {
    expect(oracleKey({ type: 'urlMatches', pattern: 'a' })).toBe(
      oracleKey({ pattern: 'a', type: 'urlMatches' })
    );
    expect(oracleKey({ type: 'urlMatches', pattern: 'a' })).not.toBe(
      oracleKey({ type: 'urlMatches', pattern: 'b' })
    );
  });

  it('keeps the best corroborated task and drops the rest with a reason', () => {
    const same = { type: 'urlMatches', pattern: '/page10' };
    const dropped = [];
    const kept = dedupeByOracle(
      [
        t('book-appointment', same, 0),
        t('view-imprint', same, 2),
        t('find-opening-hours', same, 1),
        t('search', { type: 'urlMatches', pattern: '/search' }, 0),
      ],
      dropped
    );
    expect(kept.map((x) => x.id)).toEqual(['view-imprint', 'search']);
    expect(dropped.map((d) => d.id).sort()).toEqual(['book-appointment', 'find-opening-hours']);
    for (const d of dropped) expect(d.reason).toMatch(/duplicate-oracle: .*"view-imprint"/);
  });

  it('breaks a tie by weight and then by order', () => {
    const same = { type: 'urlMatches', pattern: '/x' };
    expect(dedupeByOracle([t('a', same, 1, 1), t('b', same, 1, 3)], []).map((x) => x.id)).toEqual([
      'b',
    ]);
    expect(dedupeByOracle([t('a', same, 1, 2), t('b', same, 1, 2)], []).map((x) => x.id)).toEqual([
      'a',
    ]);
  });
});

describe('agent/task-generator: exploration links', () => {
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

// End to end against the mini-site, with the fake LLM

describe('agent/task-generator: end to end (fake llm, real browser)', () => {
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
          {
            id: 'find-the-city',
            description: 'Find out which city the office is in.',
            weight: 2,
            expectedOutcome: 'The city Berlin is shown with the postal address.',
          },
          {
            id: 'find-the-opening-times',
            description: 'Find out at what times the shop is open.',
            weight: 2,
            expectedOutcome: 'The weekday opening times are listed.',
          },
          {
            id: 'get-to-the-goods-overview',
            description: 'Get to the overview of the goods on sale.',
            weight: 1,
            expectedOutcome: 'The item overview opens.',
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
        // the answer is a piece of text on the page it lands on
        'Find out which city the office is in.': [
          { name: 'click', target: 'Contact' },
          { name: 'done', arguments: { summary: 'The address in Berlin is shown.' } },
        ],
        // lands somewhere plausible-looking that does not answer the question
        'Find out at what times the shop is open.': [
          { name: 'click', target: 'Contact' },
          { name: 'done', arguments: { summary: 'The contact page is shown.' } },
        ],
        // a second route to the very same page as see-the-product-range
        'Get to the overview of the goods on sale.': [
          { name: 'click', target: 'Products' },
          { name: 'done', arguments: { summary: 'The product overview is shown.' } },
        ],
      },
      oracle: {
        'Find out what this company sells.': { type: 'titleMatches', pattern: 'Products' },
        'Find out where this company is based.': {
          type: 'urlMatches',
          pattern: 'generic-contact',
        },
        'Get to the overview of the goods on sale.': {
          type: 'titleMatches',
          pattern: 'Products',
        },
      },
      judge: {
        'Find out at what times the shop is open.': {
          satisfied: false,
          evidence: 'this is the contact page, it says nothing about opening times',
        },
      },
      evidence: {
        'Find out which city the office is in.': {
          text: 'Musterstrasse 1, 10115 Berlin',
          answer: 'Musterstrasse 1, 10115 Berlin',
          answerType: 'address',
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
      'find-the-city',
    ]);
  });

  it('records where the corroboration for each kept task came from', () => {
    const by = Object.fromEntries(result.tasks.map((t) => [t.id, t.generator.corroboration]));
    // "product" is in the destination path itself
    expect(by['see-the-product-range']).toBe('keyword');
    // nothing matched, so the judge had to decide
    expect(by['find-the-postal-address']).toBe('llm');
    // "berlin" is in the page text, not in the url
    expect(by['find-the-city']).toBe('keyword');
    for (const t of result.tasks) expect(typeof t.generator.prunedSteps).toBe('number');
  });

  it('turns a task whose answer is page text into an information task', () => {
    const info = result.tasks.find((t) => t.id === 'find-the-city');
    expect(info.kind).toBe('information');
    expect(info.evidence).toBe('Musterstrasse 1, 10115 Berlin');
    // The oracle is the answer text, plus the page it is on.
    expect(info.oracle).toEqual({
      type: 'all',
      of: [
        { type: 'urlMatches', pattern: '/agent/generic-contact\\.html' },
        { type: 'elementWithText', text: 'Musterstrasse\\s+1,\\s+10115\\s+Berlin' },
      ],
    });
    expect(info.meta.oracleOrigin).toBe('evidence');
    // The ground truth the harness matches fuzzily, next to the verbatim evidence.
    expect(info.answer).toBe('Musterstrasse 1, 10115 Berlin');
    expect(info.answerType).toBe('address');
    // The others stay action tasks and carry no answer.
    const products = result.tasks.find((t) => t.id === 'see-the-product-range');
    expect(products.kind).toBe('action');
    expect(products.answer).toBeUndefined();
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

  it('drops the impossible task, the implausible one and the duplicate, each with a reason', () => {
    const byId = Object.fromEntries(result.dropped.map((d) => [d.id, d.reason]));
    // Nothing was done and nothing on the page answers it either.
    expect(byId['book-a-flight']).toMatch(/outcome-not-corroborated/);
    expect(byId['read-the-welcome-text']).toMatch(/without a plausible end state/);
    // The url changed, but the page it changed to is not the answer.
    expect(byId['find-the-opening-times']).toMatch(/outcome-not-corroborated/);
    // Same oracle as see-the-product-range, which is better corroborated.
    expect(byId['get-to-the-goods-overview']).toMatch(
      /duplicate-oracle: .*"see-the-product-range"/
    );
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

// The evidence of an information task must be SPOKEN, not merely visible

describe('agent/task-generator: evidence is verified against the spoken phrases', () => {
  let result;
  let llm;

  beforeAll(async () => {
    llm = fakeLlm({
      proposal: {
        siteType: 'small demo company website',
        tasks: [
          {
            id: 'find-the-city',
            description: 'Find out which city the office is in.',
            weight: 1,
            expectedOutcome: 'The city Berlin is shown with the postal address.',
          },
          {
            id: 'find-the-street',
            description: 'Find out which street the office is in.',
            weight: 1,
            expectedOutcome: 'The street Musterstrasse is shown.',
          },
        ],
      },
      solutions: {
        'Find out which city the office is in.': [
          { name: 'click', target: 'Contact' },
          { name: 'done', arguments: { summary: 'The address in Berlin is shown.' } },
        ],
        'Find out which street the office is in.': [
          { name: 'click', target: 'Contact' },
          { name: 'done', arguments: { summary: 'The address is shown.' } },
        ],
      },
      oracle: {},
      evidence: {
        // First pick spans the heading and the paragraph - two spoken phrases,
        // so it could never be heard; the second pick sits in one phrase.
        'Find out which city the office is in.': [
          // The first call also invents an answer that is nowhere on the page:
          // it must be rejected, and the re-pick's answer used instead.
          {
            text: 'Contact Mini Site GmbH',
            answer: 'Hauptplatz 9, 4020 Linz',
            answerType: 'address',
          },
          {
            text: 'Musterstrasse 1, 10115 Berlin',
            answer: 'Musterstrasse 1, 10115 Berlin',
            answerType: 'address',
          },
        ],
        // This one never manages: the answer is visible but not readable.
        'Find out which street the office is in.': [
          'Contact Mini Site GmbH',
          'Contact Mini Site GmbH',
        ],
      },
    });

    result = await generateTasks({
      browser: getBrowser(),
      url: `${baseUrl}${HOME}`,
      llm,
      model: 'fake',
      logger: { info: () => {} },
      options: { generic: false, explore: 0, maxTasks: 8, sightedMaxSteps: 6 },
    });
  }, 300000);

  it('asks pick_evidence a second time when the first snippet spans two phrases', () => {
    // Two candidates, two calls each: the first pick and the phrase-aware re-pick.
    expect(llm.calls.evidence).toBe(4);
    const city = result.tasks.find((t) => t.id === 'find-the-city');
    expect(city).toBeTruthy();
    expect(city.kind).toBe('information');
    // The re-picked snippet, which the page really speaks as one phrase.
    expect(city.evidence).toBe('Musterstrasse 1, 10115 Berlin');
  });

  it('rejects an answer that is not on the page and keeps the verified one', () => {
    const city = result.tasks.find((t) => t.id === 'find-the-city');
    expect(city.answer).toBe('Musterstrasse 1, 10115 Berlin');
    expect(city.answerType).toBe('address');
  });

  it('drops a task whose answer is visible but in no spoken phrase', () => {
    expect(result.tasks.map((t) => t.id)).not.toContain('find-the-street');
    const drop = result.dropped.find((d) => d.id === 'find-the-street');
    expect(drop.reason).toMatch(/^evidence-not-spoken:/);
    expect(drop.reason).toContain('Contact Mini Site GmbH');
    // The phrases we looked at are kept with the drop: that IS the report.
    expect(Array.isArray(drop.phrases)).toBe(true);
    expect(drop.phrases.join(' | ')).toMatch(/Musterstrasse 1, 10115 Berlin/);
    expect(drop.phrases.some((p) => /heading, Contact/.test(p))).toBe(true);
  });
});

describe('agent/task-generator: concurrency (fake llm, real browser)', () => {
  /** Wrap a fake client so every call is slow enough to overlap, and counted. */
  function instrument(llm, delayMs) {
    const stats = { inFlight: 0, peak: 0 };
    const inner = llm.chat;
    llm.chat = vi.fn(async (...args) => {
      stats.inFlight += 1;
      stats.peak = Math.max(stats.peak, stats.inFlight);
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        return await inner(...args);
      } finally {
        stats.inFlight -= 1;
      }
    });
    return stats;
  }

  // One click each, but to three different pages: two tasks with the same
  // oracle would be deduplicated, and this is a test about scheduling.
  const CANDIDATES = [
    {
      description: 'Find out what this company sells.',
      expectedOutcome: 'A page listing the product range is shown.',
      target: 'Products',
      pattern: '/agent/generic-products\\.html',
    },
    {
      description: 'Find out how to get in touch with this company.',
      expectedOutcome: 'The contact details are shown.',
      target: 'Contact',
      pattern: '/agent/generic-contact\\.html',
    },
    {
      description: 'Get to the place where you can log in.',
      expectedOutcome: 'The login form is shown.',
      target: 'Log in',
      pattern: '/agent/generic-login\\.html',
    },
  ];

  const proposal = {
    siteType: 'small demo company website',
    tasks: CANDIDATES.map((c, i) => ({
      id: `candidate-${i + 1}`,
      description: c.description,
      weight: 1,
      expectedOutcome: c.expectedOutcome,
    })),
  };

  const solutions = Object.fromEntries(
    CANDIDATES.map((c) => [
      c.description,
      [
        { name: 'click', target: c.target },
        { name: 'done', arguments: { summary: 'shown' } },
      ],
    ])
  );

  const generate = async (concurrency) => {
    const llm = fakeLlm({ proposal, solutions, oracle: {} });
    const stats = instrument(llm, 100);
    const result = await generateTasks({
      browser: getBrowser(),
      url: `${baseUrl}${HOME}`,
      llm,
      model: 'fake',
      logger: { info: () => {} },
      options: { generic: false, explore: 0, maxTasks: 8, sightedMaxSteps: 6, concurrency },
    });
    return { result, stats };
  };

  it('builds candidates in parallel up to the limit, in candidate order', async () => {
    const { result, stats } = await generate(2);
    expect(result.tasks.map((t) => t.id)).toEqual(['candidate-1', 'candidate-2', 'candidate-3']);
    expect(stats.peak).toBe(2);
    expect(stats.inFlight).toBe(0);
    // Per-stage timings and the wall clock are reported.
    expect(result.wallClockMs).toBeGreaterThan(0);
    for (const t of result.tasks) {
      expect(t.timings.solveMs).toBeGreaterThan(0);
      expect(t.timings.validateMs).toBeGreaterThan(0);
      expect(t.timings.nOptMs).toBeGreaterThanOrEqual(0);
      expect(typeof t.timings.oracleMs).toBe('number');
    }
    // The wall clock beats the sum of the stages once more than one runs at once.
    const stageSum = result.tasks.reduce(
      (a, t) =>
        a + t.timings.solveMs + t.timings.oracleMs + t.timings.validateMs + t.timings.nOptMs,
      0
    );
    expect(stageSum).toBeGreaterThan(0);
  }, 300000);

  it('never overlaps two candidates at concurrency 1, and produces the same tasks', async () => {
    const { result, stats } = await generate(1);
    expect(stats.peak).toBe(1);
    expect(result.tasks.map((t) => t.id)).toEqual(['candidate-1', 'candidate-2', 'candidate-3']);
    result.tasks.forEach((t, i) => {
      expect(t.oracle).toEqual({ type: 'urlMatches', pattern: CANDIDATES[i].pattern });
      expect(t.sightedPath).toHaveLength(1);
    });
  }, 300000);
});

describe('agent/task-generator: the language of the page and the direct link', () => {
  const SHORTCUT = '/agent/bfs-shortcut.html';

  const proposal = {
    siteType: 'demo site',
    tasks: [
      {
        id: 'reach-contact',
        description: 'Reach the contact page of this website.',
        weight: 2,
        expectedOutcome: 'The contact page is shown.',
        keywords: ['Contact', 'Products', '  ', 'contact'],
      },
    ],
  };

  // The sighted agent takes the menu detour: Products first, contact page second.
  const solutions = {
    'Reach the contact page of this website.': [
      { name: 'click', target: 'Products' },
      { name: 'click', target: 'Contact us about a product' },
      { name: 'done', arguments: { summary: 'The contact page is shown.' } },
    ],
  };

  let result;

  beforeAll(async () => {
    result = await generateTasks({
      browser: getBrowser(),
      url: `${baseUrl}${SHORTCUT}`,
      llm: fakeLlm({ proposal, solutions, oracle: {} }),
      model: 'fake',
      logger: { info: () => {} },
      options: { generic: false, explore: 0, maxTasks: 4, sightedMaxSteps: 6 },
    });
  }, 300000);

  it('reports the language of the page and keeps the task keywords', () => {
    expect(result.language).toBe('en');
    const task = result.tasks[0];
    // Trimmed, deduplicated case-insensitively, in the order the model gave them.
    expect(task.keywords).toEqual(['Contact', 'Products']);
  });

  it('records the sighted path as the single click the start page offers', () => {
    const task = result.tasks[0];
    expect(task.sightedPath).toHaveLength(1);
    expect(task.generator.shortened).toBe(true);
    // The agent's own path is kept for the ambiguity signal.
    expect(task.generator.agentPathLength).toBe(2);
    expect(task.generator.pathLength).toBe(1);
  });

  it('the shortened path still replays into the same oracle', async () => {
    const task = result.tasks[0];
    const v = await validateTask(getBrowser(), `${baseUrl}${SHORTCUT}`, task, {
      repeats: 1,
      computeOptimal: false,
    });
    expect(v.valid).toBe(true);
    expect(v.nSighted).toBe(1);
  }, 120000);
});
