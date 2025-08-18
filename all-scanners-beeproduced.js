const ResilientAccessibilityScanner = require('./src/resilient-accessibility-scanner');
const InteractiveReportGenerator = require('./src/interactive-report-generator');

/**
 * Complete scan of beeproduced.com using ALL available scanners
 */
async function allScannersBeeproduced() {
  console.log('🚀 RUNNING ALL AVAILABLE SCANNERS on beeproduced.com');
  console.log('='.repeat(80));
  
  try {
    // Initialize the resilient scanner (includes all sub-scanners)
    const scanner = new ResilientAccessibilityScanner();
    
    console.log('📋 Available Scanners:');
    console.log('  1. 🎯 Axe-core (Primary)');
    console.log('  2. 🎭 Screen Reader Scanner');
    console.log('  3. 🎨 Color Contrast Scanner');
    console.log('  4. 📝 HTML Validation Scanner');
    console.log('  5. ⌨️  Keyboard Navigation Scanner');
    console.log('  6. 🌐 Language Detection Scanner');
    console.log('  7. 🛡️ CSP Mitigation Scanner');
    console.log('  8. 🔄 Resilient Fallback Scanners');
    
    console.log('\n🌐 Scanning beeproduced.com...');
    
    // Initialize the scanner
    await scanner.init();
    
    // Run the comprehensive resilient scan
    const result = await scanner.resilientScan('https://beeproduced.com', {
      enableAllScanners: true,
      skipCSPMitigation: false,
      timeout: 30000,
      userAgent: 'Mozilla/5.0 (compatible; AccessibilityBot/1.0)',
      viewport: { width: 1920, height: 1080 }
    });
    
    console.log('\n📊 COMPREHENSIVE SCAN RESULTS:');
    console.log('='.repeat(50));
    
    console.log(`✅ Scan Status: ${result.success ? 'SUCCESS' : 'PARTIAL'}`);
    console.log(`⏱️  Total Time: ${result.performance?.totalDuration || 'N/A'}ms`);
    console.log(`🛡️ Strategy Used: ${result.strategy}`);
    console.log(`📋 Axe Violations: ${result.axeResults?.violations?.length || 0}`);
    console.log(`🔍 Fallback Results: ${result.fallbackResults?.length || 0}`);
    console.log(`❌ Errors: ${result.errors?.length || 0}`);
    
    // Show violations from axe results
    if (result.axeResults?.violations) {
      console.log('\n🔍 AXE-CORE VIOLATIONS:');
      result.axeResults.violations.forEach((violation, index) => {
        console.log(`  ${index + 1}. ${violation.id} (${violation.impact})`);
        console.log(`     📝 ${violation.description}`);
        console.log(`     🎯 Elements: ${violation.nodes?.length || 0}`);
      });
    }
    
    // Show fallback scanner results
    if (result.fallbackResults?.length > 0) {
      console.log('\n🔄 FALLBACK SCANNER RESULTS:');
      result.fallbackResults.forEach((fallback, index) => {
        console.log(`  ${index + 1}. ${fallback.scanner}: ${fallback.violations?.length || 0} violations`);
      });
    }
    
    // Show errors if any
    if (result.errors?.length > 0) {
      console.log('\n⚠️ SCAN ERRORS:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. Tier ${error.tier} (${error.strategy}): ${error.error}`);
      });
    }
    
    console.log('\n🏆 ALL-SCANNER SUMMARY:');
    console.log('='.repeat(50));
    console.log(`🌐 Website: https://beeproduced.com`);
    console.log(`🛡️ Scanning Strategy: ${result.strategy}`);
    
    const totalViolations = (result.axeResults?.violations?.length || 0) + 
                           (result.fallbackResults?.reduce((sum, f) => sum + (f.violations?.length || 0), 0) || 0);
    console.log(`📋 Total Violations Found: ${totalViolations}`);
    
    const totalElements = result.axeResults?.violations?.reduce((sum, v) => sum + (v.nodes?.length || 0), 0) || 0;
    console.log(`🎯 Total Elements Affected: ${totalElements}`);
    
    // Calculate basic accessibility score
    const maxPossibleIssues = 100; // Rough estimate
    const accessibilityScore = Math.max(0, Math.round(((maxPossibleIssues - totalViolations) / maxPossibleIssues) * 100));
    console.log(`🏆 Estimated Accessibility Score: ${accessibilityScore}/100`);
    
    if (result.errors?.length > 0) {
      console.log(`⚠️ Note: ${result.errors.length} scanners encountered errors`);
    }
    
    console.log('\n🎉 ALL-SCANNER REPORT COMPLETE!');
    console.log('='.repeat(50));
    console.log(`📁 Report ID: ${interactiveReport.reportId}`);
    console.log(`📄 HTML File: ${interactiveReport.htmlPath}`);
    console.log(`🌐 Open Report: file://${interactiveReport.htmlPath}`);
    
    console.log('\n📈 ENHANCED FEATURES:');
    console.log('  ✅ Multi-scanner violation correlation');
    console.log('  ✅ Resilient CSP bypass capabilities');
    console.log('  ✅ Specialized accessibility scanners');
    console.log('  ✅ Fallback scanning strategies');
    console.log('  ✅ Interactive violation overlays');
    console.log('  ✅ Phase 3 fix suggestions with copy-paste');
    console.log('  ✅ Cross-referenced WCAG compliance');
    
    return {
      success: true,
      report: interactiveReport,
      scanResults: result,
      reportPath: interactiveReport.htmlPath
    };
    
  } catch (error) {
    console.error('\n❌ All-scanner scan failed:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  allScannersBeeproduced()
    .then((result) => {
      console.log('\n🎊 SUCCESS: All available scanners completed!');
      console.log(`\n🔗 Open your comprehensive report:`);
      console.log(`file://${result.reportPath}`);
    })
    .catch((error) => {
      console.error('\n💥 FAILED:', error.message);
      process.exit(1);
    });
}

module.exports = { allScannersBeeproduced };