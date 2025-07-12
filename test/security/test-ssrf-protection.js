const { InputValidator } = require('../../src/security/input-validator');

const SSRF_TEST_CASES = [
  { url: 'http://127.0.0.1:8080/admin', expectBlocked: true, description: 'Local admin endpoint blocked' },
  { url: 'http://192.168.1.1/router-config', expectBlocked: true, description: 'Router config blocked' },
  { url: 'http://169.254.169.254/latest/meta-data/', expectBlocked: true, description: 'AWS metadata blocked' },
  { url: 'http://metadata.google.internal/computeMetadata/v1/', expectBlocked: true, description: 'GCP metadata blocked' },
  { url: 'https://httpbin.org/get', expectBlocked: false, description: 'Valid external URL allowed' },
];

async function runSsrfProtectionTests() {
  console.log('🛡️ Running SSRF Protection Tests...');
  let passed = 0, failed = 0;
  
  for (const test of SSRF_TEST_CASES) {
    try {
      const result = InputValidator.validateUrl(test.url);
      
      if (!test.expectBlocked && result.valid) {
        console.log(`✅ ${test.description}: PASS (URL allowed)`);
        passed++;
      } else if (!test.expectBlocked) {
        console.log(`❌ ${test.description}: FAIL - Expected URL to be allowed but was blocked`);
        failed++;
      } else {
        console.log(`❌ ${test.description}: FAIL - Expected URL to be blocked but was allowed`);
        failed++;
      }
    } catch (error) {
      if (test.expectBlocked) {
        console.log(`✅ ${test.description}: PASS (Blocked as expected)`);
        passed++;
      } else {
        console.log(`❌ ${test.description}: FAIL - ${error.message}`);
        failed++;
      }
    }
  }
  
  console.log(`\n📊 SSRF Protection Results: ${passed} passed, ${failed} failed`);
  return { passed, failed, total: SSRF_TEST_CASES.length };
}

module.exports = { runSsrfProtectionTests };