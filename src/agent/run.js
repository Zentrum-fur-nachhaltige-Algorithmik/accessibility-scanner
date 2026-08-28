#!/usr/bin/env node
/**
 * run CLI: the SR-agent measurement for one site. Needs OPENROUTER_API_KEY,
 * except for `--agent greedy --tasks FILE`, which runs the deterministic stage-2
 * agent and calls no model at all.
 * Task source by precedence: `--tasks FILE`, `--generate` (sighted task
 * generator, saved as `<out>.tasks.json`), otherwise the generic templates.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const { AgentLLMClient: LLMClient } = require('./llm-chat');
const { runSite } = require('./harness');
const { DEFAULT_CONCURRENCY, normaliseConcurrency } = require('./concurrency');

const DEFAULT_MODEL = 'google/gemini-3.7-flash';

function parseArgs(argv) {
  const args = {
    k: 1,
    model: DEFAULT_MODEL,
    headless: true,
    out: null,
    tasks: null,
    url: null,
    // Which rung of the metric ladder runs: 'llm' = stage 3 (sr-agent.js),
    // 'greedy' = stage 2 (greedy-agent.js, word matching only).
    agent: 'llm',
    generate: false,
    vision: false,
    allowSubmit: false,
    maxTasks: 8,
    explore: 4,
    concurrency: DEFAULT_CONCURRENCY,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tasks') args.tasks = argv[++i];
    else if (a === '--k') args.k = parseInt(argv[++i], 10) || 1;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--agent') args.agent = String(argv[++i] || '').trim();
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--headless') args.headless = String(argv[++i]) !== 'false';
    else if (a === '--generate') args.generate = true;
    else if (a === '--vision') args.vision = true;
    else if (a === '--allow-submit') args.allowSubmit = true;
    else if (a === '--max-tasks') args.maxTasks = parseInt(argv[++i], 10) || 8;
    else if (a === '--explore') args.explore = parseInt(argv[++i], 10) || 0;
    else if (a === '--concurrency')
      args.concurrency = normaliseConcurrency(argv[++i], DEFAULT_CONCURRENCY);
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
       [--agent llm|greedy] [--out result.json] [--headless true] [--only id,id] [--exclude id,id] [--concurrency 3]
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
    // Of nOpt, the part spent reaching the phrase that speaks the answer
    // (information tasks only; blank for action tasks).
    [6, 'read'],
    [6, 'nSr'],
    [6, 'R'],
    // How success was established: oracle | evidence | answer-normalised | answer-llm
    [18, 'by'],
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
          pad(t.nOpt == null ? '-' : `${t.nOpt}${t.nOptPartial ? '*' : ''}`, 6),
          pad(t.readDistance == null ? '' : t.readDistance, 6),
          pad(run.nSr, 6),
          pad(run.R.toFixed(2), 6),
          pad(run.successBy || '-', 18),
          pad(run.stoppedBy || '-', 10),
        ].join(' ')
      );
    }
  }
  console.log('');
  if (result.tasks.some((t) => t.nOptPartial)) {
    console.log('* nOpt covers navigation only: the evidence is never spoken (see findings).');
  }
  console.log(
    `siteScore: ${result.siteScore == null ? 'n/a (no valid tasks)' : result.siteScore.toFixed(3)}`
  );
  if (result.invalidTasks.length) {
    console.log(`invalid tasks (${result.invalidTasks.length}):`);
    for (const it of result.invalidTasks) console.log(`  - ${it.id}: ${it.reason}`);
  }
  const findings = result.tasks.flatMap((t) => t.findings || []);
  console.log(`findings: ${findings.length}`);
  // Env findings carry `type`, harness findings carry `ruleId`; both are set on
  // every finding now, so one of them always names the barrier.
  const byType = new Map();
  for (const f of findings) {
    const key = f.type || f.ruleId || 'unknown';
    byType.set(key, (byType.get(key) || 0) + 1);
  }
  for (const [type, count] of Array.from(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type}: ${count}`);
  }
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

  if (args.agent !== 'llm' && args.agent !== 'greedy') {
    console.error(`Unknown --agent "${args.agent}"; use "llm" or "greedy".`);
    process.exit(1);
  }

  // The greedy agent calls no model. The task generator and the answer judge
  // still do, so a client is built when one can be: without a key the greedy run
  // simply loses the judge fallback.
  let llm = null;
  if (args.agent === 'greedy' && !args.generate) {
    try {
      llm = new LLMClient({ model: args.model });
    } catch (err) {
      console.log(`no LLM client (${err.message}); running greedy without the answer judge`);
    }
  } else {
    llm = new LLMClient({ model: args.model });
  }

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
      // Derive site-specific tasks first, then measure with them.
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
          concurrency: args.concurrency,
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
      agent: args.agent,
      concurrency: args.concurrency,
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
