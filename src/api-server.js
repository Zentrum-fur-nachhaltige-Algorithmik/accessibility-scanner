const express = require('express');
const cors = require('cors');
const path = require('path');
const AccessibilityScanner = require('./scanner');
const EnhancedAccessibilityScanner = require('./enhanced-scanner');
const ScreenReaderScanner = require('./screen-reader-scanner');
const ReportGenerator = require('./report-generator');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const basicScanner = new AccessibilityScanner();
const enhancedScanner = new EnhancedAccessibilityScanner();
const screenReaderScanner = new ScreenReaderScanner();
const reportGenerator = new ReportGenerator();

app.post('/api/scan', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await basicScanner.scanWebpage(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/enhanced-scan', async (req, res) => {
  try {
    const { url, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await enhancedScanner.enhancedScan(url, options);
    res.json(result);
  } catch (error) {
    console.error('Enhanced scan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/screen-reader-scan', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await screenReaderScanner.screenReaderAnalysis(url);
    res.json(result);
  } catch (error) {
    console.error('Screen reader scan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Report generation and management endpoints
app.post('/api/generate-report', async (req, res) => {
  try {
    const { scanData, options = {} } = req.body;
    
    if (!scanData) {
      return res.status(400).json({ error: 'Scan data is required' });
    }

    const report = await reportGenerator.generateReport(scanData, options);
    res.json(report);
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

app.get('/api/report/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await reportGenerator.getReport(reportId);
    
    if (!report.htmlPath) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const fs = require('fs');
    const htmlContent = fs.readFileSync(report.htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Report retrieval error:', error);
    res.status(404).json({ error: 'Report not found' });
  }
});

app.get('/api/report/:reportId/pdf', async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await reportGenerator.getReport(reportId);
    
    if (!report.pdfPath) {
      return res.status(404).json({ error: 'PDF report not found' });
    }

    const fs = require('fs');
    const pdfBuffer = fs.readFileSync(report.pdfPath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="accessibility-report-${reportId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF retrieval error:', error);
    res.status(404).json({ error: 'PDF report not found' });
  }
});

app.get('/api/report/:reportId/data', async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await reportGenerator.getReport(reportId);
    res.json(report.metadata);
  } catch (error) {
    console.error('Report data retrieval error:', error);
    res.status(404).json({ error: 'Report not found' });
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const reports = await reportGenerator.listReports(limit);
    res.json(reports);
  } catch (error) {
    console.error('Reports listing error:', error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

app.delete('/api/report/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const success = await reportGenerator.deleteReport(reportId);
    
    if (success) {
      res.json({ message: 'Report deleted successfully' });
    } else {
      res.status(404).json({ error: 'Report not found' });
    }
  } catch (error) {
    console.error('Report deletion error:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Webhook support for async scanning
app.post('/api/scan-async', async (req, res) => {
  try {
    const { url, webhook, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Generate a scan ID immediately
    const { v4: uuidv4 } = require('uuid');
    const scanId = uuidv4();
    
    // Return the scan ID immediately
    res.json({ 
      scanId, 
      status: 'processing',
      message: 'Scan started, results will be available shortly',
      statusUrl: `/api/scan-status/${scanId}`
    });

    // Process the scan asynchronously
    processAsyncScan(scanId, url, webhook, options);
    
  } catch (error) {
    console.error('Async scan error:', error);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

app.get('/api/scan-status/:scanId', async (req, res) => {
  try {
    const { scanId } = req.params;
    
    // Try to find the report
    try {
      const report = await reportGenerator.getReport(scanId);
      res.json({
        scanId,
        status: 'completed',
        reportUrl: `/api/report/${scanId}`,
        pdfUrl: report.pdfPath ? `/api/report/${scanId}/pdf` : null
      });
    } catch (error) {
      // Report not found, scan might still be processing
      res.json({
        scanId,
        status: 'processing',
        message: 'Scan is still in progress'
      });
    }
  } catch (error) {
    console.error('Scan status error:', error);
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

async function processAsyncScan(scanId, url, webhook, options) {
  try {
    let scanResult;
    
    // Choose scanner based on options
    if (options.scanType === 'screen-reader') {
      scanResult = await screenReaderScanner.screenReaderAnalysis(url);
    } else if (options.scanType === 'basic') {
      scanResult = await basicScanner.scanWebpage(url);
    } else {
      scanResult = await enhancedScanner.enhancedScan(url, options);
    }

    // Generate report with the scan ID
    scanResult.id = scanId;
    const reportOptions = {
      format: options.format || 'html',
      includePDF: options.includePDF || false
    };
    
    await reportGenerator.generateReport(scanResult, reportOptions);
    
    // Send webhook notification if provided
    if (webhook) {
      const webhookData = {
        scanId,
        status: 'completed',
        url,
        reportUrl: `/api/report/${scanId}`,
        summary: {
          score: scanResult.accessibilityScore,
          violations: scanResult.violations ? scanResult.violations.length : 0,
          passes: scanResult.passes || 0
        }
      };
      
      // Send webhook (fire and forget)
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookData)
      }).catch(error => {
        console.error('Webhook delivery failed:', error);
      });
    }
    
  } catch (error) {
    console.error('Async scan processing error:', error);
    
    // Send error webhook if provided
    if (webhook) {
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanId,
          status: 'failed',
          error: error.message
        })
      }).catch(() => {}); // Ignore webhook delivery errors
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    version: '2.0.0',
    features: ['basic-scan', 'enhanced-scan', 'screen-reader-scan', 'wcag-compliance', 'keyboard-navigation', 'eu-compliance', 'pdf-reports', 'html-reports', 'async-scanning', 'webhooks']
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/.next/static')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/.next/server/pages/index.html'));
  });
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Enhanced accessibility scanner server running on port ${port}`);
    console.log('API endpoints:');
    console.log('  Scanning:');
    console.log('    POST /api/scan - Basic accessibility scan');
    console.log('    POST /api/enhanced-scan - Enhanced scan with WCAG categorization');
    console.log('    POST /api/screen-reader-scan - Screen reader focused analysis');
    console.log('    POST /api/scan-async - Async scan with webhook support');
    console.log('    GET  /api/scan-status/:scanId - Check async scan status');
    console.log('  Reports:');
    console.log('    POST /api/generate-report - Generate HTML/PDF report');
    console.log('    GET  /api/report/:reportId - View HTML report');
    console.log('    GET  /api/report/:reportId/pdf - Download PDF report');
    console.log('    GET  /api/report/:reportId/data - Get report data JSON');
    console.log('    GET  /api/reports - List all reports');
    console.log('    DELETE /api/report/:reportId - Delete report');
    console.log('  System:');
    console.log('    GET  /api/health - Health check');
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await basicScanner.close();
    await enhancedScanner.close();
    await screenReaderScanner.close();
    process.exit(0);
  });
}

module.exports = { app, basicScanner, enhancedScanner, screenReaderScanner };