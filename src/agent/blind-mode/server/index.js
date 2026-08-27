/**
 * blind-mode/server/index.js — "Blind Mode": play a website the way a screen
 * reader user hears it.
 *
 * One sighted player, one simulated screen reader. The browser is only the
 * speaker and the keyboard; everything real happens here: a Puppeteer page per
 * session, driven through `ScreenReaderEnv`, with the task oracle evaluated
 * server-side after every command.
 *
 *   npm run blind-mode          # http://127.0.0.1:8790
 *   PORT=9000 npm run blind-mode
 *   BLIND_MODE_DATA=/tmp/bm npm run blind-mode   # session log directory
 *
 * Routes
 *   GET  /            the game (static files from ../web)
 *   GET  /site/*      the demo mini-site (test-sites/agent), so the demo tasks
 *                     need no other server running
 *   GET  /api/tasks   the playable tasks
 *   WS   /ws          the game protocol (see the README)
 */

'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer');

const { loadTasks, resolveUrl, publicTask } = require('./tasks');
const { createOptimalCache } = require('./optimal');
const { Session } = require('./session');

const WEB_DIR = path.join(__dirname, '..', 'web');
const SITE_DIR = path.join(__dirname, '..', '..', '..', '..', 'test-sites', 'agent');
const DEFAULT_PORT = 8790;

/**
 * Build (but do not listen on) the game server.
 *
 * @param {object} [options]
 * @param {string} [options.tasksDir]   where the task JSON files live
 * @param {boolean} [options.precompute=true] compute the optimal paths in the
 *        background at start; turning it off makes the first result slower but
 *        the start instant (used by the tests).
 * @returns {{ server: http.Server, app: express.Express, listen: Function, close: Function }}
 */
function createServer(options = {}) {
  const tasks = loadTasks(options.tasksDir);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  let browserPromise = null;
  const getBrowser = () => {
    if (!browserPromise) {
      browserPromise = puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return browserPromise;
  };
  const optimalCache = createOptimalCache(getBrowser);

  const app = express();
  app.get('/api/tasks', (req, res) => res.json(tasks.map(publicTask)));
  app.use('/site', express.static(SITE_DIR, { fallthrough: true }));
  app.use('/', express.static(WEB_DIR, { extensions: ['html'] }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const host = (req && req.headers && req.headers.host) || `127.0.0.1:${DEFAULT_PORT}`;
    const origin = `http://${host}`;
    const send = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const session = new Session({ send, getBrowser, optimalCache, origin });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch (_) {
        return send({ type: 'error', message: 'malformed message' });
      }
      if (msg.type === 'start') {
        const task = tasksById.get(msg.taskId);
        if (!task) return send({ type: 'error', message: `unknown task "${msg.taskId}"` });
        session.enqueue(() => session.start({ task, mode: msg.mode }));
      } else if (msg.type === 'cmd') {
        if (!msg.cmd || typeof msg.cmd.type !== 'string') {
          return send({ type: 'error', message: 'cmd requires { type }' });
        }
        session.enqueue(() => session.command({ type: msg.cmd.type, arg: msg.cmd.arg }));
      } else if (msg.type === 'abort') {
        session.enqueue(() => session.abort());
      } else {
        send({ type: 'error', message: `unknown message type "${msg.type}"` });
      }
    });

    ws.on('close', () => {
      session.finished = true;
      session.enqueue(() => session.cleanup());
    });
  });

  async function listen(port = DEFAULT_PORT, host = '127.0.0.1') {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    const origin = `http://${host}:${address.port}`;
    if (options.precompute !== false) {
      // Warm the "So wäre es gegangen" paths so the first result screen is fast.
      for (const task of tasks) {
        optimalCache
          .get({ ...task, url: resolveUrl(task, origin) })
          .then((opt) => {
            if (opt.error) {
              process.stderr.write(`blind-mode: optimal path for ${task.id}: ${opt.error}\n`);
            }
          })
          .catch(() => {});
      }
    }
    return origin;
  }

  async function close() {
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      if (browser) await browser.close().catch(() => {});
      browserPromise = null;
    }
  }

  return { app, server, wss, tasks, listen, close, optimalCache };
}

/* istanbul ignore next -- CLI */
if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const game = createServer();
  game
    .listen(port)
    .then((origin) => {
      process.stdout.write(`Blind Mode läuft auf ${origin}\n`);
    })
    .catch((err) => {
      process.stderr.write(`blind-mode: ${err.message}\n`);
      process.exit(1);
    });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      game.close().finally(() => process.exit(0));
    });
  }
}

module.exports = { createServer, DEFAULT_PORT, WEB_DIR, SITE_DIR };
