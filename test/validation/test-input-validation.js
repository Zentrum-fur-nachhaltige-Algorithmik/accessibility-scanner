const { InputValidator } = require('../../src/security/input-validator');

const URL_VALIDATION_TESTS = [
  // Valid URLs
  { input: 'https://example.com', expected: { valid: true }, description: 'Valid HTTPS URL' },
  { input: 'http://test-site.org/page', expected: { valid: true }, description: 'Valid HTTP URL with path' },
  
  // Invalid protocols
  { input: 'file:///etc/passwd', expected: { error: 'Invalid protocol: file:' }, description: 'File protocol blocked' },
  { input: 'javascript:alert(1)', expected: { error: 'Invalid protocol: javascript:' }, description: 'JavaScript protocol blocked' },
  { input: 'data:text/html,<script>alert(1)</script>', expected: { error: 'Invalid protocol: data:' }, description: 'Data protocol blocked' },
  
  // Internal/localhost IPs
  { input: 'http://127.0.0.1:8080/admin', expected: { error: 'Blocked internal host: 127.0.0.1' }, description: 'Localhost blocked' },
  { input: 'https://192.168.1.100/config', expected: { error: 'Blocked internal host: 192.168.1.100' }, description: 'Private IP blocked' },
  { input: 'http://10.0.0.1/dashboard', expected: { error: 'Blocked internal host: 10.0.0.1' }, description: 'RFC1918 IP blocked' },
  { input: 'http://169.254.169.254/metadata', expected: { error: 'Blocked internal host: 169.254.169.254' }, description: 'Link-local IP blocked' },
  
  // Dangerous ports
  { input: 'http://example.com:22', expected: { error: 'Blocked dangerous port: 22' }, description: 'SSH port blocked' },
  { input: 'http://example.com:3389', expected: { error: 'Blocked dangerous port: 3389' }, description: 'RDP port blocked' },
];

async function runUrlValidationTests() {
  console.log('🔍 Running URL Validation Tests...');
  let passed = 0, failed = 0;
  
  for (const test of URL_VALIDATION_TESTS) {
    try {
      const result = InputValidator.validateUrl(test.input);
      
      if (test.expected.valid && result.valid) {
        console.log(`✅ ${test.description}: PASS`);
        passed++;
      } else {
        console.log(`❌ ${test.description}: FAIL - Expected error but got success`);
        failed++;
      }
    } catch (error) {
      if (test.expected.error && error.message.includes(test.expected.error)) {
        console.log(`✅ ${test.description}: PASS`);
        passed++;
      } else {
        console.log(`❌ ${test.description}: FAIL - ${error.message}`);
        failed++;
      }
    }
  }
  
  console.log(`\n📊 URL Validation Results: ${passed} passed, ${failed} failed`);
  return { passed, failed, total: URL_VALIDATION_TESTS.length };
}

module.exports = { runUrlValidationTests };