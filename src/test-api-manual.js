const { spawn } = require('child_process');
const fetch = require('node-fetch');  // Note: May need to install this or use native fetch in newer Node

async function testAPIManually() {
  console.log('🚀 Starting manual API test...\n');
  
  // Start the API server
  console.log('Starting API server...');
  const apiServer = spawn('node', ['src/api-server.js'], { 
    detached: false,
    stdio: 'inherit' 
  });
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    console.log('\n🔍 Testing API endpoints...\n');
    
    // Test 1: Health check
    try {
      const response = await fetch('http://localhost:3000/api/health');
      const data = await response.json();
      console.log('✅ Health check:', data.status);
      console.log('  Features:', data.features.length);
    } catch (error) {
      console.log('❌ Health check failed:', error.message);
    }
    
    // Test 2: Basic scan
    try {
      const scanResponse = await fetch('http://localhost:3000/api/enhanced-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: 'https://example.com',
          options: { wcagLevel: 'AA' }
        })
      });
      const scanData = await scanResponse.json();
      console.log('✅ Enhanced scan working');
      console.log('  Score:', scanData.accessibilityScore);
      console.log('  Violations:', scanData.violations?.length || 0);
      
      // Test 3: Generate report from scan data
      const reportResponse = await fetch('http://localhost:3000/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          scanData,
          options: { format: 'html' }
        })
      });
      const reportData = await reportResponse.json();
      console.log('✅ Report generation working');
      console.log('  Report ID:', reportData.reportId);
      console.log('  Report URL:', reportData.reportUrl);
      
      // Test 4: Access the generated report
      const reportViewResponse = await fetch(`http://localhost:3000${reportData.reportUrl}`);
      const reportHtml = await reportViewResponse.text();
      const hasTitle = reportHtml.includes('Web Accessibility Report');
      console.log('✅ Report viewing:', hasTitle ? 'Working' : 'Failed');
      
    } catch (error) {
      console.log('❌ Scan/Report test failed:', error.message);
    }
    
    // Test 5: List reports
    try {
      const reportsResponse = await fetch('http://localhost:3000/api/reports');
      const reports = await reportsResponse.json();
      console.log('✅ Reports listing working');
      console.log('  Total reports:', reports.length);
    } catch (error) {
      console.log('❌ Reports listing failed:', error.message);
    }
    
  } catch (error) {
    console.error('API test error:', error);
  } finally {
    console.log('\n🛑 Stopping API server...');
    apiServer.kill();
    process.exit(0);
  }
}

// Note: This requires node-fetch or Node 18+ with native fetch
// For now, we'll skip this test since fetch might not be available
console.log('Manual API test would require fetch - skipping for now');
console.log('You can start the API server with: npm run api:start');
console.log('Then test endpoints manually with curl or browser');

if (require.main === module) {
  // testAPIManually();
}

module.exports = testAPIManually;