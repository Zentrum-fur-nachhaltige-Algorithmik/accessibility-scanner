const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');
const axe = require('axe-core');
const InteractiveReportGenerator = require('./interactive-report-generator');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../reports')));

// CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * API endpoint to generate interactive accessibility reports
 */
app.post('/api/scan', async (req, res) => {
  const { url, options = {} } = req.body;
  
  if (!url) {
    return res.status(400).json({
      error: 'URL is required',
      message: 'Please provide a valid URL to scan'
    });
  }

  console.log(`🚀 Starting accessibility scan for: ${url}`);
  
  let browser;
  let scanStartTime = Date.now();
  
  try {
    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    // Set viewport for consistent screenshots
    await page.setViewport({
      width: options.width || 1920,
      height: options.height || 1080,
      deviceScaleFactor: 1
    });

    // Navigate to the URL
    console.log(`📄 Loading page: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to be fully loaded
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Inject axe-core and run accessibility scan
    console.log('🔍 Running accessibility scan...');
    await page.addScriptTag({
      path: path.join(__dirname, '../node_modules/axe-core/axe.min.js')
    });

    const violations = await page.evaluate(async () => {
      const results = await axe.run();
      return results.violations;
    });

    console.log(`📊 Found ${violations.length} violation types affecting ${violations.reduce((sum, v) => sum + v.nodes.length, 0)} elements`);

    // Generate interactive report
    const reportGenerator = new InteractiveReportGenerator();
    const scanMetadata = {
      url,
      timestamp: new Date().toISOString(),
      scanDuration: Date.now() - scanStartTime,
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: await page.viewport(),
      options
    };

    const report = await reportGenerator.generateInteractiveReport(
      page,
      violations,
      scanMetadata,
      options
    );

    await browser.close();

    // Build response with report URL
    const reportUrl = `http://localhost:${PORT}/reports/${report.reportId}/index.html`;
    const apiResponse = {
      success: true,
      reportId: report.reportId,
      reportUrl,
      localPath: report.htmlPath,
      scanMetadata: {
        url,
        timestamp: report.timestamp,
        scanDuration: scanMetadata.scanDuration,
        violationsFound: violations.length,
        elementsAffected: violations.reduce((sum, v) => sum + v.nodes.length, 0)
      },
      summary: report.summary,
      accessibility: {
        score: report.summary.accessibilityScore,
        critical: report.summary.critical,
        serious: report.summary.serious,
        moderate: report.summary.moderate,
        minor: report.summary.minor
      }
    };

    console.log(`✅ Interactive report generated successfully: ${report.reportId}`);
    console.log(`🌐 View report at: ${reportUrl}`);
    
    res.json(apiResponse);

  } catch (error) {
    if (browser) {
      await browser.close();
    }

    console.error('❌ Error during accessibility scan:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      scanDuration: Date.now() - scanStartTime
    });
  }
});

/**
 * Get list of available reports
 */
app.get('/api/reports', async (req, res) => {
  try {
    const reportsDir = path.join(__dirname, '../reports');
    const reportDirs = await fs.readdir(reportsDir);
    
    const reports = [];
    for (const dir of reportDirs) {
      const reportPath = path.join(reportsDir, dir);
      const stat = await fs.stat(reportPath);
      
      if (stat.isDirectory() && dir.startsWith('interactive-')) {
        try {
          const metadataPath = path.join(reportPath, 'data', 'metadata.json');
          const metadata = await fs.readJson(metadataPath);
          
          reports.push({
            id: dir,
            ...metadata,
            reportUrl: `http://localhost:${PORT}/reports/${dir}/index.html`,
            createdAt: stat.birthtime
          });
        } catch (err) {
          console.warn(`Warning: Could not read metadata for report ${dir}`);
        }
      }
    }
    
    // Sort by creation time (newest first)
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({
      success: true,
      reports,
      count: reports.length
    });
    
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get specific report metadata
 */
app.get('/api/reports/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const reportPath = path.join(__dirname, '../reports', reportId);
    
    if (!await fs.pathExists(reportPath)) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }
    
    const metadataPath = path.join(reportPath, 'data', 'metadata.json');
    const violationsPath = path.join(reportPath, 'data', 'violations.json');
    
    const metadata = await fs.readJson(metadataPath);
    const violations = await fs.readJson(violationsPath);
    
    res.json({
      success: true,
      reportId,
      reportUrl: `http://localhost:${PORT}/reports/${reportId}/index.html`,
      metadata,
      violations: violations.length,
      summary: metadata.summary
    });
    
  } catch (error) {
    console.error('Error fetching report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Interactive Accessibility Report API',
    version: '1.0.0'
  });
});

/**
 * API documentation endpoint
 */
app.get('/api/docs', (req, res) => {
  res.json({
    name: 'Interactive Accessibility Report API',
    version: '1.0.0',
    description: 'Generate interactive accessibility reports with visual violation mapping',
    endpoints: {
      'POST /api/scan': {
        description: 'Generate accessibility report for a URL',
        body: {
          url: 'string (required) - URL to scan',
          options: {
            width: 'number - Viewport width (default: 1920)',
            height: 'number - Viewport height (default: 1080)'
          }
        }
      },
      'GET /api/reports': {
        description: 'List all generated reports'
      },
      'GET /api/reports/:reportId': {
        description: 'Get specific report metadata'
      },
      'GET /api/health': {
        description: 'Health check endpoint'
      }
    },
    examples: {
      scan: {
        url: 'POST /api/scan',
        body: {
          url: 'https://beeproduced.com',
          options: {
            width: 1920,
            height: 1080
          }
        }
      }
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Interactive Accessibility Report API running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`📄 Example scan: POST http://localhost:${PORT}/api/scan`);
  console.log('');
  console.log('📝 Example request:');
  console.log(`curl -X POST http://localhost:${PORT}/api/scan -H "Content-Type: application/json" -d '{"url": "https://beeproduced.com"}'`);
});

module.exports = app;