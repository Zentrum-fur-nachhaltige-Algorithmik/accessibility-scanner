/**
 * The LLM screen-reader agent loop.
 * The agent solves a task through a `ScreenReaderEnv` and only sees what a
 * screen-reader user hears (phrase, announcements, rotor lists, focus, URL);
 * never DOM, tree, selectors or screenshots. Every turn costs one step, including malformed ones.
 */

const DEFAULT_MEMORY_TURNS = 8;

/** Function tools mirroring the env command set (JSON schema, OpenAI shape). */
const SR_TOOLS = [
  fn('next', 'Move the screen-reader cursor to the next element and read it aloud. Costs 1 step.'),
  fn(
    'prev',
    'Move the screen-reader cursor to the previous element and read it aloud. Costs 1 step.'
  ),
  fn('tab', 'Press Tab: move to the next keyboard-focusable element. Costs 1 step.'),
  fn('shiftTab', 'Press Shift+Tab: move to the previous keyboard-focusable element. Costs 1 step.'),
  fn('headings', 'Open the rotor and list all headings on the page. Costs 1 step.'),
  fn('landmarks', 'Open the rotor and list all landmarks/regions on the page. Costs 1 step.'),
  fn('links', 'Open the rotor and list all links on the page. Costs 1 step.'),
  fn('formFields', 'Open the rotor and list all form fields on the page. Costs 1 step.'),
  fn(
    'jumpTo',
    'Move the cursor directly to an entry of the rotor list you retrieved last. Costs 1 step.',
    {
      type: 'object',
      properties: {
        index: {
          type: 'integer',
          description: 'The index shown in front of the entry in the last rotor list.',
        },
      },
      required: ['index'],
      additionalProperties: false,
    }
  ),
  fn(
    'nextHeading',
    'Jump the cursor to the next heading (wraps around at the end of the page). Costs 1 step.'
  ),
  fn('prevHeading', 'Jump the cursor to the previous heading (wraps around). Costs 1 step.'),
  fn(
    'nextLink',
    'Jump the cursor to the next link (wraps around at the end of the page). Costs 1 step.'
  ),
  fn('prevLink', 'Jump the cursor to the previous link (wraps around). Costs 1 step.'),
  fn(
    'nextFormField',
    'Jump the cursor to the next form field (wraps around at the end of the page). Costs 1 step.'
  ),
  fn('prevFormField', 'Jump the cursor to the previous form field (wraps around). Costs 1 step.'),
  fn(
    'nextLandmark',
    'Jump the cursor to the next landmark/region (wraps around at the end of the page). Costs 1 step.'
  ),
  fn(
    'prevLandmark',
    'Jump the cursor to the previous landmark/region (wraps around). Costs 1 step.'
  ),
  fn('activate', 'Activate the element at the cursor (press Enter / click it). Costs 1 step.'),
  fn('type', 'Type text into the form field at the cursor. Costs 1 step.', {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to type into the current field.' },
    },
    required: ['text'],
    additionalProperties: false,
  }),
  fn('escape', 'Press Escape, e.g. to close a dialog or a menu. Costs 1 step.'),
  fn('done', 'Declare that you believe the task is complete. Ends the session. Costs 1 step.'),
];

function fn(name, description, parameters) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: parameters || { type: 'object', properties: {}, additionalProperties: false },
    },
  };
}

const SYSTEM_PROMPT = [
  'You are a blind person using a screen reader to operate a website. You cannot see the page.',
  'You never receive HTML, source code, a page structure dump, a screenshot or element selectors:',
  'only what a screen reader speaks to you.',
  '',
  'Available commands (each is a tool; every command costs exactly one step):',
  '- next / prev: move the reading cursor one element forward or backward and hear it.',
  '- tab / shiftTab: jump to the next / previous keyboard-focusable element.',
  '- headings / landmarks / links / formFields: retrieve the rotor list of that kind.',
  '- jumpTo(index): move the cursor straight to an entry from the rotor list you retrieved last.',
  '- nextHeading / prevHeading, nextLink / prevLink, nextFormField / prevFormField,',
  '  nextLandmark / prevLandmark: step directly to the next / previous element of that kind',
  '  (these are the quick-navigation keys of a real screen reader; they wrap around at the end',
  '  of the page and cost one step each, without retrieving a list first).',
  '- activate: press Enter on / click the element at the cursor.',
  '- type(text): type text into the form field at the cursor.',
  '- escape: press Escape (e.g. to close a dialog).',
  '- done: declare the task complete.',
  '',
  'Strategy: reading the page element by element with `next` is slow and expensive. The rotor lists',
  '(headings, landmarks, links, formFields) plus jumpTo are the efficient way to navigate: one list',
  'costs one step and then one jump puts you where you want to be. Use them before crawling with next.',
  'If you already know roughly where you want to go, stepping (nextHeading, nextLink, nextFormField,',
  'nextLandmark and their prev counterparts) is cheaper still: one step per element of that kind,',
  'without paying for the list.',
  '',
  'Rules:',
  '- Call exactly one tool per turn. Never call zero tools, never call two, never answer with prose only.',
  '- Call `done` as soon as you believe the task is complete.',
  '- You will NEVER be told whether you succeeded. Nobody confirms or corrects your progress.',
  '  Judge completion yourself from what you heard (announcements, changed URL, new phrases).',
  '- On a task marked TASK TYPE: information, reaching the right page is not enough: you are done',
  '  only once the information the task asks for has been SPOKEN to you. After you arrive, read',
  '  (nextHeading, next) until you have heard it, and only then call `done`.',
  '- Your step budget is limited and is shown to you each turn. When it runs out the session ends.',
].join('\n');

/**
 * Run the screen-reader agent against one task.
 *
 * @param {object} args
 * @param {object} args.env - ScreenReaderEnv (or any object with step/stepCount/trace/deriveFindings)
 * @param {object} args.task - `{ id, description, ... }`
 * @param {object} args.llm - object with `chat(messages, options)` (see src/llm-client.js)
 * @param {string} [args.model] - model override handed to `llm.chat`
 * @param {number} [args.phraseWindow=20] - how many recent phrases are echoed back each turn
 * @param {number} [args.memoryTurns=8] - how many command/observation pairs stay in the history
 * @param {number} [args.maxSteps] - step budget; defaults to `env.maxSteps`
 * @param {(obs: object, cmd: object) => any} [args.onStep] - harness hook; may return `{ stop: true, reason }`
 * @returns {Promise<{success: null, nSr: number, steps: number, trace: any[], stoppedBy: string, usage: object, error?: string}>}
 */
async function runSrAgent({
  env,
  task,
  llm,
  model,
  phraseWindow = 20,
  memoryTurns = DEFAULT_MEMORY_TURNS,
  maxSteps,
  onStep,
}) {
  if (!env || typeof env.step !== 'function')
    throw new Error('runSrAgent: env with step() is required');
  if (!task || !task.description)
    throw new Error('runSrAgent: task with a description is required');
  if (!llm || typeof llm.chat !== 'function')
    throw new Error('runSrAgent: llm with chat() is required');

  // The kind is part of what the agent is told: on an information task, hearing
  // the answer is what completes it (see SYSTEM_PROMPT).
  const description =
    task.kind === 'information'
      ? `${task.description}\nTASK TYPE: information (you must have HEARD the answer, not just reached the page)`
      : task.description;
  let budgetLeft = numberOr(maxSteps, numberOr(env.maxSteps, 30));

  const usage = { promptTokens: 0, completionTokens: 0, calls: 0, cost: 0, costKnown: true };
  const phrases = [];
  /** @type {Array<{command: string, observation: string}>} */
  const history = [];

  let steps = 0;
  let stoppedBy = null;
  let error;
  // First turn: no observation yet, only the task itself.
  let pending = `TASK: ${description}\n\nYou have just started. Budget left: ${budgetLeft} commands.\nDecide on your first command.`;

  while (stoppedBy == null) {
    if (budgetLeft <= 0) {
      stoppedBy = 'budget';
      break;
    }

    const messages = buildMessages({ description, history, memoryTurns, pending });
    const res = await llm.chat(messages, {
      tools: SR_TOOLS,
      toolChoice: 'required',
      temperature: 0,
      systemPrompt: SYSTEM_PROMPT,
      model,
    });

    usage.calls += 1;
    if (res && res.usage) {
      usage.promptTokens += res.usage.promptTokens || 0;
      usage.completionTokens += res.usage.completionTokens || 0;
      if (typeof res.usage.cost === 'number') usage.cost += res.usage.cost;
      else usage.costKnown = false;
    } else {
      usage.costKnown = false;
    }

    if (!res || res.success !== true) {
      stoppedBy = 'error';
      error = (res && res.error) || 'LLM call failed';
      break;
    }

    const toolCalls = res.toolCalls || [];
    const invalid = describeInvalid(toolCalls);
    if (invalid) {
      // A confused turn still costs a step; feed the problem back as an observation.
      steps += 1;
      budgetLeft -= 1;
      history.push({
        command: toolCalls.length ? toolCalls.map((t) => t.name).join(', ') : '(no tool call)',
        observation: `ERROR: ${invalid}\nNothing happened on the page. Budget left: ${budgetLeft}.`,
      });
      pending = renderObservation({
        description,
        obs: { error: invalid, budgetLeft },
        phrases,
        phraseWindow,
        step: steps,
      });
      if (budgetLeft <= 0) stoppedBy = 'budget';
      continue;
    }

    const cmd = toCommand(toolCalls[0]);
    const obs = await env.step(cmd);
    steps += 1;
    budgetLeft = Math.min(budgetLeft - 1, numberOr(obs && obs.budgetLeft, Infinity));
    if (obs && typeof obs.phrase === 'string' && obs.phrase !== '') phrases.push(obs.phrase);

    let stopSignal;
    if (typeof onStep === 'function') stopSignal = await onStep(obs, cmd);

    const observationText = renderObservation({
      description,
      obs,
      phrases,
      phraseWindow,
      step: steps,
      budgetLeft,
    });
    history.push({ command: renderCommand(cmd), observation: observationText });
    pending = observationText;

    if (stopSignal && stopSignal.stop) {
      stoppedBy = stopSignal.reason || 'oracle';
    } else if (cmd.type === 'done') {
      stoppedBy = 'done';
    } else if (budgetLeft <= 0) {
      stoppedBy = 'budget';
    }
  }

  return {
    // The harness owns the verdict; the agent is never told whether it won.
    success: null,
    nSr: steps,
    steps,
    trace: (env && env.trace) || [],
    stoppedBy,
    usage,
    ...(error ? { error } : {}),
  };
}

// Internals

function numberOr(value, fallback) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function describeInvalid(toolCalls) {
  if (toolCalls.length === 0) return 'You did not call any tool. Call exactly one tool per turn.';
  if (toolCalls.length > 1) {
    return `You called ${toolCalls.length} tools at once (${toolCalls.map((t) => t.name).join(', ')}). Call exactly one tool per turn.`;
  }
  const tc = toolCalls[0];
  if (!tc.name || !SR_TOOLS.some((t) => t.function.name === tc.name)) {
    return `Unknown command "${tc.name}". Use one of: ${SR_TOOLS.map((t) => t.function.name).join(', ')}.`;
  }
  if (tc.arguments == null) {
    return `The arguments for "${tc.name}" were not valid JSON (${truncate(tc.argumentsRaw, 120)}).`;
  }
  if (tc.name === 'jumpTo' && !Number.isInteger(tc.arguments.index)) {
    return 'jumpTo requires an integer "index" from the rotor list you retrieved last.';
  }
  if (tc.name === 'type' && typeof tc.arguments.text !== 'string') {
    return 'type requires a string "text".';
  }
  return null;
}

function toCommand(tc) {
  if (tc.name === 'jumpTo') return { type: 'jumpTo', arg: tc.arguments.index };
  if (tc.name === 'type') return { type: 'type', arg: tc.arguments.text };
  return { type: tc.name };
}

function renderCommand(cmd) {
  return cmd.arg === undefined ? cmd.type : `${cmd.type}(${JSON.stringify(cmd.arg)})`;
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/**
 * Render one observation as plain text. Allow-list: task, phrase, announcements,
 * rotor, focus role/name, url + changed flag, budget, error, recent phrases.
 * Never includes selectors, markup or any structural dump.
 */
function renderObservation({ description, obs, phrases, phraseWindow, step, budgetLeft }) {
  const o = obs || {};
  const lines = [`TASK: ${description}`, ''];
  lines.push(
    `Step ${step}. Budget left: ${numberOr(budgetLeft, numberOr(o.budgetLeft, 0))} commands.`
  );
  if (o.error) lines.push(`ERROR: ${o.error}`);
  lines.push(`YOU HEAR: ${o.phrase ? o.phrase : '(nothing)'}`);

  if (Array.isArray(o.announcements) && o.announcements.length > 0) {
    lines.push('ANNOUNCEMENTS:');
    for (const a of o.announcements) lines.push(`  - ${a}`);
  }

  if (o.rotor && Array.isArray(o.rotor.items)) {
    lines.push(`ROTOR LIST (${o.rotor.kind}), ${o.rotor.items.length} entries:`);
    for (const item of o.rotor.items) lines.push(`  [${item.index}] ${item.phrase}`);
    lines.push('  Use jumpTo(index) to go to one of these.');
  }

  if (o.focus) {
    lines.push(
      `FOCUS: role=${o.focus.role || 'unknown'} name=${JSON.stringify(o.focus.name || '')}`
    );
  } else {
    lines.push('FOCUS: nothing is focused');
  }

  if (o.url) lines.push(`URL: ${o.url}${o.urlChanged ? ' (the page changed)' : ''}`);

  const recent = phrases.slice(-phraseWindow);
  if (recent.length > 0) {
    lines.push(`RECENTLY HEARD (last ${recent.length}):`);
    for (const p of recent) lines.push(`  - ${p}`);
  }

  return lines.join('\n');
}

/**
 * Build the message list: pinned task, then the last `memoryTurns`
 * command/observation pairs, then the current observation. Older turns are
 * dropped entirely; the memory cap stops the agent from accumulating the
 * whole page and turning into a tree reader.
 */
function buildMessages({ description, history, memoryTurns, pending }) {
  const messages = [
    {
      role: 'user',
      content: `TASK: ${description}\n\nSolve this task using the screen-reader commands. Call exactly one tool per turn.`,
    },
  ];

  // The newest history entry is the same text as `pending`, so keep memoryTurns-1
  // older pairs and let `pending` carry the current one.
  const olderEnd = Math.max(0, history.length - 1); // exclusive: the newest pair is `pending`
  const olderStart = Math.max(0, olderEnd - Math.max(0, memoryTurns - 1));
  const kept = history.slice(olderStart, olderEnd);
  for (const turn of kept) {
    messages.push({ role: 'assistant', content: `command: ${turn.command}` });
    messages.push({ role: 'user', content: turn.observation });
  }

  if (history.length > 0) {
    messages.push({
      role: 'assistant',
      content: `command: ${history[history.length - 1].command}`,
    });
  }
  messages.push({ role: 'user', content: pending });
  return messages;
}

module.exports = { runSrAgent, SR_TOOLS, SYSTEM_PROMPT };
