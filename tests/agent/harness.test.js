import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSite, scoreTask } from '../../src/agent/harness.js';

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

  it('adds an agent-claimed-done-prematurely finding when done was issued with the oracle false', async () => {
    oracle.evaluate.mockResolvedValue(false);
    runSrAgent.mockResolvedValue({
      success: null,
      nSr: 7,
      steps: 7,
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
    const findings = res.tasks[0].findings;
    expect(findings.map((f) => f.ruleId)).toContain('agent-claimed-done-prematurely');
    const f = findings.find((x) => x.ruleId === 'agent-claimed-done-prematurely');
    expect(f.scannerId).toBe('sr-agent');
    expect(f.wcagCriteria).toEqual(['4.1.3']);
    expect(f.severity).toBeDefined();
    expect(f.meta.taskId).toBe('t1');
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
