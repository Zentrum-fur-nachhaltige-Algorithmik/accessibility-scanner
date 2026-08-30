#!/usr/bin/env node
/**
 * validate-nopt CLI: the regression run for `nOpt`.
 * Re-measures every task of the recorded reference runs with today's
 * optimal-path.js and prints the recorded nOpt beside the new one, plus the
 * route that explains a difference (a waypoint skipped, the evidence heard on an
 * earlier page). Nothing is written back: the reviewer decides what to re-record.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { reachCommands } = require('./optimal-path');
const { measureOptimalPath } = require('./replay');

const REFERENCE_DIR = path.join(__dirname, '..', '..', 'tests', 'data', 'sr-agent', 'reference');

const USAGE = `Usage: node src/agent/validate-nopt.js [reference.json ...]
       [--dir ${path.relative(process.cwd(), REFERENCE_DIR)}] [--url http://127.0.0.1:8804/]
       [--only id,id] [--remote] [--headless false] [--out report.json]

Without files every *.json of the reference directory that carries recorded
nOpt values is measured again. Tasks on a remote origin are skipped unless
--remote is given (they fetch the live site); --url replaces the recorded
origin, which is how a locally served copy of a recorded site is measured.

Exit code 0 = every task was measured, 2 = at least one measurement failed,
1 = usage / IO error.`;

function parseArgs(argv) {
  const args = {
    dir: REFERENCE_DIR,
    files: [],
    url: null,
    only: null,
    remote: false,
    headless: true,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--remote') args.remote = true;
    else if (a === '--headless') args.headless = String(argv[++i]) !== 'false';
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--only')
      args.only = argv[++i]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    else if (a === '--help' || a === '-h') args.help = true;
    else args.files.push(a);
  }
  return args;
}

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(String(url || ''));

/** Move a recorded url onto another origin, keeping path and query. */
function rebase(url, origin) {
  if (!origin) return url;
  try {
    const from = new URL(url);
    const to = new URL(origin);
    return `${to.origin}${from.pathname}${from.search}`;
  } catch (_) {
    return url;
  }
}

/**
 * The measurable tasks of one recorded run: the task as it was validated, the
 * url it ran against and the nOpt that was recorded for it.
 */
function tasksOf(doc, file) {
  const out = [];
  for (const entry of (doc && doc.tasks) || []) {
    const task = entry.task || entry;
    if (!task || !task.id) continue;
    if (!Number.isFinite(entry.nOpt)) continue;
    out.push({
      file: path.basename(file),
      id: task.id,
      task,
      before: entry.nOpt,
      readDistance: Number.isFinite(entry.readDistance) ? entry.readDistance : null,
      route: entry.optimalRoute || null,
      url: (task.meta && task.meta.url) || doc.url,
    });
  }
  return out;
}

/** Every reference file that carries recorded nOpt values. */
function referenceFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f))
    .filter((f) => {
      try {
        return tasksOf(JSON.parse(fs.readFileSync(f, 'utf8')), f).length > 0;
      } catch (_) {
        return false;
      }
    })
    .sort();
}

/** What the new route did, in one line. */
function describeRoute(res) {
  if (!res || res.nOpt == null) return res && res.error ? res.error : 'no optimal path';
  const parts = [];
  if (res.skipped && res.skipped.length) parts.push(`skipped waypoint ${res.skipped.join(',')}`);
  if (res.heardOnPage !== undefined) parts.push(`heard on page ${res.heardOnPage}`);
  const commands = [];
  for (const step of res.steps || []) {
    for (const cmd of reachCommands(step.reach) || []) commands.push(cmd.type);
    if (step.action === 'read' || step.action === 'goto') continue;
    commands.push(step.action === 'type' ? 'type' : 'activate');
  }
  parts.push(commands.join(' '));
  return parts.join(' | ');
}

/**
 * Re-measure every task, old value beside new. `measure` is injectable so the
 * table and the verdicts can be tested without a browser.
 */
async function validateNopt({ browser, tasks, options = {}, logger = console, measure = null }) {
  const run =
    measure ||
    ((task, url) => measureOptimalPath(browser, url, task.task, options, options.analysisCache));
  const rows = [];
  for (const task of tasks) {
    const startedAt = Date.now();
    let res;
    try {
      res = await run(task, task.url);
    } catch (err) {
      res = { nOpt: null, error: err.message };
    }
    const after = res && Number.isFinite(res.nOpt) ? res.nOpt : null;
    rows.push({
      file: task.file,
      id: task.id,
      before: task.before,
      after,
      delta: after === null ? null : after - task.before,
      route: (res && res.route) || null,
      skipped: (res && res.skipped) || null,
      readDistance: res && Number.isFinite(res.readDistance) ? res.readDistance : null,
      note: describeRoute(res),
      error: (res && res.error) || null,
      ms: Date.now() - startedAt,
    });
    if (logger) {
      const last = rows[rows.length - 1];
      logger.log(`[validate-nopt] ${task.id}: was ${last.before} · now ${last.after}`);
    }
  }
  return rows;
}

const pad = (s, n) => {
  const v = String(s);
  return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length);
};

function printTable(rows, logger = console) {
  const cols = [
    [30, 'task'],
    [26, 'reference'],
    [7, 'was'],
    [7, 'now'],
    [7, 'delta'],
    [7, 'route'],
  ];
  logger.log('');
  logger.log(cols.map(([w, h]) => pad(h, w)).join(' '));
  logger.log(cols.map(([w]) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    logger.log(
      [
        pad(r.id, 30),
        pad(r.file.replace(/\.json$/, ''), 26),
        pad(r.before, 7),
        pad(r.after === null ? 'FAILED' : r.after, 7),
        pad(r.delta === null ? '-' : r.delta > 0 ? `+${r.delta}` : r.delta, 7),
        pad(r.route || '-', 7),
      ].join(' ')
    );
  }
  const changed = rows.filter((r) => r.delta !== null && r.delta !== 0);
  const failed = rows.filter((r) => r.after === null);
  logger.log('');
  logger.log(
    `${rows.length} task(s): ${rows.length - failed.length} measured, ` +
      `${changed.length} changed, ${failed.length} failed.`
  );
  for (const r of changed) logger.log(`  ${r.id}: ${r.before} -> ${r.after} via ${r.note}`);
  for (const r of failed) logger.log(`  FAILED ${r.id}: ${r.error}`);
  return failed.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const files = args.files.length
    ? args.files.map((f) => path.resolve(f))
    : referenceFiles(args.dir);
  let tasks = [];
  for (const file of files) {
    tasks = tasks.concat(tasksOf(JSON.parse(fs.readFileSync(file, 'utf8')), file));
  }
  if (args.only) tasks = tasks.filter((t) => args.only.includes(t.id));
  tasks = tasks.map((t) => ({ ...t, url: rebase(t.url, args.url) }));
  const skipped = args.remote ? [] : tasks.filter((t) => !isLocal(t.url));
  if (!args.remote) tasks = tasks.filter((t) => isLocal(t.url));
  if (!tasks.length) {
    console.error('No tasks to measure.');
    console.log(USAGE);
    process.exit(1);
  }

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: args.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  let rows;
  try {
    // One description cache per run: the reference runs revisit the same pages.
    rows = await validateNopt({ browser, tasks, options: { analysisCache: new Map() } });
  } finally {
    await browser.close().catch(() => {});
  }

  const failed = printTable(rows);
  for (const t of skipped) console.log(`  skipped (remote, use --remote): ${t.id} ${t.url}`);
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify({ rows }, null, 2));
    console.log(`written: ${args.out}`);
  }
  process.exit(failed ? 2 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  referenceFiles,
  tasksOf,
  rebase,
  describeRoute,
  validateNopt,
  printTable,
  REFERENCE_DIR,
  USAGE,
};
