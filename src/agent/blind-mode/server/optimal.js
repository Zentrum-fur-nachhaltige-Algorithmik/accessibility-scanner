/**
 * Blind Mode optimal path: the keystrokes and phrases of the shortest route.
 * Expands the cost breakdown from optimal-path.js into a ScreenReaderEnv command
 * list of length nOpt and replays it in a fresh context to collect the phrases.
 */

'use strict';

const ScreenReaderEnv = require('../../screenreader-env');
const { computeOptimalPath, reachCommands } = require('../../optimal-path');
const { createIsolatedContext, runPreconditions } = require('../../replay');

/**
 * Expand `computeOptimalPath().steps` into the command list a player would type.
 * `commands.length === nOpt` by construction: each reach strategy emits exactly
 * `reach.cost` commands and each action exactly `actionCost` (= 1).
 */
function commandsFromOptimalSteps(optSteps, sightedPath) {
  const commands = [];
  for (const entry of optSteps) {
    const step = sightedPath[entry.index] || {};
    const reach = entry.reach || { strategy: 'none', cost: 0 };

    // One shared expansion for every strategy (rotor, rotor step commands,
    // tab, reading order), see `optimal-path.reachCommands`.
    for (const cmd of reachCommands(reach) || []) commands.push(cmd);

    if (step.action === 'type') commands.push({ type: 'type', arg: step.text });
    else if (step.action === 'goto') {
      // `goto` has no equivalent in the screen-reader command space (the player
      // cannot type a URL). No demo task uses it; skipping keeps the list honest.
      continue;
    } else commands.push({ type: 'activate' });
  }
  return commands;
}

/**
 * Compute `nOpt` and the spoken optimal path for one task. Cached per task by
 * `createOptimalCache`; the replay takes a few seconds, so the server warms it at start.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {object} task task with an absolute `url`
 * @returns {Promise<{ nOpt: number|null, path: Array<{cmd: object, phrase: string}>, error?: string }>}
 */
async function computeSpokenOptimalPath(browser, task) {
  let computed;
  {
    const context = await createIsolatedContext(browser);
    const page = await context.newPage();
    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const pre = await runPreconditions(page, task);
      if (!pre.ok) return { nOpt: null, path: [], error: `precondition failed: ${pre.error}` };
      computed = await computeOptimalPath(page, task, {}, {});
    } catch (err) {
      return { nOpt: null, path: [], error: err.message };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }
  if (computed.error || computed.nOpt == null) {
    return { nOpt: null, path: [], error: computed.error || 'no optimal path' };
  }

  const commands = commandsFromOptimalSteps(computed.steps, task.sightedPath);

  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  const path = [];
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pre = await runPreconditions(page, task);
    if (!pre.ok)
      return { nOpt: computed.nOpt, path: [], error: `precondition failed: ${pre.error}` };
    const env = new ScreenReaderEnv(page, { maxSteps: commands.length + 5 });
    await env.start();
    for (const cmd of commands) {
      const obs = await env.step(cmd);
      // A rotor list command does not move the cursor, so its phrase would just
      // repeat the previous one. Say what actually happens instead.
      const phrase = obs.rotor ? `${obs.rotor.items.length} entries in the list` : obs.phrase || '';
      path.push({ cmd, phrase });
    }
    await env.stop().catch(() => {});
  } catch (err) {
    return { nOpt: computed.nOpt, path, error: err.message };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  return { nOpt: computed.nOpt, path };
}

/**
 * Per-task cache in front of `computeSpokenOptimalPath`. One in-flight promise
 * per task id, so a background precompute and a session asking for the same
 * task share the work instead of racing.
 */
function createOptimalCache(getBrowser) {
  const cache = new Map();
  return {
    get(task) {
      if (!cache.has(task.id)) {
        cache.set(
          task.id,
          (async () => {
            const browser = await getBrowser();
            return computeSpokenOptimalPath(browser, task);
          })().catch((err) => ({ nOpt: null, path: [], error: err.message }))
        );
      }
      return cache.get(task.id);
    },
    size: () => cache.size,
  };
}

module.exports = { commandsFromOptimalSteps, computeSpokenOptimalPath, createOptimalCache };
