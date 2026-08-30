/**
 * page-graph: the screen-reader command graph of ONE page, and Dijkstra over it.
 *
 * Nodes are the stops of the page's reading order (plus the tab stops the
 * reading order never visits). Edges are the commands that move the cursor,
 * each priced with `screenreader-env.commandCost`: next/prev, tab/shiftTab, the
 * quick-nav keys (per kind and per heading level), a rotor list plus `jumpTo`,
 * and `find` plus `findNext`. Reaching a target is then a shortest path, so a
 * route that MIXES strategies (rotor to a landmark, then find, then next) is
 * priced like any other; a minimum over whole strategies never sees it.
 *
 * Pure Node: the page description comes from one in-page reading-order walk
 * (see optimal-path.js `describePageInPage`), everything here is arithmetic.
 */

'use strict';

const {
  COMMAND_COSTS,
  ROTOR_STEP_COMMANDS,
  ROTOR_PAGE_SIZE,
  commandCost,
} = require('./screenreader-env');

/** `{ headings: { next: 'nextHeading', prev: 'prevHeading' }, … }` */
const STEP_COMMAND_BY_KIND = Object.entries(ROTOR_STEP_COMMANDS).reduce((acc, [cmd, def]) => {
  acc[def.kind] = acc[def.kind] || {};
  acc[def.kind][def.dir] = cmd;
  return acc;
}, {});

const mod = (a, n) => ((a % n) + n) % n;

/**
 * Cap on the `findNext` presses one search edge chains, away from the cursor the
 * route starts at. The j-th hit costs 2 + j, so past this cap reading on or a
 * rotor jump wins on any real page; the cap keeps the edge count linear on a
 * page that says the searched word everywhere. From the start node the chain is
 * unbounded, so the route the previous per-strategy minimum priced is never lost.
 */
const MAX_FIND_NEXTS = 8;

/** Binary min-heap over (node, cost); ties keep insertion order. */
class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(node, cost) {
    const items = this.items;
    items.push({ node, cost });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].cost <= items[i].cost) break;
      [items[p], items[i]] = [items[i], items[p]];
      i = p;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].cost < items[m].cost) m = l;
        if (r < items.length && items[r].cost < items[m].cost) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Ascending stops of every element of `kind`, from the page description. */
function stopsOfKind(desc, kind) {
  const rotor = desc.rotors && desc.rotors[kind];
  if (!rotor) return [];
  return rotor.stops.filter((s) => s >= 0).sort((a, b) => a - b);
}

/**
 * The rotor list as it looks when it is opened AT `cursor`: the env builds it
 * from a reading-order walk that starts at the cursor, so both the `jumpTo`
 * index and the cost of revealing an entry (one `more` per page of
 * ROTOR_PAGE_SIZE, or one `rotorLetter` when the entry is the first with its
 * letter) are cursor-relative.
 */
function rotorEntriesFrom(desc, kind, cursor, n, pageSize) {
  const rotor = desc.rotors && desc.rotors[kind];
  if (!rotor) return [];
  const entries = rotor.items
    .map((item, i) => ({ item, stop: rotor.stops[i] }))
    .filter((e) => e.stop >= 0)
    .sort((a, b) => mod(a.stop - cursor, n) - mod(b.stop - cursor, n));
  const seenLetter = new Set();
  return entries.map((e, index) => {
    const letter = e.item.letter || '';
    const firstOfLetter = !!letter && !seenLetter.has(letter);
    if (letter) seenLetter.add(letter);
    const pages = Math.floor(index / pageSize);
    // A first-letter jump is only worth its one keystroke past the second page.
    const reveal =
      firstOfLetter && pages > 1
        ? { cost: 1, pages: 0, letter }
        : { cost: pages, pages, letter: null };
    return {
      kind,
      index,
      stop: e.stop,
      phrase: e.item.phrase == null ? null : e.item.phrase,
      selector: e.item.selector || null,
      level: e.item.level == null ? null : e.item.level,
      reveal,
    };
  });
}

/**
 * Build the command graph of one page as seen FROM `options.cursor` (the rotor
 * lists and the search window are cursor-relative, so the graph is too).
 *
 * @param {object} desc page description, see optimal-path `describePageInPage`
 * @param {{cursor?: number, findWords?: string[]}} [options]
 */
function buildPageGraph(desc, options = {}) {
  const n = desc.n;
  const cursor = Number.isInteger(options.cursor) && options.cursor >= 0 ? options.cursor : 0;
  const pageSize = desc.rotorPageSize || ROTOR_PAGE_SIZE;
  const kinds = Object.keys(desc.rotors || {});

  const kindStops = {};
  for (const kind of kinds) kindStops[kind] = stopsOfKind(desc, kind);

  // Heading levels are their own quick-nav sequence (the digit keys).
  const levelStops = {};
  const headings = desc.rotors && desc.rotors.headings;
  if (headings) {
    headings.items.forEach((item, i) => {
      const stop = headings.stops[i];
      if (!item.level || stop < 0) return;
      (levelStops[item.level] = levelStops[item.level] || []).push(stop);
    });
    for (const level of Object.keys(levelStops)) levelStops[level].sort((a, b) => a - b);
  }

  const rotors = {};
  for (const kind of kinds) rotors[kind] = rotorEntriesFrom(desc, kind, cursor, n, pageSize);

  // Tab stops the reading order never visits still deserve a node: an element
  // outside the reading order is reachable by Tab and by nothing else.
  const tabNode = [];
  let extra = 0;
  const extraSelectors = [];
  for (const stop of desc.tabStops || []) {
    if (stop >= 0) tabNode.push(stop);
    else {
      tabNode.push(n + extra);
      extraSelectors.push(null);
      extra += 1;
    }
  }
  const tabPosOfNode = new Map();
  (desc.tabPos || []).forEach((pos, i) => {
    if (pos !== null && pos !== undefined) tabPosOfNode.set(i, pos);
  });
  tabNode.forEach((node, t) => tabPosOfNode.set(node, t));

  const findHits = {};
  const words = options.findWords || Object.keys(desc.findHits || {});
  for (const word of words) {
    const hits = (desc.findHits && desc.findHits[word]) || [];
    if (hits.length) findHits[word] = hits.slice().sort((a, b) => a - b);
  }

  return {
    n,
    nodeCount: n + extra,
    cursor,
    desc,
    kinds,
    kindStops,
    levelStops,
    rotors,
    tabNode,
    tabPosOfNode,
    findHits,
    extraSelectors,
  };
}

/** The selector of a node, for reporting. */
function selectorOfNode(graph, node) {
  if (node < graph.n) return (graph.desc.selectors || [])[node] || null;
  const t = graph.tabNode.indexOf(node);
  return t === -1 ? null : (graph.desc.tabSelectors || [])[t] || null;
}

/** The spoken phrase of a node, for reporting. */
function phraseOfNode(graph, node) {
  return node < graph.n ? (graph.desc.phrases || [])[node] || null : null;
}

/** Nearest stop of `stops` strictly after / before `i`, cyclically. */
function stepTarget(stops, i, n, dir) {
  if (!stops.length) return -1;
  let best = -1;
  let bestD = Infinity;
  for (const s of stops) {
    const d = dir === 'next' ? mod(s - i, n) : mod(i - s, n);
    // Distance 0 is the stop itself; the env wraps a full lap back onto it.
    const dd = d === 0 ? n : d;
    if (dd < bestD) {
      bestD = dd;
      best = s;
    }
  }
  return best;
}

/**
 * Outgoing edges of `node`. They are emitted in preference order (quick-nav
 * key, rotor list, Tab, search, reading order), which is what breaks a tie
 * between two equally expensive routes. Rotor edges are emitted from the
 * start node only: their cost does not depend on where the cursor is, so a
 * route that opens a rotor list half way is never cheaper than one that opens it
 * straight away.
 */
function* neighbours(graph, node, source) {
  const n = graph.n;
  if (node < n) {
    for (const kind of graph.kinds) {
      for (const dir of ['next', 'prev']) {
        const to = stepTarget(graph.kindStops[kind], node, n, dir);
        if (to < 0 || to === node) continue;
        const command = (STEP_COMMAND_BY_KIND[kind] || {})[dir];
        if (!command) continue;
        yield { type: 'step', kind, dir, command, to, cost: 1 };
      }
    }
    for (const level of Object.keys(graph.levelStops)) {
      for (const dir of ['next', 'prev']) {
        const to = stepTarget(graph.levelStops[level], node, n, dir);
        if (to < 0 || to === node) continue;
        const command = (STEP_COMMAND_BY_KIND.headings || {})[dir];
        if (!command) continue;
        yield {
          type: 'stepLevel',
          kind: 'headings',
          level: Number(level),
          dir,
          command,
          to,
          cost: 1,
        };
      }
    }
  }

  if (node === source) {
    for (const kind of graph.kinds) {
      for (const entry of graph.rotors[kind]) {
        if (entry.stop === node) continue;
        yield {
          type: 'rotor',
          kind,
          index: entry.index,
          pages: entry.reveal.pages,
          letter: entry.reveal.letter,
          phrase: entry.phrase,
          selector: entry.selector,
          to: entry.stop,
          cost: 2 + entry.reveal.cost,
        };
      }
    }
  }

  const pos = graph.tabPosOfNode.get(node);
  if (pos !== undefined) {
    const forward = Number.isInteger(pos) ? pos + 1 : Math.ceil(pos);
    const backward = Number.isInteger(pos) ? pos - 1 : Math.floor(pos);
    if (forward >= 0 && forward < graph.tabNode.length)
      yield { type: 'tab', to: graph.tabNode[forward], cost: 1 };
    if (backward >= 0 && backward < graph.tabNode.length)
      yield { type: 'shiftTab', to: graph.tabNode[backward], cost: 1 };
  }

  if (node < n) {
    // `find` does not wrap: it searches from the cursor to the end of the
    // document, and the description is rotated so document start is index 0.
    const limit = node === source ? Infinity : MAX_FIND_NEXTS;
    for (const word of Object.keys(graph.findHits)) {
      let j = 0;
      for (const hit of graph.findHits[word]) {
        if (hit <= node) continue;
        if (j > limit) break;
        yield {
          type: 'find',
          word,
          findNexts: j,
          to: hit,
          cost: COMMAND_COSTS.find + j,
        };
        j += 1;
      }
    }
    yield { type: 'next', to: mod(node + 1, n), cost: 1 };
    yield { type: 'prev', to: mod(node - 1, n), cost: 1 };
  }
}

/**
 * Dijkstra from `source` over the whole graph. One run serves every goal set on
 * the page (a step's equivalence class, the evidence phrases, a later waypoint's
 * link), which is why it returns the full distance table.
 */
function shortestPaths(graph, source) {
  const size = graph.nodeCount;
  const dist = new Array(size).fill(Infinity);
  const via = new Array(size).fill(null);
  const done = new Array(size).fill(false);
  dist[source] = 0;
  const heap = new MinHeap();
  heap.push(source, 0);
  while (heap.size) {
    const { node: u, cost: d } = heap.pop();
    if (done[u]) continue;
    done[u] = true;
    if (d > dist[u]) continue;
    for (const edge of neighbours(graph, u, source)) {
      const v = edge.to;
      if (v < 0 || v >= size) continue;
      const nd = d + edge.cost;
      if (nd < dist[v]) {
        dist[v] = nd;
        via[v] = { from: u, edge };
        heap.push(v, nd);
      }
    }
  }
  return { dist, via, source, graph };
}

/** The edges of the shortest path to `node`, in order. */
function pathTo(sp, node) {
  if (!Number.isInteger(node) || node < 0 || sp.dist[node] === Infinity) return null;
  const edges = [];
  let cur = node;
  while (cur !== sp.source) {
    const step = sp.via[cur];
    if (!step) return null;
    edges.unshift(step.edge);
    cur = step.from;
  }
  return edges;
}

/** The literal env commands of one edge; they add up to the edge's cost. */
function edgeCommands(edge) {
  const repeat = (type, k) => Array.from({ length: k }, () => ({ type }));
  switch (edge.type) {
    case 'step':
      return [{ type: edge.command }];
    case 'stepLevel':
      return [{ type: edge.command, arg: edge.level }];
    case 'rotor':
      return [
        { type: edge.kind },
        ...(edge.letter
          ? [{ type: 'rotorLetter', arg: edge.letter }]
          : repeat('more', edge.pages || 0)),
        { type: 'jumpTo', arg: edge.index },
      ];
    case 'find':
      return [{ type: 'find', arg: edge.word }, ...repeat('findNext', edge.findNexts)];
    default:
      return [{ type: edge.type }];
  }
}

/** All commands of a path, in order. */
function pathCommands(edges) {
  const out = [];
  for (const edge of edges || []) for (const cmd of edgeCommands(edge)) out.push(cmd);
  return out;
}

/** What a path costs, charged command by command. */
function pathCost(edges) {
  return pathCommands(edges).reduce((sum, cmd) => sum + commandCost(cmd.type), 0);
}

const isNext = (e) => e.type === 'next';

/**
 * Name a path the way the per-strategy minimum used to name it, so traces and
 * recorded runs stay readable: a run of one quick-nav key followed by `next`
 * presses is still `step+next`, a rotor jump plus `next` is `rotor+next`, and so
 * on. A path that really mixes families is reported as `path`, with its edges.
 * `commands` is always the literal keystroke list.
 */
function classifyReach(edges) {
  const list = edges || [];
  const cost = pathCost(list);
  const commands = pathCommands(list);
  if (!list.length) return { strategy: 'none', cost: 0, commands: [] };

  const tail = [];
  let head = list.length;
  while (head > 0 && isNext(list[head - 1])) {
    head -= 1;
    tail.unshift(list[head]);
  }
  const k = tail.length;
  const lead = list.slice(0, head);
  const suffix = k ? '+next' : '';

  const all = (type) => list.every((e) => e.type === type);
  if (all('next')) return { strategy: 'next', cost, commands };
  if (all('prev')) return { strategy: 'prev', cost, commands };
  if (all('tab')) return { strategy: 'tab', cost, commands };
  if (all('shiftTab')) return { strategy: 'shiftTab', cost, commands };

  if (lead.length === 1 && lead[0].type === 'rotor') {
    const r = lead[0];
    return {
      strategy: `rotor${suffix}`,
      cost,
      via: {
        kind: r.kind,
        index: r.index,
        k,
        pages: r.pages || 0,
        letter: r.letter || null,
        phrase: r.phrase,
        selector: r.selector,
      },
      commands,
    };
  }
  if (lead.length === 1 && lead[0].type === 'find') {
    const f = lead[0];
    return {
      strategy: `find${suffix}`,
      cost,
      via: { word: f.word, findNexts: f.findNexts, k },
      commands,
    };
  }
  if (
    lead.length > 0 &&
    lead.every((e) => e.type === 'step' && e.command === lead[0].command && e.kind === lead[0].kind)
  ) {
    const s = lead[0];
    return {
      strategy: `step${suffix}`,
      cost,
      via: { kind: s.kind, dir: s.dir, command: s.command, steps: lead.length, k },
      commands,
    };
  }
  if (
    lead.length > 0 &&
    lead.every(
      (e) => e.type === 'stepLevel' && e.command === lead[0].command && e.level === lead[0].level
    )
  ) {
    const s = lead[0];
    return {
      strategy: `stepLevel${suffix}`,
      cost,
      via: {
        kind: 'headings',
        level: s.level,
        dir: s.dir,
        command: s.command,
        steps: lead.length,
        k,
      },
      commands,
    };
  }
  return {
    strategy: 'path',
    cost,
    via: { edges: list.map((e) => ({ type: e.type, command: e.command || null, to: e.to })) },
    commands,
  };
}

/**
 * The cheapest route to any of `goals`, as a named reach. `goals` may carry an
 * `extra` cost (an evidence phrase spanning several stops costs the `next`
 * presses that read on).
 */
function reachGoals(sp, goals) {
  let best = null;
  for (const goal of goals) {
    const node = typeof goal === 'number' ? goal : goal.node;
    const extra = (typeof goal === 'number' ? 0 : goal.extra) || 0;
    const base = sp.dist[node];
    if (base === undefined || base === Infinity) continue;
    const cost = base + extra;
    if (!best || cost < best.cost) best = { node, extra, cost, goal };
  }
  if (!best) return null;
  const edges = pathTo(sp, best.node) || [];
  const reach = classifyReach(edges);
  if (best.extra) {
    reach.cost += best.extra;
    reach.via = { ...(reach.via || {}), spanPhrases: best.extra + 1 };
    reach.commands = [
      ...reach.commands,
      ...Array.from({ length: best.extra }, () => ({ type: 'next' })),
    ];
  }
  return { node: best.node, goal: best.goal, edges, reach };
}

/**
 * The pure single-strategy costs of reaching `goals`, exactly as the old
 * per-strategy minimum computed them. Diagnostics only: the shortest path is
 * what nOpt is made of, but a recorded run should still show what stepping,
 * the rotor, tabbing or a search alone would have cost.
 */
function strategyCosts(graph, source, goals) {
  const n = graph.n;
  const stops = goals.filter((g) => g < n);
  const out = {
    inReadingOrder: stops.length > 0,
    next: null,
    prev: null,
    tab: null,
    rotor: null,
    step: null,
    stepLevel: null,
    find: null,
  };
  for (const g of stops) {
    const f = mod(g - source, n);
    const b = mod(source - g, n);
    if (out.next === null || f < out.next) out.next = f;
    if (out.prev === null || b < out.prev) out.prev = b;
  }

  const sourcePos = graph.tabPosOfNode.get(source);
  if (sourcePos !== undefined) {
    for (const g of goals) {
      const t = graph.tabPosOfNode.get(g);
      if (t === undefined || !Number.isInteger(t)) continue;
      const cand =
        t >= sourcePos
          ? { dir: 'tab', cost: Math.ceil(t - sourcePos) }
          : { dir: 'shiftTab', cost: Math.ceil(sourcePos - t) };
      if (!out.tab || cand.cost < out.tab.cost) out.tab = cand;
    }
  }

  for (const kind of graph.kinds) {
    for (const entry of graph.rotors[kind]) {
      for (const g of stops) {
        const k = mod(g - entry.stop, n);
        const cost = 2 + entry.reveal.cost + k;
        if (!out.rotor || cost < out.rotor.cost) {
          out.rotor = {
            kind,
            index: entry.index,
            k,
            cost,
            pages: entry.reveal.pages,
            letter: entry.reveal.letter,
            phrase: entry.phrase,
            selector: entry.selector,
          };
        }
      }
    }
  }

  // Presses of one quick-nav key: the stops of the kind ranked by distance from
  // the cursor, the cheaper direction winning, then `next` to the goal.
  const pressCosts = (positions) => {
    const costs = new Map();
    const put = (stop, steps, dir) => {
      const cur = costs.get(stop);
      if (!cur || steps < cur.steps) costs.set(stop, { steps, dir });
    };
    const fwd = positions
      .map((p) => ({ p, d: mod(p - source, n) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => a.d - b.d);
    const bwd = positions
      .map((p) => ({ p, d: mod(source - p, n) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => a.d - b.d);
    fwd.forEach((x, r) => put(x.p, r + 1, 'next'));
    bwd.forEach((x, r) => put(x.p, r + 1, 'prev'));
    // One full lap re-speaks the stop the cursor already sits on.
    for (const p of positions) if (mod(p - source, n) === 0) put(p, positions.length, 'next');
    return costs;
  };

  for (const kind of graph.kinds) {
    const positions = graph.kindStops[kind];
    if (!positions.length) continue;
    const costs = pressCosts(positions);
    for (const [stop, c] of costs) {
      for (const g of stops) {
        const k = mod(g - stop, n);
        const cost = c.steps + k;
        if (!out.step || cost < out.step.cost || (cost === out.step.cost && k < out.step.k)) {
          out.step = {
            kind,
            dir: c.dir,
            command: (STEP_COMMAND_BY_KIND[kind] || {})[c.dir] || null,
            steps: c.steps,
            k,
            cost,
          };
        }
      }
    }
  }
  if (out.step && !out.step.command) out.step = null;

  for (const level of Object.keys(graph.levelStops)) {
    const positions = graph.levelStops[level];
    if (!positions.length) continue;
    const costs = pressCosts(positions);
    for (const [stop, c] of costs) {
      for (const g of stops) {
        const k = mod(g - stop, n);
        const cost = c.steps + k;
        if (
          !out.stepLevel ||
          cost < out.stepLevel.cost ||
          (cost === out.stepLevel.cost && k < out.stepLevel.k)
        ) {
          out.stepLevel = {
            kind: 'headings',
            level: Number(level),
            dir: c.dir,
            command: (STEP_COMMAND_BY_KIND.headings || {})[c.dir] || null,
            steps: c.steps,
            k,
            cost,
          };
        }
      }
    }
  }
  if (out.stepLevel && !out.stepLevel.command) out.stepLevel = null;

  for (const word of Object.keys(graph.findHits)) {
    const hits = graph.findHits[word].filter((h) => h > source);
    hits.forEach((hit, j) => {
      for (const g of stops) {
        if (g < hit) continue;
        const k = g - hit;
        const cost = COMMAND_COSTS.find + j + k;
        if (!out.find || cost < out.find.cost || (cost === out.find.cost && k < out.find.k)) {
          out.find = { word, findNexts: j, k, cost };
        }
      }
    });
  }

  return out;
}

module.exports = {
  buildPageGraph,
  shortestPaths,
  pathTo,
  reachGoals,
  classifyReach,
  edgeCommands,
  pathCommands,
  pathCost,
  strategyCosts,
  selectorOfNode,
  phraseOfNode,
  stepTarget,
  MAX_FIND_NEXTS,
  STEP_COMMAND_BY_KIND,
};
