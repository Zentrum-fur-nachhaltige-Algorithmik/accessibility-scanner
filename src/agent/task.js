/**
 * Task schema for the SR-agent measurement.
 * A task is one user goal on a page with a deterministic oracle and a
 * `sightedPath` (shortest sensible click path; its length is `n_sighted`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateSpec } = require('./oracle');
const { ANSWER_TYPES } = require('./answer-match');

const STEP_ACTIONS = ['click', 'type', 'press', 'goto'];

/**
 * What kind of goal the task states.
 * - `action`:      the user changes something; the oracle observes the new state.
 * - `information`: the user wants to KNOW something; the oracle observes the text
 *   that holds the answer, and the harness additionally requires the screen
 *   reader to have spoken it (`evidence`). See src/agent/harness.js.
 */
const TASK_KINDS = ['action', 'information'];

/**
 * Validate a single sightedPath/precondition step. Throws with a clear message.
 * Step shapes: `{ action: 'click', selector }`, `{ action: 'type', selector, text }`,
 * `{ action: 'press', key, selector? }` (selector: focus it first), `{ action: 'goto', url }`.
 */
function validateStep(step, where) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`Task: ${where} must be an object`);
  }
  if (!STEP_ACTIONS.includes(step.action)) {
    throw new Error(
      `Task: ${where}.action must be one of ${STEP_ACTIONS.join('|')} (got "${step.action}")`
    );
  }
  const needString = (field) => {
    if (typeof step[field] !== 'string' || step[field].length === 0) {
      throw new Error(`Task: ${where}.${field} is required for action "${step.action}"`);
    }
  };
  switch (step.action) {
    case 'click':
      needString('selector');
      break;
    case 'type':
      needString('selector');
      if (typeof step.text !== 'string') {
        throw new Error(`Task: ${where}.text is required for action "type"`);
      }
      break;
    case 'press':
      needString('key');
      if (step.selector !== undefined && typeof step.selector !== 'string') {
        throw new Error(`Task: ${where}.selector must be a string`);
      }
      break;
    case 'goto':
      needString('url');
      break;
    default:
      /* istanbul ignore next */
      break;
  }
  return step;
}

// Words that betray implementation details in a description meant for a blind user.
const SELECTORY =
  /(css|selector|#[a-z][\w-]*\b|\.[a-z][\w-]*\{|<[a-z]+>|querySelector|data-testid)/i;

/**
 * Validate the shape of a task. Throws on structural problems.
 * Returns a new task object with defaults applied (does not mutate the input).
 * Fields: id, description (plain user language, no selectors), weight = 1, oracle
 * (see oracle.js), sightedPath (>= 1 step), preconditions? (run before both agents),
 * keywords? (words of the page language a user would look for), kind = 'action',
 * evidence? (required for kind 'information': the verbatim page
 * text the screen reader must have spoken), answer?/answerType? (the ground-truth
 * value and its kind, matched fuzzily by the harness), template? (generic-task template id),
 * meta? (free-form provenance).
 */
function validateTaskShape(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('Task: must be an object');
  }
  if (typeof task.id !== 'string' || task.id.trim() === '') {
    throw new Error('Task: "id" is required (non-empty string)');
  }
  if (typeof task.description !== 'string' || task.description.trim() === '') {
    throw new Error(`Task ${task.id}: "description" is required (non-empty string)`);
  }
  if (SELECTORY.test(task.description)) {
    throw new Error(
      `Task ${task.id}: "description" must be plain user language without selectors or element names`
    );
  }
  if (task.weight !== undefined && (typeof task.weight !== 'number' || !(task.weight > 0))) {
    throw new Error(`Task ${task.id}: "weight" must be a positive number`);
  }
  // The words a user would look for on the page while doing this task, in the
  // language of the page. Optional: hand-written tasks may omit them, and both
  // consumers (greedy-agent.js, optimal-path.js `findWordsFor`) fall back to the
  // description.
  if (task.keywords !== undefined) {
    if (
      !Array.isArray(task.keywords) ||
      task.keywords.some((k) => typeof k !== 'string' || k.trim() === '')
    ) {
      throw new Error(`Task ${task.id}: "keywords" must be an array of non-empty strings`);
    }
  }
  if (!task.oracle) throw new Error(`Task ${task.id}: "oracle" is required`);
  validateSpec(task.oracle, `Task ${task.id}.oracle`);

  if (task.kind !== undefined && !TASK_KINDS.includes(task.kind)) {
    throw new Error(`Task ${task.id}: "kind" must be one of ${TASK_KINDS.join('|')}`);
  }
  if (task.kind === 'information') {
    if (typeof task.evidence !== 'string' || task.evidence.trim() === '') {
      throw new Error(
        `Task ${task.id}: "evidence" (the page text the screen reader must speak) is required for kind "information"`
      );
    }
    // The ground-truth answer is what the task really asks for; `evidence` is
    // only the wording one particular page uses for it. The harness accepts any
    // spelling of the answer, anywhere on the site (see answer-match.js).
    if (
      task.answer !== undefined &&
      (typeof task.answer !== 'string' || task.answer.trim() === '')
    ) {
      throw new Error(`Task ${task.id}: "answer" must be a non-empty string`);
    }
    if (task.answerType !== undefined && !ANSWER_TYPES.includes(task.answerType)) {
      throw new Error(
        `Task ${task.id}: "answerType" must be one of ${ANSWER_TYPES.join('|')} (got "${task.answerType}")`
      );
    }
    if (task.answer !== undefined && task.answerType === undefined) {
      throw new Error(`Task ${task.id}: "answerType" is required when "answer" is given`);
    }
  } else if (task.answer !== undefined || task.answerType !== undefined) {
    throw new Error(`Task ${task.id}: "answer"/"answerType" only apply to kind "information"`);
  }

  if (!Array.isArray(task.sightedPath) || task.sightedPath.length === 0) {
    throw new Error(`Task ${task.id}: "sightedPath" must be a non-empty array of steps`);
  }
  task.sightedPath.forEach((s, i) => validateStep(s, `Task ${task.id}.sightedPath[${i}]`));

  if (task.preconditions !== undefined) {
    if (!Array.isArray(task.preconditions)) {
      throw new Error(`Task ${task.id}: "preconditions" must be an array of steps`);
    }
    task.preconditions.forEach((s, i) => validateStep(s, `Task ${task.id}.preconditions[${i}]`));
  }

  return applyDefaults(task);
}

/** Apply schema defaults (currently: `weight = 1`). Returns a shallow copy. */
function applyDefaults(task) {
  const out = { ...task };
  if (out.weight === undefined) out.weight = 1;
  if (out.kind === undefined) out.kind = 'action';
  if (out.preconditions === undefined) out.preconditions = [];
  return out;
}

/** True if the task is structurally valid (no throw). */
function isValidTaskShape(task) {
  try {
    validateTaskShape(task);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Parse a tasks payload: either an array of tasks or `{ url?, tasks: [] }`.
 * Returns `{ url, tasks }` with defaults applied; throws on the first bad task.
 */
function parseTasks(payload) {
  let url = null;
  let list = payload;
  if (payload && !Array.isArray(payload) && typeof payload === 'object') {
    url = payload.url || null;
    list = payload.tasks;
  }
  if (!Array.isArray(list)) {
    throw new Error('Task file: expected an array of tasks or { url, tasks: [...] }');
  }
  const tasks = list.map(validateTaskShape);
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`Task file: duplicate task id "${t.id}"`);
    ids.add(t.id);
  }
  return { url, tasks };
}

/** Load tasks from a JSON file. Returns `{ url, tasks }`. */
function loadTasks(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Task file ${filePath}: invalid JSON: ${err.message}`);
  }
  return parseTasks(payload);
}

/** Persist tasks to a JSON file as `{ url, tasks }`. Returns the resolved path. */
function saveTasks(filePath, tasks, url = null) {
  const list = (Array.isArray(tasks) ? tasks : [tasks]).map(validateTaskShape);
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ url, tasks: list }, null, 2)}\n`, 'utf8');
  return target;
}

module.exports = {
  STEP_ACTIONS,
  TASK_KINDS,
  ANSWER_TYPES,
  validateStep,
  validateTaskShape,
  isValidTaskShape,
  applyDefaults,
  parseTasks,
  loadTasks,
  saveTasks,
};
