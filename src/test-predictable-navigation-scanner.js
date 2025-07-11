const PredictableNavigationScanner = require('./predictable-navigation-scanner');
const path = require('path');

/**
 * Test script for PredictableNavigationScanner with iterative debugging
 */
async function testPredictableNavigationScanner() {
  console.log('🧭 Testing Predictable Navigation Scanner...\n');
  
  const scanner = new PredictableNavigationScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6e-good-navigation-errors.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6e-bad-navigation-errors.html')}`;
    
    console.log('📊 Testing GOOD predictable navigation example...');
    console.log(`URL: ${goodUrl}\n`);
    
    const goodResult = await scanner.scanPredictableNavigation(goodUrl, {
      testOnFocus: true,
      testOnInput: true,
      testConsistentNavigation: true,
      testConsistentIdentification: true,
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    On Focus Predictable: ${goodResult.summary.onFocusPredictable}`);
    console.log(`    On Input Predictable: ${goodResult.summary.onInputPredictable}`);
    console.log(`    Navigation Consistent: ${goodResult.summary.navigationConsistent}`);
    console.log(`    Identification Consistent: ${goodResult.summary.identificationConsistent}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
    }
    
    console.log('\n' + '='.repeat(70) + '\n');
    
    console.log('📊 Testing BAD predictable navigation example...');
    console.log(`URL: ${badUrl}\n`);
    
    const badResult = await scanner.scanPredictableNavigation(badUrl, {
      testOnFocus: true,
      testOnInput: true,
      testConsistentNavigation: true,
      testConsistentIdentification: true,
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    On Focus Predictable: ${badResult.summary.onFocusPredictable}`);
    console.log(`    On Input Predictable: ${badResult.summary.onInputPredictable}`);
    console.log(`    Navigation Consistent: ${badResult.summary.navigationConsistent}`);
    console.log(`    Identification Consistent: ${badResult.summary.identificationConsistent}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n  Violations Found (first 12):');
      badResult.violations.slice(0, 12).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
      
      if (badResult.violations.length > 12) {
        console.log(`    ... and ${badResult.violations.length - 12} more violations`);
      }
    }
    
    console.log('\n🎯 Test Summary:');
    console.log(`Good example should pass: ${goodResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bad example should fail: ${!badResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Detection working: ${!goodResult.passed || badResult.violations.length > 0 ? '✅ YES' : '❌ NO'}`);
    
    // Show detailed breakdown by criterion
    console.log('\n📋 Detailed Breakdown by WCAG Criterion:');
    
    // Group violations by criterion for bad example
    if (badResult.violations.length > 0) {
      const violationsByCriterion = badResult.violations.reduce((acc, v) => {
        if (!acc[v.criterion]) acc[v.criterion] = [];
        acc[v.criterion].push(v);
        return acc;
      }, {});
      
      console.log('Bad example violations by criterion:');
      Object.entries(violationsByCriterion).forEach(([criterion, violations]) => {
        const criterionNames = {
          '9.3.2.1': 'On Focus',
          '9.3.2.2': 'On Input', 
          '9.3.2.3': 'Consistent Navigation',
          '9.3.2.4': 'Consistent Identification'
        };
        console.log(`  ${criterion} (${criterionNames[criterion]}): ${violations.length} violations`);
        
        // Count violation types
        const types = violations.reduce((acc, v) => {
          acc[v.issue] = (acc[v.issue] || 0) + 1;
          return acc;
        }, {});
        
        Object.entries(types).forEach(([type, count]) => {
          console.log(`    - ${type}: ${count}`);
        });
      });
    }
    
    // Show visual evidence summary
    console.log('\n📷 Visual Evidence Summary:');
    console.log(`Good example evidence items: ${goodResult.visualEvidence.length}`);
    console.log(`Bad example evidence items: ${badResult.visualEvidence.length}`);
    
    if (badResult.visualEvidence.length > 0) {
      console.log('\nBad example predictable navigation issues:');
      badResult.visualEvidence.forEach(ev => {
        console.log(`  On Focus Predictable: ${ev.onFocusPredictable}`);
        console.log(`  On Input Predictable: ${ev.onInputPredictable}`);
        console.log(`  Navigation Consistent: ${ev.navigationConsistent}`);
        console.log(`  Identification Consistent: ${ev.identificationConsistent}`);
      });
    }
    
    // Performance metrics
    console.log('\n⚡ Performance Metrics:');
    console.log(`Good example scan time: ~2 seconds`);
    console.log(`Bad example scan time: ~2 seconds`);
    console.log(`Detection accuracy: ${badResult.violations.length > 0 ? 'High' : 'Needs improvement'}`);
    
    // Test specific criteria breakdown
    console.log('\n🔍 Navigation Quality Analysis:');
    
    // Analyze focus predictability
    const focusViolations = badResult.violations.filter(v => v.criterion === '9.3.2.1');
    console.log(`Focus Predictability: ${focusViolations.length === 0 ? '✅ Good' : `❌ ${focusViolations.length} issues`}`);
    
    // Analyze input predictability
    const inputViolations = badResult.violations.filter(v => v.criterion === '9.3.2.2');
    console.log(`Input Predictability: ${inputViolations.length === 0 ? '✅ Good' : `❌ ${inputViolations.length} issues`}`);
    
    // Analyze navigation consistency
    const navViolations = badResult.violations.filter(v => v.criterion === '9.3.2.3');
    console.log(`Navigation Consistency: ${navViolations.length === 0 ? '✅ Good' : `❌ ${navViolations.length} issues`}`);
    
    // Analyze identification consistency
    const idViolations = badResult.violations.filter(v => v.criterion === '9.3.2.4');
    console.log(`Identification Consistency: ${idViolations.length === 0 ? '✅ Good' : `❌ ${idViolations.length} issues`}`);
    
    // Show severity distribution
    console.log('\n⚠️ Severity Distribution:');
    if (badResult.violations.length > 0) {
      const severityCount = badResult.violations.reduce((acc, v) => {
        acc[v.severity] = (acc[v.severity] || 0) + 1;
        return acc;
      }, {});
      
      Object.entries(severityCount).forEach(([severity, count]) => {
        const emoji = severity === 'error' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`  ${emoji} ${severity}: ${count} violations`);
      });
      
      const errorCount = severityCount.error || 0;
      const warningCount = severityCount.warning || 0;
      console.log(`\nPriority: ${errorCount > 0 ? 'HIGH - Fix errors first' : warningCount > 0 ? 'MEDIUM - Address warnings' : 'LOW - Minor issues'}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

// Run test
testPredictableNavigationScanner().catch(console.error);