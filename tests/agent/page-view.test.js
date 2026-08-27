import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const {
  extractPageView,
  renderPageView,
  renderElement,
  elementById,
  toMessageContent,
} = require('../../src/agent/page-view');
const { ensureHelpers } = require('../../src/agent/dom-helpers');

const HOME = '/agent/generic-home.html';
const CONTACT = '/agent/generic-contact.html';

let baseUrl;

beforeAll(async () => {
  baseUrl = await startFixtureServer();
  await launchBrowser();
}, 120000);

afterAll(async () => {
  await closeBrowser();
  await stopFixtureServer();
});

describe('agent/page-view — extraction', () => {
  let page;
  let view;

  beforeAll(async () => {
    page = await getPage(`${baseUrl}${HOME}`);
    view = await extractPageView(page);
  }, 60000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
  });

  it('reports url and title', () => {
    expect(view.url).toContain(HOME);
    expect(view.title).toBe('Mini Site — Home');
  });

  it('lists landmarks and headings with their level', () => {
    const roles = view.landmarks.map((l) => l.role);
    expect(roles).toContain('banner');
    expect(roles).toContain('main');
    expect(view.headings).toContainEqual({ level: 1, text: 'Welcome to the Mini Site' });
    expect(view.headings).toContainEqual({ level: 2, text: 'Send us a message' });
  });

  it('numbers the interactive elements from 1 upwards and keeps them dense', () => {
    expect(view.elements.length).toBeGreaterThan(5);
    expect(view.elements.map((e) => e.id)).toEqual(view.elements.map((_, i) => i + 1));
  });

  it('describes controls with role, accessible name and href', () => {
    const login = view.elements.find((e) => e.name === 'Log in');
    expect(login).toBeTruthy();
    expect(login.role).toBe('link');
    expect(login.href).toContain('generic-login.html');

    const search = view.elements.find((e) => e.type === 'search');
    expect(search.name).toBe('Search the site'); // from its <label for>
    expect(search.inForm).toBe(true);
  });

  it('marks submit buttons together with their form method', () => {
    const send = view.elements.find((e) => e.name === 'Send message');
    expect(send.isSubmit).toBe(true);
    expect(send.formMethod).toBe('POST');

    const searchSubmit = view.elements.find((e) => e.name === 'Search');
    expect(searchSubmit.isSubmit).toBe(true);
    expect(searchSubmit.formMethod).toBe('GET');
  });

  it('annotates the enclosing landmark as region', () => {
    const navLink = view.elements.find((e) => e.name === 'Products');
    expect(navLink.region).toMatch(/navigation/);
  });

  it('summarises the visible main text and reports truncation flags', () => {
    expect(view.text).toContain('We build small things');
    expect(view.truncated).toEqual({ elements: 0, text: false });
  });

  it('caps the number of elements and records how many were left out', async () => {
    const small = await extractPageView(page, { maxElements: 3 });
    expect(small.elements).toHaveLength(3);
    expect(small.truncated.elements).toBeGreaterThan(0);
  });

  it('caps the text summary', async () => {
    const small = await extractPageView(page, { maxTextChars: 20 });
    expect(small.text.length).toBeLessThanOrEqual(21); // + the ellipsis
    expect(small.truncated.text).toBe(true);
  });

  it('keeps no screenshot by default and attaches a JPEG on request', async () => {
    expect(view.screenshot).toBeUndefined();
    const shot = await extractPageView(page, { screenshot: true, maxElements: 5 });
    expect(shot.screenshot.mimeType).toBe('image/jpeg');
    expect(shot.screenshot.dataBase64.length).toBeGreaterThan(100);
  });
});

describe('agent/page-view — selector stability', () => {
  let page;

  beforeAll(async () => {
    page = await getPage(`${baseUrl}${HOME}`);
  }, 60000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
  });

  it('produces a selector for every listed element', async () => {
    const view = await extractPageView(page);
    for (const el of view.elements) expect(typeof el.selector).toBe('string');
  });

  it('every selector really resolves to exactly the element it describes', async () => {
    const view = await extractPageView(page);
    for (const el of view.elements) {
      const found = await page.$$eval(
        el.selector,
        (nodes) => nodes.length
        /* no args */
      );
      expect(found, `selector ${el.selector}`).toBeGreaterThan(0);
    }
  });

  it('yields the same selectors on a fresh load of the same page', async () => {
    const first = await extractPageView(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const second = await extractPageView(page);
    expect(second.elements.map((e) => e.selector)).toEqual(first.elements.map((e) => e.selector));
  });

  it('prefers ids and falls back to an nth-of-type path', async () => {
    const view = await extractPageView(page);
    const byId = view.elements.find((e) => e.selector === '#login-link');
    expect(byId).toBeTruthy();
    const nav = view.elements.find((e) => e.name === 'Products');
    expect(nav.selector).toMatch(/nth-of-type|#/);
  });

  it('uses data-testid when there is no id', async () => {
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.setAttribute('data-testid', 'tid-only');
      b.textContent = 'Tagged';
      document.body.appendChild(b);
    });
    const view = await extractPageView(page);
    const tagged = view.elements.find((e) => e.name === 'Tagged');
    expect(tagged.selector).toBe('[data-testid="tid-only"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  it('survives a navigation (helpers are re-installed automatically)', async () => {
    await page.goto(`${baseUrl}${CONTACT}`, { waitUntil: 'domcontentloaded' });
    const view = await extractPageView(page);
    expect(view.title).toContain('Contact');
    expect(view.headings[0].text).toBe('Contact');
  });

  it('ignores auto-generated ids and falls back to a structural path', async () => {
    await page.goto(`${baseUrl}${HOME}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'search-main-0a5acb20'; // gov.uk style: regenerated on every render
      b.textContent = 'Volatile';
      document.body.appendChild(b);
    });
    const view = await extractPageView(page);
    const volatile = view.elements.find((e) => e.name === 'Volatile');
    expect(volatile.selector).not.toContain('0a5acb20');
    expect(volatile.selector).toMatch(/nth-of-type|^body|button/);

    const generated = await page.evaluate(() =>
      ['search-main-0a5acb20', ':r3:', 'ember1234', 'field-123456', 'react-42'].map(
        window.__A11YH.isGeneratedId
      )
    );
    expect(generated).toEqual([true, true, true, true, true]);
    const stable = await page.evaluate(() =>
      ['cookie-accept', 'q', 'main-content', 'nav-2'].map(window.__A11YH.isGeneratedId)
    );
    expect(stable).toEqual([false, false, false, false]);
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  it('ensureHelpers is idempotent', async () => {
    await ensureHelpers(page);
    await ensureHelpers(page);
    const version = await page.evaluate(() => window.__A11YH.version);
    expect(version).toBe(1);
  });
});

describe('agent/page-view — rendering', () => {
  const view = {
    url: 'http://example.test/x',
    title: 'Example',
    landmarks: [
      { role: 'navigation', label: 'Main' },
      { role: 'main', label: '' },
    ],
    headings: [
      { level: 1, text: 'Hello' },
      { level: 2, text: 'Sub' },
    ],
    elements: [
      {
        id: 1,
        tag: 'a',
        role: 'link',
        name: 'Contact',
        href: 'http://example.test/contact',
        selector: '#c',
        region: 'navigation "Main"',
      },
      {
        id: 2,
        tag: 'input',
        role: 'searchbox',
        name: 'Search',
        type: 'search',
        value: 'abc',
        selector: '#q',
      },
      {
        id: 3,
        tag: 'button',
        role: 'button',
        name: '',
        isSubmit: true,
        formMethod: 'POST',
        selector: '#s',
      },
    ],
    text: 'Some visible copy.',
    truncated: { elements: 2, text: false },
  };

  it('renders url, title, landmarks, headings, elements and text', () => {
    const out = renderPageView(view);
    expect(out).toContain('URL: http://example.test/x');
    expect(out).toContain('TITLE: Example');
    expect(out).toContain('navigation "Main"');
    expect(out).toContain('h1 Hello');
    expect(out).toContain('[1] link "Contact"');
    expect(out).toContain('VISIBLE TEXT');
    expect(out).toContain('Some visible copy.');
  });

  it('NEVER leaks the css selector into the prompt', () => {
    const out = renderPageView(view);
    expect(out).not.toContain('#c');
    expect(out).not.toContain('#q');
    expect(out).not.toContain('#s');
  });

  it('marks unnamed controls and submit buttons, and reports truncation', () => {
    const out = renderPageView(view);
    expect(out).toContain('(no accessible name)');
    expect(out).toContain('submit(POST)');
    expect(out).toContain('2 further elements not listed');
  });

  it('renders values and shortened hrefs', () => {
    expect(renderElement(view.elements[1])).toContain('value="abc"');
    expect(renderElement(view.elements[0])).toContain('href=/contact');
  });

  it('can omit the text block', () => {
    expect(renderPageView(view, { includeText: false })).not.toContain('VISIBLE TEXT');
  });

  it('handles an empty view', () => {
    expect(renderPageView(null)).toBe('(no page)');
    expect(renderPageView({ url: 'u', title: '', elements: [] })).toContain(
      'INTERACTIVE ELEMENTS: none'
    );
  });

  it('elementById looks elements up by their number', () => {
    expect(elementById(view, 2).selector).toBe('#q');
    expect(elementById(view, 99)).toBeNull();
    expect(elementById(null, 1)).toBeNull();
  });
});

describe('agent/page-view — message content', () => {
  it('stays a plain string without a screenshot', () => {
    expect(toMessageContent({ url: 'u' }, 'hello')).toBe('hello');
  });

  it('becomes text + image parts with a screenshot', () => {
    const parts = toMessageContent(
      { screenshot: { mimeType: 'image/jpeg', dataBase64: 'QUJD' } },
      'hello'
    );
    expect(parts[0]).toEqual({ type: 'text', text: 'hello' });
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url.url).toBe('data:image/jpeg;base64,QUJD');
  });
});
