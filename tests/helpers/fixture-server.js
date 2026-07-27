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

function createFixtureServer() {
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
      res.writeHead(200, { 'Content-Type': contentType });
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

async function stopFixtureServer() {
  if (!server) return;
  return new Promise((resolve) => {
    server.close(() => {
      server = null;
      baseUrl = null;
      resolve();
    });
  });
}

function getBaseUrl() {
  if (!baseUrl) throw new Error('Fixture server not started');
  return baseUrl;
}

module.exports = { startFixtureServer, stopFixtureServer, getBaseUrl };
