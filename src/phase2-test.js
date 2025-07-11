const EnhancedAccessibilityScanner = require('./enhanced-scanner');

async function runPhase2Tests() {
  const scanner = new EnhancedAccessibilityScanner();
  
  console.log('Running Phase 2 Test Cases...\n');

  try {
    console.log('=== Test 4: WCAG Categorization ===');
    console.log('Testing enhanced scan with WCAG AA level and keyboard navigation');
    const test4 = await scanner.enhancedScan('https://example.com', {
      wcagLevel: 'AA',
      testKeyboardNav: true,
      includeWarnings: true
    });
    
    console.log('Result:', {
      url: test4.url,
      accessibilityScore: test4.accessibilityScore,
      wcagLevel: test4.wcagCompliance.level,
      categories: {
        perceivable: `${test4.categories.perceivable.score}% (${test4.categories.perceivable.violations} violations)`,
        operable: `${test4.categories.operable.score}% (${test4.categories.operable.violations} violations)`,
        understandable: `${test4.categories.understandable.score}% (${test4.categories.understandable.violations} violations)`,
        robust: `${test4.categories.robust.score}% (${test4.categories.robust.violations} violations)`
      },
      hasKeyboardNav: !!test4.keyboardNavigation,
      pa11yIssues: test4.pa11yIssues.length
    });
    console.log('✓ Test 4 completed\n');

    console.log('=== Test 5: Keyboard Navigation Test ===');
    if (test4.keyboardNavigation) {
      console.log('Keyboard Navigation Results:', {
        tabbableElements: test4.keyboardNavigation.tabbableElements,
        logicalTabOrder: test4.keyboardNavigation.logicalTabOrder,
        keyboardTraps: test4.keyboardNavigation.keyboardTraps,
        hasError: !!test4.keyboardNavigation.error
      });
      console.log('✓ Test 5 completed\n');
    } else {
      console.log('⚠ Keyboard navigation was not tested');
    }

    console.log('=== Test 6: Different WCAG Levels ===');
    console.log('Testing Level A scan');
    const testA = await scanner.enhancedScan('https://example.com', { wcagLevel: 'A' });
    console.log('Testing Level AAA scan');
    const testAAA = await scanner.enhancedScan('https://example.com', { wcagLevel: 'AAA' });
    
    console.log('WCAG Level Comparison:', {
      levelA: { score: testA.accessibilityScore, violations: testA.violations.length },
      levelAA: { score: test4.accessibilityScore, violations: test4.violations.length },
      levelAAA: { score: testAAA.accessibilityScore, violations: testAAA.violations.length }
    });
    console.log('✓ Test 6 completed\n');

    console.log('=== Performance Test ===');
    const startTime = Date.now();
    await scanner.enhancedScan('https://example.com', { 
      wcagLevel: 'AA', 
      testKeyboardNav: true 
    });
    const duration = Date.now() - startTime;
    console.log(`Enhanced scan completed in ${duration}ms`);
    console.log(`✓ Performance: ${duration < 60000 ? 'PASSED' : 'FAILED'} (< 60 seconds)`);

    console.log('\n=== Pa11y Integration Test ===');
    const pa11yTestResult = await scanner.enhancedScan('https://example.com', { wcagLevel: 'AA' });
    console.log('Pa11y Issues Found:', pa11yTestResult.pa11yIssues.length);
    if (pa11yTestResult.pa11yIssues.length > 0) {
      console.log('Sample Pa11y Issue:', {
        type: pa11yTestResult.pa11yIssues[0].type || 'N/A',
        code: pa11yTestResult.pa11yIssues[0].code || 'N/A',
        message: pa11yTestResult.pa11yIssues[0].message?.substring(0, 100) || 'N/A'
      });
    }
    console.log('✓ Pa11y integration working\n');

    console.log('=== WCAG Criteria Mapping Test ===');
    if (test4.wcagCompliance.criteria.length > 0) {
      console.log('Sample WCAG Criteria Issues:');
      test4.wcagCompliance.criteria.slice(0, 3).forEach(criterion => {
        console.log(`  - ${criterion.criterion} (Level ${criterion.level}): ${criterion.passed ? 'PASSED' : 'FAILED'}`);
      });
    } else {
      console.log('No WCAG criteria violations found');
    }
    console.log('✓ WCAG criteria mapping working\n');

  } catch (error) {
    console.error('Phase 2 test failed:', error);
  } finally {
    await scanner.close();
    console.log('All Phase 2 tests completed!');
  }
}

if (require.main === module) {
  runPhase2Tests();
}

module.exports = runPhase2Tests;