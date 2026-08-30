/**
 * The LLM screen-reader agent loop.
 * The agent solves a task through a `ScreenReaderEnv` and only sees what a
 * screen-reader user hears (phrase, announcements, rotor lists, focus, URL);
 * never DOM, tree, selectors or screenshots. Every turn costs one step, including malformed ones.
 *
 * `observation: 'privileged'` is the control run of the barrier score: the same
 * agent, prompt and commands, but every turn also carries the sighted page view
 * (page-view.js). What it still needs blind beyond that is the barrier.
 */

const { MARK_KINDS } = require('./screenreader-env');

const DEFAULT_MEMORY_TURNS = 8;
/** Free commands accepted back to back before one is charged as a step. */
const MAX_FREE_IN_A_ROW = 2;

/**
 * Every tool carries the same optional `note`: one sentence of the agent's own
 * reasoning, recorded in the trace next to the command. It is never echoed back
 * into the next prompt, so the prompt stays cacheable.
 */
const NOTE_PARAM = {
  type: 'string',
  description:
    'One short sentence: what you just heard, what you conclude from it, why this command.',
};

/** Shared schema of the optional heading level of `nextHeading` / `prevHeading`. */
const LEVEL_PARAMS = {
  type: 'object',
  properties: {
    level: {
      type: 'integer',
      minimum: 1,
      maximum: 6,
      description: 'Optional heading level 1 to 6; omit to stop at any heading.',
    },
  },
  additionalProperties: false,
};

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
  fn('buttons', 'Open the rotor and list all buttons on the page. Costs 1 step.'),
  fn(
    'more',
    'Show the next page of the rotor list you retrieved last (8 entries per page). Costs 1 step.'
  ),
  fn(
    'rotorLetter',
    'Show the page of the current rotor list that starts at the next entry beginning with this' +
      ' letter. Costs 1 step.',
    {
      type: 'object',
      properties: {
        letter: { type: 'string', description: 'A single letter, e.g. "k" for "Kontakt".' },
      },
      required: ['letter'],
      additionalProperties: false,
    }
  ),
  fn(
    'jumpTo',
    'Move the cursor directly to an entry that the rotor list has SHOWN you. Costs 1 step.',
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
    'Jump the cursor to the next heading (wraps around at the end of the page). With "level" only' +
      ' headings of that level are stopped at. Costs 1 step.',
    LEVEL_PARAMS
  ),
  fn(
    'prevHeading',
    'Jump the cursor to the previous heading (wraps around). With "level" only headings of that' +
      ' level are stopped at. Costs 1 step.',
    LEVEL_PARAMS
  ),
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
  fn(
    'nextButton',
    'Jump the cursor to the next button (wraps around at the end of the page). Costs 1 step.'
  ),
  fn('prevButton', 'Jump the cursor to the previous button (wraps around). Costs 1 step.'),
  fn(
    'find',
    'Search the page from the cursor downwards and put the cursor on the next element whose spoken' +
      ' text contains your search text. Does not wrap around. Costs 2 steps.',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to search for (case-insensitive).' },
      },
      required: ['text'],
      additionalProperties: false,
    }
  ),
  fn('findNext', 'Repeat the last search from the cursor downwards. Costs 1 step.'),
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
  fn(
    'mark',
    'Record what you just realised: a dead end, a backtrack, or a confirmed step towards the goal.' +
      ' Free, costs no step.',
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['dead_end', 'backtrack', 'confirmed'] },
        reason: { type: 'string', description: 'One short sentence: what made you mark this.' },
      },
      required: ['kind'],
      additionalProperties: false,
    }
  ),
];

function fn(name, description, parameters) {
  const base = parameters || { type: 'object', properties: {}, additionalProperties: false };
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { ...base, properties: { ...base.properties, note: NOTE_PARAM } },
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
  '- headings / landmarks / links / formFields / buttons: retrieve the rotor list of that kind.',
  '  A list shows 8 entries at a time: `more` shows the next 8, rotorLetter(letter) jumps to the',
  '  next entry starting with that letter. You can only jumpTo an entry that has been shown.',
  '- jumpTo(index): move the cursor straight to an entry the rotor list has shown you.',
  '- nextHeading / prevHeading, nextLink / prevLink, nextFormField / prevFormField,',
  '  nextLandmark / prevLandmark, nextButton / prevButton: step directly to the next / previous',
  '  element of that kind (these are the quick-navigation keys of a real screen reader; they wrap',
  '  around at the end of the page and cost one step each, without retrieving a list first).',
  '- nextHeading(level) / prevHeading(level): step only through headings of that level (1 to 6),',
  '  which skips the sub-headings in between.',
  '- find(text): search downwards from the cursor and land on the next element whose spoken text',
  '  contains it (no wrap-around, costs 2 steps); findNext repeats that search for 1 step.',
  '- activate: press Enter on / click the element at the cursor.',
  '- type(text): type text into the form field at the cursor.',
  '- escape: press Escape (e.g. to close a dialog).',
  '- done: declare the task complete.',
  '- mark(kind, reason): note a dead end, a backtrack or a confirmed step. It is free, so mark a',
  '  dead end or a backtrack whenever you notice one.',
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
  '- Always fill `note`: one sentence saying what you heard, what you conclude and why this command.',
  '- `done` needs a signal, never a guess: on an action task a `page loaded` announcement or a',
  '  changed URL, on an information task the answer itself spoken to you. Without one, keep looking;',
  '  when the budget is nearly used up, keep searching rather than declaring the task done.',
  '- You will NEVER be told whether you succeeded. Nobody confirms or corrects your progress.',
  '  Judge completion yourself from what you heard (announcements, changed URL, new phrases).',
  '- A rotor list is an index to jump from, not reading: hearing an entry in a list does NOT count',
  '  as having read it. On an information task, jump to the element and read it with next.',
  '- On a task marked TASK TYPE: information, reaching the right page is not enough: you are done',
  '  only once the information the task asks for has been SPOKEN to you. After you arrive, read',
  '  (nextHeading, next) until you have heard it, and only then call `done`.',
  '- Your step budget is limited and is shown to you each turn. When it runs out the session ends.',
].join('\n');

/**
 * Appended to the system prompt in the privileged control run. It changes only
 * what the agent knows, never what it can do.
 */
const PRIVILEGED_PROMPT = [
  '',
  'PRIVILEGED MODE: in addition to what the screen reader speaks you receive, on every turn, the',
  'complete structure of the current page as a sighted person sees it (PAGE VIEW: landmarks,',
  'headings, every interactive element with its name and link target, the main text). Use it to',
  'plan the shortest route: you know beforehand which heading, link or field you are looking for,',
  'how many of its kind precede it and whether the page holds the answer at all.',
  'The numbers in front of the PAGE VIEW entries are NOT commands: you still have to reach every',
  'element with the screen-reader commands above, and every command still costs its step.',
  'On an information task the answer still has to be SPOKEN to you before `done`.',
].join('\n');

const OBSERVATIONS = ['blind', 'privileged'];

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
 * @param {'blind'|'privileged'} [args.observation='blind'] - 'privileged' adds the sighted page view
 * @param {() => Promise<string>} [args.privilegedView] - renders the current page view; required
 *        with observation 'privileged', called at the start and after every step that changed the page
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
  observation = 'blind',
  privilegedView,
}) {
  if (!env || typeof env.step !== 'function')
    throw new Error('runSrAgent: env with step() is required');
  if (!OBSERVATIONS.includes(observation))
    throw new Error(`runSrAgent: unknown observation "${observation}"`);
  const privileged = observation === 'privileged';
  if (privileged && typeof privilegedView !== 'function')
    throw new Error('runSrAgent: observation "privileged" needs a privilegedView function');
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
  let freeInARow = 0;
  let stoppedBy = null;
  let error;
  const systemPrompt = privileged ? SYSTEM_PROMPT + PRIVILEGED_PROMPT : SYSTEM_PROMPT;
  // The page view goes only into the current turn, never into the history:
  // the newest one is the only one that is true, and the prompt stays small.
  let view = privileged ? await renderView(privilegedView) : '';
  const withView = (text) => (view ? `${text}\n\n${view}` : text);
  // First turn: no observation yet, only the task itself.
  let pending = `TASK: ${description}\n\nYou have just started. Budget left: ${budgetLeft} commands.\nDecide on your first command.`;

  while (stoppedBy == null) {
    if (budgetLeft <= 0) {
      stoppedBy = 'budget';
      break;
    }

    const messages = buildMessages({
      description,
      history,
      memoryTurns,
      pending: withView(pending),
    });
    const res = await llm.chat(messages, {
      tools: SR_TOOLS,
      toolChoice: 'required',
      temperature: 0,
      systemPrompt,
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
    // `mark` is free: it records what the agent noticed and changes nothing on
    // the page, so it costs no step. A run of them in a row would still burn
    // turns without progress, so only MAX_FREE_IN_A_ROW stay free.
    const free = !!(obs && obs.free) && freeInARow < MAX_FREE_IN_A_ROW;
    freeInARow = free ? freeInARow + 1 : 0;
    if (!free) {
      steps += 1;
      budgetLeft = Math.min(budgetLeft - 1, numberOr(obs && obs.budgetLeft, Infinity));
    }
    if (obs && typeof obs.phrase === 'string' && obs.phrase !== '') phrases.push(obs.phrase);

    let stopSignal;
    if (typeof onStep === 'function') stopSignal = await onStep(obs, cmd);
    if (privileged && !free && pageChanged(env, obs)) view = await renderView(privilegedView);

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

async function renderView(privilegedView) {
  try {
    const text = await privilegedView();
    return `PAGE VIEW (privileged; what a sighted person sees, not a command list):\n${text}`;
  } catch (err) {
    return `PAGE VIEW (privileged): unavailable (${err.message})`;
  }
}

/** Did the last step change the page (navigation or DOM mutation), so the view is stale? */
function pageChanged(env, obs) {
  if (obs && obs.urlChanged) return true;
  const last = env.trace && env.trace[env.trace.length - 1];
  return !!(last && last.domChanged);
}

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
  if (tc.name === 'rotorLetter' && !String(tc.arguments.letter || '').trim()) {
    return 'rotorLetter requires a single letter.';
  }
  if (tc.name === 'mark' && !MARK_KINDS.includes(tc.arguments.kind)) {
    return `mark requires a "kind" out of ${MARK_KINDS.join(', ')}.`;
  }
  if (tc.name === 'find' && !String(tc.arguments.text || '').trim()) {
    return 'find requires a non-empty string "text" to search for.';
  }
  if (
    (tc.name === 'nextHeading' || tc.name === 'prevHeading') &&
    tc.arguments.level != null &&
    !(Number.isInteger(tc.arguments.level) && tc.arguments.level >= 1 && tc.arguments.level <= 6)
  ) {
    return 'the heading "level" must be an integer between 1 and 6, or omitted.';
  }
  return null;
}

function toCommand(tc) {
  const note = typeof tc.arguments.note === 'string' ? tc.arguments.note.trim() : '';
  const cmd = { type: tc.name };
  if (tc.name === 'jumpTo') cmd.arg = tc.arguments.index;
  else if (tc.name === 'type' || tc.name === 'find') cmd.arg = tc.arguments.text;
  else if (tc.name === 'rotorLetter') cmd.arg = tc.arguments.letter;
  else if (tc.name === 'mark') cmd.arg = { kind: tc.arguments.kind, reason: tc.arguments.reason };
  else if ((tc.name === 'nextHeading' || tc.name === 'prevHeading') && tc.arguments.level != null) {
    cmd.arg = tc.arguments.level;
  }
  // Recorded in the env trace, never rendered back to the model.
  if (note) cmd.note = note;
  return cmd;
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
    const total = typeof o.rotor.total === 'number' ? o.rotor.total : o.rotor.items.length;
    const from = typeof o.rotor.from === 'number' ? o.rotor.from : 0;
    lines.push(
      `ROTOR LIST (${o.rotor.kind}), entries ${from + 1} to ${from + o.rotor.items.length} of ${total}:`
    );
    for (const item of o.rotor.items) lines.push(`  [${item.index}] ${item.phrase}`);
    lines.push(
      o.rotor.hasMore
        ? '  Use jumpTo(index) for one of these, `more` for the next 8, rotorLetter(letter) to skip ahead.'
        : '  Use jumpTo(index) to go to one of these.'
    );
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

module.exports = { runSrAgent, SR_TOOLS, SYSTEM_PROMPT, PRIVILEGED_PROMPT, OBSERVATIONS };
