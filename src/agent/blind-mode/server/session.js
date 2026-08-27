/**
 * Blind Mode session: one game in one isolated browser context.
 * Keys become ScreenReaderEnv commands; only the spoken output goes back to the
 * client. The oracle runs server-side after every counted command.
 */

'use strict';

const crypto = require('crypto');
const ScreenReaderEnv = require('../../screenreader-env');
const { evaluate, createRequestRecorder } = require('../../oracle');
const { createIsolatedContext, runPreconditions } = require('../../replay');
const { resolveUrl, publicTask } = require('./tasks');
const { appendSession } = require('./store');

/** Budget: three times the optimal route plus ten commands of slack. */
const budgetFor = (nOpt) => 3 * nOpt + 10;

/**
 * Minimum run of commands without progress that counts as "stuck". The effective
 * threshold is `max(STUCK_MIN_RUN, nOpt)`, so a near-optimal winning session
 * does not get a stuck window.
 */
const STUCK_MIN_RUN = 3;

/**
 * The longest window in which nothing moved forward: no navigation, no dialog
 * opening or closing, no activation. Approximates "no progress towards the goal"
 * without knowing the goal.
 */
function computeStuck(trace, minRun = STUCK_MIN_RUN) {
  const counted = trace.filter((e) => !e.free);
  const dialogsOf = (side) =>
    ((side && side.dialogs) || []).map((d) => `${d.selector}:${d.modal}`).join('|');
  const progressed = (e) =>
    e.obsAfter.urlChanged ||
    e.cmd.type === 'activate' ||
    dialogsOf(e.meta && e.meta.before) !== dialogsOf(e.meta && e.meta.after);

  let best = null;
  let start = 0;
  for (let i = 0; i <= counted.length; i += 1) {
    if (i === counted.length || progressed(counted[i])) {
      const len = i - start;
      if (len > 0 && (!best || len > best.len)) best = { len, from: start, to: i - 1 };
      start = i + 1;
    }
  }
  if (!best || best.len < Math.max(STUCK_MIN_RUN, minRun)) return null;
  const window = counted.slice(best.from, best.to + 1);
  return {
    fromStep: window[0].step,
    toStep: window[window.length - 1].step,
    phrases: window.map((e) => e.obsAfter.phrase || ''),
  };
}

/** The verdict sentence shown on the result screen. */
function verdictFor({ success, R, nHuman, nOpt }) {
  if (!success) return 'A blind user would have got stuck here too.';
  if (R >= 0.7) return 'Almost optimal: this page is easy to hear.';
  return `You needed ${nHuman} steps, ${nOpt} would have been enough. The page is the problem, not you.`;
}

class Session {
  /**
   * @param {object} deps
   * @param {(msg: object) => void} deps.send send one JSON message to the client
   * @param {() => Promise<import('puppeteer').Browser>} deps.getBrowser
   * @param {object} deps.optimalCache see optimal.js
   * @param {string} deps.origin this server's own origin
   */
  constructor({ send, getBrowser, optimalCache, origin }) {
    this.send = send;
    this.getBrowser = getBrowser;
    this.optimalCache = optimalCache;
    this.origin = origin;

    this.id = crypto.randomUUID();
    this.task = null;
    this.mode = 'experience';
    this.env = null;
    this.page = null;
    this.context = null;
    this.recorder = null;
    this.finished = false;
    this.startedAt = null;
    this.commands = [];
    this.queue = Promise.resolve();
  }

  /** Serialise everything that touches the page through one promise chain. */
  enqueue(fn) {
    this.queue = this.queue.then(fn).catch((err) => this.fail(err));
    return this.queue;
  }

  fail(err) {
    if (this.finished) return;
    this.send({ type: 'error', message: (err && err.message) || String(err) });
  }

  async start({ task, mode }) {
    this.task = task;
    this.mode = mode === 'training' ? 'training' : 'experience';
    this.url = resolveUrl(task, this.origin);

    // nOpt from the task file, otherwise computed (the cache also produces the
    // spoken optimal path the result screen needs).
    let nOpt = task.nOpt;
    const optimalPromise = this.optimalCache.get({ ...task, url: this.url });
    if (!Number.isInteger(nOpt) || nOpt <= 0) {
      const opt = await optimalPromise;
      nOpt = Number.isInteger(opt.nOpt) && opt.nOpt > 0 ? opt.nOpt : 1;
    }
    this.nOpt = nOpt;
    this.optimalPromise = optimalPromise;

    const browser = await this.getBrowser();
    this.context = await createIsolatedContext(browser);
    this.page = await this.context.newPage();
    await this.page.setViewport({ width: 1280, height: 900 });
    await this.page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pre = await runPreconditions(this.page, task);
    if (!pre.ok) throw new Error(`precondition failed: ${pre.error}`);

    this.recorder = createRequestRecorder(this.page);
    this.env = new ScreenReaderEnv(this.page, { maxSteps: budgetFor(nOpt) });
    const snap = await this.env.start();

    const lang = await this.page
      .evaluate(() => document.documentElement.getAttribute('lang'))
      .catch(() => null);

    this.startedAt = new Date().toISOString();
    this.send({
      type: 'started',
      lang: (lang && lang.trim()) || 'en',
      budget: this.env.maxSteps,
      task: { ...publicTask(task), nOpt: null }, // nOpt stays hidden while playing
    });
    // The opening phrase ("document") so the player hears where the cursor is.
    this.send({
      type: 'obs',
      step: 0,
      budgetLeft: this.env.budgetLeft,
      phrase: snap.phrase || '',
      announcements: [],
      kind: 'phrase',
      free: true,
    });
  }

  async command(cmd) {
    if (this.finished || !this.env) return;
    const obs = await this.env.step(cmd);

    this.commands.push({
      t: Date.now(),
      cmd: { type: cmd.type, ...(cmd.arg === undefined ? {} : { arg: cmd.arg }) },
      phrase: obs.phrase || '',
      announcements: obs.announcements || [],
      ...(obs.free ? { free: true } : {}),
    });

    const kind = obs.error
      ? 'noop'
      : (obs.announcements || []).length > 0
        ? 'announcement'
        : 'phrase';
    this.send({
      type: 'obs',
      step: obs.step,
      budgetLeft: obs.budgetLeft,
      phrase: obs.phrase || '',
      announcements: obs.announcements || [],
      kind,
      ...(obs.free ? { free: true } : {}),
      ...(obs.error ? { error: obs.error } : {}),
    });

    if (obs.free) return;

    let solved = false;
    try {
      solved = await evaluate(this.task.oracle, this.page, { recorder: this.recorder });
    } catch (_) {
      solved = false;
    }
    if (solved) return this.finish({ success: true, stoppedBy: 'oracle' });
    if (this.env.budgetLeft <= 0) return this.finish({ success: false, stoppedBy: 'budget' });
  }

  async abort() {
    if (this.finished || !this.env) return;
    return this.finish({ success: false, stoppedBy: 'abort' });
  }

  async finish({ success, stoppedBy }) {
    if (this.finished) return;
    this.finished = true;

    const nHuman = this.env ? this.env.stepCount : 0;
    const nOpt = this.nOpt;
    const R = success && nHuman > 0 ? Math.min(1, nOpt / nHuman) : success ? 1 : 0;
    const nAgent = (this.task.reference && this.task.reference.nAgent) || null;
    const stuck = this.env ? computeStuck(this.env.trace, nOpt) : null;

    let optimalPath = [];
    try {
      const opt = await this.optimalPromise;
      optimalPath = opt.path || [];
    } catch (_) {
      optimalPath = [];
    }

    const record = {
      sessionId: this.id,
      taskId: this.task.id,
      url: this.url,
      mode: this.mode,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      success,
      stoppedBy,
      nHuman,
      nOpt,
      R,
      commands: this.commands,
    };
    appendSession(record);

    this.send({
      type: 'result',
      success,
      stoppedBy,
      nHuman,
      nOpt,
      nAgent,
      R,
      verdict: verdictFor({ success, R, nHuman, nOpt }),
      optimalPath,
      stuck,
      trace: this.commands,
    });

    await this.cleanup();
  }

  async cleanup() {
    if (this.recorder) {
      try {
        this.recorder.stop();
      } catch (_) {
        /* page already gone */
      }
      this.recorder = null;
    }
    if (this.env) {
      await this.env.stop().catch(() => {});
      this.env = null;
    }
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }
}

module.exports = { Session, computeStuck, verdictFor, budgetFor, STUCK_MIN_RUN };
