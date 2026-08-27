/**
 * src/agent/sighted-agent.js — the SIGHTED reference agent.
 *
 * The mirror image of `sr-agent.js`. This agent gets the full sighted view of
 * the page (`page-view.js`) and solves a goal with mouse-and-keyboard actions.
 * It exists for exactly one reason: to SOLVE a candidate task so that the task
 * generator can turn the solution into a deterministic `sightedPath` and check
 * that the task is doable at all before the screen-reader agent is asked to do
 * it. Anything a sighted agent with the whole page in front of it cannot do is
 * not a fair measurement of screen-reader accessibility.
 *
 * Every action is executed through `replay.executeStep`, the same function that
 * later replays the recorded path — so a recorded trajectory replays identically
 * by construction.
 *
 * Safety: on non-localhost origins the agent must not actually submit POST forms
 * (it would send real messages, orders or registrations to a stranger's site).
 * `allowSubmit: false` (the default) blocks those actions and reports them back
 * to the model as a refusal; the generator drops such tasks with the reason
 * `needs-submit`. GET forms (site search) stay allowed — they are safe reads.
 *
 * Observation mode: DOM-first. The text page view is always what the agent works
 * from. With `vision: true` (CLI `--vision`) the CURRENT turn's observation also
 * carries a viewport screenshot as an image content part — older turns stay
 * text-only so the history does not fill up with images.
 */

'use strict';

const { extractPageView, renderPageView, elementById, toMessageContent } = require('./page-view');
const { executeStep } = require('./replay');

const DEFAULT_MEMORY_TURNS = 6;
const ALLOWED_KEYS = ['Enter', 'Escape'];

/** Function tools for the sighted action set (JSON schema, OpenAI shape). */
const SIGHTED_TOOLS = [
  fn('click', 'Click the element with this number from the element list.', {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'The number in front of the element in the list.' },
    },
    required: ['id'],
    additionalProperties: false,
  }),
  fn('type', 'Type text into the form field with this number (replaces its content).', {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'The number of the form field in the element list.' },
      text: { type: 'string', description: 'The text to type.' },
    },
    required: ['id', 'text'],
    additionalProperties: false,
  }),
  fn('press', 'Press a single key: Enter (submit / activate) or Escape (close).', {
    type: 'object',
    properties: { key: { type: 'string', enum: ALLOWED_KEYS } },
    required: ['key'],
    additionalProperties: false,
  }),
  fn('goto', 'Navigate directly to a URL on this website.', {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute URL.' } },
    required: ['url'],
    additionalProperties: false,
  }),
  fn('back', 'Go back to the previous page.'),
  fn('done', 'Stop: the goal is reached (or you are convinced it cannot be reached).', {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One or two sentences: what you did and how the page shows the goal is met.',
      },
    },
    required: ['summary'],
    additionalProperties: false,
  }),
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
  'You are an experienced sighted user operating a website with mouse and keyboard.',
  'Each turn you see the current page: its URL, title, landmarks, headings, a numbered list of',
  'interactive elements and a shortened version of the visible text. Sometimes a screenshot of the',
  'viewport is attached as well — it is extra context only; the numbered list stays authoritative.',
  '',
  'Rules:',
  '- Call exactly one tool per turn. Never zero, never two, never prose only.',
  '- Address elements ONLY by the number shown in front of them. The numbers change after every',
  '  page change, so always read them from the CURRENT list.',
  '- Take the SHORTEST sensible route to the goal. Every action costs a step and your budget is small.',
  '- Do not wander: if the goal is reached, call done immediately with a short summary.',
  '- If the goal cannot be reached on this website, call done and say so plainly in the summary.',
].join('\n');

/**
 * Solve one goal on a live page.
 *
 * @param {object} args
 * @param {import('puppeteer').Page} args.page  already navigated, preconditions applied
 * @param {object} args.llm    client with `chat(messages, options)` (see llm-chat.js)
 * @param {string} [args.model]
 * @param {string} args.goal   plain-language goal, optionally plus an expected outcome
 * @param {number} [args.maxSteps=15]
 * @param {boolean} [args.allowSubmit=false]  allow POST submits on non-localhost origins
 * @param {boolean} [args.vision=false]  additionally send a viewport screenshot each turn
 * @param {number} [args.memoryTurns=6]
 * @param {object} [args.viewOptions]  passed to `extractPageView`
 * @param {(entry: object) => any} [args.onStep]  may return `{ stop: true, reason }`
 * @returns {Promise<{trajectory: object[], steps: number, stoppedBy: string, summary: string|null,
 *                    usage: object, blockedSubmits: number, finalView: object|null, error?: string}>}
 */
async function runSightedAgent({
  page,
  llm,
  model,
  goal,
  maxSteps = 15,
  allowSubmit = false,
  vision = false,
  memoryTurns = DEFAULT_MEMORY_TURNS,
  viewOptions,
  onStep,
}) {
  if (!page || typeof page.evaluate !== 'function')
    throw new Error('runSightedAgent: a puppeteer page is required');
  if (!llm || typeof llm.chat !== 'function')
    throw new Error('runSightedAgent: llm with chat() is required');
  if (typeof goal !== 'string' || goal.trim() === '')
    throw new Error('runSightedAgent: goal is required');

  const usage = { promptTokens: 0, completionTokens: 0, calls: 0, cost: 0, costKnown: true };
  const trajectory = [];
  /** @type {Array<{command: string, observation: string}>} */
  const history = [];

  let steps = 0;
  let stoppedBy = null;
  let summary = null;
  let error;
  let blockedSubmits = 0;
  let lastElement = null; // for the submit guard on `press Enter`
  const viewOpts = { ...(viewOptions || {}), ...(vision ? { screenshot: true } : {}) };
  let view = await extractPageView(page, viewOpts);
  let pending = observationText({ goal, view, step: 0, budgetLeft: maxSteps });

  while (stoppedBy == null) {
    if (steps >= maxSteps) {
      stoppedBy = 'budget';
      break;
    }

    const res = await llm.chat(buildMessages({ goal, history, memoryTurns, pending, view }), {
      tools: SIGHTED_TOOLS,
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
    const invalid = describeInvalid(toolCalls, view);
    if (invalid) {
      // A confused turn costs a step, exactly as in sr-agent.
      steps += 1;
      // The goal stays pinned even on a wasted turn — dropping it here would
      // leave the model with an error message and no idea what it was doing.
      pending = observationText({
        goal,
        view,
        step: steps,
        budgetLeft: maxSteps - steps,
        note: `${invalid} Nothing happened.`,
      });
      history.push({ command: '(invalid)', observation: pending });
      if (steps >= maxSteps) stoppedBy = 'budget';
      continue;
    }

    const call = toolCalls[0];
    const args = call.arguments || {};

    if (call.name === 'done') {
      steps += 1;
      summary = typeof args.summary === 'string' ? args.summary : '';
      stoppedBy = 'done';
      break;
    }

    const target = ['click', 'type'].includes(call.name) ? elementById(view, args.id) : null;
    const blocked = submitRefusal({
      name: call.name,
      target,
      lastElement,
      url: page.url(),
      allowSubmit,
    });
    if (blocked) {
      blockedSubmits += 1;
      steps += 1;
      pending = observationText({
        goal,
        view,
        step: steps,
        budgetLeft: maxSteps - steps,
        note: `REFUSED: ${blocked}`,
      });
      history.push({ command: renderCall(call), observation: pending });
      if (steps >= maxSteps) stoppedBy = 'budget';
      continue;
    }

    const step = toStep(call.name, args, target);
    const urlBefore = page.url();
    let stepError = null;
    try {
      if (call.name === 'back') {
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
      } else {
        await executeStep(page, step, `sighted[${steps}] ${call.name}`);
      }
    } catch (err) {
      stepError = err.message;
    }

    steps += 1;
    if (target) lastElement = target;
    await settle(page);
    view = await extractPageView(page, viewOpts).catch(() => view);
    const urlAfter = page.url();

    const entry = {
      action: call.name === 'back' ? 'back' : step.action,
      ...(step.selector ? { selector: step.selector } : {}),
      ...(step.text !== undefined ? { text: step.text } : {}),
      ...(step.key ? { key: step.key } : {}),
      ...(step.url ? { url: step.url } : {}),
      urlBefore,
      urlAfter,
      titleAfter: view ? view.title : null,
      ...(stepError ? { error: stepError } : {}),
    };
    trajectory.push(entry);

    let stopSignal;
    if (typeof onStep === 'function') stopSignal = await onStep(entry, view);

    pending = observationText({
      goal,
      view,
      step: steps,
      budgetLeft: maxSteps - steps,
      note: stepError ? `The last action failed: ${stepError}` : null,
    });
    history.push({ command: renderCall(call), observation: pending });

    if (stopSignal && stopSignal.stop) stoppedBy = stopSignal.reason || 'oracle';
    else if (steps >= maxSteps) stoppedBy = 'budget';
  }

  return {
    trajectory,
    steps,
    stoppedBy: stoppedBy || 'budget',
    summary,
    usage,
    blockedSubmits,
    finalView: view || null,
    ...(error ? { error } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Trajectory → sightedPath                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert a recorded trajectory into a replayable `sightedPath`.
 *
 * `back` cannot be replayed as such (there is no history on a fresh page), so it
 * becomes a `goto` to the page it landed on. Steps that failed are dropped —
 * they did not change the page and would only make the replay brittle.
 * Consecutive navigations to the same URL are collapsed.
 *
 * @param {object[]} trajectory
 * @returns {object[]} sightedPath steps
 */
function toSightedPath(trajectory) {
  const path = [];
  for (const t of trajectory || []) {
    if (t.error) continue;
    let step;
    if (t.action === 'back') {
      if (!t.urlAfter) continue;
      step = { action: 'goto', url: t.urlAfter };
    } else if (t.action === 'goto') {
      step = { action: 'goto', url: t.url || t.urlAfter };
    } else if (t.action === 'click') {
      if (!t.selector) continue;
      step = { action: 'click', selector: t.selector };
    } else if (t.action === 'type') {
      if (!t.selector) continue;
      step = { action: 'type', selector: t.selector, text: t.text || '' };
    } else if (t.action === 'press') {
      step = { action: 'press', key: t.key, ...(t.selector ? { selector: t.selector } : {}) };
    } else {
      continue;
    }
    const prev = path[path.length - 1];
    if (step.action === 'goto' && prev && prev.action === 'goto' && prev.url === step.url) continue;
    path.push(step);
  }
  return path;
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * Wait until the document is parsed. `executeStep` already awaits the navigation
 * event, but at that moment the new document can still be `loading` — extracting
 * the view right then yields an empty title and half the elements.
 */
async function settle(page) {
  await page
    .waitForFunction(() => document.readyState !== 'loading', { timeout: 3000 })
    .catch(() => {});
}

function toStep(name, args, target) {
  switch (name) {
    case 'click':
      return { action: 'click', selector: target.selector };
    case 'type':
      return { action: 'type', selector: target.selector, text: String(args.text) };
    case 'press':
      return { action: 'press', key: args.key };
    case 'goto':
      return { action: 'goto', url: args.url };
    case 'back':
      return { action: 'back' };
    default:
      /* istanbul ignore next */
      throw new Error(`unknown sighted action "${name}"`);
  }
}

/** `true` for localhost/127.0.0.1/[::1] — our own fixtures, safe to submit to. */
function isLocalOrigin(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch (_) {
    return false;
  }
}

/**
 * Refusal message when an action would submit a POST form on a foreign site,
 * or `null` when the action is fine. GET forms are always allowed.
 */
function submitRefusal({ name, target, lastElement, url, allowSubmit }) {
  if (allowSubmit || isLocalOrigin(url)) return null;
  const isPost = (el) => el && el.inForm && String(el.formMethod).toUpperCase() === 'POST';
  if (name === 'click' && target && target.isSubmit && isPost(target)) {
    return (
      'This would send a form to a live website that is not ours. Sending real data to a ' +
      'third-party site is not allowed here. Reach the goal without submitting, or call done ' +
      'and state that the goal requires submitting a form.'
    );
  }
  if (name === 'press' && isPost(lastElement)) {
    return (
      'Pressing Enter here would submit a form to a live website that is not ours, which is not ' +
      'allowed. Reach the goal without submitting, or call done and say the goal requires it.'
    );
  }
  return null;
}

function describeInvalid(toolCalls, view) {
  if (toolCalls.length === 0) return 'You did not call any tool. Call exactly one tool per turn.';
  if (toolCalls.length > 1) {
    return `You called ${toolCalls.length} tools at once (${toolCalls
      .map((t) => t.name)
      .join(', ')}). Call exactly one tool per turn.`;
  }
  const tc = toolCalls[0];
  const names = SIGHTED_TOOLS.map((t) => t.function.name);
  if (!tc.name || !names.includes(tc.name)) {
    return `Unknown command "${tc.name}". Use one of: ${names.join(', ')}.`;
  }
  const a = tc.arguments;
  if (a == null) return `The arguments for "${tc.name}" were not valid JSON.`;
  if (tc.name === 'click' || tc.name === 'type') {
    if (!Number.isInteger(a.id)) return `${tc.name} needs an integer "id" from the element list.`;
    if (!elementById(view, a.id)) {
      return `There is no element [${a.id}] in the current list. Use one of the listed numbers.`;
    }
    if (tc.name === 'type' && typeof a.text !== 'string') return 'type needs a string "text".';
  }
  if (tc.name === 'press' && !ALLOWED_KEYS.includes(a.key)) {
    return `press only accepts ${ALLOWED_KEYS.join(' or ')}.`;
  }
  if (tc.name === 'goto' && (typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url))) {
    return 'goto needs an absolute http(s) "url".';
  }
  return null;
}

function renderCall(call) {
  const a = call.arguments || {};
  const args = Object.keys(a).length ? JSON.stringify(a) : '';
  return `${call.name}(${args})`;
}

function observationText({ goal, view, step, budgetLeft, note }) {
  const lines = [`GOAL: ${goal}`, ''];
  lines.push(`Step ${step}. Budget left: ${budgetLeft} actions.`);
  if (note) lines.push(note);
  lines.push('');
  lines.push(renderPageView(view));
  return lines.join('\n');
}

function buildMessages({ goal, history, memoryTurns, pending, view }) {
  const messages = [
    {
      role: 'user',
      content: `GOAL: ${goal}\n\nSolve this on the website. Call exactly one tool per turn.`,
    },
  ];
  const olderEnd = Math.max(0, history.length - 1);
  const olderStart = Math.max(0, olderEnd - Math.max(0, memoryTurns - 1));
  for (const turn of history.slice(olderStart, olderEnd)) {
    messages.push({ role: 'assistant', content: `action: ${turn.command}` });
    messages.push({ role: 'user', content: turn.observation });
  }
  if (history.length > 0) {
    messages.push({
      role: 'assistant',
      content: `action: ${history[history.length - 1].command}`,
    });
  }
  // Only the current turn may carry the screenshot — history stays text-only.
  messages.push({ role: 'user', content: toMessageContent(view, pending) });
  return messages;
}

module.exports = {
  runSightedAgent,
  toSightedPath,
  SIGHTED_TOOLS,
  SYSTEM_PROMPT,
  isLocalOrigin,
  submitRefusal,
};
