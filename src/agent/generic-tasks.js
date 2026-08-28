/**
 * Site-agnostic task templates.
 * `instantiateGenericTasks(page)` inspects an already-navigated page and returns
 * a Task[] for every applicable template. Heuristics are simple and text-driven
 * (English and German wording); `validateTask()` catches bad guesses afterwards.
 * Descriptions and keywords are emitted in the language of the page (see
 * `TEXTS`), because both agents match the task's words against what the page
 * says.
 */

'use strict';

const { escapeRegExp, evaluate } = require('./oracle');
const { ensureHelpers } = require('./dom-helpers');
const { normaliseLanguage, DEFAULT_LANGUAGE } = require('./page-language');

// Wording heuristics (shared with the in-page collector as strings)

const WORDS = {
  cookieContainer: 'cookie|consent|gdpr|dsgvo|datenschutz-?banner|cmp',
  cookieAccept:
    'accept|allow|agree|ok\\b|got it|akzeptieren|zustimmen|einverstanden|verstanden|erlauben',
  contact: 'contact|kontakt',
  login: 'log ?in|sign ?in|anmelden|einloggen|login',
  search: 'search|suche|suchen|query',
};

/**
 * Collect DOM candidates for all templates in one page evaluation.
 * Returns plain JSON so all task building happens in Node.
 */
async function collectCandidates(page, words) {
  await ensureHelpers(page);
  return page.evaluate((W) => {
    const rx = (s) => new RegExp(s, 'i');
    // Shared implementation of selector/visibility/text/name, see dom-helpers.js.
    const { isVisible, text, selectorFor, accName } = window.__A11YH;

    const out = {};

    // cookie banner
    (() => {
      const containers = Array.from(
        document.querySelectorAll('[id],[class],[role="dialog"],[role="alertdialog"],dialog')
      ).filter((el) => {
        if (!isVisible(el)) return false;
        const hay = `${el.id} ${el.className && el.className.baseVal !== undefined ? '' : el.className} ${el.getAttribute('aria-label') || ''}`;
        return (
          rx(W.cookieContainer).test(hay) || rx(W.cookieContainer).test(text(el).slice(0, 300))
        );
      });
      // Prefer the innermost matching container that still holds an accept control.
      for (const c of containers.sort((a, b) => text(a).length - text(b).length)) {
        const btn = Array.from(
          c.querySelectorAll(
            'button, a, input[type="button"], input[type="submit"], [role="button"]'
          )
        )
          .filter(isVisible)
          .find((b) => rx(W.cookieAccept).test(accName(b)));
        if (btn) {
          out.cookie = { container: selectorFor(c), button: selectorFor(btn), label: accName(btn) };
          break;
        }
      }
    })();

    // main navigation
    (() => {
      const nav =
        document.querySelector('header nav, nav[role="navigation"], nav, [role="navigation"]') ||
        null;
      if (!nav || !isVisible(nav)) return;
      const link = Array.from(nav.querySelectorAll('a[href]'))
        .filter(isVisible)
        .find((a) => {
          const href = a.getAttribute('href') || '';
          if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href))
            return false;
          return a.href !== window.location.href && text(a).length > 0;
        });
      if (link) {
        out.nav = {
          navSelector: selectorFor(nav),
          selector: selectorFor(link),
          href: link.href,
          label: text(link),
        };
      }
    })();

    // site search
    (() => {
      const input = Array.from(
        document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')
      )
        .filter(isVisible)
        .find((el) => {
          if (el.type === 'search') return true;
          const hay = `${el.name} ${el.id} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${
            el.getAttribute('role') || ''
          }`;
          return rx(W.search).test(hay) || /^(q|s)$/i.test(el.name || '');
        });
      if (!input) return;
      const form = input.closest('form');
      const submit = form
        ? Array.from(form.querySelectorAll('button, input[type="submit"]')).filter(isVisible)[0]
        : null;
      out.search = {
        selector: selectorFor(input),
        name: input.name || '',
        method: (form && (form.getAttribute('method') || 'get')) || 'get',
        action: form ? form.action : window.location.href,
        submitSelector: submit ? selectorFor(submit) : null,
        formSelector: form ? selectorFor(form) : null,
      };
    })();

    // contact page
    (() => {
      const link = Array.from(document.querySelectorAll('a[href]'))
        .filter(isVisible)
        .find((a) => {
          const href = a.getAttribute('href') || '';
          if (!href || /^(mailto|tel|javascript):/i.test(href)) return false;
          return rx(W.contact).test(`${text(a)} ${href}`) && a.href !== window.location.href;
        });
      if (link) out.contact = { selector: selectorFor(link), href: link.href, label: text(link) };
    })();

    // login
    (() => {
      const el = Array.from(document.querySelectorAll('a[href], button, [role="button"]'))
        .filter(isVisible)
        .find((n) => rx(W.login).test(`${accName(n)} ${n.getAttribute('href') || ''}`));
      if (!el) return;
      const href = el.tagName === 'A' ? el.href : null;
      out.login = {
        selector: selectorFor(el),
        href: href && href !== window.location.href ? href : null,
        label: accName(el),
        passwordVisible: Array.from(document.querySelectorAll('input[type="password"]')).some(
          isVisible
        ),
      };
    })();

    // simple form
    (() => {
      const searchInput = out.search ? document.querySelector(out.search.selector) : null;
      const forms = Array.from(document.querySelectorAll('form')).filter(isVisible);
      for (const form of forms) {
        if (searchInput && form.contains(searchInput)) continue; // that's the search form
        const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter(
          (el) =>
            isVisible(el) &&
            !el.disabled &&
            !el.readOnly &&
            !['submit', 'button', 'reset', 'image', 'hidden', 'file'].includes(el.type)
        );
        const submit = Array.from(form.querySelectorAll('button, input[type="submit"]')).filter(
          isVisible
        )[0];
        if (fields.length === 0 || fields.length > 6 || !submit) continue;
        out.form = {
          formSelector: selectorFor(form),
          action: form.action || window.location.href,
          method: (form.getAttribute('method') || 'get').toUpperCase(),
          submitSelector: selectorFor(submit),
          fields: fields.map((el) => ({
            selector: selectorFor(el),
            tag: el.tagName.toLowerCase(),
            type: (el.type || 'text').toLowerCase(),
            name: el.name || '',
          })),
        };
        break;
      }
    })();

    return out;
  }, words);
}

/** Path + query of a URL, used to build url oracles that survive host/port changes. */
function pathPattern(href) {
  let u;
  try {
    u = new URL(href);
  } catch (_) {
    return escapeRegExp(String(href));
  }
  // Client-side routers normalise the trailing slash away (or add one), so the
  // pattern accepts both and stops at the end of the path.
  const path = u.pathname.replace(/\/+$/, '');
  if (!path) return `^[a-z]+://[^/?#]+/?${escapeRegExp(u.search)}(?:[?#]|$)`;
  return `${escapeRegExp(path)}/?${escapeRegExp(u.search)}(?:[?#]|$)`;
}

/** Plausible value for a form field, based on its type/name. */
function sampleValue(field) {
  const hay = `${field.name} ${field.type}`.toLowerCase();
  if (field.type === 'email' || /mail/.test(hay)) return 'sr.agent@example.com';
  if (field.type === 'tel' || /phone|tel/.test(hay)) return '+49 30 1234567';
  if (field.type === 'number') return '3';
  if (field.type === 'url') return 'https://example.com';
  if (field.tag === 'textarea' || /message|nachricht|comment/.test(hay)) {
    return 'This is a test message from the accessibility check.';
  }
  if (/name/.test(hay)) return 'Alex Beispiel';
  return 'Testeingabe';
}

/**
 * Template wording per language. A task on a German page has to be stated in
 * German, otherwise no word of it can ever meet a word of the page.
 * `keywords` are what a user would look for on the page while doing the task;
 * the greedy agent matches them against spoken phrases and the optimum may
 * search for them (see greedy-agent.js and optimal-path.js `findWordsFor`).
 * Languages without an entry fall back to English.
 */
const TEXTS = {
  en: {
    'cookie-banner-dismiss': {
      description: () => 'Close the cookie notice so that you can use the website.',
      keywords: () => ['cookies', 'accept', 'agree'],
    },
    'main-navigation': {
      description: (v) => `Open the page "${v.label}" from the main menu of this website.`,
      keywords: (v) => [v.label],
    },
    'site-search': {
      description: (v) => `Use the search of this website to search for "${v.term}".`,
      keywords: (v) => ['search', v.term],
    },
    'contact-page': {
      description: () => 'Find the page where you can see how to get in touch with this company.',
      keywords: () => ['contact', 'phone', 'email', 'address'],
    },
    login: {
      description: () => 'Get to the place where you can log in with your user account.',
      keywords: () => ['login', 'sign in', 'account', 'password'],
    },
    'simple-form': {
      description: () => 'Fill in the form on this page with your details and send it off.',
      keywords: () => ['form', 'name', 'message', 'send'],
    },
  },
  de: {
    'cookie-banner-dismiss': {
      description: () => 'Schließen Sie den Cookie-Hinweis, damit Sie die Website nutzen können.',
      keywords: () => ['Cookies', 'akzeptieren', 'zustimmen'],
    },
    'main-navigation': {
      description: (v) => `Öffnen Sie die Seite "${v.label}" über das Hauptmenü dieser Website.`,
      keywords: (v) => [v.label],
    },
    'site-search': {
      description: (v) => `Suchen Sie auf dieser Website nach "${v.term}".`,
      keywords: (v) => ['Suche', 'suchen', v.term],
    },
    'contact-page': {
      description: () =>
        'Finden Sie die Seite, auf der Sie sehen, wie man dieses Unternehmen erreicht.',
      keywords: () => ['Kontakt', 'Telefon', 'E-Mail', 'Adresse'],
    },
    login: {
      description: () =>
        'Gelangen Sie dorthin, wo Sie sich mit Ihrem Benutzerkonto anmelden können.',
      keywords: () => ['Anmelden', 'Login', 'Konto', 'Passwort'],
    },
    'simple-form': {
      description: () =>
        'Füllen Sie das Formular auf dieser Seite mit Ihren Daten aus und schicken Sie es ab.',
      keywords: () => ['Formular', 'Name', 'Nachricht', 'senden'],
    },
  },
};

/** The wording table of a language, falling back to English. */
function textsFor(language) {
  const code = normaliseLanguage(language) || DEFAULT_LANGUAGE;
  return TEXTS[code] || TEXTS[DEFAULT_LANGUAGE];
}

/** Description + keywords of one template, in the page language. */
function wordingFor(language, template, values = {}) {
  const entry = textsFor(language)[template] || TEXTS[DEFAULT_LANGUAGE][template];
  const keywords = (entry.keywords(values) || [])
    .map((k) => String(k == null ? '' : k).trim())
    .filter(Boolean);
  return { description: entry.description(values), ...(keywords.length ? { keywords } : {}) };
}

// Template builders: each returns a Task or null. Descriptions are plain user
// language without element names or selectors, since the SR agent sees them.

const TEMPLATES = {
  'cookie-banner-dismiss'(c, language) {
    if (!c.cookie || !c.cookie.button) return null;
    return {
      id: 'generic-cookie-banner-dismiss',
      template: 'cookie-banner-dismiss',
      ...wordingFor(language, 'cookie-banner-dismiss'),
      oracle: c.cookie.container
        ? { type: 'not', of: [{ type: 'elementVisible', selector: c.cookie.container }] }
        : { type: 'not', of: [{ type: 'elementVisible', selector: c.cookie.button }] },
      sightedPath: [{ action: 'click', selector: c.cookie.button }],
    };
  },

  'main-navigation'(c, language) {
    if (!c.nav) return null;
    return {
      id: 'generic-main-navigation',
      template: 'main-navigation',
      ...wordingFor(language, 'main-navigation', { label: c.nav.label }),
      oracle: { type: 'urlMatches', pattern: pathPattern(c.nav.href) },
      sightedPath: [{ action: 'click', selector: c.nav.selector }],
    };
  },

  'site-search'(c, language) {
    if (!c.search) return null;
    const term = 'kontakt';
    const param = c.search.name ? `[?&]${escapeRegExp(c.search.name)}=` : escapeRegExp(term);
    const path = [{ action: 'type', selector: c.search.selector, text: term }];
    if (c.search.submitSelector) {
      path.push({ action: 'click', selector: c.search.submitSelector });
    } else {
      path.push({ action: 'press', selector: c.search.selector, key: 'Enter' });
    }
    return {
      id: 'generic-site-search',
      template: 'site-search',
      ...wordingFor(language, 'site-search', { term }),
      oracle: {
        type: 'any',
        of: [
          { type: 'urlMatches', pattern: param },
          { type: 'requestSent', urlPattern: param, method: c.search.method.toUpperCase() },
        ],
      },
      sightedPath: path,
    };
  },

  'contact-page'(c, language) {
    if (!c.contact) return null;
    return {
      id: 'generic-contact-page',
      template: 'contact-page',
      ...wordingFor(language, 'contact-page'),
      oracle: {
        type: 'any',
        of: [
          { type: 'urlMatches', pattern: pathPattern(c.contact.href) },
          { type: 'titleMatches', pattern: WORDS.contact },
        ],
      },
      sightedPath: [{ action: 'click', selector: c.contact.selector }],
    };
  },

  login(c, language) {
    if (!c.login || c.login.passwordVisible) return null; // already on/at a login form
    const of = [{ type: 'elementVisible', selector: 'input[type="password"]' }];
    if (c.login.href) of.push({ type: 'urlMatches', pattern: pathPattern(c.login.href) });
    return {
      id: 'generic-login',
      template: 'login',
      ...wordingFor(language, 'login'),
      oracle: { type: 'any', of },
      sightedPath: [{ action: 'click', selector: c.login.selector }],
    };
  },

  'simple-form'(c, language) {
    if (!c.form) return null;
    const path = c.form.fields
      .filter(
        (f) =>
          f.tag === 'textarea' ||
          ['text', 'email', 'tel', 'url', 'number', 'search', 'password'].includes(f.type)
      )
      .map((f) => ({ action: 'type', selector: f.selector, text: sampleValue(f) }));
    if (path.length === 0) return null;
    path.push({ action: 'click', selector: c.form.submitSelector });
    return {
      id: 'generic-simple-form',
      template: 'simple-form',
      ...wordingFor(language, 'simple-form'),
      oracle: {
        type: 'any',
        of: [
          {
            type: 'requestSent',
            urlPattern: pathPattern(c.form.action),
            method: c.form.method === 'POST' ? 'POST' : 'GET',
          },
          { type: 'urlMatches', pattern: pathPattern(c.form.action) },
        ],
      },
      sightedPath: path,
    };
  },
};

const TEMPLATE_IDS = Object.keys(TEMPLATES);

/**
 * Instantiate all applicable generic tasks for the current page.
 * Templates: cookie-banner-dismiss, main-navigation, site-search, contact-page,
 * login, simple-form. Templates without a DOM anchor, and (by default) tasks
 * whose oracle already holds, are omitted.
 *
 * @param {import('puppeteer').Page} page - already navigated page
 * @param {object} [opts]
 * @param {string[]} [opts.only] - restrict to these template ids
 * @param {string} [opts.language] - language of the page; descriptions and
 *   keywords are emitted in it (English when it is not translated)
 * @param {boolean} [opts.skipSatisfied=true] - drop tasks whose oracle is already true
 * @returns {Promise<object[]>} Task[] (weight defaults applied)
 */
async function instantiateGenericTasks(page, opts = {}) {
  const { only = null, skipSatisfied = true, language = DEFAULT_LANGUAGE } = opts;
  const candidates = await collectCandidates(page, WORDS);

  const tasks = [];
  for (const id of TEMPLATE_IDS) {
    if (only && !only.includes(id)) continue;
    let task = null;
    try {
      task = TEMPLATES[id](candidates, language);
    } catch (_) {
      task = null; // a broken heuristic must never break the whole run
    }
    if (!task) continue;
    // Selector generation can fail (exotic DOM); drop the task rather than
    // emitting a step that can never run.
    const needsSelector = (s) => s.action === 'click' || s.action === 'type';
    if (task.sightedPath.some((s) => needsSelector(s) && !s.selector)) continue;
    task.weight = 1;
    task.meta = { ...(task.meta || {}), source: 'generic-tasks', url: page.url() };

    if (skipSatisfied) {
      // A task whose oracle already holds at state 0 is not measurable.
      // `requestSent` sub-predicates need a recorder that is absent here; an
      // empty request list treats them as not yet satisfied.
      let already = false;
      try {
        already = await evaluate(task.oracle, page, { requests: [] });
      } catch (_) {
        already = false;
      }
      if (already) continue;
    }
    tasks.push(task);
  }
  return tasks;
}

module.exports = {
  TEMPLATE_IDS,
  WORDS,
  TEXTS,
  textsFor,
  wordingFor,
  instantiateGenericTasks,
  collectCandidates,
  pathPattern,
  sampleValue,
};
