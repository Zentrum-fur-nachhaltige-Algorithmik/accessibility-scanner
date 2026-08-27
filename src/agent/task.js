/**
 * src/agent/task.js — Task schema for the SR-Agent measurement.
 *
 * A Task describes one realistic user goal on a page, together with
 *  - a deterministic oracle deciding whether the goal was reached, and
 *  - a `sightedPath`: the shortest sensible click path a sighted user would take.
 *    Its length is `n_sighted`, the model-independent baseline of the score.
 *
 * Shape:
 * ```js
 * {
 *   id: string,                  // stable, unique per site
 *   description: string,         // plain user language, NO selectors / element names
 *   weight: number = 1,          // weight in the site score
 *   oracle: OracleSpec,          // see src/agent/oracle.js
 *   sightedPath: Step[],         // >= 1 step
 *   preconditions?: Step[],      // run before BOTH agents (e.g. dismiss cookie banner)
 *   template?: string,           // generic-task template id it was instantiated from
 *   meta?: object                // free-form provenance
 * }
 * ```
 * Step (one of):
 * ```js
 * { action: 'click',  selector }
 * { action: 'type',   selector, text }
 * { action: 'press',  key, selector? }   // selector: focus it first
 * { action: 'goto',   url }
 * ```
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateSpec } = require('./oracle');

const STEP_ACTIONS = ['click', 'type', 'press', 'goto'];

/** Validate a single sightedPath/precondition step. Throws with a clear message. */
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
 * Returns a NEW task object with defaults applied (does not mutate the input).
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
  if (!task.oracle) throw new Error(`Task ${task.id}: "oracle" is required`);
  validateSpec(task.oracle, `Task ${task.id}.oracle`);

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
    throw new Error(`Task file ${filePath}: invalid JSON — ${err.message}`);
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
  validateStep,
  validateTaskShape,
  isValidTaskShape,
  applyDefaults,
  parseTasks,
  loadTasks,
  saveTasks,
};
