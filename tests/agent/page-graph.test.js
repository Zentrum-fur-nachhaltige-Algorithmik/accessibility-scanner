import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  buildPageGraph,
  shortestPaths,
  reachGoals,
  pathCost,
  pathCommands,
  strategyCosts,
} = require('../../src/agent/page-graph');
const { commandCost } = require('../../src/agent/screenreader-env');

/**
 * A synthetic reading order, one entry per stop:
 * `{ phrase, kind?, level?, tab?, selector? }`. Stop 0 is document start, the
 * way `describePageInPage` rotates a real page.
 */
function makeDesc(stops, findHits = {}) {
  const rotors = {};
  const tabStops = [];
  const tabSelectors = [];
  stops.forEach((s, i) => {
    if (!s.kind) return;
    const rotor = (rotors[s.kind] = rotors[s.kind] || { items: [], stops: [] });
    rotor.items.push({
      phrase: s.phrase,
      selector: s.selector || `#s${i}`,
      level: s.level || null,
      letter: (s.phrase.split(',').pop() || '').trim().slice(0, 1).toLowerCase(),
    });
    rotor.stops.push(i);
  });
  stops.forEach((s, i) => {
    if (!s.tab) return;
    tabStops.push(i);
    tabSelectors.push(s.selector || `#s${i}`);
  });
  // Tab position per stop: the stop's own index in the tab order, or the
  // position between two stops as `following - 0.5`.
  const tabPos = stops.map((s, i) => {
    const own = tabStops.indexOf(i);
    if (own !== -1) return own;
    let following = tabStops.length;
    for (let t = 0; t < tabStops.length; t += 1) {
      if (tabStops[t] > i) {
        following = t;
        break;
      }
    }
    return following - 0.5;
  });
  return {
    n: stops.length,
    phrases: stops.map((s) => s.phrase),
    selectors: stops.map((s, i) => s.selector || `#s${i}`),
    hrefs: stops.map((s) => s.href || null),
    rotors,
    tabStops,
    tabSelectors,
    tabPos,
    findHits,
  };
}

const PAGE = [
  { phrase: 'document' },
  { phrase: 'heading, Home', kind: 'headings', level: 1, selector: '#home' },
  { phrase: 'link, About', kind: 'links', tab: true, selector: '#about' },
  { phrase: 'paragraph, welcome' },
  { phrase: 'heading, Contact', kind: 'headings', level: 2, selector: '#contact' },
  { phrase: 'link, Phone', kind: 'links', tab: true, selector: '#phone' },
  { phrase: 'paragraph, Ordination hours Monday' },
  { phrase: 'heading, Team', kind: 'headings', level: 2, selector: '#team' },
  { phrase: 'link, Imprint', kind: 'links', tab: true, selector: '#imprint' },
  { phrase: 'paragraph, end' },
];

const graphOf = (stops, hits, cursor = 0) =>
  buildPageGraph(makeDesc(stops, hits), { cursor, findWords: Object.keys(hits || {}) });

/** Shortest reach from `cursor` to `goal`, as the optimum would name it. */
function reach(stops, hits, cursor, goal) {
  const graph = graphOf(stops, hits, cursor);
  const sp = shortestPaths(graph, cursor);
  return reachGoals(sp, [goal]).reach;
}

describe('agent/page-graph: shortest paths over the command graph', () => {
  it('reaches the last link with one prevLink press (the quick-nav keys wrap)', () => {
    const r = reach(PAGE, {}, 0, 8);
    expect(r).toMatchObject({ strategy: 'step', cost: 1 });
    expect(r.via).toMatchObject({
      kind: 'links',
      dir: 'prev',
      command: 'prevLink',
      steps: 1,
      k: 0,
    });
    expect(r.commands).toEqual([{ type: 'prevLink' }]);
  });

  it('takes the heading level over the plain heading step when it is shorter', () => {
    // Two presses of nextHeading reach the h2 "Contact"; the digit key needs one.
    const r = reach(PAGE, {}, 0, 4);
    expect(r).toMatchObject({ strategy: 'stepLevel', cost: 1 });
    expect(r.via).toMatchObject({ level: 2, command: 'nextHeading', steps: 1 });
    expect(r.commands).toEqual([{ type: 'nextHeading', arg: 2 }]);
  });

  it('costs a search 2 and every findNext 1, and never searches backwards', () => {
    const hits = { hours: [6] };
    expect(reach(PAGE, hits, 0, 6)).toMatchObject({ strategy: 'find', cost: 2 });
    // The cursor stands behind the only hit: `find` does not wrap, so the route
    // is the reading order (or a quick-nav key), never a search.
    const back = reach(PAGE, hits, 7, 6);
    expect(back.strategy).not.toMatch(/^find/);
    expect(back).toMatchObject({ strategy: 'prev', cost: 1 });
  });

  it('mixes families: a heading press, then a search, beats every pure strategy', () => {
    // One heading in the middle, the searched word said five times before it and
    // once on the goal: searching from the cursor pays for five `findNext`.
    const long = Array.from({ length: 20 }, (_, i) => ({ phrase: `paragraph, line ${i}` }));
    long[0] = { phrase: 'document' };
    long[10] = { phrase: 'heading, Prices', kind: 'headings', level: 2, selector: '#prices' };
    const hits = { kontakt: [2, 3, 4, 5, 6, 16] };
    const graph = graphOf(long, hits, 0);
    const sp = shortestPaths(graph, 0);
    const mixed = reachGoals(sp, [16]);
    // nextHeading to "Prices" (1), then find (2): three commands.
    expect(mixed.reach.cost).toBe(3);
    expect(mixed.reach.strategy).toBe('path');
    expect(mixed.reach.commands).toEqual([
      { type: 'nextHeading' },
      { type: 'find', arg: 'kontakt' },
    ]);
    // What the per-strategy minimum would have priced, all of it dearer.
    const pure = strategyCosts(graph, 0, [16]);
    expect(pure.find.cost).toBe(7);
    expect(pure.next).toBe(16);
    expect(pure.prev).toBe(4);
    expect(pure.step.cost).toBe(7);
    expect(pure.rotor.cost).toBe(8);
  });

  it('opens the rotor list at the cursor: the jumpTo index is cursor-relative', () => {
    // From document start the links list is About, Phone, Imprint ...
    const graph = graphOf(PAGE, {}, 0);
    expect(strategyCosts(graph, 0, [5]).rotor).toMatchObject({ kind: 'links', index: 1, cost: 2 });
    // ... and from the "Phone" link the same list starts at Phone.
    const later = graphOf(PAGE, {}, 5);
    expect(strategyCosts(later, 5, [2]).rotor).toMatchObject({ kind: 'links', index: 2, cost: 2 });
  });

  it('opens the rotor list later when fewer entries have to be revealed', () => {
    // Twenty links, then a landmark with the target as its third link: from the
    // start the links list needs two `more` presses (2 + 2), after one
    // nextLandmark press the same list starts at the landmark (1 + 2).
    const stops = [{ phrase: 'document' }];
    for (let i = 1; i <= 20; i += 1) stops.push({ phrase: `link, Menu ${i}`, kind: 'links' });
    stops.push({ phrase: 'main', kind: 'landmarks' });
    stops.push({ phrase: 'link, Menu Alpha', kind: 'links' });
    stops.push({ phrase: 'link, Menu Beta', kind: 'links' });
    stops.push({ phrase: 'link, Menu Gamma', kind: 'links', selector: '#gamma' });
    // More links behind the target, so wrapping backwards is no shortcut.
    for (let i = 1; i <= 6; i += 1) stops.push({ phrase: `link, Footer ${i}`, kind: 'links' });
    const graph = buildPageGraph(makeDesc(stops), { cursor: 0 });
    const sp = shortestPaths(graph, 0);
    const found = reachGoals(sp, [24]);
    expect(strategyCosts(graph, 0, [24]).rotor.cost).toBe(4);
    expect(found.reach.cost).toBe(3);
    expect(found.reach.commands.map((c) => c.type)).toEqual([
      'nextLandmark',
      'links',
      'jumpTo',
    ]);
  });

  it('pays for revealing a rotor entry: one `more` per page, or a letter jump', () => {
    const many = [{ phrase: 'document' }];
    for (let i = 1; i <= 24; i += 1) {
      many.push({
        phrase: `link, ${i === 20 ? 'Zebra' : `Item ${i}`}`,
        kind: 'links',
        selector: `#l${i}`,
      });
    }
    const graph = graphOf(many, {}, 0);
    const rotor = graph.rotors.links;
    expect(rotor[0].reveal).toMatchObject({ cost: 0, pages: 0 });
    expect(rotor[9].reveal).toMatchObject({ cost: 1, pages: 1 });
    // Entry 19 sits on the third page, and it is the only one starting with Z,
    // so one `rotorLetter` beats two `more`.
    expect(rotor[19].reveal).toMatchObject({ cost: 1, letter: 'z' });
    expect(rotor[18].reveal).toMatchObject({ cost: 2, pages: 2 });
  });

  it('reaches an element the reading order never visits by Tab alone', () => {
    const stops = PAGE.slice();
    const desc = makeDesc(stops, {});
    // A focusable that is not a reading-order stop: only Tab gets there.
    desc.tabStops = [2, -1, 5, 8];
    desc.tabSelectors = ['#about', '#offscreen', '#phone', '#imprint'];
    desc.tabPos[2] = 0;
    desc.tabPos[5] = 2;
    desc.tabPos[8] = 3;
    const graph = buildPageGraph(desc, { cursor: 0 });
    const offscreen = graph.tabNode[1];
    const sp = shortestPaths(graph, 0);
    const r = reachGoals(sp, [offscreen]).reach;
    // Only the tab order lands there, so the route ends on Tab or Shift+Tab.
    expect(r.cost).toBe(2);
    expect(r.commands[r.commands.length - 1].type).toMatch(/^(tab|shiftTab)$/);
    // Without a tab order it is not reachable at all.
    const noTabs = buildPageGraph(
      { ...desc, tabStops: [], tabPos: [], tabSelectors: [] },
      {
        cursor: 0,
      }
    );
    expect(shortestPaths(noTabs, 0).dist[offscreen]).toBe(undefined);
  });

  it('costs nothing when the cursor already stands on the target', () => {
    expect(reach(PAGE, {}, 4, 4)).toEqual({ strategy: 'none', cost: 0, commands: [] });
  });

  it('every path costs exactly what its commands cost', () => {
    const hits = { hours: [6], welcome: [3] };
    const graph = graphOf(PAGE, hits, 0);
    const sp = shortestPaths(graph, 0);
    for (let goal = 0; goal < PAGE.length; goal += 1) {
      const best = reachGoals(sp, [goal]);
      const commands = pathCommands(best.edges);
      expect(pathCost(best.edges)).toBe(commands.reduce((n, c) => n + commandCost(c.type), 0));
      expect(best.reach.cost).toBe(sp.dist[goal]);
    }
  });

  it('adds one `next` per extra phrase of a goal that spans several stops', () => {
    const graph = graphOf(PAGE, {}, 0);
    const sp = shortestPaths(graph, 0);
    const best = reachGoals(sp, [{ node: 6, extra: 1 }]);
    expect(best.reach.cost).toBe(sp.dist[6] + 1);
    expect(best.reach.via.spanPhrases).toBe(2);
    expect(best.reach.commands[best.reach.commands.length - 1]).toEqual({ type: 'next' });
  });
});
