/**
 * src/agent/harness.js — orchestrates the SR-agent measurement for one site.
 *
 * Per task: validate the task (a task that cannot be replayed is the task's
 * fault, not the page's, so it is excluded rather than scored 0), measure the
 * model-independent baselines `nSighted` (clicks) and `nOpt` (the shortest
 * ScreenReaderEnv command sequence, see optimal-path.js), then run the SR agent
 * `k` times on a fresh page and score
 *   R = min(1, nOpt / nSr),  R = 0 on failure.
 * `nSighted` is in clicks and `nSr` in keystroke-level commands — different
 * units, so `nSighted` only validates the task and (together with nOpt) sizes
 * the step budget; the score itself compares like with like.
 *
 * `replay`, `oracle` and `screenreader-env` are required lazily so this module
 * (and its tests) can load before/without them.
 */

const { runSrAgent } = require('./sr-agent');

/**
 * R = min(1, nOpt / nSr); 0 when the task was not solved. No smoothing
 * constant: both numbers count the same thing (env commands), so their ratio is
 * already meaningful. A solved task that cost no commands at all scores 1.
 */
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
 * `validateTask` / `replaySightedPath` / `runPreconditions` are specced across
 * task.js and replay.js; prefer replay.js and fall back to task.js so we work
 * with either layout.
 */
function resolveFn(name, required = true) {
  const mods = [];
  try {
    mods.push(loadReplay());
  } catch {
    /* not written yet */
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
 * @param {{info?: Function, warn?: Function}} [args.logger]
 * @param {object} [args.deps] - test seam: `{ validateTask, replaySightedPath, oracle, ScreenReaderEnv, runSrAgent, runPath }`
 * @returns {Promise<{url: string, tasks: object[], siteScore: number|null, invalidTasks: object[]}>}
 */
async function runSite({ browser, url, tasks, llm, k = 1, model, logger = console, deps }) {
  const log = (m) => {
    if (logger && typeof logger.info === 'function') logger.info(m);
  };
  const warn = (m) => {
    if (logger && typeof logger.warn === 'function') logger.warn(m);
  };

  // `deps` is a test seam: the sibling modules live behind lazy requires so this
  // file loads (and is testable) even before they exist on disk.
  const d = deps || {};
  const validateTask = d.validateTask || resolveFn('validateTask');
  const oracleMod = d.oracle || loadOracle();
  const ScreenReaderEnv = d.ScreenReaderEnv || loadEnv().ScreenReaderEnv;
  const agentFn = d.runSrAgent || runSrAgent;
  // Preconditions: replay.runPreconditions(page, task) if available, else
  // replay the precondition list as if it were a sighted path.
  const runPreconditions =
    d.runPreconditions ||
    resolveFn('runPreconditions', false) ||
    ((page, task) =>
      (d.replaySightedPath || resolveFn('replaySightedPath'))(page, {
        ...task,
        sightedPath: task.preconditions,
        oracle: null,
      }));

  const results = [];
  const invalidTasks = [];

  for (const task of tasks || []) {
    let validation;
    try {
      validation = await validateTask(browser, url, task, { repeats: 2 });
    } catch (err) {
      validation = { valid: false, reason: `validateTask threw: ${err.message}` };
    }

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
      invalidTasks.push({ id: task.id, task, reason });
      continue;
    }

    const nSighted = Number(validation.nSighted ?? (task.sightedPath || []).length) || 0;
    // No nOpt (older validateTask, or the measurement failed) → fall back to
    // nSighted so a task is still scored, just more coarsely.
    const nOpt =
      Number.isFinite(validation.nOpt) && validation.nOpt !== null
        ? Number(validation.nOpt)
        : nSighted;
    const optimalPath = validation.optimalPath || null;
    if (validation.optimalPathError) {
      warn(
        `[harness] task "${task.id}": nOpt measurement failed (${validation.optimalPathError}), falling back to nSighted=${nSighted}`
      );
    }
    // Budget: generous enough for both baselines, whichever is larger.
    const maxSteps = Math.max(3 * nOpt + 10, 3 * nSighted + 10);

    const runs = [];
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
        })
      );
    }

    const R = runs.length ? runs.reduce((a, r) => a + r.R, 0) / runs.length : 0;
    const findings = runs.flatMap((r) => r.findings || []);
    results.push({ task, nSighted, nOpt, optimalPath, runs, R, findings });
  }

  const validResults = results.filter((r) => r.runs.length > 0);
  const weightSum = validResults.reduce((a, r) => a + (Number(r.task.weight) || 1), 0);
  const siteScore =
    weightSum > 0
      ? validResults.reduce((a, r) => a + r.R * (Number(r.task.weight) || 1), 0) / weightSum
      : null;

  const usage = aggregateUsage(results);
  return { url, tasks: results, siteScore, invalidTasks, usage };
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
}) {
  let page;
  let env;
  let context;
  try {
    // Isolated context per run so state (cookies, storage) never leaks between runs/tasks.
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

    const checkOracle = async () => {
      try {
        return Boolean(await oracleMod.evaluate(task.oracle, page, ctx));
      } catch {
        return false;
      }
    };

    env = new ScreenReaderEnv(page, { maxSteps });
    await env.start();

    const agent = await agentFn({
      env,
      task,
      llm,
      model,
      maxSteps,
      onStep: async () => ((await checkOracle()) ? { stop: true, reason: 'oracle' } : undefined),
    });

    const success = await checkOracle();

    const findings =
      typeof env.deriveFindings === 'function' ? (await env.deriveFindings()) || [] : [];
    if (agent.stoppedBy === 'done' && !success) {
      findings.push(prematureDoneFinding(task, agent));
    }

    return {
      nSr: agent.nSr,
      success,
      R: scoreTask(nOpt, agent.nSr, success),
      stoppedBy: agent.stoppedBy,
      trace: agent.trace,
      usage: agent.usage,
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

/** Finding shape mirrors BaseScanner.formatViolation (see src/base-scanner.js). */
function prematureDoneFinding(task, agent) {
  return {
    scannerId: 'sr-agent',
    ruleId: 'agent-claimed-done-prematurely',
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

module.exports = { runSite, scoreTask, prematureDoneFinding };
