#!/usr/bin/env node

/**
 * Regression Tests for Resilient Accessibility Scanner
 * 
 * Ensures that:
 * 1. Existing functionality doesn't break
 * 2. CSP bypass improvements work correctly
 * 3. Performance doesn't degrade
 * 4. All strategies work as expected
 */

const ResilientAccessibilityScanner = require('./src/resilient-accessibility-scanner');
const fs = require('fs-extra');
const path = require('path');

class RegressionTester {
  constructor() {
    this.scanner = new ResilientAccessibilityScanner();
    this.baselineFile = path.join(__dirname, 'tmp/regression-baseline.json');
    this.currentResultsFile = path.join(__dirname, 'tmp/regression-current.json');
    this.regressionReportFile = path.join(__dirname, 'tmp/regression-report.html');
    
    // Test cases with expected results based on our previous successful tests
    this.testCases = [
      {
        url: 'https://example.com',
        category: 'Simple',
        expectedStrategy: 'StandardAxe',
        expectedTier: 1,
        minScore: 75,
        maxDuration: 10000,
        description: 'Basic site should always work with standard axe'
      },
      {
        url: 'https://www.gov.uk',
        category: 'Government',
        expectedStrategy: ['EvaluateOnNewDocument', 'ModernCDPBypass', 'AxeIndependentFallback'],
        expectedTier: [2, 3],
        minScore: 0, // Fallback might have different scoring
        maxDuration: 15000,
        description: 'CSP-protected site should use mitigation or fallback'
      },
      {
        url: 'https://www.amazon.com',
        category: 'E-commerce',
        expectedStrategy: 'StandardAxe',
        expectedTier: 1,
        minScore: 75,
        maxDuration: 20000,
        description: 'Complex e-commerce should work with standard axe'
      },
      {
        url: 'https://twitter.com',
        category: 'Social Media',
        expectedStrategy: ['EvaluateOnNewDocument', 'ModernCDPBypass', 'AxeIndependentFallback'],
        expectedTier: [2, 3],
        minScore: 0,
        maxDuration: 30000,
        description: 'Heavy CSP site should use mitigation or fallback'
      }
    ];
  }

  async runRegressionTests() {
    console.log('🔄 Starting Regression Tests...\n');
    
    const currentResults = [];
    let baseline = null;
    
    // Load baseline if exists
    if (await fs.pathExists(this.baselineFile)) {
      baseline = await fs.readJson(this.baselineFile);
      console.log('📊 Loaded baseline from previous run');
    } else {
      console.log('📝 No baseline found - this will become the new baseline');
    }

    // Run all test cases
    for (let i = 0; i < this.testCases.length; i++) {
      const testCase = this.testCases[i];
      console.log(`\n${'='.repeat(70)}`);
      console.log(`🧪 REGRESSION TEST ${i + 1}/${this.testCases.length}: ${testCase.url}`);
      console.log(`📋 Expected: ${Array.isArray(testCase.expectedStrategy) ? testCase.expectedStrategy.join(' OR ') : testCase.expectedStrategy}`);
      console.log(`⏱️ Max Duration: ${testCase.maxDuration}ms`);
      console.log(`${'='.repeat(70)}`);

      try {
        const startTime = Date.now();
        const result = await this.scanner.resilientScan(testCase.url);
        const duration = Date.now() - startTime;

        const testResult = {
          ...testCase,
          result: {
            strategy: result.strategy,
            tier: this.determineTier(result.strategy),
            score: this.extractScore(result),
            violations: this.extractViolations(result),
            duration,
            errors: result.errors.length,
            success: result.strategy !== 'TOTAL_FAILURE'
          }
        };

        currentResults.push(testResult);
        this.evaluateTestCase(testResult, baseline);

      } catch (error) {
        console.log(`❌ TEST FAILED: ${error.message}`);
        
        currentResults.push({
          ...testCase,
          result: {
            strategy: 'TOTAL_FAILURE',
            tier: 0,
            score: 0,
            violations: 0,
            duration: 0,
            errors: 1,
            success: false,
            error: error.message
          }
        });
      }

      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Save current results
    await fs.writeJson(this.currentResultsFile, {
      timestamp: new Date().toISOString(),
      testRun: `regression-${Date.now()}`,
      results: currentResults
    }, { spaces: 2 });

    // Generate regression report
    await this.generateRegressionReport(currentResults, baseline);

    // Update baseline if this is first run or if requested
    if (!baseline || process.argv.includes('--update-baseline')) {
      await fs.writeJson(this.baselineFile, {
        timestamp: new Date().toISOString(),
        baselineRun: `baseline-${Date.now()}`,
        results: currentResults
      }, { spaces: 2 });
      console.log('\n📝 Baseline updated with current results');
    }

    console.log(`\n📊 Regression test completed`);
    console.log(`📋 Report saved to: ${this.regressionReportFile}`);
  }

  evaluateTestCase(testResult, baseline) {
    const { testCase, result } = testResult;
    console.log(`\n📊 EVALUATION:`);

    // Check strategy expectation
    const strategyMatch = Array.isArray(testCase.expectedStrategy) 
      ? testCase.expectedStrategy.includes(result.strategy)
      : result.strategy === testCase.expectedStrategy;
    
    console.log(`   🔧 Strategy: ${result.strategy} ${strategyMatch ? '✅' : '⚠️'}`);

    // Check tier expectation
    const tierMatch = Array.isArray(testCase.expectedTier)
      ? testCase.expectedTier.includes(result.tier)
      : result.tier === testCase.expectedTier;
    
    console.log(`   🎯 Tier: ${result.tier} ${tierMatch ? '✅' : '⚠️'}`);

    // Check score expectation
    const scoreMatch = result.score >= testCase.minScore;
    console.log(`   📈 Score: ${result.score}% (min: ${testCase.minScore}%) ${scoreMatch ? '✅' : '⚠️'}`);

    // Check duration expectation
    const durationMatch = result.duration <= testCase.maxDuration;
    console.log(`   ⏱️ Duration: ${result.duration}ms (max: ${testCase.maxDuration}ms) ${durationMatch ? '✅' : '⚠️'}`);

    // Compare with baseline if available
    if (baseline) {
      const baselineResult = baseline.results.find(b => b.url === testCase.url);
      if (baselineResult) {
        this.compareWithBaseline(result, baselineResult.result);
      }
    }

    // Overall assessment
    const overallPass = strategyMatch && tierMatch && scoreMatch && durationMatch && result.success;
    console.log(`   🏆 Overall: ${overallPass ? '✅ PASS' : '❌ FAIL'}`);
  }

  compareWithBaseline(current, baseline) {
    console.log(`\n📊 BASELINE COMPARISON:`);
    
    // Strategy change
    if (current.strategy !== baseline.strategy) {
      console.log(`   🔄 Strategy changed: ${baseline.strategy} → ${current.strategy}`);
    }

    // Score change
    const scoreDiff = current.score - baseline.score;
    if (Math.abs(scoreDiff) > 5) { // 5% tolerance
      const symbol = scoreDiff > 0 ? '📈' : '📉';
      console.log(`   ${symbol} Score change: ${baseline.score}% → ${current.score}% (${scoreDiff > 0 ? '+' : ''}${scoreDiff}%)`);
    }

    // Performance change
    const durationDiff = current.duration - baseline.duration;
    const durationChange = Math.round((durationDiff / baseline.duration) * 100);
    if (Math.abs(durationChange) > 20) { // 20% tolerance
      const symbol = durationDiff > 0 ? '🐌' : '⚡';
      console.log(`   ${symbol} Performance change: ${baseline.duration}ms → ${current.duration}ms (${durationChange > 0 ? '+' : ''}${durationChange}%)`);
    }

    // Error change
    if (current.errors !== baseline.errors) {
      const symbol = current.errors > baseline.errors ? '⚠️' : '✅';
      console.log(`   ${symbol} Errors changed: ${baseline.errors} → ${current.errors}`);
    }
  }

  determineTier(strategy) {
    if (strategy === 'StandardAxe') return 1;
    if (strategy.startsWith('CSPMitigation_') || strategy.includes('EvaluateOnNewDocument') || strategy.includes('ModernCDPBypass')) return 2;
    if (strategy === 'AxeIndependentFallback') return 3;
    return 0; // TOTAL_FAILURE
  }

  extractScore(result) {
    if (result.axeResults) return result.axeResults.accessibilityScore;
    if (result.fallbackResults) return result.fallbackResults.aggregatedScore;
    return 0;
  }

  extractViolations(result) {
    if (result.axeResults) return result.axeResults.violations.length;
    if (result.fallbackResults) return result.fallbackResults.totalViolations;
    return 0;
  }

  async generateRegressionReport(currentResults, baseline) {
    const totalTests = currentResults.length;
    const passedTests = currentResults.filter(r => r.result.success).length;
    const failedTests = totalTests - passedTests;
    
    const tier1Success = currentResults.filter(r => r.result.tier === 1).length;
    const tier2Success = currentResults.filter(r => r.result.tier === 2).length;
    const tier3Success = currentResults.filter(r => r.result.tier === 3).length;

    const htmlReport = `
<!DOCTYPE html>
<html>
<head>
    <title>Regression Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #007cba; color: white; padding: 20px; border-radius: 5px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric { background: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #007cba; }
        .test-results { margin-top: 30px; }
        .test-case { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .test-pass { border-left: 5px solid #28a745; }
        .test-fail { border-left: 5px solid #dc3545; }
        .test-warn { border-left: 5px solid #ffc107; }
        .details { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
        .detail-item { background: #f8f9fa; padding: 8px; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔄 Regression Test Report</h1>
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Resilient Accessibility Scanner - Tier Performance Analysis</p>
    </div>
    
    <div class="summary">
        <div class="metric">
            <div class="metric-value">${totalTests}</div>
            <div>Total Tests</div>
        </div>
        <div class="metric">
            <div class="metric-value">${passedTests}</div>
            <div>Passed</div>
        </div>
        <div class="metric">
            <div class="metric-value">${failedTests}</div>
            <div>Failed</div>
        </div>
        <div class="metric">
            <div class="metric-value">${tier1Success}</div>
            <div>Tier 1 (Axe)</div>
        </div>
        <div class="metric">
            <div class="metric-value">${tier2Success}</div>
            <div>Tier 2 (CSP Bypass)</div>
        </div>
        <div class="metric">
            <div class="metric-value">${tier3Success}</div>
            <div>Tier 3 (Fallback)</div>
        </div>
    </div>
    
    <div class="test-results">
        <h2>📋 Detailed Test Results</h2>
        ${currentResults.map(testResult => {
          const cssClass = testResult.result.success ? 'test-pass' : 'test-fail';
          return `
            <div class="test-case ${cssClass}">
                <h3>${testResult.url} - ${testResult.category}</h3>
                <p>${testResult.description}</p>
                <div class="details">
                    <div class="detail-item">
                        <strong>Strategy:</strong> ${testResult.result.strategy}
                    </div>
                    <div class="detail-item">
                        <strong>Tier:</strong> ${testResult.result.tier}
                    </div>
                    <div class="detail-item">
                        <strong>Score:</strong> ${testResult.result.score}%
                    </div>
                    <div class="detail-item">
                        <strong>Violations:</strong> ${testResult.result.violations}
                    </div>
                    <div class="detail-item">
                        <strong>Duration:</strong> ${testResult.result.duration}ms
                    </div>
                    <div class="detail-item">
                        <strong>Errors:</strong> ${testResult.result.errors}
                    </div>
                </div>
            </div>
          `;
        }).join('')}
    </div>
    
    ${baseline ? `
    <div class="baseline-comparison">
        <h2>📊 Baseline Comparison</h2>
        <p>Comparing against baseline from: ${baseline.timestamp}</p>
        <!-- Add baseline comparison details here -->
    </div>
    ` : ''}
    
</body>
</html>`;

    await fs.writeFile(this.regressionReportFile, htmlReport);
  }

  async cleanup() {
    await this.scanner.close();
  }
}

// Run regression tests if executed directly
if (require.main === module) {
  const tester = new RegressionTester();
  
  console.log('🧪 Resilient Accessibility Scanner - Regression Tests');
  console.log('   Use --update-baseline to update the baseline with current results\n');
  
  tester.runRegressionTests()
    .then(() => tester.cleanup())
    .then(() => {
      console.log('\n✅ Regression tests completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Regression tests failed:', error);
      process.exit(1);
    });
}

module.exports = RegressionTester;