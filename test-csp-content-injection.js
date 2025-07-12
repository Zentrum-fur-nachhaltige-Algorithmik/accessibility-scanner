#!/usr/bin/env node

/**
 * Test CSP Mitigation Strategy: ContentInjection
 * Tests brute force script injection despite CSP
 */

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

class ContentInjectionTester {
  constructor() {
    this.browser = null;
    this.testResults = [];
  }

  async init() {
    console.log('💉 Testing CSP Mitigation: ContentInjection');
    console.log('=' .repeat(60));
  }

  /**
   * Apply ContentInjection mitigation strategy
   */
  async applyContentInjection(url, testName) {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      
      console.log(`💉 Testing ${testName} with ContentInjection...`);
      
      // Navigate to page first (CSP is active)
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Read axe source code
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      
      // Try to inject axe source directly despite CSP
      console.log('   🎯 Attempting brute force script injection...');
      
      try {
        await page.addScriptTag({ content: axeSource });
        console.log('   ✅ Script injection succeeded (CSP bypassed)');
      } catch (injectionError) {
        console.log(`   ❌ Script injection blocked: ${injectionError.message}`);
        // Continue anyway to test if axe somehow got through
      }

      // Test if axe is available and run scan
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ 
              error: 'axe is not defined after content injection (blocked by CSP)',
              strategy: 'ContentInjection',
              success: false,
              cspBlocked: true
            });
            return;
          }
          
          console.log('✅ axe successfully injected despite CSP!');
          
          axe.run((err, results) => {
            if (err) {
              resolve({ 
                error: err.message,
                strategy: 'ContentInjection',
                success: false
              });
            } else {
              resolve({
                ...results,
                strategy: 'ContentInjection',
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
        const result = await this.applyContentInjection(testCase.url, testCase.name);
        const duration = Date.now() - startTime;
        
        if (result.error) {
          const isCSPBlocked = result.cspBlocked || result.error.includes('CSP') || result.error.includes('blocked');
          
          console.log(`${isCSPBlocked ? '🛡️' : '❌'} ${testCase.name}: ${isCSPBlocked ? 'CSP BLOCKED (Expected)' : 'FAILED'}`);
          console.log(`   Error: ${result.error}`);
          console.log(`   Duration: ${duration}ms`);
          console.log(`   CSP Protection: ${isCSPBlocked ? '✅ Working' : '❓ Unknown'}`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'ContentInjection',
            success: false,
            cspBlocked: isCSPBlocked,
            error: result.error,
            duration
          });
        } else {
          const violationsFound = result.violationsCount > 0;
          const expectationMet = testCase.expectViolations ? violationsFound : !violationsFound;
          
          console.log(`🎉 ${testCase.name}: BYPASS SUCCESS`);
          console.log(`   Strategy: ${result.strategy}`);
          console.log(`   Violations: ${result.violationsCount}`);
          console.log(`   Passes: ${result.passesCount}`);
          console.log(`   Expected violations: ${testCase.expectViolations ? 'Yes' : 'No'}`);
          console.log(`   Expectation met: ${expectationMet ? '✅ Yes' : '❌ No'}`);
          console.log(`   Duration: ${duration}ms`);
          console.log(`   CSP Protection: ❌ Bypassed`);
          
          this.testResults.push({
            name: testCase.name,
            strategy: 'ContentInjection',
            success: true,
            cspBlocked: false,
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
        const isCSPError = error.message.includes('CSP') || error.message.includes('refused') || error.message.includes('blocked');
        
        console.log(`${isCSPError ? '🛡️' : '❌'} ${testCase.name}: ${isCSPError ? 'CSP BLOCKED (Expected)' : 'EXCEPTION'}`);
        console.log(`   Error: ${error.message}`);
        console.log(`   CSP Protection: ${isCSPError ? '✅ Working' : '❓ Unknown'}`);
        
        this.testResults.push({
          name: testCase.name,
          strategy: 'ContentInjection',
          success: false,
          cspBlocked: isCSPError,
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
    console.log('📋 ContentInjection Strategy Test Report');
    console.log('=' .repeat(60));
    
    const successful = this.testResults.filter(r => r.success);
    const cspBlocked = this.testResults.filter(r => r.cspBlocked);
    const failed = this.testResults.filter(r => !r.success && !r.cspBlocked);
    
    console.log(`🎉 Bypass successful: ${successful.length}/${this.testResults.length}`);
    console.log(`🛡️ CSP blocked (expected): ${cspBlocked.length}/${this.testResults.length}`);
    console.log(`❌ Failed (unexpected): ${failed.length}/${this.testResults.length}`);
    
    if (successful.length > 0) {
      console.log('\\n🎯 Bypass Success Details:');
      successful.forEach(result => {
        console.log(`   🎉 ${result.name}`);
        console.log(`      Violations: ${result.violationsCount}`);
        console.log(`      Passes: ${result.passesCount}`);
        console.log(`      Expectation met: ${result.expectationMet ? 'Yes' : 'No'}`);
        console.log(`      Duration: ${result.duration}ms`);
      });
    }
    
    if (cspBlocked.length > 0) {
      console.log('\\n🛡️ CSP Protection Working (Expected):');
      cspBlocked.forEach(result => {
        console.log(`   🛡️ ${result.name}`);
        console.log(`      Error: ${result.error}`);
        console.log(`      Duration: ${result.duration}ms`);
      });
    }
    
    if (failed.length > 0) {
      console.log('\\n❌ Unexpected Failures:');
      failed.forEach(result => {
        console.log(`   ❌ ${result.name}`);
        console.log(`      Error: ${result.error}`);
        console.log(`      Duration: ${result.duration}ms`);
      });
    }
    
    console.log('\\n📊 Strategy Effectiveness:');
    const bypassRate = Math.round((successful.length / this.testResults.length) * 100);
    const blockRate = Math.round((cspBlocked.length / this.testResults.length) * 100);
    
    console.log(`   Bypass Rate: ${bypassRate}% (lower is expected for this strategy)`);
    console.log(`   CSP Block Rate: ${blockRate}% (higher is expected)`);
    console.log(`   Strategy: ContentInjection (brute force after page load)`);
    console.log(`   Mechanism: page.addScriptTag({ content: axeSource })`);
    
    if (bypassRate >= 50) {
      console.log(`   🎉 SURPRISING: ContentInjection bypassed CSP more than expected!`);
    } else if (bypassRate >= 25) {
      console.log(`   ✅ MODERATE: ContentInjection has some bypass capability`);
    } else {
      console.log(`   🛡️ EXPECTED: ContentInjection properly blocked by CSP (this is normal)`);
    }
    
    return {
      strategy: 'ContentInjection',
      bypassRate,
      blockRate,
      totalTests: this.testResults.length,
      successfulTests: successful.length,
      blockedTests: cspBlocked.length,
      failedTests: failed.length,
      results: this.testResults
    };
  }
}

// Run if executed directly
async function main() {
  const tester = new ContentInjectionTester();
  
  try {
    await tester.init();
    await tester.runTests();
    const report = tester.generateReport();
    
    // Save detailed results
    await fs.writeFile(
      './tmp/csp-content-injection-results.json',
      JSON.stringify(report, null, 2)
    );
    
    console.log('\\n💾 Detailed results saved to: ./tmp/csp-content-injection-results.json');
    
    // ContentInjection is expected to be blocked, so we consider CSP blocking as "success"
    const effectivenessScore = report.blockRate; // CSP doing its job
    process.exit(effectivenessScore >= 50 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ContentInjectionTester;