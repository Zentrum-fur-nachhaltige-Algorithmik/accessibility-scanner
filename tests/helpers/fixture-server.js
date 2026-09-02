const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

let server = null;
let baseUrl = null;
// Second origin, on the primary port + 1, serving the same directory. A
// fixture that loads its stylesheet from here reproduces the CDN case: the
// sheet renders, `cssRules` throws, and only a fetch of its source can read
// it. Files whose name contains "no-cors" are served without the
// Access-Control-Allow-Origin header, so that fetch fails too and a scanner
// has to say the sheet was unreadable.
let crossOriginServer = null;
let crossOriginBaseUrl = null;

function createFixtureServer({ crossOrigin = false } = {}) {
  const testSitesDir = path.resolve(__dirname, '../../test-sites');

  const srv = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(testSitesDir, urlPath);

    // Prevent directory traversal
    if (!filePath.startsWith(testSitesDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      if (crossOrigin && !path.basename(filePath).includes('no-cors')) {
        headers['Access-Control-Allow-Origin'] = '*';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });

  return srv;
}

async function startFixtureServer() {
  if (server) return baseUrl;

  server = createFixtureServer();

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve(baseUrl);
    });
    server.on('error', reject);
  });
}

/**
 * Start (once) the second origin on the primary server's port + 1 and return
 * its base URL. The primary server has to be running already.
 */
async function startCrossOriginServer() {
  if (crossOriginBaseUrl) return crossOriginBaseUrl;
  if (!baseUrl) throw new Error('Fixture server not started');

  // The primary port is chosen by the OS, so port + 1 can already be taken.
  // Then the primary moves to another random port and the pair is tried again.
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = Number(new URL(baseUrl).port) + 1;
    const srv = createFixtureServer({ crossOrigin: true });
    try {
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(port, '127.0.0.1', resolve);
      });
    } catch (e) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
      baseUrl = null;
      await startFixtureServer();
      continue;
    }
    crossOriginServer = srv;
    crossOriginBaseUrl = `http://127.0.0.1:${port}`;
    return crossOriginBaseUrl;
  }
  throw new Error('Could not bind the cross-origin fixture server');
}

async function stopFixtureServer() {
  const close = (srv) => (srv ? new Promise((resolve) => srv.close(resolve)) : Promise.resolve());
  await Promise.all([close(server), close(crossOriginServer)]);
  server = null;
  baseUrl = null;
  crossOriginServer = null;
  crossOriginBaseUrl = null;
}

function getBaseUrl() {
  if (!baseUrl) throw new Error('Fixture server not started');
  return baseUrl;
}

function getCrossOriginBaseUrl() {
  if (!crossOriginBaseUrl) throw new Error('Cross-origin fixture server not started');
  return crossOriginBaseUrl;
}

module.exports = {
  startFixtureServer,
  startCrossOriginServer,
  stopFixtureServer,
  getBaseUrl,
  getCrossOriginBaseUrl,
};
