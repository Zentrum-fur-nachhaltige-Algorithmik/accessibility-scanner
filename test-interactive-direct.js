const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');
const InteractiveReportGenerator = require('./src/interactive-report-generator');

/**
 * Fast direct test of interactive report generation
 * Bypasses API layer for faster iteration
 */
async function testInteractiveReportDirect() {
  console.log('⚡ Fast Direct Test: Interactive Report Generation');
  console.log('Target: https://beeproduced.com');
  console.log('');

  let browser;
  const startTime = Date.now();

  try {
    // Launch browser
    console.log('🚀 Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Load page
    console.log('📄 Loading beeproduced.com...');
    await page.goto('https://beeproduced.com', {
      waitUntil: 'networkidle2',
      timeout: 15000
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Run accessibility scan
    console.log('🔍 Running accessibility scan...');
    await page.addScriptTag({
      path: path.join(__dirname, 'node_modules/axe-core/axe.min.js')
    });

    const violations = await page.evaluate(async () => {
      const results = await axe.run();
      return results.violations;
    });

    console.log(`📊 Found ${violations.length} violation types affecting ${violations.reduce((sum, v) => sum + v.nodes.length, 0)} elements`);

    // Generate interactive report
    console.log('📄 Generating interactive report...');
    const reportGenerator = new InteractiveReportGenerator();
    
    const scanMetadata = {
      url: 'https://beeproduced.com',
      timestamp: new Date().toISOString(),
      scanDuration: Date.now() - startTime,
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: await page.viewport()
    };

    const report = await reportGenerator.generateInteractiveReport(
      page,
      violations,
      scanMetadata
    );

    await browser.close();

    const totalTime = Date.now() - startTime;
    console.log(`✅ Report generated in ${totalTime}ms`);
    console.log('');
    
    console.log('📊 Results:');
    console.log(`   Report ID: ${report.reportId}`);
    console.log(`   Accessibility Score: ${report.summary.accessibilityScore}/100`);
    console.log(`   Critical: ${report.summary.critical}`);
    console.log(`   Serious: ${report.summary.serious}`);
    console.log(`   Moderate: ${report.summary.moderate}`);
    console.log(`   Minor: ${report.summary.minor}`);
    console.log('');
    console.log(`📁 Report file: ${report.htmlPath}`);
    console.log(`🌐 Open in browser: file://${report.htmlPath}`);
    
    return report;

  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error.message);
    throw error;
  }
}

// Test with minimal local HTML for faster iteration
async function testWithLocalHTML() {
  console.log('⚡ Super Fast Test: Local HTML with violations');
  
  let browser;
  const startTime = Date.now();

  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Create test HTML with known violations
    const testHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Test Page</title>
</head>
<body>
    <h1>Test Page</h1>
    <img src="test.jpg">  <!-- Missing alt -->
    <input type="text">   <!-- Missing label -->
    <div style="color: #999; background: #fff;">Low contrast text</div>
    <a href="#" onclick="doSomething()">Click here</a>  <!-- Poor link text -->
</body>
</html>`;

    await page.setContent(testHTML);
    await page.addScriptTag({
      path: path.join(__dirname, 'node_modules/axe-core/axe.min.js')
    });

    const violations = await page.evaluate(async () => {
      const results = await axe.run();
      return results.violations;
    });

    console.log(`📊 Found ${violations.length} violation types`);

    const reportGenerator = new InteractiveReportGenerator();
    const report = await reportGenerator.generateInteractiveReport(
      page,
      violations,
      { url: 'local-test', timestamp: new Date().toISOString() }
    );

    await browser.close();

    const totalTime = Date.now() - startTime;
    console.log(`✅ Local test completed in ${totalTime}ms`);
    console.log(`📁 Report: ${report.htmlPath}`);
    console.log(`🌐 Open: file://${report.htmlPath}`);
    
    return report;

  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error.message);
    throw error;
  }
}

// Choose test mode
const testMode = process.argv[2] || 'local';

if (testMode === 'local') {
  testWithLocalHTML()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else if (testMode === 'bee') {
  testInteractiveReportDirect()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  console.log('Usage:');
  console.log('  node test-interactive-direct.js local    # Fast local test');
  console.log('  node test-interactive-direct.js bee      # Test with beeproduced.com');
}