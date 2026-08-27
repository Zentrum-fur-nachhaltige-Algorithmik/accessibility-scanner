#!/usr/bin/env node
/**
 * src/agent/validate-nopt.js — does the guided optimum still price the page
 * correctly?
 *
 *   node src/agent/validate-nopt.js <url> --tasks tasks.json [--max-pages 1]
 *                                   [--only id,id] [--headless true]
 *                                   [--max-edges 60] [--timeout 60000] [--out file.json]
 *
 * `optimal-path.js` computes `nOpt` GUIDED by the sighted path: it prices the
 * cheapest screen-reader route to the elements the sighted user touched, in that
 * order. `bfs-optimum.js` searches the command space itself. If the search finds
 * a conclusively cheaper route than the guided model, the model has a GAP — a
 * kind of route it structurally cannot see (that is how effect-equivalent
 * targets and rotor stepping were found in the first place) — and every score
 * `R = min(1, nOpt / nSr)` computed against it is inflated.
 *
 * So: run both per task, print them side by side, and exit non-zero if any
 * CONCLUSIVE `nOptBfs` is smaller than `nOptGuided`. Inconclusive rows (the
 * search hit a budget) are reported but never fail the run — they prove nothing
 * either way.
 *
 * The BFS defaults are the within-page validator (`maxPages: 1`, see
 * `docs/sprints/sr-agent/bfs-optimum.md`): every edge on the start page,
 * navigations included, is executed and goal-tested, but other pages are not
 * expanded. That is the scope the guided optimum claims to be optimal in.
 * `--max-pages 40` widens it to the old cross-site search (only affordable on
 * small fixtures).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const { compareOptima, DEFAULTS: BFS_DEFAULTS } = require('./bfs-optimum');

function parseArgs(argv) {
  const args = {
    url: null,
    tasks: null,
    maxPages: BFS_DEFAULTS.maxPages,
    maxEdges: BFS_DEFAULTS.maxEdges,
    timeoutMs: BFS_DEFAULTS.timeoutMs,
    maxDepth: BFS_DEFAULTS.maxDepth,
    headless: true,
    allowSubmit: false,
    only: null,
    out: null,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tasks') args.tasks = argv[++i];
    else if (a === '--max-pages') args.maxPages = parseInt(argv[++i], 10);
    else if (a === '--max-edges') args.maxEdges = parseInt(argv[++i], 10);
    else if (a === '--max-depth') args.maxDepth = parseInt(argv[++i], 10);
    else if (a === '--timeout') args.timeoutMs = parseInt(argv[++i], 10);
    else if (a === '--headless') args.headless = String(argv[++i]) !== 'false';
    else if (a === '--allow-submit') args.allowSubmit = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--only')
      args.only = argv[++i]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  args.url = rest[0] || null;
  return args;
}

const USAGE = `Usage: node src/agent/validate-nopt.js <url> --tasks tasks.json [--max-pages 1]
       [--max-edges ${BFS_DEFAULTS.maxEdges}] [--max-depth ${BFS_DEFAULTS.maxDepth}] [--timeout ${BFS_DEFAULTS.timeoutMs}]
       [--only id,id] [--allow-submit] [--headless true] [--out report.json]

Exit code 0 = no gap found (or nothing conclusive), 2 = the BFS beat the guided
optimum on at least one task, 1 = usage / IO error.`;

const pad = (s, n) => {
  const v = String(s);
  return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length);
};

/**
 * One `compareOptima` per task, plus the verdict per row.
 * `compare` is injectable so the verdict logic can be tested without a browser.
 */
async function validateNopt({
  browser,
  url,
  tasks,
  options,
  logger = console,
  compare = compareOptima,
}) {
  const rows = [];
  for (const task of tasks) {
    const cmp = await compare(browser, url, task, options);
    const conclusive = typeof cmp.nOptBfs === 'number' && typeof cmp.nOptGuided === 'number';
    rows.push({
      id: task.id || task.description,
      nOptGuided: cmp.nOptGuided,
      nOptBfs: cmp.nOptBfs,
      delta: cmp.delta,
      gap: conclusive && cmp.nOptBfs < cmp.nOptGuided,
      conclusive,
      reason: (cmp.explored && cmp.explored.reason) || (cmp.error ? 'error' : null),
      edges: cmp.explored && cmp.explored.edges,
      states: cmp.explored && cmp.explored.states,
      bestFound: cmp.bestFound ? cmp.bestFound.cost : null,
      bfsPath: cmp.bfsPath ? cmp.bfsPath.map((c) => c.type).join(' ') : null,
      ms: cmp.ms,
      error: cmp.error || null,
    });
    if (logger)
      logger.log(`[validate-nopt] ${task.id}: guided ${cmp.nOptGuided} · bfs ${cmp.nOptBfs}`);
  }
  return rows;
}

function printTable(rows, logger = console) {
  const cols = [
    [34, 'task'],
    [8, 'guided'],
    [8, 'bfs'],
    [7, 'delta'],
    [20, 'outcome'],
    [7, 'edges'],
    [8, 'time(s)'],
  ];
  logger.log('');
  logger.log(cols.map(([w, h]) => pad(h, w)).join(' '));
  logger.log(cols.map(([w]) => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    logger.log(
      [
        pad(r.id, 34),
        pad(r.nOptGuided == null ? '-' : r.nOptGuided, 8),
        pad(r.nOptBfs == null ? `null(${r.bestFound == null ? '-' : r.bestFound})` : r.nOptBfs, 8),
        pad(r.delta == null ? '-' : r.delta, 7),
        pad(r.gap ? `GAP (${r.reason})` : r.reason || '-', 20),
        pad(r.edges == null ? '-' : r.edges, 7),
        pad(r.ms == null ? '-' : (r.ms / 1000).toFixed(1), 8),
      ].join(' ')
    );
  }
  const gaps = rows.filter((r) => r.gap);
  const inconclusive = rows.filter((r) => !r.conclusive);
  logger.log('');
  logger.log(
    `${rows.length} task(s): ${rows.length - inconclusive.length} conclusive, ` +
      `${inconclusive.length} inconclusive, ${gaps.length} gap(s).`
  );
  for (const g of gaps) {
    logger.log(`  GAP ${g.id}: bfs ${g.nOptBfs} < guided ${g.nOptGuided} via "${g.bfsPath}"`);
  }
  return gaps.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url || !args.tasks) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  let tasks = JSON.parse(fs.readFileSync(path.resolve(args.tasks), 'utf8'));
  if (!Array.isArray(tasks)) tasks = tasks.tasks;
  if (args.only) tasks = tasks.filter((t) => args.only.includes(t.id));
  if (!tasks || !tasks.length) {
    console.error('No tasks to validate.');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: args.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  let rows;
  try {
    rows = await validateNopt({
      browser,
      url: args.url,
      tasks,
      options: {
        maxPages: args.maxPages,
        maxEdges: args.maxEdges,
        maxDepth: args.maxDepth,
        timeoutMs: args.timeoutMs,
        allowSubmit: args.allowSubmit,
      },
    });
  } finally {
    await browser.close().catch(() => {});
  }

  const gaps = printTable(rows);
  if (args.out) {
    fs.writeFileSync(
      path.resolve(args.out),
      JSON.stringify({ url: args.url, tasks: args.tasks, rows }, null, 2)
    );
    console.log(`written: ${args.out}`);
  }
  process.exit(gaps ? 2 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseArgs, validateNopt, printTable, USAGE };
