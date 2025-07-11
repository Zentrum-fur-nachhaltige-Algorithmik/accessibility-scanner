#!/usr/bin/env node

/**
 * Analyze CSP Independence of Accessibility Scanners
 * 
 * Tests each scanner individually to determine which ones:
 * 1. Work WITHOUT CSP problems (CSP-immune)
 * 2. Require axe injection (CSP-dependent)
 * 3. Can be used as reliable alternatives
 */

const fs = require('fs-extra');
const path = require('path');

// Import individual scanners
const ScreenReaderScanner = require('./src/screen-reader-scanner');
const ColorContrastScanner = require('./src/color-contrast-scanner');
const HTMLValidationScanner = require('./src/html-validation-scanner');
const KeyboardNavigationScanner = require('./src/keyboard-navigation-scanner');
const LanguageDetectionScanner = require('./src/language-detection-scanner');
const AccessibilityScanner = require('./src/scanner'); // Basic axe-based scanner

class CSPIndependenceAnalyzer {
  constructor() {
    this.testUrl = 'https://www.gov.uk'; // Known CSP-protected site
    this.testResults = [];
    
    // Define all scanners to test
    this.scanners = [
      {
        name: 'BasicScanner (axe-based)',
        scanner: new AccessibilityScanner(),
        method: 'scanWebpage',
        cspDependent: true,
        description: 'Uses axe-core injection - CSP dependent'
      },
      {
        name: 'ScreenReaderScanner',
        scanner: new ScreenReaderScanner(),
        method: 'screenReaderAnalysis',
        cspDependent: false,
        description: 'Pure DOM analysis - CSP immune'
      },
      {
        name: 'ColorContrastScanner',
        scanner: new ColorContrastScanner(),
        method: 'scanColorContrast',
        cspDependent: false,
        description: 'Canvas + DOM analysis - CSP immune'
      },
      {
        name: 'HTMLValidationScanner',
        scanner: new HTMLValidationScanner(),
        method: 'scanHTMLCompliance',
        cspDependent: false,
        description: 'HTML parsing + validation - CSP immune'
      },
      {
        name: 'KeyboardNavigationScanner',
        scanner: new KeyboardNavigationScanner(),
        method: 'scanKeyboardAccess',
        cspDependent: false,
        description: 'Interaction testing - CSP immune'
      },
      {
        name: 'LanguageDetectionScanner',
        scanner: new LanguageDetectionScanner(),
        method: 'scanLanguageCompliance',
        cspDependent: false,
        description: 'HTML attribute analysis - CSP immune'
      }
    ];
  }

  async analyzeCSPIndependence() {
    console.log('🔍 CSP Independence Analysis');
    console.log(`🎯 Testing all scanners against CSP-protected site: ${this.testUrl}`);
    console.log('='.repeat(80));

    for (const scannerConfig of this.scanners) {
      console.log(`\n📊 Testing: ${scannerConfig.name}`);
      console.log(`📋 Description: ${scannerConfig.description}`);
      console.log(`🛡️ Expected CSP Impact: ${scannerConfig.cspDependent ? 'WILL FAIL' : 'SHOULD WORK'}`);
      
      const result = await this.testSingleScanner(scannerConfig);
      this.testResults.push(result);
      
      this.evaluateResult(result);
    }

    this.generateSummary();
    await this.saveResults();
  }

  async testSingleScanner(scannerConfig) {
    const startTime = Date.now();
    
    try {
      let scanResult;
      
      // Call the appropriate method based on scanner type
      if (scannerConfig.method === 'scanWebpage') {
        scanResult = await scannerConfig.scanner[scannerConfig.method](this.testUrl);
      } else if (scannerConfig.method === 'scanColorContrast') {
        scanResult = await scannerConfig.scanner[scannerConfig.method](this.testUrl, { wcagLevel: 'AA' });
      } else if (scannerConfig.method === 'scanHTMLCompliance') {
        scanResult = await scannerConfig.scanner[scannerConfig.method](this.testUrl, { timeout: 30000 });
      } else if (scannerConfig.method === 'scanKeyboardAccess') {
        scanResult = await scannerConfig.scanner[scannerConfig.method](this.testUrl, { timeout: 30000 });
      } else if (scannerConfig.method === 'scanLanguageCompliance') {
        scanResult = await scannerConfig.scanner[scannerConfig.method](this.testUrl, { timeout: 30000 });
      } else {
        scanResult = await scannerConfig.scanner[scannerConfig.method](this.testUrl);
      }

      const duration = Date.now() - startTime;
      
      // Check if result indicates success or failure
      const hasError = scanResult.error || scanResult.errors?.length > 0;
      const hasValidData = this.hasValidAccessibilityData(scanResult);
      
      return {
        ...scannerConfig,
        success: !hasError && hasValidData,
        duration,
        scanResult,
        error: hasError ? (scanResult.error || 'Has errors') : null
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        ...scannerConfig,
        success: false,
        duration,
        scanResult: null,
        error: error.message
      };
    }
  }

  hasValidAccessibilityData(result) {
    // Check if the result contains meaningful accessibility data
    if (!result) return false;
    
    // Basic scanner - should have violations or passes
    if (result.violations !== undefined || result.passes !== undefined) {
      return true;
    }
    
    // Screen reader scanner - should have heading structure, landmarks, etc.
    if (result.headingStructure || result.landmarks || result.ariaUsage) {
      return true;
    }
    
    // Color contrast scanner - should have contrast analysis
    if (result.contrastAnalysis || result.colorIssues) {
      return true;
    }
    
    // HTML validation scanner - should have validation results
    if (result.htmlValidation || result.validationResults) {
      return true;
    }
    
    // Keyboard navigation scanner - should have navigation results
    if (result.keyboardAccessibility || result.tabOrder) {
      return true;
    }
    
    // Language scanner - should have language analysis
    if (result.languageCompliance || result.languageAnalysis) {
      return true;
    }
    
    // If it has any meaningful data structures, consider it valid
    return Object.keys(result).length > 2; // More than just url and timestamp
  }

  evaluateResult(result) {
    const { name, cspDependent, success, duration, error } = result;
    
    console.log(`📈 Results:`);
    console.log(`   ✅ Success: ${success ? 'YES' : 'NO'}`);
    console.log(`   ⏱️ Duration: ${duration}ms`);
    
    if (error) {
      console.log(`   ❌ Error: ${error}`);
    }
    
    // Validate against expectations
    const expectationMet = cspDependent ? !success : success;
    console.log(`   🎯 Expectation: ${expectationMet ? '✅ MET' : '⚠️ UNEXPECTED'}`);
    
    // CSP Independence assessment
    if (!cspDependent && success) {
      console.log(`   🛡️ CSP Status: ✅ CSP-IMMUNE (can replace axe-based tests)`);
    } else if (cspDependent && !success) {
      console.log(`   🛡️ CSP Status: ❌ CSP-BLOCKED (as expected)`);
    } else if (!cspDependent && !success) {
      console.log(`   🛡️ CSP Status: ⚠️ UNEXPECTED FAILURE (should be CSP-immune)`);
    } else if (cspDependent && success) {
      console.log(`   🛡️ CSP Status: 🎉 UNEXPECTED SUCCESS (CSP bypassed somehow)`);
    }
  }

  generateSummary() {
    console.log('\n' + '='.repeat(80));
    console.log('🏆 CSP INDEPENDENCE ANALYSIS SUMMARY');
    console.log('='.repeat(80));

    const cspImmuneSuccess = this.testResults.filter(r => !r.cspDependent && r.success);
    const cspDependentFailed = this.testResults.filter(r => r.cspDependent && !r.success);
    const unexpectedFailures = this.testResults.filter(r => !r.cspDependent && !r.success);
    const unexpectedSuccesses = this.testResults.filter(r => r.cspDependent && r.success);

    console.log(`\n✅ CSP-IMMUNE SCANNERS (Work without axe):  ${cspImmuneSuccess.length}`);
    cspImmuneSuccess.forEach(r => {
      console.log(`   🔹 ${r.name} - ${r.duration}ms`);
    });

    console.log(`\n❌ CSP-DEPENDENT SCANNERS (Blocked):  ${cspDependentFailed.length}`);
    cspDependentFailed.forEach(r => {
      console.log(`   🔹 ${r.name} - ${r.error}`);
    });

    if (unexpectedFailures.length > 0) {
      console.log(`\n⚠️ UNEXPECTED FAILURES (Should be CSP-immune):  ${unexpectedFailures.length}`);
      unexpectedFailures.forEach(r => {
        console.log(`   🔹 ${r.name} - ${r.error}`);
      });
    }

    if (unexpectedSuccesses.length > 0) {
      console.log(`\n🎉 UNEXPECTED SUCCESSES (CSP somehow bypassed):  ${unexpectedSuccesses.length}`);
      unexpectedSuccesses.forEach(r => {
        console.log(`   🔹 ${r.name} - ${r.duration}ms`);
      });
    }

    // Practical recommendations
    console.log(`\n💡 PRACTICAL RECOMMENDATIONS:`);
    
    if (cspImmuneSuccess.length > 0) {
      console.log(`✅ USE CSP-IMMUNE SCANNERS: ${cspImmuneSuccess.length} scanners can replace axe on CSP-protected sites`);
      console.log(`📊 Coverage: Screen reader, color contrast, HTML validation, keyboard, language`);
    }
    
    const avgDuration = cspImmuneSuccess.reduce((sum, r) => sum + r.duration, 0) / cspImmuneSuccess.length;
    console.log(`⚡ Performance: CSP-immune scanners average ${Math.round(avgDuration)}ms per scan`);
    
    console.log(`🔄 Strategy: Use CSP-immune scanners as primary method, axe as enhancement when possible`);
  }

  async saveResults() {
    const detailedResults = {
      timestamp: new Date().toISOString(),
      testUrl: this.testUrl,
      summary: {
        totalScanners: this.testResults.length,
        cspImmune: this.testResults.filter(r => !r.cspDependent && r.success).length,
        cspDependent: this.testResults.filter(r => r.cspDependent).length,
        unexpectedFailures: this.testResults.filter(r => !r.cspDependent && !r.success).length
      },
      results: this.testResults
    };

    await fs.writeJson('./tmp/csp-independence-analysis.json', detailedResults, { spaces: 2 });
    console.log(`\n📊 Detailed results saved to: ./tmp/csp-independence-analysis.json`);
  }

  async cleanup() {
    // Close all scanners that have close methods
    for (const scannerConfig of this.scanners) {
      if (scannerConfig.scanner.close) {
        try {
          await scannerConfig.scanner.close();
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
  }
}

// Run if executed directly
if (require.main === module) {
  const analyzer = new CSPIndependenceAnalyzer();
  
  analyzer.analyzeCSPIndependence()
    .then(() => analyzer.cleanup())
    .then(() => {
      console.log('\n✅ CSP independence analysis completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Analysis failed:', error);
      process.exit(1);
    });
}

module.exports = CSPIndependenceAnalyzer;