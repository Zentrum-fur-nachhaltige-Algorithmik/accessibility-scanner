import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const { AxePuppeteer } = require('@axe-core/puppeteer');

let dataDir;
beforeAll(() => {
  // Session traces must not land in the repo while testing.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-mode-'));
  process.env.BLIND_MODE_DATA = dataDir;
});

const { createServer } = require('../../src/agent/blind-mode/server');
const { readSessions } = require('../../src/agent/blind-mode/server/store');
const { computeStuck, verdictFor } = require('../../src/agent/blind-mode/server/session');
const { commandsFromOptimalSteps } = require('../../src/agent/blind-mode/server/optimal');

/** Minimal promise-based ws client for the game protocol. */
function connect(origin) {
  const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws`);
  const inbox = [];
  let wake = null;
  ws.on('message', (data) => {
    inbox.push(JSON.parse(String(data)));
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  });
  const open = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  async function waitFor(types, timeout = 60000) {
    const wanted = Array.isArray(types) ? types : [types];
    const deadline = Date.now() + timeout;
    for (;;) {
      const idx = inbox.findIndex((m) => wanted.includes(m.type));
      if (idx >= 0) return inbox.splice(idx, 1)[0];
      const err = inbox.find((m) => m.type === 'error');
      if (err) throw new Error(`server error: ${err.message}`);
      if (Date.now() > deadline) {
        throw new Error(`timeout waiting for ${wanted.join('|')}; got ${JSON.stringify(inbox)}`);
      }
      await new Promise((resolve) => {
        wake = resolve;
        setTimeout(resolve, 25);
      });
    }
  }

  return {
    ws,
    inbox,
    open,
    waitFor,
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    async start(taskId, mode = 'experience') {
      await open;
      this.send({ type: 'start', taskId, mode, rate: 1.2 });
      const started = await this.waitFor('started');
      await this.waitFor('obs'); // the opening "document" phrase (free)
      return started;
    },
    async cmd(type, arg) {
      this.send({ type: 'cmd', cmd: arg === undefined ? { type } : { type, arg } });
      return this.waitFor(['obs', 'result']);
    },
    close() {
      try {
        ws.close();
      } catch (_) {
        /* already gone */
      }
    },
  };
}

describe('blind-mode server', () => {
  let game;
  let origin;

  beforeAll(async () => {
    game = createServer({ precompute: false });
    origin = await game.listen(0);
  }, 120000);

  afterAll(async () => {
    await game.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('http', () => {
    it('serves the game at /', async () => {
      const res = await fetch(`${origin}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      const html = await res.text();
      expect(html).toContain('Blind Mode');
      expect(html).toContain('role="application"');
    });

    it('lists the three demo tasks with url and nOpt', async () => {
      const res = await fetch(`${origin}/api/tasks`);
      const tasks = await res.json();
      expect(tasks).toHaveLength(3);
      expect(tasks.map((t) => t.id).sort()).toEqual([
        'contact-page',
        'cookie-banner',
        'site-search',
      ]);
      for (const task of tasks) {
        expect(typeof task.description).toBe('string');
        expect(task.url).toMatch(/^\/site\//);
        expect(task.nOpt).toBeGreaterThan(0);
      }
    });

    it('serves the demo mini-site under /site/ so the tasks need no other server', async () => {
      const res = await fetch(`${origin}/site/generic-home.html`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Mini Site');
    });
  });

  describe('a winning session', () => {
    let result;
    let client;

    beforeAll(async () => {
      client = connect(origin);
      const started = await client.start('contact-page', 'training');
      expect(started.lang).toBe('en');
      expect(started.budget).toBe(3 * 2 + 10); // 3 * nOpt + 10
      // The cursor starts at the document; four links later it is on "Contact".
      for (let i = 0; i < 4; i += 1) {
        const obs = await client.cmd('nextLink');
        expect(obs.type).toBe('obs');
      }
      // `repeat` is free: it must not move the step counter.
      const repeated = await client.cmd('repeat');
      expect(repeated.free).toBe(true);
      expect(repeated.step).toBe(4);

      // `activate` first echoes the observation, the verdict follows right after.
      const activated = await client.cmd('activate');
      expect(activated.type).toBe('obs');
      result = await client.waitFor('result');
    }, 120000);

    afterAll(() => client.close());

    it('ends with success as soon as the oracle holds', () => {
      expect(result.type).toBe('result');
      expect(result.success).toBe(true);
      expect(result.stoppedBy).toBe('oracle');
    });

    it('counts only the commands that cost a step', () => {
      expect(result.nHuman).toBe(5); // 4x nextLink + activate, the repeat is free
      expect(result.nOpt).toBe(2); // prevLink + activate (see recompute-nopt.js)
    });

    it('scores R = min(1, nOpt / nHuman)', () => {
      expect(result.R).toBeCloseTo(Math.min(1, result.nOpt / result.nHuman), 10);
      expect(result.R).toBeCloseTo(0.4, 10);
    });

    it('never reveals nOpt while the game is running', async () => {
      const probe = connect(origin);
      const started = await probe.start('contact-page');
      expect(started.task.nOpt).toBeNull();
      probe.close();
    }, 60000);

    it('returns the optimal path with the phrases it would have spoken', () => {
      expect(result.optimalPath.length).toBe(result.nOpt);
      expect(result.optimalPath.every((s) => typeof s.phrase === 'string')).toBe(true);
      expect(result.optimalPath.some((s) => s.phrase.includes('Contact'))).toBe(true);
      expect(result.optimalPath.map((s) => s.cmd.type)).toContain('activate');
    });

    it('phrases a German verdict and carries the full trace', () => {
      expect(result.verdict).toMatch(/Schritte gebraucht|Fast optimal/);
      expect(result.nAgent).toBeNull();
      expect(result.trace.length).toBe(6); // 5 counted + 1 free
      expect(result.trace.filter((c) => c.free).length).toBe(1);
    });

    it('appends one JSONL line with the session, without any personal data', () => {
      const sessions = readSessions();
      const mine = sessions.find((s) => s.taskId === 'contact-page' && s.success);
      expect(mine).toBeDefined();
      expect(mine.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(mine.mode).toBe('training');
      expect(mine.nHuman).toBe(5);
      expect(mine.nOpt).toBe(2);
      expect(mine.R).toBeCloseTo(0.4, 10);
      expect(mine.url).toContain('/site/generic-home.html');
      expect(mine.commands[0].cmd.type).toBe('nextLink');
      expect(Object.keys(mine)).not.toContain('ip');
      expect(JSON.stringify(mine)).not.toMatch(/Mozilla|HeadlessChrome/);
    });
  });

  describe('giving up', () => {
    it('scores R = 0 and stops with "abort"', async () => {
      const client = connect(origin);
      await client.start('contact-page');
      await client.cmd('nextLink');
      client.send({ type: 'abort' });
      const result = await client.waitFor('result');
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('abort');
      expect(result.R).toBe(0);
      expect(result.nHuman).toBe(1);
      expect(result.verdict).toMatch(/genauso hängen geblieben/);
      client.close();
    }, 120000);
  });

  describe('running out of budget', () => {
    it('stops with "budget" once the step budget is spent', async () => {
      const client = connect(origin);
      const started = await client.start('cookie-banner');
      expect(started.budget).toBe(3 * 2 + 10);
      for (let i = 0; i < started.budget; i += 1) {
        // Walking backwards through the page never dismisses the banner.
        const obs = await client.cmd('prev');
        if (obs.type === 'result') break;
      }
      const last = await client.waitFor('result');
      expect(last.stoppedBy).toBe('budget');
      expect(last.success).toBe(false);
      expect(last.R).toBe(0);
      expect(last.nHuman).toBe(started.budget);
      client.close();
    }, 180000);
  });

  describe('unit pieces', () => {
    it('verdictFor speaks the three German sentences', () => {
      expect(verdictFor({ success: true, R: 1, nHuman: 3, nOpt: 3 })).toMatch(/Fast optimal/);
      expect(verdictFor({ success: true, R: 0.3, nHuman: 10, nOpt: 3 })).toMatch(
        /Die Seite ist das Problem, nicht du\./
      );
      expect(verdictFor({ success: false, R: 0, nHuman: 9, nOpt: 3 })).toMatch(
        /Ein blinder Nutzer/
      );
    });

    it('computeStuck finds the longest run without progress', () => {
      const entry = (step, type, opts = {}) => ({
        step,
        cmd: { type },
        free: !!opts.free,
        obsAfter: { phrase: `p${step}`, urlChanged: !!opts.urlChanged },
        meta: { before: { dialogs: [] }, after: { dialogs: [] } },
      });
      const trace = [
        entry(1, 'next'),
        entry(2, 'activate'),
        entry(3, 'next'),
        entry(4, 'next'),
        entry(5, 'next'),
        entry(6, 'next'),
        entry(7, 'next', { urlChanged: true }),
      ];
      const stuck = computeStuck(trace);
      expect(stuck).toEqual({ fromStep: 3, toStep: 6, phrases: ['p3', 'p4', 'p5', 'p6'] });
      expect(computeStuck([entry(1, 'next'), entry(2, 'activate')])).toBeNull();
    });

    it('expands an optimal-path cost breakdown into exactly nOpt commands', () => {
      const steps = [
        {
          index: 0,
          action: 'type',
          reach: {
            strategy: 'rotor+next',
            cost: 3,
            via: { kind: 'formFields', index: 0, k: 1 },
          },
          actionCost: 1,
        },
        { index: 1, action: 'click', reach: { strategy: 'tab', cost: 2 }, actionCost: 1 },
        {
          index: 2,
          action: 'click',
          reach: {
            strategy: 'step+next',
            cost: 3,
            via: { kind: 'headings', dir: 'next', command: 'nextHeading', steps: 2, k: 1 },
          },
          actionCost: 1,
        },
      ];
      const sighted = [
        { action: 'type', selector: '#q', text: 'hallo' },
        { action: 'click', selector: '#go' },
        { action: 'click', selector: '#deep' },
      ];
      const cmds = commandsFromOptimalSteps(steps, sighted);
      expect(cmds.map((c) => c.type)).toEqual([
        'formFields',
        'jumpTo',
        'next',
        'type',
        'tab',
        'tab',
        'activate',
        // the rotor STEP commands expand the same way
        'nextHeading',
        'nextHeading',
        'next',
        'activate',
      ]);
      expect(cmds.length).toBe(3 + 1 + 2 + 1 + 3 + 1); // = nOpt
      expect(cmds[3].arg).toBe('hallo');
    });
  });

  describe('the game itself is accessible (axe)', () => {
    let browser;
    let page;
    const seriousViolations = [];

    async function auditScreen(label) {
      const results = await new AxePuppeteer(page)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const bad = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      for (const v of bad) seriousViolations.push(`${label}: ${v.id} (${v.impact})`);
      return bad;
    }

    beforeAll(async () => {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
    }, 120000);

    afterAll(async () => {
      if (browser) await browser.close();
    });

    it('has no serious or critical violation on the setup screen', async () => {
      await page.waitForSelector('#task-choices input[type="radio"]');
      expect(await auditScreen('setup')).toEqual([]);
    }, 60000);

    it('walks setup -> briefing -> play with the keyboard alone', async () => {
      await page.click('#task-contact-page');
      await page.click('#mode-training'); // so the spoken phrase is also readable
      await page.click('#start-button');
      await page.waitForSelector('#screen-briefing:not([hidden])');
      expect(await page.$eval('#briefing-task', (el) => el.textContent)).toMatch(/Firma/);

      await page.click('#begin-button');
      await page.waitForSelector('#screen-play:not([hidden])');
      // Focus is placed on the capture area, which explains the keys by name.
      const focused = await page.evaluate(() => document.activeElement.id);
      expect(focused).toBe('capture');
      await page.waitForFunction(
        () => document.getElementById('phrase-display').textContent !== '',
        { timeout: 30000 }
      );
    }, 120000);

    it('has no serious or critical violation on the play screen', async () => {
      expect(await auditScreen('play')).toEqual([]);
    }, 60000);

    it('plays the task to the end with real key presses', async () => {
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('KeyL');
        await page.waitForFunction(
          (n) => document.getElementById('play-counter').textContent === `Schritt ${n}`,
          { timeout: 30000 },
          i + 1
        );
      }
      expect(await page.$eval('#phrase-display', (el) => el.textContent)).toContain('Contact');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 });

      const verdict = await page.$eval('#result-verdict', (el) => el.textContent);
      expect(verdict.length).toBeGreaterThan(10);
      const optimal = await page.$$eval('#result-optimal li', (els) =>
        els.map((e) => e.textContent)
      );
      expect(optimal.length).toBe(2);
      const focused = await page.evaluate(() => document.activeElement.id);
      expect(focused).toBe('result-heading');
    }, 120000);

    it('has no serious or critical violation on the result screen', async () => {
      expect(await auditScreen('result')).toEqual([]);
      expect(seriousViolations).toEqual([]);
    }, 60000);
  });
});
