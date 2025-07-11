const HTMLValidationScanner = require('./html-validation-scanner');
const path = require('path');

/**
 * Test script for HTMLValidationScanner with iterative debugging
 */
async function testHTMLScanner() {
  console.log('🚀 Testing HTML Validation Scanner...\n');
  
  const scanner = new HTMLValidationScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6d-good-language-html.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6d-bad-language-html.html')}`;
    
    console.log('📊 Testing GOOD HTML example...');
    console.log(`URL: ${goodUrl}\n`);
    
    const goodResult = await scanner.scanHTMLCompliance(goodUrl, {
      strictValidation: true,
      checkAccessibilityMarkup: true,
      validateARIA: true,
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Syntax Errors: ${goodResult.summary.syntaxErrors}`);
    console.log(`    Duplicate IDs: ${goodResult.summary.duplicateIds}`);
    console.log(`    Invalid ARIA: ${goodResult.summary.invalidARIA}`);
    console.log(`    Status Messages Proper: ${goodResult.summary.statusMessagesProper}`);
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
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    console.log('📊 Testing BAD HTML example...');
    console.log(`URL: ${badUrl}\n`);
    
    const badResult = await scanner.scanHTMLCompliance(badUrl, {
      strictValidation: true,
      checkAccessibilityMarkup: true,
      validateARIA: true,
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Syntax Errors: ${badResult.summary.syntaxErrors}`);
    console.log(`    Duplicate IDs: ${badResult.summary.duplicateIds}`);
    console.log(`    Invalid ARIA: ${badResult.summary.invalidARIA}`);
    console.log(`    Status Messages Proper: ${badResult.summary.statusMessagesProper}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      badResult.violations.slice(0, 15).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Severity: ${v.severity}`);
        if (v.attribute) console.log(`       Attribute: ${v.attribute}="${v.value}"`);
        if (v.duplicateId) console.log(`       Duplicate ID: ${v.duplicateId} (${v.occurrences} times)`);
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
    
    // Show detailed breakdown
    console.log('\n📋 Detailed Breakdown:');
    console.log('Good Example:');
    console.log(`  - Syntax/Structure Issues: ${goodResult.summary.syntaxErrors}`);
    console.log(`  - ARIA Issues: ${goodResult.summary.invalidARIA}`);
    console.log(`  - Status Message Issues: ${!goodResult.summary.statusMessagesProper ? 'Yes' : 'No'}`);
    
    console.log('Bad Example:');
    console.log(`  - Syntax/Structure Issues: ${badResult.summary.syntaxErrors}`);
    console.log(`  - ARIA Issues: ${badResult.summary.invalidARIA}`);
    console.log(`  - Status Message Issues: ${!badResult.summary.statusMessagesProper ? 'Yes' : 'No'}`);
    
    // Count violation types
    if (badResult.violations.length > 0) {
      const violationTypes = badResult.violations.reduce((acc, v) => {
        acc[v.issue] = (acc[v.issue] || 0) + 1;
        return acc;
      }, {});
      
      console.log('\nBad example violation types:');
      Object.entries(violationTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count} violations`);
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
testHTMLScanner().catch(console.error);