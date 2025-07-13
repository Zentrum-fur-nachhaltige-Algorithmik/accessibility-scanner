const axios = require('axios');

/**
 * Test script for the Interactive Accessibility Report API
 * Tests with beeproduced.com as requested
 */

const API_BASE = 'http://localhost:3001';

async function testBeeproducedScan() {
  console.log('🚀 Testing Interactive Accessibility Report API with beeproduced.com');
  console.log('');

  try {
    // Test health endpoint first
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${API_BASE}/api/health`);
    console.log('✅ Health check:', healthResponse.data.status);
    console.log('');

    // Start the scan
    console.log('2. Starting accessibility scan for beeproduced.com...');
    const scanStart = Date.now();
    
    const scanResponse = await axios.post(`${API_BASE}/api/scan`, {
      url: 'https://beeproduced.com',
      options: {
        width: 1920,
        height: 1080
      }
    });

    const scanDuration = Date.now() - scanStart;
    console.log(`✅ Scan completed in ${scanDuration}ms`);
    console.log('');

    // Display results
    const result = scanResponse.data;
    console.log('📊 Scan Results:');
    console.log(`   Report ID: ${result.reportId}`);
    console.log(`   URL: ${result.scanMetadata.url}`);
    console.log(`   Accessibility Score: ${result.accessibility.score}/100`);
    console.log(`   Total Violations: ${result.scanMetadata.violationsFound}`);
    console.log(`   Elements Affected: ${result.scanMetadata.elementsAffected}`);
    console.log('');
    
    console.log('🔍 Violation Breakdown:');
    console.log(`   Critical: ${result.accessibility.critical}`);
    console.log(`   Serious: ${result.accessibility.serious}`);
    console.log(`   Moderate: ${result.accessibility.moderate}`);
    console.log(`   Minor: ${result.accessibility.minor}`);
    console.log('');

    console.log(`🌐 Interactive Report URL: ${result.reportUrl}`);
    console.log(`📁 Local Path: ${result.localPath}`);
    console.log('');

    // Test reports list endpoint
    console.log('3. Testing reports list endpoint...');
    const reportsResponse = await axios.get(`${API_BASE}/api/reports`);
    console.log(`✅ Found ${reportsResponse.data.count} total reports`);
    console.log('');

    // Test specific report endpoint
    console.log('4. Testing specific report endpoint...');
    const reportResponse = await axios.get(`${API_BASE}/api/reports/${result.reportId}`);
    console.log(`✅ Retrieved specific report: ${reportResponse.data.reportId}`);
    console.log('');

    console.log('🎉 All API tests passed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log(`1. Open the report in your browser: ${result.reportUrl}`);
    console.log('2. Click on violation markers to see enhanced fix suggestions');
    console.log('3. Test the copy-to-clipboard functionality');
    console.log('4. Try the before/after code comparisons');
    
    return result;

  } catch (error) {
    console.error('❌ Error during API test:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    console.error('');
    console.error('💡 Make sure the API server is running:');
    console.error('   node src/interactive-report-api.js');
    
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testBeeproducedScan()
    .then(() => {
      console.log('');
      console.log('✅ Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('');
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testBeeproducedScan };