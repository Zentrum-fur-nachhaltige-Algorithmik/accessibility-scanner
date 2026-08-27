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

const ROTOR_KINDS = ['headings', 'landmarks', 'links', 'formFields'];

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
};
const ROTOR_STEP_TYPES = Object.keys(ROTOR_STEP_COMMANDS);

/** Commands that do not cost a step. */
const FREE_COMMANDS = new Set(['repeat']);

const COMMAND_TYPES = [
  'next',
  'prev',
  'tab',
  'shiftTab',
  'headings',
  'landmarks',
  'links',
  'formFields',
  'jumpTo',
  ...ROTOR_STEP_TYPES,
  'activate',
  'type',
  'escape',
  'done',
  'repeat',
];
/** Commands whose implementation walks the whole reading order internally. */
const WALKING_COMMANDS = new Set([...ROTOR_KINDS, 'jumpTo', ...ROTOR_STEP_TYPES]);

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
  };

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

  const state = {
    ready: false,
    announcements: [],
    lastRotor: null,
    mutations: { added: 0, removed: 0, changed: 0 },
    liveSeen: new Map(),
  };

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
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

  /**
   * Walks the VSR reading order once and returns [{ node, phrase }].
   * Walking a full cycle leaves the cursor exactly where it started.
   */
  async function readingOrder() {
    const firstNode = virtual.activeNode;
    const firstPhrase = await virtual.lastSpokenPhrase();
    const entries = [{ node: firstNode, phrase: firstPhrase }];
    for (let i = 0; i < MAX_WALK; i++) {
      await virtual.next();
      const node = virtual.activeNode;
      const phrase = await virtual.lastSpokenPhrase();
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
    return false;
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
      items.push({
        index: items.length,
        phrase: entry.phrase,
        selector: selectorFor(el),
      });
    }
    state.lastRotor = { kind, items, nodes };
    return {
      kind,
      items: items.map((i) => ({ index: i.index, phrase: i.phrase, selector: i.selector })),
    };
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
   * @returns {Promise<boolean>} false when the document has no element of `kind`
   */
  async function stepToKind(kind, dir) {
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

  /** Moves the VSR cursor forward (wrapping) until it lands on `target`. */
  async function moveCursorTo(target) {
    if (elementOf(virtual.activeNode) === target) return true;
    for (let i = 0; i < MAX_WALK; i++) {
      await virtual.next();
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
          await virtual.next();
          break;
        case 'prev':
          await virtual.previous();
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
          rotor = await buildRotor(type);
          break;
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
          // Nothing to do: `snapshot()` re-reads lastSpokenPhrase. Free command.
          break;
        default: {
          const step = STEP_COMMANDS[type];
          if (!step) {
            error = 'unknown command: ' + JSON.stringify(type);
            break;
          }
          const found = await stepToKind(step.kind, step.dir);
          if (!found) error = 'no ' + step.label;
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
      phrase: await virtual.lastSpokenPhrase(),
      focus: focusInfo(),
      dialogs: openDialogs(),
      dom: domSignature(),
      url: location.href,
      cursorSelector: selectorFor(virtual.activeNode),
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
      buildRotor,
      selectorFor,
      elementOf,
      matchesKind,
      isVisible,
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
};

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
    this.started = false;
    this._injected = false;
    this._lastUrl = null;

    this._onFrameNavigated = (frame) => {
      if (frame === this.page.mainFrame()) this._injected = false;
    };
    this.page.on('framenavigated', this._onFrameNavigated);
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
   * formFields (rotor list into obs.rotor), jumpTo arg:index (entry of the last
   * rotor list); nextHeading/prevHeading, nextLink/prevLink, nextFormField/
   * prevFormField, nextLandmark/prevLandmark (quick navigation, wraps around; an
   * empty kind leaves the cursor put and sets `error: 'no <kind>'`); activate,
   * type arg:text, escape; done (recorded only); repeat (re-emits the last phrase,
   * trace entry and observation flagged `free: true`).
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

    // Free commands (`repeat`) change no state, so they neither consume budget
    // nor advance `stepCount`. They are still recorded in the trace (flagged
    // `free: true`) because they are part of what the user did.
    if (FREE_COMMANDS.has(command.type)) {
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
      };
      this.trace.push({
        step: this.stepCount,
        cmd: { type: command.type, arg: command.arg },
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

    this.stepCount += 1;

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
    if (result.error) obs.error = result.error;

    this.phrases.push(obs.phrase);
    this._lastUrl = url;

    this.trace.push({
      step: this.stepCount,
      cmd: { type: command.type, arg: command.arg },
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

    return findings;
  }

  async stop() {
    this.page.off('framenavigated', this._onFrameNavigated);
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

module.exports = ScreenReaderEnv;
module.exports.ScreenReaderEnv = ScreenReaderEnv;
module.exports.injectScreenReader = injectScreenReader;
module.exports.srenvRuntime = srenvRuntime;
module.exports.vsrSource = vsrSource;
module.exports.COMMAND_TYPES = COMMAND_TYPES;
module.exports.ROTOR_KINDS = ROTOR_KINDS;
module.exports.ROTOR_STEP_COMMANDS = ROTOR_STEP_COMMANDS;
module.exports.ROTOR_STEP_TYPES = ROTOR_STEP_TYPES;
module.exports.FREE_COMMANDS = FREE_COMMANDS;
module.exports.FINDING_DEFS = FINDING_DEFS;
