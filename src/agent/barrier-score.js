#!/usr/bin/env node
/**
 * Barrier score: compare a blind run with its privileged control run.
 *
 *   n_opt / n_SR = (n_opt / n_priv) * (n_priv / n_SR)
 *
 * The first factor is the agent (how close it gets to the optimum when
 * information is no problem), the second the barrier: same agent, same
 * commands, only the observation differs. B = n_priv / n_SR is the site score.
 *
 *   node src/agent/barrier-score.js blind.json privileged.json [more pairs...]
 *
 * Both files come from run.js over the SAME task file. Per task, n_priv is the
 * mean over the solved privileged runs; a task the privileged agent never
 * solved is agent-limited and left out of B. A blind run that failed counts as
 * B = 0 for that run, as before with n_sighted / n_SR.
 */

const fs = require('fs');
const path = require('path');

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function solvedSteps(taskResult) {
  return (taskResult.runs || []).filter((r) => r.success).map((r) => Number(r.nSr) || 0);
}

/**
 * @returns {{tasks: object[], site: object}}
 */
function barrierScore(blind, privileged) {
  const privByTask = new Map((privileged.tasks || []).map((t) => [t.task.id, t]));
  const tasks = [];
  for (const b of blind.tasks || []) {
    const p = privByTask.get(b.task.id);
    if (!p) continue;
    const privSteps = solvedSteps(p);
    const nPriv = mean(privSteps);
    const blindRuns = (b.runs || []).map((r) => ({
      nSr: Number(r.nSr) || 0,
      success: !!r.success,
      B: nPriv == null ? null : r.success ? Math.min(1, nPriv / r.nSr) : 0,
    }));
    const B = nPriv == null ? null : mean(blindRuns.map((r) => r.B));
    tasks.push({
      id: b.task.id,
      kind: b.task.kind || 'action',
      nSighted: b.nSighted,
      nOpt: b.nOpt,
      nPriv,
      privSolved: `${privSteps.length}/${(p.runs || []).length}`,
      privSteps: (p.runs || []).map((r) => (r.success ? r.nSr : `${r.nSr}x`)),
      nSr: mean(solvedSteps(b)),
      blindSolved: `${solvedSteps(b).length}/${(b.runs || []).length}`,
      blindSteps: (b.runs || []).map((r) => (r.success ? r.nSr : `${r.nSr}x`)),
      // agent quality: how close the informed agent gets to the optimum
      Q: nPriv == null ? null : Math.min(1, b.nOpt / nPriv),
      B,
      agentLimited: nPriv == null,
    });
  }
  const scored = tasks.filter((t) => t.B != null);
  const site = {
    tasks: tasks.length,
    scored: scored.length,
    agentLimited: tasks.filter((t) => t.agentLimited).map((t) => t.id),
    B: mean(scored.map((t) => t.B)),
    Q: mean(scored.map((t) => t.Q)),
    // pooled variant: total informed steps over total blind steps (solved runs only)
    Bpooled: (() => {
      const num = scored.reduce((a, t) => a + t.nPriv * Number(t.blindSolved.split('/')[0]), 0);
      const den = scored.reduce(
        (a, t) => a + t.blindSteps.filter((x) => typeof x === 'number').reduce((s, x) => s + x, 0),
        0
      );
      return den > 0 ? Math.min(1, num / den) : null;
    })(),
    sightedOverBlind: mean(
      tasks.map((t) =>
        mean((t.blindSteps || []).map((x) => (typeof x === 'number' ? t.nSighted / x : 0)))
      )
    ),
  };
  return { tasks, site };
}

function fmt(x, d = 2) {
  return x == null ? '-' : typeof x === 'number' ? x.toFixed(d) : String(x);
}

function pad(s, n) {
  const v = String(s);
  return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length);
}

function printReport(name, { tasks, site }) {
  console.log(`\n${name}`);
  const cols = [
    [34, 'task'],
    [5, 'nS'],
    [5, 'nOpt'],
    [6, 'nPriv'],
    [16, 'priv runs'],
    [6, 'nSR'],
    [16, 'blind runs'],
    [6, 'Q'],
    [6, 'B'],
  ];
  console.log(cols.map(([w, h]) => pad(h, w)).join(' '));
  console.log(cols.map(([w]) => '-'.repeat(w)).join(' '));
  for (const t of tasks) {
    console.log(
      [
        pad(t.id, 34),
        pad(t.nSighted, 5),
        pad(t.nOpt, 5),
        pad(fmt(t.nPriv, 1), 6),
        pad(t.privSteps.join(','), 16),
        pad(fmt(t.nSr, 1), 6),
        pad(t.blindSteps.join(','), 16),
        pad(fmt(t.Q), 6),
        pad(t.agentLimited ? 'agent' : fmt(t.B), 6),
      ].join(' ')
    );
  }
  console.log(
    `B (barrier, mean over tasks) ${fmt(site.B)}   B pooled ${fmt(site.Bpooled)}   ` +
      `Q (agent, nOpt/nPriv) ${fmt(site.Q)}   sighted/blind ${fmt(site.sightedOverBlind)}   ` +
      `scored ${site.scored}/${site.tasks}` +
      (site.agentLimited.length ? `   agent-limited: ${site.agentLimited.join(', ')}` : '')
  );
}

function main(argv) {
  if (argv.length < 2 || argv.length % 2 !== 0) {
    console.log(
      'Usage: node src/agent/barrier-score.js blind.json privileged.json [blind2.json privileged2.json ...]'
    );
    process.exit(1);
  }
  const all = [];
  for (let i = 0; i < argv.length; i += 2) {
    const blind = JSON.parse(fs.readFileSync(path.resolve(argv[i]), 'utf8'));
    const priv = JSON.parse(fs.readFileSync(path.resolve(argv[i + 1]), 'utf8'));
    if (priv.observation !== 'privileged')
      console.warn(`warning: ${argv[i + 1]} is not marked as a privileged run`);
    const r = barrierScore(blind, priv);
    printReport(`${blind.url}  (${path.basename(argv[i])} vs ${path.basename(argv[i + 1])})`, r);
    all.push({ url: blind.url, ...r.site });
  }
  if (all.length > 1) {
    console.log('\nsite                              B      Bpool  Q      sighted/blind');
    for (const s of all)
      console.log(
        `${pad(s.url, 33)} ${pad(fmt(s.B), 6)} ${pad(fmt(s.Bpooled), 6)} ${pad(fmt(s.Q), 6)} ${fmt(s.sightedOverBlind)}`
      );
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { barrierScore };
