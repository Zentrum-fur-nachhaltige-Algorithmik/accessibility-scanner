const KeyboardNavigationScanner = require('./keyboard-navigation-scanner');
const path = require('path');
const fs = require('fs-extra');

/**
 * Visual debugging test for Keyboard Navigation Scanner
 * Tests both good and bad examples with screenshot analysis
 */
async function testKeyboardVisualDebug() {
  console.log('🔍 Starting Keyboard Navigation Visual Debug Test...\n');

  const scanner = new KeyboardNavigationScanner();
  
  try {
    // Test pages
    const testPages = [
      {
        name: 'Bad Keyboard Example v2',
        path: path.join(__dirname, '../test-pages/phase6b-bad-keyboard-v2.html'),
        expectedViolations: {
          'no-visible-focus': 'Should find links/buttons without focus indicators',
          'not-keyboard-accessible': 'Should find mouse-only elements',
          'illogical-tab-order': 'Should detect CSS grid order mismatch'
        }
      },
      {
        name: 'Good Keyboard Example', 
        path: path.join(__dirname, '../test-pages/phase6b-good-keyboard.html'),
        expectedViolations: {
          'should-be-clean': 'Should have minimal or no violations'
        }
      }
    ];

    for (const testPage of testPages) {
      console.log(`\n📄 Testing: ${testPage.name}`);
      console.log(`File: ${testPage.path}`);
      
      // Convert file path to file:// URL
      const fileUrl = `file://${testPage.path}`;
      
      console.log(`\n🔍 Scanning: ${fileUrl}`);
      
      try {
        const result = await scanner.scanKeyboardAccess(fileUrl, {
          testAllInteractives: true,
          simulateTabbing: true,
          testCustomControls: true,
          timeout: 60000
        });

        console.log(`\n📊 Results for ${testPage.name}:`);
        console.log(`  Criteria: ${result.criteria.join(', ')}`);
        console.log(`  Overall Passed: ${result.passed}`);
        console.log(`  Total Violations: ${result.violations.length}`);
        console.log(`  Screenshots saved to: ${result.screenshotPath}`);
        
        console.log(`\n📈 Summary:`);
        console.log(`  Tabbable Elements: ${result.summary.tabbableElements}`);
        console.log(`  Keyboard Inaccessible: ${result.summary.keyboardInaccessible}`);
        console.log(`  Keyboard Traps: ${result.summary.keyboardTraps}`);
        console.log(`  Custom Shortcuts: ${result.summary.customShortcuts}`);

        if (result.violations.length > 0) {
          console.log(`\n❌ Violations found:`);
          result.violations.forEach((violation, index) => {
            console.log(`  ${index + 1}. [${violation.criterion}] ${violation.issue}`);
            console.log(`     Element: ${violation.element}`);
            console.log(`     Description: ${violation.description}`);
            console.log(`     Suggestion: ${violation.suggestion}`);
            if (violation.keySequence) {
              console.log(`     Key Sequence: ${violation.keySequence.join(' → ')}`);
            }
            console.log('');
          });
        } else {
          console.log(`\n✅ No violations found`);
        }

        if (result.tabOrder && result.tabOrder.length > 0) {
          console.log(`\n🔄 Tab Order (first 10 elements):`);
          result.tabOrder.slice(0, 10).forEach((item, index) => {
            console.log(`  ${index + 1}. ${item.element} (visible focus: ${item.hasVisibleFocus})`);
          });
          if (result.tabOrder.length > 10) {
            console.log(`  ... and ${result.tabOrder.length - 10} more elements`);
          }
        }

        if (result.visualEvidence && result.visualEvidence.length > 0) {
          console.log(`\n📸 Visual Evidence (first 5 steps):`);
          result.visualEvidence.slice(0, 5).forEach((evidence, index) => {
            console.log(`  Step ${evidence.step}: ${evidence.element}`);
            console.log(`    Focus Visible: ${evidence.focusVisible}`);
            console.log(`    Indicators: ${evidence.focusIndicators.join(', ') || 'none'}`);
            console.log(`    Screenshots: ${evidence.beforeScreenshot} → ${evidence.afterScreenshot}`);
          });
        }

        // Validate against expectations
        console.log(`\n🎯 Validation against expectations:`);
        for (const [expectation, description] of Object.entries(testPage.expectedViolations)) {
          if (expectation === 'should-be-clean') {
            const isClean = result.violations.length <= 2; // Allow minimal violations
            console.log(`  ${isClean ? '✅' : '❌'} ${description}: ${result.violations.length} violations`);
          } else {
            const found = result.violations.some(v => v.issue === expectation);
            console.log(`  ${found ? '✅' : '❌'} ${description}: ${found ? 'Found' : 'Not found'}`);
          }
        }

        // Manual review instructions
        console.log(`\n👁️  Manual Review Instructions:`);
        console.log(`  1. Open screenshots folder: ${result.screenshotPath}`);
        console.log(`  2. Review tab sequence screenshots for visible focus indicators`);
        console.log(`  3. Check if focus indicators are clearly visible against backgrounds`);
        console.log(`  4. Verify tab order follows logical visual sequence`);
        console.log(`  5. Look for focus traps in modal screenshots`);
        
      } catch (error) {
        console.error(`❌ Error testing ${testPage.name}:`, error.message);
        console.error('Stack:', error.stack);
      }
    }

    // Summary
    console.log(`\n🎯 Visual Debug Test Complete!`);
    console.log(`\nNext steps:`);
    console.log(`1. Review screenshots in tmp/keyboard-screenshots/`);
    console.log(`2. Manually verify that violations are correctly identified`);
    console.log(`3. Check false positives/negatives`);
    console.log(`4. Adjust scanner logic if needed`);

  } catch (error) {
    console.error('❌ Visual debug test failed:', error);
  } finally {
    await scanner.close();
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testKeyboardVisualDebug().catch(console.error);
}

module.exports = testKeyboardVisualDebug;