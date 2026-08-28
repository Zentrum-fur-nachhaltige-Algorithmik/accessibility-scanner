import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSite, scoreTask, tracePhrases, heardEvidence } from '../../src/agent/harness.js';

// The harness loads replay / oracle / screenreader-env / sr-agent lazily via
// CommonJS `require()`, which vitest's ESM mock registry does not intercept,
// so the mocks below are injected through the `deps` seam of `runSite`.
const replay = {
  validateTask: vi.fn(),
  runPreconditions: vi.fn(async () => ({ ok: true })),
};
const oracle = {
  evaluate: vi.fn(async () => false),
  createRequestRecorder: vi.fn(() => ({ requests: [] })),
};
const ScreenReaderEnv = vi.fn();
const runSrAgent = vi.fn();

const deps = {
  validateTask: (...a) => replay.validateTask(...a),
  runPreconditions: (...a) => replay.runPreconditions(...a),
  oracle,
  ScreenReaderEnv: function (...a) {
    return ScreenReaderEnv(...a);
  },
  runSrAgent: (...a) => runSrAgent(...a),
};

function fakePage() {
  return { goto: vi.fn(async () => {}), close: vi.fn(async () => {}) };
}
function fakeBrowser() {
  const pages = [];
  return {
    pages,
    newPage: vi.fn(async () => {
      const p = fakePage();
      pages.push(p);
      return p;
    }),
  };
}
function envInstance(findings = []) {
  return {
    trace: [{ step: 1 }],
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    deriveFindings: vi.fn(() => findings.slice()),
  };
}

const task = (over = {}) => ({
  id: 't1',
  description: 'Open the contact page',
  weight: 1,
  oracle: { type: 'urlMatches', pattern: 'contact' },
  sightedPath: [{ action: 'click', selector: 'a' }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  replay.validateTask.mockResolvedValue({
    valid: true,
    nSighted: 3,
    nOpt: 4,
    optimalPath: [{ index: 0 }],
  });
  replay.runPreconditions.mockResolvedValue({ ok: true });
  oracle.evaluate.mockResolvedValue(false);
  oracle.createRequestRecorder.mockResolvedValue({ requests: [] });
  ScreenReaderEnv.mockImplementation(() => envInstance());
  runSrAgent.mockResolvedValue({
    success: null,
    nSr: 5,
    steps: 5,
    trace: [],
    stoppedBy: 'oracle',
    usage: {},
  });
});

describe('scoreTask', () => {
  it('implements R = min(1, nOpt / nSr) without a smoothing constant', () => {
    expect(scoreTask(3, 3, true)).toBe(1);
    expect(scoreTask(3, 9, true)).toBeCloseTo(1 / 3);
    expect(scoreTask(4, 6, true)).toBeCloseTo(2 / 3);
    expect(scoreTask(10, 5, true)).toBe(1); // capped at 1
  });
  it('scores a solved task that cost no commands 1', () => {
    expect(scoreTask(0, 0, true)).toBe(1);
    expect(scoreTask(3, 0, true)).toBe(1);
  });
  it('is 0 on failure regardless of step count', () => {
    expect(scoreTask(3, 3, false)).toBe(0);
    expect(scoreTask(3, 1, false)).toBe(0);
  });
});

describe('runSite', () => {
  it('runs a task, scores it and reports success when the oracle is true at the end', async () => {
    const browser = fakeBrowser();
    // false at every onStep probe, true on the final check
    oracle.evaluate.mockResolvedValue(true);
    runSrAgent.mockResolvedValue({
      success: null,
      nSr: 6,
      steps: 6,
      trace: ['t'],
      stoppedBy: 'oracle',
      usage: {},
    });

    const res = await runSite({
      browser,
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });

    expect(res.url).toBe('http://x/');
    expect(res.tasks).toHaveLength(1);
    const t = res.tasks[0];
    expect(t.nSighted).toBe(3);
    expect(t.nOpt).toBe(4);
    expect(t.optimalPath).toEqual([{ index: 0 }]);
    expect(t.runs[0].success).toBe(true);
    expect(t.runs[0].nSr).toBe(6);
    expect(t.runs[0].R).toBeCloseTo(4 / 6); // nOpt / nSr; nSighted is not in the score
    expect(t.R).toBeCloseTo(4 / 6);
    expect(res.siteScore).toBeCloseTo(4 / 6);
    expect(browser.pages[0].close).toHaveBeenCalled();
  });

  it('gives the env the budget max(3 * nOpt + 10, 3 * nSighted + 10)', async () => {
    replay.validateTask.mockResolvedValue({ valid: true, nSighted: 4, nOpt: 9 });
    await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(ScreenReaderEnv.mock.calls[0][1]).toEqual({ maxSteps: 37 });
    expect(runSrAgent.mock.calls[0][0].maxSteps).toBe(37);
  });

  it('lets nSighted size the budget when it is the larger baseline', async () => {
    replay.validateTask.mockResolvedValue({ valid: true, nSighted: 10, nOpt: 2 });
    await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(ScreenReaderEnv.mock.calls[0][1]).toEqual({ maxSteps: 40 });
  });

  it('falls back to nSighted when validateTask reports no nOpt', async () => {
    replay.validateTask.mockResolvedValue({ valid: true, nSighted: 3, nOpt: null });
    oracle.evaluate.mockResolvedValue(true);
    runSrAgent.mockResolvedValue({
      success: null,
      nSr: 6,
      steps: 6,
      trace: [],
      stoppedBy: 'oracle',
      usage: {},
    });
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.tasks[0].nOpt).toBe(3);
    expect(res.tasks[0].runs[0].R).toBeCloseTo(3 / 6);
  });

  it('scores 0 and reports success:false when the oracle never becomes true', async () => {
    oracle.evaluate.mockResolvedValue(false);
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.tasks[0].runs[0].success).toBe(false);
    expect(res.tasks[0].runs[0].R).toBe(0);
    expect(res.siteScore).toBe(0);
  });

  /** An env whose trace ends in one `activate` with the given observation. */
  function envAfterActivate(obsAfter, domChanged = false) {
    const env = envInstance();
    env.trace = [
      {
        cmd: { type: 'activate' },
        obsBefore: { focusSelector: '#a', phrase: 'link, Imprint' },
        obsAfter,
        domChanged,
      },
    ];
    return env;
  }

  const doneAgent = {
    success: null,
    nSr: 7,
    steps: 7,
    trace: [],
    stoppedBy: 'done',
    usage: {},
  };

  it('blames the page when done was issued and the last action produced no feedback', async () => {
    oracle.evaluate.mockResolvedValue(false);
    ScreenReaderEnv.mockImplementation(() =>
      envAfterActivate({
        phrase: 'link, Imprint',
        announcements: [],
        urlChanged: false,
        focus: { selector: '#a' },
      })
    );
    runSrAgent.mockResolvedValue(doneAgent);

    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    const findings = res.tasks[0].findings;
    expect(findings.map((f) => f.ruleId)).toContain('agent-claimed-done-prematurely');
    const f = findings.find((x) => x.ruleId === 'agent-claimed-done-prematurely');
    expect(f.scannerId).toBe('sr-agent');
    expect(f.wcagCriteria).toEqual(['4.1.3']);
    expect(f.severity).toBe('violation');
    expect(f.meta.taskId).toBe('t1');
  });

  it('blames the agent when the page did react to the last action', async () => {
    oracle.evaluate.mockResolvedValue(false);
    ScreenReaderEnv.mockImplementation(() =>
      envAfterActivate({
        phrase: 'document',
        announcements: ['page loaded: Impressum'],
        urlChanged: true,
        focus: null,
      })
    );
    runSrAgent.mockResolvedValue(doneAgent);

    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    const findings = res.tasks[0].findings;
    expect(findings.map((f) => f.ruleId)).not.toContain('agent-claimed-done-prematurely');
    const f = findings.find((x) => x.ruleId === 'agent-stopped-early');
    expect(f).toBeTruthy();
    expect(f.scannerId).toBe('sr-agent');
    expect(f.type).toBe('agent-stopped-early');
    expect(f.severity).toBe('info');
    expect(f.wcagCriteria).toEqual([]);
    expect(f.meta.taskId).toBe('t1');
    // R stays 0: the task was not solved either way.
    expect(res.tasks[0].R).toBe(0);
  });

  it('blames the agent when it never asked the page to do anything', async () => {
    oracle.evaluate.mockResolvedValue(false);
    runSrAgent.mockResolvedValue(doneAgent);
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.tasks[0].findings.map((f) => f.ruleId)).toEqual(['agent-stopped-early']);
  });

  it('does NOT add the premature-done finding when done coincided with success', async () => {
    oracle.evaluate.mockResolvedValue(true);
    runSrAgent.mockResolvedValue({
      success: null,
      nSr: 4,
      steps: 4,
      trace: [],
      stoppedBy: 'done',
      usage: {},
    });
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.tasks[0].findings.map((f) => f.ruleId)).not.toContain(
      'agent-claimed-done-prematurely'
    );
  });

  it('collects env.deriveFindings() per run', async () => {
    ScreenReaderEnv.mockImplementation(() => envInstance([{ ruleId: 'focus-lost' }]));
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      k: 2,
      logger: null,
      deps,
    });
    expect(res.tasks[0].runs).toHaveLength(2);
    expect(res.tasks[0].findings.map((f) => f.ruleId)).toEqual(['focus-lost', 'focus-lost']);
  });

  it('averages R over k runs', async () => {
    let n = 0;
    oracle.evaluate.mockImplementation(async () => {
      n += 1;
      return n > 1;
    }); // run 1 fails, run 2 succeeds
    runSrAgent.mockResolvedValue({
      success: null,
      nSr: 3,
      steps: 3,
      trace: [],
      stoppedBy: 'budget',
      usage: {},
    });
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      k: 2,
      logger: null,
      deps,
    });
    expect(res.tasks[0].runs.map((r) => r.success)).toEqual([false, true]);
    expect(res.tasks[0].R).toBeCloseTo((0 + 1) / 2);
  });

  it('excludes invalid tasks with a reason instead of scoring them 0', async () => {
    replay.validateTask
      .mockResolvedValueOnce({
        valid: false,
        reasons: ['repeat 1: oracle already true at s0'],
        nSighted: 3,
        nOpt: null,
      })
      .mockResolvedValueOnce({ valid: true, nSighted: 3, nOpt: 4 });
    oracle.evaluate.mockResolvedValue(true);

    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task({ id: 'bad' }), task({ id: 'good' })],
      llm: {},
      logger: null,
      deps,
    });

    expect(res.invalidTasks).toHaveLength(1);
    expect(res.invalidTasks[0].id).toBe('bad');
    expect(res.invalidTasks[0].reason).toMatch(/already true/);
    expect(res.tasks.map((t) => t.task.id)).toEqual(['good']);
    expect(res.siteScore).toBeCloseTo(4 / 5); // invalid task does not drag the score down
  });

  it('treats a throwing validateTask as an invalid task', async () => {
    replay.validateTask.mockRejectedValue(new Error('nav timeout'));
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.invalidTasks[0].reason).toMatch(/nav timeout/);
    expect(res.tasks).toHaveLength(0);
    expect(res.siteScore).toBeNull();
  });

  it('weights siteScore by task weight', async () => {
    replay.validateTask.mockResolvedValue({ valid: true, nSighted: 3, nOpt: 4 });
    replay.runPreconditions.mockResolvedValue({ ok: true });
    let call = 0;
    // task A always fails (R=0), task B always succeeds (R=1)
    oracle.evaluate.mockImplementation(async () => {
      call += 1;
      return call > 1;
    });
    runSrAgent.mockResolvedValue({
      success: null,
      nSr: 3,
      steps: 3,
      trace: [],
      stoppedBy: 'budget',
      usage: {},
    });

    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task({ id: 'a', weight: 3 }), task({ id: 'b', weight: 1 })],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.tasks[0].R).toBe(0);
    expect(res.tasks[1].R).toBe(1);
    expect(res.siteScore).toBeCloseTo((0 * 3 + 1 * 1) / 4);
  });

  it('runs preconditions before starting the env and uses a fresh page per run', async () => {
    const browser = fakeBrowser();
    await runSite({
      browser,
      url: 'http://x/',
      tasks: [task({ preconditions: [{ action: 'click', selector: '#cookies' }] })],
      llm: {},
      k: 2,
      logger: null,
      deps,
    });
    expect(browser.newPage).toHaveBeenCalledTimes(2);
    expect(replay.runPreconditions).toHaveBeenCalledTimes(2);
    expect(replay.runPreconditions.mock.calls[0][1].preconditions).toEqual([
      { action: 'click', selector: '#cookies' },
    ]);
  });

  it('stops the agent via onStep as soon as the oracle turns true', async () => {
    oracle.evaluate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(true);
    await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    const { onStep } = runSrAgent.mock.calls[0][0];
    expect(await onStep({}, { type: 'next' })).toEqual({ stop: true, reason: 'oracle' });
  });

  it('closes the page and stops the env even when the run throws', async () => {
    const browser = fakeBrowser();
    const env = envInstance();
    ScreenReaderEnv.mockImplementation(() => env);
    runSrAgent.mockRejectedValue(new Error('agent exploded'));

    const res = await runSite({
      browser,
      url: 'http://x/',
      tasks: [task()],
      llm: {},
      logger: null,
      deps,
    });
    expect(res.tasks[0].runs[0].stoppedBy).toBe('error');
    expect(res.tasks[0].runs[0].error).toMatch(/agent exploded/);
    expect(res.tasks[0].runs[0].R).toBe(0);
    expect(env.stop).toHaveBeenCalled();
    expect(browser.pages[0].close).toHaveBeenCalled();
  });

  it('runs at most `concurrency` task pipelines at once and keeps the task order', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const tasks = ids.map((id) => task({ id }));
    let inFlight = 0;
    let peak = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // The pipeline of one task spans validateTask → SR agent, so the counter is
    // opened by the first stage and closed by the last.
    replay.validateTask.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(20);
      return { valid: true, nSighted: 1, nOpt: 1, timings: { validateMs: 10, nOptMs: 5 } };
    });
    runSrAgent.mockImplementation(async () => {
      await sleep(20);
      inFlight -= 1;
      return { nSr: 4, trace: [], stoppedBy: 'oracle', usage: {} };
    });

    const result = await runSite({
      browser: fakeBrowser(),
      url: 'https://x.test',
      tasks,
      llm: {},
      deps,
      concurrency: 2,
      logger: { info: () => {}, warn: () => {} },
    });

    expect(peak).toBe(2);
    expect(inFlight).toBe(0);
    expect(result.tasks.map((t) => t.task.id)).toEqual(ids);
    expect(result.tasks[0].timings).toEqual({
      validateMs: 10,
      nOptMs: 5,
      agentMs: expect.any(Number),
    });
    expect(result.wallClockMs).toBeGreaterThanOrEqual(0);
  });

  it('never overlaps two tasks at concurrency 1', async () => {
    let inFlight = 0;
    let peak = 0;
    replay.validateTask.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      return { valid: true, nSighted: 1, nOpt: 1 };
    });
    runSrAgent.mockImplementation(async () => {
      inFlight -= 1;
      return { nSr: 4, trace: [], stoppedBy: 'oracle', usage: {} };
    });

    await runSite({
      browser: fakeBrowser(),
      url: 'https://x.test',
      tasks: ['a', 'b', 'c'].map((id) => task({ id })),
      llm: {},
      deps,
      concurrency: 1,
      logger: { info: () => {}, warn: () => {} },
    });
    expect(peak).toBe(1);
  });

  describe('information tasks', () => {
    /** An env whose trace grows as the scripted agent hears one phrase per step. */
    function speakingEnv() {
      const env = {
        trace: [],
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        deriveFindings: vi.fn(() => []),
      };
      return env;
    }

    const infoTask = () =>
      task({
        id: 'find-opening-hours',
        description: 'Find out when the practice is open.',
        kind: 'information',
        evidence: 'Ordinationszeiten Montag bis Freitag',
        oracle: { type: 'elementWithText', text: 'Ordinationszeiten' },
      });

    /** Plays `phrases`, one per step, and reports what onStep said each time. */
    function scriptAgent(env, phrases) {
      const signals = [];
      runSrAgent.mockImplementation(async ({ onStep }) => {
        for (const phrase of phrases) {
          env.trace.push({ obsAfter: { phrase, announcements: [] } });
          signals.push(await onStep({ phrase }, { type: 'next' }));
        }
        return {
          success: null,
          nSr: phrases.length,
          steps: phrases.length,
          trace: env.trace,
          stoppedBy: 'oracle',
          usage: {},
        };
      });
      return signals;
    }

    it('is not solved by the page predicate alone: the phrase has to be heard', async () => {
      // The answer text is on the page from the very first step.
      oracle.evaluate.mockResolvedValue(true);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      const signals = scriptAgent(env, [
        'banner',
        'heading level 1, Impressum',
        'ORDINATIONSZEITEN   Montag bis Freitag, 8 to 12',
      ]);

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [infoTask()],
        llm: {},
        logger: null,
        deps,
      });

      // The agent is stopped on the step that spoke the answer, not before.
      expect(signals).toEqual([undefined, undefined, { stop: true, reason: 'oracle' }]);
      expect(res.tasks[0].runs[0].success).toBe(true);
    });

    it('scores 0 when the answer was on the page but never spoken', async () => {
      oracle.evaluate.mockResolvedValue(true);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      const signals = scriptAgent(env, ['banner', 'navigation', 'link, Impressum']);

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [infoTask()],
        llm: {},
        logger: null,
        deps,
      });

      expect(signals.every((s) => s === undefined)).toBe(true);
      expect(res.tasks[0].runs[0].success).toBe(false);
      expect(res.tasks[0].runs[0].R).toBe(0);
    });

    it('leaves action tasks on the page predicate alone', async () => {
      oracle.evaluate.mockResolvedValue(true);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      const signals = scriptAgent(env, ['banner']);
      await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [task()],
        llm: {},
        logger: null,
        deps,
      });
      expect(signals).toEqual([{ stop: true, reason: 'oracle' }]);
    });

    it('reports the read distance and includes the read step in the budget', async () => {
      replay.validateTask.mockResolvedValue({
        valid: true,
        nSighted: 1,
        // 1 goto + 12 commands to walk down to the phrase that speaks the answer
        nOpt: 13,
        readDistance: 12,
        optimalPath: [
          { index: 0, action: 'goto', reach: { strategy: 'none', cost: 0 }, actionCost: 1 },
          { index: 1, action: 'read', reach: { strategy: 'next', cost: 12 }, actionCost: 0 },
        ],
      });
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, ['banner']);
      const budgets = [];
      ScreenReaderEnv.mockImplementation((page, opts) => {
        budgets.push(opts.maxSteps);
        return env;
      });

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [infoTask()],
        llm: {},
        logger: null,
        deps,
      });

      expect(res.tasks[0].nOpt).toBe(13);
      expect(res.tasks[0].readDistance).toBe(12);
      expect(res.tasks[0].nOptPartial).toBeUndefined();
      // The budget follows nOpt, so the reading is affordable: 3 * 13 + 10.
      expect(budgets).toEqual([49]);
    });

    it('keeps the task and reports evidence-not-readable when the answer is never spoken', async () => {
      replay.validateTask.mockResolvedValue({
        valid: true,
        nSighted: 1,
        nOpt: 1, // navigation only
        nOptPartial: true,
        readDistance: null,
        optimalPathError: 'evidence-not-in-reading-order',
        optimalPath: [
          { index: 0, action: 'goto', reach: { strategy: 'none', cost: 0 }, actionCost: 1 },
        ],
      });
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, ['banner']);
      const warnings = [];

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [infoTask()],
        llm: {},
        logger: { info: () => {}, warn: (m) => warnings.push(m) },
        deps,
      });

      // The task is measured, not excluded ...
      expect(res.invalidTasks).toEqual([]);
      expect(res.tasks).toHaveLength(1);
      expect(res.tasks[0].nOpt).toBe(1);
      expect(res.tasks[0].nOptPartial).toBe(true);
      expect(res.tasks[0].readDistance).toBeNull();
      // ... and the unreadable answer is itself a finding.
      const finding = res.tasks[0].findings.find((f) => f.type === 'evidence-not-readable');
      expect(finding).toMatchObject({
        scannerId: 'sr-agent',
        ruleId: 'evidence-not-readable',
        type: 'evidence-not-readable',
        severity: 'violation',
        wcagCriteria: ['1.1.1', '1.3.1'],
        meta: { taskId: 'find-opening-hours', evidence: 'Ordinationszeiten Montag bis Freitag' },
      });
      expect(warnings.join(' ')).toMatch(/never spoken/);
      // It is not treated as a broken nOpt measurement.
      expect(warnings.join(' ')).not.toMatch(/falling back to nSighted/);
    });

    it('hears the answer in an announcement, but a rotor list is an index, not something heard', () => {
      const env = {
        trace: [
          { obsAfter: { phrase: 'banner', announcements: [] } },
          { obsAfter: { phrase: 'main', announcements: ['status, 3 results found'] } },
          {
            obsAfter: {
              phrase: 'main',
              announcements: [],
              rotor: { kind: 'headings', items: [{ index: 0, phrase: 'heading, Opening hours' }] },
            },
          },
        ],
      };
      expect(tracePhrases(env)).toContain('status, 3 results found');
      expect(tracePhrases(env)).not.toContain('heading, Opening hours');
      expect(heardEvidence(env, '3 results found')).toBe(true);
      expect(heardEvidence(env, 'opening   HOURS')).toBe(false);
      expect(heardEvidence(env, 'closing hours')).toBe(false);
      expect(heardEvidence(env, '')).toBe(false);
    });

    it('hears an answer split over up to three consecutive phrases', () => {
      // The screen reader speaks nodes, not sentences: the opening hours are
      // one visual line but three phrases in a row.
      const env = {
        trace: [
          { obsAfter: { phrase: 'banner', announcements: [] } },
          { obsAfter: { phrase: 'Opening hours', announcements: [] } },
          { obsAfter: { phrase: 'Monday to Friday', announcements: [] } },
          { obsAfter: { phrase: '8 to 12', announcements: [] } },
          { obsAfter: { phrase: 'and 14 to 18', announcements: [] } },
        ],
      };
      // Two and three phrases in a row still count ...
      expect(heardEvidence(env, 'Opening hours Monday to Friday')).toBe(true);
      expect(heardEvidence(env, 'opening   HOURS monday to friday 8 to 12')).toBe(true);
      // ... four do not: that is not hearing an answer any more.
      expect(heardEvidence(env, 'Opening hours Monday to Friday 8 to 12 and 14 to 18')).toBe(false);
      // The window only joins what was heard in sequence.
      expect(heardEvidence(env, 'banner Monday to Friday')).toBe(false);
    });

    it('does not join a cursor phrase with a rotor entry into a window', () => {
      const env = {
        trace: [
          { obsAfter: { phrase: 'Opening hours', announcements: [] } },
          {
            obsAfter: {
              phrase: 'Opening hours',
              announcements: [],
              rotor: { kind: 'headings', items: [{ index: 0, phrase: 'heading, Monday' }] },
            },
          },
        ],
      };
      expect(heardEvidence(env, 'Opening hours heading, Monday')).toBe(false);
    });
  });

  // The finding that motivated all of this: on urologiefischer.at every run
  // HEARD the phone number and the address on the imprint page, in another
  // spelling than the evidence picked on the home page, and scored 0.
  describe('answer equivalence', () => {
    function speakingEnv() {
      return {
        trace: [],
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        deriveFindings: vi.fn(() => []),
      };
    }

    const answerTask = (over = {}) =>
      task({
        id: 'find-contact-info',
        description: 'Find the phone number of the practice.',
        kind: 'information',
        // Picked on the HOME page; the agent ends up on the imprint page.
        evidence: 'TEL: 01 2039333',
        answer: '+43 1 2039333',
        answerType: 'phone',
        oracle: { type: 'elementWithText', text: 'TEL' },
        ...over,
      });

    /** Plays `phrases` and then stops with `stoppedBy`. */
    function scriptAgent(env, phrases, stoppedBy = 'done') {
      runSrAgent.mockImplementation(async ({ onStep }) => {
        for (const phrase of phrases) {
          env.trace.push({ obsAfter: { phrase, announcements: [] } });
          const signal = await onStep({ phrase }, { type: 'next' });
          if (signal && signal.stop) break;
        }
        return {
          success: null,
          nSr: phrases.length,
          steps: phrases.length,
          trace: env.trace,
          stoppedBy,
          usage: { calls: 3, promptTokens: 10, completionTokens: 2, cost: 0.01 },
        };
      });
    }

    const IMPRINT = [
      'paragraph',
      'Donaustadtstraße 1',
      'end of paragraph',
      'paragraph',
      '1220 Wien',
      'end of paragraph',
      'paragraph',
      'Telefon: +43 1 203 93 33',
    ];

    it('succeeds on the answer even when the page predicate is false', async () => {
      // The imprint page does not carry the evidence text, so the oracle stays false.
      oracle.evaluate.mockResolvedValue(false);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, IMPRINT);

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [answerTask()],
        llm: {},
        logger: null,
        deps,
      });

      const run = res.tasks[0].runs[0];
      expect(run.success).toBe(true);
      expect(run.successBy).toBe('answer-normalised');
      expect(run.R).toBeGreaterThan(0);
    });

    it('hears an address spread over phrases that boundary phrases interrupt', async () => {
      oracle.evaluate.mockResolvedValue(false);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, IMPRINT);

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [
          answerTask({
            id: 'find-address',
            description: 'Look up the address of the practice.',
            evidence: '1220 WIEN DONAUSTADTSTRASSE 1',
            answer: 'Donaustadtstraße 1, 1220 Wien',
            answerType: 'address',
          }),
        ],
        llm: {},
        logger: null,
        deps,
      });
      expect(res.tasks[0].runs[0].successBy).toBe('answer-normalised');
    });

    it('marks the exact evidence match as "evidence"', async () => {
      oracle.evaluate.mockResolvedValue(true);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, ['paragraph', 'TEL: 01 2039333'], 'oracle');

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [answerTask()],
        llm: {},
        logger: null,
        deps,
      });
      expect(res.tasks[0].runs[0].successBy).toBe('evidence');
    });

    it('marks an action task as "oracle"', async () => {
      oracle.evaluate.mockResolvedValue(true);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, ['banner'], 'oracle');
      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [task()],
        llm: {},
        logger: null,
        deps,
      });
      expect(res.tasks[0].runs[0].successBy).toBe('oracle');
    });

    it('asks the LLM judge once when the normalisers fail and the agent said done', async () => {
      oracle.evaluate.mockResolvedValue(false);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, ['paragraph', 'Ordination halb eins bis halb sieben'], 'done');
      const llm = {
        chat: vi.fn(async () => ({
          success: true,
          toolCalls: [
            {
              name: 'judge_answer',
              arguments: { equivalent: true, evidence: 'Ordination halb eins bis halb sieben' },
            },
          ],
          usage: { calls: 1, promptTokens: 100, completionTokens: 5, cost: 0.002 },
        })),
      };

      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [answerTask({ answer: 'Mo 12:30-18:30', answerType: 'hours' })],
        llm,
        logger: null,
        deps,
      });

      const run = res.tasks[0].runs[0];
      expect(llm.chat).toHaveBeenCalledTimes(1);
      expect(llm.chat.mock.calls[0][1].tools[0].function.name).toBe('judge_answer');
      expect(run.success).toBe(true);
      expect(run.successBy).toBe('answer-llm');
      // The judge's own tokens are part of the reported cost.
      expect(run.usage.calls).toBe(4);
      expect(run.usage.cost).toBeCloseTo(0.012);
      // ... and no premature-done finding is raised for a run that HAD the answer.
      expect((res.tasks[0].findings || []).map((f) => f.type)).not.toContain(
        'agent-claimed-done-prematurely'
      );
    });

    it('keeps a stopped-early finding when the judge says no', async () => {
      oracle.evaluate.mockResolvedValue(false);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, ['paragraph', 'Kontaktformular'], 'done');
      const llm = {
        chat: vi.fn(async () => ({
          success: true,
          toolCalls: [{ name: 'judge_answer', arguments: { equivalent: false, evidence: '' } }],
          usage: { calls: 1 },
        })),
      };
      const res = await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [answerTask()],
        llm,
        logger: null,
        deps,
      });
      expect(res.tasks[0].runs[0].success).toBe(false);
      expect(res.tasks[0].runs[0].successBy).toBe(null);
      // The agent only read; nothing it did could have gone unannounced, so the
      // finding is about the agent, not about the page.
      expect((res.tasks[0].findings || []).map((f) => f.type)).toContain('agent-stopped-early');
    });

    it('never asks the judge while the agent is still running', async () => {
      oracle.evaluate.mockResolvedValue(false);
      const env = speakingEnv();
      ScreenReaderEnv.mockImplementation(() => env);
      scriptAgent(env, IMPRINT, 'oracle');
      const llm = { chat: vi.fn() };
      await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [answerTask()],
        llm,
        logger: null,
        deps,
      });
      // The deterministic check already had the answer.
      expect(llm.chat).not.toHaveBeenCalled();
    });

    it('checks reading fragmentation once per page the agent visits', async () => {
      oracle.evaluate.mockResolvedValue(false);
      const env = speakingEnv();
      env.checkReadingFragmentation = vi.fn(async () => null);
      ScreenReaderEnv.mockImplementation(() => env);
      runSrAgent.mockImplementation(async ({ onStep }) => {
        env.trace.push({ obsAfter: { phrase: 'a', urlChanged: false, announcements: [] } });
        await onStep();
        env.trace.push({ obsAfter: { phrase: 'b', urlChanged: true, announcements: [] } });
        await onStep();
        return {
          success: null,
          nSr: 2,
          steps: 2,
          trace: env.trace,
          stoppedBy: 'budget',
          usage: {},
        };
      });
      await runSite({
        browser: fakeBrowser(),
        url: 'http://x/',
        tasks: [task()],
        llm: {},
        logger: null,
        deps,
      });
      // start of the run + the navigation + once at the end
      expect(env.checkReadingFragmentation).toHaveBeenCalledTimes(3);
    });
  });

  it('returns empty output for an empty task list', async () => {
    const res = await runSite({
      browser: fakeBrowser(),
      url: 'http://x/',
      tasks: [],
      llm: {},
      logger: null,
      deps,
    });
    expect(res).toMatchObject({ url: 'http://x/', tasks: [], siteScore: null, invalidTasks: [] });
    expect(res.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
      cost: 0,
      costKnown: true,
    });
  });
});
