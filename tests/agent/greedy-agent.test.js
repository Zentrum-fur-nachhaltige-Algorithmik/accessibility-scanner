import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const ScreenReaderEnv = require('../../src/agent/screenreader-env');
const {
  runGreedyAgent,
  keywordsOf,
  keywordsFor,
  scorePhrase,
} = require('../../src/agent/greedy-agent');

/** Run the greedy agent on `test-sites/agent/<file>` and return run + trace. */
async function runOn(file, task, maxSteps = 30) {
  const page = await getPage(`${getBaseUrl()}/agent/${file}`);
  const env = new ScreenReaderEnv(page, { maxSteps });
  try {
    await env.start();
    const run = await runGreedyAgent({ env, task, maxSteps });
    return { run, trace: env.trace };
  } finally {
    try {
      await env.stop();
    } catch {
      /* ignore */
    }
    await page.close();
  }
}

const commands = (trace) => trace.map((e) => e.cmd.type);
const notes = (trace) => trace.map((e) => e.note || '').join('\n');

describe('greedy agent scoring', () => {
  it('keeps only content words of at least three letters', () => {
    const words = keywordsOf('What are the opening hours of the practice?').map((k) => k.word);
    expect(words).toContain('opening');
    expect(words).toContain('hours');
    expect(words).toContain('practice');
    expect(words).not.toContain('the');
    expect(words).not.toContain('are');
    expect(words).not.toContain('what');
  });

  it('folds diacritics and drops duplicates by stem', () => {
    const words = keywordsOf('Öffnungszeiten der Ordination, Ordinationen').map((k) => k.word);
    expect(words[0]).toBe('oeffnungszeiten');
    expect(words.filter((w) => w.startsWith('ordination'))).toHaveLength(1);
  });

  it('counts the keywords a phrase carries', () => {
    const kw = keywordsOf('Find the contact page of the practice');
    expect(scorePhrase('link, Contact', kw).score).toBe(1);
    expect(scorePhrase('heading, Contact the practice, level 2', kw).score).toBe(2);
    expect(scorePhrase('paragraph, Nothing to see here', kw).score).toBe(0);
  });

  it('gives the role bonus only on top of a real keyword match', () => {
    const kw = keywordsOf('Find the contact page');
    // The bonus ranks a link above a paragraph of the same score, but a role
    // word alone never scores, so "link, Home" stays at zero.
    expect(scorePhrase('link, Contact', kw).rank).toBeGreaterThan(
      scorePhrase('paragraph, Contact us any time', kw).rank
    );
    expect(scorePhrase('link, Home', kw).score).toBe(0);
    expect(scorePhrase('link, Home', kw).rank).toBe(0);
  });
});

describe('greedy agent keyword source', () => {
  it('prefers the task keywords over the description', () => {
    const words = keywordsFor({
      description: 'Find the page where you can see how to get in touch with this company.',
      keywords: ['Kontakt', 'Telefon'],
    }).map((k) => k.word);
    expect(words).toEqual(['kontakt', 'telefon']);
  });

  it('falls back to the description without usable keywords', () => {
    const fromDescription = keywordsOf('Find the contact page').map((k) => k.word);
    expect(keywordsFor({ description: 'Find the contact page' }).map((k) => k.word)).toEqual(
      fromDescription
    );
    expect(
      keywordsFor({ description: 'Find the contact page', keywords: ['the', 'a'] }).map(
        (k) => k.word
      )
    ).toEqual(fromDescription);
  });
});

describe('greedy agent policy', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('solves an action task through the links list', async () => {
    const { run, trace } = await runOn('generic-home.html', {
      id: 'contact',
      description: 'Open the contact page',
      kind: 'action',
    });
    expect(commands(trace)).toEqual(['links', 'jumpTo', 'activate', 'done']);
    expect(run.stoppedBy).toBe('done');
    expect(run.nSr).toBe(4);
    // The trace reads like the LLM agent's: every command carries its reason.
    expect(notes(trace)).toMatch(/best link "Contact" scores 1 of \d+ keywords/);
    expect(trace[trace.length - 1].obsAfter.url).toContain('generic-contact.html');
    // No model was called, so the run is free.
    expect(run.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
      cost: 0,
      costKnown: true,
    });
  }, 60000);

  it('solves a task whose description is in another language than the page', async () => {
    const task = {
      id: 'kontakt',
      description: 'Finden Sie heraus, wie man dieses Unternehmen erreicht.',
      kind: 'action',
    };
    // Without keywords no German word of the task ever meets the English page,
    // so the policy never gets to the contact page.
    const blind = await runOn('generic-home.html', task, 12);
    expect(blind.trace[blind.trace.length - 1].obsAfter.url).not.toContain('generic-contact.html');
    // The generator's page-language keywords are what the page really says.
    const { run, trace } = await runOn(
      'generic-home.html',
      { ...task, keywords: ['Contact', 'Telefon'] },
      12
    );
    expect(commands(trace)).toEqual(['links', 'jumpTo', 'activate', 'done']);
    expect(run.stoppedBy).toBe('done');
    expect(trace[trace.length - 1].obsAfter.url).toContain('generic-contact.html');
  }, 90000);

  it('solves an information task by reading under the best heading', async () => {
    const { run, trace } = await runOn('quick-keys.html', {
      id: 'insurance',
      description: 'What does the contact section say about the insurance card?',
      kind: 'information',
      answerType: 'text',
    });
    expect(run.stoppedBy).toBe('done');
    expect(commands(trace)).toContain('headings');
    // The answer is heard by reading on with `next` under the matching heading.
    expect(commands(trace).filter((c) => c === 'next').length).toBeGreaterThan(0);
    expect(notes(trace)).toMatch(/best heading "Contact" scores/);
    const phrases = trace.map((e) => e.obsAfter.phrase || '');
    expect(phrases.some((p) => /insurance card/i.test(p))).toBe(true);
  }, 60000);

  it('finds an answer that no heading announces by searching for a keyword', async () => {
    const { trace } = await runOn('quick-keys.html', {
      id: 'hours',
      description: 'What are the ordination hours of the practice?',
      kind: 'information',
      answerType: 'hours',
    });
    expect(commands(trace)).toContain('find');
    const phrases = trace.map((e) => e.obsAfter.phrase || '');
    expect(phrases.some((p) => /Ordination hours/i.test(p))).toBe(true);
  }, 60000);

  it('runs out of budget on a task whose words are nowhere on the page', async () => {
    const { run, trace } = await runOn(
      'quick-keys.html',
      { id: 'pizza', description: 'Order a pizza with extra pineapple', kind: 'action' },
      6
    );
    expect(run.stoppedBy).toBe('budget');
    expect(run.nSr).toBe(6);
    expect(commands(trace)).not.toContain('done');
    // Giving up is recorded as a free backtrack mark, so the trace says why.
    const last = trace[trace.length - 1];
    expect(last.cmd.type).toBe('mark');
    expect(last.free).toBe(true);
    expect(last.mark.kind).toBe('backtrack');
    expect(last.mark.reason).toMatch(/budget ran out/);
  }, 60000);

  it('never activates the same jump target twice', async () => {
    const { trace } = await runOn(
      'quick-keys.html',
      { id: 'contact-twice', description: 'Contact the practice', kind: 'action' },
      20
    );
    const jumped = trace
      .filter((e) => e.cmd.type === 'jumpTo' || e.cmd.type === 'nextLink')
      .map((e) => (e.obsAfter.phrase || '').toLowerCase());
    const activatedAfter = trace
      .map((e, i) =>
        e.cmd.type === 'activate' ? (trace[i - 1].obsAfter.phrase || '').toLowerCase() : null
      )
      .filter(Boolean);
    expect(new Set(activatedAfter).size).toBe(activatedAfter.length);
    expect(jumped.length).toBeGreaterThan(0);
  }, 60000);
});
