const EnhancedAccessibilityScanner = require('./src/enhanced-scanner');

async function debugPhase6DResults() {
  console.log('Debugging Phase 6D Promise.all results...\n');
  
  const scanner = new EnhancedAccessibilityScanner();
  
  try {
    await scanner.init();
    
    const url = 'https://webaim.org/';
    const scanOptions = {
      includePhase6D: true,
      timeout: 30000
    };
    
    const scanPromises = [
      scanner.runAxeTests(url, scanOptions),
      scanner.runPa11yTests(url, scanOptions),
      null  // testKeyboardNav is false
    ];

    // Add Phase 6D scans
    scanPromises.push(
      scanner.languageDetectionScanner.scanLanguageCompliance(url, {
        timeout: scanOptions.timeout
      }),
      scanner.htmlValidationScanner.scanHTMLCompliance(url, {
        strictValidation: true,
        checkAccessibilityMarkup: true,
        validateARIA: true,
        timeout: scanOptions.timeout
      })
    );

    console.log('Scan promises structure:');
    scanPromises.forEach((promise, index) => {
      console.log(`  [${index}]: ${promise === null ? 'null' : 'Promise'}`);
    });
    
    const results = await Promise.all(scanPromises);
    
    console.log('\nResults structure:');
    results.forEach((result, index) => {
      if (result === null) {
        console.log(`  [${index}]: null`);
      } else if (result.violations !== undefined) {
        console.log(`  [${index}]: Scanner result - passed: ${result.passed}, violations: ${result.violations.length}`);
      } else {
        console.log(`  [${index}]: Other result type`);
      }
    });
    
    // The issue is that results[2] is null but we're trying to extract phase6D from index 2
    console.log('\nExtracting Phase 6D from correct positions:');
    console.log('results[3] (language):', results[3] ? `passed: ${results[3].passed}, violations: ${results[3].violations.length}` : 'null');
    console.log('results[4] (html):', results[4] ? `passed: ${results[4].passed}, violations: ${results[4].violations.length}` : 'null');
    
  } catch (error) {
    console.error('Debug failed:', error.message);
  } finally {
    await scanner.close();
  }
}

debugPhase6DResults().catch(console.error);