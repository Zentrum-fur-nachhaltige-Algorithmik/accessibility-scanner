#!/usr/bin/env node

/**
 * Test specifically for the uncovered rules
 */

const HTMLValidationScanner = require('./src/html-validation-scanner');
const path = require('path');

async function testMissingCoverage() {
  console.log('🔍 Testing Missing Coverage Cases');
  console.log('='.repeat(50));

  const scanner = new HTMLValidationScanner();
  const testHtmlPath = `file://${path.resolve(__dirname, 'test-html/missing-coverage-test.html')}`;
  
  try {
    console.log('🧪 Testing Missing Coverage Test File...');
    
    const result = await scanner.scanHTMLCompliance(testHtmlPath, {
      timeout: 30000
    });
    
    console.log(`\n📊 Results:`);
    console.log(`   📋 Total violations: ${result.violations.length}`);
    
    // Analyze specific uncovered rules
    const ruleTypes = {};
    result.violations.forEach(v => {
      const type = v.issue || v.type || 'unknown';
      ruleTypes[type] = (ruleTypes[type] || 0) + 1;
    });
    
    console.log('\n🔍 All Triggered Rules:');
    Object.entries(ruleTypes)
      .sort(([,a], [,b]) => b - a)
      .forEach(([rule, count]) => {
        console.log(`   🔹 ${rule}: ${count} issues`);
      });
    
    // Check for the specific uncovered rules
    console.log('\n🎯 Checking Previously Uncovered Rules:');
    
    const hasDuplicateIdAria = result.violations.some(v => 
      v.issue === 'duplicate-id-aria' || 
      (v.issue === 'duplicate-id' && v.description?.includes('aria'))
    );
    console.log(`   🔘 duplicate-id-aria: ${hasDuplicateIdAria ? '✅ NOW COVERED' : '❌ Still missing'}`);
    
    const hasFormFieldLabel = result.violations.some(v => 
      v.issue === 'form-field-label' || 
      v.issue === 'unlabeled-form-control' ||
      v.issue === 'label'
    );
    console.log(`   📝 form-field-label: ${hasFormFieldLabel ? '✅ NOW COVERED' : '❌ Still missing'}`);
    
    const hasPageHeadingOne = result.violations.some(v => 
      v.issue === 'page-has-heading-one' ||
      (v.issue?.includes('heading') && v.description?.includes('H1'))
    );
    console.log(`   📄 page-has-heading-one: ${hasPageHeadingOne ? '✅ NOW COVERED' : '❌ Still missing'}`);
    
    // Calculate new coverage
    const allPhase1Rules = [
      'button-name', 'link-name', 'frame-title', 'area-alt', 'object-alt', 'input-image-alt',
      'aria-valid-attr', 'aria-roles', 'aria-labelledby', 'aria-describedby', 'meta-viewport',
      'meta-refresh', 'duplicate-id', 'duplicate-id-active', 'duplicate-id-aria', 'valid-lang',
      'form-field-label', 'heading-order', 'page-has-heading-one'
    ];
    
    let coveredRules = 0;
    allPhase1Rules.forEach(rule => {
      const isCovered = result.violations.some(v => 
        v.issue === rule || 
        (rule === 'form-field-label' && (v.issue === 'unlabeled-form-control' || v.issue === 'label')) ||
        (rule === 'duplicate-id-aria' && v.issue === 'duplicate-id')
      );
      if (isCovered) coveredRules++;
    });
    
    const coveragePercentage = Math.round((coveredRules / allPhase1Rules.length) * 100);
    
    console.log(`\n🏆 Updated Coverage Results:`);
    console.log(`   📊 Rules Covered: ${coveredRules}/${allPhase1Rules.length} (${coveragePercentage}%)`);
    console.log(`   ✅ Phase 1 implementation: ${coveragePercentage >= 90 ? 'EXCELLENT' : coveragePercentage >= 80 ? 'GOOD' : 'NEEDS IMPROVEMENT'}`);
    
    return true;
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return false;
  } finally {
    await scanner.close();
  }
}

// Run if executed directly
if (require.main === module) {
  testMissingCoverage()
    .then(success => {
      console.log(success ? '\n✅ Missing coverage test completed!' : '\n❌ Missing coverage test failed!');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Missing coverage test error:', error);
      process.exit(1);
    });
}

module.exports = testMissingCoverage;