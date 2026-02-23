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

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());

// Serve reports directory
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

// Rate limiter for scan endpoint (5 requests per hour per IP)
const scanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Maximum 5 scans per hour.' },
});

// ── Routes ──────────────────────────────────────────────────────

/**
 * POST /api/scan
 * Run accessibility scan against a URL.
 * Body: { url: string, scannerIds?: string[], options?: object }
 */
app.post('/api/scan', scanLimiter, async (req, res) => {
  const { url, profile, scannerIds, options = {} } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    let resolvedScannerIds = scannerIds || null;
    let mergedOptions = { ...options };

    // Resolve profile if provided and no explicit scannerIds
    if (profile && !scannerIds) {
      const profileConfig = getProfile(profile);
      resolvedScannerIds = profileConfig.scannerIds;
      mergedOptions = { ...profileConfig.options, ...options };
    }

    const queue = await getQueue();
    const result = await queue.add(() =>
      pipeline.scan(url, { scannerIds: resolvedScannerIds, ...mergedOptions })
    );
    res.json(result);
  } catch (error) {
    console.error('Scan error:', error.message);
    res.status(500).json({ error: error.message });
  }
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
  const htmlPath = path.join(reportsDir, `${req.params.id}.html`);
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
  const pdfPath = path.join(reportsDir, `${req.params.id}.pdf`);
  if (await fs.pathExists(pdfPath)) {
    res.sendFile(pdfPath);
  } else {
    res.status(404).json({ error: 'PDF report not found' });
  }
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
