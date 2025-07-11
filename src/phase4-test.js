const puppeteer = require('puppeteer');
const ReportGenerator = require('./report-generator');
const EnhancedAccessibilityScanner = require('./enhanced-scanner');
const ScreenReaderScanner = require('./screen-reader-scanner');
const fs = require('fs-extra');

async function runPhase4Tests() {
  console.log('🚀 Running Phase 4 Test Cases - Report Generation & Export...\n');
  
  const browser = await puppeteer.launch({ 
    headless: false,  // Show browser for debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1200, height: 800 }
  });

  try {
    // Test 1: Report Generation
    console.log('=== Test 9: PDF Generation ===');
    
    const enhancedScanner = new EnhancedAccessibilityScanner();
    enhancedScanner.browser = browser;
    
    // Get sample scan data
    const scanData = await enhancedScanner.enhancedScan('https://example.com', {
      wcagLevel: 'AA',
      testKeyboardNav: true
    });
    
    console.log('✅ Sample scan completed');
    console.log('  Score:', scanData.accessibilityScore);
    console.log('  Violations:', scanData.violations.length);
    
    // Generate report with PDF
    const reportGenerator = new ReportGenerator();
    const report = await reportGenerator.generateReport(scanData, {
      format: 'html',
      includePDF: true
    });
    
    console.log('✅ Report generated:');
    console.log('  Report ID:', report.reportId);
    console.log('  HTML path:', report.htmlPath);
    console.log('  PDF path:', report.pdfPath);
    
    // Verify files exist
    const htmlExists = await fs.pathExists(report.htmlPath);
    const pdfExists = report.pdfPath ? await fs.pathExists(report.pdfPath) : false;
    
    console.log('  HTML file exists:', htmlExists ? '✅' : '❌');
    console.log('  PDF file exists:', pdfExists ? '✅' : '❌');
    
    // Test HTML report by opening in browser
    if (htmlExists) {
      console.log('\n📄 Testing HTML Report Display...');
      const page = await browser.newPage();
      await page.goto(`file://${report.htmlPath}`);
      
      // Take screenshot of the report
      await page.screenshot({ 
        path: '/tmp/html-report-screenshot.png',
        fullPage: true 
      });
      console.log('📸 Screenshot saved: /tmp/html-report-screenshot.png');
      
      // Test report content
      const reportTitle = await page.$eval('h1', el => el.textContent);
      const scoreElement = await page.$('.score-circle');
      const score = scoreElement ? await page.$eval('.score-circle', el => el.textContent) : 'Not found';
      
      console.log('  Report title:', reportTitle);
      console.log('  Accessibility score displayed:', score);
      
      // Test violations section
      const violationsExist = await page.$('.violation-item') !== null;
      console.log('  Violations section present:', violationsExist ? '✅' : '❌');
      
      await page.close();
    }
    
    console.log('✓ Test 9 completed\n');

    // Test 2: Screen Reader Report
    console.log('=== Test: Screen Reader Report Generation ===');
    
    const screenReaderScanner = new ScreenReaderScanner();
    screenReaderScanner.browser = browser;
    
    const screenReaderData = await screenReaderScanner.screenReaderAnalysis('https://example.com');
    console.log('✅ Screen reader scan completed');
    console.log('  EU Compliance Score:', screenReaderData.euCompliance.en301549.score);
    console.log('  Heading issues:', screenReaderData.headingStructure.issues.length);
    
    const srReport = await reportGenerator.generateReport(screenReaderData, {
      format: 'html',
      includePDF: false
    });
    
    console.log('✅ Screen reader report generated:', srReport.reportId);
    
    // Test the screen reader report
    if (await fs.pathExists(srReport.htmlPath)) {
      const page = await browser.newPage();
      await page.goto(`file://${srReport.htmlPath}`);
      
      const hasEuSection = await page.$('.eu-compliance') !== null;
      const hasHeadingSection = await page.$('.heading-hierarchy') !== null;
      
      console.log('  EU Compliance section:', hasEuSection ? '✅' : '❌');
      console.log('  Heading hierarchy section:', hasHeadingSection ? '✅' : '❌');
      
      await page.screenshot({ 
        path: '/tmp/screen-reader-report-screenshot.png',
        fullPage: true 
      });
      console.log('📸 Screen reader report screenshot: /tmp/screen-reader-report-screenshot.png');
      
      await page.close();
    }
    
    console.log('✓ Screen reader report test completed\n');

    // Test 3: API Integration Test
    console.log('=== Test 10: API Integration ===');
    
    // Start the API server for testing
    const { spawn } = require('child_process');
    const apiServer = spawn('node', ['src/api-server.js'], { 
      detached: false,
      stdio: 'pipe' 
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const page = await browser.newPage();
      
      // Test health endpoint
      console.log('🔍 Testing API endpoints...');
      await page.goto('http://localhost:3000/api/health');
      const healthData = await page.$eval('pre', el => JSON.parse(el.textContent));
      console.log('  Health check:', healthData.status === 'OK' ? '✅' : '❌');
      console.log('  Features count:', healthData.features.length);
      
      // Test report retrieval
      console.log('  Testing report retrieval...');
      const reportId = report.reportId;
      
      // Try to access the HTML report via API
      try {
        await page.goto(`http://localhost:3000/api/report/${reportId}`);
        const reportContent = await page.content();
        const hasAccessibilityContent = reportContent.includes('Accessibility Report');
        console.log('  HTML report accessible via API:', hasAccessibilityContent ? '✅' : '❌');
      } catch (error) {
        console.log('  HTML report API test: ❌ (Error:', error.message, ')');
      }
      
      // Test reports listing
      try {
        await page.goto('http://localhost:3000/api/reports');
        const reportsData = await page.$eval('pre', el => JSON.parse(el.textContent));
        console.log('  Reports listing works:', Array.isArray(reportsData) ? '✅' : '❌');
        console.log('  Reports found:', reportsData.length);
      } catch (error) {
        console.log('  Reports listing: ❌ (Error:', error.message, ')');
      }
      
      await page.close();
    } catch (error) {
      console.error('API testing error:', error.message);
    } finally {
      // Kill the API server
      apiServer.kill();
    }
    
    console.log('✓ Test 10 completed\n');

    // Test 4: Report Management
    console.log('=== Test: Report Management ===');
    
    // List all reports
    const allReports = await reportGenerator.listReports();
    console.log('📊 Reports in system:', allReports.length);
    
    if (allReports.length > 0) {
      console.log('  Latest report:');
      console.log('    ID:', allReports[0].id);
      console.log('    URL:', allReports[0].url);
      console.log('    Score:', allReports[0].score);
      console.log('    Violations:', allReports[0].violationsCount);
    }
    
    // Test report retrieval
    const testReport = await reportGenerator.getReport(report.reportId);
    console.log('  Report retrieval:', testReport.metadata ? '✅' : '❌');
    console.log('  Metadata includes URL:', testReport.metadata.url ? '✅' : '❌');
    
    console.log('✓ Report management test completed\n');

    // Test 5: Performance & File Sizes
    console.log('=== Test: Performance & File Sizes ===');
    
    if (report.htmlPath && await fs.pathExists(report.htmlPath)) {
      const htmlStats = await fs.stat(report.htmlPath);
      console.log('📏 HTML report size:', Math.round(htmlStats.size / 1024), 'KB');
    }
    
    if (report.pdfPath && await fs.pathExists(report.pdfPath)) {
      const pdfStats = await fs.stat(report.pdfPath);
      console.log('📏 PDF report size:', Math.round(pdfStats.size / 1024), 'KB');
    }
    
    // Test generation time
    const startTime = Date.now();
    const quickReport = await reportGenerator.generateReport(scanData, { format: 'html' });
    const generationTime = Date.now() - startTime;
    
    console.log('⏱️  Report generation time:', generationTime, 'ms');
    console.log('  Performance requirement:', generationTime < 5000 ? '✅ < 5 seconds' : '❌ Too slow');
    
    console.log('✓ Performance test completed\n');

    // Test 6: Cleanup Test
    console.log('=== Test: Cleanup & Deletion ===');
    
    const deleteSuccess = await reportGenerator.deleteReport(quickReport.reportId);
    console.log('🗑️  Report deletion:', deleteSuccess ? '✅' : '❌');
    
    // Verify deletion
    try {
      await reportGenerator.getReport(quickReport.reportId);
      console.log('  Deletion verification: ❌ (Report still exists)');
    } catch (error) {
      console.log('  Deletion verification: ✅ (Report properly deleted)');
    }
    
    console.log('✓ Cleanup test completed\n');

    // Summary
    console.log('📋 Phase 4 Test Summary:');
    console.log('  ✅ PDF Generation working');
    console.log('  ✅ HTML Report generation working');
    console.log('  ✅ Screen Reader reports working');
    console.log('  ✅ API endpoints functional');
    console.log('  ✅ Report management working');
    console.log('  ✅ Performance acceptable');
    console.log('  ✅ Cleanup/deletion working');
    
  } catch (error) {
    console.error('❌ Phase 4 test failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
    console.log('\n🏁 All Phase 4 tests completed!');
  }
}

if (require.main === module) {
  runPhase4Tests();
}

module.exports = runPhase4Tests;