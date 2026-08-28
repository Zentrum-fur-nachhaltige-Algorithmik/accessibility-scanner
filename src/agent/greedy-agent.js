/**
 * Stage 2 of the metric ladder: a greedy screen-reader agent without an LLM.
 *
 * It answers one question: how far does a user get who can only match WORDS,
 * without understanding the page? The only thing it can do is compare the task
 * description with what the screen reader speaks; it never sees selectors, DOM
 * or the oracle, and it makes no plan beyond the fixed policy below.
 *
 * Policy, deterministic, one command per step:
 *  1. The task description is tokenised into keywords (letters only, folded,
 *     stopwords out, >= 3 letters, stemmed). The similarity of a spoken phrase
 *     is the number of those keywords it carries, plus a small bonus when the
 *     phrase's role word is link, button or heading.
 *  2. On a fresh page: open the `links` list and `more` through it until an
 *     entry scores; jump there and activate it. If the list is exhausted, an
 *     action task tries `headings`, then `landmarks` (navigation first) to move
 *     the cursor into a promising region, then `find` with the longest keyword,
 *     and as a last resort walks with `nextLink` for a bounded number of steps.
 *     An information task stops after the links list: its reading phase opens
 *     its own lists and runs its own searches.
 *  3. After a page change, an action task is `done` once the loaded page's own
 *     phrases score; otherwise the policy repeats step 2 on the new page, for at
 *     most `MAX_PAGE_CHANGES` pages.
 *  4. An information task reads after arriving: `headings`, jump to the
 *     best-scoring heading, then `next` for up to `READ_STOPS` stops. It is
 *     `done` once a spoken phrase carries `ANSWER_KEYWORDS` keywords or looks
 *     like the task's `answerType` (phone, email, address, hours). Otherwise it
 *     tries the next heading and then `find` with each keyword.
 *  5. A jump target that was already activated is never used twice, and a `mark`
 *     with kind `backtrack` (free) records every page or heading the policy
 *     gives up on, including the end of the budget, with the reason.
 *
 * Same interface as `runSrAgent`, so the harness can drive either one:
 * `{ env, task, maxSteps, onStep }` in, `{ nSr, steps, trace, stoppedBy, usage }`
 * out. `llm` and `model` are accepted and ignored; the usage is all zeros.
 */

'use strict';

const { fold, isStructuralPhrase } = require('./answer-match');
const { STOPWORDS, stemOf } = require('./task-generator');
const { commandCost, phraseRole } = require('./screenreader-env');

/** Shortest word the policy still treats as a keyword. */
const MIN_KEYWORD_LENGTH = 3;
/**
 * Three-letter function words of both languages this runs in. The generator's
 * STOPWORDS start at four letters, and without these "the" would match every
 * link on the page and "find" would search for it.
 */
const SHORT_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'was',
  'its',
  'our',
  'you',
  'all',
  'any',
  'can',
  'has',
  'how',
  'who',
  'why',
  'out',
  'get',
  'let',
  'via',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'und',
  'ist',
  'sie',
  'wie',
  'wer',
  'mit',
  'auf',
  'aus',
  'bei',
  'bis',
  'vom',
  'von',
  'zum',
  'zur',
  'nur',
  'ich',
  'wir',
  'ihr',
  'uns',
]);
/** Added to a scoring phrase that is a link, a button or a heading. */
const ROLE_BONUS = 0.5;
const ROLE_WORDS = ['link', 'button', 'heading'];
/** Pages the policy is willing to open before it gives up. */
const MAX_PAGE_CHANGES = 3;
/** `more` presses spent on a rotor list while nothing in it scores. */
const MAX_ROTOR_PAGES = 3;
/** Scoring links activated per page before the page is abandoned. */
const MAX_ACTIVATIONS = 2;
/** `nextLink` presses of the last-resort walk. */
const MAX_WALK = 6;
/** `next` presses spent reading under one heading. */
const READ_STOPS = 8;
/** Headings read on an information task before it falls back to `find`. */
const MAX_READ_HEADINGS = 3;
/** Keywords a spoken phrase must carry to count as the answer. */
const ANSWER_KEYWORDS = 2;
/** `find` searches tried on an information task. */
const MAX_FINDS = 3;

/** Shapes an `answerType` value is written in, used without knowing the answer. */
const ANSWER_SHAPES = {
  phone: (text) => /(?:\+|00|\(|\b0)[\d\s/().-]{7,}/.test(text) && digits(text).length >= 7,
  email: (text) => /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text),
  address: (text) =>
    /\b\p{L}{3,}(?:strasse|straße|str\.|gasse|weg|platz|allee|street|road|avenue)\b[^\d]{0,4}\d/iu.test(
      text
    ) || /\b\d{4,5}\s+\p{Lu}\p{L}{2,}/u.test(text),
  hours: (text) => /\b\d{1,2}\s*(?::|\.|h|uhr)\s*\d{2}\b/i.test(text),
};

const digits = (s) => String(s == null ? '' : s).replace(/\D+/g, '');

const numberOr = (value, fallback) =>
  typeof value === 'number' && !Number.isNaN(value) ? value : fallback;

/** Letters only, folded, lowercase, stopwords out, deduplicated by stem. */
function keywordsOf(description) {
  const seen = new Set();
  const out = [];
  for (const raw of fold(description)
    .replace(/[^\p{L}]+/gu, ' ')
    .split(/\s+/)) {
    if (raw.length < MIN_KEYWORD_LENGTH) continue;
    if (STOPWORDS.has(raw) || SHORT_STOPWORDS.has(raw)) continue;
    const stem = stemOf(raw);
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push({ word: raw, stem });
  }
  return out;
}

/**
 * How well a spoken phrase matches the task: the number of task keywords it
 * carries (`score`), plus the role bonus for ranking (`rank`). The bonus only
 * applies on top of a real keyword match, so a role word alone never scores.
 */
function scorePhrase(phrase, keywords) {
  const hay = fold(phrase).replace(/[^\p{L}\p{N}]+/gu, ' ');
  const matched = (keywords || []).filter((k) => hay.includes(k.stem) || hay.includes(k.word));
  const role = fold(phraseRole(phrase));
  const bonus = matched.length > 0 && ROLE_WORDS.some((w) => role.startsWith(w)) ? ROLE_BONUS : 0;
  return {
    score: matched.length,
    rank: matched.length + bonus,
    matched: matched.map((k) => k.word),
  };
}

/** The entry text alone ("heading, Kontakt, level 2" -> "Kontakt"). */
function entryLabel(phrase) {
  const text = String(phrase == null ? '' : phrase).replace(/,\s*level\s*\d+\s*$/i, '');
  const idx = text.indexOf(',');
  return (idx === -1 ? text : text.slice(idx + 1)).trim() || text.trim();
}

/**
 * Run the greedy agent against one task.
 *
 * @param {object} args
 * @param {object} args.env - ScreenReaderEnv (or anything with step/trace)
 * @param {object} args.task - `{ description, kind, answerType, ... }`
 * @param {number} [args.maxSteps] - step budget; defaults to `env.maxSteps`
 * @param {(obs: object, cmd: object) => any} [args.onStep] - harness hook; `{ stop: true, reason }` ends the run
 * @returns {Promise<{success: null, nSr: number, steps: number, trace: any[], stoppedBy: string, usage: object}>}
 */
async function runGreedyAgent({ env, task, maxSteps, onStep }) {
  if (!env || typeof env.step !== 'function')
    throw new Error('runGreedyAgent: env with step() is required');
  if (!task || !task.description)
    throw new Error('runGreedyAgent: task with a description is required');

  const keywords = keywordsOf(task.description);
  const wanted = keywords.map((k) => k.word).join(', ') || '(no keywords)';
  const info = task.kind === 'information';
  const budget = numberOr(maxSteps, numberOr(env.maxSteps, 30));

  const state = {
    steps: 0,
    left: budget,
    stoppedBy: null,
    /** Folded phrases of jump targets that were already activated or read. */
    visited: new Set(),
    pageChanges: 0,
  };

  const running = (cost = 1) => state.stoppedBy == null && state.left >= cost;

  /** Issue one command, keep the budget, let the harness stop the run. */
  async function step(type, arg, note) {
    const cmd = { type, ...(arg === undefined ? {} : { arg }), ...(note ? { note } : {}) };
    const obs = (await env.step(cmd)) || {};
    if (!obs.free) {
      state.steps += commandCost(type);
      state.left = Math.min(budget - state.steps, numberOr(obs.budgetLeft, Infinity));
    }
    let signal;
    if (typeof onStep === 'function') signal = await onStep(obs, cmd);
    if (signal && signal.stop) state.stoppedBy = signal.reason || 'oracle';
    else if (type === 'done') state.stoppedBy = 'done';
    else if (state.left <= 0) state.stoppedBy = 'budget';
    return obs;
  }

  const mark = (reason) => step('mark', { kind: 'backtrack', reason }, reason);
  const finish = (note) => step('done', undefined, note);

  /** A new document was loaded, the only page change a screen reader notices. */
  const changedPage = (obs) =>
    !!obs.urlChanged || (obs.announcements || []).some((a) => /^page loaded/i.test(a));

  /** Does this observation speak the answer of an information task? */
  function speaksAnswer(obs) {
    const heard = [obs.phrase, ...(obs.announcements || [])].filter(
      (p) => typeof p === 'string' && p.trim() !== '' && !isStructuralPhrase(p)
    );
    for (const phrase of heard) {
      const { score, matched } = scorePhrase(phrase, keywords);
      if (score >= ANSWER_KEYWORDS)
        return `heard "${entryLabel(phrase)}", which carries ${score} of ${keywords.length} keywords (${matched.join(', ')})`;
      const shape = ANSWER_SHAPES[task.answerType];
      if (shape && shape(phrase))
        return `heard "${entryLabel(phrase)}", which looks like the ${task.answerType} the task asks for`;
    }
    return null;
  }

  /** Collect the entries a rotor observation has shown, scored and deduplicated. */
  function collect(into, obs) {
    if (!obs.rotor || !Array.isArray(obs.rotor.items)) return into;
    for (const item of obs.rotor.items) {
      if (into.some((e) => e.index === item.index)) continue;
      into.push({ index: item.index, phrase: item.phrase, ...scorePhrase(item.phrase, keywords) });
    }
    return into;
  }

  /** The best entry that scores at all and has not been used yet. */
  function bestEntry(entries) {
    let best = null;
    for (const e of entries) {
      if (e.score <= 0) continue;
      if (state.visited.has(fold(e.phrase))) continue;
      if (!best || e.rank > best.rank) best = e;
    }
    return best;
  }

  const scoreNote = (kind, entry) =>
    `best ${kind} "${entryLabel(entry.phrase)}" scores ${entry.score} of ${keywords.length} keywords`;

  /**
   * Open a rotor list and page through it with `more` until something scores.
   * @returns {Promise<{entries: object[], best: object|null}>}
   */
  async function openList(kind, maxPages = MAX_ROTOR_PAGES) {
    const entries = [];
    if (!running()) return { entries, best: null };
    let obs = await step(kind, undefined, `looking for a ${kind} entry matching: ${wanted}`);
    collect(entries, obs);
    let pages = 0;
    while (!bestEntry(entries) && obs.rotor && obs.rotor.hasMore && pages < maxPages) {
      if (!running()) break;
      pages += 1;
      obs = await step(
        'more',
        undefined,
        `nothing in the ${kind} list scored yet; showing the next 8`
      );
      collect(entries, obs);
    }
    return { entries, best: bestEntry(entries) };
  }

  /**
   * Step 2: get off this page towards something that matches the task.
   * @returns {Promise<{outcome: 'changed'|'exhausted', obs: object}>}
   */
  async function navigate() {
    const links = await openList('links');
    let candidates = links.entries;
    for (let i = 0; i < MAX_ACTIVATIONS && running(2); i += 1) {
      const best = bestEntry(candidates);
      if (!best) break;
      state.visited.add(fold(best.phrase));
      await step('jumpTo', best.index, scoreNote('link', best));
      if (!running()) break;
      const obs = await step('activate', undefined, `activating "${entryLabel(best.phrase)}"`);
      if (changedPage(obs)) return { outcome: 'changed', obs };
      await mark(`activating "${entryLabel(best.phrase)}" changed nothing audible`);
    }

    // On an information task the reading phase opens its own lists and runs its
    // own searches, so everything below would only burn steps twice.
    if (info) return { outcome: 'exhausted', obs: {} };

    // No link matched: move the cursor into a region that at least shares a word,
    // so the search and the walk below start somewhere plausible.
    if (running()) {
      const headings = await openList('headings', 0);
      if (headings.best && running()) {
        state.visited.add(fold(headings.best.phrase));
        await step('jumpTo', headings.best.index, scoreNote('heading', headings.best));
      }
    }
    if (running()) {
      const landmarks = await openList('landmarks', 0);
      const nav = landmarks.entries.find((e) => /navigation/i.test(e.phrase));
      const target = landmarks.best || nav;
      if (target && running()) await step('jumpTo', target.index, scoreNote('landmark', target));
    }

    // `find` with the longest keyword: the longest word of the task is the most
    // distinctive one a word matcher has.
    const longest = keywords.slice().sort((a, b) => b.word.length - a.word.length)[0];
    if (longest && running(2)) {
      const obs = await step('find', longest.word, `searching the page for "${longest.word}"`);
      if (!obs.error) {
        const hit = scorePhrase(obs.phrase, keywords);
        const role = fold(phraseRole(obs.phrase));
        if (hit.score > 0 && (role.startsWith('link') || role.startsWith('button')) && running()) {
          state.visited.add(fold(obs.phrase));
          const after = await step(
            'activate',
            undefined,
            `activating the found "${entryLabel(obs.phrase)}"`
          );
          if (changedPage(after)) return { outcome: 'changed', obs: after };
        }
      }
    }

    // Last resort: walk the links one by one and take the first that scores.
    for (let i = 0; i < MAX_WALK && running(2); i += 1) {
      const obs = await step('nextLink', undefined, 'walking the links, nothing matched so far');
      const hit = scorePhrase(obs.phrase, keywords);
      if (hit.score <= 0 || state.visited.has(fold(obs.phrase))) continue;
      state.visited.add(fold(obs.phrase));
      const after = await step(
        'activate',
        undefined,
        `walked to "${entryLabel(obs.phrase)}", which scores ${hit.score} of ${keywords.length} keywords`
      );
      if (changedPage(after)) return { outcome: 'changed', obs: after };
    }
    return { outcome: 'exhausted', obs: {} };
  }

  /**
   * Step 4: read this page for the answer. Best heading first, then `find`.
   * @returns {Promise<string|null>} why the answer was heard, or null
   */
  async function read() {
    const { entries } = await openList('headings', 1);
    const ordered = entries
      .filter((e) => e.score > 0 && !state.visited.has(fold(e.phrase)))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX_READ_HEADINGS);

    for (const heading of ordered) {
      if (!running()) break;
      state.visited.add(fold(heading.phrase));
      let obs = await step('jumpTo', heading.index, scoreNote('heading', heading));
      let found = speaksAnswer(obs);
      for (let i = 0; i < READ_STOPS && !found && running(); i += 1) {
        obs = await step('next', undefined, `reading on under "${entryLabel(heading.phrase)}"`);
        found = speaksAnswer(obs);
      }
      if (found) return found;
      await mark(`nothing under "${entryLabel(heading.phrase)}" carried the answer`);
    }

    for (const kw of keywords.slice(0, MAX_FINDS)) {
      if (!running(2)) break;
      const obs = await step('find', kw.word, `searching this page for "${kw.word}"`);
      if (obs.error) continue;
      let found = speaksAnswer(obs);
      if (!found && running()) {
        const next = await step('next', undefined, `reading on after the hit for "${kw.word}"`);
        found = speaksAnswer(next);
      }
      if (found) return found;
    }
    return null;
  }

  while (running()) {
    const { outcome, obs: arrival } = await navigate();
    if (!running()) break;

    if (outcome === 'changed') {
      state.pageChanges += 1;
      if (!info) {
        // The page announced itself: if its own words match the task, this is it.
        const heard = [arrival.phrase, ...(arrival.announcements || [])].filter(Boolean);
        const best = heard
          .map((p) => scorePhrase(p, keywords))
          .sort((a, b) => b.score - a.score)[0] || { score: 0, matched: [] };
        if (best.score > 0) {
          await finish(
            `the page that loaded carries ${best.score} of ${keywords.length} keywords (${best.matched.join(', ')})`
          );
          break;
        }
      }
    }

    if (info) {
      const found = await read();
      if (found) {
        if (running()) await finish(found);
        break;
      }
      await mark('this page did not speak the answer');
    }

    if (outcome !== 'changed' || state.pageChanges >= MAX_PAGE_CHANGES) {
      await mark(
        outcome === 'changed'
          ? `giving up after ${state.pageChanges} pages`
          : 'no phrase on this page matched the task'
      );
      if (running()) await finish('no further command of the policy matches the task description');
      break;
    }
  }

  if (state.stoppedBy === 'budget') {
    // `mark` is free, so a run that ran out of commands can still say where it
    // was when the budget ended.
    const reason = `the budget ran out while matching the task words: ${wanted}`;
    await env.step({ type: 'mark', arg: { kind: 'backtrack', reason }, note: reason });
  }

  return {
    // The harness owns the verdict; the agent is never told whether it won.
    success: null,
    nSr: state.steps,
    steps: state.steps,
    trace: (env && env.trace) || [],
    stoppedBy: state.stoppedBy || 'budget',
    // No model is called, so there is nothing to pay for.
    usage: { promptTokens: 0, completionTokens: 0, calls: 0, cost: 0, costKnown: true },
  };
}

module.exports = {
  runGreedyAgent,
  keywordsOf,
  scorePhrase,
  ANSWER_SHAPES,
  ANSWER_KEYWORDS,
  MAX_PAGE_CHANGES,
};
