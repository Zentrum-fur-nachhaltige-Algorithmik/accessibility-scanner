const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs-extra');

const ScanPipeline = require('./scan-pipeline');
const { registerAllScanners, getProfile } = require('./scanner-registry');
const ReportGenerator = require('./report-generator');
const { assertScannableUrl, UrlGuardError } = require('./url-guard');
const { ScanJobStore } = require('./scan-jobs');
const { createAuthMiddleware, logAuthStartupState } = require('./auth');

const app = express();
const port = process.env.PORT || 3000;

/**
 * Ids we accept in a path parameter before they reach path.join().
 * Rejects traversal ("../../etc/passwd"), absolute paths and NUL bytes.
 */
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Guard a path parameter. Responds 400 and returns null when unsafe.
 * @returns {string|null}
 */
function requireSafeId(res, value, label) {
  if (typeof value === 'string' && SAFE_ID.test(value)) return value;
  res.status(400).json({ error: `Invalid ${label}: must match [a-zA-Z0-9_-]{1,64}` });
  return null;
}

// Middleware
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
// Full-profile scan results routinely exceed express.json's 100kb default
// (a ~400-violation result is ~180kb); /api/report receives exactly that payload.
app.use(express.json({ limit: '25mb' }));

// Bearer auth for /api/* (except /api/health) and /reports/* when API_TOKEN is
// set. Registered BEFORE the static mount below so the guard always runs first.
app.use(createAuthMiddleware());
logAuthStartupState();

// Serve reports directory — the same generated files as /api/report/:id, so it
// is covered by the auth middleware above.
const reportsDir = path.join(__dirname, '../reports');
fs.ensureDirSync(reportsDir);
app.use('/reports', express.static(reportsDir));

// Initialize pipeline with all scanners
const pipeline = new ScanPipeline();
const scanners = registerAllScanners(pipeline);
const reportGenerator = new ReportGenerator();

// In-memory scan queue using dynamic import (p-queue is ESM)
let scanQueue = null;

async function getQueue() {
  if (!scanQueue) {
    const PQueue = (await import('p-queue')).default;
    scanQueue = new PQueue({ concurrency: parseInt(process.env.SCAN_CONCURRENCY) || 1 });
  }
  return scanQueue;
}

// Rate limiter for scan endpoint (5 requests per hour per IP by default)
const scanRateLimitMax = parseInt(process.env.SCAN_RATE_LIMIT_MAX, 10) || 5;
const scanRateLimitWindowMs = parseInt(process.env.SCAN_RATE_LIMIT_WINDOW_MS, 10) || 60 * 60 * 1000;
const scanLimiter = rateLimit({
  windowMs: scanRateLimitWindowMs,
  max: scanRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Rate limit exceeded. Maximum ${scanRateLimitMax} scans per window.` },
});

/**
 * Resolve a scan profile into concrete scanner ids + options.
 * @throws {Error} when the profile name is unknown
 */
function resolveScanRequest({ profile, scannerIds, options = {} }) {
  if (profile && !scannerIds) {
    const profileConfig = getProfile(profile);
    return {
      scannerIds: profileConfig.scannerIds,
      options: { ...profileConfig.options, ...options },
    };
  }
  return { scannerIds: scannerIds || null, options: { ...options } };
}

// Async job store — jobs run through the shared queue above.
const scanJobs = new ScanJobStore({
  getQueue,
  runScan: (url, opts) => pipeline.scan(url, opts),
});

// ── Routes ──────────────────────────────────────────────────────

/**
 * POST /api/scan
 * Run an accessibility scan against a URL.
 *
 * Body: { url: string, profile?: string, scannerIds?: string[],
 *         options?: object, sync?: boolean }
 *
 * Default (async):  202 { jobId, status, statusUrl } — poll /api/scan/job/:jobId
 * Legacy (sync:true): 200 <pipeline result>, connection held for the whole scan.
 */
app.post('/api/scan', scanLimiter, async (req, res) => {
  const { url, profile, scannerIds, options = {}, sync = false } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  // SSRF guard — must run before the URL reaches the browser.
  try {
    await assertScannableUrl(url);
  } catch (error) {
    if (error instanceof UrlGuardError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error('URL validation error:', error.message);
    return res.status(500).json({ error: 'URL validation failed' });
  }

  let resolved;
  try {
    resolved = resolveScanRequest({ profile, scannerIds, options });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const scanOptions = { scannerIds: resolved.scannerIds, ...resolved.options };

  if (sync === true) {
    try {
      const queue = await getQueue();
      const result = await queue.add(() => pipeline.scan(url, scanOptions));
      return res.json(result);
    } catch (error) {
      console.error('Scan error:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  const job = scanJobs.createJob(url, scanOptions);
  return res.status(202).json({
    jobId: job.id,
    status: job.status,
    statusUrl: `/api/scan/job/${job.id}`,
  });
});

/**
 * GET /api/scan/job/:jobId
 * Poll an async scan job.
 * → { jobId, status, queuePosition?, progress?, result?, error? }
 */
app.get('/api/scan/job/:jobId', (req, res) => {
  const jobId = requireSafeId(res, req.params.jobId, 'jobId');
  if (!jobId) return undefined;

  const payload = scanJobs.toPublic(jobId);
  if (!payload) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json(payload);
});

/**
 * POST /api/report
 * Generate a report from scan results.
 * Body: { scanResult: object, options?: { format: 'html'|'pdf', includePDF: boolean } }
 */
app.post('/api/report', async (req, res) => {
  const { scanResult, options = {} } = req.body;

  if (!scanResult) {
    return res.status(400).json({ error: 'scanResult is required' });
  }

  try {
    const report = await reportGenerator.generate(scanResult, options);
    res.json(report);
  } catch (error) {
    console.error('Report generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/report/:id
 * Retrieve a generated HTML report.
 */
app.get('/api/report/:id', async (req, res) => {
  const id = requireSafeId(res, req.params.id, 'report id');
  if (!id) return undefined;

  const htmlPath = path.join(reportsDir, `${id}.html`);
  if (await fs.pathExists(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).json({ error: 'Report not found' });
  }
});

/**
 * GET /api/report/:id/pdf
 * Retrieve a generated PDF report.
 */
app.get('/api/report/:id/pdf', async (req, res) => {
  const id = requireSafeId(res, req.params.id, 'report id');
  if (!id) return undefined;

  const pdfPath = path.join(reportsDir, `${id}.pdf`);
  if (await fs.pathExists(pdfPath)) {
    res.sendFile(pdfPath);
  } else {
    res.status(404).json({ error: 'PDF report not found' });
  }
});

/**
 * Catch-all for id-bearing routes with extra path segments — i.e. a raw
 * traversal attempt such as `/api/report/../../etc/passwd`, which express
 * would otherwise answer with its default HTML 404. Report the same 400 the id
 * validator produces for the percent-encoded form, so the response does not
 * depend on how the client encoded the payload.
 */
app.all(['/api/report/*', '/api/scan/job/*'], (req, res) => {
  res.status(400).json({ error: 'Invalid id: must match [a-zA-Z0-9_-]{1,64}' });
});

/**
 * GET /api/scanners
 * List all registered scanners with metadata.
 */
app.get('/api/scanners', (req, res) => {
  const scannerList = scanners.map((s) => ({
    id: s.id,
    wcagCriteria: s.wcagCriteria,
    wcagPrinciple: s.wcagPrinciple,
    needsExclusiveAccess: s.needsExclusiveAccess,
  }));
  res.json({ scanners: scannerList, total: scannerList.length });
});

/**
 * GET /api/health
 * Health check endpoint.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    scanners: pipeline.scanners.size,
    uptime: process.uptime(),
  });
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down...');
  await pipeline.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Accessibility checker server running on port ${port}`);
    console.log(`${pipeline.scanners.size} scanners registered`);
  });
}

module.exports = app;
