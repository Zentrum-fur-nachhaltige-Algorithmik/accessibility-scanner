/**
 * src/agent/page-view.js — the SIGHTED observation.
 *
 * The counterpart to `screenreader-env.js`: where the SR agent hears one element
 * at a time, the sighted agent sees the whole page at once — the way a sighted
 * user does. `extractPageView(page)` produces a compact, token-bounded snapshot:
 * landmarks, headings, a numbered list of interactive elements and a short
 * summary of the visible main text.
 *
 * Two rules make this safe to hand to an LLM:
 *
 *  1. **Numbers, not selectors.** Every interactive element gets a small integer
 *     id. The CSS selector that actually drives Puppeteer stays server-side in
 *     `view.elements[i].selector` and is never rendered into the prompt, so the
 *     model cannot invent one and the task descriptions it later writes cannot
 *     leak implementation details (`task.js` rejects those).
 *  2. **One selector algorithm.** Selectors come from `dom-helpers.js`, the same
 *     code `generic-tasks.js` uses, so anything observed here can be replayed by
 *     `replay.executeStep` verbatim.
 *
 * DOM-first: the default path uses no screenshot at all, so the generator works
 * from the same structural information the rest of the pipeline uses (and stays
 * cheap). `{ screenshot: true }` additionally attaches a base64 JPEG of the
 * viewport, which `sighted-agent.js` sends as an image content part in `--vision`
 * mode. The screenshot is an ADDITION to the text view, never a replacement.
 */

'use strict';

const { ensureHelpers } = require('./dom-helpers');

const DEFAULTS = {
  maxElements: 60,
  maxTextChars: 1200,
  maxHeadings: 30,
  maxLandmarks: 15,
  maxNameChars: 80,
  screenshot: false,
  screenshotQuality: 60,
};

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="switch"]',
  '[role="searchbox"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Extract the sighted page view.
 *
 * @param {import('puppeteer').Page} page  already navigated
 * @param {object} [options]
 * @param {number} [options.maxElements=60]  cap on listed interactive elements
 * @param {number} [options.maxTextChars=1200] cap on the main-content text summary
 * @param {boolean} [options.screenshot=false] also attach a base64 JPEG of the viewport
 * @returns {Promise<PageView>}
 *
 * PageView = {
 *   url, title,
 *   landmarks: [{ role, label }],
 *   headings:  [{ level, text }],
 *   elements:  [{ id, role, name, tag, href?, type?, value?, visible, region?,
 *                 selector, isSubmit, formMethod?, inForm }],
 *   text: string,          // visible main-content summary
 *   truncated: { elements: number, text: boolean },
 *   screenshot?: { mimeType: 'image/jpeg', dataBase64: string }   // only with { screenshot: true }
 * }
 */
async function extractPageView(page, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  await ensureHelpers(page);

  const view = await page.evaluate(
    (cfg, interactiveSelector) => {
      const H = window.__A11YH;
      const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

      /* --- landmarks ------------------------------------------------- */
      const LM =
        'header,footer,nav,main,aside,form,section[aria-label],section[aria-labelledby],' +
        '[role=banner],[role=contentinfo],[role=navigation],[role=main],' +
        '[role=complementary],[role=search],[role=form],[role=region]';
      const landmarks = Array.from(document.querySelectorAll(LM))
        .filter(H.isVisible)
        .slice(0, cfg.maxLandmarks)
        .map((el) => ({ role: H.roleOf(el), label: clip(H.accName(el), cfg.maxNameChars) }));

      /* --- headings --------------------------------------------------- */
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
        .filter(H.isVisible)
        .slice(0, cfg.maxHeadings)
        .map((el) => {
          const lvl = /^h[1-6]$/i.test(el.tagName)
            ? Number(el.tagName[1])
            : Number(el.getAttribute('aria-level')) || 2;
          return { level: lvl, text: clip(H.text(el), cfg.maxNameChars) };
        })
        .filter((h) => h.text);

      /* --- interactive elements --------------------------------------- */
      const seen = new Set();
      const all = Array.from(document.querySelectorAll(interactiveSelector)).filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        if (el.disabled) return false;
        return H.isVisible(el);
      });
      const truncatedElements = Math.max(0, all.length - cfg.maxElements);
      const elements = [];
      all.slice(0, cfg.maxElements).forEach((el, i) => {
        const tag = el.tagName.toLowerCase();
        const form = el.form || (el.closest ? el.closest('form') : null);
        const type = (el.getAttribute('type') || '').toLowerCase();
        const isSubmit =
          (tag === 'button' && (!type || type === 'submit') && !!form) ||
          (tag === 'input' && (type === 'submit' || type === 'image'));
        const entry = {
          id: i + 1,
          tag,
          role: H.roleOf(el),
          name: clip(H.accName(el), cfg.maxNameChars),
          selector: H.selectorFor(el),
          visible: true,
          inForm: !!form,
          isSubmit,
        };
        if (form) entry.formMethod = (form.getAttribute('method') || 'get').toUpperCase();
        if (tag === 'a' && el.getAttribute('href')) entry.href = el.href;
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          entry.type = type || (tag === 'input' ? 'text' : tag);
          if (typeof el.value === 'string' && el.value) {
            entry.value = clip(el.value, cfg.maxNameChars);
          }
        }
        const region = H.regionOf(el);
        if (region) entry.region = region;
        if (entry.selector) elements.push(entry);
      });

      /* --- main content text ------------------------------------------- */
      const mainEl =
        document.querySelector('main, [role="main"]') || document.body || document.documentElement;
      const raw = H.text(mainEl);

      return {
        url: location.href,
        title: document.title,
        landmarks,
        headings,
        elements,
        text: clip(raw, cfg.maxTextChars),
        truncated: { elements: truncatedElements, text: raw.length > cfg.maxTextChars },
      };
    },
    opts,
    INTERACTIVE_SELECTOR
  );

  if (opts.screenshot) {
    try {
      const data = await page.screenshot({
        type: 'jpeg',
        quality: opts.screenshotQuality,
        encoding: 'base64',
        fullPage: false,
      });
      view.screenshot = { mimeType: 'image/jpeg', dataBase64: data };
    } catch (_) {
      // A screenshot is a bonus; never fail the observation because of it.
    }
  }

  return view;
}

/**
 * Render a PageView as plain text for the model. NEVER emits selectors — the
 * model addresses elements by their numeric id only.
 *
 * @param {PageView} view
 * @param {object} [options]
 * @param {boolean} [options.includeText=true]
 * @returns {string}
 */
function renderPageView(view, options = {}) {
  const { includeText = true } = options;
  if (!view) return '(no page)';
  const lines = [];
  lines.push(`URL: ${view.url}`);
  lines.push(`TITLE: ${view.title || '(no title)'}`);

  if (view.landmarks && view.landmarks.length) {
    lines.push(
      `LANDMARKS: ${view.landmarks
        .map((l) => (l.label ? `${l.role} "${l.label}"` : l.role))
        .join(', ')}`
    );
  }

  if (view.headings && view.headings.length) {
    lines.push('HEADINGS:');
    for (const h of view.headings) lines.push(`  ${'  '.repeat(h.level - 1)}h${h.level} ${h.text}`);
  }

  if (view.elements && view.elements.length) {
    lines.push(`INTERACTIVE ELEMENTS (${view.elements.length}):`);
    for (const el of view.elements) lines.push(`  ${renderElement(el)}`);
    if (view.truncated && view.truncated.elements > 0) {
      lines.push(`  … ${view.truncated.elements} further elements not listed.`);
    }
  } else {
    lines.push('INTERACTIVE ELEMENTS: none');
  }

  if (includeText && view.text) {
    lines.push('VISIBLE TEXT (main content, shortened):');
    lines.push(view.text);
  }

  return lines.join('\n');
}

/** One `[id] role "name"` line. Selectors are never part of this. */
function renderElement(el) {
  const parts = [`[${el.id}]`, el.role || el.tag];
  parts.push(el.name ? JSON.stringify(el.name) : '(no accessible name)');
  if (el.type && el.type !== el.role) parts.push(`type=${el.type}`);
  if (el.value) parts.push(`value=${JSON.stringify(el.value)}`);
  if (el.href) parts.push(`href=${shortenHref(el.href)}`);
  if (el.isSubmit) parts.push(`submit(${el.formMethod || 'GET'})`);
  if (el.region) parts.push(`in ${el.region}`);
  return parts.join(' ');
}

function shortenHref(href) {
  try {
    const u = new URL(href);
    return `${u.pathname}${u.search}`.slice(0, 100) || '/';
  } catch (_) {
    return String(href).slice(0, 100);
  }
}

/** Look up an element of a view by the numeric id the model used. */
function elementById(view, id) {
  if (!view || !Array.isArray(view.elements)) return null;
  const n = Number(id);
  return view.elements.find((e) => e.id === n) || null;
}

/**
 * Build the `content` array for a chat message from a rendered view: the text
 * observation plus, when the view carries one, the screenshot as an image part
 * (OpenAI-compatible `image_url` with a data: URI, which OpenRouter accepts).
 * Without a screenshot the caller should just use the plain string.
 */
function toMessageContent(view, text) {
  if (!view || !view.screenshot || !view.screenshot.dataBase64) return text;
  return [
    { type: 'text', text },
    {
      type: 'image_url',
      image_url: {
        url: `data:${view.screenshot.mimeType};base64,${view.screenshot.dataBase64}`,
      },
    },
  ];
}

module.exports = {
  DEFAULTS,
  toMessageContent,
  INTERACTIVE_SELECTOR,
  extractPageView,
  renderPageView,
  renderElement,
  elementById,
};
