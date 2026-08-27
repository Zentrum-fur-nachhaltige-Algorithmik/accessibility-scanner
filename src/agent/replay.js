/**
 * src/agent/replay.js — deterministic replay of a task's sighted path.
 *
 * The sighted path is the model-independent baseline for the SR-Agent score:
 * `n_sighted` is simply its number of steps. Replaying it also proves the task
 * is well-formed: the oracle must be FALSE before the path runs and TRUE after.
 *
 * Everything here is deterministic — no LLM, no heuristics beyond waiting.
 */

'use strict';

const { evaluate, createRequestRecorder } = require('./oracle');
const { validateTaskShape } = require('./task');

const DEFAULTS = {
  selectorTimeout: 5000, // how long to wait for a step's selector to appear
  navigationTimeout: 2000, // how long to wait for a navigation a step may trigger
  settleMs: 150, // small settle delay after a non-navigating interaction
  gotoTimeout: 30000,
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
    // Fall back to a non-visible match so we can distinguish "missing" from "hidden".
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

  // Any of the interactions below may or may not navigate. We arm a navigation
  // watcher first and swallow its timeout when nothing navigates.
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

/** Run a list of steps in order. Throws on the first failing step. */
async function runSteps(page, steps, kind, options) {
  for (let i = 0; i < steps.length; i += 1) {
    const label = describeStep(steps[i], i, kind);
    await executeStep(page, steps[i], label, options);
  }
}

/**
 * Run the task's preconditions (e.g. dismiss a cookie banner). They are run
 * before BOTH the sighted replay and the SR agent, so the oracle's "state 0"
 * is the state after preconditions.
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
 * @param {import('puppeteer').Page} page  already navigated, preconditions applied
 * @param {object} task
 * @param {object} [ctx]  oracle context, e.g. `{ recorder }` for `requestSent`
 * @param {object} [options] timeout overrides (see DEFAULTS)
 * @returns {Promise<{ok, nSighted, oracleBefore, oracleAfter, error?}>}
 */
async function replaySightedPath(page, task, ctx = {}, options = {}) {
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
    await runSteps(page, steps, 'sightedPath', options);
  } catch (err) {
    result.error = err.message;
    // Still report the oracle state so callers can see how far we got.
    result.oracleAfter = await evaluate(task.oracle, page, ctx).catch(() => null);
    return result;
  }

  try {
    result.oracleAfter = await evaluate(task.oracle, page, ctx);
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
 * fresh page. A task is valid only if, on EVERY repeat, the oracle is false at
 * state 0 (after preconditions) and true after the replay. An invalid task is
 * excluded from scoring — it says nothing about the accessibility of the page.
 *
 * A valid task additionally gets its `nOpt`: the length of the shortest
 * ScreenReaderEnv command sequence that performs the same path (see
 * `optimal-path.js`). It is measured on ONE extra isolated-context page, so the
 * repeats above stay untouched by it. `nSighted` is kept for validation and the
 * step budget only — it is in clicks, not in screen-reader commands, and never
 * enters the score.
 *
 * @returns {Promise<{ valid, reasons: string[], nSighted, nOpt: number|null,
 *                     optimalPath: object[]|null, optimalPathError?: string }>}
 */
async function validateTask(
  browser,
  url,
  task,
  { repeats = 2, options = {}, computeOptimal = true } = {}
) {
  const reasons = [];
  let normalized;
  try {
    normalized = validateTaskShape(task);
  } catch (err) {
    return { valid: false, reasons: [err.message], nSighted: 0, nOpt: null, optimalPath: null };
  }
  const nSighted = normalized.sightedPath.length;

  for (let attempt = 1; attempt <= repeats; attempt += 1) {
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
        reasons.push(`repeat ${attempt}: precondition failed — ${pre.error}`);
        continue;
      }

      // Recorder starts at state 0 so the initial navigation and the
      // preconditions do not satisfy a `requestSent` oracle by themselves.
      const recorder = createRequestRecorder(page);
      const ctx = { recorder };
      try {
        const res = await replaySightedPath(page, normalized, ctx, options);
        if (res.oracleBefore !== false) {
          reasons.push(
            `repeat ${attempt}: oracle is already true at state 0 (task is trivially solved)`
          );
        }
        if (!res.ok) {
          reasons.push(`repeat ${attempt}: ${res.error || 'oracle false after replay'}`);
        }
      } finally {
        recorder.stop();
      }
    } catch (err) {
      reasons.push(`repeat ${attempt}: ${err.message}`);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  const result = { valid: reasons.length === 0, reasons, nSighted, nOpt: null, optimalPath: null };
  if (!result.valid || !computeOptimal) return result;

  const opt = await measureOptimalPath(browser, url, normalized, options);
  result.nOpt = opt.nOpt;
  result.optimalPath = opt.steps || null;
  if (opt.error) result.optimalPathError = opt.error;
  return result;
}

/**
 * `nOpt` on one extra isolated-context page: navigate, run the preconditions
 * (state 0, exactly what the SR agent sees) and walk the sighted path with the
 * screen-reader cost model.
 */
async function measureOptimalPath(browser, url, task, options = {}) {
  const { computeOptimalPath } = require('./optimal-path');
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULTS.gotoTimeout });
    const pre = await runPreconditions(page, task, options);
    if (!pre.ok) return { nOpt: null, steps: null, error: `precondition failed — ${pre.error}` };
    return await computeOptimalPath(page, task, {}, options);
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
