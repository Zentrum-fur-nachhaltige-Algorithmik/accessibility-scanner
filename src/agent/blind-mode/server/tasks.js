/**
 * Blind Mode task loader for `blind-mode/tasks/*.json`.
 * A task file is a normal SR-agent task (see task.js) plus `url` (start page,
 * a `/site/...` path or absolute URL) and `nOpt` (precomputed shortest command count).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateTaskShape } = require('../../task');

const TASKS_DIR = path.join(__dirname, '..', 'tasks');

/**
 * Load and validate every task file, sorted by id so the UI order is stable.
 * `nOpt` of 0 or absent means "compute at runtime" (see optimal.js).
 */
function loadTasks(dir = TASKS_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const tasks = [];
  const seen = new Set();
  for (const file of files) {
    const full = path.join(dir, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      throw new Error(`blind-mode task ${file}: invalid JSON: ${err.message}`);
    }
    if (typeof raw.url !== 'string' || raw.url === '') {
      throw new Error(`blind-mode task ${file}: "url" is required`);
    }
    const task = validateTaskShape(raw);
    task.url = raw.url;
    task.nOpt = Number.isInteger(raw.nOpt) && raw.nOpt > 0 ? raw.nOpt : null;
    if (seen.has(task.id)) throw new Error(`blind-mode task ${file}: duplicate id "${task.id}"`);
    seen.add(task.id);
    tasks.push(task);
  }
  return tasks;
}

/** Absolute URL for a task; a relative path is resolved against the server's origin. */
function resolveUrl(task, origin) {
  if (/^https?:\/\//i.test(task.url)) return task.url;
  return new URL(task.url, origin).href;
}

/** The subset of a task that may travel to the browser (no oracle, no path). */
function publicTask(task) {
  return {
    id: task.id,
    description: task.description,
    url: task.url,
    nOpt: task.nOpt,
    nAgent: (task.reference && task.reference.nAgent) || null,
  };
}

module.exports = { TASKS_DIR, loadTasks, resolveUrl, publicTask };
