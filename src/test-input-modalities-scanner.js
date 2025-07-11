const InputModalitiesScanner = require('./input-modalities-scanner');
const path = require('path');

/**
 * Test script for InputModalitiesScanner with iterative debugging
 */
async function testInputModalitiesScanner() {
  console.log('🚀 Testing Input Modalities Scanner...\\n');
  
  const scanner = new InputModalitiesScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6e-good-input-timing.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6e-bad-input-timing.html')}`;
    
    console.log('📊 Testing GOOD input modalities example...');
    console.log(`URL: ${goodUrl}\\n`);
    
    const goodResult = await scanner.scanInputModalities(goodUrl, {
      testPointerGestures: true,
      testMotionActuation: true,
      testLabelMatching: true,
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Pointer Gestures Accessible: ${goodResult.summary.pointerGesturesAccessible}`);
    console.log(`    Pointer Cancellation Available: ${goodResult.summary.pointerCancellationAvailable}`);
    console.log(`    Label Names Consistent: ${goodResult.summary.labelNamesConsistent}`);
    console.log(`    Motion Alternatives Provided: ${goodResult.summary.motionAlternativesProvided}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\\n  Violations Found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        if (v.visibleText) console.log(`       Visible Text: ${v.visibleText}`);
        if (v.accessibleName) console.log(`       Accessible Name: ${v.accessibleName}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
    }
    
    console.log('\\n' + '='.repeat(60) + '\\n');
    
    console.log('📊 Testing BAD input modalities example...');
    console.log(`URL: ${badUrl}\\n`);
    
    const badResult = await scanner.scanInputModalities(badUrl, {
      testPointerGestures: true,
      testMotionActuation: true,
      testLabelMatching: true,
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Pointer Gestures Accessible: ${badResult.summary.pointerGesturesAccessible}`);
    console.log(`    Pointer Cancellation Available: ${badResult.summary.pointerCancellationAvailable}`);
    console.log(`    Label Names Consistent: ${badResult.summary.labelNamesConsistent}`);
    console.log(`    Motion Alternatives Provided: ${badResult.summary.motionAlternativesProvided}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\\n  Violations Found (first 10):');
      badResult.violations.slice(0, 10).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        if (v.visibleText) console.log(`       Visible Text: ${v.visibleText}`);
        if (v.accessibleName) console.log(`       Accessible Name: ${v.accessibleName}`);
        if (v.textContent) console.log(`       Text Content: ${v.textContent}`);
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
          '9.2.5.1': 'Pointer Gestures',
          '9.2.5.2': 'Pointer Cancellation', 
          '9.2.5.3': 'Label in Name',
          '9.2.5.4': 'Motion Actuation'
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
      console.log('\\nBad example input modalities issues:');
      badResult.visualEvidence.forEach(ev => {
        console.log(`  Gestures Accessible: ${ev.gesturesAccessible}`);
        console.log(`  Cancellation Available: ${ev.cancellationAvailable}`);
        console.log(`  Labels Consistent: ${ev.labelsConsistent}`);
        console.log(`  Motion Alternatives: ${ev.motionAlternatives}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

// Run test
testInputModalitiesScanner().catch(console.error);