/**
 * Harness: orchestrates the SR-agent measurement for one site.
 * Per task: validate (an unreplayable task is excluded, not scored 0), measure
 * nSighted and nOpt, run the SR agent k times and score R = min(1, nOpt / nSr).
 */

const { runSrAgent } = require('./sr-agent');
const { runGreedyAgent } = require('./greedy-agent');
const { mapWithConcurrency, DEFAULT_CONCURRENCY } = require('./concurrency');
const { EVIDENCE_NOT_IN_READING_ORDER, MAX_EVIDENCE_PHRASE_SPAN } = require('./optimal-path');
const { heardAnswer, JUDGE_PHRASE_WINDOW } = require('./answer-match');

const secs = (ms) => `${(ms / 1000).toFixed(0)}s`;

/**
 * R = min(1, nOpt / nSr); 0 when the task was not solved. Both numbers count
 * env commands, so no smoothing constant is needed. A solved task that cost no
 * commands scores 1.
 */
/**
 * Bounds of the sighted page view handed to the privileged control run: wider
 * than the sighted agent's defaults, because here the view has to remove the
 * information barrier, not just size a prompt.
 */
const PRIVILEGED_VIEW = { maxElements: 120, maxTextChars: 3000, maxHeadings: 40 };

function scoreTask(nOpt, nSr, success) {
  if (!success) return 0;
  const opt = Number(nOpt) || 0;
  const sr = Number(nSr) || 0;
  if (sr <= 0) return 1;
  return Math.min(1, opt / sr);
}

function loadReplay() {
  return require('./replay');
}
function loadOracle() {
  return require('./oracle');
}
function loadEnv() {
  return require('./screenreader-env');
}

/**
 * Resolve `validateTask` / `replaySightedPath` / `runPreconditions` from
 * replay.js, falling back to task.js. Sibling modules are required lazily so this
 * file loads without them.
 */
function resolveFn(name, required = true) {
  const mods = [];
  try {
    mods.push(loadReplay());
  } catch {
    /* replay.js unavailable */
  }
  try {
    mods.push(require('./task'));
  } catch {
    /* optional */
  }
  for (const m of mods) if (m && typeof m[name] === 'function') return m[name];
  if (!required) return null;
  throw new Error(`harness: ${name}() not found in src/agent/replay.js or src/agent/task.js`);
}

/**
 * Run all tasks of one site.
 *
 * @param {object} args
 * @param {import('puppeteer').Browser} args.browser
 * @param {string} args.url
 * @param {object[]} args.tasks
 * @param {object} args.llm - LLM client with `chat()`
 * @param {number} [args.k=1] - runs per task
 * @param {string} [args.model]
 * @param {'llm'|'greedy'} [args.agent='llm'] - stage 3 (the LLM agent) or stage 2
 *        (the deterministic word matcher of greedy-agent.js, which needs no LLM)
 * @param {'blind'|'privileged'} [args.observation='blind'] - 'privileged' is the control
 *        run of the barrier score: the LLM agent also gets the sighted page view
 *        (page-view.js) every turn, commands and costs unchanged
 * @param {number} [args.concurrency=3] - tasks measured at the same time; the
 *        k runs of one task stay sequential (they share nothing but must not
 *        interleave in the trace).
 * @param {{info?: Function, warn?: Function}} [args.logger]
 * @param {object} [args.deps] - test seam: `{ validateTask, replaySightedPath, oracle, ScreenReaderEnv, runSrAgent, runPath }`
 * @returns {Promise<{url: string, tasks: object[], siteScore: number|null, invalidTasks: object[], wallClockMs: number}>}
 */
async function runSite({
  browser,
  url,
  tasks,
  llm,
  k = 1,
  model,
  agent = 'llm',
  observation = 'blind',
  concurrency = DEFAULT_CONCURRENCY,
  logger = console,
  deps,
}) {
  const log = (m) => {
    if (logger && typeof logger.info === 'function') logger.info(m);
  };
  const warn = (m) => {
    if (logger && typeof logger.warn === 'function') logger.warn(m);
  };

  // `deps` is a test seam for the lazily required sibling modules.
  const d = deps || {};
  const validateTask = d.validateTask || resolveFn('validateTask');
  const oracleMod = d.oracle || loadOracle();
  const ScreenReaderEnv = d.ScreenReaderEnv || loadEnv().ScreenReaderEnv;
  const agentFn = d.runSrAgent || (agent === 'greedy' ? runGreedyAgent : runSrAgent);
  // Preconditions: replay.runPreconditions(page, task) if available, else
  // replay the precondition list as a sighted path.
  const runPreconditions =
    d.runPreconditions ||
    resolveFn('runPreconditions', false) ||
    ((page, task) =>
      (d.replaySightedPath || resolveFn('replaySightedPath'))(page, {
        ...task,
        sightedPath: task.preconditions,
        oracle: null,
      }));

  // One reading-order analysis cache for the whole site: the analysis is pure
  // with respect to (url, DOM fingerprint), so tasks that walk the same pages
  // pay for the in-page walk once.
  const analysisCache = new Map();
  const startedAt = Date.now();

  // The per-task chain validate → nOpt → SR agent is independent per task (every
  // stage opens its own isolated context), so `concurrency` of them run at once.
  const settled = await mapWithConcurrency(tasks || [], concurrency, async (task) => {
    let validation;
    const t0 = Date.now();
    try {
      validation = await validateTask(browser, url, task, { repeats: 2, analysisCache });
    } catch (err) {
      validation = { valid: false, reason: `validateTask threw: ${err.message}` };
    }
    const vTimings = (validation && validation.timings) || {};
    const nOptMs = Number(vTimings.nOptMs) || 0;
    const validateMs = Number.isFinite(vTimings.validateMs)
      ? vTimings.validateMs
      : Math.max(0, Date.now() - t0 - nOptMs);

    const valid = validation && (validation.valid ?? validation.ok);
    if (!valid) {
      const reason =
        (validation &&
          (validation.reason ||
            (Array.isArray(validation.reasons) && validation.reasons.length
              ? validation.reasons.join('; ')
              : null) ||
            validation.error)) ||
        'task validation failed';
      warn(`[harness] task "${task.id}" excluded: ${reason}`);
      log(`[run] task ${task.id}: validate ${secs(validateMs)} → excluded`);
      return { invalid: { id: task.id, task, reason } };
    }

    const nSighted = Number(validation.nSighted ?? (task.sightedPath || []).length) || 0;
    // Without nOpt (measurement failed) fall back to nSighted so the task is
    // still scored, just more coarsely. nSighted is in clicks, nSr in commands,
    // so nSighted otherwise only validates the task and sizes the budget.
    const nOpt =
      Number.isFinite(validation.nOpt) && validation.nOpt !== null
        ? Number(validation.nOpt)
        : nSighted;
    const optimalPath = validation.optimalPath || null;
    // 'dag' means nOpt was priced along a route that skipped a link that led straight to the
    // target, not along the (possibly wandering) sighted path.
    const optimalRoute = validation.route || null;
    const readDistance = Number.isFinite(validation.readDistance) ? validation.readDistance : null;
    const nOptPartial = !!validation.nOptPartial;
    // The evidence text is on the page but no spoken phrase carries it: the
    // screen reader never says the answer. That is a barrier, not a broken
    // measurement - the task is kept (nOpt covers the navigation only) and the
    // barrier is reported.
    const evidenceFindings = [];
    if (validation.optimalPathError === EVIDENCE_NOT_IN_READING_ORDER) {
      warn(
        `[harness] task "${task.id}": evidence "${task.evidence}" is on the page but never spoken; ` +
          `nOpt=${nOpt} covers navigation only`
      );
      evidenceFindings.push(evidenceNotReadableFinding(task));
    } else if (validation.optimalPathError) {
      warn(
        `[harness] task "${task.id}": nOpt measurement failed (${validation.optimalPathError}), falling back to nSighted=${nSighted}`
      );
    }
    // Budget: the larger of both baselines.
    const maxSteps = Math.max(3 * nOpt + 10, 3 * nSighted + 10);

    const runs = [];
    const tAgent = Date.now();
    for (let i = 0; i < k; i++) {
      log(
        `[harness] task "${task.id}" run ${i + 1}/${k} (nSighted=${nSighted}, nOpt=${nOpt}, budget=${maxSteps})`
      );
      runs.push(
        await runOnce({
          browser,
          url,
          task,
          llm,
          model,
          nOpt,
          maxSteps,
          oracleMod,
          ScreenReaderEnv,
          agentFn,
          runPreconditions,
          observation,
        })
      );
    }
    const agentMs = Date.now() - tAgent;

    const R = runs.length ? runs.reduce((a, r) => a + r.R, 0) / runs.length : 0;
    const findings = [...evidenceFindings, ...runs.flatMap((r) => r.findings || [])];
    const nSrTotal = runs.reduce((a, r) => a + (Number(r.nSr) || 0), 0);
    log(
      `[run] task ${task.id}: validate ${secs(validateMs)} · nOpt ${secs(nOptMs)} · ` +
        `sr-agent ${secs(agentMs)} (${nSrTotal} steps) → R ${R.toFixed(2)}`
    );
    return {
      result: {
        task,
        nSighted,
        nOpt,
        ...(nOptPartial ? { nOptPartial: true } : {}),
        readDistance,
        optimalPath,
        optimalRoute,
        ...(validation.skipped ? { optimalSkipped: validation.skipped } : {}),
        runs,
        R,
        findings,
        timings: { validateMs, nOptMs, agentMs },
      },
    };
  });

  // Reassembled in task order: concurrency must not reorder the report.
  const results = settled.filter((s) => s && s.result).map((s) => s.result);
  const invalidTasks = settled.filter((s) => s && s.invalid).map((s) => s.invalid);
  const wallClockMs = Date.now() - startedAt;
  const stageSum = results.reduce(
    (a, r) => a + r.timings.validateMs + r.timings.nOptMs + r.timings.agentMs,
    0
  );
  log(
    `[run] wall-clock total ${secs(wallClockMs)} (sum of stages ${secs(stageSum)}, concurrency ${concurrency})`
  );

  const validResults = results.filter((r) => r.runs.length > 0);
  const weightSum = validResults.reduce((a, r) => a + (Number(r.task.weight) || 1), 0);
  const siteScore =
    weightSum > 0
      ? validResults.reduce((a, r) => a + r.R * (Number(r.task.weight) || 1), 0) / weightSum
      : null;

  const usage = aggregateUsage(results);
  return { url, agent, observation, tasks: results, siteScore, invalidTasks, usage, wallClockMs };
}

/**
 * Everything a screen-reader user heard so far: cursor phrases and announcements.
 * Rotor lists are deliberately left out: a list of headings or links is an index
 * the user scans to jump somewhere, not content that was read. Counting its
 * entries as heard let an agent "read" a whole page in one command.
 */
function tracePhrases(env) {
  const out = [];
  for (const entry of (env && env.trace) || []) {
    const obs = entry && entry.obsAfter;
    if (!obs) continue;
    if (typeof obs.phrase === 'string') out.push(obs.phrase);
    for (const a of obs.announcements || []) out.push(a);
  }
  return out.filter((p) => typeof p === 'string' && p !== '');
}

const squash = (s) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The cursor phrases in the order the agent heard them (no rotor, no live regions). */
function cursorPhrases(env) {
  const out = [];
  for (const entry of (env && env.trace) || []) {
    const obs = entry && entry.obsAfter;
    if (!obs || typeof obs.phrase !== 'string' || obs.phrase === '') continue;
    out.push(obs.phrase);
  }
  return out;
}

/**
 * True once the agent has heard the task's evidence.
 *
 * Primary path: one single phrase contains it. But the screen reader speaks
 * NODES, not sentences, so an answer like "Ordinationszeiten Mo: 12h30 - 18h30"
 * can be split over neighbouring nodes; a run of up to
 * `MAX_EVIDENCE_PHRASE_SPAN` phrases heard one after the other therefore counts
 * as well. Anything wider is not "hearing the answer" any more.
 */
function heardEvidence(env, evidence) {
  const needle = squash(evidence);
  if (!needle) return false;
  const all = tracePhrases(env);
  if (all.some((p) => squash(p).includes(needle))) return true;

  const cursor = cursorPhrases(env).map(squash);
  for (let i = 0; i < cursor.length; i += 1) {
    let joined = cursor[i];
    for (let w = 2; w <= MAX_EVIDENCE_PHRASE_SPAN && i + w <= cursor.length; w += 1) {
      joined = `${joined} ${cursor[i + w - 1]}`;
      if (joined.includes(needle)) return true;
    }
  }
  return false;
}

/** Everything heard, split the way `answer-match.js` needs it. */
function heardSpeech(env) {
  return { all: tracePhrases(env), cursor: cursorPhrases(env) };
}

/**
 * The last resort of answer checking: ONE cheap LLM call that decides whether
 * what the user heard carries the ground-truth answer. Only asked when the
 * deterministic normalisers found nothing AND the agent has stopped, so it
 * costs at most one call per run.
 */
const JUDGE_ANSWER_TOOL = {
  type: 'function',
  function: {
    name: 'judge_answer',
    description: 'State whether the screen-reader user really heard the answer.',
    parameters: {
      type: 'object',
      properties: {
        equivalent: {
          type: 'boolean',
          description:
            'true only if the phrases carry the SAME information as the expected answer, ' +
            'in whatever spelling or wording.',
        },
        evidence: {
          type: 'string',
          description: 'The phrase (copied verbatim) that carries it, or an empty string.',
        },
      },
      required: ['equivalent', 'evidence'],
      additionalProperties: false,
    },
  },
};

const JUDGE_ANSWER_SYSTEM = [
  'A blind user explored a website with a screen reader to find out one specific thing.',
  'You are given the expected answer and the last phrases the screen reader spoke.',
  'Decide whether those phrases really carry that answer. The SAME information in a different',
  'spelling, formatting, order or language counts (a phone number with or without country code,',
  'an address spread over several lines, opening hours written "12h30" instead of "12:30").',
  'Something merely related does NOT count: a different phone number, a contact form, a link to a',
  'page that would have the answer, or the topic being mentioned without the value.',
  'Call judge_answer exactly once.',
].join('\n');

/**
 * One `judge_answer` call over the phrases the agent heard.
 * @returns {Promise<{equivalent: boolean, evidence: string, usage?: object}|null>}
 */
async function judgeAnswer({ llm, model, task, phrases }) {
  if (!llm || typeof llm.chat !== 'function') return null;
  const recent = (phrases || []).slice(-JUDGE_PHRASE_WINDOW);
  if (recent.length === 0) return null;
  const content = [
    `THE USER WANTED TO FIND OUT: ${task.description}`,
    `THE EXPECTED ANSWER (${task.answerType}): ${task.answer}`,
    '',
    'THE PHRASES THE SCREEN READER SPOKE (most recent last):',
    ...recent.map((p, i) => `${i + 1}. ${p}`),
  ].join('\n');
  let res;
  try {
    res = await llm.chat([{ role: 'user', content }], {
      tools: [JUDGE_ANSWER_TOOL],
      toolChoice: { type: 'function', function: { name: 'judge_answer' } },
      temperature: 0,
      systemPrompt: JUDGE_ANSWER_SYSTEM,
      model,
    });
  } catch (_) {
    return null;
  }
  if (!res || res.success !== true) return null;
  const call = (res.toolCalls || []).find((c) => c.name === 'judge_answer');
  if (!call || !call.arguments) return null;
  return {
    equivalent: call.arguments.equivalent === true,
    evidence: typeof call.arguments.evidence === 'string' ? call.arguments.evidence : '',
    usage: res.usage || null,
  };
}

/** Add a single extra LLM call's usage onto the run usage. */
function mergeUsage(base, extra) {
  if (!extra) return base;
  const out = { ...(base || {}) };
  out.promptTokens = (out.promptTokens || 0) + (extra.promptTokens || 0);
  out.completionTokens = (out.completionTokens || 0) + (extra.completionTokens || 0);
  out.calls = (out.calls || 0) + (extra.calls || 1);
  if (typeof extra.cost === 'number') out.cost = (out.cost || 0) + extra.cost;
  else out.costKnown = false;
  return out;
}

async function createIsolatedContext(browser) {
  if (typeof browser.createBrowserContext === 'function') return browser.createBrowserContext();
  if (typeof browser.createIncognitoBrowserContext === 'function')
    return browser.createIncognitoBrowserContext();
  return { newPage: () => browser.newPage(), close: async () => {} };
}

/** One SR-agent run on a fresh, isolated browser context. */
async function runOnce({
  browser,
  url,
  task,
  llm,
  model,
  nOpt,
  maxSteps,
  oracleMod,
  ScreenReaderEnv,
  agentFn,
  runPreconditions,
  observation = 'blind',
}) {
  let page;
  let env;
  let context;
  try {
    // Isolated context per run so cookies and storage never leak between runs.
    context = await createIsolatedContext(browser);
    page = await context.newPage();

    // `requestSent` oracles need the recorder attached before navigation.
    let ctx = {};
    if (typeof oracleMod.createRequestRecorder === 'function') {
      ctx = { recorder: await oracleMod.createRequestRecorder(page) };
    }

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    if (Array.isArray(task.preconditions) && task.preconditions.length > 0) {
      const pre = await runPreconditions(page, task);
      if (pre && pre.ok === false) throw new Error(`precondition failed: ${pre.error}`);
    }

    // An information task is only solved once the screen reader has actually
    // SPOKEN the answer: the text is on the page from the start, so the page
    // predicate alone would score a user who never found it. The trace check is
    // in-memory and runs after every step, next to the page oracle.
    const info = task.kind === 'information' ? task : null;
    /**
     * Deterministic success check, cheap enough to run after every step.
     * `by` records HOW it was established:
     *  - `oracle`:            action task, the page predicate turned true;
     *  - `evidence`:          the exact evidence text was heard on the page the
     *                         oracle points at (the primary, quick path);
     *  - `answer-normalised`: the SAME answer was heard in another spelling or
     *                         on another page (see answer-match.js). The page
     *                         predicate is deliberately not required here: the
     *                         user has the answer wherever they found it.
     */
    const checkDeterministic = async () => {
      let pageOk = false;
      try {
        pageOk = await oracleMod.evaluate(task.oracle, page, ctx);
      } catch {
        pageOk = false;
      }
      if (!info) return pageOk ? { ok: true, by: 'oracle' } : { ok: false, by: null };
      if (pageOk && heardEvidence(env, info.evidence)) return { ok: true, by: 'evidence' };
      if (info.answer) {
        const m = heardAnswer(heardSpeech(env), info.answer, info.answerType);
        if (m.matched) return { ok: true, by: 'answer-normalised', window: m.window };
      }
      return { ok: false, by: null };
    };

    env = new ScreenReaderEnv(page, { maxSteps });
    await env.start();

    // The fragmentation check is per PAGE, not per step: run it once at the
    // start and again whenever the agent has navigated somewhere new.
    const checkFragmentation = async () => {
      if (typeof env.checkReadingFragmentation !== 'function') return;
      await env.checkReadingFragmentation().catch(() => {});
    };
    await checkFragmentation();

    // The privileged control run reads the same page the env drives, so what it
    // sees is exactly the state the screen reader is in.
    const privilegedView =
      observation === 'privileged'
        ? async () => {
            const { extractPageView, renderPageView } = require('./page-view');
            return renderPageView(await extractPageView(page, PRIVILEGED_VIEW));
          }
        : undefined;

    const agent = await agentFn({
      env,
      task,
      llm,
      model,
      maxSteps,
      observation,
      privilegedView,
      onStep: async () => {
        const last = env.trace && env.trace[env.trace.length - 1];
        if (last && last.obsAfter && last.obsAfter.urlChanged) await checkFragmentation();
        return (await checkDeterministic()).ok ? { stop: true, reason: 'oracle' } : undefined;
      },
    });

    let outcome = await checkDeterministic();
    let usage = agent.usage;
    // Last resort, at most one call per run: the normalisers only know the
    // spellings we anticipated, so when the agent stopped believing it was done
    // (or ran out of budget) an LLM decides whether what it heard IS the answer.
    if (
      !outcome.ok &&
      info &&
      info.answer &&
      (agent.stoppedBy === 'done' || agent.stoppedBy === 'budget')
    ) {
      const judged = await judgeAnswer({ llm, model, task, phrases: tracePhrases(env) });
      if (judged) {
        usage = mergeUsage(usage, judged.usage);
        if (judged.equivalent) outcome = { ok: true, by: 'answer-llm', window: judged.evidence };
      }
    }
    const success = outcome.ok;

    await checkFragmentation();
    const findings =
      typeof env.deriveFindings === 'function' ? (await env.deriveFindings()) || [] : [];
    if (agent.stoppedBy === 'done' && !success) {
      // Only a page that stayed silent after the agent's last action is a
      // barrier; otherwise the agent simply misjudged its own progress.
      findings.push(
        silentAfterLastAction(env)
          ? prematureDoneFinding(task, agent)
          : stoppedEarlyFinding(task, agent)
      );
    }

    return {
      nSr: agent.nSr,
      success,
      // How success was established: 'oracle' | 'evidence' | 'answer-normalised'
      // | 'answer-llm' (null when the task was not solved).
      successBy: outcome.by || null,
      ...(outcome.window ? { successWindow: outcome.window } : {}),
      R: scoreTask(nOpt, agent.nSr, success),
      stoppedBy: agent.stoppedBy,
      trace: agent.trace,
      usage,
      findings,
      ...(agent.error ? { error: agent.error } : {}),
    };
  } catch (err) {
    return {
      nSr: 0,
      success: false,
      R: 0,
      stoppedBy: 'error',
      trace: (env && env.trace) || [],
      findings: [],
      error: err.message,
    };
  } finally {
    if (env && typeof env.stop === 'function') await env.stop().catch(() => {});
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/** Sum LLM usage/cost over all runs of all tasks. `cost` is USD as reported by OpenRouter. */
function aggregateUsage(taskResults) {
  const total = { promptTokens: 0, completionTokens: 0, calls: 0, cost: 0, costKnown: true };
  for (const t of taskResults) {
    for (const run of t.runs || []) {
      const u = run.usage;
      if (!u) continue;
      total.promptTokens += u.promptTokens || 0;
      total.completionTokens += u.completionTokens || 0;
      total.calls += u.calls || 0;
      if (typeof u.cost === 'number' && u.costKnown !== false) total.cost += u.cost;
      else total.costKnown = false;
    }
  }
  return total;
}

/** Commands that ask the page to do something; everything else only reads. */
const STATE_CHANGING_COMMANDS = new Set(['activate', 'type', 'escape']);

/**
 * True when the page gave NO perceivable feedback for the agent's last
 * state-changing command: no URL change, no announcement (a live region and the
 * "page loaded: <title>" of a new document both land in `announcements`), no
 * focus move, no new window and no DOM change. That silence is what makes a
 * premature `done` the page's fault.
 *
 * An agent that never issued a state-changing command asked the page for
 * nothing, so its `done` says nothing about the page: false.
 */
function silentAfterLastAction(env) {
  const trace = (env && env.trace) || [];
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const entry = trace[i] || {};
    const type = entry.cmd && entry.cmd.type;
    if (!STATE_CHANGING_COMMANDS.has(type)) continue;
    const obs = entry.obsAfter || {};
    const focusBefore = (entry.obsBefore && entry.obsBefore.focusSelector) || null;
    const focusAfter = (obs.focus && obs.focus.selector) || null;
    return !(
      obs.urlChanged ||
      obs.newPage ||
      (obs.announcements || []).length > 0 ||
      focusAfter !== focusBefore ||
      entry.domChanged
    );
  }
  return false;
}

/** Finding shape mirrors BaseScanner.formatViolation (see src/base-scanner.js). */
function prematureDoneFinding(task, agent) {
  return {
    scannerId: 'sr-agent',
    ruleId: 'agent-claimed-done-prematurely',
    // Every finding carries `type` next to `ruleId` so report consumers (and the
    // run.js summary) can group findings from the env and from the harness alike.
    type: 'agent-claimed-done-prematurely',
    impact: 'serious',
    severity: 'violation',
    description:
      `The screen-reader agent believed the task "${task.description}" was complete and stopped, ` +
      'but the task was not actually accomplished. The page gave no perceivable feedback that would ' +
      'have told a screen-reader user that the action did not take effect.',
    nodes: [],
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html',
    wcagCriteria: ['4.1.3'],
    meta: { taskId: task.id, nSr: agent.nSr, stoppedBy: agent.stoppedBy },
  };
}

/**
 * The agent stopped although the task was not solved, but the page did react to
 * what it did. That is a misjudgement of the agent, not a barrier of the site:
 * it is reported for the run log, as an agent finding, and no site score counts
 * it. R for the task stays 0 either way, the task was not solved.
 */
function stoppedEarlyFinding(task, agent) {
  return {
    scannerId: 'sr-agent',
    ruleId: 'agent-stopped-early',
    type: 'agent-stopped-early',
    impact: 'minor',
    severity: 'info',
    description:
      `The screen-reader agent believed the task "${task.description}" was complete and stopped, ` +
      'but the task was not accomplished. The page did give perceivable feedback for the last ' +
      'action, so this is the agent stopping early, not a barrier of the page.',
    nodes: [],
    helpUrl: null,
    wcagCriteria: [],
    meta: { taskId: task.id, nSr: agent.nSr, stoppedBy: agent.stoppedBy },
  };
}

/**
 * The answer an information task asks for exists in the page's visual text but
 * in no spoken phrase - CSS-generated content, text baked into an image, or
 * markup that takes it out of the accessibility tree. A sighted user reads it,
 * a screen-reader user never hears it.
 */
function evidenceNotReadableFinding(task) {
  return {
    scannerId: 'sr-agent',
    ruleId: 'evidence-not-readable',
    type: 'evidence-not-readable',
    impact: 'serious',
    severity: 'violation',
    description:
      `The information the task "${task.description}" asks for ("${task.evidence}") is present on ` +
      'the page but is never spoken by the screen reader: no element in the reading order carries ' +
      'that text. Sighted users can read it; screen-reader users cannot reach it at all. Typical ' +
      'causes are CSS-generated content, text rendered as an image without an equivalent, or ' +
      'markup that hides the text from the accessibility tree.',
    nodes: [],
    helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    wcagCriteria: ['1.1.1', '1.3.1'],
    meta: { taskId: task.id, evidence: task.evidence },
  };
}

module.exports = {
  runSite,
  scoreTask,
  judgeAnswer,
  heardSpeech,
  JUDGE_ANSWER_TOOL,
  prematureDoneFinding,
  stoppedEarlyFinding,
  silentAfterLastAction,
  evidenceNotReadableFinding,
  tracePhrases,
  cursorPhrases,
  heardEvidence,
};
