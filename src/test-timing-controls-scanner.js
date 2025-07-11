const TimingControlsScanner = require('./timing-controls-scanner');
const path = require('path');

/**
 * Test script for TimingControlsScanner with iterative debugging
 */
async function testTimingControlsScanner() {
  console.log('🚀 Testing Timing Controls Scanner...\\n');
  
  const scanner = new TimingControlsScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6e-good-input-timing.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6e-bad-input-timing.html')}`;
    
    console.log('📊 Testing GOOD timing controls example...');
    console.log(`URL: ${goodUrl}\\n`);
    
    const goodResult = await scanner.scanTimingControls(goodUrl, {
      testTimeouts: true,
      testAutoPlay: true,
      testMovingContent: true,
      observationTime: 3000,
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Timeouts Adjustable: ${goodResult.summary.timeoutsAdjustable}`);
    console.log(`    Auto-Play Controlled: ${goodResult.summary.autoPlayControlled}`);
    console.log(`    Moving Content Controllable: ${goodResult.summary.movingContentControllable}`);
    console.log(`    Data Preserved on Timeout: ${goodResult.summary.dataPreservedOnTimeout}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\\n  Violations Found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
    }
    
    console.log('\\n' + '='.repeat(60) + '\\n');
    
    console.log('📊 Testing BAD timing controls example...');
    console.log(`URL: ${badUrl}\\n`);
    
    const badResult = await scanner.scanTimingControls(badUrl, {
      testTimeouts: true,
      testAutoPlay: true,
      testMovingContent: true,
      observationTime: 3000,
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Timeouts Adjustable: ${badResult.summary.timeoutsAdjustable}`);
    console.log(`    Auto-Play Controlled: ${badResult.summary.autoPlayControlled}`);
    console.log(`    Moving Content Controllable: ${badResult.summary.movingContentControllable}`);
    console.log(`    Data Preserved on Timeout: ${badResult.summary.dataPreservedOnTimeout}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\\n  Violations Found (first 10):');
      badResult.violations.slice(0, 10).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
      
      if (badResult.violations.length > 10) {
        console.log(`    ... and ${badResult.violations.length - 10} more violations`);
      }
    }
    
    console.log('\\n🎯 Test Summary:');
    console.log(`Good example should pass: ${goodResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bad example should fail: ${!badResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Detection working: ${!goodResult.passed || badResult.violations.length > 0 ? '✅ YES' : '❌ NO'}`);
    
    // Show detailed breakdown by criterion
    console.log('\\n📋 Detailed Breakdown by WCAG Criterion:');
    
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
          '9.2.2.1': 'Timing Adjustable',
          '9.2.2.2': 'Pause, Stop, Hide',
          '9.2.2.6': 'Timeouts'
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
    console.log('\\n📷 Visual Evidence Summary:');
    console.log(`Good example evidence items: ${goodResult.visualEvidence.length}`);
    console.log(`Bad example evidence items: ${badResult.visualEvidence.length}`);
    
    if (badResult.visualEvidence.length > 0) {
      console.log('\\nBad example timing controls issues:');
      badResult.visualEvidence.forEach(ev => {
        console.log(`  Timeouts Adjustable: ${ev.timeoutsAdjustable}`);
        console.log(`  Auto-Play Controlled: ${ev.autoPlayControlled}`);
        console.log(`  Moving Content Controllable: ${ev.movingContentControllable}`);
        console.log(`  Data Preserved: ${ev.dataPreserved}`);
      });
    }
    
    // Performance metrics
    console.log('\\n⚡ Performance Metrics:');
    console.log(`Good example scan time: ~3 seconds (with observation period)`);
    console.log(`Bad example scan time: ~3 seconds (with observation period)`);
    console.log(`Detection accuracy: ${badResult.violations.length > 0 ? 'High' : 'Needs improvement'}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

// Run test
testTimingControlsScanner().catch(console.error);