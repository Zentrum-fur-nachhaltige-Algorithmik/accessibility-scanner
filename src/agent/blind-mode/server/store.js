/**
 * Blind Mode session log: one JSON object per line in `data/sessions.jsonl`,
 * in the vocabulary of `ScreenReaderEnv.trace` so human and agent runs compare
 * line by line. Stores task, keystrokes and spoken output; no IP, user agent or names.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'data');

/** `BLIND_MODE_DATA` overrides the directory; the file name is fixed. */
function dataDir() {
  return process.env.BLIND_MODE_DATA || DEFAULT_DIR;
}

function sessionsFile() {
  return path.join(dataDir(), 'sessions.jsonl');
}

/** Append one session record. Never throws: a failed log must not kill a game. */
function appendSession(record) {
  const file = sessionsFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    return file;
  } catch (err) {
    process.stderr.write(`blind-mode: could not write session log: ${err.message}\n`);
    return null;
  }
}

/** Read all recorded sessions back (used by the tests and by later analysis). */
function readSessions() {
  const file = sessionsFile();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

module.exports = { dataDir, sessionsFile, appendSession, readSessions };
