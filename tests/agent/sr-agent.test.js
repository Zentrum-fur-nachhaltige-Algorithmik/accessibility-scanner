import { describe, it, expect, vi } from 'vitest';
import { runSrAgent, SR_TOOLS, SYSTEM_PROMPT } from '../../src/agent/sr-agent.js';

/** In-memory stand-in for ScreenReaderEnv: deterministic, no browser, no VSR. */
function fakeEnv({ maxSteps = 10, phraseFor } = {}) {
  const env = {
    maxSteps,
    stepCount: 0,
    trace: [],
    findings: [],
    async step(cmd) {
      env.stepCount += 1;
      const obs = {
        step: env.stepCount,
        phrase: phraseFor ? phraseFor(cmd, env.stepCount) : `phrase-${env.stepCount}`,
        announcements: [],
        rotor: ['headings', 'landmarks', 'links', 'formFields'].includes(cmd.type)
          ? { kind: cmd.type, items: [{ index: 0, phrase: 'Contact, heading level 2' }] }
          : null,
        focus: { role: 'link', name: `el-${env.stepCount}`, selector: '#a' },
        url: 'http://x/',
        urlChanged: false,
        budgetLeft: maxSteps - env.stepCount,
      };
      env.trace.push({ step: env.stepCount, cmd, obsAfter: obs });
      return obs;
    },
    deriveFindings: () => env.findings,
    async stop() {},
  };
  return env;
}

/** LLM whose `chat` replays a script of tool-call batches. */
function fakeLlm(script, { usage = { promptTokens: 10, completionTokens: 5 } } = {}) {
  const usageOrNone = usage || undefined;
  const seen = [];
  let i = 0;
  return {
    seen,
    chat: vi.fn(async (messages, options) => {
      seen.push({ messages, options });
      const entry = script[Math.min(i, script.length - 1)];
      i += 1;
      if (entry && entry.failure) return entry.failure;
      const calls = (entry || []).map((c, n) => ({
        id: `call_${n}`,
        name: c.name,
        arguments: 'arguments' in c ? c.arguments : {},
        argumentsRaw: c.argumentsRaw ?? '{}',
      }));
      return {
        success: true,
        message: { content: null },
        toolCalls: calls,
        usage: usageOrNone,
        model: 'fake',
      };
    }),
  };
}

const task = { id: 't1', description: 'Find the contact page and open it.' };
const call = (name, args) => [{ name, arguments: args ?? {} }];

describe('runSrAgent tool schema', () => {
  it('exposes exactly the env command set as JSON-schema function tools', () => {
    expect(SR_TOOLS.map((t) => t.function.name)).toEqual([
      'next',
      'prev',
      'tab',
      'shiftTab',
      'headings',
      'landmarks',
      'links',
      'formFields',
      'jumpTo',
      'nextHeading',
      'prevHeading',
      'nextLink',
      'prevLink',
      'nextFormField',
      'prevFormField',
      'nextLandmark',
      'prevLandmark',
      'activate',
      'type',
      'escape',
      'done',
    ]);
    for (const t of SR_TOOLS) {
      expect(t.type).toBe('function');
      expect(t.function.parameters.type).toBe('object');
      expect(typeof t.function.description).toBe('string');
    }
    const jumpTo = SR_TOOLS.find((t) => t.function.name === 'jumpTo').function.parameters;
    expect(jumpTo.properties.index.type).toBe('integer');
    expect(jumpTo.required).toEqual(['index']);
    const type = SR_TOOLS.find((t) => t.function.name === 'type').function.parameters;
    expect(type.properties.text.type).toBe('string');
  });

  it('offers the rotor stepping commands with a step-cost hint and no arguments', () => {
    const stepping = [
      'nextHeading',
      'prevHeading',
      'nextLink',
      'prevLink',
      'nextFormField',
      'prevFormField',
      'nextLandmark',
      'prevLandmark',
    ];
    for (const name of stepping) {
      const tool = SR_TOOLS.find((t) => t.function.name === name);
      expect(tool, name).toBeDefined();
      expect(tool.function.description).toMatch(/Costs 1 step\./);
      expect(tool.function.parameters.properties).toEqual({});
    }
  });

  it('does not offer `repeat` as a tool: it is free and not part of the cost measure', () => {
    expect(SR_TOOLS.map((t) => t.function.name)).not.toContain('repeat');
  });

  it('documents the stepping commands in the system prompt', () => {
    for (const name of ['nextHeading', 'prevLink', 'nextFormField', 'prevLandmark']) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it('makes hearing the answer the completion rule of an information task', () => {
    expect(SYSTEM_PROMPT).toContain('TASK TYPE: information');
    expect(SYSTEM_PROMPT).toMatch(/reaching the right page is not enough/i);
  });
});

describe('the task the agent is given', () => {
  it('marks an information task so the agent knows the page alone is not the goal', async () => {
    const env = fakeEnv({ maxSteps: 2 });
    const llm = fakeLlm([call('done')]);
    await runSrAgent({
      env,
      task: { id: 't2', description: 'Find out when the practice is open.', kind: 'information' },
      llm,
    });
    const first = llm.seen[0].messages.at(-1).content;
    expect(first).toContain('TASK: Find out when the practice is open.');
    expect(first).toContain('TASK TYPE: information');
  });

  it('leaves an action task unmarked', async () => {
    const env = fakeEnv({ maxSteps: 2 });
    const llm = fakeLlm([call('done')]);
    await runSrAgent({
      env,
      task: { id: 't3', description: 'Open the imprint.', kind: 'action' },
      llm,
    });
    expect(llm.seen[0].messages.at(-1).content).not.toContain('TASK TYPE');
  });
});

describe('runSrAgent stop conditions', () => {
  it('stops on the harness onStep signal (oracle satisfied)', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      call('headings'),
      call('jumpTo', { index: 0 }),
      call('activate'),
      call('next'),
    ]);
    const onStep = vi.fn(async (obs, cmd) =>
      cmd.type === 'activate' ? { stop: true, reason: 'oracle' } : undefined
    );

    const res = await runSrAgent({ env, task, llm, onStep });

    expect(res.stoppedBy).toBe('oracle');
    expect(res.nSr).toBe(3);
    expect(res.steps).toBe(3);
    expect(res.success).toBeNull();
    expect(res.trace).toBe(env.trace);
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it('stops on `done` and records it as an env step', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([call('next'), call('done'), call('next')]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.stoppedBy).toBe('done');
    expect(res.nSr).toBe(2);
    expect(env.trace[1].cmd.type).toBe('done');
  });

  it('stops when the budget is exhausted', async () => {
    const env = fakeEnv({ maxSteps: 4 });
    const llm = fakeLlm([call('next')]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.stoppedBy).toBe('budget');
    expect(res.nSr).toBe(4);
    expect(llm.chat).toHaveBeenCalledTimes(4);
  });

  it('honours an explicit maxSteps over env.maxSteps', async () => {
    const env = fakeEnv({ maxSteps: 100 });
    const llm = fakeLlm([call('next')]);
    const res = await runSrAgent({ env, task, llm, maxSteps: 2 });
    expect(res.nSr).toBe(2);
    expect(res.stoppedBy).toBe('budget');
  });

  it('stops with stoppedBy=error when the LLM fails after retries', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      call('next'),
      {
        failure: {
          success: false,
          error: 'Retry attempts exceeded (5): boom',
          type: 'server_error',
        },
      },
    ]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.stoppedBy).toBe('error');
    expect(res.error).toMatch(/Retry attempts exceeded/);
    expect(res.nSr).toBe(1);
  });
});

describe('runSrAgent malformed turns', () => {
  it('counts a zero-tool-call turn as a step and feeds the error back', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([[], call('done')]);
    const res = await runSrAgent({ env, task, llm });

    expect(res.nSr).toBe(2); // the confused turn is charged
    expect(env.stepCount).toBe(1); // ...but no env command was issued
    expect(res.stoppedBy).toBe('done');
    const secondPrompt = llm.seen[1].messages.at(-1).content;
    expect(secondPrompt).toMatch(/ERROR: You did not call any tool/);
  });

  it('counts a multi-tool-call turn as a step and feeds the error back', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([[{ name: 'next' }, { name: 'prev' }], call('done')]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.nSr).toBe(2);
    expect(env.stepCount).toBe(1);
    expect(llm.seen[1].messages.at(-1).content).toMatch(/called 2 tools at once/);
  });

  it('counts malformed JSON arguments (arguments: null) as a step', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      [{ name: 'type', arguments: null, argumentsRaw: '{"text":' }],
      call('done'),
    ]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.nSr).toBe(2);
    expect(env.stepCount).toBe(1);
    expect(llm.seen[1].messages.at(-1).content).toMatch(/not valid JSON/);
  });

  it('rejects an unknown tool name and a jumpTo without an integer index', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      [{ name: 'readWholePage' }],
      [{ name: 'jumpTo', arguments: { index: 'first' } }],
      call('done'),
    ]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.nSr).toBe(3);
    expect(env.stepCount).toBe(1);
    expect(llm.seen[1].messages.at(-1).content).toMatch(/Unknown command "readWholePage"/);
    expect(llm.seen[2].messages.at(-1).content).toMatch(/jumpTo requires an integer/);
  });

  it('a malformed turn on the last budget step still ends with stoppedBy=budget', async () => {
    const env = fakeEnv({ maxSteps: 1 });
    const llm = fakeLlm([[]]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.stoppedBy).toBe('budget');
    expect(res.nSr).toBe(1);
  });
});

describe('runSrAgent observations', () => {
  it('never leaks the DOM, the accessibility tree or selectors to the model', async () => {
    const env = fakeEnv({ maxSteps: 6 });
    const llm = fakeLlm([call('headings'), call('jumpTo', { index: 0 }), call('done')]);
    await runSrAgent({ env, task, llm });

    for (const { messages } of llm.seen) {
      const blob = JSON.stringify(messages);
      for (const forbidden of [
        '<div',
        '<html',
        'outerHTML',
        'innerHTML',
        'accessibility tree',
        'a11yTree',
        'selector',
        '#a',
        'domChanged',
      ]) {
        expect(blob.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      // ...but the screen-reader-only channels are present
      expect(blob).toContain('TASK:');
    }
  });

  it('renders the allow-listed observation channels only', async () => {
    const env = fakeEnv({ maxSteps: 3 });
    const llm = fakeLlm([call('headings'), call('done')]);
    await runSrAgent({ env, task, llm });
    const obsMsg = llm.seen[1].messages.at(-1).content;
    expect(obsMsg).toContain('TASK: Find the contact page');
    expect(obsMsg).toContain('YOU HEAR:');
    expect(obsMsg).toContain('ROTOR LIST (headings)');
    expect(obsMsg).toContain('[0] Contact, heading level 2');
    expect(obsMsg).toContain('FOCUS: role=link name="el-1"');
    expect(obsMsg).toContain('URL: http://x/');
    expect(obsMsg).toMatch(/Budget left: \d+/);
  });

  it('sends the tools, toolChoice and system prompt on every call', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([call('done')]);
    await runSrAgent({ env, task, llm, model: 'google/gemini-3.7-flash' });
    const { options } = llm.seen[0];
    expect(options.tools).toBe(SR_TOOLS);
    expect(options.toolChoice).toBe('required');
    expect(options.model).toBe('google/gemini-3.7-flash');
    expect(options.systemPrompt).toMatch(/blind/);
    expect(options.systemPrompt).toMatch(/exactly one tool per turn/);
    expect(options.systemPrompt).toMatch(/never be told whether you succeeded/i);
    expect(options.systemPrompt).toMatch(/rotor/i);
  });
});

describe('runSrAgent memory window', () => {
  it('truncates old turns: system + task + at most memoryTurns observation pairs', async () => {
    const env = fakeEnv({ maxSteps: 20 });
    const llm = fakeLlm([call('next')]);
    await runSrAgent({ env, task, llm, memoryTurns: 3 });

    const last = llm.seen.at(-1).messages;
    const observations = last.filter((m) => m.role === 'user' && m.content.includes('YOU HEAR'));
    expect(observations.length).toBeLessThanOrEqual(3);
    // pinned task message survives truncation
    expect(last[0].role).toBe('user');
    expect(last[0].content).toContain('TASK: Find the contact page');
    // old phrases are gone from the history
    expect(JSON.stringify(last)).not.toContain('phrase-1\n');
  });

  it('keeps a rolling phrase window of at most phraseWindow entries', async () => {
    const env = fakeEnv({ maxSteps: 12 });
    const llm = fakeLlm([call('next')]);
    await runSrAgent({ env, task, llm, phraseWindow: 4, memoryTurns: 2 });

    const lastObs = llm.seen.at(-1).messages.at(-1).content;
    const recent = lastObs.split('RECENTLY HEARD')[1];
    expect(recent).toMatch(/last 4/);
    expect(recent.match(/- phrase-\d+/g).length).toBe(4);
    expect(recent).not.toContain('- phrase-1\n');
  });
});

describe('runSrAgent usage aggregation', () => {
  it('sums prompt/completion tokens and counts calls, including failed turns', async () => {
    const env = fakeEnv({ maxSteps: 5 });
    const llm = fakeLlm([[], call('next'), call('done')], {
      usage: { promptTokens: 100, completionTokens: 20 },
    });
    const res = await runSrAgent({ env, task, llm });
    expect(res.usage).toMatchObject({ promptTokens: 300, completionTokens: 60, calls: 3 });
  });

  it('tolerates a response without a usage block', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([call('done')], { usage: null });
    const res = await runSrAgent({ env, task, llm });
    expect(res.usage).toMatchObject({
      promptTokens: 0,
      completionTokens: 0,
      calls: 1,
      costKnown: false,
    });
  });
});

describe('runSrAgent argument validation', () => {
  it('requires env, task and llm', async () => {
    await expect(runSrAgent({ task, llm: fakeLlm([]) })).rejects.toThrow(/env/);
    await expect(runSrAgent({ env: fakeEnv(), llm: fakeLlm([]) })).rejects.toThrow(/task/);
    await expect(runSrAgent({ env: fakeEnv(), task })).rejects.toThrow(/llm/);
  });
});
