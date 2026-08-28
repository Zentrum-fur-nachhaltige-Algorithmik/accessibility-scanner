/**
 * Replay: deterministic replay of a task's sighted path, no LLM involved.
 * Replaying proves the task is well-formed: the oracle must be false before
 * the path runs and true after. `nSighted` is the path's step count.
 */

'use strict';

const { evaluate, createRequestRecorder } = require('./oracle');
const { validateTaskShape } = require('./task');

const DEFAULTS = {
  selectorTimeout: 5000, // how long to wait for a step's selector to appear
  navigationTimeout: 2000, // how long to wait for a navigation a step may trigger
  settleMs: 150, // small settle delay after a non-navigating interaction
  gotoTimeout: 30000,
  oracleSettleMs: 3000, // how long a false oracle is re-checked after the last step
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function describeStep(step, index, kind) {
  const target = step.selector || step.url || step.key || '';
  return `${kind}[${index}] ${step.action}${target ? ` "${target}"` : ''}`;
}

/** Wait for a selector, throwing a clear, actionable error if it never shows up. */
async function requireSelector(page, selector, label, opts) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: opts.selectorTimeout });
  } catch (_) {
    // A non-visible match distinguishes "missing" from "hidden".
    const exists = await page.$(selector).catch(() => null);
    throw new Error(
      exists
        ? `${label}: element matched by selector is present but never became visible: ${selector}`
        : `${label}: selector not found: ${selector}`
    );
  }
}

/**
 * Execute one step. Navigations triggered by the step are awaited.
 * Throws with a `${label}: ...` message on any failure.
 */
async function executeStep(page, step, label, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  if (step.action === 'goto') {
    await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: opts.gotoTimeout });
    return;
  }

  if (step.selector) await requireSelector(page, step.selector, label, opts);

  // Any of the interactions below may navigate. Arm a navigation watcher first
  // and swallow its timeout when nothing navigates.
  const navPromise = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: opts.navigationTimeout })
    .then(() => true)
    .catch(() => false);

  switch (step.action) {
    case 'click':
      await page.click(step.selector);
      break;
    case 'type':
      await page.click(step.selector, { clickCount: 3 }); // select existing content
      await page.type(step.selector, step.text, { delay: 0 });
      break;
    case 'press':
      if (step.selector) await page.focus(step.selector);
      await page.keyboard.press(step.key);
      break;
    default:
      throw new Error(`${label}: unsupported action "${step.action}"`);
  }

  const navigated = await navPromise;
  if (!navigated) await delay(opts.settleMs);
}

/**
 * Evaluate an oracle, re-checking a false result for up to `settleMs`. A
 * client-side router finishes its route change after the click has returned
 * (payload fetch, then pushState), and on a loaded machine that outlasts the
 * navigation watcher of the step.
 */
async function evaluateSettled(spec, page, ctx, settleMs) {
  const deadline = Date.now() + (settleMs || 0);
  let verdict = await evaluate(spec, page, ctx);
  while (verdict !== true && Date.now() < deadline) {
    await delay(250);
    verdict = await evaluate(spec, page, ctx);
  }
  return verdict;
}

/** Run a list of steps in order. Throws on the first failing step. */
async function runSteps(page, steps, kind, options) {
  for (let i = 0; i < steps.length; i += 1) {
    const label = describeStep(steps[i], i, kind);
    await executeStep(page, steps[i], label, options);
  }
}

/**
 * Run the task's preconditions (e.g. dismiss a cookie banner). They run before
 * both the sighted replay and the SR agent, so the oracle's "state 0" is the
 * state after preconditions.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function runPreconditions(page, task, options = {}) {
  const steps = task.preconditions || [];
  if (steps.length === 0) return { ok: true };
  try {
    await runSteps(page, steps, 'precondition', options);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Replay a task's sighted path deterministically.
 *
 * @param {import('puppeteer').Page} page already navigated, preconditions applied
 * @param {object} task
 * @param {object} [ctx] oracle context, e.g. `{ recorder }` for `requestSent`
 * @param {object} [options] timeout overrides (see DEFAULTS)
 * @param {(page, task, options) => Promise<void>} [runner] executes the path;
 *        defaults to running the steps in order. `validateTask` swaps in the
 *        optimal-path walk, which executes the very same steps while also
 *        costing them, so one page does both jobs. It must throw on failure.
 * @returns {Promise<{ok, nSighted, oracleBefore, oracleAfter, error?}>}
 */
async function replaySightedPath(page, task, ctx = {}, options = {}, runner = null) {
  const opts = { ...DEFAULTS, ...options };
  const steps = task.sightedPath || [];
  const nSighted = steps.length;
  const result = { ok: false, nSighted, oracleBefore: null, oracleAfter: null };

  try {
    result.oracleBefore = await evaluate(task.oracle, page, ctx);
  } catch (err) {
    result.error = `oracle evaluation failed before replay: ${err.message}`;
    return result;
  }

  try {
    if (runner) await runner(page, task, options);
    else await runSteps(page, steps, 'sightedPath', options);
  } catch (err) {
    result.error = err.message;
    // Still report the oracle state so callers can see how far the replay got.
    result.oracleAfter = await evaluate(task.oracle, page, ctx).catch(() => null);
    return result;
  }

  try {
    result.oracleAfter = await evaluateSettled(task.oracle, page, ctx, opts.oracleSettleMs);
  } catch (err) {
    result.error = `oracle evaluation failed after replay: ${err.message}`;
    return result;
  }

  result.ok = result.oracleAfter === true;
  if (!result.ok) result.error = 'oracle still false after replaying the sighted path';
  return result;
}

/**
 * Validate a task against a live site by replaying it `repeats` times, each on a
 * fresh page. A task is valid only if, on every repeat, the oracle is false at
 * state 0 (after preconditions) and true after the replay. An invalid task is
 * excluded from scoring: it says nothing about the accessibility of the page.
 *
 * A valid task additionally gets its `nOpt`, the length of the shortest
 * ScreenReaderEnv command sequence for the same path (see optimal-path.js).
 * `nSighted` is in clicks, not screen-reader commands, and serves validation
 * and the step budget only.
 *
 * The `nOpt` walk needs exactly the state a validation repeat starts from
 * (fresh context + goto + preconditions) and executes exactly the steps a
 * repeat executes, so it rides along on the LAST repeat instead of paying for
 * another context and another page load. Should that fused attempt fail, the
 * repeat is redone cleanly and `nOpt` is measured on its own page as before, so
 * the outcome never depends on the fusion.
 *
 * `options.analysisCache` (a Map created once per site) is forwarded to
 * `computeOptimalPath`; see there.
 *
 * For an information task `nOpt` additionally covers the final `read` step:
 * reaching the reading-order position whose spoken phrase carries the task's
 * `evidence` (action cost 0 - hearing it IS the goal). `readDistance` reports
 * that step's reach cost. When no spoken phrase contains the evidence,
 * `optimalPathError` is `'evidence-not-in-reading-order'`, `nOptPartial` is
 * true and `nOpt` covers the navigation only.
 *
 * @returns {Promise<{ valid, reasons: string[], nSighted, nOpt: number|null,
 *                     route: 'guided'|'direct-link'|null, shortcut?: object,
 *                     optimalPath: object[]|null, optimalPathError?: string,
 *                     readDistance: number|null, nOptPartial?: boolean,
 *                     timings: { validateMs: number, nOptMs: number } }>}
 */
async function validateTask(
  browser,
  url,
  task,
  { repeats = 2, options = {}, computeOptimal = true, analysisCache = null } = {}
) {
  const startedAt = Date.now();
  const reasons = [];
  let nOptMs = 0;
  let normalized;
  try {
    normalized = validateTaskShape(task);
  } catch (err) {
    return {
      valid: false,
      reasons: [err.message],
      nSighted: 0,
      nOpt: null,
      optimalPath: null,
      readDistance: null,
      timings: { validateMs: Date.now() - startedAt, nOptMs: 0 },
    };
  }
  const nSighted = normalized.sightedPath.length;
  const { computeOptimalPath } = require('./optimal-path');
  // Where the sighted path ends: the target the direct-link shortcut of
  // `computeOptimalPath` looks for. Recorded by the plain repeats, so the fused
  // last repeat already knows it.
  let endUrl = null;

  /** One repeat on its own isolated context. Returns the reasons it collected. */
  const runRepeat = async (attempt, runner) => {
    const found = [];
    // Isolated context per repeat: cookies/storage from one repeat must not
    // leak into the next (a cookie banner dismissed in repeat 1 would make the
    // oracle "already true at state 0" in repeat 2).
    const context = await createIsolatedContext(browser);
    const page = await context.newPage();
    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULTS.gotoTimeout });

      const pre = await runPreconditions(page, normalized, options);
      if (!pre.ok) {
        found.push(`repeat ${attempt}: precondition failed: ${pre.error}`);
        return found;
      }

      // Recorder starts at state 0 so the initial navigation and the
      // preconditions do not satisfy a `requestSent` oracle by themselves.
      const recorder = createRequestRecorder(page);
      const ctx = { recorder };
      try {
        const res = await replaySightedPath(page, normalized, ctx, options, runner);
        // An information task asks the user to FIND OUT something. The text that
        // holds the answer is usually already on the page at state 0, so "false
        // before" cannot be required; what makes such a task non-trivial is that
        // the screen reader has to actually speak it, which the harness checks.
        if (res.oracleBefore !== false && normalized.kind !== 'information') {
          found.push(
            `repeat ${attempt}: oracle is already true at state 0 (task is trivially solved)`
          );
        }
        if (!res.ok) {
          found.push(`repeat ${attempt}: ${res.error || 'oracle false after replay'}`);
        } else if (!endUrl) {
          endUrl = page.url();
        }
      } finally {
        recorder.stop();
      }
    } catch (err) {
      found.push(`repeat ${attempt}: ${err.message}`);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
    return found;
  };

  let fused = null;
  for (let attempt = 1; attempt <= repeats; attempt += 1) {
    // The last repeat doubles as the nOpt measurement.
    const fuse = computeOptimal && attempt === repeats;
    let runner = null;
    if (fuse) {
      runner = async (page, t, opts) => {
        const t0 = Date.now();
        try {
          fused = await computeOptimalPath(
            page,
            t,
            {},
            {
              ...opts,
              analysisCache,
              targetUrl: endUrl,
            }
          );
        } finally {
          nOptMs += Date.now() - t0;
        }
        if (fused.error) throw new Error(fused.error);
      };
    }

    let found = await runRepeat(attempt, runner);
    if (fuse && fused && fused.error) {
      // The fused walk failed, so this repeat says nothing about the task:
      // redo it as a plain replay and fall back to a standalone measurement.
      fused = null;
      found = await runRepeat(attempt, null);
    }
    reasons.push(...found);
  }

  const result = {
    valid: reasons.length === 0,
    reasons,
    nSighted,
    nOpt: null,
    optimalPath: null,
    readDistance: null,
    timings: { validateMs: 0, nOptMs: 0 },
  };
  const finish = () => {
    result.timings = { validateMs: Math.max(0, Date.now() - startedAt - nOptMs), nOptMs };
    return result;
  };
  if (!result.valid || !computeOptimal) return finish();

  let opt = fused;
  if (!opt) {
    const t0 = Date.now();
    opt = await measureOptimalPath(browser, url, normalized, options, analysisCache, endUrl);
    nOptMs += Date.now() - t0;
  }
  result.nOpt = opt.nOpt;
  result.optimalPath = opt.steps || null;
  // Which route nOpt was priced along: the sighted path, or a direct link to the
  // target that was on one of its pages (see optimal-path.js).
  result.route = opt.route || null;
  if (opt.shortcut) result.shortcut = opt.shortcut;
  if (opt.guidedNOpt !== undefined) result.guidedNOpt = opt.guidedNOpt;
  // Information tasks carry a final `read` step: the cost of actually HEARING
  // the evidence. `readDistance` is its reach cost; `nOptPartial` says nOpt
  // covers only the navigation because the read step could not be costed
  // (`optimalPathError`, e.g. `evidence-not-in-reading-order`).
  if (opt.readDistance !== undefined) result.readDistance = opt.readDistance;
  if (opt.nOptPartial) result.nOptPartial = true;
  if (opt.optimalPathError) result.optimalPathError = opt.optimalPathError;
  if (opt.error) result.optimalPathError = opt.error;
  return finish();
}

/**
 * `nOpt` on one extra isolated-context page: navigate, run the preconditions
 * (state 0, exactly what the SR agent sees) and walk the sighted path with the
 * screen-reader cost model.
 */
async function measureOptimalPath(
  browser,
  url,
  task,
  options = {},
  analysisCache = null,
  targetUrl = null
) {
  const { computeOptimalPath } = require('./optimal-path');
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULTS.gotoTimeout });
    const pre = await runPreconditions(page, task, options);
    if (!pre.ok) return { nOpt: null, steps: null, error: `precondition failed: ${pre.error}` };
    return await computeOptimalPath(page, task, {}, { ...options, analysisCache, targetUrl });
  } catch (err) {
    return { nOpt: null, steps: null, error: err.message };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * Fresh, isolated browser context (own cookie jar + storage). Falls back to the
 * default context for test doubles that do not implement it.
 */
async function createIsolatedContext(browser) {
  if (typeof browser.createBrowserContext === 'function') return browser.createBrowserContext();
  if (typeof browser.createIncognitoBrowserContext === 'function')
    return browser.createIncognitoBrowserContext();
  return { newPage: () => browser.newPage(), close: async () => {} };
}

module.exports = {
  DEFAULTS,
  createIsolatedContext,
  executeStep,
  runSteps,
  runPreconditions,
  replaySightedPath,
  validateTask,
  measureOptimalPath,
};
