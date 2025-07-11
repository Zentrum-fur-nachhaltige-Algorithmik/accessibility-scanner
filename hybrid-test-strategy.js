#!/usr/bin/env node

/**
 * Hybrid Test Strategy for Resilient Accessibility Scanner
 * 
 * Combines CSP-protected and CSP-free sites for comprehensive testing:
 * 1. Performance baseline tests (CSP-free, fast)
 * 2. Real-world scenario tests (CSP-protected, comprehensive)
 * 3. Fallback mechanism validation
 */

const ResilientAccessibilityScanner = require('./src/resilient-accessibility-scanner');

class HybridTestStrategy {
  constructor() {
    this.scanner = new ResilientAccessibilityScanner();
    
    // Fast baseline tests (CSP-free sites)
    this.baselineTests = [
      {
        url: 'https://example.com',
        category: 'Baseline-Simple',
        expectedStrategy: 'StandardAxe',
        maxDuration: 5000,
        purpose: 'Performance baseline'
      },
      {
        url: 'https://httpbin.org/html',
        category: 'Baseline-Clean',
        expectedStrategy: 'StandardAxe', 
        maxDuration: 5000,
        purpose: 'Clean HTML baseline'
      },
      {
        url: 'https://jsonplaceholder.typicode.com',
        category: 'Baseline-API',
        expectedStrategy: 'StandardAxe',
        maxDuration: 5000,
        purpose: 'API site baseline'
      }
    ];

    // Real-world scenario tests (CSP-protected)
    this.realWorldTests = [
      {
        url: 'https://www.gov.uk',
        category: 'RealWorld-Government',
        expectedStrategies: ['EvaluateOnNewDocument', 'ModernCDPBypass', 'AxeIndependentFallback'],
        maxDuration: 15000,
        purpose: 'Government CSP protection'
      },
      {
        url: 'https://twitter.com',
        category: 'RealWorld-SocialMedia',
        expectedStrategies: ['EvaluateOnNewDocument', 'ModernCDPBypass', 'AxeIndependentFallback'],
        maxDuration: 30000,
        purpose: 'Heavy CSP + client-side protection'
      },
      {
        url: 'https://www.amazon.com',
        category: 'RealWorld-Ecommerce',
        expectedStrategies: ['StandardAxe', 'EvaluateOnNewDocument'],
        maxDuration: 20000,
        purpose: 'Complex but moderate CSP'
      }
    ];

    // Fallback validation tests (known problematic sites)
    this.fallbackTests = [
      {
        url: 'https://web.mit.edu',
        category: 'Fallback-Complex',
        expectedStrategy: 'AxeIndependentFallback',
        maxDuration: 45000,
        purpose: 'Heavy site requiring fallback'
      }
    ];
  }

  async runHybridTests() {
    console.log('🎯 Hybrid Test Strategy - Comprehensive Accessibility Testing\n');

    const results = {
      baseline: [],
      realWorld: [],
      fallback: [],
      summary: {}
    };

    // Phase 1: Baseline Tests (Fast)
    console.log('⚡ PHASE 1: BASELINE TESTS (Performance & Basic Functionality)');
    console.log('='.repeat(70));
    
    for (const test of this.baselineTests) {
      const result = await this.runSingleTest(test, 'baseline');
      results.baseline.push(result);
    }

    // Phase 2: Real-World Tests (CSP Challenges)
    console.log('\n🌍 PHASE 2: REAL-WORLD TESTS (CSP & Production Scenarios)');
    console.log('='.repeat(70));
    
    for (const test of this.realWorldTests) {
      const result = await this.runSingleTest(test, 'realworld');
      results.realWorld.push(result);
    }

    // Phase 3: Fallback Tests (Extreme Cases)
    console.log('\n🔄 PHASE 3: FALLBACK TESTS (Extreme Cases & Reliability)');
    console.log('='.repeat(70));
    
    for (const test of this.fallbackTests) {
      const result = await this.runSingleTest(test, 'fallback');
      results.fallback.push(result);
    }

    // Generate comprehensive summary
    results.summary = this.generateSummary(results);
    this.printSummary(results.summary);

    return results;
  }

  async runSingleTest(testConfig, phase) {
    console.log(`\n🧪 Testing: ${testConfig.url}`);
    console.log(`📋 Purpose: ${testConfig.purpose}`);
    console.log(`⏱️ Max Duration: ${testConfig.maxDuration}ms`);

    try {
      const startTime = Date.now();
      const scanResult = await this.scanner.resilientScan(testConfig.url);
      const duration = Date.now() - startTime;

      const result = {
        ...testConfig,
        scanResult,
        duration,
        tier: this.determineTier(scanResult.strategy),
        success: scanResult.strategy !== 'TOTAL_FAILURE',
        phase
      };

      this.evaluateResult(result);
      return result;

    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);
      return {
        ...testConfig,
        scanResult: { strategy: 'TOTAL_FAILURE', errors: [{ error: error.message }] },
        duration: 0,
        tier: 0,
        success: false,
        phase,
        error: error.message
      };
    }
  }

  evaluateResult(result) {
    const { testConfig, scanResult, duration, tier, success } = result;

    console.log(`📊 Results:`);
    console.log(`   🔧 Strategy: ${scanResult.strategy}`);
    console.log(`   🎯 Tier: ${tier}`);
    console.log(`   ⏱️ Duration: ${duration}ms`);
    console.log(`   📈 Success: ${success ? '✅' : '❌'}`);

    // Specific validations based on test type
    if (testConfig.expectedStrategy) {
      const strategyMatch = scanResult.strategy === testConfig.expectedStrategy;
      console.log(`   🎪 Expected Strategy: ${strategyMatch ? '✅' : '⚠️'} (${testConfig.expectedStrategy})`);
    }

    if (testConfig.expectedStrategies) {
      const strategyMatch = testConfig.expectedStrategies.includes(scanResult.strategy);
      console.log(`   🎪 Expected Strategies: ${strategyMatch ? '✅' : '⚠️'} (${testConfig.expectedStrategies.join(', ')})`);
    }

    const durationMatch = duration <= testConfig.maxDuration;
    console.log(`   ⏲️ Duration Check: ${durationMatch ? '✅' : '⚠️'} (${duration}ms ≤ ${testConfig.maxDuration}ms)`);

    // Performance assessment for baseline tests
    if (result.phase === 'baseline' && duration > 7000) {
      console.log(`   🐌 Performance Warning: Baseline test took ${duration}ms (expected < 7000ms)`);
    }

    // CSP bypass success for real-world tests
    if (result.phase === 'realworld' && tier === 2) {
      console.log(`   🛡️ CSP Bypass Success: Tier 2 strategy worked!`);
    }
  }

  determineTier(strategy) {
    if (strategy === 'StandardAxe') return 1;
    if (strategy.includes('EvaluateOnNewDocument') || strategy.includes('ModernCDPBypass')) return 2;
    if (strategy === 'AxeIndependentFallback') return 3;
    return 0;
  }

  generateSummary(results) {
    const allResults = [...results.baseline, ...results.realWorld, ...results.fallback];
    
    return {
      total: allResults.length,
      successful: allResults.filter(r => r.success).length,
      tier1: allResults.filter(r => r.tier === 1).length,
      tier2: allResults.filter(r => r.tier === 2).length,
      tier3: allResults.filter(r => r.tier === 3).length,
      
      baseline: {
        total: results.baseline.length,
        successful: results.baseline.filter(r => r.success).length,
        avgDuration: this.calculateAvgDuration(results.baseline)
      },
      
      realWorld: {
        total: results.realWorld.length,
        successful: results.realWorld.filter(r => r.success).length,
        cspBypassSuccess: results.realWorld.filter(r => r.tier === 2).length,
        avgDuration: this.calculateAvgDuration(results.realWorld)
      },
      
      fallback: {
        total: results.fallback.length,
        successful: results.fallback.filter(r => r.success).length,
        avgDuration: this.calculateAvgDuration(results.fallback)
      }
    };
  }

  calculateAvgDuration(results) {
    const successfulResults = results.filter(r => r.success && r.duration > 0);
    if (successfulResults.length === 0) return 0;
    return Math.round(successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length);
  }

  printSummary(summary) {
    console.log('\n' + '='.repeat(80));
    console.log('🏆 HYBRID TEST STRATEGY SUMMARY');
    console.log('='.repeat(80));

    console.log(`📊 Overall: ${summary.successful}/${summary.total} tests successful (${Math.round(summary.successful/summary.total*100)}%)`);
    console.log(`🎯 Tier Distribution: T1=${summary.tier1}, T2=${summary.tier2}, T3=${summary.tier3}`);

    console.log(`\n⚡ Baseline Tests (Performance): ${summary.baseline.successful}/${summary.baseline.total} successful`);
    console.log(`   Average Duration: ${summary.baseline.avgDuration}ms`);

    console.log(`\n🌍 Real-World Tests (CSP): ${summary.realWorld.successful}/${summary.realWorld.total} successful`);
    console.log(`   CSP Bypass Success: ${summary.realWorld.cspBypassSuccess} sites`);
    console.log(`   Average Duration: ${summary.realWorld.avgDuration}ms`);

    console.log(`\n🔄 Fallback Tests (Extreme): ${summary.fallback.successful}/${summary.fallback.total} successful`);
    console.log(`   Average Duration: ${summary.fallback.avgDuration}ms`);

    // Key insights
    console.log(`\n💡 Key Insights:`);
    if (summary.tier2 > 0) {
      console.log(`   ✅ CSP Bypass working: ${summary.tier2} sites successfully bypassed CSP`);
    }
    if (summary.baseline.avgDuration > 7000) {
      console.log(`   ⚠️ Performance issue: Baseline tests averaging ${summary.baseline.avgDuration}ms`);
    }
    if (summary.tier3 > 0) {
      console.log(`   🔄 Fallback reliability: ${summary.tier3} sites required fallback scanners`);
    }
  }

  async cleanup() {
    await this.scanner.close();
  }
}

// Run if executed directly
if (require.main === module) {
  const hybridTester = new HybridTestStrategy();
  
  hybridTester.runHybridTests()
    .then(() => hybridTester.cleanup())
    .then(() => {
      console.log('\n✅ Hybrid testing strategy completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Hybrid testing failed:', error);
      process.exit(1);
    });
}

module.exports = HybridTestStrategy;