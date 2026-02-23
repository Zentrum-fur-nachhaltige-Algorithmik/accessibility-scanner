/**
 * Self-scan integration test.
 *
 * Starts the backend API server and a Next.js frontend server,
 * then uses the scan API to verify that the frontend pages and
 * generated report HTML pass the accessibility scanner with
 * zero critical or serious violations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(__dirname, '../..');

// Increase timeouts — scanning is slow
const SCAN_TIMEOUT = 180_000;

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(chunks) });
          } catch {
            reject(new Error(`Non-JSON response (${res.statusCode}): ${chunks.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    }).on('error', reject);
  });
}

function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`));
      }
      http
        .get(url, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve());
        })
        .on('error', () => setTimeout(attempt, 500));
    };
    attempt();
  });
}

describe('Self-scan: frontend and report accessibility', () => {
  let apiServer;
  let apiPort;
  let frontendProcess;
  let frontendPort;

  beforeAll(async () => {
    // 1. Start the backend API server on a random port
    const app = require('../../src/server');
    apiServer = app.listen(0, '127.0.0.1');
    apiPort = apiServer.address().port;

    // Wait for health check
    await waitForServer(`http://127.0.0.1:${apiPort}/api/health`);

    // 2. Start the Next.js frontend dev server on a random port
    frontendPort = 3999 + Math.floor(Math.random() * 1000);
    frontendProcess = spawn(
      'npx',
      ['next', 'dev', 'frontend', '-p', String(frontendPort)],
      {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(frontendPort) },
      }
    );

    // Wait for the Next.js dev server to be ready
    await waitForServer(`http://127.0.0.1:${frontendPort}/`, 90_000);
  }, 120_000);

  afterAll(async () => {
    if (frontendProcess) {
      frontendProcess.kill('SIGTERM');
      // Give it a moment to clean up
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (apiServer) {
      await new Promise((resolve) => apiServer.close(resolve));
    }
  }, 30_000);

  it(
    'frontend index page has zero critical/serious violations',
    async () => {
      const scanUrl = `http://127.0.0.1:${frontendPort}/`;
      const res = await postJSON(`http://127.0.0.1:${apiPort}/api/scan`, {
        url: scanUrl,
        profile: 'standard',
      });

      expect(res.status).toBe(200);

      const result = res.body;
      const critical = (result.violations || []).filter(
        (v) => ['critical', 'serious'].includes((v.severity || v.impact || '').toLowerCase())
      );

      if (critical.length > 0) {
        const summary = critical.map(
          (v) => `[${v.severity || v.impact}] ${v.criterion || v.wcagCriteria || ''}: ${v.description || v.type || v.issue}`
        );
        console.error('Frontend index — critical/serious violations:\n' + summary.join('\n'));
      }

      expect(critical).toHaveLength(0);
    },
    SCAN_TIMEOUT
  );

  it(
    'frontend accessibility page has zero critical/serious violations',
    async () => {
      const scanUrl = `http://127.0.0.1:${frontendPort}/accessibility`;
      const res = await postJSON(`http://127.0.0.1:${apiPort}/api/scan`, {
        url: scanUrl,
        profile: 'standard',
      });

      expect(res.status).toBe(200);

      const result = res.body;
      const critical = (result.violations || []).filter(
        (v) => ['critical', 'serious'].includes((v.severity || v.impact || '').toLowerCase())
      );

      if (critical.length > 0) {
        const summary = critical.map(
          (v) => `[${v.severity || v.impact}] ${v.criterion || v.wcagCriteria || ''}: ${v.description || v.type || v.issue}`
        );
        console.error('Accessibility page — critical/serious violations:\n' + summary.join('\n'));
      }

      expect(critical).toHaveLength(0);
    },
    SCAN_TIMEOUT
  );

  it(
    'generated report HTML has zero critical/serious violations',
    async () => {
      // First, scan a page to get scan results for report generation
      const scanUrl = `http://127.0.0.1:${frontendPort}/`;
      const scanRes = await postJSON(`http://127.0.0.1:${apiPort}/api/scan`, {
        url: scanUrl,
        profile: 'fast',
      });

      expect(scanRes.status).toBe(200);

      // Generate a report
      const reportRes = await postJSON(`http://127.0.0.1:${apiPort}/api/report`, {
        scanResult: scanRes.body,
      });

      expect(reportRes.status).toBe(200);
      expect(reportRes.body.reportUrl).toBeDefined();

      // The report is served at /api/report/:id which returns HTML
      // We need the full URL for scanning
      const reportUrl = `http://127.0.0.1:${apiPort}${reportRes.body.reportUrl}`;

      // Now scan the generated report itself
      const reportScanRes = await postJSON(`http://127.0.0.1:${apiPort}/api/scan`, {
        url: reportUrl,
        profile: 'fast',
      });

      expect(reportScanRes.status).toBe(200);

      const result = reportScanRes.body;
      const critical = (result.violations || []).filter(
        (v) => ['critical', 'serious'].includes((v.severity || v.impact || '').toLowerCase())
      );

      if (critical.length > 0) {
        const summary = critical.map(
          (v) => `[${v.severity || v.impact}] ${v.criterion || v.wcagCriteria || ''}: ${v.description || v.type || v.issue}`
        );
        console.error('Report HTML — critical/serious violations:\n' + summary.join('\n'));
      }

      expect(critical).toHaveLength(0);
    },
    SCAN_TIMEOUT
  );
});
