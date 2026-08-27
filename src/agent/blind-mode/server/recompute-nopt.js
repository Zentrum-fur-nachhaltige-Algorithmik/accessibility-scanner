#!/usr/bin/env node
/**
 * recompute-nopt CLI: refresh the `nOpt` baked into `blind-mode/tasks/*.json`.
 * The stored value is only as current as the cost model in optimal-path.js, so
 * this serves test-sites/agent, runs computeOptimalPath per task and writes back.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const puppeteer = require('puppeteer');

const { computeOptimalPath, reachCommands } = require('../../optimal-path');
const { createIsolatedContext, runPreconditions } = require('../../replay');
const { TASKS_DIR, loadTasks, resolveUrl } = require('./tasks');

const SITE_DIR = path.join(__dirname, '..', '..', '..', '..', 'test-sites', 'agent');

/** The same `/site/*` static mount the game server uses, on an ephemeral port. */
function serveSite() {
  const app = express();
  app.use('/site', express.static(SITE_DIR, { extensions: ['html'] }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** `computeOptimalPath` for one task, plus the command list it expands to. */
async function optimalFor(browser, task, url) {
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pre = await runPreconditions(page, task);
    if (!pre.ok) return { nOpt: null, commands: null, error: `precondition failed: ${pre.error}` };
    const res = await computeOptimalPath(page, task, {}, {});
    if (res.error || res.nOpt == null) {
      return { nOpt: null, commands: null, error: res.error || 'no optimal path' };
    }
    const commands = [];
    for (const entry of res.steps) {
      const step = task.sightedPath[entry.index] || {};
      for (const cmd of reachCommands(entry.reach) || []) commands.push(cmd);
      if (step.action === 'goto') continue;
      commands.push(
        step.action === 'type' ? { type: 'type', arg: step.text } : { type: 'activate' }
      );
    }
    return { nOpt: res.nOpt, commands, steps: res.steps };
  } catch (err) {
    return { nOpt: null, commands: null, error: err.message };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * Usage: recompute-nopt.js [--dry-run] [--skip-remote]. Writes `nOpt` and
 * `optimalPath` (the literal command list) per task; `--skip-remote` leaves
 * tasks with an absolute `url` alone.
 */
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const skipRemote = argv.includes('--skip-remote');

  const tasks = loadTasks();
  const site = await serveSite();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const rows = [];
  try {
    for (const task of tasks) {
      const remote = /^https?:\/\//i.test(task.url);
      if (remote && skipRemote) {
        rows.push({ id: task.id, before: task.nOpt, after: task.nOpt, note: 'skipped (remote)' });
        continue;
      }
      const url = resolveUrl(task, site.origin);
      const res = await optimalFor(browser, task, url);
      const file = path.join(TASKS_DIR, `${task.id}.json`);
      if (res.nOpt == null) {
        rows.push({ id: task.id, before: task.nOpt, after: null, note: res.error });
        continue;
      }
      rows.push({
        id: task.id,
        before: task.nOpt,
        after: res.nOpt,
        note: res.commands.map((c) => c.type).join(' '),
      });
      if (!dryRun && fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        raw.nOpt = res.nOpt;
        raw.optimalPath = res.commands;
        fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await site.close();
  }

  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${pad('task', 20)} ${pad('nOpt was', 9)} ${pad('nOpt now', 9)} route`);
  console.log(`${'-'.repeat(20)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(40)}`);
  for (const r of rows) {
    console.log(
      `${pad(r.id, 20)} ${pad(r.before == null ? '-' : r.before, 9)} ${pad(
        r.after == null ? 'FAILED' : r.after,
        9
      )} ${r.note || ''}`
    );
  }
  if (dryRun) console.log('\n--dry-run: nothing written');
  if (rows.some((r) => r.after == null)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { optimalFor, serveSite };
