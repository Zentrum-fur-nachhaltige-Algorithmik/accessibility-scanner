/**
 * src/agent/task-generator.js — Stage 3: the SIGHTED task generator.
 *
 * Given nothing but a URL it produces a `tasks.json` that
 * `node src/agent/run.js <url> --tasks tasks.json` consumes unchanged.
 *
 * Why a generator at all: `generic-tasks.js` instantiates fixed DOM heuristics.
 * They are site-agnostic by design and therefore sometimes nonsensical — a
 * "log in" task on gov.uk, where nobody logs in. A measurement is only worth
 * something if the tasks are the things people actually come to the site to do.
 *
 * The pipeline, per site:
 *
 *   1. EXPLORE   load the page with full sighted access, dismiss a cookie banner
 *                (which becomes a `preconditions` step applied everywhere else),
 *                follow up to N main-navigation links and observe those too.
 *   2. PROPOSE   ONE llm call → site type + 5–10 candidate tasks in plain user
 *                language. Merged with the applicable generic templates.
 *   3. SOLVE     the sighted agent really solves each candidate on a fresh,
 *                isolated page. Its trajectory becomes the `sightedPath`.
 *   4. ORACLE    a deterministic fallback oracle is derived from the observed
 *                before/after state; the llm additionally proposes one from the
 *                oracle catalog.
 *   5. VALIDATE  `replay.validateTask` — oracle false at state 0, true after the
 *                replay, twice, on fresh contexts. A task that does not survive
 *                this is DROPPED with a reason. A wrong task must never become a
 *                false accessibility finding.
 *
 * Ambiguity signal: `ratio = sightedAgentSteps / pathLength`. A sighted agent
 * with the whole page in front of it that needed 4 actions for a 1-click path was
 * itself confused — the task is ambiguous, not (only) inaccessible. Such tasks
 * get `ambiguous: true` and their weight lowered by one (min 1), so the
 * screen-reader score is not dominated by them.
 */

'use strict';

const { instantiateGenericTasks, collectCandidates, WORDS } = require('./generic-tasks');
const { extractPageView, renderPageView } = require('./page-view');
const { runSightedAgent, toSightedPath } = require('./sighted-agent');
const { createIsolatedContext, runPreconditions, validateTask } = require('./replay');
const { createRequestRecorder, escapeRegExp, PREDICATE_TYPES, validateSpec } = require('./oracle');
const { validateTaskShape, saveTasks } = require('./task');

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

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

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
  '  describe the clicks — the description is read by someone who cannot see the page.',
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

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Generate, solve and validate tasks for one site.
 *
 * @param {object} args
 * @param {import('puppeteer').Browser} args.browser
 * @param {string} args.url
 * @param {object} args.llm    client with `chat()` (see llm-chat.js)
 * @param {string} [args.model]
 * @param {object} [args.options]  see DEFAULTS
 * @param {{info?: Function, warn?: Function}} [args.logger]
 * @returns {Promise<{url, siteType, tasks, dropped, usage, preconditions, explored}>}
 */
async function generateTasks({ browser, url, llm, model, options = {}, logger = console }) {
  const opts = { ...DEFAULTS, ...options };
  const log = (m) => logger && typeof logger.info === 'function' && logger.info(m);
  const usage = { promptTokens: 0, completionTokens: 0, calls: 0, cost: 0, costKnown: true };
  const dropped = [];

  /* 1. EXPLORE ------------------------------------------------------- */
  log(`[generate] exploring ${url}`);
  const exploration = await explore({ browser, url, opts });
  const { preconditions, views, genericTasks } = exploration;
  log(
    `[generate] explored ${views.length} page(s), ${genericTasks.length} generic task(s), ` +
      `${preconditions.length ? 'cookie banner dismissed as precondition' : 'no cookie banner'}`
  );

  /* 2. PROPOSE ------------------------------------------------------- */
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

  /* 3.–5. SOLVE / ORACLE / VALIDATE ---------------------------------- */
  const tasks = [];
  for (const cand of candidates) {
    const built = await buildTask({
      browser,
      url,
      llm,
      model,
      cand,
      preconditions,
      opts,
      usage,
      log,
    });
    if (built.task) {
      tasks.push(built.task);
      log(`[generate] kept "${built.task.id}" (${built.task.oracle.type})`);
    } else {
      dropped.push({ id: cand.id, description: cand.description, reason: built.reason });
      log(`[generate] dropped "${cand.id}": ${built.reason}`);
    }
  }

  return {
    url,
    siteType,
    tasks,
    dropped,
    usage,
    preconditions,
    explored: views.map((v) => v.url),
  };
}

/* ------------------------------------------------------------------ */
/* 1. Explore                                                          */
/* ------------------------------------------------------------------ */

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
      throw new Error(`cannot load ${url} — ${err.message}`);
    }

    // A cookie banner has to go before anything else is observed: it covers the
    // page and it would otherwise be dismissed inside every single task.
    const pre = await collectCandidates(page, WORDS).catch(() => ({}));
    if (pre && pre.cookie && pre.cookie.button) {
      preconditions = [{ action: 'click', selector: pre.cookie.button }];
      // The cookie banner is itself a legitimate (and very common) task, so it is
      // instantiated BEFORE we dismiss it — afterwards its oracle is already true.
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
        /* a dead nav link is the site's problem, not ours — just skip it */
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

/* ------------------------------------------------------------------ */
/* 2. Propose                                                          */
/* ------------------------------------------------------------------ */

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
 * Merge llm proposals with the generic templates.
 *
 * Generic tasks already carry a verified oracle and sightedPath, so they are
 * cheap and reliable — they are kept. An llm proposal that means the same thing
 * (cookie / search / contact / login) is dropped as a duplicate: the generic
 * version is the one that will survive validation.
 *
 * The generic `login` template is the exception. It fires on any "Sign in" link,
 * and most sites have one without logging in being a thing users come for —
 * gov.uk is the canonical example: "HMRC account: sign in" is a link on the
 * homepage, but nobody's errand on gov.uk is "reach the login page". A task
 * nobody performs still counts in `siteScore`, so it is dropped unless the LLM,
 * which looked at the actual site, proposed a login-like task ITSELF
 * (`generic-login-not-corroborated`). When it did, the generic version is kept
 * and the proposal is deduplicated into it as usual — the generic one carries a
 * verified oracle and path, so it is the cheaper of the two.
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
      reason: 'generic-login-not-corroborated — the site proposal contains no login-like task',
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
        reason: `duplicate-intent (${intent}) — covered by a generic template`,
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

/* ------------------------------------------------------------------ */
/* 3.–5. Solve, derive an oracle, validate                             */
/* ------------------------------------------------------------------ */

async function buildTask({ browser, url, llm, model, cand, preconditions, opts, usage, log }) {
  // A generic template is already a complete task — it only needs validating.
  if (cand.prebuilt) {
    const task = { ...cand.prebuilt, preconditions: preconditions.slice() };
    // The cookie task must NOT have the cookie dismissal as its own precondition.
    if (cand.template === 'cookie-banner-dismiss') task.preconditions = [];
    const v = await validateTask(browser, url, task, { repeats: opts.repeats });
    if (!v.valid)
      return { task: null, reason: `generic task failed validation: ${firstReason(v)}` };
    return {
      task: withGeneratorMeta(task, {
        sightedAgentSteps: null,
        pathLength: task.sightedPath.length,
        ratio: null,
        retries: 0,
        source: 'generic',
      }),
    };
  }

  /* --- solve it with the sighted agent ----------------------------- */
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
  if (solved.error) return { task: null, reason: solved.error };

  const sightedPath = solved.sightedPath;
  if (sightedPath.length === 0) {
    return { task: null, reason: 'sighted agent produced no replayable actions' };
  }
  if (solved.blockedSubmits > 0 && solved.stoppedBy !== 'done') {
    return { task: null, reason: 'needs-submit' };
  }
  if (solved.stoppedBy === 'budget') {
    return { task: null, reason: `sighted agent ran out of budget after ${solved.steps} steps` };
  }
  if (!solved.plausible) {
    return {
      task: null,
      reason: `sighted agent called done without a plausible end state (${
        solved.summary ? truncate(solved.summary, 120) : 'no summary'
      })`,
    };
  }

  /* --- oracle candidates: deterministic fallback + llm proposal ----- */
  const fallback = deterministicOracle(solved);
  const llmOracle = await proposeOracle({ llm, model, cand, solved, usage });

  // The deterministic candidate is preferred when it validates: it is derived
  // from what really changed, needs no model and cannot hallucinate a pattern.
  // The llm proposal is the fallback for cases where nothing obvious changed.
  const oracleCandidates = [
    ...(fallback ? [{ spec: fallback, origin: 'deterministic' }] : []),
    ...(llmOracle ? [{ spec: llmOracle, origin: 'llm' }] : []),
  ];
  if (oracleCandidates.length === 0) {
    return { task: null, reason: 'no oracle could be derived (nothing observable changed)' };
  }

  /* --- validate ----------------------------------------------------- */
  const reasons = [];
  let retries = 0;
  for (const candidateOracle of oracleCandidates) {
    let task;
    try {
      task = validateTaskShape({
        id: cand.id,
        description: cand.description,
        weight: cand.weight || 1,
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
    const v = await validateTask(browser, url, task, { repeats: opts.repeats });
    if (v.valid) {
      return {
        task: withGeneratorMeta(task, {
          sightedAgentSteps: solved.steps,
          pathLength: sightedPath.length,
          ratio: sightedPath.length > 0 ? solved.steps / sightedPath.length : null,
          retries,
          source: 'llm',
          ambiguityRatio: opts.ambiguityRatio,
        }),
      };
    }
    reasons.push(`${candidateOracle.origin}: ${firstReason(v)}`);
    retries += 1;
  }
  return { task: null, reason: `no oracle validated — ${reasons.join(' | ')}` };
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
    if (!pre.ok) return { error: `precondition failed — ${pre.error}` };

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

    return {
      steps: run.steps,
      stoppedBy: run.stoppedBy,
      summary: run.summary,
      blockedSubmits: run.blockedSubmits,
      sightedPath: toSightedPath(run.trajectory),
      trajectory: run.trajectory,
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
 * "Plausible end state": something observable must have changed, otherwise a
 * `done` is just the model being optimistic. Cheap and deliberately generous —
 * `validateTask` is the real gate.
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
 * URL changed → `urlMatches` on the new path; else a newly appeared status text
 * or heading → `elementWithText`; else a changed title → `titleMatches`.
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
 * SIGHTED agent needed more than `ambiguityRatio` × the path length to solve was
 * ambiguous for a user who could see everything, so it must not dominate the
 * screen-reader score.
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
  PROPOSE_TASKS_TOOL,
  PROPOSE_ORACLE_TOOL,
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
};
