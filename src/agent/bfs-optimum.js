/**
 * bfs-optimum: `n_opt_bfs`, a bounded true optimum over the screen-reader command space.
 * Dijkstra over page states (url + reading-order hash + dialogs + form values, plus cursor
 * position); edges are activate/type transitions costed in env commands and executed in
 * a real browser. The guided optimum from optimal-path.js is the upper bound.
 */

'use strict';

const { injectScreenReader, COMMAND_COSTS } = require('./screenreader-env');
const {
  chooseReach,
  reachCommands,
  findWordsFor,
  ROTOR_KINDS,
  STEP_COMMAND_BY_KIND,
} = require('./optimal-path');
const { evaluate, createRequestRecorder } = require('./oracle');
const {
  createIsolatedContext,
  executeStep,
  runPreconditions,
  measureOptimalPath,
  DEFAULTS: REPLAY_DEFAULTS,
} = require('./replay');
const { validateTaskShape } = require('./task');

/**
 * Defaults for a within-page validator.
 *
 * `maxPages: 1` keeps the search on the start URL: every edge, navigations
 * included, is still executed and goal-tested, but a non-goal page at another
 * URL is never expanded. The guided optimum is defined relative to the trees
 * seen along the sighted trajectory, so the question is whether a cheaper route
 * exists on the page the user is looking at, not elsewhere on the site.
 * Cross-site search is affordable only on small fixtures (one gov.uk expansion
 * is hundreds of navigations); pass e.g. `maxPages: 40` for an exhaustive search.
 */
const DEFAULTS = {
  maxDepth: 6,
  maxStates: 400,
  maxPages: 1,
  /**
   * Cap on transitions really executed. One expansion on a large site can be
   * hundreds of edges, each costing a navigation plus a full reading-order walk,
   * so this is the budget that bites in practice.
   */
  maxEdges: 60,
  sameOriginOnly: true,
  timeoutMs: 60000,
  /** Submit `method="post"` forms. Off by default: this clicks real websites. */
  allowSubmit: false,
  /**
   * A localhost origin is treated as a safe sandbox, so POST forms there are
   * submitted even without `allowSubmit`. Tests set this to `false` to exercise
   * the guard against a fixture server.
   */
  localhostIsSafe: true,
  /** Cap on the `explored.skipped` list, purely to keep results small. */
  maxSkippedReported: 200,
};

// In-page analysis. Runs in the browser; uses window.__SRENV.internals.
//
// Whole-page generalisation of `optimal-path.analyzeInPage`: costs every
// candidate in a single reading-order walk and returns the state fingerprint.
// The tab-order and rotor logic is a copy of that function; keep the two in sync.
/* istanbul ignore next -- runs in the browser */
async function analyzeStateInPage(cursorSelector, kinds, cfg) {
  const I = window.__SRENV.internals;

  // reading order (one walk)
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

  let docStart = 0;
  for (let i = 0; i < N; i += 1) {
    const node = order[i].node;
    if (node === document || node === document.body || node === document.documentElement) {
      docStart = i;
      break;
    }
  }

  const cursorEl = cursorSelector ? document.querySelector(cursorSelector) : null;
  const cursorIdxs = cursorEl ? idxOf.get(cursorEl) || [] : [];
  const cIdx = cursorIdxs.length ? cursorIdxs[0] : docStart;

  const mod = (a, n) => ((a % n) + n) % n;

  // Rotor starts. A list shows one page of `pageSize` entries, so reaching entry
  // r costs 1 (open) + the commands that reveal it (`more` per page, or one
  // `rotorLetter` when r is the first entry with its letter) + 1 (`jumpTo`).
  const pageSize = I.rotorPageSize || 8;
  const rotorAt = new Array(N).fill(null);
  const rotorNodesByKind = {};
  for (const kind of kinds) {
    const rotor = await I.buildRotor(kind);
    const nodes = I.getLastRotorNodes().slice();
    rotorNodesByKind[kind] = nodes;
    const items = rotor.items || [];
    const seenLetter = new Set();
    for (let r = 0; r < nodes.length; r += 1) {
      const phrase = (items[r] && items[r].phrase) || '';
      const letter = I.foldText(I.rotorLabel(phrase)).slice(0, 1);
      const firstOfLetter = !!letter && !seenLetter.has(letter);
      if (letter) seenLetter.add(letter);
      const pages = Math.floor(r / pageSize);
      const reveal = firstOfLetter && pages > 1 ? 1 : pages;
      const list = idxOf.get(nodes[r]);
      if (!list) continue;
      for (const i of list) {
        if (!rotorAt[i] || 2 + reveal < rotorAt[i].cost) {
          rotorAt[i] = {
            kind,
            index: r,
            cost: 2 + reveal,
            pages: firstOfLetter && pages > 1 ? 0 : pages,
            letter: firstOfLetter && pages > 1 ? letter : null,
          };
        }
      }
    }
  }
  // Cyclic min-plus sweep: rotorCost[i] = cheapest rotor route to i, which is
  // the cheapest entry at or before i plus one `next` per position in between.
  const rotorCost = new Array(N).fill(Infinity);
  const rotorFrom = new Array(N).fill(-1);
  {
    let cur = Infinity;
    let from = -1;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < N; i += 1) {
        cur = cur === Infinity ? Infinity : cur + 1;
        if (rotorAt[i] && rotorAt[i].cost <= cur) {
          cur = rotorAt[i].cost;
          from = i;
        }
        rotorCost[i] = cur;
        rotorFrom[i] = from;
      }
    }
  }

  // rotor step commands (`nextHeading` & co.)
  // Mirror of `optimal-path.analyzeInPage`'s step block, made whole-page.
  // For one kind the cost of reaching reading-order index `i` is
  //   min over kind-elements p of  steps(p) + (i - index(p)) mod N,
  // which a cyclic min-plus sweep (`best[i] = min(g[i], best[i-1] + 1)`, two
  // passes for the wrap) computes for every `i` in O(N): the same minimum
  // `optimal-path.js` takes directly over the (single) target's indices.
  const INF = Infinity;
  // kind (or heading level) -> { cost: number[], dir: string[], steps: number[], from: number[] }
  const stepBest = {};
  const sweepPositions = (positions) => {
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
    // The element the cursor already sits on: the env wraps, so one full lap.
    for (const p of positions) if (mod(p.i - cIdx, N) === 0) put(p.el, positions.length, 'next');

    const g = new Array(N).fill(INF);
    const gDir = new Array(N).fill(null);
    const gSteps = new Array(N).fill(0);
    for (const p of positions) {
      const c = costs.get(p.el);
      if (!c) continue;
      if (c.steps < g[p.i]) {
        g[p.i] = c.steps;
        gDir[p.i] = c.dir;
        gSteps[p.i] = c.steps;
      }
    }
    const cost = new Array(N).fill(INF);
    const dir = new Array(N).fill(null);
    const steps = new Array(N).fill(0);
    const from = new Array(N).fill(-1);
    let cur = INF;
    let curDir = null;
    let curSteps = 0;
    let curFrom = -1;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < N; i += 1) {
        cur = cur === INF ? INF : cur + 1;
        // `<=`: on a tie prefer the nearer source, i.e. the shorter `next` tail
        // (the same tie-break `optimal-path.js` applies).
        if (g[i] <= cur) {
          cur = g[i];
          curDir = gDir[i];
          curSteps = gSteps[i];
          curFrom = i;
        }
        cost[i] = cur;
        dir[i] = curDir;
        steps[i] = curSteps;
        from[i] = curFrom;
      }
    }
    return { cost, dir, steps, from };
  };

  const positionsOf = (nodes) => {
    const positions = [];
    for (const el of nodes) {
      const list = idxOf.get(el);
      if (list && list.length) positions.push({ el, i: list[0] });
    }
    return positions;
  };

  for (const kind of kinds) stepBest[kind] = sweepPositions(positionsOf(rotorNodesByKind[kind]));

  // Heading levels: the same sweep over the headings of one level, which is
  // what `nextHeading`/`prevHeading` with a level stop at (NVDA/JAWS digits).
  const levelBest = {};
  for (let level = 1; level <= 6; level += 1) {
    const nodes = (rotorNodesByKind.headings || []).filter(
      (el) => I.headingLevelOf(el) === level
    );
    if (!nodes.length) continue;
    levelBest[level] = sweepPositions(positionsOf(nodes));
  }

  // find: browse-mode search, forward from the cursor, no wrap. One sweep per
  // searchable word gives the cheapest `find` + j x `findNext` + k x `next` for
  // every reading-order index.
  const findWords = cfg.findWords || [];
  const findCost = cfg.findCost || 2;
  const findBest = {
    cost: new Array(N).fill(INF),
    word: new Array(N).fill(null),
    k: new Array(N).fill(0),
    findNexts: new Array(N).fill(0),
  };
  if (findWords.length) {
    const folded = order.map((e) => I.foldText(e.phrase));
    const limit = cIdx === docStart ? N : mod(docStart - cIdx, N);
    for (const word of findWords) {
      const w = I.foldText(word);
      if (!w) continue;
      let cur = INF;
      let curD = 0;
      let curJ = 0;
      let j = 0;
      for (let d = 1; d < limit; d += 1) {
        cur = cur === INF ? INF : cur + 1;
        const i = mod(cIdx + d, N);
        if (folded[i].includes(w)) {
          if (findCost + j <= cur) {
            cur = findCost + j;
            curD = d;
            curJ = j;
          }
          j += 1;
        }
        if (cur < findBest.cost[i]) {
          findBest.cost[i] = cur;
          findBest.word[i] = word;
          findBest.k[i] = d - curD;
          findBest.findNexts[i] = curJ;
        }
      }
    }
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
    if (!el.getClientRects().length) return false;
    return true;
  });
  const positive = focusables
    .filter((el) => Number(el.getAttribute('tabindex')) > 0)
    .sort((a, b) => Number(a.getAttribute('tabindex')) - Number(b.getAttribute('tabindex')));
  const rest = focusables.filter((el) => !(Number(el.getAttribute('tabindex')) > 0));
  const tabOrder = positive.concat(rest);

  let cursorPos;
  const cursorTabIdx = cursorEl ? tabOrder.indexOf(cursorEl) : -1;
  if (cursorTabIdx !== -1) {
    cursorPos = cursorTabIdx;
  } else {
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

  // what can be acted on
  const ACTIONABLE =
    'a[href], button, input[type="submit"], input[type="button"], input[type="reset"],' +
    ' [role="button"], [role="link"], [role="menuitem"], summary, [onclick]';
  const TEXTFIELD =
    'input:not([type]), input[type="text"], input[type="search"], input[type="email"],' +
    ' input[type="url"], input[type="tel"], input[type="password"], input[type="number"],' +
    ' textarea, [contenteditable=""], [contenteditable="true"],' +
    ' [role="textbox"], [role="searchbox"], [role="combobox"]';

  const isSubmitControl = (el) => {
    const tag = el.tagName;
    if (tag === 'INPUT') return ['submit', 'image'].includes((el.type || '').toLowerCase());
    if (tag === 'BUTTON') return (el.getAttribute('type') || 'submit').toLowerCase() === 'submit';
    return false;
  };

  const candidates = [];
  const skipped = [];
  const seen = new Set();
  const pool = [];
  for (const el of els) if (el && !seen.has(el)) (seen.add(el), pool.push(el));
  for (const el of tabOrder) if (!seen.has(el)) (seen.add(el), pool.push(el));

  for (const el of pool) {
    if (!el.matches) continue;
    const actionable = el.matches(ACTIONABLE);
    const textField = el.matches(TEXTFIELD);
    if (!actionable && !textField) continue;
    if (!I.isVisible(el)) continue;

    const selector = I.selectorFor(el);
    const note = (reason) => skipped.push({ selector, reason });

    // link safety
    let unsafeActivate = null;
    if (el.tagName === 'A' && el.hasAttribute('href')) {
      const raw = el.getAttribute('href') || '';
      if (/^\s*(mailto|tel|sms|javascript|file|ftp):/i.test(raw)) unsafeActivate = 'protocol';
      else if (el.hasAttribute('download')) unsafeActivate = 'download';
      else if (cfg.sameOriginOnly) {
        let sameOrigin = true;
        try {
          sameOrigin = new URL(el.href, location.href).origin === location.origin;
        } catch (e) {
          sameOrigin = false;
        }
        if (!sameOrigin) unsafeActivate = 'cross-origin';
      }
    }

    // POST-form safety
    const form = el.closest ? el.closest('form') : null;
    const postForm =
      !!form && String(form.getAttribute('method') || 'get').toLowerCase() === 'post';
    const submits = postForm && !cfg.allowSubmit;
    if (submits && actionable && isSubmitControl(el)) unsafeActivate = 'post-form';
    // Enter inside a POST form submits it, too.
    const unsafeEnter = submits && textField ? 'post-form' : null;

    if (unsafeActivate) note(unsafeActivate);
    if (unsafeEnter) note('post-form-enter');

    // reach cost analysis (shape = optimal-path.analyzeInPage)
    const list = idxOf.get(el) || [];
    let next = null;
    let prev = null;
    let rotor = null;
    let step = null;
    let stepLevel = null;
    let find = null;
    for (const i of list) {
      const f = mod(i - cIdx, N);
      const b = mod(cIdx - i, N);
      if (next === null || f < next) next = f;
      if (prev === null || b < prev) prev = b;
      const s = rotorFrom[i];
      if (s !== -1 && rotorCost[i] !== Infinity) {
        const k = mod(i - s, N);
        if (!rotor || rotorCost[i] < rotor.cost) {
          rotor = {
            kind: rotorAt[s].kind,
            index: rotorAt[s].index,
            pages: rotorAt[s].pages,
            letter: rotorAt[s].letter,
            k,
            cost: rotorCost[i],
          };
        }
      }
      for (const kind of kinds) {
        const sb = stepBest[kind];
        if (sb.cost[i] === Infinity) continue;
        const command =
          (cfg.stepCommands && cfg.stepCommands[kind] ? cfg.stepCommands[kind][sb.dir[i]] : null) ||
          null;
        if (!command) continue;
        if (!step || sb.cost[i] < step.cost) {
          step = {
            kind,
            dir: sb.dir[i],
            command,
            steps: sb.steps[i],
            k: mod(i - sb.from[i], N),
            cost: sb.cost[i],
          };
        }
      }
      for (const level of Object.keys(levelBest)) {
        const lb = levelBest[level];
        if (lb.cost[i] === Infinity) continue;
        const command =
          (cfg.stepCommands && cfg.stepCommands.headings
            ? cfg.stepCommands.headings[lb.dir[i]]
            : null) || null;
        if (!command) continue;
        if (!stepLevel || lb.cost[i] < stepLevel.cost) {
          stepLevel = {
            kind: 'headings',
            level: Number(level),
            dir: lb.dir[i],
            command,
            steps: lb.steps[i],
            k: mod(i - lb.from[i], N),
            cost: lb.cost[i],
          };
        }
      }
      if (findBest.cost[i] !== Infinity && (!find || findBest.cost[i] < find.cost)) {
        find = {
          word: findBest.word[i],
          findNexts: findBest.findNexts[i],
          k: findBest.k[i],
          cost: findBest.cost[i],
        };
      }
    }
    let tab = null;
    const tIdxTab = tabOrder.indexOf(el);
    if (tIdxTab !== -1) {
      tab =
        tIdxTab >= cursorPos
          ? { dir: 'tab', cost: Math.ceil(tIdxTab - cursorPos) }
          : { dir: 'shiftTab', cost: Math.ceil(cursorPos - tIdxTab) };
    }

    candidates.push({
      selector,
      phrase: list.length ? order[list[0]].phrase : null,
      actionable: actionable && !unsafeActivate,
      textField,
      enterAllowed: textField && !unsafeEnter,
      isSubmitControl: actionable && isSubmitControl(el),
      analysis: { inReadingOrder: list.length > 0, next, prev, tab, rotor, step, stepLevel, find },
    });
  }

  // fingerprint
  const dialogs = Array.prototype.filter
    .call(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog'), (el) => {
      if (el.tagName === 'DIALOG' && !el.open) return false;
      return I.isVisible(el);
    })
    .map((el) => I.selectorFor(el))
    .join('|');
  const values = Array.prototype.map
    .call(document.querySelectorAll('input, select, textarea'), (el) => {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
      return typeof el.value === 'string' ? el.value : '';
    })
    .join('');
  const SEP = String.fromCharCode(1);
  const material = order.map((e) => e.phrase).join(SEP) + SEP + dialogs + SEP + values;
  // FNV-1a, 32 bit: good enough to separate page states, cheap to compute.
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }

  return {
    url: location.href,
    hash: h.toString(16),
    readingOrderLength: N,
    cursorIndex: cIdx,
    docStartIndex: docStart,
    candidates,
    skipped,
  };
}

// Node side

/** The distinct texts the task types, in order of first appearance. */
function typeTextsOf(task) {
  const out = [];
  for (const step of task.sightedPath || []) {
    if (step.action === 'type' && typeof step.text === 'string' && !out.includes(step.text)) {
      out.push(step.text);
    }
  }
  return out;
}

/** All transitions leaving one analysed state, cheapest first, deterministic. */
function transitionsFor(analysis, typeTexts) {
  const out = [];
  for (const cand of analysis.candidates) {
    const reach = chooseReach(cand.analysis);
    if (!reach) continue;
    const cmds = reachCommands(reach);
    if (!cmds) continue;
    if (cand.actionable) {
      out.push({
        kind: 'activate',
        selector: cand.selector,
        phrase: cand.phrase,
        reach,
        cost: reach.cost + 1,
        steps: [{ action: 'click', selector: cand.selector }],
        cmds: cmds.concat([{ type: 'activate' }]),
      });
    }
    if (cand.textField) {
      for (const text of typeTexts) {
        out.push({
          kind: 'type',
          selector: cand.selector,
          phrase: cand.phrase,
          reach,
          cost: reach.cost + 1,
          steps: [{ action: 'type', selector: cand.selector, text }],
          cmds: cmds.concat([{ type: 'type', arg: text }]),
        });
        if (cand.enterAllowed) {
          out.push({
            kind: 'type+activate',
            selector: cand.selector,
            phrase: cand.phrase,
            reach,
            cost: reach.cost + 2,
            steps: [
              { action: 'type', selector: cand.selector, text },
              { action: 'press', selector: cand.selector, key: 'Enter' },
            ],
            cmds: cmds.concat([{ type: 'type', arg: text }, { type: 'activate' }]),
          });
        }
      }
    }
  }
  // Stable, cheapest-first order so results and paths are reproducible.
  return out.map((t, i) => ({ ...t, seq: i })).sort((a, b) => a.cost - b.cost || a.seq - b.seq);
}

function isLocalOrigin(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch (_) {
    return false;
  }
}

/**
 * A true (bounded) optimum over the screen-reader command space.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url                          the task's start URL
 * @param {object} task                         see `src/agent/task.js`
 * @param {object} [options]                    see DEFAULTS; plus
 *   `nOptGuided` (skip recomputing the guided optimum), `onPage(page)` (called
 *   once with the search page, e.g. to attach a request recorder) and any
 *   `replay.js` timeout override.
 * @returns {Promise<{nOptBfs: number|null, path: object[]|null,
 *                    bestFound: object|null, nOptGuided: number|null,
 *                    explored: object, error?: string}>}
 */
async function computeBfsOptimum(browser, url, task, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const startedAt = Date.now();

  const explored = {
    states: 0, // states expanded
    discovered: 0, // distinct states seen
    pages: 0, // distinct page fingerprints seen
    edges: 0, // transitions really executed
    depthReached: 0,
    truncated: false,
    reason: null,
    skipped: [],
    ms: 0,
  };
  const fail = (error) => ({
    nOptBfs: null,
    path: null,
    bestFound: null,
    nOptGuided: null,
    explored: { ...explored, reason: 'error', ms: Date.now() - startedAt },
    error,
  });

  let normalized;
  try {
    normalized = validateTaskShape(task);
  } catch (err) {
    return fail(err.message);
  }

  // the guided optimum is the upper bound
  let nOptGuided =
    typeof opts.nOptGuided === 'number' && Number.isFinite(opts.nOptGuided)
      ? opts.nOptGuided
      : null;
  if (nOptGuided === null) {
    const guided = await measureOptimalPath(browser, url, normalized, options);
    nOptGuided = typeof guided.nOpt === 'number' ? guided.nOpt : null;
  }
  const guidedBound = nOptGuided === null ? Infinity : nOptGuided;

  const typeTexts = typeTextsOf(normalized);
  const safeOrigin = opts.allowSubmit || (opts.localhostIsSafe && isLocalOrigin(url));
  const cfg = {
    sameOriginOnly: opts.sameOriginOnly,
    allowSubmit: safeOrigin,
    stepCommands: STEP_COMMAND_BY_KIND,
    // The search is restricted to the task's own words, exactly as in
    // `optimal-path.js`: the optimum must not know the page.
    findWords: findWordsFor(normalized),
    findCost: COMMAND_COSTS.find,
  };

  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  const recorder = createRequestRecorder(page);
  const ctx = { recorder };
  if (typeof opts.onPage === 'function') await opts.onPage(page);

  const noteSkip = (entry) => {
    if (explored.skipped.length < opts.maxSkippedReported) explored.skipped.push(entry);
  };

  /**
   * Bring the page into the state reached by `steps` (from the start URL).
   * A no-op when the page already is in that state and nothing has touched it
   * since (analysing a state does not count as touching it).
   */
  let establishedSig = null;
  let pageDirty = true;
  async function establish(steps) {
    const sig = JSON.stringify(steps);
    if (!pageDirty && establishedSig === sig) return;
    establishedSig = null;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REPLAY_DEFAULTS.gotoTimeout });
    const pre = await runPreconditions(page, normalized, options);
    if (!pre.ok) throw new Error(`precondition failed: ${pre.error}`);
    // Recorder starts at state 0, exactly like `replay.validateTask`, so a
    // `requestSent` oracle is not satisfied by the setup itself.
    recorder.reset();
    for (let i = 0; i < steps.length; i += 1) {
      await executeStep(page, steps[i], `bfs.establish[${i}] ${steps[i].action}`, options);
    }
    establishedSig = sig;
    pageDirty = false;
  }

  async function analyze(cursorSelector) {
    await injectScreenReader(page);
    return page.evaluate(analyzeStateInPage, cursorSelector, ROTOR_KINDS, cfg);
  }

  const stateKeyOf = (fp, cursorSelector) =>
    `${fp.url}#${fp.hash}||${cursorSelector || '@docstart'}`;

  const seenStates = new Set();
  const seenPages = new Set();
  const analysisCache = new Map();

  let best = Infinity;
  let bestPath = null;
  let bestSteps = null;
  let bestVia = null;

  try {
    // state 0
    await establish([]);
    const startFp = await analyze(null);
    const startKey = stateKeyOf(startFp, null);
    seenStates.add(startKey);
    seenPages.add(startFp.url);
    explored.discovered = 1;
    explored.pages = 1;
    analysisCache.set(startKey, startFp);
    for (const s of startFp.skipped) noteSkip({ ...s, state: startKey });

    if (await evaluate(normalized.oracle, page, ctx)) {
      explored.reason = 'already-true-at-state-0';
      explored.ms = Date.now() - startedAt;
      return { nOptBfs: 0, path: [], bestFound: { cost: 0, path: [] }, nOptGuided, explored };
    }

    const frontier = [{ key: startKey, cost: 0, depth: 0, steps: [], cmds: [], cursor: null }];
    const expandedKeys = new Set();
    let stoppedByBound = false;

    while (frontier.length) {
      if (Date.now() - startedAt > opts.timeoutMs) {
        explored.truncated = true;
        explored.reason = 'timeout';
        break;
      }
      frontier.sort((a, b) => a.cost - b.cost || a.depth - b.depth);
      const node = frontier.shift();
      if (expandedKeys.has(node.key)) continue;

      const bound = Math.min(best, guidedBound);
      if (node.cost >= bound) {
        stoppedByBound = true;
        break;
      }
      if (explored.states >= opts.maxStates) {
        explored.truncated = true;
        explored.reason = 'maxStates';
        break;
      }
      if (node.depth >= opts.maxDepth) {
        explored.truncated = true;
        explored.reason = 'maxDepth';
        continue;
      }

      expandedKeys.add(node.key);
      explored.states += 1;
      explored.depthReached = Math.max(explored.depthReached, node.depth);

      const analysis = analysisCache.get(node.key);
      /* istanbul ignore next -- every enqueued node is analysed first */
      if (!analysis) continue;

      for (const t of transitionsFor(analysis, typeTexts)) {
        if (Date.now() - startedAt > opts.timeoutMs) {
          explored.truncated = true;
          explored.reason = 'timeout';
          break;
        }
        if (explored.edges >= opts.maxEdges) {
          explored.truncated = true;
          explored.reason = explored.reason || 'maxEdges';
          break;
        }
        const newCost = node.cost + t.cost;
        // `bound` is snapshotted before the expansion on purpose: pruning must
        // not depend on the order in which this state's edges happen to run.
        if (newCost > bound) continue;

        let navigated = false;
        try {
          await establish(node.steps);
          pageDirty = true; // the transition below changes the page
          // A marker that only survives if the document is not replaced: the
          // reliable way to tell a navigation from an in-page change, even when
          // a link navigates to the URL the page is already on.
          await page.evaluate(() => {
            window.__BFS_MARK = 1;
          });
          for (let i = 0; i < t.steps.length; i += 1) {
            await executeStep(page, t.steps[i], `bfs.edge[${i}] ${t.steps[i].action}`, options);
          }
          navigated = !(await page.evaluate(() => window.__BFS_MARK === 1).catch(() => false));
        } catch (err) {
          noteSkip({ selector: t.selector, reason: `edge-failed: ${err.message}` });
          continue;
        }
        explored.edges += 1;

        let hit = false;
        try {
          hit = await evaluate(normalized.oracle, page, ctx);
        } catch (err) {
          noteSkip({ selector: t.selector, reason: `oracle-failed: ${err.message}` });
        }
        if (hit) {
          if (newCost < best) {
            best = newCost;
            bestPath = node.cmds.concat(t.cmds);
            bestSteps = node.steps.concat(t.steps);
            bestVia = {
              selector: t.selector,
              phrase: t.phrase,
              kind: t.kind,
              depth: node.depth + 1,
            };
          }
          continue; // a goal state is never worth expanding further
        }

        // Not a goal. After a navigation the env re-injects and puts the cursor
        // at document start; otherwise `activate`/`type` leave it on the
        // element it acted on.
        const cursor = navigated ? null : t.selector;
        let fp;
        try {
          fp = await analyze(cursor);
        } catch (err) {
          noteSkip({ selector: t.selector, reason: `analysis-failed: ${err.message}` });
          continue;
        }
        const key = stateKeyOf(fp, cursor);
        // A "page" is a URL: in-page state changes (a dismissed banner, a filled
        // field) are states, not pages, so `maxPages: 1` still searches them.
        const pageKey = fp.url;
        if (seenStates.has(key) || expandedKeys.has(key)) continue;
        // A state dropped by a budget only makes the result inconclusive if
        // something cheaper than the bound could still have come out of it. Any
        // goal beyond this state costs at least `newCost + 1`, so when that
        // already reaches the bound the drop proves nothing was lost.
        const dropCosts = () => {
          if (newCost + 1 < bound) explored.truncated = true;
        };
        if (!seenPages.has(pageKey) && seenPages.size >= opts.maxPages) {
          dropCosts();
          explored.reason = explored.reason || (explored.truncated ? 'maxPages' : null);
          noteSkip({ selector: t.selector, reason: 'maxPages' });
          continue;
        }
        if (seenStates.size >= opts.maxStates) {
          dropCosts();
          explored.reason = explored.reason || (explored.truncated ? 'maxStates' : null);
          noteSkip({ selector: t.selector, reason: 'maxStates' });
          continue;
        }
        if (node.depth + 1 > opts.maxDepth) {
          dropCosts();
          explored.reason = explored.reason || (explored.truncated ? 'maxDepth' : null);
          continue;
        }

        seenStates.add(key);
        seenPages.add(pageKey);
        explored.discovered = seenStates.size;
        explored.pages = seenPages.size;
        analysisCache.set(key, fp);
        for (const s of fp.skipped) noteSkip({ ...s, state: key });
        frontier.push({
          key,
          cost: newCost,
          depth: node.depth + 1,
          steps: node.steps.concat(t.steps),
          cmds: node.cmds.concat(t.cmds),
          cursor,
        });
      }
      if (explored.reason === 'timeout' || explored.reason === 'maxEdges') break;
    }

    if (!explored.truncated && !explored.reason) {
      explored.reason = stoppedByBound ? 'bounded' : 'exhausted';
    }
    explored.ms = Date.now() - startedAt;

    // result classification
    const bestFound = bestPath
      ? { cost: best, path: bestPath, steps: bestSteps, via: bestVia }
      : null;

    if (best < guidedBound && !explored.truncated) {
      explored.reason = 'optimal';
      return { nOptBfs: best, path: bestPath, bestFound, nOptGuided, explored };
    }
    if (explored.truncated) {
      // Budgets cut the search short, so nothing is proved minimal.
      return { nOptBfs: null, path: null, bestFound, nOptGuided, explored };
    }
    if (guidedBound === Infinity) {
      // No guided bound and no goal: nothing found within the (exhaustive) search.
      return best < Infinity
        ? { nOptBfs: best, path: bestPath, bestFound, nOptGuided, explored }
        : { nOptBfs: null, path: null, bestFound: null, nOptGuided, explored };
    }
    // Nothing cheaper than the guided route exists.
    explored.reason = 'bounded-by-guided';
    return { nOptBfs: nOptGuided, path: bestPath, bestFound, nOptGuided, explored };
  } catch (err) {
    const out = fail(err.message);
    out.nOptGuided = nOptGuided;
    out.explored = { ...explored, reason: 'error', ms: Date.now() - startedAt };
    return out;
  } finally {
    recorder.stop();
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * Measure the guided optimum and the BFS optimum for one task side by side.
 * `delta = nOptGuided - nOptBfs`: how many commands the sighted route costs
 * over the best screen-reader route (0 when they agree, `null` when unknown).
 */
async function compareOptima(browser, url, task, options = {}) {
  const startedAt = Date.now();
  const guided = await measureOptimalPath(browser, url, task, options);
  // The BFS goal-tests the task's oracle on the page, so it prices the
  // NAVIGATION only. An information task's guided nOpt additionally contains
  // the final `read` step (reaching the phrase that speaks the evidence), which
  // the BFS never searches for. Comparing the two would report a phantom gap,
  // so the read distance is taken back out before the comparison and reported
  // on its own.
  const readDistance = typeof guided.readDistance === 'number' ? guided.readDistance : null;
  const nOptGuided =
    typeof guided.nOpt === 'number'
      ? guided.nOpt - (readDistance === null ? 0 : readDistance)
      : null;
  const bfs = await computeBfsOptimum(browser, url, task, { ...options, nOptGuided });
  return {
    taskId: task && task.id,
    nOptGuided,
    readDistance,
    nOptBfs: bfs.nOptBfs,
    delta: nOptGuided === null || bfs.nOptBfs === null ? null : nOptGuided - bfs.nOptBfs,
    bfsPath: bfs.path,
    guidedPath: guided.steps || null,
    bestFound: bfs.bestFound,
    explored: bfs.explored,
    error: bfs.error || guided.error,
    ms: Date.now() - startedAt,
  };
}

module.exports = {
  DEFAULTS,
  computeBfsOptimum,
  compareOptima,
  analyzeStateInPage,
  transitionsFor,
  reachCommands,
  typeTextsOf,
  isLocalOrigin,
};
