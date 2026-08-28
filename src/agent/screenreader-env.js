/**
 * ScreenReaderEnv: the screen-reader observation environment for the SR agent.
 * Wraps a navigated Puppeteer page and exposes only what a blind user gets: cursor phrase,
 * live-region announcements and rotor lists. The virtual screen reader is injected via
 * `page.evaluate` (CSP-proof) and re-injected after every main-frame navigation.
 */
const fs = require('fs');
const path = require('path');

const VSR_BUNDLE_PATH = path.join(__dirname, 'vendor', 'virtual-screen-reader.js');

let vsrBundleSource = null;
function vsrSource() {
  if (vsrBundleSource === null) {
    if (!fs.existsSync(VSR_BUNDLE_PATH)) {
      throw new Error(
        `Virtual screen reader bundle missing at ${VSR_BUNDLE_PATH}. Run \`npm run build:vsr\`.`
      );
    }
    vsrBundleSource = fs.readFileSync(VSR_BUNDLE_PATH, 'utf8');
  }
  return vsrBundleSource;
}

const ROTOR_KINDS = ['headings', 'landmarks', 'links', 'formFields', 'buttons'];

/**
 * Rotor stepping commands (NVDA quick-nav keys) -> rotor kind + direction.
 * `label` is used for the "no <label>" error of an empty rotor kind.
 */
const ROTOR_STEP_COMMANDS = {
  nextHeading: { kind: 'headings', dir: 'next', label: 'heading' },
  prevHeading: { kind: 'headings', dir: 'prev', label: 'heading' },
  nextLink: { kind: 'links', dir: 'next', label: 'link' },
  prevLink: { kind: 'links', dir: 'prev', label: 'link' },
  nextFormField: { kind: 'formFields', dir: 'next', label: 'form field' },
  prevFormField: { kind: 'formFields', dir: 'prev', label: 'form field' },
  nextLandmark: { kind: 'landmarks', dir: 'next', label: 'landmark' },
  prevLandmark: { kind: 'landmarks', dir: 'prev', label: 'landmark' },
  nextButton: { kind: 'buttons', dir: 'next', label: 'button' },
  prevButton: { kind: 'buttons', dir: 'prev', label: 'button' },
};
const ROTOR_STEP_TYPES = Object.keys(ROTOR_STEP_COMMANDS);

/** Step commands that accept a heading level (1..6) as their argument. */
const LEVELLED_STEP_COMMANDS = new Set(['nextHeading', 'prevHeading']);

/**
 * Entries one rotor page shows. A screen-reader user reads a list page by page,
 * so revealing every entry of a 200-link page for one command would hand the
 * agent an overview no blind user has.
 */
const ROTOR_PAGE_SIZE = 8; // mirror of PAGE_SIZE in the in-page runtime

/** Marks the agent may record on its own trace (free, see `mark`). */
const MARK_KINDS = ['dead_end', 'backtrack', 'confirmed'];

/** Cursor-jump commands that can land back where the cursor already was. */
const JUMP_COMMANDS = new Set(['jumpTo', 'find', 'findNext', ...ROTOR_STEP_TYPES]);

/** Stops between two visits of one element from which it counts as a backtrack. */
const BACKTRACK_MIN_GAP = 2;

/** Commands that do not cost a step. */
const FREE_COMMANDS = new Set(['repeat', 'mark']);

/**
 * Commands costing more than one step. `find` is a typed word plus Enter, which
 * is what NVDA's Ctrl+NVDA+F and JAWS' Ctrl+F cost their user; `findNext` (F3)
 * repeats it with a single key.
 */
const COMMAND_COSTS = { find: 2 };

/** Steps one command consumes from the budget. */
function commandCost(type) {
  if (FREE_COMMANDS.has(type)) return 0;
  return COMMAND_COSTS[type] || 1;
}

const COMMAND_TYPES = [
  'next',
  'prev',
  'tab',
  'shiftTab',
  ...ROTOR_KINDS,
  'jumpTo',
  'more',
  'rotorLetter',
  ...ROTOR_STEP_TYPES,
  'find',
  'findNext',
  'activate',
  'type',
  'escape',
  'done',
  'repeat',
  'mark',
];
/** Commands whose implementation walks the whole reading order internally. */
const WALKING_COMMANDS = new Set([
  ...ROTOR_KINDS,
  'jumpTo',
  'more',
  'rotorLetter',
  ...ROTOR_STEP_TYPES,
  'find',
  'findNext',
]);

// In-page runtime. Serialised with Function.prototype.toString() and evaluated
// in the page after the VSR bundle; everything inside runs in the browser.
/* istanbul ignore next -- runs in the browser */
function srenvRuntime() {
  if (window.__SRENV && window.__SRENV.ready) return;

  const virtual = window.__VSR.virtual;
  const MAX_WALK = 4000;

  // Mirror of ROTOR_STEP_COMMANDS. This function is shipped into the page as
  // source text, so it cannot close over module scope. Keep the two in sync.
  const STEP_COMMANDS = {
    nextHeading: { kind: 'headings', dir: 'next', label: 'heading' },
    prevHeading: { kind: 'headings', dir: 'prev', label: 'heading' },
    nextLink: { kind: 'links', dir: 'next', label: 'link' },
    prevLink: { kind: 'links', dir: 'prev', label: 'link' },
    nextFormField: { kind: 'formFields', dir: 'next', label: 'form field' },
    prevFormField: { kind: 'formFields', dir: 'prev', label: 'form field' },
    nextLandmark: { kind: 'landmarks', dir: 'next', label: 'landmark' },
    prevLandmark: { kind: 'landmarks', dir: 'prev', label: 'landmark' },
    nextButton: { kind: 'buttons', dir: 'next', label: 'button' },
    prevButton: { kind: 'buttons', dir: 'prev', label: 'button' },
  };
  const ROTOR_KIND_LIST = ['headings', 'landmarks', 'links', 'formFields', 'buttons'];
  const PAGE_SIZE = 8;

  /**
   * Container announcements merged with their first text node into ONE stop:
   * the screen reader says "paragraph, Der Herzultraschall ..." instead of
   * stopping on "paragraph" and on the text separately.
   */
  const MERGE_CONTAINER_SELECTOR = 'p, li, blockquote, figure, dd, dt';

  /**
   * "end of ..." stops that are dropped: they are punctuation, not content.
   * The boundaries that carry information a user needs (a list and its item
   * count, a table, the landmark boundaries, the document) keep their stop.
   */
  const DROPPED_END_RE =
    /^end of (paragraph|listitem|list item|heading|group|figure|blockquote|term|definition|generic)\b/i;

  /** Role word a phrase starts with ("link, Contact" -> "link"). */
  const ROLE_PREFIX_RE =
    /^(link|button|heading|listitem|list item|paragraph|textbox|searchbox|combobox|checkbox|radio|switch|spinbutton|slider|option|tab|menuitem|image|img|banner|navigation|main|contentinfo|complementary|region|form|search|article|group|list|table|row|cell|figure|blockquote|document|dialog|alertdialog|status|alert)\b[,:]?\s*/i;

  const LIVE_SELECTOR = '[aria-live], [role="status"], [role="alert"], [role="log"], output';
  const LANDMARK_SELECTOR =
    'header, nav, main, aside, footer, section[aria-label], section[aria-labelledby], form[aria-label], form[aria-labelledby],' +
    '[role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"],' +
    '[role="search"], [role="form"], [role="region"]';
  const LINK_SELECTOR = 'a[href], [role="link"]';
  const FIELD_SELECTOR =
    'input:not([type="hidden"]), select, textarea,' +
    '[role="textbox"], [role="searchbox"], [role="combobox"], [role="checkbox"],' +
    '[role="radio"], [role="spinbutton"], [role="slider"], [role="switch"]';
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const BUTTON_SELECTOR =
    'button, input[type="button"], input[type="submit"], input[type="reset"],' +
    ' input[type="image"], [role="button"], summary';

  const state = {
    ready: false,
    announcements: [],
    lastRotor: null,
    lastFind: null,
    mutations: { added: 0, removed: 0, changed: 0 },
    liveSeen: new Map(),
  };

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Comparison form for `find`: case-insensitive and diacritic-insensitive, so
   * "Öffnungszeiten" is found by typing "offnungszeiten" and "Café" by "cafe".
   */
  function foldText(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** The heading level of an element, `null` when it is not a heading. */
  function headingLevelOf(el) {
    if (!el || el.nodeType !== 1) return null;
    const aria = el.getAttribute('aria-level');
    if (aria && Number(aria) >= 1 && Number(aria) <= 6) return Number(aria);
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) return Number(m[1]);
    return el.getAttribute('role') === 'heading' ? 2 : null;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  function selectorFor(node) {
    let el = node;
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (!el || el.nodeType !== 1) return null;
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && document.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) {
        parts.unshift('#' + CSS.escape(cur.id));
        return parts.join(' > ');
      }
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children, (c) => c.tagName === cur.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.length ? 'html > ' + parts.join(' > ') : 'html';
  }

  function roleOf(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    const implicitRoles = {
      a: el.hasAttribute('href') ? 'link' : 'generic',
      button: 'button',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
      nav: 'navigation',
      main: 'main',
      header: 'banner',
      footer: 'contentinfo',
      aside: 'complementary',
      form: 'form',
      select: 'combobox',
      textarea: 'textbox',
      img: 'img',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
      table: 'table',
    };
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    return implicitRoles[tag] || null;
  }

  function nameOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(textOf);
      if (parts.length) return parts.join(' ');
    }
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    if (el.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) return textOf(lbl);
    }
    const closestLabel = el.closest && el.closest('label');
    if (closestLabel) return textOf(closestLabel);
    if (el.tagName === 'IMG') return el.getAttribute('alt') || '';
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset') return el.value || '';
      return '';
    }
    return textOf(el);
  }

  function openDialogs() {
    const found = [];
    const nodes = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog');
    for (const el of nodes) {
      if (el.tagName === 'DIALOG' && !el.open) continue;
      if (!isVisible(el)) continue;
      found.push({
        selector: selectorFor(el),
        modal: el.getAttribute('aria-modal') === 'true' || (el.tagName === 'DIALOG' && el.open),
        name: nameOf(el),
        containsFocus: !!(document.activeElement && el.contains(document.activeElement)),
      });
    }
    return found;
  }

  function focusInfo() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    return { role: roleOf(el), name: nameOf(el), selector: selectorFor(el) };
  }

  function domSignature() {
    return {
      elements: document.querySelectorAll('*').length,
      textLength: (document.body ? document.body.innerText || '' : '').length,
      text: (document.body ? document.body.innerText || '' : '').replace(/\s+/g, ' ').trim(),
    };
  }

  function liveRegionFor(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(LIVE_SELECTOR)) {
        const mode = el.getAttribute('aria-live');
        const role = el.getAttribute('role');
        if (mode === 'off') return null;
        if (
          mode ||
          role === 'status' ||
          role === 'alert' ||
          role === 'log' ||
          el.tagName === 'OUTPUT'
        ) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function pushAnnouncement(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (state.announcements[state.announcements.length - 1] === t) return;
    state.announcements.push(t);
  }

  function startObserver() {
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') {
          state.mutations.added += r.addedNodes.length;
          state.mutations.removed += r.removedNodes.length;
        } else {
          state.mutations.changed += 1;
        }
        const region = liveRegionFor(r.target);
        if (region) {
          const txt = textOf(region);
          if (state.liveSeen.get(region) !== txt) {
            state.liveSeen.set(region, txt);
            pushAnnouncement(txt);
          }
        }
      }
    });
    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'hidden',
        'aria-hidden',
        'aria-expanded',
        'aria-modal',
        'style',
        'class',
        'open',
      ],
    });
    state.observer = obs;
    // Seed the live-region baseline so the initial content is not announced.
    for (const el of document.querySelectorAll(LIVE_SELECTOR)) {
      state.liveSeen.set(el, textOf(el));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Reading stops                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * A "stop" is one position of the reading cursor. It is NOT one VSR position:
   * a container announcement and its first text node are one stop
   * ("paragraph, We build small things"), and the closing "end of paragraph" /
   * "end of listitem" boundaries are no stop at all. That is how a screen
   * reader reads running text; counting the punctuation as separate stops made
   * every paragraph cost three commands to pass.
   */
  function isDroppedEnd(phrase) {
    return DROPPED_END_RE.test(String(phrase == null ? '' : phrase).trim());
  }

  /** A container whose announcement merges with its first text node. */
  function isContainerAnnouncement(node, phrase) {
    if (!node || node.nodeType !== 1 || !node.matches) return false;
    if (!node.matches(MERGE_CONTAINER_SELECTOR)) return false;
    // The element's own announcement, not one of its descendants' phrases.
    return !!phrase;
  }

  async function rawMove(dir) {
    if (dir === 'prev') await virtual.previous();
    else await virtual.next();
  }

  /**
   * Moves off the VSR positions that are not stops of their own: dropped "end
   * of ..." boundaries and container announcements that merge with the text
   * node behind them.
   */
  async function normalizeStop(dir) {
    for (let i = 0; i < 200; i += 1) {
      const node = virtual.activeNode;
      const phrase = await virtual.lastSpokenPhrase();
      if (isDroppedEnd(phrase)) {
        await rawMove(dir);
        continue;
      }
      if (isContainerAnnouncement(node, phrase)) {
        await virtual.next();
        const after = virtual.activeNode;
        const merges = after && after.nodeType !== 1 && node.contains(after);
        // Going forward the merged stop IS the text node: stay on it.
        if (merges && dir !== 'prev') return;
        await virtual.previous();
        if (merges) {
          // Going backwards the announcement is behind the merged stop already.
          await virtual.previous();
          continue;
        }
        return; // a container without text of its own is a stop (e.g. a list item holding a link)
      }
      return;
    }
  }

  /** The phrase of the current stop, with a merged container announcement. */
  async function phraseHere() {
    const node = virtual.activeNode;
    const phrase = await virtual.lastSpokenPhrase();
    if (!node || node.nodeType === 1) return phrase;
    const container = node.parentElement && node.parentElement.closest(MERGE_CONTAINER_SELECTOR);
    if (!container) return phrase;
    await virtual.previous();
    const before = virtual.activeNode;
    const beforePhrase = await virtual.lastSpokenPhrase();
    await virtual.next();
    if (before !== container) return phrase;
    return beforePhrase + ', ' + phrase;
  }

  /** One stop forward / backward, boundaries and merges applied. */
  async function moveStop(dir) {
    await rawMove(dir);
    await normalizeStop(dir);
  }

  /**
   * Walks the reading order once and returns [{ node, phrase }], one entry per
   * stop. Walking a full cycle leaves the cursor exactly where it started.
   */
  async function readingOrder() {
    const firstNode = virtual.activeNode;
    const firstPhrase = await phraseHere();
    const entries = [{ node: firstNode, phrase: firstPhrase }];
    for (let i = 0; i < MAX_WALK; i++) {
      await moveStop('next');
      const node = virtual.activeNode;
      const phrase = await phraseHere();
      if (node === firstNode && phrase === firstPhrase) return entries;
      entries.push({ node, phrase });
    }
    return entries;
  }

  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function matchesKind(el, kind) {
    if (!el || !el.matches) return false;
    if (kind === 'headings') return el.matches(HEADING_SELECTOR);
    if (kind === 'landmarks') return el.matches(LANDMARK_SELECTOR);
    if (kind === 'links') return el.matches(LINK_SELECTOR);
    if (kind === 'formFields') return el.matches(FIELD_SELECTOR);
    if (kind === 'buttons') return el.matches(BUTTON_SELECTOR);
    return false;
  }

  /** The entry text a first-letter jump looks at ("link, Contact" -> "Contact"). */
  function rotorLabel(phrase) {
    return String(phrase == null ? '' : phrase)
      .replace(ROLE_PREFIX_RE, '')
      .trim();
  }

  /** The page of `state.lastRotor` starting at `from`, and it is now revealed. */
  function rotorPage(from) {
    const rotor = state.lastRotor;
    const start = Math.max(0, Math.min(from, rotor.items.length));
    const page = [];
    for (let i = start; i < rotor.items.length && page.length < PAGE_SIZE; i += 1) {
      rotor.shown.add(i);
      page.push(Object.assign({}, rotor.items[i]));
    }
    rotor.from = start;
    return {
      kind: rotor.kind,
      items: page,
      from: start,
      total: rotor.items.length,
      hasMore: start + page.length < rotor.items.length,
    };
  }

  async function buildRotor(kind) {
    const order = await readingOrder();
    const items = [];
    const nodes = [];
    const seen = new Set();
    for (const entry of order) {
      const el = elementOf(entry.node);
      if (!el || seen.has(el)) continue;
      if (!matchesKind(el, kind)) continue;
      if (!isVisible(el)) continue;
      seen.add(el);
      nodes.push(el);
      const item = {
        index: items.length,
        phrase: entry.phrase,
        selector: selectorFor(el),
      };
      // The level is what the digit keys navigate by, so the headings list says it.
      if (kind === 'headings') item.level = headingLevelOf(el);
      items.push(item);
    }
    state.lastRotor = { kind, items, nodes, shown: new Set(), from: 0 };
    return rotorPage(0);
  }

  /**
   * NVDA-style quick navigation: move the cursor to the next/previous element
   * of `kind` in reading order, wrapping around at the document boundary.
   *
   * The VSR reading order is cyclic, so one full lap without a match means the
   * document holds no such element; the cursor is then back where it started.
   * If the only element of that kind is the one the cursor already sits on, the
   * wrap lands on it again and its phrase is re-spoken, as NVDA does with
   * wrapping enabled.
   *
   * Element kinds are matched with `matchesKind`, the predicate the rotor lists
   * use, so `nextHeading` walks exactly the set the `headings` rotor lists.
   * Container landmarks occupy two positions in the VSR reading order ("main",
   * "end of main"); the closing boundary is skipped so stepping always lands on
   * the landmark itself, the way NVDA's D key does.
   *
   * With a `level` (1..6) only headings of that level are stopped at, the way
   * the digit keys of NVDA and JAWS work.
   *
   * @returns {Promise<boolean>} false when the document has no element of `kind`
   */
  async function stepToKind(kind, dir, level) {
    const startNode = virtual.activeNode;
    const startPhrase = await virtual.lastSpokenPhrase();
    for (let i = 0; i < MAX_WALK; i += 1) {
      if (dir === 'prev') await virtual.previous();
      else await virtual.next();
      const node = virtual.activeNode;
      const phrase = await virtual.lastSpokenPhrase();
      const el = elementOf(node);
      if (
        el &&
        matchesKind(el, kind) &&
        (!level || headingLevelOf(el) === level) &&
        isVisible(el) &&
        !/^end of\b/i.test(String(phrase || '').trim())
      ) {
        return true;
      }
      // One full lap without a hit: the document holds no such element and the
      // cursor is back where it started.
      if (node === startNode && phrase === startPhrase) return false;
    }
    return false;
  }

  /**
   * Browse-mode search (NVDA Ctrl+NVDA+F, JAWS Ctrl+F): move the cursor to the
   * next element AFTER it whose spoken phrase contains `needle` (already
   * folded). The search does NOT wrap: everything from the cursor to the end of
   * the document is searched and nothing before it, so a miss leaves the cursor
   * exactly where it was.
   *
   * @returns {Promise<boolean>} false when nothing after the cursor matches
   */
  async function findForward(needle) {
    const order = await readingOrder();
    // The reading order is cyclic and starts at the cursor, so the position of
    // document start marks the end of the document for the forward search.
    let stop = order.length;
    for (let i = 1; i < order.length; i += 1) {
      const node = order[i].node;
      if (node === document || node === document.body || node === document.documentElement) {
        stop = i;
        break;
      }
    }
    for (let i = 1; i < stop; i += 1) {
      if (!foldText(order[i].phrase).includes(needle)) continue;
      for (let j = 0; j < i; j += 1) await moveStop('next');
      return true;
    }
    return false;
  }

  /** Moves the VSR cursor forward (wrapping) until it lands on `target`. */
  async function moveCursorTo(target) {
    if (elementOf(virtual.activeNode) === target) return true;
    for (let i = 0; i < MAX_WALK; i++) {
      await moveStop('next');
      if (elementOf(virtual.activeNode) === target) return true;
    }
    return false;
  }

  function interactiveTarget() {
    const el = elementOf(virtual.activeNode);
    if (!el) return null;
    if (el.matches('a[href], button, input, select, textarea, [role], [tabindex], summary'))
      return el;
    return (
      el.closest(
        'a[href], button, input, select, textarea, [role="button"], [role="link"], summary'
      ) || el
    );
  }

  async function exec(cmd) {
    const type = cmd && cmd.type;
    let rotor = null;
    let error = null;

    try {
      switch (type) {
        case 'next':
          await moveStop('next');
          break;
        case 'prev':
          await moveStop('prev');
          break;
        case 'tab':
          await virtual.press('Tab');
          break;
        case 'shiftTab':
          await virtual.press('Shift+Tab');
          break;
        case 'headings':
        case 'landmarks':
        case 'links':
        case 'formFields':
        case 'buttons':
          rotor = await buildRotor(type);
          break;
        case 'find': {
          const needle = foldText(cmd.arg);
          if (!needle) {
            error = 'find requires a text to search for';
            break;
          }
          state.lastFind = needle;
          if (!(await findForward(needle))) error = 'not found';
          break;
        }
        case 'findNext': {
          if (!state.lastFind) {
            error = 'findNext requires a preceding find';
            break;
          }
          if (!(await findForward(state.lastFind))) error = 'not found';
          break;
        }
        case 'more': {
          if (!state.lastRotor) {
            error = 'more requires a preceding rotor command';
            break;
          }
          const next = state.lastRotor.from + PAGE_SIZE;
          if (next >= state.lastRotor.items.length) {
            error = 'no more entries in the list';
            break;
          }
          rotor = rotorPage(next);
          break;
        }
        case 'rotorLetter': {
          if (!state.lastRotor) {
            error = 'rotorLetter requires a preceding rotor command';
            break;
          }
          const letter = foldText(cmd.arg).slice(0, 1);
          if (!letter) {
            error = 'rotorLetter requires a letter';
            break;
          }
          const items = state.lastRotor.items;
          let found = -1;
          // The NEXT entry with that letter, wrapping once, like the first-letter
          // navigation of the NVDA elements list.
          for (let n = 1; n <= items.length; n += 1) {
            const i = (state.lastRotor.from + n) % items.length;
            if (foldText(rotorLabel(items[i].phrase)).startsWith(letter)) {
              found = i;
              break;
            }
          }
          if (found === -1) {
            error = 'no entry starting with ' + letter;
            break;
          }
          rotor = rotorPage(found);
          break;
        }
        case 'jumpTo': {
          const idx = Number(cmd.arg);
          if (!state.lastRotor) {
            error = 'jumpTo requires a preceding rotor command';
            break;
          }
          if (!Number.isInteger(idx) || idx < 0 || idx >= state.lastRotor.nodes.length) {
            error =
              'jumpTo index ' +
              cmd.arg +
              ' is out of range (0..' +
              (state.lastRotor.nodes.length - 1) +
              ')';
            break;
          }
          if (!state.lastRotor.shown.has(idx)) {
            error =
              'entry ' + idx + ' has not been shown yet; use more or rotorLetter to see it first';
            break;
          }
          const target = state.lastRotor.nodes[idx];
          if (!document.contains(target)) {
            error = 'jumpTo target is no longer in the document';
            break;
          }
          const ok = await moveCursorTo(target);
          if (!ok) error = 'jumpTo could not reach the target element';
          break;
        }
        case 'activate': {
          const el = interactiveTarget();
          if (!el) {
            error = 'nothing to activate at the cursor';
            break;
          }
          try {
            await virtual.act();
          } catch (e) {
            el.click();
          }
          break;
        }
        case 'type': {
          const text = cmd.arg == null ? '' : String(cmd.arg);
          const el = interactiveTarget();
          if (
            !el ||
            !el.matches(
              'input, textarea, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"]'
            )
          ) {
            error = 'the cursor is not on a text field';
            break;
          }
          if (document.activeElement !== el && el.focus) el.focus();
          await virtual.type(text);
          break;
        }
        case 'escape':
          await virtual.press('Escape');
          break;
        case 'done':
          break;
        case 'repeat':
        case 'mark':
          // Nothing happens on the page; both are free and only recorded.
          break;
        default: {
          const step = STEP_COMMANDS[type];
          if (!step) {
            error = 'unknown command: ' + JSON.stringify(type);
            break;
          }
          // Heading steps take an optional level (the digit keys of NVDA/JAWS).
          const level =
            step.kind === 'headings' && cmd.arg != null ? Math.trunc(Number(cmd.arg)) : 0;
          if (level && !(level >= 1 && level <= 6)) {
            error = 'heading level must be between 1 and 6';
            break;
          }
          const found = await stepToKind(step.kind, step.dir, level);
          if (!found) error = 'no ' + step.label + (level ? ' at level ' + level : '');
          break;
        }
      }
    } catch (e) {
      error = (e && e.message) || String(e);
    }

    return { rotor, error };
  }

  async function snapshot() {
    return {
      phrase: await phraseHere(),
      focus: focusInfo(),
      dialogs: openDialogs(),
      dom: domSignature(),
      url: location.href,
      cursorSelector: selectorFor(virtual.activeNode),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Reading fragmentation                                             */
  /* ---------------------------------------------------------------- */

  // Boundary phrases the VSR speaks for containers. Kept in sync with
  // `isStructuralPhrase` in src/agent/answer-match.js. They are punctuation,
  // not content, and must not count as fragments.
  const STRUCTURAL_PHRASE_RE =
    /^(end of\b.*|document|paragraph|list|listitem|list item|table|row|cell|columnheader|rowheader|figure|blockquote|region|banner|navigation|main|contentinfo|complementary|form|search|article|section|group|separator|generic|heading)$/i;

  const FRAGMENT_BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li';
  const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,[role="link"],[role="button"]';
  /** A single visual line of text is at most this many line-heights tall. */
  const SINGLE_LINE_FACTOR = 2;
  /** Fragments in one single-line block from which it counts as fragmented. */
  const FRAGMENT_MIN = 3;
  /** Page-level: average fragments per element from which the page counts. */
  const PAGE_FRAGMENT_RATIO = 2.5;
  const PAGE_MIN_ELEMENTS = 10;

  function lineHeightOf(el) {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh) && lh > 0) return lh;
    const fs = parseFloat(cs.fontSize);
    return Number.isFinite(fs) && fs > 0 ? fs * 1.2 : 16 * 1.2;
  }

  /**
   * How many separate text nodes the screen reader speaks per heading /
   * paragraph / list item. A builder that wraps every word in its own inline
   * element turns one sentence into a stutter of phrases ("Information gem." /
   * "§ 5" / "ECG und Offenlegung gem." / ...): the visual line is one line, the
   * spoken output is five. Interactive descendants (links, buttons) are their
   * own spoken node by design and are not counted.
   */
  async function readingFragmentation() {
    const order = await readingOrder();
    const perBlock = new Map();
    for (const entry of order) {
      const phrase = String(entry.phrase == null ? '' : entry.phrase).trim();
      if (!phrase || STRUCTURAL_PHRASE_RE.test(phrase)) continue;
      const el = elementOf(entry.node);
      if (!el || !el.closest) continue;
      const block = el.closest(FRAGMENT_BLOCK_SELECTOR);
      if (!block || !isVisible(block)) continue;
      // The block's own announcement ("heading, ..., level 2") is not a fragment,
      // but it proves the block exists: a heading spoken as ONE phrase has no
      // text node of its own and would otherwise be missing from the page ratio.
      if (entry.node === block) {
        if (!perBlock.has(block)) perBlock.set(block, []);
        continue;
      }
      // Links and buttons inside the text are separate nodes on purpose.
      const interactive = el.closest(INTERACTIVE_SELECTOR);
      if (interactive && block.contains(interactive)) continue;
      if (!perBlock.has(block)) perBlock.set(block, []);
      const list = perBlock.get(block);
      if (list.length < 12) list.push(phrase);
      else list.push(null);
    }

    const elements = [];
    let totalFragments = 0;
    for (const [block, phrases] of perBlock) {
      const count = Math.max(phrases.length, 1);
      totalFragments += count;
      const lineHeight = lineHeightOf(block);
      const height = block.getBoundingClientRect().height;
      const singleLine = height > 0 && height <= SINGLE_LINE_FACTOR * lineHeight;
      elements.push({
        selector: selectorFor(block),
        tag: block.tagName.toLowerCase(),
        count,
        phrases: phrases.filter((p) => p !== null),
        singleLine,
        height: Math.round(height),
        lineHeight: Math.round(lineHeight),
        flagged: count >= FRAGMENT_MIN && singleLine,
      });
    }
    const ratio = elements.length ? totalFragments / elements.length : 0;
    return {
      url: location.href,
      title: document.title,
      elementCount: elements.length,
      fragmentCount: totalFragments,
      ratio,
      pageFlagged: elements.length >= PAGE_MIN_ELEMENTS && ratio >= PAGE_FRAGMENT_RATIO,
      thresholds: {
        fragmentMin: FRAGMENT_MIN,
        pageRatio: PAGE_FRAGMENT_RATIO,
        pageMinElements: PAGE_MIN_ELEMENTS,
      },
      // Worst first: the page-level finding shows the head of this list.
      elements: elements.sort((a, b) => b.count - a.count),
    };
  }

  window.__SRENV = {
    ready: false,
    /**
     * Building blocks of the command implementations, exposed so optimal-path.js
     * computes reading order and rotor lists with the same logic the commands use.
     */
    internals: {
      readingOrder,
      readingFragmentation,
      buildRotor,
      selectorFor,
      elementOf,
      matchesKind,
      isVisible,
      headingLevelOf,
      foldText,
      rotorLabel,
      rotorPageSize: PAGE_SIZE,
      rotorKinds: ROTOR_KIND_LIST,
      getLastRotorNodes() {
        return state.lastRotor ? state.lastRotor.nodes : [];
      },
    },
    async start() {
      await virtual.start({ container: document.body, displayCursor: false });
      state.announcements = [];
      state.mutations = { added: 0, removed: 0, changed: 0 };
      startObserver();
      this.ready = true;
      state.ready = true;
      return snapshot();
    },
    async stop() {
      if (state.observer) state.observer.disconnect();
      try {
        await virtual.stop();
      } catch (e) {
        /* already stopped */
      }
      this.ready = false;
    },
    snapshot,
    async run(cmd, opts) {
      state.mutations = { added: 0, removed: 0, changed: 0 };
      const logBefore = (await virtual.spokenPhraseLog()).length;
      const { rotor, error } = await exec(cmd);
      const settle = opts && opts.settleMs ? opts.settleMs : 0;
      if (settle > 0) await new Promise((r) => setTimeout(r, settle));
      const log = await virtual.spokenPhraseLog();
      const after = await snapshot();

      const announcements = state.announcements.slice();
      state.announcements = [];
      if (!opts || !opts.suppressSpokenLog) {
        const spoken = log.slice(logBefore);
        for (const phrase of spoken) {
          if (phrase === after.phrase) continue;
          if (announcements.indexOf(phrase) !== -1) continue;
          if (/^(alert|status|log|region)\b/i.test(phrase)) announcements.push(phrase);
        }
      }

      return {
        phrase: after.phrase,
        announcements,
        rotor,
        focus: after.focus,
        url: after.url,
        error,
        meta: {
          dialogs: after.dialogs,
          dom: after.dom,
          mutations: Object.assign({}, state.mutations),
          cursorSelector: after.cursorSelector,
        },
      };
    },
  };
  window.__SRENV.ready = false;
}

// Node side

const FINDING_DEFS = {
  'focus-lost': {
    wcag: ['2.4.3'],
    severity: 'serious',
    impact: 'serious',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
  },
  'dialog-not-trapped': {
    wcag: ['2.4.3'],
    severity: 'serious',
    impact: 'serious',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
  },
  'escape-does-not-close': {
    wcag: ['2.1.2'],
    severity: 'serious',
    impact: 'serious',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html',
  },
  'unannounced-change': {
    wcag: ['4.1.3'],
    severity: 'moderate',
    impact: 'moderate',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html',
  },
  'unnamed-control-used': {
    wcag: ['4.1.2'],
    severity: 'critical',
    impact: 'critical',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
  },
  'activation-no-effect': {
    wcag: ['4.1.2', '3.2.2'],
    severity: 'serious',
    impact: 'serious',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
  },
  'reading-fragmentation': {
    wcag: ['1.3.1', '1.3.2'],
    severity: 'moderate',
    impact: 'moderate',
    help: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
  },
};

/** Roles whose activation must do something perceivable. */
const ACTIONABLE_ROLE_RE = /^(button|link|menuitem|menuitemcheckbox|menuitemradio|tab|switch)$/i;

/** The role a VSR phrase starts with ("link, Impressum" -> "link"). */
function phraseRole(phrase) {
  return String(phrase || '')
    .split(',')[0]
    .trim();
}

/**
 * A `mark` argument the agent supplies: `{ kind, reason }` with a known kind.
 * Returns null for anything else, which the env reports as an error.
 */
function normalizeMark(arg) {
  const value = arg && typeof arg === 'object' ? arg : { kind: arg };
  const kind = String(value.kind || '').trim();
  if (MARK_KINDS.indexOf(kind) === -1) return null;
  const reason = value.reason == null ? '' : String(value.reason).trim();
  return reason ? { kind, reason } : { kind };
}

/** Words in one spoken phrase, so listening time can be computed from a trace. */
function wordCount(phrase) {
  const text = String(phrase == null ? '' : phrase).trim();
  return text ? text.split(/\s+/).length : 0;
}

/** `page.url()` without throwing on a target that is already gone. */
function safeUrl(target) {
  try {
    return typeof target.url === 'function' ? target.url() : null;
  } catch (_) {
    return null;
  }
}

/** Phrases VSR speaks for an element that has a role but no accessible name. */
const ROLE_ONLY_RE =
  /^(button|link|checkbox|radio|switch|textbox|searchbox|combobox|menuitem|menuitemcheckbox|menuitemradio|tab|option|slider|spinbutton|image|img|graphics-document)$/i;

/** Live-region text change threshold for `unannounced-change`. */
const UNANNOUNCED_MIN_ADDED_NODES = 3;

class ScreenReaderEnv {
  /**
   * @param {import('puppeteer').Page} page   already-navigated page
   * @param {Object} [options]
   * @param {number} [options.maxSteps=60]    step budget; commands past it are refused
   * @param {number} [options.phraseWindow=20] size of the rolling phrase memory
   * @param {number} [options.settleMs=120]   settle time after each command
   */
  constructor(page, options = {}) {
    if (!page) throw new Error('ScreenReaderEnv requires a Puppeteer page');
    this.page = page;
    this.maxSteps = options.maxSteps == null ? 60 : options.maxSteps;
    this.phraseWindow = options.phraseWindow == null ? 20 : options.phraseWindow;
    this.settleMs = options.settleMs == null ? 120 : options.settleMs;

    this.stepCount = 0;
    this.trace = [];
    this.phrases = [];
    /** Cursor selector after every counted command, for derived backtracks. */
    this._cursorHistory = [];
    this.started = false;
    this._injected = false;
    this._lastUrl = null;

    // Pages opened by the last command (window.open / target="_blank"). A blind
    // user is told a new window appeared, so the env announces it; the popup
    // itself is closed again so the measurement stays on one page.
    this._pendingPopups = [];
    this._popupWork = [];

    // Reading-fragmentation results, one per URL visited (see
    // `checkReadingFragmentation`); merged into `deriveFindings()`.
    this._fragmentation = new Map();

    this._onFrameNavigated = (frame) => {
      if (frame === this.page.mainFrame()) this._injected = false;
    };
    this.page.on('framenavigated', this._onFrameNavigated);

    this._onPopup = (popup) => this._capturePopup(popup);
    this.page.on('popup', this._onPopup);

    // Not every driver routes window.open through the page's `popup` event, so
    // the browser-level target event is watched as well (deduplicated by page).
    this._browser = typeof this.page.browser === 'function' ? this.page.browser() : null;
    if (this._browser && typeof this._browser.on === 'function') {
      this._onTargetCreated = async (target) => {
        try {
          if (typeof target.type === 'function' && target.type() !== 'page') return;
          // Only a window THIS page opened; every other tab in the browser
          // (another measurement, another test) is none of this env's business.
          const opener = typeof target.opener === 'function' ? target.opener() : null;
          if (!opener || opener !== this.page.target()) return;
          const popup = await target.page();
          if (popup && popup !== this.page) this._capturePopup(popup);
        } catch (_) {
          /* the target vanished before it could be inspected */
        }
      };
      this._browser.on('targetcreated', this._onTargetCreated);
    }
  }

  /**
   * Record a newly opened page and close it again. The record is filled in
   * asynchronously; `step()` awaits `_popupWork` before it reads the list, so a
   * popup is never reported one command too late.
   */
  _capturePopup(popup) {
    if (!popup || popup === this.page || this._seenPopups().has(popup)) return;
    this._popupPages = this._popupPages || new WeakSet();
    this._popupPages.add(popup);
    const record = { url: safeUrl(popup), title: null };
    this._pendingPopups.push(record);
    this._popupWork.push(
      (async () => {
        try {
          if (!record.url || record.url === 'about:blank') {
            await popup
              .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 1000 })
              .catch(() => {});
            record.url = safeUrl(popup) || record.url;
          }
          record.title = await popup.title().catch(() => null);
        } finally {
          await popup.close().catch(() => {});
        }
      })()
    );
  }

  _seenPopups() {
    this._popupPages = this._popupPages || new WeakSet();
    return this._popupPages;
  }

  /**
   * The name a real screen reader speaks when a new document finishes loading:
   * the document title, or the first h1, or the path when the page has neither.
   */
  async _documentName() {
    try {
      return await this.page.evaluate(() => {
        const clean = (s) =>
          String(s == null ? '' : s)
            .replace(/\s+/g, ' ')
            .trim();
        const title = clean(document.title);
        if (title) return title;
        const h1 = document.querySelector('h1');
        const heading = h1 ? clean(h1.textContent) : '';
        if (heading) return heading;
        return clean(location.pathname) || clean(location.href);
      });
    } catch (e) {
      return '';
    }
  }

  /**
   * A jump that lands on an element the cursor has already visited, with at
   * least `BACKTRACK_MIN_GAP` other stops in between, is a backtrack: the agent
   * went somewhere, found nothing and came back. Derived from the trace so the
   * report does not depend on the agent marking it itself.
   *
   * @returns {'backtrack'|null}
   */
  _deriveBacktrack(type, cursorSelector) {
    if (!cursorSelector || !JUMP_COMMANDS.has(type)) return null;
    const last = this._cursorHistory.lastIndexOf(cursorSelector);
    if (last === -1) return null;
    const between = new Set(this._cursorHistory.slice(last + 1).filter(Boolean));
    between.delete(cursorSelector);
    return between.size >= BACKTRACK_MIN_GAP ? 'backtrack' : null;
  }

  /** Drain the popups opened since the last command. */
  async _drainPopups() {
    const work = this._popupWork.splice(0);
    if (work.length) await Promise.all(work).catch(() => {});
    return this._pendingPopups.splice(0);
  }

  static get COMMAND_TYPES() {
    return COMMAND_TYPES.slice();
  }

  /** Injects the VSR bundle + runtime and starts the cursor at document start. */
  async start() {
    await this._ensureInjected();
    this.started = true;
    this._lastUrl = this.page.url();
    const snap = await this.page.evaluate(() => window.__SRENV.snapshot());
    this.phrases.push(snap.phrase);
    return snap;
  }

  async _isInjected() {
    try {
      return await this.page.evaluate(
        () => !!(window.__SRENV && window.__SRENV.ready && window.__VSR)
      );
    } catch (e) {
      return false;
    }
  }

  async _ensureInjected() {
    if (this._injected && (await this._isInjected())) return false;
    await injectScreenReader(this.page, { force: true });
    this._injected = true;
    return true;
  }

  get budgetLeft() {
    return Math.max(0, this.maxSteps - this.stepCount);
  }

  /** The last `phraseWindow` spoken phrases (the agent's memory cap). */
  get recentPhrases() {
    return this.phrases.slice(-this.phraseWindow);
  }

  /**
   * Executes one command `{ type, arg? }` and returns the observation.
   * Every call, including unknown and refused commands, costs one step unless the
   * budget is already exhausted (nothing is executed then). `repeat` is free.
   *
   * Commands: next, prev, tab, shiftTab (cursor); headings, landmarks, links,
   * formFields, buttons (first page of the rotor list into obs.rotor), more
   * (next page), rotorLetter arg:letter (page starting at the next entry with
   * that letter), jumpTo arg:index (an entry the list has SHOWN);
   * nextHeading/prevHeading (arg: optional level 1..6),
   * nextLink/prevLink, nextFormField/prevFormField, nextLandmark/prevLandmark,
   * nextButton/prevButton (quick navigation, wraps around; an empty kind leaves
   * the cursor put and sets `error: 'no <kind>'`); find arg:text (browse-mode
   * search forward from the cursor, no wrap, `error: 'not found'`, costs TWO
   * steps) and findNext (repeats the last search, one step); activate, type
   * arg:text, escape; done (recorded only); repeat (re-emits the last phrase)
   * and mark arg:{kind, reason} (records what the caller noticed), both free:
   * trace entry and observation flagged `free: true`.
   *
   * One step of the cursor is one STOP, not one VSR position: a container and
   * its first text node are read as one ("paragraph, We build small things"),
   * and the "end of paragraph" style boundaries are no stop at all.
   */
  async step(cmd) {
    if (!this.started) throw new Error('ScreenReaderEnv.step() called before start()');

    const freeCmd = FREE_COMMANDS.has(cmd && typeof cmd === 'object' ? cmd.type : cmd);
    if (!freeCmd && this.stepCount >= this.maxSteps) {
      return {
        step: this.stepCount,
        phrase: this.phrases[this.phrases.length - 1] || '',
        announcements: [],
        rotor: null,
        focus: null,
        url: this.page.url(),
        urlChanged: false,
        error: 'step budget exhausted',
        budgetLeft: 0,
      };
    }

    const command = cmd && typeof cmd === 'object' ? cmd : { type: cmd };
    const t0 = Date.now();

    await this._ensureInjected();
    const before = await this.page.evaluate(() => window.__SRENV.snapshot());
    const urlBefore = before.url;

    // Free commands (`repeat`, `mark`) change no state, so they neither consume
    // budget nor advance `stepCount`. They are still recorded in the trace
    // (flagged `free: true`) because they are part of what the user did.
    if (FREE_COMMANDS.has(command.type)) {
      const mark = command.type === 'mark' ? normalizeMark(command.arg) : null;
      const obs = {
        step: this.stepCount,
        phrase: before.phrase || '',
        announcements: [],
        rotor: null,
        focus: before.focus || null,
        url: urlBefore,
        urlChanged: false,
        budgetLeft: this.budgetLeft,
        free: true,
        ...(mark ? { mark } : {}),
        ...(command.type === 'mark' && !mark
          ? { error: `mark requires a kind out of ${MARK_KINDS.join(', ')}` }
          : {}),
      };
      this.trace.push({
        step: this.stepCount,
        cmd: { type: command.type, arg: command.arg },
        ...(command.note ? { note: command.note } : {}),
        ...(mark ? { mark } : {}),
        free: true,
        obsBefore: {
          phrase: before.phrase,
          focusSelector: before.focus ? before.focus.selector : null,
          url: urlBefore,
        },
        obsAfter: obs,
        domChanged: false,
        durationMs: Date.now() - t0,
        meta: {
          reinjected: false,
          before: {
            dialogs: before.dialogs,
            dom: before.dom,
            focus: before.focus,
            cursorSelector: before.cursorSelector,
          },
          after: null,
        },
      });
      return obs;
    }

    // `find` costs two steps (typing the word and pressing Enter), every other
    // counted command one.
    this.stepCount += commandCost(command.type);

    let result;
    let navigated = false;
    const suppressSpokenLog = WALKING_COMMANDS.has(command.type);
    try {
      result = await this.page.evaluate(
        (c, opts) => window.__SRENV.run(c, opts),
        { type: command.type, arg: command.arg },
        { suppressSpokenLog, settleMs: this.settleMs }
      );
    } catch (e) {
      // A navigation triggered by `activate` destroys the execution context.
      navigated = true;
      this._injected = false;
      result = { navigationError: (e && e.message) || String(e) };
    }

    await this._settle();
    const popups = await this._drainPopups();

    let reinjected = false;
    if (navigated || this.page.url() !== urlBefore || !this._injected) {
      reinjected = await this._ensureInjected();
    }

    if (!result || result.navigationError) {
      const snap = await this.page.evaluate(() => window.__SRENV.snapshot());
      result = {
        phrase: snap.phrase,
        announcements: [],
        rotor: null,
        focus: snap.focus,
        url: snap.url,
        error: null,
        meta: {
          dialogs: snap.dialogs,
          dom: snap.dom,
          mutations: { added: 0, removed: 0, changed: 0 },
          cursorSelector: snap.cursorSelector,
        },
      };
    } else if (reinjected) {
      // Cursor was re-attached at document start; report what it now speaks.
      const snap = await this.page.evaluate(() => window.__SRENV.snapshot());
      result.phrase = snap.phrase;
      result.focus = snap.focus;
      result.url = snap.url;
      result.meta = Object.assign({}, result.meta, {
        dialogs: snap.dialogs,
        dom: snap.dom,
        cursorSelector: snap.cursorSelector,
      });
    }

    const url = result.url || this.page.url();
    const urlChanged = url !== urlBefore;
    const domChanged =
      urlChanged ||
      !!(
        result.meta &&
        (result.meta.mutations.added > 0 ||
          result.meta.mutations.removed > 0 ||
          result.meta.mutations.changed > 0 ||
          (before.dom && result.meta.dom && before.dom.text !== result.meta.dom.text))
      );

    const obs = {
      step: this.stepCount,
      phrase: result.phrase || '',
      announcements: result.announcements || [],
      rotor: result.rotor || null,
      focus: result.focus || null,
      url,
      urlChanged,
      budgetLeft: this.budgetLeft,
    };
    if (reinjected) {
      // A new document was loaded: NVDA, VoiceOver and JAWS all speak the page
      // title at that moment, and it is the only thing that tells the user where
      // they landed. It is part of the same observation, so it costs no step.
      const name = await this._documentName();
      if (name) obs.announcements = [`page loaded: ${name}`].concat(obs.announcements);
    }
    if (popups.length) {
      // A new window is the only thing a screen reader has to go on here; the
      // agent hears it exactly as a real one announces a window switch.
      obs.announcements = obs.announcements.concat(
        popups.map((p) => `opens in new window: ${p.title || p.url || 'unknown page'}`)
      );
      obs.newPage = { url: popups[0].url || null };
      if (popups.length > 1) obs.newPage.count = popups.length;
    }
    if (result.error) obs.error = result.error;

    this.phrases.push(obs.phrase);
    this._lastUrl = url;

    const cursorSelector = (result.meta && result.meta.cursorSelector) || null;
    const derived = this._deriveBacktrack(command.type, cursorSelector);
    this._cursorHistory.push(cursorSelector);

    this.trace.push({
      step: this.stepCount,
      cmd: { type: command.type, arg: command.arg },
      // The caller's own one-line reasoning, recorded for the trace report.
      ...(command.note ? { note: command.note } : {}),
      // Listening time is words, not commands; the score stays in commands.
      words: wordCount(obs.phrase),
      ...(derived ? { derivedMark: derived } : {}),
      obsBefore: {
        phrase: before.phrase,
        focusSelector: before.focus ? before.focus.selector : null,
        url: urlBefore,
      },
      obsAfter: obs,
      domChanged,
      durationMs: Date.now() - t0,
      meta: {
        reinjected,
        before: {
          dialogs: before.dialogs,
          dom: before.dom,
          focus: before.focus,
          cursorSelector: before.cursorSelector,
        },
        after: result.meta || null,
      },
    });

    return obs;
  }

  async _settle() {
    if (this.settleMs > 0) {
      await new Promise((r) => setTimeout(r, this.settleMs));
    }
  }

  /**
   * Deterministic barriers read off the trace, no LLM involved.
   * Returns findings shaped like BaseScanner.formatViolation output so the
   * report pipeline and src/severity.js can consume them unchanged.
   */
  deriveFindings() {
    const findings = [];
    const seen = new Set();

    const push = (ruleId, description, node, entry) => {
      const key = `${ruleId}::${(node && node.selector) || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const def = FINDING_DEFS[ruleId];
      findings.push({
        scannerId: 'sr-agent-env',
        ruleId,
        type: ruleId,
        impact: def.impact,
        severity: def.severity,
        description,
        nodes: [node],
        helpUrl: def.help,
        wcagCriteria: def.wcag,
        step: entry.step,
        cmd: entry.cmd,
      });
    };

    for (const entry of this.trace) {
      const cmd = entry.cmd.type;
      const before = (entry.meta && entry.meta.before) || {};
      const after = (entry.meta && entry.meta.after) || {};
      const dialogsBefore = before.dialogs || [];
      const dialogsAfter = after.dialogs || [];
      const focusAfter = entry.obsAfter.focus;
      const focusBefore = before.focus || null;
      const focusChanged =
        (focusBefore && focusBefore.selector) !== (focusAfter && focusAfter.selector);

      // focus-lost: activation/escape changed the DOM but dropped focus on body.
      // A full page navigation legitimately resets focus to <body>; that is not a barrier.
      if (
        (cmd === 'activate' || cmd === 'escape') &&
        entry.domChanged &&
        !entry.obsAfter.urlChanged &&
        !focusAfter &&
        focusBefore
      ) {
        push(
          'focus-lost',
          `After "${cmd}" on ${before.focus ? before.focus.selector : entry.obsBefore.focusSelector || 'the cursor position'} the page changed but keyboard focus fell back to <body>. A screen-reader user is dropped at the top of the document.`,
          {
            selector: entry.obsBefore.focusSelector || before.cursorSelector || null,
            phrase: entry.obsBefore.phrase,
          },
          entry
        );
      }

      // dialog-not-trapped: Tab escaped an open dialog
      if (cmd === 'tab' || cmd === 'shiftTab') {
        const openBefore = dialogsBefore.filter((d) => d.containsFocus);
        for (const dlg of openBefore) {
          const stillOpen = dialogsAfter.find((d) => d.selector === dlg.selector);
          if (!stillOpen) continue;
          if (!stillOpen.containsFocus) {
            push(
              'dialog-not-trapped',
              `Pressing ${cmd === 'tab' ? 'Tab' : 'Shift+Tab'} moved focus out of the open dialog "${dlg.name || dlg.selector}" while it was still displayed. Focus must stay inside a modal dialog.`,
              { selector: dlg.selector, phrase: entry.obsAfter.phrase },
              entry
            );
          }
        }
      }

      // escape-does-not-close: dialog survived Escape
      if (cmd === 'escape') {
        for (const dlg of dialogsBefore) {
          if (!dlg.modal) continue;
          const stillOpen = dialogsAfter.find((d) => d.selector === dlg.selector);
          if (stillOpen) {
            push(
              'escape-does-not-close',
              `The dialog "${dlg.name || dlg.selector}" is still open after pressing Escape. A keyboard or screen-reader user has no reliable way out.`,
              { selector: dlg.selector, phrase: entry.obsAfter.phrase },
              entry
            );
          }
        }
      }

      // unannounced-change: significant DOM change, nothing spoken, focus stayed put
      if (
        (cmd === 'activate' || cmd === 'type' || cmd === 'escape') &&
        entry.domChanged &&
        !entry.obsAfter.urlChanged &&
        (entry.obsAfter.announcements || []).length === 0 &&
        !focusChanged
      ) {
        const added = (after.mutations && after.mutations.added) || 0;
        const textChanged = !!(before.dom && after.dom && before.dom.text !== after.dom.text);
        if (added >= UNANNOUNCED_MIN_ADDED_NODES || textChanged) {
          push(
            'unannounced-change',
            `"${cmd}" changed the page content but nothing was announced: no live region (aria-live / role="status" / role="alert") reported the update and focus did not move to the new content.`,
            {
              selector: entry.obsBefore.focusSelector || before.cursorSelector || null,
              phrase: entry.obsBefore.phrase,
            },
            entry
          );
        }
      }

      // activation-no-effect: a button/link was activated and NOTHING happened:
      // no navigation, no DOM change, no announcement, no new window and no focus
      // move away from the control itself. For a sighted user such a control may
      // well work (a print dialog, a video that starts); for a screen-reader user
      // the page simply goes silent, so the control is indistinguishable from dead.
      if (cmd === 'activate' && !entry.obsAfter.error) {
        const cursorSelector = entry.obsBefore.focusSelector || before.cursorSelector || null;
        // Focus landing on the activated control itself is not "something happened".
        const focusMovedAway =
          focusChanged && (!focusAfter || focusAfter.selector !== cursorSelector);
        const role = phraseRole(entry.obsBefore.phrase);
        if (
          ACTIONABLE_ROLE_RE.test(role) &&
          !entry.domChanged &&
          !entry.obsAfter.urlChanged &&
          !entry.obsAfter.newPage &&
          (entry.obsAfter.announcements || []).length === 0 &&
          !focusMovedAway
        ) {
          push(
            'activation-no-effect',
            `Activating the ${role.toLowerCase()} "${entry.obsBefore.phrase}" produced no perceivable result: the page did not change, nothing was announced, focus did not move and no new window opened. For a screen-reader user the control appears to do nothing.`,
            { selector: cursorSelector, phrase: entry.obsBefore.phrase },
            entry
          );
        }
      }

      // unnamed-control-used: activated a control whose phrase is role-only
      if (cmd === 'activate') {
        const phrase = (entry.obsBefore.phrase || '').trim();
        const head = phrase.split(',')[0].trim();
        if (phrase && ROLE_ONLY_RE.test(phrase)) {
          push(
            'unnamed-control-used',
            `The control the agent had to activate is announced only as "${head}": it has no accessible name, so a screen-reader user cannot tell what it does.`,
            {
              selector: entry.obsBefore.focusSelector || before.cursorSelector || null,
              phrase,
            },
            entry
          );
        }
      }
    }

    // Page-level barriers collected while walking the site (one report per URL).
    for (const report of this._fragmentation.values()) {
      for (const f of fragmentationFindings(report)) {
        const key = `${f.ruleId}::${(f.nodes[0] && f.nodes[0].selector) || f.meta.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(f);
      }
    }

    return findings;
  }

  /**
   * Analyse the CURRENT page for reading fragmentation and remember the result
   * for `deriveFindings()`. Per page, not per step: the harness calls it once
   * per URL the agent visits. Returns the raw report (or null).
   */
  async checkReadingFragmentation() {
    if (!this.page) return null;
    if (typeof this.page.isClosed === 'function' && this.page.isClosed()) return null;
    const url = this.page.url();
    if (this._fragmentation.has(url)) return this._fragmentation.get(url);
    let report = null;
    try {
      await this._ensureInjected();
      report = await this.page.evaluate(() => window.__SRENV.internals.readingFragmentation());
    } catch (_) {
      return null;
    }
    if (report) this._fragmentation.set(url, report);
    return report;
  }

  async stop() {
    this.page.off('framenavigated', this._onFrameNavigated);
    if (this._onPopup) this.page.off('popup', this._onPopup);
    if (this._browser && this._onTargetCreated && typeof this._browser.off === 'function') {
      this._browser.off('targetcreated', this._onTargetCreated);
    }
    await this._drainPopups().catch(() => {});
    this.started = false;
    try {
      await this.page.evaluate(() => window.__SRENV && window.__SRENV.stop());
    } catch (e) {
      /* page already gone */
    }
  }
}

/**
 * Injects the VSR bundle and the in-page runtime and starts the cursor at
 * document start. Shared with `optimal-path.js` so both see the identical
 * reading order and rotor lists.
 *
 * @param {import('puppeteer').Page} page
 * @param {{force?: boolean}} [options] force = inject even if a runtime is present
 * @returns {Promise<boolean>} true when it (re-)injected
 */
/** How many fragmented elements of one page are reported individually. */
const MAX_FRAGMENTATION_EXAMPLES = 5;

/**
 * Findings from one `readingFragmentation()` report.
 *
 * A page builder that wraps every few words in its own inline element makes the
 * screen reader stutter: one visual line of a heading comes out as five
 * separate phrases ("Information gem." / "§ 5" / "ECG undOffenlegung gem." /
 * "§ 25" / "MedienG"). Sighted users see one sentence; screen-reader users hear
 * shrapnel and cannot tell what belongs together, which is exactly what
 * "information and relationships" and "meaningful sequence" are about.
 * Reported per element for a single line broken into >= 3 spoken pieces, and
 * once for the page when the whole page averages >= 2.5 pieces per element.
 */
function fragmentationFindings(report) {
  if (!report) return [];
  const def = FINDING_DEFS['reading-fragmentation'];
  const base = {
    scannerId: 'sr-agent-env',
    ruleId: 'reading-fragmentation',
    type: 'reading-fragmentation',
    impact: def.impact,
    severity: def.severity,
    helpUrl: def.help,
    wcagCriteria: def.wcag,
  };
  const out = [];
  const flagged = (report.elements || []).filter((e) => e.flagged);
  for (const el of flagged.slice(0, MAX_FRAGMENTATION_EXAMPLES)) {
    out.push({
      ...base,
      description:
        `The <${el.tag}> is rendered as one line of text but the screen reader speaks it as ` +
        `${el.count} separate phrases: ${el.phrases.map((p) => `"${p}"`).join(' / ')}. ` +
        'The text is split across inline elements, so a screen-reader user hears fragments ' +
        'instead of one sentence and has to reassemble them.',
      nodes: [{ selector: el.selector, phrase: el.phrases.join(' / ') }],
      meta: {
        url: report.url,
        fragments: el.count,
        phrases: el.phrases,
        height: el.height,
        lineHeight: el.lineHeight,
      },
    });
  }
  if (report.pageFlagged) {
    const examples = (report.elements || []).slice(0, MAX_FRAGMENTATION_EXAMPLES);
    out.push({
      ...base,
      description:
        `Across this page the screen reader speaks ${report.fragmentCount} separate phrases for ` +
        `${report.elementCount} headings, paragraphs and list items (${report.ratio.toFixed(1)} per ` +
        'element). The text of nearly every block is split into several spoken pieces, so the ' +
        'whole page is heard as fragments rather than as sentences. Example: ' +
        examples
          .slice(0, 2)
          .map((e) => `<${e.tag}> "${e.phrases.join(' / ')}"`)
          .join('; '),
      nodes: examples.map((e) => ({ selector: e.selector, phrase: e.phrases.join(' / ') })),
      meta: {
        url: report.url,
        scope: 'page',
        ratio: report.ratio,
        elementCount: report.elementCount,
        fragmentCount: report.fragmentCount,
      },
    });
  }
  return out;
}

async function injectScreenReader(page, options = {}) {
  if (!options.force) {
    const alive = await page
      .evaluate(() => !!(window.__SRENV && window.__SRENV.ready && window.__VSR))
      .catch(() => false);
    if (alive) return false;
  }
  await page.evaluate(vsrSource());
  await page.evaluate(`(${srenvRuntime.toString()})()`);
  await page.evaluate(() => window.__SRENV.start());
  return true;
}

/**
 * Every phrase the screen reader speaks on this page, in reading order.
 *
 * The one place that answers "would a screen-reader user ever HEAR this text?".
 * Injects the VSR if it is not there yet and walks the reading order once, so
 * the generator verifies evidence against the same phrases the harness and
 * `optimal-path.js` later match against.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<string[]>} spoken phrases, empty when nothing could be read
 */
async function collectSpokenPhrases(page) {
  await injectScreenReader(page);
  const phrases = await page.evaluate(async () => {
    const order = await window.__SRENV.internals.readingOrder();
    return order.map((entry) => String(entry.phrase == null ? '' : entry.phrase));
  });
  return (phrases || []).filter((p) => p.trim() !== '');
}

module.exports = ScreenReaderEnv;
module.exports.ScreenReaderEnv = ScreenReaderEnv;
module.exports.injectScreenReader = injectScreenReader;
module.exports.collectSpokenPhrases = collectSpokenPhrases;
module.exports.srenvRuntime = srenvRuntime;
module.exports.vsrSource = vsrSource;
module.exports.COMMAND_TYPES = COMMAND_TYPES;
module.exports.COMMAND_COSTS = COMMAND_COSTS;
module.exports.commandCost = commandCost;
module.exports.LEVELLED_STEP_COMMANDS = LEVELLED_STEP_COMMANDS;
module.exports.ROTOR_PAGE_SIZE = ROTOR_PAGE_SIZE;
module.exports.MARK_KINDS = MARK_KINDS;
module.exports.wordCount = wordCount;
module.exports.normalizeMark = normalizeMark;
module.exports.ROTOR_KINDS = ROTOR_KINDS;
module.exports.ROTOR_STEP_COMMANDS = ROTOR_STEP_COMMANDS;
module.exports.ROTOR_STEP_TYPES = ROTOR_STEP_TYPES;
module.exports.FREE_COMMANDS = FREE_COMMANDS;
module.exports.FINDING_DEFS = FINDING_DEFS;
module.exports.fragmentationFindings = fragmentationFindings;
module.exports.phraseRole = phraseRole;
