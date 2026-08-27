#!/usr/bin/env node
/**
 * src/agent/run.js — CLI for the SR-agent measurement.
 *
 *   node src/agent/run.js <url> [--tasks tasks.json] [--generate] [--k 1]
 *                              [--model google/gemini-3.7-flash]
 *                              [--out result.json] [--headless true]
 *
 * Task source, in order of precedence:
 *   --tasks FILE  a generated / hand-written task file
 *   --generate    run the Stage 3 sighted generator first (src/agent/task-generator.js)
 *                 and save the tasks next to --out as `<out>.tasks.json`
 *   (neither)     the generic site-agnostic templates instantiated on first load
 *
 * Needs OPENROUTER_API_KEY.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const { AgentLLMClient: LLMClient } = require('./llm-chat');
const { runSite } = require('./harness');

const DEFAULT_MODEL = 'google/gemini-3.7-flash';

function parseArgs(argv) {
  const args = {
    k: 1,
    model: DEFAULT_MODEL,
    headless: true,
    out: null,
    tasks: null,
    url: null,
    generate: false,
    vision: false,
    allowSubmit: false,
    maxTasks: 8,
    explore: 4,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tasks') args.tasks = argv[++i];
    else if (a === '--k') args.k = parseInt(argv[++i], 10) || 1;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--headless') args.headless = String(argv[++i]) !== 'false';
    else if (a === '--generate') args.generate = true;
    else if (a === '--vision') args.vision = true;
    else if (a === '--allow-submit') args.allowSubmit = true;
    else if (a === '--max-tasks') args.maxTasks = parseInt(argv[++i], 10) || 8;
    else if (a === '--explore') args.explore = parseInt(argv[++i], 10) || 0;
    else if (a === '--only')
      args.only = argv[++i]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    else if (a === '--exclude')
      args.exclude = argv[++i]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  args.url = rest[0] || null;
  return args;
}

const USAGE = `Usage: node src/agent/run.js <url> [--tasks tasks.json] [--generate] [--k 1] [--model ${DEFAULT_MODEL}]
       [--out result.json] [--headless true] [--only id,id] [--exclude id,id]
       generator options (with --generate): [--max-tasks 8] [--explore 4] [--vision] [--allow-submit]`;

function pad(s, n) {
  const v = String(s);
  return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length);
}

function printSummary(result) {
  const cols = [
    [38, 'task'],
    [8, 'nSighted'],
    [6, 'nOpt'],
    [6, 'nSr'],
    [6, 'R'],
    [10, 'stoppedBy'],
  ];
  console.log('');
  console.log(cols.map(([w, h]) => pad(h, w)).join(' '));
  console.log(cols.map(([w]) => '-'.repeat(w)).join(' '));
  for (const t of result.tasks) {
    for (const run of t.runs) {
      console.log(
        [
          pad(t.task.id || t.task.description, 38),
          pad(t.nSighted, 8),
          pad(t.nOpt == null ? '-' : t.nOpt, 6),
          pad(run.nSr, 6),
          pad(run.R.toFixed(2), 6),
          pad(run.stoppedBy || '-', 10),
        ].join(' ')
      );
    }
  }
  console.log('');
  console.log(
    `siteScore: ${result.siteScore == null ? 'n/a (no valid tasks)' : result.siteScore.toFixed(3)}`
  );
  if (result.invalidTasks.length) {
    console.log(`invalid tasks (${result.invalidTasks.length}):`);
    for (const it of result.invalidTasks) console.log(`  - ${it.id}: ${it.reason}`);
  }
  const findings = result.tasks.flatMap((t) => t.findings || []);
  console.log(`findings: ${findings.length}`);
  if (result.usage) {
    const u = result.usage;
    const cost = u.costKnown ? `$${u.cost.toFixed(4)}` : `unknown (partial: $${u.cost.toFixed(4)})`;
    console.log(
      `llm: ${u.calls} calls, ${u.promptTokens} prompt + ${u.completionTokens} completion tokens, cost ${cost}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const llm = new LLMClient({ model: args.model });

  const browser = await puppeteer.launch({
    headless: args.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    let tasks;
    let generated = null;
    if (args.tasks) {
      tasks = JSON.parse(fs.readFileSync(path.resolve(args.tasks), 'utf8'));
      if (!Array.isArray(tasks)) tasks = tasks.tasks;
    } else if (args.generate) {
      // Stage 3: derive site-specific tasks first, then measure with them.
      const { generateTasks } = require('./task-generator');
      const { saveTasks } = require('./task');
      const { printSummary: printGenSummary } = require('./generate-tasks');
      generated = await generateTasks({
        browser,
        url: args.url,
        llm,
        model: args.model,
        options: {
          maxTasks: args.maxTasks,
          explore: args.explore,
          vision: args.vision,
          allowSubmit: args.allowSubmit,
        },
      });
      printGenSummary(generated);
      tasks = generated.tasks;
      const tasksOut = `${args.out || path.join(process.cwd(), 'sr-agent-result.json')}.tasks.json`;
      console.log(`written: ${saveTasks(tasksOut, tasks, args.url)}`);
    } else {
      const page = await browser.newPage();
      try {
        await page.goto(args.url, { waitUntil: 'domcontentloaded' });
        const { instantiateGenericTasks } = require('./generic-tasks');
        tasks = await instantiateGenericTasks(page, { only: args.only || null });
        if (args.exclude) tasks = tasks.filter((t) => !args.exclude.some((x) => t.id.includes(x)));
      } finally {
        await page.close().catch(() => {});
      }
    }

    if (!tasks || tasks.length === 0) {
      console.error('No tasks to run (pass --tasks or use a page the generic templates apply to).');
      process.exit(2);
    }

    const result = await runSite({
      browser,
      url: args.url,
      tasks,
      llm,
      k: args.k,
      model: args.model,
    });
    if (generated)
      result.generator = {
        siteType: generated.siteType,
        dropped: generated.dropped,
        usage: generated.usage,
      };
    printSummary(result);

    if (args.out) {
      fs.writeFileSync(path.resolve(args.out), JSON.stringify(result, null, 2));
      console.log(`written: ${args.out}`);
    }
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

module.exports = { parseArgs, printSummary };
