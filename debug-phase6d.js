const EnhancedAccessibilityScanner = require('./src/enhanced-scanner');

async function debugPhase6DResults() {
  console.log('Debugging Phase 6D result handling...\n');
  
  const scanner = new EnhancedAccessibilityScanner();
  
  try {
    // Override the enhancedScan method temporarily to add debug logging
    const originalMethod = scanner.enhancedScan;
    scanner.enhancedScan = async function(url, options = {}) {
      const defaultOptions = {
        wcagLevel: 'AA',
        includeWarnings: true,
        testKeyboardNav: false,
        includePhase6A: false,
        includePhase6B: false,
        includePhase6D: false,
        timeout: 30000
      };
      
      const scanOptions = { ...defaultOptions, ...options };
      console.log('Scan options:', scanOptions);

      await this.init();
      
      const scanPromises = [
        this.runAxeTests(url, scanOptions),
        this.runPa11yTests(url, scanOptions),
        scanOptions.testKeyboardNav ? this.testKeyboardNavigation(url) : null
      ];

      // Add Phase 6D scans if enabled
      if (scanOptions.includePhase6D) {
        console.log('Adding Phase 6D scanners to promises...');
        scanPromises.push(
          this.languageDetectionScanner.scanLanguageCompliance(url, {
            timeout: scanOptions.timeout
          }),
          this.htmlValidationScanner.scanHTMLCompliance(url, {
            strictValidation: true,
            checkAccessibilityMarkup: true,
            validateARIA: true,
            timeout: scanOptions.timeout
          })
        );
      }

      console.log('Total scan promises:', scanPromises.length);
      
      const results = await Promise.all(scanPromises);
      console.log('Results received:', results.length);
      
      // Extract results based on what was included
      let axeResults, pa11yResults, keyboardNavResults;
      let phase6AResults = [];
      let phase6BResults = [];
      let phase6DResults = [];
      
      let resultIndex = 0;
      axeResults = results[resultIndex++];
      pa11yResults = results[resultIndex++];
      keyboardNavResults = scanOptions.testKeyboardNav ? results[resultIndex++] : null;
      
      if (scanOptions.includePhase6D) {
        console.log('Extracting Phase 6D results from index', resultIndex);
        phase6DResults = results.slice(resultIndex, resultIndex + 2);
        console.log('Phase 6D results length:', phase6DResults.length);
        console.log('Language result passed:', phase6DResults[0]?.passed);
        console.log('HTML result passed:', phase6DResults[1]?.passed);
        resultIndex += 2;
      }

      // Organize Phase 6D results
      let phase6DCompliance = null;
      if (scanOptions.includePhase6D && phase6DResults.length === 2) {
        console.log('Organizing Phase 6D compliance...');
        const [languageResult, htmlResult] = phase6DResults;
        phase6DCompliance = {
          language: languageResult,
          htmlValidation: htmlResult
        };
        console.log('Phase 6D compliance created successfully');
      }

      // Simple report for debug
      return {
        url,
        phase6DCompliance,
        debug: {
          scanOptions,
          resultCount: results.length,
          phase6DResultsLength: phase6DResults.length
        }
      };
    };
    
    const result = await scanner.enhancedScan('https://webaim.org/', {
      includePhase6D: true,
      timeout: 30000
    });
    
    console.log('\nFinal result:');
    console.log('Has phase6DCompliance:', !!result.phase6DCompliance);
    if (result.phase6DCompliance) {
      console.log('Language passed:', result.phase6DCompliance.language.passed);
      console.log('Language violations:', result.phase6DCompliance.language.violations.length);
      console.log('HTML passed:', result.phase6DCompliance.htmlValidation.passed);
      console.log('HTML violations:', result.phase6DCompliance.htmlValidation.violations.length);
    }
    console.log('Debug info:', result.debug);
    
  } catch (error) {
    console.error('Debug failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

debugPhase6DResults().catch(console.error);