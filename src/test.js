const AccessibilityScanner = require('./scanner');

async function runTests() {
  const scanner = new AccessibilityScanner();
  
  console.log('Running Phase 1 Test Cases...\n');

  try {
    console.log('=== Test 1: Valid URL Scan ===');
    console.log('Testing with: https://example.com');
    const test1 = await scanner.scanWebpage('https://example.com');
    console.log('Result:', {
      url: test1.url,
      accessibilityScore: test1.accessibilityScore,
      violationsCount: test1.violations.length,
      passes: test1.passes,
      pageTitle: test1.pageTitle,
      hasError: !!test1.error
    });
    console.log('✓ Test 1 completed\n');

    console.log('=== Test 2: Invalid URL ===');
    console.log('Testing with: not-a-valid-url');
    const test2 = await scanner.scanWebpage('not-a-valid-url');
    console.log('Result:', {
      url: test2.url,
      accessibilityScore: test2.accessibilityScore,
      violationsCount: test2.violations.length,
      passes: test2.passes,
      pageTitle: test2.pageTitle,
      error: test2.error
    });
    console.log('✓ Test 2 completed\n');

    console.log('=== Test 3: Unreachable URL ===');
    console.log('Testing with: https://this-domain-does-not-exist-12345.com');
    const test3 = await scanner.scanWebpage('https://this-domain-does-not-exist-12345.com');
    console.log('Result:', {
      url: test3.url,
      accessibilityScore: test3.accessibilityScore,
      violationsCount: test3.violations.length,
      passes: test3.passes,
      pageTitle: test3.pageTitle,
      error: test3.error
    });
    console.log('✓ Test 3 completed\n');

    console.log('=== Performance Test ===');
    const startTime = Date.now();
    await scanner.scanWebpage('https://example.com');
    const duration = Date.now() - startTime;
    console.log(`Scan completed in ${duration}ms`);
    console.log(`✓ Performance requirement: ${duration < 30000 ? 'PASSED' : 'FAILED'} (< 30 seconds)`);

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await scanner.close();
    console.log('\nAll tests completed!');
  }
}

if (require.main === module) {
  runTests();
}

module.exports = runTests;