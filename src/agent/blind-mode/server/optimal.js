/**
 * blind-mode/server/optimal.js — the "So wäre es gegangen" path.
 *
 * `optimal-path.js` gives the CHEAPEST screen-reader route through a task and
 * its length `nOpt`, but only as a cost breakdown ("rotor+next, k = 2"). The
 * result screen has to show the player the actual keystrokes AND what the
 * screen reader would have said at each of them, so this module
 *   1. expands the cost breakdown into a concrete ScreenReaderEnv command list
 *      whose length is exactly `nOpt`, and
 *   2. replays that list in a fresh isolated context to collect the phrases.
 *
 * Both are done once per task and cached; the replay needs a browser context and
 * takes a few seconds, so it runs in the background from server start.
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
    // tab, reading order) — see `optimal-path.reachCommands`.
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
 * Compute `nOpt` and the spoken optimal path for one task.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {object} task    task with an ABSOLUTE `url`
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
      if (!pre.ok) return { nOpt: null, path: [], error: `precondition failed — ${pre.error}` };
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
      return { nOpt: computed.nOpt, path: [], error: `precondition failed — ${pre.error}` };
    const env = new ScreenReaderEnv(page, { maxSteps: commands.length + 5 });
    await env.start();
    for (const cmd of commands) {
      const obs = await env.step(cmd);
      // A rotor LIST command does not move the cursor, so its phrase would just
      // repeat the previous one. Say what actually happens instead.
      const phrase = obs.rotor
        ? `${obs.rotor.items.length} Einträge in der Liste`
        : obs.phrase || '';
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
