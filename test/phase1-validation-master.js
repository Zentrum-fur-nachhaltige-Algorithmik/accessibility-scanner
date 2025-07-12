const { runUrlValidationTests } = require('./validation/test-input-validation');
const { runSsrfProtectionTests } = require('./security/test-ssrf-protection');
const { testCspBypassPreservation } = require('./security/test-csp-bypass-preservation');
const { runBaseScannerTests } = require('./base/test-domain-scanner');
const { runBrowserPoolPerformanceTests } = require('./performance/test-browser-pool');

async function runPhase1ValidationSuite() {
  console.log('🚀 Phase 1 Master Validation Suite');
  console.log('===================================\n');
  
  const results = {
    phases: [],
    totalTests: 0,
    totalPassed: 0,
    totalFailed: 0,
    startTime: Date.now()
  };
  
  // Phase 1A: Security Validation
  console.log('🔒 Phase 1A: Security Validation');
  try {
    const securityResults = await Promise.all([
      runUrlValidationTests(),
      runSsrfProtectionTests(),
      testCspBypassPreservation()
    ]);
    
    results.phases.push({
      name: 'Security Validation',
      results: securityResults,
      critical: true
    });
  } catch (error) {
    console.error('Security validation failed:', error);
    results.phases.push({
      name: 'Security Validation',
      results: [{ passed: 0, failed: 1, total: 1, error: error.message }],
      critical: true
    });
  }
  
  // Phase 1B: Base Scanner Validation
  console.log('\n🏗️ Phase 1B: Base Scanner Validation');
  try {
    const baseResults = await Promise.all([
      runBaseScannerTests()
    ]);
    
    results.phases.push({
      name: 'Base Scanner Validation',
      results: baseResults,
      critical: true
    });
  } catch (error) {
    console.error('Base scanner validation failed:', error);
    results.phases.push({
      name: 'Base Scanner Validation',
      results: [{ passed: 0, failed: 1, total: 1, error: error.message }],
      critical: true
    });
  }
  
  // Phase 1C: Performance Validation
  console.log('\n⚡ Phase 1C: Performance Validation');
  try {
    const performanceResults = await Promise.all([
      runBrowserPoolPerformanceTests()
    ]);
    
    results.phases.push({
      name: 'Performance Validation',
      results: performanceResults,
      critical: false
    });
  } catch (error) {
    console.error('Performance validation failed:', error);
    results.phases.push({
      name: 'Performance Validation',
      results: [{ passed: 0, failed: 1, total: 1, error: error.message }],
      critical: false
    });
  }
  
  // Calculate totals
  results.phases.forEach(phase => {
    phase.results.forEach(result => {
      results.totalTests += result.total;
      results.totalPassed += result.passed;
      results.totalFailed += result.failed;
    });
  });
  
  results.endTime = Date.now();
  results.duration = results.endTime - results.startTime;
  
  // Generate report
  console.log('\n📊 PHASE 1 VALIDATION SUMMARY');
  console.log('==============================');
  console.log(`Duration: ${Math.round(results.duration / 1000)}s`);
  console.log(`Total Tests: ${results.totalTests}`);
  console.log(`Passed: ${results.totalPassed}`);
  console.log(`Failed: ${results.totalFailed}`);
  console.log(`Success Rate: ${Math.round((results.totalPassed / results.totalTests) * 100)}%`);
  
  // Check critical phases
  const criticalFailures = results.phases.filter(phase => 
    phase.critical && phase.results.some(result => result.failed > 0)
  );
  
  if (criticalFailures.length > 0) {
    console.log('\n❌ CRITICAL FAILURES DETECTED:');
    criticalFailures.forEach(phase => {
      console.log(`   ${phase.name}: Critical phase has failures`);
    });
    console.log('\n🚫 PHASE 1 REFACTORING MUST BE ROLLED BACK');
    return false;
  }
  
  if (results.totalPassed / results.totalTests >= 0.95) {
    console.log('\n✅ PHASE 1 VALIDATION SUCCESSFUL');
    console.log('✅ Ready to proceed to Phase 2');
    return true;
  } else {
    console.log('\n⚠️ PHASE 1 VALIDATION INCOMPLETE');
    console.log('⚠️ Review failed tests before proceeding');
    return false;
  }
}

// Run validation
if (require.main === module) {
  runPhase1ValidationSuite()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Validation suite failed:', error);
      process.exit(1);
    });
}

module.exports = { runPhase1ValidationSuite };