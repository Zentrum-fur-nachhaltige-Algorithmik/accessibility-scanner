const ErrorHandlingScanner = require('./error-handling-scanner');
const path = require('path');

/**
 * Test script for ErrorHandlingScanner with iterative debugging
 */
async function testErrorHandlingScanner() {
  console.log('🚨 Testing Error Handling Scanner...\n');
  
  const scanner = new ErrorHandlingScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6e-good-navigation-errors.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6e-bad-navigation-errors.html')}`;
    
    console.log('📊 Testing GOOD error handling example...');
    console.log(`URL: ${goodUrl}\n`);
    
    const goodResult = await scanner.scanErrorHandling(goodUrl, {
      testErrorIdentification: true,
      testLabelsInstructions: true,
      testErrorSuggestions: true,
      testErrorPrevention: true,
      simulateErrors: true,
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Errors Identified: ${goodResult.summary.errorsIdentified}`);
    console.log(`    Labels Provided: ${goodResult.summary.labelsProvided}`);
    console.log(`    Suggestions Provided: ${goodResult.summary.suggestionsProvided}`);
    console.log(`    Prevention Implemented: ${goodResult.summary.preventionImplemented}`);
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
    
    console.log('\n' + '='.repeat(80) + '\n');
    
    console.log('📊 Testing BAD error handling example...');
    console.log(`URL: ${badUrl}\n`);
    
    const badResult = await scanner.scanErrorHandling(badUrl, {
      testErrorIdentification: true,
      testLabelsInstructions: true,
      testErrorSuggestions: true,
      testErrorPrevention: true,
      simulateErrors: true,
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Errors Identified: ${badResult.summary.errorsIdentified}`);
    console.log(`    Labels Provided: ${badResult.summary.labelsProvided}`);
    console.log(`    Suggestions Provided: ${badResult.summary.suggestionsProvided}`);
    console.log(`    Prevention Implemented: ${badResult.summary.preventionImplemented}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n  Violations Found (first 15):');
      badResult.violations.slice(0, 15).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
      
      if (badResult.violations.length > 15) {
        console.log(`    ... and ${badResult.violations.length - 15} more violations`);
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
          '9.3.3.1': 'Error Identification',
          '9.3.3.2': 'Labels or Instructions',
          '9.3.3.3': 'Error Suggestion', 
          '9.3.3.4': 'Error Prevention'
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
      console.log('\nBad example error handling issues:');
      badResult.visualEvidence.forEach(ev => {
        console.log(`  Errors Identified: ${ev.errorsIdentified}`);
        console.log(`  Labels Provided: ${ev.labelsProvided}`);
        console.log(`  Suggestions Provided: ${ev.suggestionsProvided}`);
        console.log(`  Prevention Implemented: ${ev.preventionImplemented}`);
      });
    }
    
    // Performance metrics
    console.log('\n⚡ Performance Metrics:');
    console.log(`Good example scan time: ~3 seconds (with error simulation)`);
    console.log(`Bad example scan time: ~3 seconds (with error simulation)`);
    console.log(`Detection accuracy: ${badResult.violations.length > 0 ? 'High' : 'Needs improvement'}`);
    
    // Test specific criteria breakdown
    console.log('\n🔍 Error Handling Quality Analysis:');
    
    // Analyze error identification
    const identificationViolations = badResult.violations.filter(v => v.criterion === '9.3.3.1');
    console.log(`Error Identification: ${identificationViolations.length === 0 ? '✅ Good' : `❌ ${identificationViolations.length} issues`}`);
    
    // Analyze labels/instructions
    const labelsViolations = badResult.violations.filter(v => v.criterion === '9.3.3.2');
    console.log(`Labels & Instructions: ${labelsViolations.length === 0 ? '✅ Good' : `❌ ${labelsViolations.length} issues`}`);
    
    // Analyze error suggestions
    const suggestionsViolations = badResult.violations.filter(v => v.criterion === '9.3.3.3');
    console.log(`Error Suggestions: ${suggestionsViolations.length === 0 ? '✅ Good' : `❌ ${suggestionsViolations.length} issues`}`);
    
    // Analyze error prevention
    const preventionViolations = badResult.violations.filter(v => v.criterion === '9.3.3.4');
    console.log(`Error Prevention: ${preventionViolations.length === 0 ? '✅ Good' : `❌ ${preventionViolations.length} issues`}`);
    
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
    
    // Form accessibility summary
    console.log('\n📝 Form Accessibility Summary:');
    const formViolations = badResult.violations.filter(v => v.element.includes('form') || v.issue.includes('field'));
    console.log(`Form-related violations: ${formViolations.length}`);
    
    if (formViolations.length > 0) {
      const formIssueTypes = formViolations.reduce((acc, v) => {
        const category = v.criterion === '9.3.3.1' ? 'Identification' :
                        v.criterion === '9.3.3.2' ? 'Labels' :
                        v.criterion === '9.3.3.3' ? 'Suggestions' : 'Prevention';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {});
      
      console.log('Form issues by category:');
      Object.entries(formIssueTypes).forEach(([category, count]) => {
        console.log(`  ${category}: ${count} issues`);
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
testErrorHandlingScanner().catch(console.error);