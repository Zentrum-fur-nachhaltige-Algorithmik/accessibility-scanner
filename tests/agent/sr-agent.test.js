import { describe, it, expect, vi } from 'vitest';
import {
  runSrAgent,
  SR_TOOLS,
  SYSTEM_PROMPT,
  PRIVILEGED_PROMPT,
} from '../../src/agent/sr-agent.js';

/** In-memory stand-in for ScreenReaderEnv: deterministic, no browser, no VSR. */
function fakeEnv({ maxSteps = 10, phraseFor } = {}) {
  const env = {
    maxSteps,
    stepCount: 0,
    trace: [],
    findings: [],
    async step(cmd) {
      if (cmd.type === 'mark') {
        const obs = {
          step: env.stepCount,
          phrase: '',
          announcements: [],
          rotor: null,
          focus: null,
          url: 'http://x/',
          urlChanged: false,
          budgetLeft: maxSteps - env.stepCount,
          free: true,
          mark: cmd.arg,
        };
        env.trace.push({ step: env.stepCount, cmd, free: true, mark: cmd.arg, obsAfter: obs });
        return obs;
      }
      env.stepCount += 1;
      const obs = {
        step: env.stepCount,
        phrase: phraseFor ? phraseFor(cmd, env.stepCount) : `phrase-${env.stepCount}`,
        announcements: [],
        rotor: ['headings', 'landmarks', 'links', 'formFields', 'buttons'].includes(cmd.type)
          ? {
              kind: cmd.type,
              items: [{ index: 0, phrase: 'Contact, heading level 2' }],
              from: 0,
              total: 12,
              hasMore: true,
            }
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
      'buttons',
      'more',
      'rotorLetter',
      'jumpTo',
      'nextHeading',
      'prevHeading',
      'nextLink',
      'prevLink',
      'nextFormField',
      'prevFormField',
      'nextLandmark',
      'prevLandmark',
      'nextButton',
      'prevButton',
      'find',
      'findNext',
      'activate',
      'type',
      'escape',
      'done',
      'mark',
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
      'nextLink',
      'prevLink',
      'nextFormField',
      'prevFormField',
      'nextLandmark',
      'prevLandmark',
      'nextButton',
      'prevButton',
    ];
    for (const name of stepping) {
      const tool = SR_TOOLS.find((t) => t.function.name === name);
      expect(tool, name).toBeDefined();
      expect(tool.function.description).toMatch(/Costs 1 step\./);
      // Only the note every tool carries; the step itself takes no argument.
      expect(Object.keys(tool.function.parameters.properties)).toEqual(['note']);
    }
  });

  it('takes an optional heading level on the heading steps and a text on find', () => {
    for (const name of ['nextHeading', 'prevHeading']) {
      const level = SR_TOOLS.find((t) => t.function.name === name).function.parameters;
      expect(level.properties.level).toMatchObject({ type: 'integer', minimum: 1, maximum: 6 });
      expect(level.required).toBeUndefined(); // the level is optional
    }
    const find = SR_TOOLS.find((t) => t.function.name === 'find').function;
    expect(find.parameters.properties.text.type).toBe('string');
    expect(find.parameters.required).toEqual(['text']);
    expect(find.description).toMatch(/Costs 2 steps\./);
  });

  it('does not offer `repeat` as a tool: it is free and not part of the cost measure', () => {
    expect(SR_TOOLS.map((t) => t.function.name)).not.toContain('repeat');
  });

  it('documents the stepping commands in the system prompt', () => {
    for (const name of ['nextHeading', 'prevLink', 'nextFormField', 'prevLandmark', 'nextButton']) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it('documents the levelled heading step and the search in the system prompt', () => {
    expect(SYSTEM_PROMPT).toMatch(/nextHeading\(level\)/);
    expect(SYSTEM_PROMPT).toMatch(/find\(text\)/);
    expect(SYSTEM_PROMPT).toContain('findNext');
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

  it('offers `note` on every tool and never makes it required', () => {
    for (const t of SR_TOOLS) {
      expect(t.function.parameters.properties.note, t.function.name).toMatchObject({
        type: 'string',
      });
      expect(t.function.parameters.required || []).not.toContain('note');
    }
    expect(SYSTEM_PROMPT).toMatch(/Always fill `note`/);
  });

  it('records the note in the trace and keeps it out of the next prompt', async () => {
    const env = fakeEnv();
    const cmds = [];
    const step = env.step;
    env.step = async (cmd) => {
      cmds.push(cmd);
      return step(cmd);
    };
    const llm = fakeLlm([
      [
        {
          name: 'nextHeading',
          arguments: { level: 2, note: 'The intro is done, jump to sections.' },
        },
      ],
      call('done'),
    ]);
    await runSrAgent({ env, task, llm });
    expect(cmds[0]).toEqual({
      type: 'nextHeading',
      arg: 2,
      note: 'The intro is done, jump to sections.',
    });
    expect(env.trace[0].cmd.note).toBe('The intro is done, jump to sections.');
    // The note is the agent's own reasoning, not an observation: it is never
    // rendered back into the prompt.
    const secondPrompt = JSON.stringify(llm.seen[1].messages);
    expect(secondPrompt).not.toContain('jump to sections');
  });

  it('requires a signal before `done` instead of a guess', () => {
    expect(SYSTEM_PROMPT).toMatch(/`done` needs a signal/);
    expect(SYSTEM_PROMPT).toMatch(/page loaded/);
  });

  it('passes the search text and the heading level through as the command argument', async () => {
    const env = fakeEnv();
    const cmds = [];
    const step = env.step;
    env.step = async (cmd) => {
      cmds.push(cmd);
      return step(cmd);
    };
    const llm = fakeLlm([
      [{ name: 'find', arguments: { text: 'Ordination' } }],
      [{ name: 'nextHeading', arguments: { level: 2 } }],
      [{ name: 'nextHeading', arguments: {} }],
      call('done'),
    ]);
    await runSrAgent({ env, task, llm });
    expect(cmds.slice(0, 3)).toEqual([
      { type: 'find', arg: 'Ordination' },
      { type: 'nextHeading', arg: 2 },
      { type: 'nextHeading' },
    ]);
  });

  it('does not charge a step for the free `mark` and records it', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      [{ name: 'mark', arguments: { kind: 'dead_end', reason: 'That menu leads nowhere.' } }],
      call('next'),
      call('done'),
    ]);
    const res = await runSrAgent({ env, task, llm });
    // Three turns, two commands: the mark is free.
    expect(res.nSr).toBe(2);
    expect(env.trace[0]).toMatchObject({ free: true, mark: { kind: 'dead_end' } });
  });

  it('charges a step once free commands come in a row', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      [{ name: 'mark', arguments: { kind: 'confirmed' } }],
      [{ name: 'mark', arguments: { kind: 'confirmed' } }],
      [{ name: 'mark', arguments: { kind: 'confirmed' } }],
      call('done'),
    ]);
    const res = await runSrAgent({ env, task, llm });
    // Two free marks, the third is charged, then done.
    expect(res.nSr).toBe(2);
  });

  it('shows a rotor page with its position in the whole list', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([call('links'), call('done')]);
    await runSrAgent({ env, task, llm });
    const shown = llm.seen[1].messages.at(-1).content;
    expect(shown).toContain('entries 1 to 1 of 12');
    expect(shown).toMatch(/`more` for the next 8/);
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

  it('rejects an empty find text and a heading level outside 1 to 6', async () => {
    const env = fakeEnv();
    const llm = fakeLlm([
      [{ name: 'find', arguments: { text: '   ' } }],
      [{ name: 'nextHeading', arguments: { level: 9 } }],
      call('done'),
    ]);
    const res = await runSrAgent({ env, task, llm });
    expect(res.nSr).toBe(3);
    expect(env.stepCount).toBe(1);
    expect(llm.seen[1].messages.at(-1).content).toMatch(/find requires a non-empty/);
    expect(llm.seen[2].messages.at(-1).content).toMatch(
      /level" must be an integer between 1 and 6/
    );
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

describe('runSrAgent privileged control run', () => {
  const privilegedView = vi.fn(
    async () => 'URL: http://x/\nHEADINGS:\n  h2 Contact\nELEMENTS:\n  [1] link "Contact"'
  );

  it('is blind by default and refuses an unknown observation', async () => {
    const env = fakeEnv();
    await expect(
      runSrAgent({ env, task, llm: fakeLlm([call('done')]), observation: 'sighted' })
    ).rejects.toThrow(/observation/);
    await expect(
      runSrAgent({ env, task, llm: fakeLlm([call('done')]), observation: 'privileged' })
    ).rejects.toThrow(/privilegedView/);
  });

  it('adds the page view and the privileged prompt, same tools and costs', async () => {
    privilegedView.mockClear();
    const env = fakeEnv({ maxSteps: 6 });
    const llm = fakeLlm([call('headings'), call('jumpTo', { index: 0 }), call('done')]);
    const res = await runSrAgent({ env, task, llm, observation: 'privileged', privilegedView });
    expect(res.nSr).toBe(3);
    for (const { messages, options } of llm.seen) {
      expect(options.tools).toBe(SR_TOOLS);
      expect(options.systemPrompt).toBe(SYSTEM_PROMPT + PRIVILEGED_PROMPT);
      const current = messages.at(-1).content;
      expect(current).toContain('PAGE VIEW (privileged');
      expect(current).toContain('[1] link "Contact"');
    }
    // The view goes only into the current turn: history stays screen-reader only.
    const older = llm.seen[2].messages
      .slice(1, -1)
      .map((m) => m.content)
      .join('\n');
    expect(older).not.toContain('PAGE VIEW');
    // Nothing changed the page, so the view was rendered once at the start.
    expect(privilegedView).toHaveBeenCalledTimes(1);
  });

  it('re-renders the view after a step that changed the page', async () => {
    privilegedView.mockClear();
    const env = fakeEnv({ maxSteps: 6 });
    const step = env.step;
    env.step = async (cmd) => {
      const obs = await step(cmd);
      if (cmd.type === 'activate') {
        obs.urlChanged = true;
        env.trace.at(-1).domChanged = true;
      }
      return obs;
    };
    const llm = fakeLlm([
      call('next'),
      call('activate'),
      call('mark', { kind: 'confirmed' }),
      call('done'),
    ]);
    await runSrAgent({ env, task, llm, observation: 'privileged', privilegedView });
    // start + after activate; `next` and the free `mark` do not re-render.
    expect(privilegedView).toHaveBeenCalledTimes(2);
  });

  it('keeps going when the view cannot be rendered', async () => {
    const env = fakeEnv({ maxSteps: 3 });
    const llm = fakeLlm([call('done')]);
    const broken = async () => {
      throw new Error('page gone');
    };
    const res = await runSrAgent({
      env,
      task,
      llm,
      observation: 'privileged',
      privilegedView: broken,
    });
    expect(res.stoppedBy).toBe('done');
    expect(llm.seen[0].messages.at(-1).content).toContain('unavailable (page gone)');
  });
});
