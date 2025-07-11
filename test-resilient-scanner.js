#!/usr/bin/env node

/**
 * Iterative Testing of Resilient Accessibility Scanner
 * Tests the 3-tier fallback strategy across multiple websites
 */

const ResilientAccessibilityScanner = require('./src/resilient-accessibility-scanner');
const fs = require('fs-extra');
const path = require('path');

class ResilientScannerTester {
  constructor() {
    this.scanner = new ResilientAccessibilityScanner();
    this.testResults = [];
    this.reportDir = path.join(__dirname, 'tmp/resilient-test-reports');
  }

  async init() {
    await fs.ensureDir(this.reportDir);
    console.log(`🚀 Resilient Scanner Tester initialized`);
    console.log(`📁 Reports will be saved to: ${this.reportDir}`);
  }

  /**
   * Test websites with known characteristics
   */
  getTestWebsites() {
    return [
      {
        url: 'https://example.com',
        category: 'Simple',
        expectedStrategy: 'StandardAxe',
        description: 'Basic HTML, no CSP restrictions'
      },
      {
        url: 'https://www.gov.uk',
        category: 'Government',
        expectedStrategy: 'CSPMitigation_*',
        description: 'Strict CSP, high security'
      },
      {
        url: 'https://www.amazon.com',
        category: 'E-commerce',
        expectedStrategy: 'StandardAxe',
        description: 'Complex but moderate CSP'
      },
      {
        url: 'https://www.bbc.com',
        category: 'News',
        expectedStrategy: 'StandardAxe',
        description: 'Media-rich, moderate CSP'
      },
      {
        url: 'https://twitter.com',
        category: 'Social Media',
        expectedStrategy: 'AxeIndependentFallback',
        description: 'Heavy CSP, client-side protection'
      }
    ];
  }

  /**
   * Run comprehensive test across all websites
   */
  async runComprehensiveTest() {
    console.log('🔍 Starting comprehensive resilient scanner test...\n');
    
    const websites = this.getTestWebsites();
    const testSession = `test-session-${Date.now()}`;
    
    for (let i = 0; i < websites.length; i++) {
      const website = websites[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🌐 TESTING WEBSITE ${i + 1}/${websites.length}: ${website.url}`);
      console.log(`📋 Category: ${website.category}`);
      console.log(`🎯 Expected: ${website.expectedStrategy}`);
      console.log(`📝 Description: ${website.description}`);
      console.log(`${'='.repeat(80)}\n`);
      
      try {
        const startTime = Date.now();
        const result = await this.scanner.resilientScan(website.url);
        const duration = Date.now() - startTime;
        
        // Add test metadata
        result.testMetadata = {
          website,
          testSession,
          duration,
          expectedStrategy: website.expectedStrategy,
          strategyMatches: this.checkStrategyMatch(result.strategy, website.expectedStrategy)
        };
        
        this.testResults.push(result);
        
        // Save individual result
        await this.saveTestResult(result, testSession);
        
        // Print summary
        this.printTestSummary(result, duration);
        
      } catch (error) {
        console.log(`❌ FATAL ERROR for ${website.url}: ${error.message}`);
        
        const failureResult = {
          url: website.url,
          strategy: 'TOTAL_FAILURE',
          errors: [{ tier: 'all', error: error.message }],
          testMetadata: {
            website,
            testSession,
            duration: 0,
            expectedStrategy: website.expectedStrategy,
            strategyMatches: false
          }
        };
        
        this.testResults.push(failureResult);
        await this.saveTestResult(failureResult, testSession);
      }
      
      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Generate comprehensive report
    await this.generateComprehensiveReport(testSession);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎉 COMPREHENSIVE TEST COMPLETED');
    console.log(`📊 Results saved to: ${this.reportDir}/${testSession}`);
    console.log(`${'='.repeat(80)}\n`);
  }

  checkStrategyMatch(actualStrategy, expectedPattern) {
    if (expectedPattern.includes('*')) {
      const basePattern = expectedPattern.replace('*', '');
      return actualStrategy.startsWith(basePattern);
    }
    return actualStrategy === expectedPattern;
  }

  printTestSummary(result, duration) {
    console.log(`📊 SCAN RESULT SUMMARY:`);
    console.log(`   🔧 Strategy Used: ${result.strategy}`);
    console.log(`   ⏱️ Duration: ${duration}ms`);
    console.log(`   📈 Errors: ${result.errors.length}`);
    
    if (result.axeResults) {
      console.log(`   🎯 Axe Score: ${result.axeResults.accessibilityScore}%`);
      console.log(`   ⚠️ Violations: ${result.axeResults.violations.length}`);
      console.log(`   ✅ Passes: ${result.axeResults.passes}`);
    }
    
    if (result.fallbackResults) {
      console.log(`   🔄 Fallback Score: ${result.fallbackResults.aggregatedScore}%`);
      console.log(`   📊 Scanner Coverage: ${result.fallbackResults.coverage.join(', ')}`);
      console.log(`   ⚠️ Total Violations: ${result.fallbackResults.totalViolations}`);
    }
    
    console.log(`   🗂️ Screenshots: ${result.screenshots?.length || 'Generated'}`);
    
    if (result.testMetadata.strategyMatches) {
      console.log(`   ✅ Strategy matches expectation`);
    } else {
      console.log(`   ⚠️ Strategy differs from expectation`);
    }
  }

  async saveTestResult(result, testSession) {
    const sessionDir = path.join(this.reportDir, testSession);
    await fs.ensureDir(sessionDir);
    
    const sanitizedUrl = result.url.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedUrl}_${result.strategy}.json`;
    
    await fs.writeJson(
      path.join(sessionDir, filename), 
      result, 
      { spaces: 2 }
    );
  }

  async generateComprehensiveReport(testSession) {
    const sessionDir = path.join(this.reportDir, testSession);
    
    // Calculate overall statistics
    const stats = this.calculateOverallStats();
    
    // Generate HTML report
    const htmlReport = this.generateHTMLReport(stats, testSession);
    
    await fs.writeFile(
      path.join(sessionDir, 'comprehensive-report.html'),
      htmlReport
    );
    
    // Generate summary JSON
    await fs.writeJson(
      path.join(sessionDir, 'test-summary.json'),
      {
        testSession,
        timestamp: new Date().toISOString(),
        totalWebsites: this.testResults.length,
        stats,
        results: this.testResults.map(r => ({
          url: r.url,
          strategy: r.strategy,
          success: !r.errors.length || r.strategy !== 'TOTAL_FAILURE',
          errors: r.errors.length,
          duration: r.testMetadata?.duration || 0
        }))
      },
      { spaces: 2 }
    );
    
    console.log(`\n📈 OVERALL STATISTICS:`);
    console.log(`   🎯 Total Websites: ${stats.totalWebsites}`);
    console.log(`   ✅ Successful Scans: ${stats.successfulScans}`);
    console.log(`   🔧 Tier 1 (Standard): ${stats.tier1Success}`);
    console.log(`   🛠️ Tier 2 (Mitigation): ${stats.tier2Success}`);
    console.log(`   🔄 Tier 3 (Fallback): ${stats.tier3Success}`);
    console.log(`   ❌ Total Failures: ${stats.totalFailures}`);
    console.log(`   📊 Success Rate: ${stats.successRate}%`);
  }

  calculateOverallStats() {
    const totalWebsites = this.testResults.length;
    let tier1Success = 0;
    let tier2Success = 0;
    let tier3Success = 0;
    let totalFailures = 0;
    
    this.testResults.forEach(result => {
      if (result.strategy === 'TOTAL_FAILURE') {
        totalFailures++;
      } else if (result.strategy === 'StandardAxe') {
        tier1Success++;
      } else if (result.strategy.startsWith('CSPMitigation_')) {
        tier2Success++;
      } else if (result.strategy === 'AxeIndependentFallback') {
        tier3Success++;
      }
    });
    
    const successfulScans = tier1Success + tier2Success + tier3Success;
    const successRate = totalWebsites > 0 ? Math.round((successfulScans / totalWebsites) * 100) : 0;
    
    return {
      totalWebsites,
      successfulScans,
      tier1Success,
      tier2Success,
      tier3Success,
      totalFailures,
      successRate
    };
  }

  generateHTMLReport(stats, testSession) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Resilient Accessibility Scanner Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #007cba; color: white; padding: 20px; border-radius: 5px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat-card { background: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center; }
        .stat-value { font-size: 2em; font-weight: bold; color: #007cba; }
        .results-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .results-table th, .results-table td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        .results-table th { background: #f2f2f2; }
        .strategy-standard { background: #d4edda; }
        .strategy-mitigation { background: #fff3cd; }
        .strategy-fallback { background: #f8d7da; }
        .strategy-failure { background: #f5c6cb; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Resilient Accessibility Scanner Test Report</h1>
        <p>Test Session: ${testSession}</p>
        <p>Generated: ${new Date().toISOString()}</p>
    </div>
    
    <div class="stats">
        <div class="stat-card">
            <div class="stat-value">${stats.totalWebsites}</div>
            <div>Total Websites</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.successRate}%</div>
            <div>Success Rate</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.tier1Success}</div>
            <div>Tier 1 (Standard)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.tier2Success}</div>
            <div>Tier 2 (Mitigation)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.tier3Success}</div>
            <div>Tier 3 (Fallback)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.totalFailures}</div>
            <div>Total Failures</div>
        </div>
    </div>
    
    <table class="results-table">
        <thead>
            <tr>
                <th>Website</th>
                <th>Category</th>
                <th>Strategy Used</th>
                <th>Score</th>
                <th>Violations</th>
                <th>Duration (ms)</th>
                <th>Errors</th>
            </tr>
        </thead>
        <tbody>
            ${this.testResults.map(result => `
                <tr class="strategy-${this.getStrategyClass(result.strategy)}">
                    <td><a href="${result.url}" target="_blank">${result.url}</a></td>
                    <td>${result.testMetadata?.website?.category || 'Unknown'}</td>
                    <td>${result.strategy}</td>
                    <td>${this.getScore(result)}</td>
                    <td>${this.getViolations(result)}</td>
                    <td>${result.testMetadata?.duration || 0}</td>
                    <td>${result.errors.length}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</body>
</html>`;
  }

  getStrategyClass(strategy) {
    if (strategy === 'StandardAxe') return 'standard';
    if (strategy.startsWith('CSPMitigation_')) return 'mitigation';
    if (strategy === 'AxeIndependentFallback') return 'fallback';
    return 'failure';
  }

  getScore(result) {
    if (result.axeResults) return `${result.axeResults.accessibilityScore}%`;
    if (result.fallbackResults) return `${result.fallbackResults.aggregatedScore}%`;
    return 'N/A';
  }

  getViolations(result) {
    if (result.axeResults) return result.axeResults.violations.length;
    if (result.fallbackResults) return result.fallbackResults.totalViolations;
    return 'N/A';
  }

  async cleanup() {
    await this.scanner.close();
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new ResilientScannerTester();
  
  tester.init()
    .then(() => tester.runComprehensiveTest())
    .then(() => tester.cleanup())
    .then(() => {
      console.log('✅ All tests completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = ResilientScannerTester;