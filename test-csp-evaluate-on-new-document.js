#!/usr/bin/env node

/**
 * Test CSP Mitigation Strategy: EvaluateOnNewDocument
 * Tests the injection of axe before CSP policy loads
 */

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

class EvaluateOnNewDocumentTester {
  constructor() {
    this.browser = null;
    this.testResults = [];
  }

  async init() {
    console.log('🚀 Testing CSP Mitigation: EvaluateOnNewDocument');
    console.log('=' .repeat(60));
  }

  /**
   * Apply EvaluateOnNewDocument mitigation strategy
   */
  async applyEvaluateOnNewDocument(url, testName) {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      
      console.log(`📊 Testing ${testName} with EvaluateOnNewDocument...`);
      
      // Read axe source and inject before page loads (before CSP applies)
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.evaluateOnNewDocument(axeSource);
      
      // Navigate to page - CSP loads AFTER axe is already injected
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Test if axe is available and run scan
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ 
              error: 'axe is not defined after evaluateOnNewDocument',
              strategy: 'EvaluateOnNewDocument',
              success: false
            });
            return;
          }
          
          console.log('✅ axe successfully injected before CSP!');
          
          axe.run((err, results) => {
            if (err) {
              resolve({ 
                error: err.message,
                strategy: 'EvaluateOnNewDocument',
                success: false
              });
            } else {
              resolve({
                ...results,
                strategy: 'EvaluateOnNewDocument',
                success: true,
                violationsCount: results.violations.length,
                passesCount: results.passes.length
              });
            }
          });
        });
      });

      return results;
      
    } finally {
      await page.close();
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }
  }

  /**
   * Test both good and bad accessibility pages
   */
  async runTests() {
    const testCases = [
      {
        name: 'Good Accessibility (CSP Protected)',
        url: `file://${path.resolve(__dirname, 'test-html/csp-good-accessibility.html')}`,
        expectViolations: false
      },
      {
        name: 'Bad Accessibility (CSP Protected)',
        url: `file://${path.resolve(__dirname, 'test-html/csp-bad-accessibility.html')}`,
        expectViolations: true
      }
    ];

    for (const testCase of testCases) {
      const startTime = Date.now();
      
      try {
        const result = await this.applyEvaluateOnNewDocument(testCase.url, testCase.name);
        const duration = Date.now() - startTime;
        
        if (result.error) {
          console.log(`❌ ${testCase.name}: FAILED`);
          console.log(`   Error: ${result.error}`);
          console.log(`   Duration: ${duration}ms`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'EvaluateOnNewDocument',
            success: false,
            error: result.error,
            duration
          });
        } else {
          const violationsFound = result.violationsCount > 0;
          const expectationMet = testCase.expectViolations ? violationsFound : !violationsFound;
          
          console.log(`✅ ${testCase.name}: SUCCESS`);
          console.log(`   Strategy: ${result.strategy}`);
          console.log(`   Violations: ${result.violationsCount}`);
          console.log(`   Passes: ${result.passesCount}`);
          console.log(`   Expected violations: ${testCase.expectViolations ? 'Yes' : 'No'}`);
          console.log(`   Expectation met: ${expectationMet ? '✅ Yes' : '❌ No'}`);
          console.log(`   Duration: ${duration}ms`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'EvaluateOnNewDocument',
            success: true,
            violationsCount: result.violationsCount,
            passesCount: result.passesCount,
            expectationMet,
            duration,
            sampleViolations: result.violations.slice(0, 3).map(v => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              nodes: v.nodes.length
            }))
          });
        }
        
      } catch (error) {
        console.log(`❌ ${testCase.name}: EXCEPTION`);
        console.log(`   Error: ${error.message}`);
        
        this.testResults.push({
          name: testCase.name,
          strategy: 'EvaluateOnNewDocument',
          success: false,
          error: error.message,
          duration: Date.now() - startTime
        });
      }
      
      console.log(''); // Empty line between tests
    }
  }

  /**
   * Generate test report
   */
  generateReport() {
    console.log('📋 EvaluateOnNewDocument Strategy Test Report');
    console.log('=' .repeat(60));
    
    const successful = this.testResults.filter(r => r.success);
    const failed = this.testResults.filter(r => !r.success);
    
    console.log(`✅ Successful tests: ${successful.length}/${this.testResults.length}`);
    console.log(`❌ Failed tests: ${failed.length}/${this.testResults.length}`);
    
    if (successful.length > 0) {
      console.log('\\n🎯 Success Details:');
      successful.forEach(result => {
        console.log(`   ✅ ${result.name}`);
        console.log(`      Violations: ${result.violationsCount}`);
        console.log(`      Passes: ${result.passesCount}`);
        console.log(`      Expectation met: ${result.expectationMet ? 'Yes' : 'No'}`);
        console.log(`      Duration: ${result.duration}ms`);
      });
    }
    
    if (failed.length > 0) {
      console.log('\\n❌ Failure Details:');
      failed.forEach(result => {
        console.log(`   ❌ ${result.name}`);
        console.log(`      Error: ${result.error}`);
        console.log(`      Duration: ${result.duration}ms`);
      });
    }
    
    console.log('\\n📊 Strategy Effectiveness:');
    const successRate = Math.round((successful.length / this.testResults.length) * 100);
    console.log(`   Success Rate: ${successRate}%`);
    console.log(`   Strategy: EvaluateOnNewDocument (inject before CSP loads)`);
    console.log(`   Mechanism: page.evaluateOnNewDocument() + axe source injection`);
    
    if (successRate >= 80) {
      console.log(`   🎉 EXCELLENT: EvaluateOnNewDocument strategy is highly effective!`);
    } else if (successRate >= 60) {
      console.log(`   ✅ GOOD: EvaluateOnNewDocument strategy works well`);
    } else {
      console.log(`   ⚠️ POOR: EvaluateOnNewDocument strategy needs improvement`);
    }
    
    return {
      strategy: 'EvaluateOnNewDocument',
      successRate,
      totalTests: this.testResults.length,
      successfulTests: successful.length,
      failedTests: failed.length,
      results: this.testResults
    };
  }
}

// Run if executed directly
async function main() {
  const tester = new EvaluateOnNewDocumentTester();
  
  try {
    await tester.init();
    await tester.runTests();
    const report = tester.generateReport();
    
    // Save detailed results
    await fs.writeFile(
      './tmp/csp-evaluate-on-new-document-results.json',
      JSON.stringify(report, null, 2)
    );
    
    console.log('\\n💾 Detailed results saved to: ./tmp/csp-evaluate-on-new-document-results.json');
    
    process.exit(report.successRate >= 50 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = EvaluateOnNewDocumentTester;