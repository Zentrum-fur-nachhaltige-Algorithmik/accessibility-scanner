/**
 * The sighted task generator: from a URL to a `tasks.json` that `run.js` consumes.
 * Pipeline per site: explore (sighted page views), propose (one LLM call plus
 * generic templates), solve (sighted agent), derive an oracle, validate by replay.
 * Tasks that fail validation are dropped with a reason.
 */

'use strict';

const { instantiateGenericTasks, collectCandidates, WORDS } = require('./generic-tasks');
const { extractPageView, renderPageView } = require('./page-view');
const { runSightedAgent, toSightedPath } = require('./sighted-agent');
const { createIsolatedContext, runPreconditions, validateTask } = require('./replay');
const { createRequestRecorder, escapeRegExp, PREDICATE_TYPES, validateSpec } = require('./oracle');
const { validateTaskShape, saveTasks } = require('./task');
const { mapWithConcurrency, DEFAULT_CONCURRENCY } = require('./concurrency');
const { collectSpokenPhrases } = require('./screenreader-env');
const { ANSWER_TYPES, validateAnswerAgainstPage } = require('./answer-match');

const secs = (ms) => `${(ms / 1000).toFixed(0)}s`;

/** How many spoken phrases the re-pick call is shown (see `resolveEvidence`). */
const MAX_EVIDENCE_PHRASE_OFFER = 20;

const DEFAULTS = {
  maxTasks: 8,
  explore: 4,
  sightedMaxSteps: 15,
  repeats: 2,
  ambiguityRatio: 3,
  vision: false,
  allowSubmit: false,
  generic: true, // also instantiate the site-agnostic templates from generic-tasks.js
  gotoTimeout: 30000,
  concurrency: DEFAULT_CONCURRENCY, // candidate pipelines running at the same time
};

/* ------------------------------------------------------------------ */
/* Tool schemas                                                        */
/* ------------------------------------------------------------------ */

/** The proposal tool: the schema is what keeps the model inside the task shape. */
const PROPOSE_TASKS_TOOL = {
  type: 'function',
  function: {
    name: 'propose_tasks',
    description:
      'Report what kind of website this is and the core tasks real users come here to do.',
    parameters: {
      type: 'object',
      properties: {
        siteType: {
          type: 'string',
          description:
            'What this website is, in a few words (e.g. "government information portal", "online shop for bicycles").',
        },
        tasks: {
          type: 'array',
          minItems: 3,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Short kebab-case identifier, e.g. "find-opening-hours".',
              },
              description: {
                type: 'string',
                description:
                  'The goal in plain user language, as you would tell a friend. NO element names, ' +
                  'no button labels, no menu names, no selectors, no HTML. Say WHAT the user wants, ' +
                  'never HOW to click it.',
              },
              weight: {
                type: 'integer',
                minimum: 1,
                maximum: 3,
                description: '3 = core purpose of the site, 2 = common, 1 = peripheral.',
              },
              expectedOutcome: {
                type: 'string',
                description:
                  'How one can tell the task succeeded: what the page shows / where the user ends up.',
              },
            },
            required: ['id', 'description', 'weight', 'expectedOutcome'],
            additionalProperties: false,
          },
        },
      },
      required: ['siteType', 'tasks'],
      additionalProperties: false,
    },
  },
};

/** Oracle types the model may choose. Kept in sync with `oracle.js` at load time. */
const ORACLE_TYPES = PREDICATE_TYPES.filter((t) => t !== 'focusInDialog');

const PROPOSE_ORACLE_TOOL = {
  type: 'function',
  function: {
    name: 'propose_oracle',
    description:
      'Choose ONE machine-checkable condition that is false before the task and true after it.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ORACLE_TYPES },
        pattern: {
          type: 'string',
          description: 'Regular expression, for urlMatches / titleMatches.',
        },
        selector: { type: 'string', description: 'CSS selector, for elementVisible / formValue.' },
        text: { type: 'string', description: 'Regular expression, for elementWithText.' },
        value: { type: 'string', description: 'Regular expression, for formValue.' },
        urlPattern: { type: 'string', description: 'Regular expression, for requestSent.' },
        method: { type: 'string', description: 'HTTP method, for requestSent.' },
        kind: { type: 'string', enum: ['cookie', 'local', 'session'] },
        key: { type: 'string', description: 'Storage key, for storageKey.' },
        valuePattern: { type: 'string', description: 'Regular expression, for storageKey.' },
        of: {
          type: 'array',
          description: 'Sub-conditions, for all / any / not. Same shape as this object.',
          items: { type: 'object', additionalProperties: true },
        },
        reason: {
          type: 'string',
          description: 'One sentence: why this condition proves the task.',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
};

const JUDGE_OUTCOME_TOOL = {
  type: 'function',
  function: {
    name: 'judge_outcome',
    description: 'State whether the page shown really is the outcome the task described.',
    parameters: {
      type: 'object',
      properties: {
        satisfied: {
          type: 'boolean',
          description: 'true only if this page is what the task asked for.',
        },
        evidence: {
          type: 'string',
          description:
            'If satisfied: two to five words copied VERBATIM from the page that show it. ' +
            'Empty string if the page proves it by being the page it is, not by its text.',
        },
      },
      required: ['satisfied', 'evidence'],
      additionalProperties: false,
    },
  },
};

const PICK_EVIDENCE_TOOL = {
  type: 'function',
  function: {
    name: 'pick_evidence',
    description:
      'Copy the short piece of page text that answers the question the task asked, and state the ' +
      'answer itself.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Two to five consecutive words, copied VERBATIM from the page text you were shown, ' +
            'that carry the answer. No quotes, no paraphrase, no invented words.',
        },
        answer: {
          type: 'string',
          description:
            'The ANSWER itself as plain text, the way you would tell it to someone on the phone, ' +
            'e.g. "+43 1 2039333", "office@example.com", "Donaustadtstrasse 1, 1220 Wien", ' +
            '"Mo 12:30-18:30, Di 08:00-12:00". Take the value from the page; do not invent it.',
        },
        answerType: {
          type: 'string',
          enum: ANSWER_TYPES,
          description: 'What kind of value the answer is.',
        },
      },
      required: ['text', 'answer', 'answerType'],
      additionalProperties: false,
    },
  },
};

// Prompts

const PROPOSE_SYSTEM = [
  'You design usability tasks for an accessibility measurement.',
  'You are shown a website as a sighted user sees it: the start page and a few pages behind the',
  'main navigation, each with landmarks, headings, interactive elements and the visible text.',
  '',
  'Produce the CORE tasks of this site: the things real users actually come here to do.',
  'Rules for every task:',
  '- It must be achievable on this website, starting from the start page, in a handful of steps.',
  '- It must have an observable end state (a different page, a result list, a visible confirmation).',
  '- Write the description the way a person would state their goal, e.g. "Find out how much a new',
  '  passport costs." NEVER name buttons, links, menus, headings or any element, and never',
  '  describe the clicks: the description is read by someone who cannot see the page.',
  '- Do not propose tasks that require logging in, paying, or sending personal data.',
  '- Prefer breadth: cover different parts of the site rather than five variations of one thing.',
].join('\n');

const ORACLE_SYSTEM = [
  'You turn a solved task into ONE deterministic, machine-checkable condition (an "oracle").',
  'The condition must be FALSE on the start page and TRUE after the task was performed.',
  'You are given the state before and after the real solution run, so pick something that actually',
  'changed. Prefer, in this order: the URL (urlMatches), the page title (titleMatches), a text that',
  'newly appeared (elementWithText), a form value (formValue), a request that was sent (requestSent).',
  'Patterns are JavaScript regular expressions matched case-insensitively; escape literal dots and',
  'slashes are fine unescaped. Keep patterns specific enough to be wrong on the start page.',
].join('\n');

const JUDGE_SYSTEM = [
  'You check the work of an automated tester. It was given a goal on a website, it clicked around,',
  'and it stopped on the page below claiming success. Decide whether that page really is the',
  'outcome the goal described.',
  'Be strict: landing on some other page of the same site is NOT success. A legal notice is not a',
  'booking form; a contact page is not a price list. If the page merely happens to mention the',
  'topic in a footer or a menu, that is not success either.',
  'Answer by calling judge_outcome exactly once.',
].join('\n');

const EVIDENCE_SYSTEM = [
  'A user wanted to FIND OUT something on a website. You are shown the page that holds the answer.',
  'Copy the shortest distinctive run of two to five consecutive words from that page text that a',
  'person would read out as the answer.',
  'Rules: copy VERBATIM, keep the original language and spelling, do not add quotes or punctuation',
  'that is not there, and never invent text that is not in the page.',
  'Report the ANSWER separately, as plain text: the value itself, normalised the way a person',
  'would say or write it, plus what kind of value it is (phone / email / address / hours / text).',
  'The answer must be the value that is on the page - never a guess and never a placeholder.',
  'Call pick_evidence exactly once.',
].join('\n');

const EVIDENCE_RETRY_SYSTEM = [
  'A user wanted to FIND OUT something on a website, and the answer has to be picked so that a',
  'screen reader really speaks it. A screen reader reads the page as separate PHRASES, one per',
  'element, and a snippet that runs across two phrases is never heard as one.',
  'You are shown the phrases this page is spoken as. Pick two to five consecutive words that',
  'carry the answer and are contained in ONE single phrase, copied VERBATIM from that phrase.',
  'If no phrase carries the answer, call pick_evidence with an empty text.',
  'Call pick_evidence exactly once.',
].join('\n');

// Main entry point

/**
 * Generate, solve and validate tasks for one site.
 *
 * @param {object} args
 * @param {import('puppeteer').Browser} args.browser
 * @param {string} args.url
 * @param {object} args.llm - client with `chat()` (see llm-chat.js)
 * @param {string} [args.model]
 * @param {object} [args.options] - see DEFAULTS
 * @param {{info?: Function, warn?: Function}} [args.logger]
 * @returns {Promise<{url, siteType, tasks, dropped, usage, preconditions, explored, wallClockMs}>}
 */
async function generateTasks({ browser, url, llm, model, options = {}, logger = console }) {
  const opts = { ...DEFAULTS, ...options };
  const startedAt = Date.now();
  const log = (m) => logger && typeof logger.info === 'function' && logger.info(m);
  const usage = { promptTokens: 0, completionTokens: 0, calls: 0, cost: 0, costKnown: true };
  const dropped = [];

  // 1. Explore
  log(`[generate] exploring ${url}`);
  const exploration = await explore({ browser, url, opts });
  const { preconditions, views, genericTasks } = exploration;
  log(
    `[generate] explored ${views.length} page(s), ${genericTasks.length} generic task(s), ` +
      `${preconditions.length ? 'cookie banner dismissed as precondition' : 'no cookie banner'}`
  );

  // 2. Propose
  const proposal = await proposeTasks({ llm, model, url, views, usage });
  if (proposal.error) {
    log(`[generate] proposal failed: ${proposal.error}`);
  }
  const siteType = proposal.siteType || null;

  const candidates = mergeCandidates({
    proposed: proposal.tasks || [],
    genericTasks,
    maxTasks: opts.maxTasks,
    dropped,
  });
  log(`[generate] ${candidates.length} candidate task(s) after merging with generic templates`);

  // 3. to 5. Solve, derive an oracle, validate.
  // Each candidate's chain runs in its own isolated contexts and touches only
  // `usage` (additively), so `concurrency` candidates are built at once.
  // One analysis cache for the whole site (see optimal-path.js).
  const analysisCache = new Map();
  const built = await mapWithConcurrency(candidates, opts.concurrency, (cand) =>
    buildTask({
      browser,
      url,
      llm,
      model,
      cand,
      preconditions,
      opts,
      usage,
      analysisCache,
      log,
    })
  );

  // Reassembled in candidate order: concurrency must not reorder tasks.json.
  const tasks = [];
  let stageSum = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const cand = candidates[i];
    const b = built[i];
    const t = b.timings || {};
    stageSum += (t.solveMs || 0) + (t.oracleMs || 0) + (t.validateMs || 0) + (t.nOptMs || 0);
    log(
      `[gen] ${cand.id}: solve ${secs(t.solveMs || 0)}${
        t.solveTurns == null ? '' : ` (${t.solveTurns} turns)`
      } · oracle ${secs(t.oracleMs || 0)} · validate ${secs(t.validateMs || 0)} · ` +
        `nOpt ${secs(t.nOptMs || 0)} → ${b.task ? 'ok' : 'dropped'}`
    );
    if (b.task) {
      tasks.push(b.task);
      log(`[generate] kept "${b.task.id}" (${b.task.oracle.type})`);
    } else {
      dropped.push({
        id: cand.id,
        description: cand.description,
        reason: b.reason,
        ...(b.phrases ? { phrases: b.phrases } : {}),
      });
      log(`[generate] dropped "${cand.id}": ${b.reason}`);
    }
  }

  const kept = dedupeByOracle(tasks, dropped);
  for (const t of tasks) {
    if (!kept.includes(t)) log(`[generate] dropped "${t.id}": duplicate-oracle`);
  }

  const wallClockMs = Date.now() - startedAt;
  log(
    `[gen] wall-clock total ${secs(wallClockMs)} (sum of stages ${secs(stageSum)}, concurrency ${opts.concurrency})`
  );

  return {
    url,
    siteType,
    tasks: kept,
    dropped,
    usage,
    preconditions,
    explored: views.map((v) => v.url),
    wallClockMs,
  };
}

/** Stable key of an oracle spec: field order must not make two oracles differ. */
function oracleKey(spec) {
  if (Array.isArray(spec)) return `[${spec.map(oracleKey).join(',')}]`;
  if (!spec || typeof spec !== 'object') return JSON.stringify(spec);
  return `{${Object.keys(spec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${oracleKey(spec[k])}`)
    .join(',')}}`;
}

/**
 * Two tasks with the same oracle are the same measurement under two names: the
 * second one adds nothing and quietly doubles the weight of one page. The task
 * whose own words are best corroborated by that page survives; the rest are
 * dropped as `duplicate-oracle`.
 */
function dedupeByOracle(tasks, dropped) {
  const groups = new Map();
  for (const t of tasks) {
    const key = oracleKey(t.oracle);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const score = (t) => {
    const g = t.generator || {};
    return [Number(g.corroborationScore) || 0, Number(t.weight) || 1];
  };
  const survivors = new Set();
  for (const group of groups.values()) {
    const best = group.reduce((a, b) => {
      const [sa, wa] = score(a);
      const [sb, wb] = score(b);
      return sb > sa || (sb === sa && wb > wa) ? b : a;
    });
    survivors.add(best);
    for (const t of group) {
      if (t === best) continue;
      dropped.push({
        id: t.id,
        description: t.description,
        reason: `duplicate-oracle: the same condition as "${best.id}"`,
      });
    }
  }
  return tasks.filter((t) => survivors.has(t));
}

// 1. Explore

async function explore({ browser, url, opts }) {
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  const views = [];
  let preconditions = [];
  let genericTasks = [];
  try {
    await page.setViewport({ width: 1280, height: 900 });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.gotoTimeout });
    } catch (err) {
      throw new Error(`cannot load ${url}: ${err.message}`);
    }

    // A cookie banner has to go before anything else is observed: it covers the
    // page and it would otherwise be dismissed inside every single task.
    const pre = await collectCandidates(page, WORDS).catch(() => ({}));
    if (pre && pre.cookie && pre.cookie.button) {
      preconditions = [{ action: 'click', selector: pre.cookie.button }];
      // The cookie banner is itself a common task, so it is instantiated before
      // the dismissal; afterwards its oracle is already true.
      if (opts.generic) {
        genericTasks = genericTasks.concat(
          await instantiateGenericTasks(page, { only: ['cookie-banner-dismiss'] }).catch(() => [])
        );
      }
      await runPreconditions(page, { preconditions });
    }

    if (opts.generic) {
      genericTasks = genericTasks
        .concat(await instantiateGenericTasks(page).catch(() => []))
        .filter(uniqueById());
    }

    views.push(await extractPageView(page, { screenshot: false }));

    for (const link of pickExplorationLinks(views[0], url, opts.explore)) {
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: opts.gotoTimeout });
        views.push(await extractPageView(page, { screenshot: false }));
      } catch (_) {
        /* a dead nav link is skipped */
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
  return { preconditions, views, genericTasks };
}

const uniqueById = () => {
  const seen = new Set();
  return (t) => (seen.has(t.id) ? false : (seen.add(t.id), true));
};

/** Same-origin main-navigation links from the start page view, deduped by path. */
function pickExplorationLinks(view, baseUrl, limit) {
  if (!view || !Array.isArray(view.elements) || limit <= 0) return [];
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch (_) {
    return [];
  }
  const seen = new Set([normalisePath(baseUrl)]);
  const inNav = [];
  const other = [];
  for (const el of view.elements) {
    if (!el.href) continue;
    let u;
    try {
      u = new URL(el.href);
    } catch (_) {
      continue;
    }
    if (u.origin !== origin) continue;
    const path = normalisePath(u.href);
    if (seen.has(path)) continue;
    seen.add(path);
    (/(navigation|banner)/i.test(el.region || '') ? inNav : other).push(u.href);
  }
  return inNav.concat(other).slice(0, limit);
}

function normalisePath(href) {
  try {
    const u = new URL(href);
    return `${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch (_) {
    return String(href);
  }
}

// 2. Propose

async function proposeTasks({ llm, model, url, views, usage }) {
  const pages = views
    .map((v, i) => `### PAGE ${i + 1}${i === 0 ? ' (start page)' : ''}\n${renderPageView(v)}`)
    .join('\n\n');

  const res = await llm.chat(
    [
      {
        role: 'user',
        content:
          `Website: ${url}\n\n${pages}\n\n` +
          'Report the site type and 5 to 10 core tasks by calling propose_tasks.',
      },
    ],
    {
      tools: [PROPOSE_TASKS_TOOL],
      toolChoice: { type: 'function', function: { name: 'propose_tasks' } },
      temperature: 0,
      systemPrompt: PROPOSE_SYSTEM,
      model,
    }
  );

  accumulateUsage(usage, res);
  if (!res || res.success !== true) {
    return { tasks: [], siteType: null, error: (res && res.error) || 'LLM call failed' };
  }
  const call = (res.toolCalls || []).find((c) => c.name === 'propose_tasks');
  const args = call && call.arguments;
  if (!args || !Array.isArray(args.tasks)) {
    return { tasks: [], siteType: null, error: 'model did not call propose_tasks with tasks' };
  }
  return {
    siteType: typeof args.siteType === 'string' ? args.siteType : null,
    tasks: args.tasks
      .filter((t) => t && typeof t.description === 'string' && t.description.trim())
      .map((t, i) => ({
        id: kebab(t.id || `task-${i + 1}`),
        description: t.description.trim(),
        weight: clampWeight(t.weight),
        expectedOutcome: typeof t.expectedOutcome === 'string' ? t.expectedOutcome : '',
        source: 'llm',
      })),
  };
}

function clampWeight(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, n));
}

function kebab(s) {
  return (
    String(s)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'task'
  );
}

/**
 * Merge LLM proposals with the generic templates.
 *
 * Generic tasks already carry a verified oracle and sightedPath, so they are
 * kept and an LLM proposal with the same intent (cookie / search / contact /
 * login) is dropped as a duplicate.
 *
 * Exception: the generic `login` template fires on any "Sign in" link, but on
 * many sites nobody's errand is "reach the login page", and a task nobody
 * performs still counts in `siteScore`. It is therefore dropped unless the LLM
 * proposed a login-like task itself (`generic-login-not-corroborated`).
 */
function mergeCandidates({ proposed, genericTasks, maxTasks, dropped }) {
  const proposedIntents = new Set(proposed.map((p) => intentOf(p.description)).filter(Boolean));
  const generics = genericTasks.map((t) => ({
    id: t.id,
    description: t.description,
    weight: t.weight || 1,
    source: 'generic',
    template: t.template,
    prebuilt: t,
    intent: intentOf(`${t.template} ${t.description}`),
  }));
  const corroborated = generics.filter((g) => {
    if (g.template !== 'login' || proposedIntents.has('login')) return true;
    dropped.push({
      id: g.id,
      description: g.description,
      reason: 'generic-login-not-corroborated: the site proposal contains no login-like task',
    });
    return false;
  });
  const takenIntents = new Set(corroborated.map((g) => g.intent).filter(Boolean));

  const kept = [];
  for (const p of proposed) {
    const intent = intentOf(p.description);
    if (intent && takenIntents.has(intent)) {
      dropped.push({
        id: p.id,
        description: p.description,
        reason: `duplicate-intent (${intent}): covered by a generic template`,
      });
      continue;
    }
    if (intent) takenIntents.add(intent);
    kept.push({ ...p, intent });
  }

  // Generics first: they are the cheap, certain part of the budget.
  const all = corroborated.concat(kept);
  const ids = new Set();
  return all.filter((c) => (ids.has(c.id) ? false : (ids.add(c.id), true))).slice(0, maxTasks);
}

/** Coarse intent bucket used for deduplication only. */
function intentOf(text) {
  const s = String(text || '').toLowerCase();
  if (/cookie|consent|zustimm/.test(s)) return 'cookie';
  if (/search|suche|search for|find .* by searching/.test(s)) return 'search';
  if (/contact|kontakt|get in touch|reach (them|us)/.test(s)) return 'contact';
  if (/log ?in|sign ?in|anmelden|account/.test(s)) return 'login';
  return null;
}

// 3. to 5. Solve, derive an oracle, validate

async function buildTask({
  browser,
  url,
  llm,
  model,
  cand,
  preconditions,
  opts,
  usage,
  analysisCache,
  log,
}) {
  // Per-stage wall clock, reported per task in the result and by the CLI.
  const timings = { solveMs: 0, oracleMs: 0, validateMs: 0, nOptMs: 0, solveTurns: null };
  const addValidationTime = (v) => {
    const t = (v && v.timings) || {};
    timings.validateMs += Number(t.validateMs) || 0;
    timings.nOptMs += Number(t.nOptMs) || 0;
  };

  // A generic template is already a complete task; it only needs validating.
  if (cand.prebuilt) {
    const task = { ...cand.prebuilt, preconditions: preconditions.slice() };
    // The cookie task must not have the cookie dismissal as its own precondition.
    if (cand.template === 'cookie-banner-dismiss') task.preconditions = [];
    const v = await validateTask(browser, url, task, { repeats: opts.repeats, analysisCache });
    addValidationTime(v);
    if (!v.valid)
      return { task: null, timings, reason: `generic task failed validation: ${firstReason(v)}` };
    return {
      timings,
      task: withTimings(
        withGeneratorMeta(task, {
          sightedAgentSteps: null,
          pathLength: task.sightedPath.length,
          ratio: null,
          prunedSteps: 0,
          // A generic template carries its own verified oracle, so there is
          // nothing an outcome check could add.
          corroboration: 'none',
          corroborationScore: 0,
          retries: 0,
          source: 'generic',
        }),
        timings
      ),
    };
  }

  // Solve it with the sighted agent
  const tSolve = Date.now();
  const solved = await solveCandidate({
    browser,
    url,
    cand,
    preconditions,
    llm,
    model,
    opts,
    usage,
  });
  timings.solveMs = Date.now() - tSolve;
  if (typeof solved.steps === 'number') timings.solveTurns = solved.steps;
  if (solved.error) return { task: null, timings, reason: solved.error };

  let sightedPath = solved.sightedPath;
  const pathEmpty = sightedPath.length === 0;
  if (solved.blockedSubmits > 0 && solved.stoppedBy !== 'done') {
    return { task: null, timings, reason: 'needs-submit' };
  }
  if (solved.stoppedBy === 'budget') {
    return {
      task: null,
      timings,
      reason: `sighted agent ran out of budget after ${solved.steps} steps`,
    };
  }
  // An empty path after pruning means the agent only wandered and came back. If
  // it nevertheless reports success, the goal can only have been to FIND OUT
  // something that was on the page all along: an information task candidate.
  if (pathEmpty && solved.stoppedBy !== 'done') {
    return { task: null, timings, reason: 'sighted agent produced no replayable actions' };
  }
  if (!pathEmpty && !solved.plausible) {
    return {
      task: null,
      timings,
      reason: `sighted agent called done without a plausible end state (${
        solved.summary ? truncate(solved.summary, 120) : 'no summary'
      })`,
    };
  }

  // Oracle candidates: deterministic fallback + LLM proposal
  const tOracle = Date.now();
  const corr = await corroborateOutcome({ cand, solved, llm, model, usage, pathEmpty });
  if (!corr.ok) {
    timings.oracleMs = Date.now() - tOracle;
    return {
      task: null,
      timings,
      reason: corr.reason,
      ...(corr.phrases ? { phrases: corr.phrases } : {}),
    };
  }

  let oracleCandidates;
  if (corr.kind === 'information') {
    // The oracle IS the answer text; the harness additionally requires the
    // screen reader to have spoken it (see harness.js).
    oracleCandidates = [{ spec: informationOracle(corr.evidence, solved), origin: 'evidence' }];
    if (pathEmpty) sightedPath = [{ action: 'goto', url: solved.after.url }];
  } else {
    const fallback = corr.navigation ? navigationOracle(solved) : deterministicOracle(solved);
    const llmOracle = await proposeOracle({ llm, model, cand, solved, usage });
    // The deterministic candidate is preferred when it validates: it is derived
    // from what really changed, needs no model and cannot hallucinate a pattern.
    // The llm proposal is the fallback for cases where nothing obvious changed.
    oracleCandidates = [
      ...(fallback ? [{ spec: fallback, origin: 'deterministic' }] : []),
      ...(llmOracle ? [{ spec: llmOracle, origin: 'llm' }] : []),
    ];
  }
  timings.oracleMs = Date.now() - tOracle;

  if (oracleCandidates.length === 0) {
    return {
      task: null,
      timings,
      reason: 'no oracle could be derived (nothing observable changed)',
    };
  }

  // Validate
  const reasons = [];
  let retries = 0;
  for (const candidateOracle of oracleCandidates) {
    let task;
    try {
      task = validateTaskShape({
        id: cand.id,
        description: cand.description,
        weight: cand.weight || 1,
        kind: corr.kind,
        ...(corr.evidence ? { evidence: corr.evidence } : {}),
        // The ground truth: the harness accepts any spelling of it, anywhere on
        // the site (see answer-match.js), while `evidence` stays the read target
        // of nOpt and the primary quick match.
        ...(corr.kind === 'information' && corr.answer
          ? { answer: corr.answer, answerType: corr.answerType }
          : {}),
        oracle: candidateOracle.spec,
        sightedPath,
        preconditions: preconditions.slice(),
        meta: {
          source: 'task-generator',
          oracleOrigin: candidateOracle.origin,
          expectedOutcome: cand.expectedOutcome || null,
          sightedSummary: solved.summary || null,
        },
      });
    } catch (err) {
      reasons.push(`${candidateOracle.origin}: ${err.message}`);
      retries += 1;
      continue;
    }
    const v = await validateTask(browser, url, task, { repeats: opts.repeats, analysisCache });
    addValidationTime(v);
    if (v.valid) {
      return {
        timings,
        task: withTimings(
          withGeneratorMeta(task, {
            sightedAgentSteps: solved.steps,
            pathLength: sightedPath.length,
            ratio: sightedPath.length > 0 ? solved.steps / sightedPath.length : null,
            prunedSteps: solved.prunedSteps || 0,
            corroboration: corr.corroboration,
            corroborationScore: corr.score || 0,
            retries,
            source: 'llm',
            ambiguityRatio: opts.ambiguityRatio,
          }),
          timings
        ),
      };
    }
    reasons.push(`${candidateOracle.origin}: ${firstReason(v)}`);
    retries += 1;
  }
  return { task: null, timings, reason: `no oracle validated: ${reasons.join(' | ')}` };
}

// Outcome corroboration

/**
 * Words that say nothing about WHICH page one is on. Without them "the booking
 * page opens" is corroborated by any URL that contains "page". Both languages
 * of the sites this runs against are covered; the list is deliberately short and
 * only ever removes candidates from the keyword match, never adds any.
 */
const STOPWORDS = new Set([
  'page',
  'pages',
  'site',
  'sites',
  'website',
  'webpage',
  'link',
  'links',
  'menu',
  'button',
  'click',
  'open',
  'opens',
  'opened',
  'show',
  'shows',
  'shown',
  'view',
  'views',
  'display',
  'displays',
  'displayed',
  'find',
  'finds',
  'found',
  'know',
  'learn',
  'want',
  'user',
  'users',
  'this',
  'that',
  'these',
  'those',
  'there',
  'their',
  'them',
  'they',
  'with',
  'from',
  'into',
  'your',
  'about',
  'after',
  'before',
  'where',
  'when',
  'what',
  'which',
  'will',
  'been',
  'have',
  'does',
  'need',
  'must',
  'also',
  'more',
  'than',
  'then',
  'some',
  'such',
  'each',
  'other',
  'only',
  'over',
  'were',
  'would',
  'could',
  'should',
  'information',
  'info',
  'details',
  'detail',
  'tool',
  'tools',
  'able',
  'reach',
  'reached',
  'goes',
  'used',
  'using',
  'access',
  'seite',
  'seiten',
  'webseite',
  'klicken',
  'klick',
  'taste',
  'schaltflaeche',
  'oeffnen',
  'oeffnet',
  'zeigen',
  'zeigt',
  'anzeigen',
  'angezeigt',
  'finden',
  'findet',
  'dass',
  'diese',
  'dieser',
  'dieses',
  'wird',
  'werden',
  'sind',
  'oder',
  'aber',
  'nach',
  'ueber',
  'unter',
  'eine',
  'einen',
  'einer',
  'eines',
  'fuer',
  'sich',
  'nicht',
  'auch',
  'noch',
  'sehr',
  'kann',
  'koennen',
  'soll',
  'sollte',
  'hier',
  'dort',
  'wenn',
  'dann',
  'damit',
  'informationen',
]);

const squash = (s) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim();
const fold = (s) => squash(s).toLowerCase();
/** `fold` with punctuation removed, so "18/2, 8010" and "18/2 8010" compare equal. */
const foldLoose = (s) =>
  fold(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Crude suffix stripping, enough to let "opening" match "open" across a page. */
function stemOf(word) {
  if (word.length <= 5) return word;
  const stem = word.replace(/(ings|ing|ungen|ung|edly|ed|es|en|s|e)$/u, '');
  return stem.length >= 4 ? stem : word;
}

/**
 * The content words of a candidate: what the task says it wants, minus the
 * words every task uses. Multilingual-safe: it never translates, it only takes
 * the task's own words, so a German page and a German task match on their own.
 */
function keywordsOf(cand) {
  const source = `${(cand && cand.description) || ''} ${(cand && cand.expectedOutcome) || ''}`;
  const seen = new Set();
  for (const raw of fold(source).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return Array.from(seen);
}

/** Which of `keywords` occur (as themselves or as their stem) in `haystack`. */
function matchedKeywords(keywords, haystack) {
  const hay = fold(haystack);
  if (!hay) return [];
  return (keywords || []).filter((k) => hay.includes(k) || hay.includes(stemOf(k)));
}

/**
 * The text a reader really sees on the final page: title, headings and the main
 * content. Navigation labels are deliberately excluded; they repeat on every
 * page of a site and would corroborate any task at all.
 */
function pageHaystack(view, state) {
  const parts = [];
  if (view) {
    parts.push(view.title || '');
    for (const h of view.headings || []) parts.push(h.text || '');
    parts.push(view.text || '');
  }
  if (state) {
    parts.push(state.title || '');
    for (const h of state.headings || []) parts.push(h);
    for (const t of state.statusTexts || []) parts.push(t);
  }
  return fold(parts.join(' \n '));
}

/**
 * A two-to-five-word snippet that really occurs on the final page, or null.
 * The occurrence check is what keeps a hallucinated quote out of an oracle.
 */
function usableEvidence(text, view, state) {
  const snippet = squash(text);
  if (!snippet || snippet.length > 80) return null;
  const words = snippet.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5) return null;
  const re = new RegExp(words.map((w) => escapeRegExp(fold(w))).join('[\\s\\p{P}]+'), 'iu');
  return re.test(pageHaystack(view, state)) ? snippet : null;
}

/** `elementWithText` on the evidence, AND the destination URL when it changed. */
function informationOracle(evidence, solved) {
  const text = squash(evidence)
    .split(' ')
    .map((w) => escapeRegExp(w))
    .join('\\s+');
  const spec = { type: 'elementWithText', text };
  const from = normalisePath(solved.before.url);
  const to = normalisePath(solved.after.url);
  if (to && from !== to) {
    return { type: 'all', of: [{ type: 'urlMatches', pattern: escapeRegExp(to) }, spec] };
  }
  return spec;
}

/**
 * Words that make a description a QUESTION: the task wants a fact, so the answer
 * has to be heard, not just reached. English and the German the generator may
 * emit, because the candidate speaks the language of the site.
 */
const INFORMATION_WORDS_RE =
  /(\bfind out\b|\bfinds out\b|\bwhat\b|\bwhich\b|\bwhen\b|\bwhere\b|\bwho\b|\bwhy\b|\bhow (much|many|long|often|do|does|can)\b|\bprice\b|\bcost\b|\bherausfinden\b|\bfinde heraus\b|\berfahren\b|\bwas\b|\bwelche[rsnm]?\b|\bwann\b|\bwo\b|\bwer\b|\bwarum\b|\bwie (viel|viele|lange|oft)\b)/iu;

/**
 * Words that make a description a NAVIGATION goal: the outcome is the page
 * itself ("view the legal notice", "das Impressum aufrufen"). Nothing on the
 * destination has to be quoted back for the task to be done.
 */
const NAVIGATION_WORDS_RE =
  /(\bview\b|\bopen\b|\bgo to\b|\bnavigate to\b|\bvisit\b|\bshow\b|\breach\b|\bansehen\b|\banschauen\b|\banzeigen\b|\baufrufen\b|\böffne(n)?\b|\bbesuche(n)?\b|\bgehe zu\b|\bnavigiere zu\b|\bzeige(n)?\b)/iu;

/**
 * True when the candidate only asks to REACH a page. A question wins: "find out
 * what the services page shows" names a page but wants the content.
 */
function isNavigationGoal(cand) {
  const text = `${(cand && cand.description) || ''} ${(cand && cand.expectedOutcome) || ''}`;
  if (INFORMATION_WORDS_RE.test(text)) return false;
  return NAVIGATION_WORDS_RE.test(text);
}

/**
 * Decide whether the state the sighted agent stopped in really is the outcome
 * the candidate described, and what kind of task it is.
 *
 * A changed URL alone proves nothing: an agent that wanders and gives up on the
 * legal notice changes the URL too. Corroboration therefore has to come from the
 * candidate's OWN words appearing where the agent ended up:
 *   - in the final URL path  -> the destination is the outcome: an ACTION task;
 *   - only in the page text  -> the answer is content: an INFORMATION task;
 *   - nowhere               -> one `judge_outcome` call decides, and its evidence
 *                              (when it quotes the page) makes it an information task.
 *
 * @returns {Promise<{ok: boolean, reason?: string, corroboration?: string,
 *                    kind?: string, evidence?: string|null, score?: number}>}
 */
async function corroborateOutcome({ cand, solved, llm, model, usage, pathEmpty }) {
  const view = solved.finalView;
  const keywords = keywordsOf(cand);
  const inUrl = matchedKeywords(keywords, normalisePath(solved.after.url));
  const inText = matchedKeywords(keywords, pageHaystack(view, solved.after));

  if (pathEmpty) {
    // Nothing was done, so the only outcome that can exist is knowledge.
    const picked = await resolveEvidence({ llm, model, cand, solved, usage });
    if (!picked.evidence) {
      if (picked.reason) return { ok: false, reason: picked.reason, phrases: picked.phrases };
      return {
        ok: false,
        reason:
          'outcome-not-corroborated: the sighted agent did nothing and no answer text could be verified on the page',
      };
    }
    return {
      ok: true,
      corroboration: 'llm',
      kind: 'information',
      evidence: picked.evidence,
      answer: picked.answer || null,
      answerType: picked.answerType || null,
      score: inText.length,
    };
  }

  // "View the legal notice": arriving IS the outcome. Such a task must not be
  // turned into an information task whose evidence the agent has to read out.
  if (
    isNavigationGoal(cand) &&
    normalisePath(solved.before.url) !== normalisePath(solved.after.url)
  ) {
    return {
      ok: true,
      corroboration: 'navigation',
      kind: 'action',
      navigation: true,
      evidence: null,
      score: inUrl.length + inText.length,
    };
  }

  if (inUrl.length > 0) {
    return {
      ok: true,
      corroboration: 'keyword',
      kind: 'action',
      evidence: null,
      score: inUrl.length + inText.length,
    };
  }

  if (inText.length > 0) {
    const picked = await resolveEvidence({ llm, model, cand, solved, usage });
    // Visible but never spoken: that IS the result, and no substitute action
    // task may hide it.
    if (picked.reason) return { ok: false, reason: picked.reason, phrases: picked.phrases };
    return {
      ok: true,
      corroboration: 'keyword',
      kind: picked.evidence ? 'information' : 'action',
      evidence: picked.evidence,
      answer: picked.answer || null,
      answerType: picked.answerType || null,
      score: inText.length,
    };
  }

  const judged = await judgeOutcome({ llm, model, cand, solved, usage });
  if (!judged || judged.satisfied !== true) {
    const why = judged && judged.evidence ? `: ${truncate(judged.evidence, 120)}` : '';
    return {
      ok: false,
      reason: `outcome-not-corroborated: nothing on the final page matches what the task asked for${why}`,
    };
  }
  const picked = judged.evidence
    ? await resolveEvidence({ llm, model, cand, solved, usage, snippet: judged.evidence })
    : { evidence: null };
  if (picked.reason) return { ok: false, reason: picked.reason, phrases: picked.phrases };
  return {
    ok: true,
    corroboration: 'llm',
    kind: picked.evidence ? 'information' : 'action',
    evidence: picked.evidence,
    answer: picked.answer || null,
    answerType: picked.answerType || null,
    score: 0,
  };
}

/** One `judge_outcome` call on the rendered final page. */
async function judgeOutcome({ llm, model, cand, solved, usage }) {
  const content = [
    `GOAL: ${cand.description}`,
    cand.expectedOutcome ? `THE TASK SAYS IT SUCCEEDED WHEN: ${cand.expectedOutcome}` : null,
    solved.summary ? `THE TESTER REPORTS: ${solved.summary}` : null,
    '',
    'THE PAGE IT STOPPED ON:',
    renderPageView(solved.finalView),
  ]
    .filter((l) => l !== null)
    .join('\n');

  const res = await llm.chat([{ role: 'user', content }], {
    tools: [JUDGE_OUTCOME_TOOL],
    toolChoice: { type: 'function', function: { name: 'judge_outcome' } },
    temperature: 0,
    systemPrompt: JUDGE_SYSTEM,
    model,
  });
  accumulateUsage(usage, res);
  if (!res || res.success !== true) return null;
  const call = (res.toolCalls || []).find((c) => c.name === 'judge_outcome');
  if (!call || !call.arguments) return null;
  return {
    satisfied: call.arguments.satisfied === true,
    evidence: typeof call.arguments.evidence === 'string' ? call.arguments.evidence : '',
  };
}

/** The single spoken phrase that carries `snippet`, or null. */
function spokenPhraseFor(snippet, phrases) {
  const needle = foldLoose(snippet);
  if (!needle) return null;
  return (phrases || []).find((p) => foldLoose(p).includes(needle)) || null;
}

/**
 * The phrases worth showing the model on a re-pick: those that share at least
 * one word with the snippet we could not place, most shared words first.
 */
function phrasesNear(snippet, phrases, limit = MAX_EVIDENCE_PHRASE_OFFER) {
  const words = foldLoose(snippet)
    .split(' ')
    .filter((w) => w.length >= 2);
  if (words.length === 0 || !phrases) return [];
  const scored = [];
  for (const phrase of phrases) {
    const hay = foldLoose(phrase);
    const hits = words.filter((w) => hay.includes(w)).length;
    if (hits > 0) scored.push({ phrase, hits });
  }
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map((e) => e.phrase);
}

/**
 * The evidence of an information task, verified against what the page really
 * SPEAKS.
 *
 * Picking the snippet out of the visible text is not enough: the screen reader
 * speaks one phrase per element, so a snippet that spans two elements
 * ("ORDINATIONSZEITEN" + "MO: 12h30 - 18h30") can never be heard, which would
 * make the task unsolvable and produce a false `evidence-not-readable`. So the
 * snippet must sit inside ONE spoken phrase; if it does not, the model gets one
 * more attempt, this time shown the phrases themselves.
 *
 * @param {object} args - `snippet` pre-chosen (from `judge_outcome`), else one
 *   `pick_evidence` call is made first.
 * @returns {Promise<{evidence: string|null, reason?: string, phrases?: string[]}>}
 *   `reason: 'evidence-not-spoken'` means the answer is on the page but in no
 *   spoken phrase - a real "visible but not read" signal, not a broken pick.
 */
async function resolveEvidence({ llm, model, cand, solved, usage, snippet }) {
  if (!solved.finalView) return { evidence: null };
  const phrases = solved.phrases || [];

  let picked;
  if (snippet) {
    const text = usableEvidence(snippet, solved.finalView, solved.after);
    picked = text ? { text, ...inferAnswer(text) } : null;
  } else {
    picked = await pickEvidence({ llm, model, cand, solved, usage });
  }
  if (!picked || !picked.text) return { evidence: null };
  const withAnswer = (evidence, from) => ({
    evidence,
    answer: from.answer || null,
    answerType: from.answer ? from.answerType : null,
    ...(from.answerReason ? { answerReason: from.answerReason } : {}),
  });

  // No phrases at all (injection failed): fall back to the text check alone
  // rather than dropping every information task of the site.
  if (phrases.length === 0) return withAnswer(picked.text, picked);

  if (spokenPhraseFor(picked.text, phrases)) return withAnswer(picked.text, picked);

  const offered = phrasesNear(picked.text, phrases);
  // Nothing to offer means no phrase shares even a word with the answer: a
  // second call could only guess, so spend nothing on it.
  const retry =
    offered.length > 0
      ? await pickEvidence({
          llm,
          model,
          cand,
          solved,
          usage,
          offeredPhrases: offered,
          rejected: picked.text,
        })
      : null;
  if (retry && retry.text && spokenPhraseFor(retry.text, phrases)) {
    // The re-pick only had to move the EVIDENCE into one phrase; if its answer
    // did not survive validation the first one still stands.
    return withAnswer(retry.text, retry.answer ? retry : picked);
  }

  return {
    evidence: null,
    reason: `evidence-not-spoken: "${truncate(picked.text, 60)}" is on the page but in no spoken phrase`,
    phrases: offered,
  };
}

/**
 * One `pick_evidence` call; returns the snippet only if it really is on the
 * page. With `offeredPhrases` it is the second, phrase-aware attempt.
 */
async function pickEvidence({ llm, model, cand, solved, usage, offeredPhrases, rejected }) {
  if (!solved.finalView) return null;
  const retry = Array.isArray(offeredPhrases) && offeredPhrases.length > 0;
  const content = [
    `THE USER WANTED TO FIND OUT: ${cand.description}`,
    cand.expectedOutcome ? `THAT MEANS: ${cand.expectedOutcome}` : null,
    solved.summary ? `A SIGHTED TESTER REPORTS: ${solved.summary}` : null,
    retry ? `\nTHIS ANSWER IS NOT SPOKEN AS ONE PHRASE: ${rejected}` : null,
    retry ? '\nTHE PHRASES THE SCREEN READER SPEAKS HERE:' : null,
    retry ? offeredPhrases.map((p, i) => `${i + 1}. ${p}`).join('\n') : null,
    '',
    'THE PAGE:',
    renderPageView(solved.finalView),
  ]
    .filter((l) => l !== null)
    .join('\n');

  const res = await llm.chat([{ role: 'user', content }], {
    tools: [PICK_EVIDENCE_TOOL],
    toolChoice: { type: 'function', function: { name: 'pick_evidence' } },
    temperature: 0,
    systemPrompt: retry ? EVIDENCE_RETRY_SYSTEM : EVIDENCE_SYSTEM,
    model,
  });
  accumulateUsage(usage, res);
  if (!res || res.success !== true) return null;
  const call = (res.toolCalls || []).find((c) => c.name === 'pick_evidence');
  if (!call || !call.arguments) return null;
  const text = usableEvidence(call.arguments.text, solved.finalView, solved.after);
  if (!text) return null;
  // The ground truth the harness matches fuzzily. It is checked against the page
  // text (digits for a phone number, the address itself for an address) so an
  // invented answer cannot make a task unsolvable-but-scored.
  const answerType = ANSWER_TYPES.includes(call.arguments.answerType)
    ? call.arguments.answerType
    : null;
  const answer = typeof call.arguments.answer === 'string' ? call.arguments.answer.trim() : '';
  const check = answerType
    ? validateAnswerAgainstPage(answer, answerType, pageHaystack(solved.finalView, solved.after))
    : { ok: false, reason: `answerType "${call.arguments.answerType}" is not usable` };
  if (!check.ok) return { text, answer: null, answerType: null, answerReason: check.reason };
  return { text, answer, answerType };
}

/**
 * The answer for a snippet that came from `judge_outcome` rather than from
 * `pick_evidence`: no model call is spent on it, the type is read off the shape
 * of the text and the snippet itself is the answer.
 */
function inferAnswer(snippet) {
  const text = String(snippet || '').trim();
  if (!text) return { answer: null, answerType: null };
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return { answer: text, answerType: 'email' };
  if ((text.match(/\d/g) || []).length >= 7 && /(tel|phone|fon|\+|\(0)/i.test(text)) {
    return { answer: text, answerType: 'phone' };
  }
  return { answer: text, answerType: 'text' };
}

/** Run the sighted agent once on a fresh isolated page and record everything. */
async function solveCandidate({ browser, url, cand, preconditions, llm, model, opts, usage }) {
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  let recorder = null;
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.gotoTimeout });
    const pre = await runPreconditions(page, { preconditions });
    if (!pre.ok) return { error: `precondition failed: ${pre.error}` };

    const before = await captureState(page);
    recorder = createRequestRecorder(page);

    const goal = cand.expectedOutcome
      ? `${cand.description}\n\nYou have succeeded when: ${cand.expectedOutcome}`
      : cand.description;

    const run = await runSightedAgent({
      page,
      llm,
      model,
      goal,
      maxSteps: opts.sightedMaxSteps,
      allowSubmit: opts.allowSubmit,
      vision: opts.vision,
    });
    accumulateUsage(usage, { usage: run.usage });

    const after = await captureState(page);
    const requests = recorder.requests.slice();
    // What the page really SPEAKS, on the page the agent ended on: the evidence
    // of an information task is verified against these, not against the visible
    // text (see `resolveEvidence`).
    let phrases = [];
    try {
      phrases = await collectSpokenPhrases(page);
    } catch {
      phrases = [];
    }
    // Cycles and restarts are cut out before the trajectory becomes a path:
    // an oracle derived from where the agent gave up measures the detour.
    const path = toSightedPath(run.trajectory, { startUrl: url });

    return {
      steps: run.steps,
      stoppedBy: run.stoppedBy,
      summary: run.summary,
      blockedSubmits: run.blockedSubmits,
      sightedPath: path,
      prunedSteps: path.prunedSteps || 0,
      trajectory: run.trajectory,
      finalView: run.finalView || null,
      phrases,
      before,
      after,
      requests,
      plausible: isPlausible(before, after, run),
      ...(run.error ? { error: run.error } : {}),
    };
  } catch (err) {
    return { error: `sighted run failed: ${err.message}` };
  } finally {
    if (recorder) recorder.stop();
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * Plausible end state: something observable must have changed, otherwise a
 * `done` is just the model being optimistic. Generous on purpose; `validateTask`
 * is the real gate.
 */
function isPlausible(before, after, run) {
  if (run.stoppedBy !== 'done') return false;
  if (before.url !== after.url) return true;
  if (before.title !== after.title) return true;
  if (diffStrings(before.headings, after.headings).length > 0) return true;
  if (diffStrings(before.statusTexts, after.statusTexts).length > 0) return true;
  if (JSON.stringify(before.formValues) !== JSON.stringify(after.formValues)) return true;
  if (diffStrings(before.storageKeys, after.storageKeys).length > 0) return true;
  return false;
}

/** Snapshot of everything an oracle could key on. */
async function captureState(page) {
  const { ensureHelpers } = require('./dom-helpers');
  await ensureHelpers(page);
  const dom = await page.evaluate(() => {
    const H = window.__A11YH;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
      .filter(H.isVisible)
      .map((el) => H.text(el))
      .filter(Boolean)
      .slice(0, 30);
    const statusTexts = Array.from(
      document.querySelectorAll('[role="status"],[role="alert"],[aria-live],output,.error,.success')
    )
      .filter(H.isVisible)
      .map((el) => H.text(el))
      .filter(Boolean)
      .slice(0, 15);
    const formValues = {};
    Array.from(document.querySelectorAll('input,select,textarea'))
      .filter((el) => H.isVisible(el) && el.value)
      .slice(0, 20)
      .forEach((el) => {
        const sel = H.selectorFor(el);
        if (sel) formValues[sel] = String(el.value).slice(0, 60);
      });
    const storageKeys = []
      .concat(Object.keys(localStorage || {}).map((k) => `local:${k}`))
      .concat(Object.keys(sessionStorage || {}).map((k) => `session:${k}`))
      .concat(
        (document.cookie || '')
          .split(';')
          .map((c) => c.split('=')[0].trim())
          .filter(Boolean)
          .map((k) => `cookie:${k}`)
      )
      .slice(0, 40);
    return {
      url: location.href,
      title: document.title,
      headings,
      statusTexts,
      formValues,
      storageKeys,
    };
  });
  return dom;
}

const diffStrings = (before, after) => (after || []).filter((x) => !(before || []).includes(x));

/**
 * Derive an oracle from what actually changed, without an LLM:
 * a changed URL gives `urlMatches` on the new path; else a newly appeared status
 * text or heading gives `elementWithText`; else a changed title gives `titleMatches`.
 */
function deterministicOracle(solved) {
  const { before, after } = solved;
  if (!before || !after) return null;

  if (normalisePath(before.url) !== normalisePath(after.url)) {
    const path = normalisePath(after.url);
    if (path) return { type: 'urlMatches', pattern: escapeRegExp(path) };
  }

  const newStatus = diffStrings(before.statusTexts, after.statusTexts).filter(
    (t) => t.length >= 4 && t.length <= 120
  );
  if (newStatus.length) return { type: 'elementWithText', text: escapeRegExp(newStatus[0]) };

  const newHeadings = diffStrings(before.headings, after.headings).filter(
    (t) => t.length >= 4 && t.length <= 120
  );
  if (newHeadings.length) return { type: 'elementWithText', text: escapeRegExp(newHeadings[0]) };

  if (before.title !== after.title && after.title) {
    return { type: 'titleMatches', pattern: escapeRegExp(after.title.slice(0, 60)) };
  }
  return null;
}

/**
 * The oracle of a navigation task: the destination path, plus a heading of the
 * destination when it has one. No text has to be quoted back by the agent.
 */
function navigationOracle(solved) {
  const to = normalisePath(solved.after && solved.after.url);
  if (!to) return deterministicOracle(solved);
  const url = { type: 'urlMatches', pattern: escapeRegExp(to) };
  const heading = ((solved.after && solved.after.headings) || []).find(
    (t) => t && t.length >= 4 && t.length <= 120
  );
  if (!heading) return url;
  return { type: 'all', of: [url, { type: 'elementWithText', text: escapeRegExp(heading) }] };
}

/** Ask the model for one oracle spec, given the observed before/after state. */
async function proposeOracle({ llm, model, cand, solved, usage }) {
  const { before, after } = solved;
  const summary = [
    `TASK: ${cand.description}`,
    cand.expectedOutcome ? `EXPECTED: ${cand.expectedOutcome}` : null,
    solved.summary ? `THE SIGHTED USER REPORTS: ${solved.summary}` : null,
    '',
    'STATE BEFORE:',
    `  url: ${before.url}`,
    `  title: ${before.title}`,
    `  headings: ${JSON.stringify(before.headings.slice(0, 10))}`,
    `  status texts: ${JSON.stringify(before.statusTexts)}`,
    `  form values: ${JSON.stringify(before.formValues)}`,
    `  storage keys: ${JSON.stringify(before.storageKeys)}`,
    '',
    'STATE AFTER:',
    `  url: ${after.url}`,
    `  title: ${after.title}`,
    `  new headings: ${JSON.stringify(diffStrings(before.headings, after.headings).slice(0, 10))}`,
    `  new status texts: ${JSON.stringify(diffStrings(before.statusTexts, after.statusTexts))}`,
    `  form values: ${JSON.stringify(after.formValues)}`,
    `  new storage keys: ${JSON.stringify(diffStrings(before.storageKeys, after.storageKeys))}`,
    '',
    `REQUESTS OBSERVED (${solved.requests.length}):`,
    ...solved.requests.slice(0, 15).map((r) => `  ${r.method} ${r.url}`),
    '',
    `Available condition types: ${ORACLE_TYPES.join(', ')}.`,
    'Call propose_oracle exactly once.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const res = await llm.chat([{ role: 'user', content: summary }], {
    tools: [PROPOSE_ORACLE_TOOL],
    toolChoice: { type: 'function', function: { name: 'propose_oracle' } },
    temperature: 0,
    systemPrompt: ORACLE_SYSTEM,
    model,
  });
  accumulateUsage(usage, res);
  if (!res || res.success !== true) return null;
  const call = (res.toolCalls || []).find((c) => c.name === 'propose_oracle');
  if (!call || !call.arguments || !call.arguments.type) return null;

  const spec = stripUndefined({ ...call.arguments });
  delete spec.reason;
  try {
    validateSpec(spec);
  } catch (_) {
    return null;
  }
  return spec;
}

function stripUndefined(o) {
  for (const k of Object.keys(o))
    if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
}

/**
 * Attach the generator provenance and apply the ambiguity weighting: a task the
 * sighted agent needed more than `ambiguityRatio` times the path length to solve
 * was ambiguous for a user who could see everything (`ambiguous: true`, weight
 * lowered by one, min 1), so it must not dominate the screen-reader score.
 */
function withGeneratorMeta(task, generator) {
  const out = { ...task, generator };
  const ratio = generator.ratio;
  const limit = generator.ambiguityRatio || DEFAULTS.ambiguityRatio;
  if (typeof ratio === 'number' && ratio > limit) {
    out.ambiguous = true;
    out.weight = Math.max(1, (Number(task.weight) || 1) - 1);
  }
  return out;
}

/** Attach the per-stage wall clock to the finished task (see `buildTask`). */
function withTimings(task, timings) {
  return {
    ...task,
    timings: {
      solveMs: timings.solveMs,
      oracleMs: timings.oracleMs,
      validateMs: timings.validateMs,
      nOptMs: timings.nOptMs,
    },
  };
}

function firstReason(v) {
  if (!v) return 'unknown';
  if (Array.isArray(v.reasons) && v.reasons.length) return v.reasons.join('; ');
  return v.reason || v.error || 'validation failed';
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function accumulateUsage(total, res) {
  const u = res && res.usage;
  if (!u) {
    total.costKnown = false;
    return;
  }
  total.promptTokens += u.promptTokens || 0;
  total.completionTokens += u.completionTokens || 0;
  total.calls += u.calls || 1;
  if (typeof u.cost === 'number' && u.costKnown !== false) total.cost += u.cost;
  else total.costKnown = false;
}

/** Generate and persist in one go. Returns the generator result plus `outPath`. */
async function generateAndSave({ browser, url, llm, model, options, logger, outPath }) {
  const result = await generateTasks({ browser, url, llm, model, options, logger });
  if (outPath) result.outPath = saveTasks(outPath, result.tasks, url);
  return result;
}

module.exports = {
  DEFAULTS,
  ORACLE_TYPES,
  STOPWORDS,
  PROPOSE_TASKS_TOOL,
  PROPOSE_ORACLE_TOOL,
  JUDGE_OUTCOME_TOOL,
  PICK_EVIDENCE_TOOL,
  PROPOSE_SYSTEM,
  ORACLE_SYSTEM,
  generateTasks,
  generateAndSave,
  explore,
  pickExplorationLinks,
  mergeCandidates,
  intentOf,
  deterministicOracle,
  captureState,
  withGeneratorMeta,
  isPlausible,
  keywordsOf,
  stemOf,
  matchedKeywords,
  usableEvidence,
  spokenPhraseFor,
  phrasesNear,
  resolveEvidence,
  informationOracle,
  navigationOracle,
  isNavigationGoal,
  pageHaystack,
  oracleKey,
  dedupeByOracle,
};
