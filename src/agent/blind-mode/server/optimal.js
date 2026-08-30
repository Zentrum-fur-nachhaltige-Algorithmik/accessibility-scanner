/**
 * Blind Mode optimal path: the keystrokes and phrases of the shortest route.
 * Expands the cost breakdown from optimal-path.js into a ScreenReaderEnv command
 * list costing nOpt and replays it in a fresh context to collect the phrases.
 */

'use strict';

const ScreenReaderEnv = require('../../screenreader-env');
const { commandCost } = ScreenReaderEnv;
const { computeOptimalPath, reachCommands } = require('../../optimal-path');
const { createIsolatedContext, runPreconditions } = require('../../replay');

/**
 * Expand `computeOptimalPath().steps` into the command list a player would type.
 * The commands add up to `nOpt` when each is charged with `commandCost`
 * (one per command, two for `find`).
 */
function commandsFromOptimalSteps(optSteps, sightedPath) {
  const commands = [];
  for (const entry of optSteps) {
    const step = sightedPath[entry.index] || {};
    const action = entry.action || step.action;

    // One shared expansion for every strategy (rotor, rotor step commands,
    // tab, reading order, and the mixed routes), see `optimal-path.reachCommands`.
    for (const cmd of reachCommands(entry.reach) || []) commands.push(cmd);

    if (action === 'type') commands.push({ type: 'type', arg: step.text });
    else if (action === 'goto' || action === 'read') {
      // `goto` has no equivalent in the screen-reader command space (the player
      // cannot type a URL) and `read` is the cursor arriving on the phrase,
      // which the reach already paid for. No demo task uses `goto`.
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
    const budget = commands.reduce((n, cmd) => n + commandCost(cmd.type), 0) + 5;
    const env = new ScreenReaderEnv(page, { maxSteps: budget });
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
