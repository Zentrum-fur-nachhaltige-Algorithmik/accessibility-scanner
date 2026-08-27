/**
 * src/agent/optimal-path.js — `n_opt`, the shortest screen-reader command
 * sequence that performs the task.
 *
 * `n_sighted` (mouse clicks) and `n_sr` (screen-reader keystrokes) are measured
 * in different units, so comparing them directly says nothing. `n_opt` is the
 * same task expressed in the SAME unit as `n_sr`: the number of ScreenReaderEnv
 * commands an optimally-playing screen-reader user would need. The score is
 * therefore `R = n_opt / n_sr` (capped at 1) — how close the agent came to the
 * best possible screen-reader route through this page.
 *
 * Everything here is deterministic — no LLM. The reading order and the rotor
 * lists come from the SAME in-page functions the env uses (exposed as
 * `window.__SRENV.internals`), so `n_opt` is expressed in a command space that
 * the agent really has.
 *
 * Cost model (one command = 1)
 * ----------------------------
 * Reach the target from the current cursor position, cheapest of
 *   - `none`                    0    the cursor is already there
 *   - `rotor` + `jumpTo`        2    (headings|landmarks|links|formFields)
 *   - `rotor` + `jumpTo` + `next` × k   2 + k   (`rotor+next`)
 *   - `step`                    s    s presses of a rotor STEP command
 *                                    (`nextHeading`/`prevHeading`/`nextLink`/…),
 *                                    counted in whichever direction is shorter,
 *                                    wrapping at the document boundary exactly
 *                                    like `ScreenReaderEnv.stepToKind`
 *   - `step+next`               s + k   step to the nearest preceding element of
 *                                    a rotor kind, then `next` × k (this is how
 *                                    buttons — in no rotor list — are reached)
 *   - `tab` / `shiftTab`        distance in tab order
 *   - `next` / `prev`           distance in VSR reading order
 * then perform the step
 *   - click → `activate` 1 · type → `type` 1 · press → `activate` 1 ·
 *     goto → navigation 1 (no reach cost; the cursor resets)
 *
 * Effect-equivalence targets
 * --------------------------
 * A screen-reader user is not obliged to touch the same ELEMENT the sighted user
 * clicked — only to produce the same EFFECT. Every `click` / `press Enter` step
 * is therefore costed against an equivalence class of elements and the cheapest
 * member wins:
 *   - links: every visible `<a href>` / `[role=link][href]` resolving to the
 *     same absolute URL (fragment included only when the target itself has one);
 *   - form submission: if the step activates a submit control of form F, the
 *     class also holds "press Enter in a text field of F that is already filled"
 *     — that costs reach(field) + 1, so a preceding `type` step makes it free
 *     apart from the Enter itself, and the other submit controls of F;
 *   - buttons: same accessible name inside the same form / dialog container
 *     (deliberately conservative — same name elsewhere on the page is NOT
 *     assumed to have the same effect).
 * The chosen member is recorded as `reach.via.equivalentOf` when it differs from
 * the sighted element, together with `equivalenceClassSize` on the step. Only the
 * SIGHTED step is ever executed — the equivalent route is priced, never clicked,
 * so this cannot submit anything the sighted path did not submit itself.
 *
 * Reading-order cache
 * -------------------
 * One `computeOptimalPath()` call analyses the same page state several times
 * (once per member of an equivalence class, and again for a step that did not
 * change the DOM). The expensive part — the VSR reading-order walk, the four
 * rotor lists and the tab order — is therefore cached IN THE PAGE under
 * `window.__OPT_ANALYSIS_CACHE`, keyed by (run id, url, DOM fingerprint), and
 * dropped as soon as the DOM changes. It is an internal optimisation: the
 * numbers with and without it are identical.
 *
 * The cursor starts at document start and is reset to document start by any
 * navigation — exactly what ScreenReaderEnv does when it re-injects after
 * `framenavigated`.
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
 * cost is broken by this order). A rotor STEP command beats the equally
 * expensive rotor LIST + `jumpTo`: both are two keystrokes, but stepping is what
 * screen-reader users actually reach for, and it does not require having read a
 * list first.
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

/** Action cost of one sighted-path step, once the target has been reached. */
const ACTION_COST = { click: 1, type: 1, press: 1, goto: 1 };

/* ------------------------------------------------------------------ *
 * In-page analysis. Runs in the browser; uses window.__SRENV.internals.
 * ------------------------------------------------------------------ */
/* istanbul ignore next -- runs in the browser */
async function analyzeInPage(targetSelector, cursorSelector, kinds, opts) {
  const I = window.__SRENV.internals;
  const options = opts || {};
  const stepCommands = options.stepCommands || {};
  const typedSelectors = options.typedSelectors || [];
  const action = options.action || 'click';
  const key = options.key || null;

  const target = document.querySelector(targetSelector);
  if (!target) return { error: 'target not found: ' + targetSelector };

  const mod = (a, n) => ((a % n) + n) % n;

  /* --- page fingerprint (cheap; no reading-order walk) -------------- */
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

  const cacheKey = fingerprint();
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

    /* --- tab order ------------------------------------------------- */
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
    // everything else in document order — the browser's tab sequence.
    const positive = focusables
      .filter((el) => Number(el.getAttribute('tabindex')) > 0)
      .sort((a, b) => Number(a.getAttribute('tabindex')) - Number(b.getAttribute('tabindex')));
    const rest = focusables.filter((el) => !(Number(el.getAttribute('tabindex')) > 0));

    page = { order, els, N, idxOf, docStart, rotors, tabOrder: positive.concat(rest) };
    window.__OPT_ANALYSIS_CACHE = { runId: options.runId, key: cacheKey, data: page };
  }

  const { order, N, idxOf, docStart, rotors, tabOrder } = page;

  const cursorEl = cursorSelector ? document.querySelector(cursorSelector) : null;
  const cursorIdxs = (cursorEl && idxOf.get(cursorEl)) || [];
  // Cursor at document start (or on an element that left the reading order,
  // e.g. a dismissed banner) → document start.
  const cIdx = cursorIdxs.length ? cursorIdxs[0] : docStart;

  /* --- where the cursor sits in the tab sequence -------------------- */
  let cursorPos;
  const cursorTabIdx = cursorEl ? tabOrder.indexOf(cursorEl) : -1;
  if (cursorTabIdx !== -1) {
    cursorPos = cursorTabIdx;
  } else {
    // Not itself a tab stop: it sits BETWEEN two stops — modelled as
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

  /* --- rotor STEP commands: cost of reaching each rotor entry -------- */
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

  /* --- cost analysis of ONE element --------------------------------- */
  const analyzeElement = (el) => {
    const list = idxOf.get(el) || [];

    let next = null;
    let prev = null;
    for (const i of list) {
      const f = mod(i - cIdx, N);
      const b = mod(cIdx - i, N);
      if (next === null || f < next) next = f;
      if (prev === null || b < prev) prev = b;
    }

    /* rotor (+ next × k) */
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

    /* rotor step command (+ next × k) */
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
        // On a tie the SHORTER tail wins: a pure `step` (k = 0) beats stepping
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

    /* tab order */
    let tab = null;
    const tIdxTab = tabOrder.indexOf(el);
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

  /* --- the equivalence class of the step's target ------------------- */
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
    /* links with the same resolved href */
    if (target.matches('a[href], area[href], [role="link"][href]')) {
      const key0 = urlKeyOf(target);
      if (key0) {
        const all = document.querySelectorAll('a[href], area[href], [role="link"][href]');
        Array.prototype.forEach.call(all, (el) => {
          if (urlKeyOf(el) === key0) addMember(el, 'same-href');
        });
      }
    }

    /* form submission: other submit controls + Enter in a filled text field */
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

    /* buttons: same accessible name inside the same form / dialog container */
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

/* ------------------------------------------------------------------ *
 * Node side
 * ------------------------------------------------------------------ */

/**
 * Expand a chosen reach strategy into the literal env commands it costs.
 * `reachCommands(reach).length === reach.cost` for every strategy — that
 * identity is what lets `nOpt` be reported as a keystroke list (Blind Mode's
 * "so wäre es gegangen") and what makes the BFS edge weights honest.
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

/** Picks the cheapest reach strategy from the in-page analysis. */
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
 * preconditions already applied — the same state 0 the SR agent gets. Each step
 * is really executed (through `replay.executeStep`) after it has been costed, so
 * the DOM the next step is costed against is the real one.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} task
 * @param {object} [ctx]      reserved (oracle context), unused today
 * @param {object} [options]  replay timeout overrides
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
      let analysis;
      try {
        analysis = await page.evaluate(analyzeInPage, step.selector, cursorSelector, ROTOR_KINDS, {
          runId,
          action: step.action,
          key: step.key || null,
          typedSelectors,
          stepCommands: STEP_COMMAND_BY_KIND,
        });
      } catch (err) {
        return { nOpt: null, steps, error: `optimalPath[${i}]: analysis failed — ${err.message}` };
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
    // Only the SIGHTED step runs — an equivalent route is priced, never taken.
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

  return { nOpt, steps };
}

module.exports = {
  computeOptimalPath,
  chooseReach,
  reachCommands,
  analyzeInPage,
  ACTION_COST,
  ROTOR_KINDS,
  STRATEGY_ORDER,
  STEP_COMMAND_BY_KIND,
};
