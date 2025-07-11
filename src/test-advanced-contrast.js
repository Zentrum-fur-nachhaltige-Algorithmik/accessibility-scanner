const AdvancedContrastScanner = require('./advanced-contrast-scanner');
const path = require('path');

/**
 * Test script for AdvancedContrastScanner with visual debugging
 */
async function testAdvancedContrastScanner() {
  console.log('🚀 Testing Advanced Contrast Scanner...\n');
  
  const scanner = new AdvancedContrastScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6c-good-responsive.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6c-bad-responsive.html')}`;
    
    console.log('📊 Testing GOOD contrast example...');
    console.log(`URL: ${goodUrl}\n`);
    
    const goodResult = await scanner.scanAdvancedContrast(goodUrl, {
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Non-text Elements Tested: ${goodResult.summary.nonTextElementsTested}`);
    console.log(`    Hover Content Tested: ${goodResult.summary.hoverContentTested}`);
    console.log(`    Graphical Objects Compliant: ${goodResult.summary.graphicalObjectsCompliant}`);
    console.log(`    UI Components Compliant: ${goodResult.summary.uiComponentsCompliant}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Contrast: ${v.contrastRatio?.toFixed(2) || 'N/A'}:1 (need ${v.requiredRatio || 'N/A'}:1)`);
      });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    console.log('📊 Testing BAD contrast example...');
    console.log(`URL: ${badUrl}\n`);
    
    const badResult = await scanner.scanAdvancedContrast(badUrl, {
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Non-text Elements Tested: ${badResult.summary.nonTextElementsTested}`);
    console.log(`    Hover Content Tested: ${badResult.summary.hoverContentTested}`);
    console.log(`    Graphical Objects Compliant: ${badResult.summary.graphicalObjectsCompliant}`);
    console.log(`    UI Components Compliant: ${badResult.summary.uiComponentsCompliant}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      badResult.violations.slice(0, 10).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Element: ${v.element}`);
        console.log(`       Issue: ${v.issue}`);
        console.log(`       Element Type: ${v.elementType}`);
        console.log(`       Contrast: ${v.contrastRatio?.toFixed(2) || 'N/A'}:1 (need ${v.requiredRatio || 'N/A'}:1)`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
      
      if (badResult.violations.length > 10) {
        console.log(`    ... and ${badResult.violations.length - 10} more violations`);
      }
    }
    
    console.log('\n🎯 Test Summary:');
    console.log(`Good example should pass: ${goodResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bad example should fail: ${!badResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Detection working: ${!goodResult.passed || badResult.violations.length > 0 ? '✅ YES' : '❌ NO'}`);
    
    // Show visual evidence summary
    console.log('\n📋 Visual Evidence Summary:');
    console.log(`Good example evidence items: ${goodResult.visualEvidence.length}`);
    console.log(`Bad example evidence items: ${badResult.visualEvidence.length}`);
    
    if (badResult.visualEvidence.length > 0) {
      console.log('\nBad example evidence types:');
      const evidenceTypes = badResult.visualEvidence.reduce((acc, ev) => {
        acc[ev.type] = (acc[ev.type] || 0) + 1;
        return acc;
      }, {});
      
      Object.entries(evidenceTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count} items`);
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
testAdvancedContrastScanner().catch(console.error);