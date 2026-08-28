import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage, getBrowser } = require('../helpers/browser-pool');
const {
  instantiateGenericTasks,
  collectCandidates,
  pathPattern,
  WORDS,
  TEMPLATE_IDS,
} = require('../../src/agent/generic-tasks');
const { validateTaskShape } = require('../../src/agent/task');
const { validateTask } = require('../../src/agent/replay');

const HOME = '/agent/generic-home.html';

describe('agent/generic-tasks', () => {
  let tasks;
  let byTemplate;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      tasks = await instantiateGenericTasks(page);
    } finally {
      await page.close();
    }
    byTemplate = Object.fromEntries(tasks.map((t) => [t.template, t]));
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('instantiates every template on the mini-site', () => {
    expect(tasks.length).toBe(TEMPLATE_IDS.length);
    for (const id of TEMPLATE_IDS) expect(byTemplate[id]).toBeDefined();
  });

  it('produces structurally valid tasks with default weight 1', () => {
    for (const t of tasks) {
      expect(() => validateTaskShape(t)).not.toThrow();
      expect(t.weight).toBe(1);
      expect(t.sightedPath.length).toBeGreaterThan(0);
      expect(t.meta.source).toBe('generic-tasks');
    }
  });

  it('writes descriptions in plain user language without selectors', () => {
    for (const t of tasks) {
      expect(t.description).toMatch(/[a-z]{3,}/i);
      expect(t.description).not.toMatch(/[#.][a-z][\w-]*\b(?![\s,.])/);
      expect(t.description.toLowerCase()).not.toMatch(
        /selector|css|button element|<[a-z]+>|queryselector|data-testid|nth-of-type/
      );
    }
  });

  it('derives sensible oracles per template', () => {
    expect(byTemplate['cookie-banner-dismiss'].oracle.type).toBe('not');
    expect(byTemplate['main-navigation'].oracle).toMatchObject({ type: 'urlMatches' });
    expect(byTemplate['site-search'].oracle.type).toBe('any');
    expect(byTemplate['contact-page'].oracle.type).toBe('any');
    expect(byTemplate.login.oracle.type).toBe('any');
    expect(byTemplate['simple-form'].oracle.type).toBe('any');
  });

  it('picks the contact form, not the search form, for simple-form', () => {
    const form = byTemplate['simple-form'];
    const typed = form.sightedPath.filter((s) => s.action === 'type');
    expect(typed.length).toBe(3); // name, e-mail, message
    expect(form.sightedPath[form.sightedPath.length - 1].action).toBe('click');
    expect(form.sightedPath.some((s) => s.selector === '#q')).toBe(false);
  });

  it('does not pick the current page as the main-navigation target', () => {
    expect(byTemplate['main-navigation'].oracle.pattern).not.toMatch(/generic-home/);
  });

  it('every instantiated task validates against the live mini-site', async () => {
    for (const task of tasks) {
      const res = await validateTask(getBrowser(), `${getBaseUrl()}${HOME}`, task, { repeats: 2 });
      expect(res.reasons, `task ${task.id}: ${res.reasons.join('; ')}`).toEqual([]);
      expect(res.valid).toBe(true);
      expect(res.nSighted).toBe(task.sightedPath.length);
    }
  }, 180000);

  it('only: restricts the templates that are instantiated', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const only = await instantiateGenericTasks(page, { only: ['contact-page'] });
      expect(only.map((t) => t.template)).toEqual(['contact-page']);
    } finally {
      await page.close();
    }
  });

  it('returns only applicable templates on a bare page', async () => {
    const page = await getPage(`${getBaseUrl()}/agent/generic-products.html`);
    try {
      const bare = await instantiateGenericTasks(page);
      const templates = bare.map((t) => t.template);
      expect(templates).not.toContain('cookie-banner-dismiss');
      expect(templates).not.toContain('site-search');
      expect(templates).not.toContain('simple-form');
      expect(templates).not.toContain('login');
    } finally {
      await page.close();
    }
  });

  it('skips tasks whose oracle already holds (login page has a visible password field)', async () => {
    const page = await getPage(`${getBaseUrl()}/agent/generic-login.html`);
    try {
      const onLogin = await instantiateGenericTasks(page);
      expect(onLogin.map((t) => t.template)).not.toContain('login');
    } finally {
      await page.close();
    }
  });

  it('collectCandidates exposes the raw DOM anchors', async () => {
    const page = await getPage(`${getBaseUrl()}${HOME}`);
    try {
      const c = await collectCandidates(page, WORDS);
      expect(c.cookie.button).toBe('#cookie-accept');
      expect(c.cookie.container).toBe('#cookie-banner');
      expect(c.search.name).toBe('q');
      expect(c.login.selector).toBe('#login-link');
      expect(c.contact.href).toContain('generic-contact.html');
      expect(c.form.method).toBe('POST');
    } finally {
      await page.close();
    }
  });

  it('pathPattern keeps path + query, escapes regex characters and tolerates the trailing slash', () => {
    const p = pathPattern('http://127.0.0.1:8080/a/b.html?q=1');
    expect(new RegExp(p, 'i').test('http://127.0.0.1:8080/a/b.html?q=1')).toBe(true);
    expect(new RegExp(p, 'i').test('http://127.0.0.1:8080/a/bxhtml?q=1')).toBe(false);
    const slash = new RegExp(pathPattern('http://localhost:8804/leistungen/'), 'i');
    expect(slash.test('http://localhost:8804/leistungen')).toBe(true);
    expect(slash.test('http://localhost:8804/leistungen/')).toBe(true);
    expect(slash.test('http://localhost:8804/leistungen/#top')).toBe(true);
    expect(slash.test('http://localhost:8804/leistungen-alt/')).toBe(false);
    expect(slash.test('http://localhost:8804/leistungen/detail')).toBe(false);
    const root = new RegExp(pathPattern('http://localhost:8804/'), 'i');
    expect(root.test('http://localhost:8804/')).toBe(true);
    expect(root.test('http://localhost:8804')).toBe(true);
    expect(root.test('http://localhost:8804/leistungen')).toBe(false);
    expect(pathPattern('not a url')).toBe('not a url');
  });
});
