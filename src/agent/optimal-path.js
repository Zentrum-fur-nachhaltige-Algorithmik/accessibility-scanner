/**
 * optimal-path: `n_opt`, the shortest screen-reader command sequence for a task.
 * One in-page reading-order walk per page state builds the command graph of that
 * page (see page-graph.js); Dijkstra over it prices the cheapest route to the
 * target of each sighted-path step, and only the action edges are executed for
 * real. Deterministic, no LLM.
 * Score: `R = n_opt / n_sr`, capped at 1.
 */

'use strict';

const { injectScreenReader, ROTOR_KINDS } = require('./screenreader-env');
const {
  buildPageGraph,
  shortestPaths,
  reachGoals,
  strategyCosts,
  STEP_COMMAND_BY_KIND,
} = require('./page-graph');

/**
 * Reach strategies, in tie-break preference order. Only `chooseReach` still uses
 * it; the graph breaks ties by the order it emits its edges in.
 */
const STRATEGY_ORDER = [
  'none',
  'step',
  'stepLevel',
  'rotor',
  'step+next',
  'stepLevel+next',
  'rotor+next',
  'tab',
  'shiftTab',
  'find',
  'find+next',
  'next',
  'prev',
];

/**
 * Words the OPTIMUM may search for: whole words of at least this many letters
 * taken from the TASK DESCRIPTION and its `keywords`, minus the generator's
 * stopwords. The optimum must not use knowledge the user does not have, and
 * description plus keywords are everything the user was told; a real user
 * searching for a word they read in their task is exactly what this models.
 */
const MIN_FIND_WORD = 4;
/** Cap on the searchable words, so the analysis stays linear in practice. */
const MAX_FIND_WORDS = 12;

/**
 * Action cost of one sighted-path step, once the target has been reached.
 * `read` costs 0: for an information task, hearing the phrase IS the goal, so
 * the cursor arriving on it already completes the task - there is no further
 * keystroke to pay for.
 */
const ACTION_COST = { click: 1, type: 1, press: 1, goto: 1, read: 0 };

/** Whitespace-normalised, case-insensitive comparison form (Node + in-page). */
const squashText = (s) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Reported as `optimalPathError` when no spoken phrase contains the evidence. */
const EVIDENCE_NOT_IN_READING_ORDER = 'evidence-not-in-reading-order';

/** Cap on how many matching reading-order phrases are costed. */
const MAX_READ_CANDIDATES = 50;

/**
 * How many consecutive spoken phrases may be joined before the evidence counts
 * as heard. The screen reader speaks NODES, not sentences, so an answer can be
 * split over neighbouring nodes ("Ordinationszeiten" / "Mo: 12h30 - 18h30").
 * A single phrase stays the primary match; a run of up to this many phrases
 * costs the extra `next` presses it takes to hear them all.
 */
const MAX_EVIDENCE_PHRASE_SPAN = 3;

/**
 * One in-page description of the current page: everything the command graph is
 * built from. Runs in the browser; uses window.__SRENV.internals, so the reading
 * order, the rotor lists and the quick-nav sets are the env's own.
 *
 * The reading order is CYCLIC and starts wherever the VSR cursor happens to be,
 * so it is rotated to document start: index 0 is document start for every
 * caller, which makes the description independent of the cursor and therefore
 * cacheable (in the page under `window.__OPT_PAGE_DESC`, keyed by run id and
 * DOM fingerprint, and across pages and contexts by the caller, see
 * `options.analysisCache` of `computeOptimalPath`).
 */
/* istanbul ignore next -- runs in the browser */
async function describePageInPage(kinds, opts) {
  const I = window.__SRENV.internals;
  const options = opts || {};
  const findWords = options.findWords || [];

  const fingerprintOf = () => {
    const values = Array.prototype.map
      .call(document.querySelectorAll('input, select, textarea'), (el) => {
        if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
        return typeof el.value === 'string' ? el.value : '';
      })
      .join('');
    const SEP = String.fromCharCode(1);
    const material =
      location.href + SEP + (document.body ? document.body.innerHTML : '') + SEP + values;
    let h = 0x811c9dc5;
    for (let i = 0; i < material.length; i += 1) {
      h ^= material.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return location.href + '#' + h.toString(16) + '#' + material.length;
  };

  const cacheKey = options.fingerprint || fingerprintOf();
  const holder = window.__OPT_PAGE_DESC;
  if (holder && holder.runId === options.runId && holder.key === cacheKey) {
    return Object.assign({}, holder.data, { cacheHit: true });
  }

  // One walk of the VSR reading order, rotated so that index 0 is document start.
  const order = await I.readingOrder();
  const N = order.length;
  const walked = order.map((e) => I.elementOf(e.node));
  let start = 0;
  for (let i = 0; i < N; i += 1) {
    const node = order[i].node;
    if (node === document || node === document.body || node === document.documentElement) {
      start = i;
      break;
    }
  }

  const els = [];
  const phrases = [];
  const selectors = [];
  const hrefs = [];
  for (let i = 0; i < N; i += 1) {
    const j = (i + start) % N;
    const el = walked[j];
    els.push(el);
    phrases.push(order[j].phrase);
    selectors.push(el ? I.selectorFor(el) : null);
    hrefs.push(el && el.matches && el.matches('a[href], area[href]') ? el.href : null);
  }

  const firstStop = new Map();
  for (let i = 0; i < N; i += 1) {
    const el = els[i];
    if (el && !firstStop.has(el)) firstStop.set(el, i);
  }
  const stopOf = (el) => (firstStop.has(el) ? firstStop.get(el) : -1);

  // Rotor lists come from the env's own `buildRotor`, so the entries here are
  // exactly the ones `jumpTo` can reach. `buildRotor` only RETURNS the first
  // page of its list, so the full list is rebuilt from its nodes.
  const rotors = {};
  for (const kind of kinds) {
    await I.buildRotor(kind);
    const nodes = I.getLastRotorNodes().slice();
    const items = [];
    const stops = [];
    for (const el of nodes) {
      const stop = stopOf(el);
      const phrase = stop >= 0 ? phrases[stop] : null;
      items.push({
        phrase,
        selector: I.selectorFor(el),
        level: kind === 'headings' ? I.headingLevelOf(el) : null,
        letter: I.foldText(I.rotorLabel(phrase)).slice(0, 1),
      });
      stops.push(stop);
    }
    rotors[kind] = { items, stops };
  }

  // tab order
  const FOCUSABLE =
    'a[href], area[href], button, input, select, textarea, summary, iframe, object,' +
    ' embed, audio[controls], video[controls], [contenteditable], [tabindex]';
  const focusables = Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), (el) => {
    if (el.disabled) return false;
    if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && Number(ti) < 0) return false;
    if (!I.isVisible(el)) return false;
    // A hidden ancestor takes the element out of the tab order, too.
    if (!el.getClientRects().length) return false;
    return true;
  });
  // Positive tabindex first (ascending, document order within a value), then
  // everything else in document order: the browser's tab sequence.
  const positive = focusables
    .filter((el) => Number(el.getAttribute('tabindex')) > 0)
    .sort((a, b) => Number(a.getAttribute('tabindex')) - Number(b.getAttribute('tabindex')));
  const rest = focusables.filter((el) => !(Number(el.getAttribute('tabindex')) > 0));
  const tabOrder = positive.concat(rest);
  const tabIndexOf = new Map();
  tabOrder.forEach((el, t) => tabIndexOf.set(el, t));

  // How many tab stops precede an element in document order. A stop that is not
  // itself focusable sits BETWEEN two tab stops, which is modelled as
  // `index - 0.5`: one Tab reaches the following stop, one Shift+Tab the
  // preceding one.
  const passed = new Map();
  let seenTabStops = 0;
  const allElements = document.querySelectorAll('*');
  for (let i = 0; i < allElements.length; i += 1) {
    const el = allElements[i];
    passed.set(el, seenTabStops);
    if (tabIndexOf.has(el)) seenTabStops += 1;
  }

  const tabPos = els.map((el) => {
    if (!el) return null;
    if (tabIndexOf.has(el)) return tabIndexOf.get(el);
    return passed.has(el) ? passed.get(el) - 0.5 : null;
  });

  const folded = phrases.map((p) => I.foldText(p));
  const findHits = {};
  for (const word of findWords) {
    const w = I.foldText(word);
    if (!w) continue;
    const hits = [];
    for (let i = 0; i < N; i += 1) if (folded[i].includes(w)) hits.push(i);
    if (hits.length) findHits[word] = hits;
  }

  const desc = {
    n: N,
    url: location.href,
    fingerprint: cacheKey,
    phrases,
    selectors,
    hrefs,
    rotors,
    rotorPageSize: I.rotorPageSize || 8,
    tabStops: tabOrder.map((el) => stopOf(el)),
    tabSelectors: tabOrder.map((el) => I.selectorFor(el)),
    tabPos,
    findHits,
  };
  window.__OPT_PAGE_DESC = { runId: options.runId, key: cacheKey, data: desc };
  return Object.assign({}, desc, { cacheHit: false });
}

/**
 * The same cheap page fingerprint `describePageInPage` uses, as a standalone
 * in-page function: url + hash of the body markup + all form-control values. Two
 * pages with the same fingerprint produce the same description, which is what
 * makes it cacheable across browser contexts. No reading-order walk, so it is
 * cheap enough to run before every step.
 */
/* istanbul ignore next -- runs in the browser */
function pageFingerprint() {
  const values = Array.prototype.map
    .call(document.querySelectorAll('input, select, textarea'), (el) => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
      return typeof el.value === 'string' ? el.value : '';
    })
    .join('');
  const SEP = String.fromCharCode(1);
  const material =
    location.href + SEP + (document.body ? document.body.innerHTML : '') + SEP + values;
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return location.href + '#' + h.toString(16) + '#' + material.length;
}

/**
 * The effect-equivalence class of one sighted step's target, and where the
 * cursor stands, both as selectors the page description can be matched against.
 * Links resolving to the same URL, the other submit controls of the same form
 * plus Enter in an already filled text field of it, and buttons with the same
 * accessible name in the same form or dialog container. Only the sighted step is
 * ever executed; equivalents are priced, never clicked.
 *
 * No reading-order walk, so this runs per step even when the description is
 * served from a cache.
 */
/* istanbul ignore next -- runs in the browser */
function resolveTargetsInPage(opts) {
  const I = window.__SRENV.internals;
  const options = opts || {};
  const targetSelector = options.targetSelector || null;
  const typedSelectors = options.typedSelectors || [];
  const action = options.action || 'click';
  const key = options.key || null;

  const cursorEl = options.cursorSelector ? document.querySelector(options.cursorSelector) : null;
  const cursor = cursorEl ? I.selectorFor(cursorEl) : null;
  if (!targetSelector) return { cursor, members: [] };

  const target = document.querySelector(targetSelector);
  if (!target) return { cursor, error: 'target not found: ' + targetSelector };

  const SUBMITTABLE = 'button, input[type="submit"], input[type="image"]';
  const TEXTFIELD =
    'input:not([type]), input[type="text"], input[type="search"], input[type="email"],' +
    ' input[type="url"], input[type="tel"], input[type="password"], input[type="number"],' +
    ' textarea, [contenteditable=""], [contenteditable="true"],' +
    ' [role="textbox"], [role="searchbox"]';
  const BUTTONISH =
    'button, input[type="submit"], input[type="button"], input[type="reset"],' +
    ' input[type="image"], [role="button"]';

  const isSubmitControl = (el) => {
    if (!el.matches || !el.matches(SUBMITTABLE)) return false;
    if (el.tagName === 'INPUT') return ['submit', 'image'].includes((el.type || '').toLowerCase());
    return (el.getAttribute('type') || 'submit').toLowerCase() === 'submit';
  };
  const accName = (el) => {
    const byLabel = el.getAttribute && el.getAttribute('aria-label');
    let name = byLabel || '';
    if (!name && el.getAttribute && el.getAttribute('aria-labelledby')) {
      name = el
        .getAttribute('aria-labelledby')
        .split(/\s+/)
        .map((id) => {
          const n = document.getElementById(id);
          return n ? n.textContent : '';
        })
        .join(' ');
    }
    if (!name) name = el.tagName === 'INPUT' ? el.value || '' : el.textContent || '';
    if (!name && el.getAttribute) name = el.getAttribute('title') || '';
    return name.replace(/\s+/g, ' ').trim().toLowerCase();
  };
  const containerOf = (el) => (el.closest ? el.closest('form, dialog, [role="dialog"]') : null);
  const urlKeyOf = (el) => {
    try {
      const u = new URL(el.href, location.href);
      const raw = el.getAttribute('href') || '';
      const hasFragment = /#./.test(raw) || (u.hash && u.hash !== '#');
      return u.origin + u.pathname + u.search + (hasFragment ? u.hash : '');
    } catch (e) {
      return null;
    }
  };

  const members = [{ el: target, via: 'target' }];
  const addMember = (el, via) => {
    if (!el || el === target) return;
    if (!I.isVisible(el)) return;
    if (members.some((m) => m.el === el)) return;
    members.push({ el, via });
  };

  const equivalenceEligible = action === 'click' || (action === 'press' && key === 'Enter');
  if (equivalenceEligible) {
    // links with the same resolved href
    if (target.matches('a[href], area[href], [role="link"][href]')) {
      const key0 = urlKeyOf(target);
      if (key0) {
        const all = document.querySelectorAll('a[href], area[href], [role="link"][href]');
        Array.prototype.forEach.call(all, (el) => {
          if (urlKeyOf(el) === key0) addMember(el, 'same-href');
        });
      }
    }

    // form submission: other submit controls + Enter in a filled text field
    const form = target.closest ? target.closest('form') : null;
    if (form && isSubmitControl(target)) {
      Array.prototype.forEach.call(form.querySelectorAll(SUBMITTABLE), (el) => {
        if (isSubmitControl(el)) addMember(el, 'same-form-submit');
      });
      Array.prototype.forEach.call(form.querySelectorAll(TEXTFIELD), (el) => {
        const sel = I.selectorFor(el);
        const filled =
          typedSelectors.indexOf(sel) !== -1 ||
          (typeof el.value === 'string' && el.value.trim() !== '') ||
          (el.isContentEditable && String(el.textContent || '').trim() !== '');
        if (filled) addMember(el, 'enter-in-field');
      });
    }

    // buttons: same accessible name inside the same form / dialog container
    if (target.matches(BUTTONISH)) {
      const name = accName(target);
      const cont = containerOf(target);
      if (name) {
        Array.prototype.forEach.call(document.querySelectorAll(BUTTONISH), (el) => {
          if (accName(el) === name && containerOf(el) === cont) addMember(el, 'same-name-button');
        });
      }
    }
  }

  return {
    cursor,
    targetHref: target.matches('a[href], area[href]') ? target.href : null,
    members: members.map((m) => ({
      selector: m.el === target ? I.selectorFor(target) : I.selectorFor(m.el),
      sightedSelector: m.el === target ? targetSelector : null,
      isTarget: m.el === target,
      via: m.via,
      href: m.el.matches && m.el.matches('a[href], area[href]') ? m.el.href : null,
    })),
  };
}

/**
 * Rendered links of the current page with their resolved href. Used by the task
 * generator to shorten a sighted path; the optimum reads the links straight out
 * of the page description. Uses the shared in-page helpers so the selectors are
 * the ones `replay.executeStep` can replay.
 */
/* istanbul ignore next -- runs in the browser */
function collectLinksInPage() {
  const H = window.__A11YH;
  const out = [];
  const links = document.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i += 1) {
    const el = links[i];
    if (!H.isVisible(el)) continue;
    const selector = H.selectorFor(el);
    if (!selector || !el.href) continue;
    out.push({ selector, href: el.href, name: H.accName(el) });
  }
  return out;
}

/**
 * The rendered links of `page` whose resolved href satisfies `matches`, in
 * document order, with a selector `replay.executeStep` can click.
 */
async function findDirectLinks(page, matches) {
  const { ensureHelpers } = require('./dom-helpers');
  await ensureHelpers(page);
  let links;
  try {
    links = await page.evaluate(collectLinksInPage);
  } catch (_) {
    return [];
  }
  return (links || []).filter((l) => matches(l.href));
}

// Node side

/** Every `urlMatches` pattern the oracle requires; negated branches are ignored. */
function urlPatternsOf(spec, out = []) {
  if (!spec || typeof spec !== 'object' || spec.type === 'not') return out;
  if (spec.type === 'urlMatches' && typeof spec.pattern === 'string') out.push(spec.pattern);
  if (Array.isArray(spec.of)) for (const sub of spec.of) urlPatternsOf(sub, out);
  return out;
}

/** Origin + path + query, lowercased, without a trailing slash or a fragment. */
function normaliseUrl(href) {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch (_) {
    return String(href == null ? '' : href).toLowerCase();
  }
}

/**
 * Does a URL already satisfy what the task is after? Either it is the URL the
 * sighted path ends on (recorded during validation, `options.targetUrl`) or it
 * matches every `urlMatches` the oracle requires. Returns null when the task
 * names no URL target at all - then there is no shortcut to look for.
 */
function targetMatcherFor(task, options = {}) {
  const patterns = urlPatternsOf(task && task.oracle)
    .map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
  const targetUrl =
    typeof options.targetUrl === 'string' && options.targetUrl
      ? normaliseUrl(options.targetUrl)
      : null;
  if (!patterns.length && !targetUrl) return null;
  return (href) => {
    if (targetUrl && normaliseUrl(href) === targetUrl) return true;
    return patterns.length > 0 && patterns.every((re) => re.test(href));
  };
}

/**
 * The words the optimum is allowed to search for: the content words of the task
 * DESCRIPTION and of its `keywords` (at least `MIN_FIND_WORD` letters, no
 * stopwords), folded like the env's `find`. The agent may search for anything it
 * likes; the optimum may only use what the user was told, so it never buys a
 * shortcut with knowledge of the page.
 */
function findWordsFor(task) {
  // Lazily required: task-generator pulls in replay, which pulls in this module.
  const { STOPWORDS } = require('./task-generator');
  const keywords = Array.isArray(task && task.keywords) ? task.keywords : [];
  const source = [String((task && task.description) || ''), ...keywords].join(' ');
  const words = [];
  const seen = new Set();
  for (const raw of source.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_FIND_WORD) continue;
    if (!/\p{L}/u.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    words.push(raw);
    if (words.length >= MAX_FIND_WORDS) break;
  }
  return words;
}

/**
 * The literal env commands a chosen reach costs. The graph names every edge, so
 * the commands come with the reach; the switch serves the callers that still
 * build a reach from a per-strategy analysis (bfs-optimum.js).
 *
 * The commands add up to `reach.cost` when each is charged with
 * `screenreader-env.commandCost` (one per command, two for `find`); that
 * identity lets `nOpt` be reported as a keystroke list (Blind Mode's optimal
 * route).
 */
function reachCommands(reach) {
  if (reach && Array.isArray(reach.commands)) return reach.commands;
  const repeat = (type, n) => Array.from({ length: n }, () => ({ type }));
  switch (reach.strategy) {
    case 'none':
      return [];
    case 'rotor':
    case 'rotor+next':
      return [
        { type: reach.via.kind },
        ...(reach.via.letter
          ? [{ type: 'rotorLetter', arg: reach.via.letter }]
          : Array.from({ length: reach.via.pages || 0 }, () => ({ type: 'more' }))),
        { type: 'jumpTo', arg: reach.via.index },
        ...repeat('next', reach.via.k || 0),
      ];
    case 'step':
      return repeat(reach.via.command, reach.via.steps);
    case 'step+next':
      return [...repeat(reach.via.command, reach.via.steps), ...repeat('next', reach.via.k)];
    case 'stepLevel':
    case 'stepLevel+next':
      return [
        ...Array.from({ length: reach.via.steps }, () => ({
          type: reach.via.command,
          arg: reach.via.level,
        })),
        ...repeat('next', reach.via.k),
      ];
    case 'find':
    case 'find+next':
      return [
        { type: 'find', arg: reach.via.word },
        ...repeat('findNext', reach.via.findNexts),
        ...repeat('next', reach.via.k),
      ];
    case 'tab':
      return repeat('tab', reach.cost);
    case 'shiftTab':
      return repeat('shiftTab', reach.cost);
    case 'next':
      return repeat('next', reach.cost);
    case 'prev':
      return repeat('prev', reach.cost);
    /* istanbul ignore next -- chooseReach returns nothing else */
    default:
      return null;
  }
}

/**
 * Picks the cheapest of a per-strategy analysis. Only bfs-optimum.js still
 * produces such an analysis; the guided optimum takes shortest paths instead.
 */
function chooseReach(analysis) {
  const candidates = [];
  if (analysis.inReadingOrder && analysis.next === 0) {
    candidates.push({ strategy: 'none', cost: 0 });
  } else {
    if (analysis.rotor) {
      const r = analysis.rotor;
      candidates.push({
        strategy: r.k === 0 ? 'rotor' : 'rotor+next',
        cost: r.cost,
        via: {
          kind: r.kind,
          index: r.index,
          k: r.k,
          pages: r.pages || 0,
          letter: r.letter || null,
          phrase: r.phrase,
          selector: r.selector,
        },
      });
    }
    if (analysis.step) {
      const s = analysis.step;
      candidates.push({
        strategy: s.k === 0 ? 'step' : 'step+next',
        cost: s.cost,
        via: { kind: s.kind, dir: s.dir, command: s.command, steps: s.steps, k: s.k },
      });
    }
    if (analysis.stepLevel) {
      const s = analysis.stepLevel;
      candidates.push({
        strategy: s.k === 0 ? 'stepLevel' : 'stepLevel+next',
        cost: s.cost,
        via: {
          kind: s.kind,
          level: s.level,
          dir: s.dir,
          command: s.command,
          steps: s.steps,
          k: s.k,
        },
      });
    }
    if (analysis.find) {
      const f = analysis.find;
      candidates.push({
        strategy: f.k === 0 ? 'find' : 'find+next',
        cost: f.cost,
        via: { word: f.word, findNexts: f.findNexts, k: f.k },
      });
    }
    if (analysis.tab) {
      candidates.push({ strategy: analysis.tab.dir, cost: analysis.tab.cost });
    }
    if (analysis.inReadingOrder) {
      if (analysis.next !== null) candidates.push({ strategy: 'next', cost: analysis.next });
      if (analysis.prev !== null) candidates.push({ strategy: 'prev', cost: analysis.prev });
    }
  }
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      a.cost - b.cost || STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy)
  );
  return candidates[0];
}

/**
 * The nodes of the command graph that belong to `selector`: every reading-order
 * stop of the element, plus its tab stop when the reading order never visits it
 * (an element outside the reading order is reachable by Tab and nothing else).
 */
function nodesForSelector(graph, selector) {
  if (!selector) return [];
  const desc = graph.desc;
  const nodes = [];
  for (let i = 0; i < desc.n; i += 1) if (desc.selectors[i] === selector) nodes.push(i);
  if (!nodes.length) {
    (desc.tabSelectors || []).forEach((sel, t) => {
      if (sel === selector) nodes.push(graph.tabNode[t]);
    });
  }
  return nodes;
}

/** Every reading-order stop of a link whose resolved href matches `href`. */
function nodesForHref(graph, href) {
  const key = normaliseUrl(href);
  const desc = graph.desc;
  const nodes = [];
  for (let i = 0; i < desc.n; i += 1) {
    if (desc.hrefs[i] && normaliseUrl(desc.hrefs[i]) === key) nodes.push(i);
  }
  return nodes;
}

/**
 * The reading-order stops whose spoken phrase carries `evidence`. Only when no
 * single phrase does, a run of up to `maxSpan` phrases spoken one after the
 * other counts as well, with the extra `next` presses as `extra`.
 */
function evidenceGoals(desc, evidence, maxSpan = MAX_EVIDENCE_PHRASE_SPAN) {
  const needle = squashText(evidence);
  if (!needle) return [];
  const squashed = desc.phrases.map(squashText);
  const goals = [];
  for (let i = 0; i < desc.n && goals.length < MAX_READ_CANDIDATES; i += 1) {
    if (!squashed[i].includes(needle)) continue;
    goals.push({ node: i, extra: 0, spanPhrases: 1, phrase: desc.phrases[i] });
  }
  if (goals.length || maxSpan <= 1) return goals;
  for (let i = 0; i < desc.n && goals.length < MAX_READ_CANDIDATES; i += 1) {
    let joined = squashed[i];
    let raw = String(desc.phrases[i] == null ? '' : desc.phrases[i]);
    for (let w = 2; w <= maxSpan && i + w <= desc.n; w += 1) {
      const next = desc.phrases[i + w - 1];
      joined = `${joined} ${squashed[i + w - 1]}`;
      raw = `${raw} ${next == null ? '' : next}`;
      if (joined.includes(needle)) {
        goals.push({ node: i, extra: w - 1, spanPhrases: w, phrase: raw });
        break;
      }
    }
  }
  return goals;
}

/**
 * Describe the page the browser is on and build its command graph as seen from
 * the current cursor. One reading-order walk per page state; the description is
 * served from `shared` (the caller's per-site cache) whenever the page has the
 * same fingerprint, the graph and the Dijkstra run are pure Node.
 */
async function loadPageState(page, { runId, findWords, shared, cursorSelector, targets }) {
  await injectScreenReader(page);

  let resolved = { cursor: null, members: [] };
  try {
    resolved = await page.evaluate(resolveTargetsInPage, {
      targetSelector: (targets && targets.selector) || null,
      cursorSelector,
      action: (targets && targets.action) || 'click',
      key: (targets && targets.key) || null,
      typedSelectors: (targets && targets.typedSelectors) || [],
    });
  } catch (err) {
    return { error: `page analysis failed: ${err.message}` };
  }
  if (resolved.error) return { error: resolved.error };

  let sharedKey = null;
  if (shared) {
    try {
      const fingerprint = await page.evaluate(pageFingerprint);
      sharedKey = JSON.stringify([fingerprint, findWords]);
    } catch (_) {
      sharedKey = null; // cache miss; the walk below runs as usual
    }
  }

  let desc =
    sharedKey && shared.has(sharedKey) ? { ...shared.get(sharedKey), cacheHit: true } : null;
  if (!desc) {
    try {
      desc = await page.evaluate(describePageInPage, ROTOR_KINDS, { runId, findWords });
    } catch (err) {
      return { error: `page analysis failed: ${err.message}` };
    }
    if (sharedKey) shared.set(sharedKey, desc);
  }

  const cursorNodes = nodesForSelector({ desc, tabNode: [] }, resolved.cursor);
  // A cursor on an element that left the reading order (a dismissed banner)
  // maps to document start, which is index 0 of the rotated description.
  const cursor = cursorNodes.length ? cursorNodes[0] : 0;
  const graph = buildPageGraph(desc, { cursor, findWords });
  return { desc, graph, cursor, sp: shortestPaths(graph, cursor), resolved, url: page.url() };
}

/** The diagnostics a step reports beside its reach: what one strategy alone costs. */
function analysisOf(state, goals) {
  return {
    cursorIndex: state.cursor,
    docStartIndex: 0,
    readingOrderLength: state.desc.n,
    cacheHit: !!state.desc.cacheHit,
    ...strategyCosts(state.graph, state.cursor, goals),
  };
}

/**
 * Compute the shortest screen-reader command sequence for a task's sighted path.
 *
 * The page must be freshly navigated to the task URL with the task's
 * preconditions already applied: the same state 0 the SR agent gets. The steps
 * of the sighted path are WAYPOINTS: each one is priced on the page state it was
 * taken from as reach + action (click/type/press/goto = 1; goto has no reach
 * cost and resets the cursor), where the reach is the shortest path in that
 * page's command graph to the cheapest member of the step's effect-equivalence
 * class. Every step is executed for real (`replay.executeStep`) after it has
 * been costed, so the next one is costed against the real DOM.
 *
 * The waypoints form a DAG, not a chain. A sighted agent that wandered through a
 * menu makes the guided route longer than the page really is, so a waypoint may
 * be reached from an EARLIER page whenever a link there leads to the same place
 * (the same resolved href, which is the same effect-equivalence class) and every
 * waypoint in between only followed a link to another page. `nOpt` is the
 * shortest path through that DAG; `route` is 'dag' when it skipped a waypoint
 * and 'guided' when it took them all, `skipped` lists the ones it left out and
 * `guidedNOpt` is what the plain chain would have cost.
 *
 * For an information task the goal is not the last page but HEARING the answer:
 * the goal set is every reading-order stop whose spoken phrase carries
 * `task.evidence`, on every page along the route including the start page, and
 * `nOpt` is the cheapest (reach the page) + (reach the phrase on it).
 * `readDistance` is that second part. When no page speaks the evidence,
 * `optimalPathError` is 'evidence-not-in-reading-order', `nOptPartial` is true
 * and `nOpt` covers the navigation only.
 *
 * `options.analysisCache` is an optional `Map` the caller creates once per site
 * and passes to every call: it caches the finished page description across pages
 * and contexts, keyed by (url + DOM fingerprint, searchable words). Only the
 * description is cached; every step is still executed for real.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} task
 * @param {object} [ctx]      reserved (oracle context), unused
 * @param {object} [options]  replay timeout overrides, plus `analysisCache`
 * @returns {Promise<{nOpt: number|null, steps: object[], route?: 'guided'|'dag',
 *                    skipped?: number[], guidedNOpt?: number, readDistance?: number,
 *                    nOptPartial?: boolean, optimalPathError?: string, error?: string}>}
 */
async function computeOptimalPath(page, task, ctx = {}, options = {}) {
  const { executeStep } = require('./replay');
  const path = (task && task.sightedPath) || [];
  const runId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const findWords = findWordsFor(task);
  const shared = options.analysisCache instanceof Map ? options.analysisCache : null;
  const isInformation = !!(task && task.kind === 'information' && task.evidence);
  const typedSelectors = [];
  let cursorSelector = null; // null = document start

  // One state per page the walk stands on: states[i] is the page before
  // waypoint i, states[path.length] the page after the last one.
  const states = [];
  // pureNav[i]: waypoint i did nothing but follow a link to another page, so a
  // route that never stood on that page loses nothing by skipping it.
  const pureNav = [];
  // Shortest route to each state, and the waypoint edge that got there.
  const dist = [0];
  const back = [null];
  // The same walk with every waypoint taken, for `guidedNOpt`.
  const chain = [0];

  const relax = (to, cost, edge) => {
    if (dist[to] === undefined || cost < dist[to]) {
      dist[to] = cost;
      back[to] = edge;
    }
  };
  const rebuild = (to) => {
    const out = [];
    for (let cur = to; cur > 0; cur = back[cur].from) out.unshift(back[cur].entry);
    return out;
  };
  const skippedOf = (to) => {
    const out = [];
    for (let cur = to; cur > 0; cur = back[cur].from) {
      for (let k = back[cur].from; k < back[cur].entry.index; k += 1) out.unshift(k);
    }
    return out;
  };

  for (let j = 0; j < path.length; j += 1) {
    const step = path[j];
    const actionCost = ACTION_COST[step.action];
    if (actionCost === undefined) {
      return {
        nOpt: null,
        steps: rebuild(j),
        error: `optimalPath[${j}]: unsupported action "${step.action}"`,
      };
    }

    // `goto` is a navigation, not something the cursor has to reach; its page is
    // still described when the answer of an information task may be spoken there.
    const needsTarget = step.action !== 'goto' && !!step.selector;
    let state = null;
    if (needsTarget || isInformation) {
      state = await loadPageState(page, {
        runId,
        findWords,
        shared,
        cursorSelector,
        targets: needsTarget
          ? { selector: step.selector, action: step.action, key: step.key, typedSelectors }
          : null,
      });
      if (state.error) {
        return { nOpt: null, steps: rebuild(j), error: `optimalPath[${j}]: ${state.error}` };
      }
    }
    states[j] = state;

    const entry = {
      index: j,
      action: step.action,
      selector: step.selector || null,
      reach: { strategy: 'none', cost: 0 },
      actionCost,
    };

    if (needsTarget) {
      // Cheapest member of the effect-equivalence class; the sighted element
      // itself wins every tie.
      let best = null;
      for (const member of state.resolved.members) {
        const goals = nodesForSelector(state.graph, member.selector);
        const found = reachGoals(state.sp, goals);
        if (!found) continue;
        if (
          !best ||
          found.reach.cost < best.found.reach.cost ||
          (found.reach.cost === best.found.reach.cost && member.isTarget && !best.member.isTarget)
        ) {
          best = { member, found, goals };
        }
      }
      if (!best) {
        return {
          nOpt: null,
          steps: rebuild(j),
          error: `optimalPath[${j}]: no screen-reader route to ${step.selector} (not reachable by rotor, tab or reading order)`,
        };
      }
      entry.reach = best.found.reach;
      entry.equivalenceClassSize = state.resolved.members.length;
      if (!best.member.isTarget) {
        entry.reach.via = {
          ...(entry.reach.via || {}),
          equivalentOf: best.member.selector,
          equivalence: best.member.via,
          sightedSelector: step.selector,
        };
        entry.equivalentSelector = best.member.selector;
      }
      entry.analysis = analysisOf(state, best.goals);
    }

    const cost = entry.reach.cost + entry.actionCost;
    relax(j + 1, dist[j] + cost, { from: j, entry });
    chain[j + 1] = chain[j] + cost;

    // The same waypoint, reached from an earlier page: a link with the target's
    // href was already there, so the walk through the menu is not what a
    // screen-reader user would have to pay for.
    const href = state && state.resolved ? state.resolved.targetHref : null;
    const activates = step.action === 'click' || (step.action === 'press' && step.key === 'Enter');
    if (href && activates) {
      for (let i = j - 1; i >= 0 && pureNav[i]; i -= 1) {
        const from = states[i];
        if (!from || !from.graph || dist[i] === undefined) continue;
        const goals = nodesForHref(from.graph, href);
        const found = goals.length ? reachGoals(from.sp, goals) : null;
        if (!found) continue;
        const selector = from.desc.selectors[found.node];
        const skipEntry = {
          index: j,
          action: step.action,
          selector,
          equivalentSelector: selector,
          reach: {
            ...found.reach,
            via: {
              ...(found.reach.via || {}),
              equivalentOf: selector,
              equivalence: 'same-href-earlier-page',
              sightedSelector: step.selector,
            },
          },
          actionCost,
          skipped: Array.from({ length: j - i }, (_, k) => i + k),
          analysis: analysisOf(from, goals),
          navigated: true,
        };
        relax(j + 1, dist[i] + found.reach.cost + actionCost, { from: i, entry: skipEntry });
      }
    }

    if (step.action === 'type' && step.selector) typedSelectors.push(step.selector);

    // Execute the step for real so the next step is costed against real DOM.
    // Only the sighted step runs; an equivalent route is priced, never taken.
    const urlBefore = page.url();
    try {
      await executeStep(page, step, `optimalPath[${j}] ${step.action}`, options);
    } catch (err) {
      return { nOpt: null, steps: rebuild(j), error: err.message };
    }

    if (page.url() !== urlBefore) {
      // Navigation destroys the in-page runtime; the env re-injects and
      // re-attaches the cursor at document start.
      cursorSelector = null;
      entry.navigated = true;
    } else {
      // `activate` leaves the cursor on the activated element; `type` leaves it
      // in the field. When an equivalent element was costed, that is where the
      // optimally-playing user's cursor would be.
      cursorSelector = entry.equivalentSelector || step.selector || cursorSelector;
    }
    pureNav[j] = !!(entry.navigated && href && activates);
  }

  const last = path.length;
  const routeOf = (to) => (skippedOf(to).length ? 'dag' : 'guided');

  if (!isInformation) {
    const skipped = skippedOf(last);
    return {
      nOpt: dist[last],
      steps: rebuild(last),
      route: skipped.length ? 'dag' : 'guided',
      ...(skipped.length ? { skipped, guidedNOpt: chain[last] } : {}),
    };
  }

  // An information task does not end when the page holding the answer is
  // reached - it ends when the screen reader has SPOKEN the answer, and the
  // answer may already be on the page the walk started from.
  const endState = await loadPageState(page, { runId, findWords, shared, cursorSelector });
  if (endState.error) {
    // A hard failure of the read analysis: keep the navigation part rather than
    // losing the whole measurement.
    return {
      nOpt: dist[last],
      steps: rebuild(last),
      readDistance: null,
      nOptPartial: true,
      optimalPathError: `read step: ${endState.error}`,
      route: routeOf(last),
    };
  }
  states[last] = endState;

  let best = null;
  let guidedRead = null;
  for (let i = 0; i <= last; i += 1) {
    const state = states[i];
    if (!state || dist[i] === undefined) continue;
    const goals = evidenceGoals(state.desc, task.evidence);
    const found = goals.length ? reachGoals(state.sp, goals) : null;
    if (!found) continue;
    if (i === last) guidedRead = found.reach.cost;
    const total = dist[i] + found.reach.cost;
    if (!best || total < best.total) best = { at: i, found, goals, total };
  }

  if (!best) {
    // The evidence exists visually but no spoken phrase contains it: a finding
    // in its own right (harness turns it into `evidence-not-readable`).
    return {
      nOpt: dist[last],
      steps: rebuild(last),
      readDistance: null,
      nOptPartial: true,
      optimalPathError: EVIDENCE_NOT_IN_READING_ORDER,
      route: routeOf(last),
    };
  }

  const state = states[best.at];
  const steps = rebuild(best.at);
  const readEntry = {
    index: steps.length,
    action: 'read',
    selector: state.desc.selectors[best.found.node],
    evidence: task.evidence,
    phrase: best.found.goal.phrase,
    spanPhrases: best.found.goal.spanPhrases || 1,
    reach: best.found.reach,
    actionCost: ACTION_COST.read,
    candidateCount: best.goals.length,
    pageUrl: state.url,
    analysis: { ...analysisOf(state, [best.found.node]), readingOrderIndex: best.found.node },
  };
  const skipped = skippedOf(best.at);
  const heardEarly = best.at < last;
  const guidedNOpt = guidedRead === null ? null : chain[last] + guidedRead;
  return {
    nOpt: best.total,
    steps: [...steps, readEntry],
    route: skipped.length ? 'dag' : 'guided',
    readDistance: best.found.reach.cost,
    ...(skipped.length ? { skipped } : {}),
    ...(heardEarly ? { heardOnPage: best.at } : {}),
    ...(guidedNOpt !== null && guidedNOpt !== best.total ? { guidedNOpt } : {}),
  };
}

module.exports = {
  targetMatcherFor,
  findDirectLinks,
  urlPatternsOf,
  normaliseUrl,
  computeOptimalPath,
  evidenceGoals,
  findWordsFor,
  chooseReach,
  reachCommands,
  nodesForSelector,
  nodesForHref,
  describePageInPage,
  resolveTargetsInPage,
  pageFingerprint,
  loadPageState,
  ACTION_COST,
  EVIDENCE_NOT_IN_READING_ORDER,
  MAX_READ_CANDIDATES,
  MAX_EVIDENCE_PHRASE_SPAN,
  MIN_FIND_WORD,
  MAX_FIND_WORDS,
  squashText,
  ROTOR_KINDS,
  STRATEGY_ORDER,
  STEP_COMMAND_BY_KIND,
};
