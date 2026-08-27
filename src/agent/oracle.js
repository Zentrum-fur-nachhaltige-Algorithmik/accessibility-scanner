/**
 * Deterministic task oracles for the SR agent.
 * An oracle is a JSON-serialisable predicate spec evaluated against a Puppeteer
 * page to decide whether a task was completed. No LLM is involved.
 */

'use strict';

const PREDICATE_TYPES = [
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
  'not',
];

/** Escape a literal string so it can safely be used inside a pattern field. */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a pattern string into a case-insensitive RegExp.
 * Every `*pattern*` field (`pattern`, `text`, `urlPattern`, `valuePattern`,
 * `namePattern`) is a string used as a regular expression with the `i` flag, so
 * plain substrings work as-is and anchors or alternation can be written directly.
 * Literal regex characters must be escaped by the caller (see `escapeRegExp`).
 */
function toRegExp(pattern, field) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error(`Oracle: "${field}" must be a non-empty pattern string`);
  }
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    throw new Error(`Oracle: "${field}" is not a valid regular expression: ${pattern}`);
  }
}

/**
 * Validate an oracle spec recursively. Throws on unknown types or missing
 * required fields. Returns the spec for convenience.
 * Spec types:
 *   { type: 'urlMatches',      pattern }
 *   { type: 'elementWithText', text, selector? }      // selector defaults to 'body'
 *   { type: 'elementVisible',  selector, negate? }
 *   { type: 'formValue',       selector, value }        // `value` is a pattern
 *   { type: 'requestSent',     urlPattern, method? }    // needs a request recorder in ctx
 *   { type: 'storageKey',      kind: 'cookie'|'local'|'session', key, valuePattern? }
 *   { type: 'titleMatches',    pattern }
 *   { type: 'focusInDialog',   namePattern? }
 *   { type: 'all' | 'any',     of: [...] }
 *   { type: 'not', of: [spec] } | { type: 'not', spec }
 */
function validateSpec(spec, path = 'oracle') {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`Oracle: ${path} must be an object`);
  }
  const { type } = spec;
  if (!PREDICATE_TYPES.includes(type)) {
    throw new Error(
      `Oracle: unknown predicate type "${type}" at ${path}. Known types: ${PREDICATE_TYPES.join(', ')}`
    );
  }

  const requireString = (field) => {
    if (typeof spec[field] !== 'string' || spec[field].length === 0) {
      throw new Error(`Oracle: ${path}.${field} is required (non-empty string) for type "${type}"`);
    }
  };

  switch (type) {
    case 'urlMatches':
    case 'titleMatches':
      requireString('pattern');
      toRegExp(spec.pattern, `${path}.pattern`);
      break;
    case 'elementWithText':
      requireString('text');
      toRegExp(spec.text, `${path}.text`);
      if (spec.selector !== undefined && typeof spec.selector !== 'string') {
        throw new Error(`Oracle: ${path}.selector must be a string`);
      }
      break;
    case 'elementVisible':
      requireString('selector');
      break;
    case 'formValue':
      requireString('selector');
      requireString('value');
      toRegExp(spec.value, `${path}.value`);
      break;
    case 'requestSent':
      requireString('urlPattern');
      toRegExp(spec.urlPattern, `${path}.urlPattern`);
      if (spec.method !== undefined && typeof spec.method !== 'string') {
        throw new Error(`Oracle: ${path}.method must be a string`);
      }
      break;
    case 'storageKey':
      if (!['cookie', 'local', 'session'].includes(spec.kind)) {
        throw new Error(`Oracle: ${path}.kind must be one of cookie|local|session`);
      }
      requireString('key');
      if (spec.valuePattern !== undefined) toRegExp(spec.valuePattern, `${path}.valuePattern`);
      break;
    case 'focusInDialog':
      if (spec.namePattern !== undefined) toRegExp(spec.namePattern, `${path}.namePattern`);
      break;
    case 'all':
    case 'any': {
      if (!Array.isArray(spec.of) || spec.of.length === 0) {
        throw new Error(`Oracle: ${path}.of must be a non-empty array for type "${type}"`);
      }
      spec.of.forEach((sub, i) => validateSpec(sub, `${path}.of[${i}]`));
      break;
    }
    case 'not': {
      const inner = Array.isArray(spec.of) ? spec.of[0] : spec.spec;
      if (!inner) throw new Error(`Oracle: ${path}.of[0] (or .spec) is required for type "not"`);
      validateSpec(inner, `${path}.of[0]`);
      break;
    }
    default:
      /* istanbul ignore next */
      break;
  }
  return spec;
}

// Request recorder

/**
 * Record every request the page issues from now on.
 * Returns `{ requests, stop(), reset() }`; pass it to `evaluate` via
 * `ctx.recorder` (or pass the array directly as `ctx.requests`).
 * Each entry: `{ method, url, resourceType, timestamp }`.
 */
function createRequestRecorder(page) {
  const requests = [];
  const onRequest = (req) => {
    try {
      requests.push({
        method: req.method(),
        url: req.url(),
        resourceType: typeof req.resourceType === 'function' ? req.resourceType() : undefined,
        timestamp: Date.now(),
      });
    } catch (_) {
      /* request objects can be detached after navigation */
    }
  };
  page.on('request', onRequest);
  return {
    requests,
    stop() {
      page.off('request', onRequest);
    },
    reset() {
      requests.length = 0;
    },
  };
}

function ctxRequests(ctx) {
  if (!ctx) return null;
  if (Array.isArray(ctx.requests)) return ctx.requests;
  if (ctx.recorder && Array.isArray(ctx.recorder.requests)) return ctx.recorder.requests;
  return null;
}

// Evaluation

async function evalUrlMatches(spec, page) {
  return toRegExp(spec.pattern, 'pattern').test(page.url());
}

async function evalTitleMatches(spec, page) {
  return toRegExp(spec.pattern, 'pattern').test(await page.title());
}

async function evalElementWithText(spec, page) {
  const selector = spec.selector || 'body';
  const texts = await page.evaluate((sel) => {
    // Visibility check is inlined so no eval/new Function is needed (strict CSP pages).
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (parseFloat(style.opacity || '1') === 0) return false;
      if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const out = [];
    let nodes;
    try {
      nodes = Array.from(document.querySelectorAll(sel));
    } catch (e) {
      return null; // invalid selector
    }
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      out.push(el.innerText || el.textContent || '');
    }
    return out;
  }, selector);
  if (texts === null) throw new Error(`Oracle: invalid selector "${selector}"`);
  const re = toRegExp(spec.text, 'text');
  return texts.some((t) => re.test(t));
}

async function evalElementVisible(spec, page) {
  const visible = await page.evaluate((sel) => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (parseFloat(style.opacity || '1') === 0) return false;
      if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    let nodes;
    try {
      nodes = Array.from(document.querySelectorAll(sel));
    } catch (e) {
      return null;
    }
    return nodes.some(isVisible);
  }, spec.selector);
  if (visible === null) throw new Error(`Oracle: invalid selector "${spec.selector}"`);
  return spec.negate ? !visible : Boolean(visible);
}

async function evalFormValue(spec, page) {
  const values = await page.evaluate((sel) => {
    let nodes;
    try {
      nodes = Array.from(document.querySelectorAll(sel));
    } catch (e) {
      return null;
    }
    return nodes.map((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'true' : 'false';
      if (typeof el.value === 'string') return el.value;
      return el.textContent || '';
    });
  }, spec.selector);
  if (values === null) throw new Error(`Oracle: invalid selector "${spec.selector}"`);
  const re = toRegExp(spec.value, 'value');
  return values.some((v) => re.test(v));
}

async function evalRequestSent(spec, page, ctx) {
  const requests = ctxRequests(ctx);
  if (!requests) {
    throw new Error(
      'Oracle: predicate "requestSent" requires a request recorder: pass ctx.recorder (createRequestRecorder(page)) or ctx.requests'
    );
  }
  const re = toRegExp(spec.urlPattern, 'urlPattern');
  const method = spec.method ? String(spec.method).toUpperCase() : null;
  return requests.some(
    (r) => re.test(r.url) && (!method || String(r.method).toUpperCase() === method)
  );
}

async function evalStorageKey(spec, page) {
  const valueRe = spec.valuePattern ? toRegExp(spec.valuePattern, 'valuePattern') : null;

  if (spec.kind === 'cookie') {
    // Puppeteer 22: page.cookies() is available; fall back to document.cookie.
    let cookies = [];
    try {
      cookies = await page.cookies();
    } catch (_) {
      const raw = await page.evaluate(() => document.cookie);
      cookies = String(raw)
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const i = p.indexOf('=');
          return { name: i === -1 ? p : p.slice(0, i), value: i === -1 ? '' : p.slice(i + 1) };
        });
    }
    const hit = cookies.filter((c) => c.name === spec.key);
    if (hit.length === 0) return false;
    return valueRe ? hit.some((c) => valueRe.test(c.value)) : true;
  }

  const value = await page.evaluate(
    (kind, key) => {
      try {
        const store = kind === 'local' ? window.localStorage : window.sessionStorage;
        return store.getItem(key);
      } catch (e) {
        return null;
      }
    },
    spec.kind,
    spec.key
  );
  if (value === null) return false;
  return valueRe ? valueRe.test(value) : true;
}

async function evalFocusInDialog(spec, page) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const dialog = el.closest('[role="dialog"], [role="alertdialog"], dialog');
    if (!dialog) return null;
    // Accessible name of the dialog (label > labelledby > title > heading inside).
    let name = dialog.getAttribute('aria-label') || '';
    if (!name) {
      const ids = (dialog.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      name = ids
        .map((id) => {
          const n = document.getElementById(id);
          return n ? n.textContent || '' : '';
        })
        .join(' ')
        .trim();
    }
    if (!name) name = dialog.getAttribute('title') || '';
    if (!name) {
      const h = dialog.querySelector('h1, h2, h3, h4, h5, h6');
      if (h) name = h.textContent || '';
    }
    return { name: name.trim() };
  });
  if (!info) return false;
  if (!spec.namePattern) return true;
  return toRegExp(spec.namePattern, 'namePattern').test(info.name);
}

/**
 * Evaluate an oracle spec against a page.
 * @param {object} spec - oracle spec (see `validateSpec`)
 * @param {import('puppeteer').Page} page
 * @param {object} [ctx] - `{ recorder }` or `{ requests }` for `requestSent`
 * @returns {Promise<boolean>}
 */
async function evaluate(spec, page, ctx = {}) {
  validateSpec(spec);
  switch (spec.type) {
    case 'urlMatches':
      return evalUrlMatches(spec, page);
    case 'titleMatches':
      return evalTitleMatches(spec, page);
    case 'elementWithText':
      return evalElementWithText(spec, page);
    case 'elementVisible':
      return evalElementVisible(spec, page);
    case 'formValue':
      return evalFormValue(spec, page);
    case 'requestSent':
      return evalRequestSent(spec, page, ctx);
    case 'storageKey':
      return evalStorageKey(spec, page);
    case 'focusInDialog':
      return evalFocusInDialog(spec, page);
    case 'all': {
      for (const sub of spec.of) {
        if (!(await evaluate(sub, page, ctx))) return false;
      }
      return true;
    }
    case 'any': {
      for (const sub of spec.of) {
        if (await evaluate(sub, page, ctx)) return true;
      }
      return false;
    }
    case 'not': {
      const inner = Array.isArray(spec.of) ? spec.of[0] : spec.spec;
      return !(await evaluate(inner, page, ctx));
    }
    default:
      /* istanbul ignore next */
      throw new Error(`Oracle: unknown predicate type "${spec.type}"`);
  }
}

module.exports = {
  PREDICATE_TYPES,
  validateSpec,
  evaluate,
  createRequestRecorder,
  escapeRegExp,
};
