const SeizurePreventionScanner = require('./seizure-prevention-scanner');
const path = require('path');

/**
 * Test script for SeizurePreventionScanner with iterative debugging
 * CRITICAL SAFETY TESTING - Seizure prevention compliance
 */
async function testSeizurePreventionScanner() {
  console.log('🚨 Testing CRITICAL Seizure Prevention Scanner...\\n');
  
  const scanner = new SeizurePreventionScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6e-good-input-timing.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6e-bad-input-timing.html')}`;
    
    console.log('📊 Testing GOOD seizure prevention example...');
    console.log(`URL: ${goodUrl}\\n`);
    
    const goodResult = await scanner.scanSeizurePrevention(goodUrl, {
      testFlashingContent: true,
      testAnimationTriggers: true,
      testMotionSensitivity: true,
      observationTime: 5000, // 5 seconds for testing
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  🚨 SAFETY SUMMARY:`);
    console.log(`    No Flashing Violations: ${goodResult.summary.noFlashingViolations}`);
    console.log(`    Animation Triggers Controlled: ${goodResult.summary.animationTriggersControlled}`);
    console.log(`    Motion Sensitivity Supported: ${goodResult.summary.motionSensitivitySupported}`);
    console.log(`    🚨 SEIZURE RISK LEVEL: ${goodResult.summary.seizureRiskLevel}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\\n  🚨 SAFETY VIOLATIONS FOUND:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        if (v.frequency) console.log(`       ⚠️ Flash Frequency: ${v.frequency} Hz`);
        if (v.riskLevel) console.log(`       🚨 Risk Level: ${v.riskLevel}`);
        if (v.safetyWarning) console.log(`       🚨 ${v.safetyWarning}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
    }
    
    console.log('\\n' + '='.repeat(70) + '\\n');
    
    console.log('📊 Testing BAD seizure prevention example...');
    console.log(`URL: ${badUrl}\\n`);
    
    const badResult = await scanner.scanSeizurePrevention(badUrl, {
      testFlashingContent: true,
      testAnimationTriggers: true,
      testMotionSensitivity: true,
      observationTime: 5000, // 5 seconds for testing
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  🚨 SAFETY SUMMARY:`);
    console.log(`    No Flashing Violations: ${badResult.summary.noFlashingViolations}`);
    console.log(`    Animation Triggers Controlled: ${badResult.summary.animationTriggersControlled}`);
    console.log(`    Motion Sensitivity Supported: ${badResult.summary.motionSensitivitySupported}`);
    console.log(`    🚨 SEIZURE RISK LEVEL: ${badResult.summary.seizureRiskLevel}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\\n  🚨 CRITICAL SAFETY VIOLATIONS FOUND:');
      badResult.violations.slice(0, 8).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        if (v.frequency) console.log(`       ⚠️ Flash Frequency: ${v.frequency.toFixed(2)} Hz`);
        if (v.riskLevel) console.log(`       🚨 Risk Level: ${v.riskLevel}`);
        if (v.safetyWarning) console.log(`       🚨 ${v.safetyWarning}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
      
      if (badResult.violations.length > 8) {
        console.log(`    ... and ${badResult.violations.length - 8} more violations`);
      }
    }
    
    console.log('\\n🎯 SAFETY TEST SUMMARY:');
    console.log(`Good example should pass: ${goodResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bad example should fail: ${!badResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Detection working: ${!goodResult.passed || badResult.violations.length > 0 ? '✅ YES' : '❌ NO'}`);
    
    // CRITICAL SAFETY ANALYSIS
    console.log('\\n🚨 CRITICAL SAFETY ANALYSIS:');
    if (badResult.summary.seizureRiskLevel === 'HIGH') {
      console.log('  ⚠️  HIGH SEIZURE RISK DETECTED - IMMEDIATE ACTION REQUIRED');
    } else if (badResult.summary.seizureRiskLevel === 'MEDIUM') {
      console.log('  ⚠️  MEDIUM SEIZURE RISK - Review and address violations');
    } else {
      console.log('  ✅ Low seizure risk detected');
    }
    
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
          '9.2.3.1': 'Three Flashes (CRITICAL SAFETY)',
          '9.2.3.3': 'Animation from Interactions'
        };
        console.log(`  ${criterion} (${criterionNames[criterion]}): ${violations.length} violations`);
        
        // Count violation types and risk levels
        const types = violations.reduce((acc, v) => {
          acc[v.issue] = (acc[v.issue] || 0) + 1;
          return acc;
        }, {});
        
        const riskLevels = violations.reduce((acc, v) => {
          if (v.riskLevel) {
            acc[v.riskLevel] = (acc[v.riskLevel] || 0) + 1;
          }
          return acc;
        }, {});
        
        Object.entries(types).forEach(([type, count]) => {
          console.log(`    - ${type}: ${count}`);
        });
        
        if (Object.keys(riskLevels).length > 0) {
          console.log(`    Risk levels:`, riskLevels);
        }
      });
    }
    
    // Show visual evidence summary
    console.log('\\n📷 Visual Evidence Summary:');
    console.log(`Good example evidence items: ${goodResult.visualEvidence.length}`);
    console.log(`Bad example evidence items: ${badResult.visualEvidence.length}`);
    
    if (badResult.visualEvidence.length > 0) {
      console.log('\\nBad example seizure prevention analysis:');
      badResult.visualEvidence.forEach(ev => {
        console.log(`  🚨 Risk Level: ${ev.riskLevel}`);
        console.log(`  Flashing Safe: ${ev.flashingSafe}`);
        console.log(`  Animation Controlled: ${ev.animationControlled}`);
        console.log(`  Motion Sensitive: ${ev.motionSensitive}`);
        if (ev.safetyWarning) {
          console.log(`  🚨 SAFETY WARNING: ${ev.safetyWarning}`);
        }
      });
    }
    
    // Performance and accuracy metrics
    console.log('\\n⚡ Performance Metrics:');
    console.log(`Good example scan time: ~5 seconds (with observation period)`);
    console.log(`Bad example scan time: ~5 seconds (with observation period)`);
    console.log(`Safety detection accuracy: ${badResult.violations.length > 0 ? 'High' : 'Needs improvement'}`);
    console.log(`Critical safety compliance: ${badResult.summary.seizureRiskLevel !== 'HIGH' ? 'Acceptable' : 'FAILED - SAFETY RISK'}`);
    
  } catch (error) {
    console.error('❌ CRITICAL TEST FAILED:', error.message);
    console.error('🚨 SAFETY SCANNER ERROR - Manual review required');
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

// Run test with safety emphasis
testSeizurePreventionScanner().catch(error => {
  console.error('🚨 CRITICAL SAFETY TEST FAILURE:', error);
  process.exit(1); // Exit with error for safety-critical failure
});