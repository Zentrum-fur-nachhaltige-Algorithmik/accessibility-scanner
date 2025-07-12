#!/usr/bin/env node

/**
 * Test CSP Mitigation Strategy: ModernCDPBypass
 * Tests the Chrome DevTools Protocol CSP bypass
 */

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

class ModernCDPBypassTester {
  constructor() {
    this.browser = null;
    this.testResults = [];
  }

  async init() {
    console.log('🔧 Testing CSP Mitigation: ModernCDPBypass');
    console.log('=' .repeat(60));
  }

  /**
   * Apply ModernCDPBypass mitigation strategy
   */
  async applyModernCDPBypass(url, testName) {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await this.browser.newPage();
    
    try {
      console.log(`🔧 Testing ${testName} with ModernCDPBypass...`);
      
      // Use modern CDP session API to bypass CSP
      const client = await page.target().createCDPSession();
      await client.send('Page.setBypassCSP', { enabled: true });
      console.log('   ✅ CSP bypass enabled via CDP session');
      
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Inject axe after CSP bypass
      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });
      console.log('   ✅ axe injected after CSP bypass');

      // Test if axe is available and run scan
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ 
              error: 'axe is not defined after CSP bypass',
              strategy: 'ModernCDPBypass',
              success: false
            });
            return;
          }
          
          console.log('✅ axe successfully injected after CDP CSP bypass!');
          
          axe.run((err, results) => {
            if (err) {
              resolve({ 
                error: err.message,
                strategy: 'ModernCDPBypass',
                success: false
              });
            } else {
              resolve({
                ...results,
                strategy: 'ModernCDPBypass',
                success: true,
                violationsCount: results.violations.length,
                passesCount: results.passes.length
              });
            }
          });
        });
      });

      await client.detach();
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
        const result = await this.applyModernCDPBypass(testCase.url, testCase.name);
        const duration = Date.now() - startTime;
        
        if (result.error) {
          console.log(`❌ ${testCase.name}: FAILED`);
          console.log(`   Error: ${result.error}`);
          console.log(`   Duration: ${duration}ms`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'ModernCDPBypass',
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
            strategy: 'ModernCDPBypass',
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
          strategy: 'ModernCDPBypass',
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
    console.log('📋 ModernCDPBypass Strategy Test Report');
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
    console.log(`   Strategy: ModernCDPBypass (Chrome DevTools Protocol)`);
    console.log(`   Mechanism: client.send('Page.setBypassCSP', { enabled: true })`);
    
    if (successRate >= 80) {
      console.log(`   🎉 EXCELLENT: ModernCDPBypass strategy is highly effective!`);
    } else if (successRate >= 60) {
      console.log(`   ✅ GOOD: ModernCDPBypass strategy works well`);
    } else {
      console.log(`   ⚠️ POOR: ModernCDPBypass strategy needs improvement`);
    }
    
    return {
      strategy: 'ModernCDPBypass',
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
  const tester = new ModernCDPBypassTester();
  
  try {
    await tester.init();
    await tester.runTests();
    const report = tester.generateReport();
    
    // Save detailed results
    await fs.writeFile(
      './tmp/csp-modern-cdp-bypass-results.json',
      JSON.stringify(report, null, 2)
    );
    
    console.log('\\n💾 Detailed results saved to: ./tmp/csp-modern-cdp-bypass-results.json');
    
    process.exit(report.successRate >= 50 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ModernCDPBypassTester;