#!/usr/bin/env node

/**
 * Test CSP Mitigation Strategy: SecurityDisabled
 * Tests browser launch with all security features disabled
 */

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

class SecurityDisabledTester {
  constructor() {
    this.browser = null;
    this.testResults = [];
  }

  async init() {
    console.log('🔓 Testing CSP Mitigation: SecurityDisabled');
    console.log('=' .repeat(60));
  }

  /**
   * Apply SecurityDisabled mitigation strategy
   */
  async applySecurityDisabled(url, testName) {
    // Launch browser with all security features disabled
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizSecurityPolicy',
        '--disable-site-isolation-trials',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      
      console.log(`🔓 Testing ${testName} with SecurityDisabled...`);
      console.log('   🚨 All browser security features disabled');
      
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Inject axe with security disabled
      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });
      console.log('   ✅ axe injected with security disabled');

      // Test if axe is available and run scan
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ 
              error: 'axe is not defined with security disabled',
              strategy: 'SecurityDisabled',
              success: false
            });
            return;
          }
          
          console.log('✅ axe successfully injected with security disabled!');
          
          axe.run((err, results) => {
            if (err) {
              resolve({ 
                error: err.message,
                strategy: 'SecurityDisabled',
                success: false
              });
            } else {
              resolve({
                ...results,
                strategy: 'SecurityDisabled',
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
        const result = await this.applySecurityDisabled(testCase.url, testCase.name);
        const duration = Date.now() - startTime;
        
        if (result.error) {
          console.log(`❌ ${testCase.name}: FAILED`);
          console.log(`   Error: ${result.error}`);
          console.log(`   Duration: ${duration}ms`);
          console.log(`   ⚠️ Even with security disabled, injection failed`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'SecurityDisabled',
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
          console.log(`   🔓 Security bypass: Complete`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'SecurityDisabled',
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
        console.log(`   ⚠️ Unexpected failure even with security disabled`);
        
        this.testResults.push({
          name: testCase.name,
          strategy: 'SecurityDisabled',
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
    console.log('📋 SecurityDisabled Strategy Test Report');
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
    console.log(`   Strategy: SecurityDisabled (nuclear option)`);
    console.log(`   Mechanism: Launch browser with --disable-web-security --disable-features=VizSecurityPolicy`);
    
    console.log('\\n⚠️ Security Implications:');
    console.log(`   🚨 ALL browser security disabled`);
    console.log(`   🚨 CSP completely bypassed`);
    console.log(`   🚨 Same-origin policy disabled`);
    console.log(`   🚨 ONLY for testing environments`);
    console.log(`   🚨 NEVER use in production`);
    
    if (successRate >= 90) {
      console.log(`   🎉 EXCELLENT: SecurityDisabled strategy works as expected (near 100% success)`);
    } else if (successRate >= 75) {
      console.log(`   ✅ GOOD: SecurityDisabled strategy works well`);
    } else {
      console.log(`   ⚠️ CONCERNING: SecurityDisabled strategy should have higher success rate`);
    }
    
    return {
      strategy: 'SecurityDisabled',
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
  const tester = new SecurityDisabledTester();
  
  try {
    await tester.init();
    await tester.runTests();
    const report = tester.generateReport();
    
    // Save detailed results
    await fs.writeFile(
      './tmp/csp-security-disabled-results.json',
      JSON.stringify(report, null, 2)
    );
    
    console.log('\\n💾 Detailed results saved to: ./tmp/csp-security-disabled-results.json');
    
    process.exit(report.successRate >= 75 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = SecurityDisabledTester;