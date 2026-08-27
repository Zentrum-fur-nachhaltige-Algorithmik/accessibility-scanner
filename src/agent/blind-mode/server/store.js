/**
 * blind-mode/server/store.js — the session trace log.
 *
 * One JSON object per line in `data/sessions.jsonl`, in exactly the vocabulary
 * of `ScreenReaderEnv.trace` (command types, phrases, announcements), so a human
 * session and an SR-agent run can be compared line by line.
 *
 * What is stored: the task, the keystroke sequence and what was spoken.
 * What is NOT stored: IP address, user agent, names, any identifier of the
 * person playing. The session id is a fresh random uuid per game.
 *
 * `BLIND_MODE_DATA` overrides the DIRECTORY; the file inside it is always
 * `sessions.jsonl`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'data');

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
    process.stderr.write(`blind-mode: could not write session log — ${err.message}\n`);
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
