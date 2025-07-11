const EnhancedAccessibilityScanner = require('./src/enhanced-scanner');

async function testPhase6DIntegration() {
  console.log('Testing Enhanced Scanner with Phase 6D integration...\n');
  
  const scanner = new EnhancedAccessibilityScanner();
  
  try {
    const result = await scanner.enhancedScan('https://webaim.org/', {
      includePhase6D: true,
      timeout: 30000
    });
    
    console.log('Debug - Full result structure:');
    console.log('phase6DCompliance exists:', !!result.phase6DCompliance);
    console.log('phase6DScore:', result.phase6DScore);
    console.log('phase6DViolations:', result.phase6DViolations);
    
    if (result.phase6DCompliance) {
      console.log('\n📋 Phase 6D Results:');
      console.log(`  Phase 6D Score: ${result.phase6DScore}%`);
      console.log(`  Phase 6D Violations: ${result.phase6DViolations}`);
      
      console.log('\n  Language Detection:');
      console.log(`    Passed: ${result.phase6DCompliance.language.passed}`);
      console.log(`    Violations: ${result.phase6DCompliance.language.violations.length}`);
      console.log(`    Page Language Set: ${result.phase6DCompliance.language.summary.pageLanguageSet}`);
      console.log(`    Page Language Valid: ${result.phase6DCompliance.language.summary.pageLanguageValid}`);
      
      console.log('\n  HTML Validation:');
      console.log(`    Passed: ${result.phase6DCompliance.htmlValidation.passed}`);
      console.log(`    Violations: ${result.phase6DCompliance.htmlValidation.violations.length}`);
      console.log(`    Syntax Errors: ${result.phase6DCompliance.htmlValidation.summary.syntaxErrors}`);
      console.log(`    Duplicate IDs: ${result.phase6DCompliance.htmlValidation.summary.duplicateIds}`);
    } else {
      console.log('Phase 6D compliance data missing from result');
    }
    
    if (result.categories) {
      console.log('\n🎯 WCAG Principle Scores:');
      console.log(`  Perceivable: ${result.categories.perceivable.score}% (${result.categories.perceivable.violations} violations)`);
      console.log(`  Operable: ${result.categories.operable.score}% (${result.categories.operable.violations} violations)`);
      console.log(`  Understandable: ${result.categories.understandable.score}% (${result.categories.understandable.violations} violations)`);
      console.log(`  Robust: ${result.categories.robust.score}% (${result.categories.robust.violations} violations)`);
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

testPhase6DIntegration().catch(console.error);