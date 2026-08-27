import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const {
  evaluate,
  validateSpec,
  createRequestRecorder,
  escapeRegExp,
  PREDICATE_TYPES,
} = require('../../src/agent/oracle');

const BASIC = '/agent/oracle-basic.html';

describe('agent/oracle: validateSpec', () => {
  it('rejects unknown predicate types', () => {
    expect(() => validateSpec({ type: 'doesNotExist' })).toThrow(/unknown predicate type/i);
  });

  it('rejects a non-object spec', () => {
    expect(() => validateSpec('urlMatches')).toThrow(/must be an object/i);
    expect(() => validateSpec(null)).toThrow(/must be an object/i);
  });

  it('rejects missing required fields', () => {
    expect(() => validateSpec({ type: 'urlMatches' })).toThrow(/pattern/);
    expect(() => validateSpec({ type: 'elementVisible' })).toThrow(/selector/);
    expect(() => validateSpec({ type: 'formValue', selector: '#x' })).toThrow(/value/);
    expect(() => validateSpec({ type: 'storageKey', kind: 'nope', key: 'a' })).toThrow(/kind/);
    expect(() => validateSpec({ type: 'all', of: [] })).toThrow(/non-empty array/);
  });

  it('rejects invalid regular expressions', () => {
    expect(() => validateSpec({ type: 'urlMatches', pattern: '([' })).toThrow(
      /regular expression/i
    );
  });

  it('validates nested specs recursively', () => {
    expect(() =>
      validateSpec({ type: 'any', of: [{ type: 'urlMatches', pattern: 'a' }, { type: 'bogus' }] })
    ).toThrow(/unknown predicate type "bogus"/);
    expect(
      validateSpec({
        type: 'all',
        of: [
          { type: 'urlMatches', pattern: 'a' },
          { type: 'any', of: [{ type: 'titleMatches', pattern: 'b' }] },
        ],
      })
    ).toBeTruthy();
  });

  it('knows every predicate type from the spec', () => {
    for (const t of [
      'urlMatches',
      'elementWithText',
      'elementVisible',
      'formValue',
      'requestSent',
      'storageKey',
      'titleMatches',
      'focusInDialog',
      'all',
      'any',
    ]) {
      expect(PREDICATE_TYPES).toContain(t);
    }
  });

  it('escapeRegExp makes literal text safe', () => {
    expect(new RegExp(escapeRegExp('a.b?c'), 'i').test('a.b?c')).toBe(true);
    expect(new RegExp(escapeRegExp('a.b?c'), 'i').test('axbxc')).toBe(false);
  });
});

describe('agent/oracle: evaluate', () => {
  let page;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  beforeAll(async () => {
    page = await getPage(`${getBaseUrl()}${BASIC}`);
  }, 60000);

  afterAll(async () => {
    if (page) await page.close();
  });

  it('urlMatches: patterns are case-insensitive regexes', async () => {
    expect(await evaluate({ type: 'urlMatches', pattern: 'oracle-basic\\.html' }, page)).toBe(true);
    expect(await evaluate({ type: 'urlMatches', pattern: 'ORACLE-BASIC' }, page)).toBe(true);
    expect(await evaluate({ type: 'urlMatches', pattern: 'nowhere' }, page)).toBe(false);
  });

  it('titleMatches', async () => {
    expect(await evaluate({ type: 'titleMatches', pattern: 'oracle playground' }, page)).toBe(true);
    expect(await evaluate({ type: 'titleMatches', pattern: '^checkout$' }, page)).toBe(false);
  });

  it('elementWithText: only visible elements count', async () => {
    expect(await evaluate({ type: 'elementWithText', text: 'oracle playground' }, page)).toBe(true);
    expect(
      await evaluate({ type: 'elementWithText', selector: '#status', text: '^idle$' }, page)
    ).toBe(true);
    // #panel exists but is display:none
    expect(
      await evaluate({ type: 'elementWithText', selector: '#panel', text: 'success' }, page)
    ).toBe(false);
  });

  it('elementVisible flips after the DOM changes', async () => {
    const spec = { type: 'elementVisible', selector: '#panel' };
    expect(await evaluate(spec, page)).toBe(false);
    await page.click('#show-success');
    expect(await evaluate(spec, page)).toBe(true);
    expect(
      await evaluate({ type: 'elementWithText', selector: '#panel', text: 'sent' }, page)
    ).toBe(true);
  });

  it('not / all / any combine sub-predicates', async () => {
    const visible = { type: 'elementVisible', selector: '#panel' };
    const nope = { type: 'urlMatches', pattern: 'nowhere' };
    expect(await evaluate({ type: 'not', of: [nope] }, page)).toBe(true);
    expect(await evaluate({ type: 'all', of: [visible, nope] }, page)).toBe(false);
    expect(await evaluate({ type: 'any', of: [visible, nope] }, page)).toBe(true);
    expect(
      await evaluate(
        { type: 'all', of: [visible, { type: 'titleMatches', pattern: 'oracle' }] },
        page
      )
    ).toBe(true);
  });

  it('formValue matches the live input value', async () => {
    const spec = { type: 'formValue', selector: '#name', value: 'ada lovelace' };
    expect(await evaluate(spec, page)).toBe(false);
    await page.click('#fill');
    expect(await evaluate(spec, page)).toBe(true);
  });

  it('focusInDialog, with and without a name pattern', async () => {
    expect(await evaluate({ type: 'focusInDialog' }, page)).toBe(false);
    await page.click('#open-dlg');
    expect(await evaluate({ type: 'focusInDialog' }, page)).toBe(true);
    expect(await evaluate({ type: 'focusInDialog', namePattern: 'newsletter' }, page)).toBe(true);
    expect(await evaluate({ type: 'focusInDialog', namePattern: 'checkout' }, page)).toBe(false);
    await page.click('#dlg-close');
    expect(await evaluate({ type: 'focusInDialog' }, page)).toBe(false);
  });

  it('storageKey covers local, session and cookie storage', async () => {
    const local = { type: 'storageKey', kind: 'local', key: 'sr-agent-pref' };
    const session = { type: 'storageKey', kind: 'session', key: 'sr-agent-session' };
    const cookie = { type: 'storageKey', kind: 'cookie', key: 'sr-agent-cookie' };
    expect(await evaluate(local, page)).toBe(false);
    expect(await evaluate(session, page)).toBe(false);
    expect(await evaluate(cookie, page)).toBe(false);

    await page.click('#store');

    expect(await evaluate(local, page)).toBe(true);
    expect(await evaluate(session, page)).toBe(true);
    expect(await evaluate(cookie, page)).toBe(true);
    expect(await evaluate({ ...local, valuePattern: 'accepted' }, page)).toBe(true);
    expect(await evaluate({ ...local, valuePattern: '^declined$' }, page)).toBe(false);
    expect(await evaluate({ type: 'storageKey', kind: 'local', key: 'missing' }, page)).toBe(false);
  });

  it('requestSent needs a recorder and matches method + url', async () => {
    const spec = { type: 'requestSent', urlPattern: 'oracle-ping\\.json', method: 'POST' };
    await expect(evaluate(spec, page)).rejects.toThrow(/request recorder/i);

    const recorder = createRequestRecorder(page);
    try {
      const ctx = { recorder };
      expect(await evaluate(spec, page, ctx)).toBe(false);

      await page.click('#ping');
      await page.waitForFunction(() => true);
      // give the fetch a moment to leave the page
      await new Promise((r) => setTimeout(r, 300));

      expect(await evaluate(spec, page, ctx)).toBe(true);
      expect(await evaluate({ type: 'requestSent', urlPattern: 'oracle-ping' }, page, ctx)).toBe(
        true
      );
      expect(
        await evaluate({ type: 'requestSent', urlPattern: 'oracle-ping', method: 'GET' }, page, ctx)
      ).toBe(false);
      expect(
        await evaluate({ type: 'requestSent', urlPattern: 'never-requested' }, page, ctx)
      ).toBe(false);
      // ctx.requests (bare array) works as well
      expect(await evaluate(spec, page, { requests: recorder.requests })).toBe(true);
    } finally {
      recorder.stop();
    }
  });

  it('throws a clear error for an invalid selector', async () => {
    await expect(evaluate({ type: 'elementVisible', selector: ':::' }, page)).rejects.toThrow(
      /invalid selector/i
    );
  });

  it('urlMatches follows navigation', async () => {
    const second = await getPage(`${getBaseUrl()}/agent/oracle-second.html`);
    try {
      expect(await evaluate({ type: 'urlMatches', pattern: 'oracle-second' }, second)).toBe(true);
      expect(await evaluate({ type: 'titleMatches', pattern: 'second oracle' }, second)).toBe(true);
    } finally {
      await second.close();
    }
  });
});
