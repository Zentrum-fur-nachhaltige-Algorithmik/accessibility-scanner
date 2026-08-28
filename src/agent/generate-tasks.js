#!/usr/bin/env node
/**
 * generate-tasks CLI: the sighted task generator for one site.
 * Writes a `{ url, tasks }` file that `run.js --tasks` consumes unchanged.
 * Needs OPENROUTER_API_KEY.
 */

const puppeteer = require('puppeteer');

const { AgentLLMClient } = require('./llm-chat');
const { generateTasks } = require('./task-generator');
const { saveTasks } = require('./task');
const { DEFAULT_CONCURRENCY, normaliseConcurrency } = require('./concurrency');

const DEFAULT_MODEL = 'google/gemini-3.7-flash';

const USAGE = `Usage: node src/agent/generate-tasks.js <url> [--out tasks.json] [--model ${DEFAULT_MODEL}]
       [--max-tasks 8] [--explore 4] [--concurrency 3] [--vision] [--allow-submit] [--no-generic]
       [--headless true] [--quiet]`;

function parseArgs(argv) {
  const args = {
    url: null,
    out: null,
    model: DEFAULT_MODEL,
    maxTasks: 8,
    explore: 4,
    concurrency: DEFAULT_CONCURRENCY,
    vision: false,
    allowSubmit: false,
    generic: true,
    headless: true,
    quiet: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--max-tasks') args.maxTasks = parseInt(argv[++i], 10) || 8;
    else if (a === '--explore') args.explore = parseInt(argv[++i], 10) || 0;
    else if (a === '--concurrency')
      args.concurrency = normaliseConcurrency(argv[++i], DEFAULT_CONCURRENCY);
    else if (a === '--vision') args.vision = true;
    else if (a === '--allow-submit') args.allowSubmit = true;
    else if (a === '--no-generic') args.generic = false;
    else if (a === '--headless') args.headless = String(argv[++i]) !== 'false';
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  args.url = rest[0] || null;
  return args;
}

function pad(s, n) {
  const v = String(s);
  return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length);
}

/** The result table: one line per generated task, then the dropped ones. */
function printSummary(result) {
  const cols = [
    [30, 'task'],
    [6, 'weight'],
    [10, 'pathLength'],
    [10, 'agentSteps'],
    [16, 'oracle'],
    [12, 'kind'],
    [10, 'answer'],
    [14, 'corroborated'],
    [10, 'status'],
  ];
  console.log('');
  console.log(
    `site type: ${result.siteType || 'unknown'} (page language: ${result.language || 'unknown'})`
  );
  console.log(`explored:  ${(result.explored || []).length} page(s)`);
  if (result.preconditions && result.preconditions.length) {
    console.log(`preconditions: ${result.preconditions.length} step(s) (cookie banner)`);
  }
  console.log('');
  console.log(cols.map(([w, h]) => pad(h, w)).join(' '));
  console.log(cols.map(([w]) => '-'.repeat(w)).join(' '));
  for (const t of result.tasks) {
    const g = t.generator || {};
    console.log(
      [
        pad(t.id, 30),
        pad(t.weight, 6),
        pad(g.pathLength ?? t.sightedPath.length, 10),
        pad(g.sightedAgentSteps ?? '-', 10),
        pad(t.oracle.type, 16),
        pad(t.kind || 'action', 12),
        pad(t.answerType || '-', 10),
        pad(g.corroboration || '-', 14),
        pad(t.ambiguous ? 'ambiguous' : 'ok', 10),
      ].join(' ')
    );
  }
  console.log('');
  // The ground truth an information task is scored against, in full.
  for (const t of result.tasks) {
    if (t.kind === 'information') {
      console.log(
        `  ${t.id}: evidence "${t.evidence}" | answer (${t.answerType || '-'}) "${t.answer || '-'}"`
      );
    }
  }
  console.log(`generated: ${result.tasks.length} task(s)`);
  if (result.dropped && result.dropped.length) {
    console.log(`dropped: ${result.dropped.length}`);
    for (const d of result.dropped) console.log(`  - ${d.id}: ${d.reason}`);
  }
  const u = result.usage || {};
  const cost = u.costKnown
    ? `$${(u.cost || 0).toFixed(4)}`
    : `unknown (partial $${(u.cost || 0).toFixed(4)})`;
  console.log(
    `llm: ${u.calls || 0} calls, ${u.promptTokens || 0} prompt + ${u.completionTokens || 0} completion tokens, cost ${cost}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const llm = new AgentLLMClient({ model: args.model });
  const browser = await puppeteer.launch({
    headless: args.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const result = await generateTasks({
      browser,
      url: args.url,
      llm,
      model: args.model,
      logger: args.quiet ? { info: () => {} } : console,
      options: {
        maxTasks: args.maxTasks,
        explore: args.explore,
        vision: args.vision,
        allowSubmit: args.allowSubmit,
        generic: args.generic,
        concurrency: args.concurrency,
      },
    });
    printSummary(result);

    if (args.out) {
      const written = saveTasks(args.out, result.tasks, args.url);
      console.log(`written: ${written}`);
    }
    if (result.tasks.length === 0) process.exitCode = 3;
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseArgs, printSummary, USAGE, DEFAULT_MODEL };
