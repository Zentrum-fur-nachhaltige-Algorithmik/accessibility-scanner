/**
 * optimal-path: `n_opt`, the shortest screen-reader command sequence for a task.
 * Costs each sighted-path step in ScreenReaderEnv commands (reach the target, then act),
 * using the env's own in-page reading order and rotor lists. Deterministic, no LLM.
 * Score: `R = n_opt / n_sr`, capped at 1.
 */

'use strict';

const { injectScreenReader, ROTOR_STEP_COMMANDS } = require('./screenreader-env');

const ROTOR_KINDS = ['headings', 'landmarks', 'links', 'formFields'];

/** `{ headings: { next: 'nextHeading', prev: 'prevHeading' }, … }` */
const STEP_COMMAND_BY_KIND = Object.entries(ROTOR_STEP_COMMANDS).reduce((acc, [cmd, def]) => {
  acc[def.kind] = acc[def.kind] || {};
  acc[def.kind][def.dir] = cmd;
  return acc;
}, {});

/**
 * Reach strategies, in tie-break preference order (cheapest wins first; equal
 * cost is broken by this order). A rotor step command beats the equally
 * expensive rotor list + `jumpTo`: both are two keystrokes, but stepping is what
 * screen-reader users reach for, and it does not require reading a list first.
 */
const STRATEGY_ORDER = [
  'none',
  'step',
  'rotor',
  'step+next',
  'rotor+next',
  'tab',
  'shiftTab',
  'next',
  'prev',
];

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
 * In-page analysis. Runs in the browser; uses window.__SRENV.internals.
 *
 * Two modes. `mode: 'act'` (the default) costs the target of one sighted step
 * against an effect-equivalence class; `mode: 'read'` ignores `targetSelector`
 * and instead costs every reading-order position whose spoken phrase contains
 * `options.evidence` - what an information task really asks for.
 *
 * In act mode it costs the target of one sighted step against an effect-equivalence class and
 * returns every member as a candidate: links resolving to the same URL, the
 * other submit controls of the same form plus Enter in an already filled text
 * field of it, and buttons with the same accessible name in the same form or
 * dialog container. Only the sighted step is ever executed; equivalents are
 * priced, never clicked.
 *
 * The reading-order walk, rotor lists and tab order are cached in the page
 * under `window.__OPT_ANALYSIS_CACHE`, keyed by (run id, url, DOM fingerprint).
 * The finished analysis is additionally cacheable across pages and contexts by
 * the caller (`options.analysisCache`, see `computeOptimalPath`).
 */
/* istanbul ignore next -- runs in the browser */
async function analyzeInPage(targetSelector, cursorSelector, kinds, opts) {
  const I = window.__SRENV.internals;
  const options = opts || {};
  const stepCommands = options.stepCommands || {};
  const typedSelectors = options.typedSelectors || [];
  const action = options.action || 'click';
  const key = options.key || null;
  const mode = options.mode === 'read' ? 'read' : 'act';
  const squash = (s) =>
    String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const needle = squash(options.evidence);
  const maxReadCandidates = options.maxReadCandidates || 50;
  const maxSpan = options.maxEvidenceSpan || 1;

  const target = targetSelector ? document.querySelector(targetSelector) : null;
  if (!target && mode !== 'read') return { error: 'target not found: ' + targetSelector };

  const mod = (a, n) => ((a % n) + n) % n;

  // page fingerprint (cheap; no reading-order walk)
  const fingerprint = () => {
    const values = Array.prototype.map
      .call(document.querySelectorAll('input, select, textarea'), (el) => {
        if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
        return typeof el.value === 'string' ? el.value : '';
      })
      .join('');
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

  const cacheKey = options.fingerprint || fingerprint();
  const holder = window.__OPT_ANALYSIS_CACHE;
  let page =
    holder && holder.runId === options.runId && holder.key === cacheKey ? holder.data : null;
  const cacheHit = !!page;

  if (!page) {
    // One walk of the VSR reading order. It is cyclic and starts at the current
    // VSR cursor, which is always document start here (the runtime was just
    // (re-)started), so indices are stable for the whole analysis.
    const order = await I.readingOrder();
    const els = order.map((e) => I.elementOf(e.node));
    const N = els.length;

    const idxOf = new Map();
    for (let i = 0; i < N; i += 1) {
      const el = els[i];
      if (!el) continue;
      const list = idxOf.get(el);
      if (list) list.push(i);
      else idxOf.set(el, [i]);
    }

    // The walk starts wherever the VSR cursor currently is, which is not
    // necessarily document start, so locate document start explicitly.
    let docStart = 0;
    for (let i = 0; i < N; i += 1) {
      const node = order[i].node;
      if (node === document || node === document.body || node === document.documentElement) {
        docStart = i;
        break;
      }
    }

    // Rotor lists come from the env's own `buildRotor`, so the rotor indices
    // here are exactly the indices `jumpTo` expects.
    const rotors = {};
    for (const kind of kinds) {
      const rotor = await I.buildRotor(kind);
      rotors[kind] = { items: rotor.items, nodes: I.getLastRotorNodes().slice() };
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

    page = { order, els, N, idxOf, docStart, rotors, tabOrder: positive.concat(rest) };
    window.__OPT_ANALYSIS_CACHE = { runId: options.runId, key: cacheKey, data: page };
  }

  const { order, els, N, idxOf, docStart, rotors, tabOrder } = page;

  const cursorEl = cursorSelector ? document.querySelector(cursorSelector) : null;
  const cursorIdxs = (cursorEl && idxOf.get(cursorEl)) || [];
  // Cursor at document start, or on an element that left the reading order
  // (e.g. a dismissed banner), maps to document start.
  const cIdx = cursorIdxs.length ? cursorIdxs[0] : docStart;

  // where the cursor sits in the tab sequence
  let cursorPos;
  const cursorTabIdx = cursorEl ? tabOrder.indexOf(cursorEl) : -1;
  if (cursorTabIdx !== -1) {
    cursorPos = cursorTabIdx;
  } else {
    // Not itself a tab stop: it sits between two stops, modelled as
    // `index - 0.5`, so one Tab reaches the following stop and one Shift+Tab
    // the preceding one.
    let following = tabOrder.length;
    for (let i = 0; i < tabOrder.length; i += 1) {
      if (
        !cursorEl ||
        cursorEl.compareDocumentPosition(tabOrder[i]) &
          (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)
      ) {
        following = i;
        break;
      }
    }
    cursorPos = following - 0.5;
  }

  // rotor step commands: cost of reaching each rotor entry
  // `nextHeading` & co. wrap at the document boundary (see
  // ScreenReaderEnv.stepToKind), so the cheaper of the two directions counts.
  const stepCostByKind = {};
  for (const kind of kinds) {
    const positions = [];
    for (const el of rotors[kind].nodes) {
      const list = idxOf.get(el);
      if (list && list.length) positions.push({ el, i: list[0] });
    }
    const costs = new Map();
    const put = (el, steps, dir) => {
      const cur = costs.get(el);
      if (!cur || steps < cur.steps) costs.set(el, { steps, dir });
    };
    const fwd = positions
      .map((p) => ({ p, d: mod(p.i - cIdx, N) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => a.d - b.d);
    const bwd = positions
      .map((p) => ({ p, d: mod(cIdx - p.i, N) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => a.d - b.d);
    fwd.forEach((x, r) => put(x.p.el, r + 1, 'next'));
    bwd.forEach((x, r) => put(x.p.el, r + 1, 'prev'));
    // The element the cursor already sits on: one full lap re-speaks it (the
    // env wraps), which costs as many presses as there are elements of the kind.
    for (const p of positions) if (mod(p.i - cIdx, N) === 0) put(p.el, positions.length, 'next');
    stepCostByKind[kind] = { positions, costs };
  }

  // Cost analysis of a set of reading-order positions belonging to `el`.
  // `analyzeElement` passes every position of the element; the read analysis
  // passes the single position whose phrase carries the evidence.
  const analyzeIndices = (el, list) => {
    let next = null;
    let prev = null;
    for (const i of list) {
      const f = mod(i - cIdx, N);
      const b = mod(cIdx - i, N);
      if (next === null || f < next) next = f;
      if (prev === null || b < prev) prev = b;
    }

    // rotor (+ next x k)
    let rotor = null;
    for (const kind of kinds) {
      const nodes = rotors[kind].nodes;
      for (let r = 0; r < nodes.length; r += 1) {
        const startIdxs = idxOf.get(nodes[r]);
        if (!startIdxs || !startIdxs.length) continue;
        for (const s of startIdxs) {
          let k = null;
          for (const t of list) {
            const d = mod(t - s, N);
            if (k === null || d < k) k = d;
          }
          if (k === null) continue;
          const cost = 2 + k;
          if (!rotor || cost < rotor.cost) {
            const item = rotors[kind].items[r] || {};
            rotor = {
              kind,
              index: r,
              k,
              cost,
              phrase: item.phrase || null,
              selector: item.selector || null,
            };
          }
        }
      }
    }

    // rotor step command (+ next x k)
    let step = null;
    for (const kind of kinds) {
      const { positions, costs } = stepCostByKind[kind];
      // The nearest element of this kind at or before the target: going further
      // back never pays (one step saved costs at least one extra `next`).
      for (const p of positions) {
        let k = null;
        for (const t of list) {
          const d = mod(t - p.i, N);
          if (k === null || d < k) k = d;
        }
        if (k === null) continue;
        const c = costs.get(p.el);
        if (!c) continue;
        const cost = c.steps + k;
        // On a tie the shorter tail wins: a pure `step` (k = 0) beats stepping
        // to an earlier element of the kind and walking forward.
        if (!step || cost < step.cost || (cost === step.cost && k < step.k)) {
          step = {
            kind,
            dir: c.dir,
            command: (stepCommands[kind] || {})[c.dir] || null,
            steps: c.steps,
            k,
            cost,
          };
        }
      }
    }
    if (step && !step.command) step = null;

    // tab order
    let tab = null;
    const tIdxTab = el ? tabOrder.indexOf(el) : -1;
    if (tIdxTab !== -1) {
      tab =
        tIdxTab >= cursorPos
          ? { dir: 'tab', cost: Math.ceil(tIdxTab - cursorPos) }
          : { dir: 'shiftTab', cost: Math.ceil(cursorPos - tIdxTab) };
    }

    return {
      inReadingOrder: list.length > 0,
      next,
      prev,
      tab,
      rotor,
      step,
      phrase: list.length ? order[list[0]].phrase : null,
    };
  };

  const analyzeElement = (el) => analyzeIndices(el, idxOf.get(el) || []);

  // Read mode: every reading-order position whose spoken phrase contains the
  // evidence is a candidate; the caller picks the cheapest to reach. Only if no
  // single phrase carries it, a run of up to `maxSpan` consecutive phrases is
  // tried as well (`spanPhrases` > 1, costed with the extra `next` presses). An
  // empty list means the text is on the page but is never spoken.
  if (mode === 'read') {
    const readCandidates = [];
    const addCandidate = (i, span, phrase) => {
      const el = els[i];
      readCandidates.push({
        readingOrderIndex: i,
        selector: el ? I.selectorFor(el) : null,
        phrase,
        spanPhrases: span,
        analysis: analyzeIndices(el, [i]),
      });
    };
    for (let i = 0; i < N && readCandidates.length < maxReadCandidates; i += 1) {
      if (!needle || !squash(order[i].phrase).includes(needle)) continue;
      addCandidate(i, 1, order[i].phrase);
    }
    // Only when no single phrase carries the answer: allow a tolerable split
    // over up to `maxSpan` phrases spoken one after the other. The extra
    // `next` presses are costed by the caller.
    if (needle && readCandidates.length === 0 && maxSpan > 1) {
      for (let i = 0; i < N && readCandidates.length < maxReadCandidates; i += 1) {
        let joined = squash(order[i].phrase);
        let raw = String(order[i].phrase == null ? '' : order[i].phrase);
        for (let w = 2; w <= maxSpan && i + w <= N; w += 1) {
          const nextPhrase = order[i + w - 1].phrase;
          joined = `${joined} ${squash(nextPhrase)}`;
          raw = `${raw} ${nextPhrase == null ? '' : nextPhrase}`;
          if (joined.includes(needle)) {
            addCandidate(i, w, raw);
            break;
          }
        }
      }
    }
    return {
      readingOrderLength: N,
      cursorIndex: cIdx,
      docStartIndex: docStart,
      cacheHit,
      readCandidates,
    };
  }

  // the equivalence class of the step's target
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

  const candidates = members.map((m) => {
    const a = analyzeElement(m.el);
    return {
      selector: m.el === target ? targetSelector : I.selectorFor(m.el),
      via: m.via,
      isTarget: m.el === target,
      phrase: a.phrase,
      analysis: a,
    };
  });

  return {
    readingOrderLength: N,
    cursorIndex: cIdx,
    docStartIndex: docStart,
    cacheHit,
    candidates,
  };
}

/**
 * The same cheap page fingerprint `analyzeInPage` uses, as a standalone in-page
 * function: url + hash of the body markup + all form-control values. Two pages
 * with the same fingerprint produce the same analysis for the same (target,
 * cursor, action) triple, which is what makes the analysis cacheable across
 * browser contexts. No reading-order walk, so it is cheap enough to run before
 * every step.
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

// Node side

/**
 * Expand a chosen reach strategy into the literal env commands it costs.
 * `reachCommands(reach).length === reach.cost` for every strategy; that
 * identity lets `nOpt` be reported as a keystroke list (Blind Mode's optimal
 * route) and keeps the BFS edge weights honest.
 */
function reachCommands(reach) {
  const repeat = (type, n) => Array.from({ length: n }, () => ({ type }));
  switch (reach.strategy) {
    case 'none':
      return [];
    case 'rotor':
      return [{ type: reach.via.kind }, { type: 'jumpTo', arg: reach.via.index }];
    case 'rotor+next':
      return [
        { type: reach.via.kind },
        { type: 'jumpTo', arg: reach.via.index },
        ...repeat('next', reach.via.k),
      ];
    case 'step':
      return repeat(reach.via.command, reach.via.steps);
    case 'step+next':
      return [...repeat(reach.via.command, reach.via.steps), ...repeat('next', reach.via.k)];
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
 * Picks the cheapest reach strategy from the in-page analysis. One command = 1:
 * `none` 0; `rotor` (list + `jumpTo`) 2; `rotor+next` 2 + k; `step` s presses of
 * a rotor step command in the shorter direction, wrapping like
 * `ScreenReaderEnv.stepToKind`; `step+next` s + k (how buttons, which are in no
 * rotor list, are reached); `tab`/`shiftTab` tab-order distance; `next`/`prev`
 * reading-order distance.
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
        via: { kind: r.kind, index: r.index, k: r.k, phrase: r.phrase, selector: r.selector },
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
 * Compute the shortest screen-reader command sequence for a task's sighted path.
 *
 * The page must be freshly navigated to the task URL with the task's
 * preconditions already applied: the same state 0 the SR agent gets. Each step
 * costs reach + action (click/type/press/goto = 1; goto has no reach cost and
 * resets the cursor). Each step is executed for real (`replay.executeStep`)
 * after it has been costed, so the next step is costed against the real DOM.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} task
 * `options.analysisCache` is an optional `Map` the caller creates once per site
 * and passes to every call: it caches the finished in-page analysis across
 * pages and contexts, keyed by (url + DOM fingerprint, target, cursor, action).
 * Only the analysis is cached; every step is still executed for real.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} task
 * @param {object} [ctx]      reserved (oracle context), unused
 * @param {object} [options]  replay timeout overrides, plus `analysisCache`
 * @returns {Promise<{nOpt: number|null, steps: object[], error?: string}>}
 */
async function computeOptimalPath(page, task, ctx = {}, options = {}) {
  const { executeStep } = require('./replay');
  const path = (task && task.sightedPath) || [];
  const steps = [];
  let nOpt = 0;
  let cursorSelector = null; // null = document start
  // Scopes the in-page reading-order cache to this call.
  const runId = `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const typedSelectors = [];
  // Cross-context cache of finished analyses, supplied by the caller.
  const shared = options.analysisCache instanceof Map ? options.analysisCache : null;

  for (let i = 0; i < path.length; i += 1) {
    const step = path[i];
    const actionCost = ACTION_COST[step.action];
    if (actionCost === undefined) {
      return { nOpt: null, steps, error: `optimalPath[${i}]: unsupported action "${step.action}"` };
    }

    const entry = {
      index: i,
      action: step.action,
      selector: step.selector || null,
      reach: { strategy: 'none', cost: 0 },
      actionCost,
    };

    // `goto` is a navigation, not something the cursor has to reach.
    if (step.action !== 'goto' && step.selector) {
      await injectScreenReader(page);

      // The fingerprint is only needed for the shared cache, and it is taken
      // after injection so both users of the key see the same DOM.
      let sharedKey = null;
      if (shared) {
        try {
          const fingerprint = await page.evaluate(pageFingerprint);
          sharedKey = JSON.stringify([
            fingerprint,
            step.selector,
            cursorSelector,
            step.action,
            step.key || null,
            typedSelectors,
          ]);
        } catch (_) {
          sharedKey = null; // cache miss; the analysis below runs as usual
        }
      }

      let analysis = sharedKey && shared.has(sharedKey) ? shared.get(sharedKey) : null;
      if (analysis) {
        analysis = { ...analysis, cacheHit: true };
      } else {
        try {
          analysis = await page.evaluate(
            analyzeInPage,
            step.selector,
            cursorSelector,
            ROTOR_KINDS,
            {
              runId,
              action: step.action,
              key: step.key || null,
              typedSelectors,
              stepCommands: STEP_COMMAND_BY_KIND,
            }
          );
        } catch (err) {
          return { nOpt: null, steps, error: `optimalPath[${i}]: analysis failed: ${err.message}` };
        }
        if (sharedKey && analysis && !analysis.error) shared.set(sharedKey, analysis);
      }
      if (analysis.error)
        return { nOpt: null, steps, error: `optimalPath[${i}]: ${analysis.error}` };

      // Cheapest member of the effect-equivalence class; the sighted element
      // itself wins every tie.
      let best = null;
      for (const cand of analysis.candidates) {
        const reach = chooseReach(cand.analysis);
        if (!reach) continue;
        if (
          !best ||
          reach.cost < best.reach.cost ||
          (reach.cost === best.reach.cost && cand.isTarget && !best.cand.isTarget)
        ) {
          best = { cand, reach };
        }
      }
      if (!best) {
        return {
          nOpt: null,
          steps,
          error: `optimalPath[${i}]: no screen-reader route to ${step.selector} (not reachable by rotor, tab or reading order)`,
        };
      }

      entry.reach = best.reach;
      entry.equivalenceClassSize = analysis.candidates.length;
      if (!best.cand.isTarget) {
        entry.reach.via = {
          ...(entry.reach.via || {}),
          equivalentOf: best.cand.selector,
          equivalence: best.cand.via,
          sightedSelector: step.selector,
        };
        entry.equivalentSelector = best.cand.selector;
      }
      entry.analysis = {
        cursorIndex: analysis.cursorIndex,
        docStartIndex: analysis.docStartIndex,
        readingOrderLength: analysis.readingOrderLength,
        cacheHit: analysis.cacheHit,
        next: best.cand.analysis.next,
        prev: best.cand.analysis.prev,
        tab: best.cand.analysis.tab,
        rotor: best.cand.analysis.rotor,
        step: best.cand.analysis.step,
      };
    }

    nOpt += entry.reach.cost + entry.actionCost;
    steps.push(entry);

    if (step.action === 'type' && step.selector) typedSelectors.push(step.selector);

    // Execute the step for real so the next step is costed against real DOM.
    // Only the sighted step runs; an equivalent route is priced, never taken.
    const urlBefore = page.url();
    try {
      await executeStep(page, step, `optimalPath[${i}] ${step.action}`, options);
    } catch (err) {
      return { nOpt: null, steps, error: err.message };
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
  }

  // An information task does not end when the page holding the answer is
  // reached - it ends when the screen reader has SPOKEN the answer. Costing
  // only the navigation would price "find the phone number" at one `goto`
  // while the number itself sits 90 `next` presses down the home page, and the
  // step budget derived from nOpt would run out before the agent could ever
  // hear it. So the reading is appended as a final `read` step.
  if (task && task.kind === 'information' && task.evidence) {
    const read = await costReadStep(page, task.evidence, cursorSelector, runId);
    if (read.error) {
      // A hard failure of the read analysis: keep the navigation part rather
      // than losing the whole measurement.
      return { nOpt, steps, readDistance: null, nOptPartial: true, optimalPathError: read.error };
    }
    if (!read.entry) {
      // The evidence exists visually but no spoken phrase contains it: a
      // finding in its own right (harness turns it into `evidence-not-readable`).
      return {
        nOpt,
        steps,
        readDistance: null,
        nOptPartial: true,
        optimalPathError: EVIDENCE_NOT_IN_READING_ORDER,
      };
    }
    read.entry.index = steps.length;
    steps.push(read.entry);
    nOpt += read.entry.reach.cost + read.entry.actionCost;
    return { nOpt, steps, readDistance: read.entry.reach.cost };
  }

  return { nOpt, steps };
}

/**
 * Cost the cheapest way to HEAR `evidence` from the current cursor position,
 * using exactly the reach strategies a sighted-path step uses. Action cost 0.
 *
 * @returns {Promise<{entry?: object, error?: string}>} `entry` absent (without
 *          an error) means no spoken phrase contains the evidence.
 */
async function costReadStep(page, evidence, cursorSelector, runId) {
  try {
    await injectScreenReader(page);
  } catch (err) {
    return { error: `read step: screen reader injection failed: ${err.message}` };
  }

  let analysis;
  try {
    analysis = await page.evaluate(analyzeInPage, null, cursorSelector, ROTOR_KINDS, {
      runId,
      mode: 'read',
      evidence,
      maxReadCandidates: MAX_READ_CANDIDATES,
      maxEvidenceSpan: MAX_EVIDENCE_PHRASE_SPAN,
      stepCommands: STEP_COMMAND_BY_KIND,
    });
  } catch (err) {
    return { error: `read step: analysis failed: ${err.message}` };
  }
  if (analysis.error) return { error: `read step: ${analysis.error}` };

  let best = null;
  for (const cand of analysis.readCandidates || []) {
    const reached = chooseReach(cand.analysis);
    if (!reached) continue;
    // Hearing a split answer means reading on: one `next` per extra phrase.
    const span = cand.spanPhrases || 1;
    const reach =
      span > 1
        ? {
            ...reached,
            cost: reached.cost + (span - 1),
            via: { ...(reached.via || {}), spanPhrases: span },
          }
        : reached;
    // Cheapest wins; at equal cost the tighter span, so the read step starts
    // where the answer starts.
    const better =
      !best ||
      reach.cost < best.reach.cost ||
      (reach.cost === best.reach.cost && span < (best.cand.spanPhrases || 1));
    if (better) best = { cand, reach };
  }
  if (!best) return {};

  return {
    entry: {
      index: -1, // set by the caller
      action: 'read',
      selector: best.cand.selector,
      evidence,
      phrase: best.cand.phrase,
      spanPhrases: best.cand.spanPhrases || 1,
      reach: best.reach,
      actionCost: ACTION_COST.read,
      candidateCount: (analysis.readCandidates || []).length,
      analysis: {
        cursorIndex: analysis.cursorIndex,
        docStartIndex: analysis.docStartIndex,
        readingOrderLength: analysis.readingOrderLength,
        cacheHit: analysis.cacheHit,
        readingOrderIndex: best.cand.readingOrderIndex,
        next: best.cand.analysis.next,
        prev: best.cand.analysis.prev,
        tab: best.cand.analysis.tab,
        rotor: best.cand.analysis.rotor,
        step: best.cand.analysis.step,
      },
    },
  };
}

module.exports = {
  computeOptimalPath,
  costReadStep,
  chooseReach,
  reachCommands,
  analyzeInPage,
  pageFingerprint,
  ACTION_COST,
  EVIDENCE_NOT_IN_READING_ORDER,
  MAX_READ_CANDIDATES,
  MAX_EVIDENCE_PHRASE_SPAN,
  squashText,
  ROTOR_KINDS,
  STRATEGY_ORDER,
  STEP_COMMAND_BY_KIND,
};
