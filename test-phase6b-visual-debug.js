const KeyboardNavigationScanner = require('./src/keyboard-navigation-scanner');
const FocusManagementScanner = require('./src/focus-management-scanner');
const path = require('path');
const fs = require('fs-extra');

/**
 * Visual Debug Test for Phase 6B - Following Development Best Practices
 * Tests existing scanners against our test pages with visual validation
 */
async function debugPhase6B() {
  console.log('🔍 Phase 6B Visual Debug Test - Following Development Best Practices');
  console.log('Testing existing scanners against our test pages...\n');

  const keyboardScanner = new KeyboardNavigationScanner();
  const focusScanner = new FocusManagementScanner();
  
  try {
    // Test pages to analyze
    const testPages = [
      {
        name: 'Bad Keyboard Navigation v2',
        path: path.join(__dirname, 'test-pages/phase6b-bad-keyboard-v2.html'),
        url: `file://${path.join(__dirname, 'test-pages/phase6b-bad-keyboard-v2.html')}`,
        expectedViolations: [
          'no-visible-focus',
          'not-keyboard-accessible', 
          'illogical-tab-order'
        ]
      },
      {
        name: 'Good Keyboard Navigation',
        path: path.join(__dirname, 'test-pages/phase6b-good-keyboard.html'),
        url: `file://${path.join(__dirname, 'test-pages/phase6b-good-keyboard.html')}`,
        expectedViolations: [] // Should be clean
      }
    ];

    const results = {};

    for (const testPage of testPages) {
      console.log(`\n📋 Testing: ${testPage.name}`);
      console.log(`URL: ${testPage.url}`);
      
      // Verify test page exists
      if (!await fs.pathExists(testPage.path)) {
        console.error(`❌ Test page not found: ${testPage.path}`);
        continue;
      }

      try {
        // Test Keyboard Navigation Scanner
        console.log('\n🔘 Testing Keyboard Navigation Scanner...');
        const keyboardResult = await keyboardScanner.scanKeyboardAccess(testPage.url, {
          testAllInteractives: true,
          simulateTabbing: true,
          testCustomControls: true,
          timeout: 30000
        });

        console.log(`   Found ${keyboardResult.violations.length} violations`);
        console.log(`   Tab order: ${keyboardResult.tabOrder.length} elements`);
        console.log(`   Screenshots saved to: ${keyboardResult.screenshotPath}`);

        // Test Focus Management Scanner  
        console.log('\n🎯 Testing Focus Management Scanner...');
        const focusResult = await focusScanner.scanFocusManagement(testPage.url);

        console.log(`   Found ${focusResult.violations.length} focus violations`);
        console.log(`   Logical tab order: ${focusResult.summary.logicalTabOrder}`);
        console.log(`   Visible focus: ${focusResult.summary.allElementsHaveVisibleFocus}`);

        // Store results for analysis
        results[testPage.name] = {
          keyboard: keyboardResult,
          focus: focusResult,
          expected: testPage.expectedViolations
        };

        // Visual Analysis
        console.log('\n📸 Visual Analysis:');
        if (keyboardResult.visualEvidence && keyboardResult.visualEvidence.length > 0) {
          console.log(`   Visual evidence captured: ${keyboardResult.visualEvidence.length} screenshots`);
          
          // Show sample of what was found
          keyboardResult.visualEvidence.slice(0, 3).forEach((evidence, index) => {
            console.log(`   Screenshot ${index + 1}: ${evidence.element} - Focus visible: ${evidence.focusVisible}`);
          });
        }

        // Detailed Violation Analysis
        console.log('\n🚨 Violations Found:');
        keyboardResult.violations.forEach((violation, index) => {
          console.log(`   ${index + 1}. [${violation.criterion}] ${violation.issue}`);
          console.log(`      Element: ${violation.element}`);
          console.log(`      Description: ${violation.description}`);
        });

        if (keyboardResult.violations.length === 0) {
          console.log('   ✅ No violations found');
        }

      } catch (error) {
        console.error(`❌ Error testing ${testPage.name}:`, error.message);
        results[testPage.name] = { error: error.message };
      }
    }

    // Generate Debug Report
    await generateDebugReport(results);

    console.log('\n✅ Visual debug test completed!');
    console.log('📄 Check debug-report-phase6b.html for detailed analysis');

  } catch (error) {
    console.error('❌ Debug test failed:', error.message);
  } finally {
    await keyboardScanner.close();
    await focusScanner.close();
  }
}

/**
 * Generate detailed debug report with visual evidence
 */
async function generateDebugReport(results) {
  const reportPath = path.join(__dirname, 'debug-report-phase6b.html');
  
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Phase 6B Debug Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .test-section { border: 1px solid #ddd; margin: 20px 0; padding: 20px; }
        .violation { background: #ffe6e6; border: 1px solid #ff6b6b; padding: 10px; margin: 10px 0; }
        .success { background: #e6ffe6; border: 1px solid #51cf66; padding: 10px; margin: 10px 0; }
        .screenshot { max-width: 400px; border: 1px solid #ccc; margin: 10px; }
        .evidence { background: #f8f9fa; padding: 15px; margin: 10px 0; }
        pre { background: #f1f3f4; padding: 10px; overflow-x: auto; }
        .summary { background: #e3f2fd; padding: 15px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>Phase 6B Visual Debug Report</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    
    <div class="summary">
        <h2>🎯 Test Summary</h2>
        <ul>
  `;

  Object.keys(results).forEach(testName => {
    const result = results[testName];
    if (result.error) {
      html += `<li>❌ ${testName}: Error - ${result.error}</li>`;
    } else {
      const totalViolations = (result.keyboard?.violations?.length || 0) + (result.focus?.violations?.length || 0);
      html += `<li>📊 ${testName}: ${totalViolations} total violations found</li>`;
    }
  });

  html += `
        </ul>
    </div>
  `;

  // Detailed results for each test
  Object.keys(results).forEach(testName => {
    const result = results[testName];
    
    html += `
    <div class="test-section">
        <h2>📋 ${testName}</h2>
    `;

    if (result.error) {
      html += `<div class="violation">❌ Test Error: ${result.error}</div>`;
    } else {
      // Keyboard Scanner Results
      if (result.keyboard) {
        html += `
        <h3>🔘 Keyboard Navigation Scanner</h3>
        <p><strong>Violations:</strong> ${result.keyboard.violations.length}</p>
        <p><strong>Tab Order Elements:</strong> ${result.keyboard.tabOrder.length}</p>
        <p><strong>Screenshot Path:</strong> ${result.keyboard.screenshotPath || 'Not available'}</p>
        `;

        if (result.keyboard.violations.length > 0) {
          html += '<h4>🚨 Violations:</h4>';
          result.keyboard.violations.forEach((violation, index) => {
            html += `
            <div class="violation">
                <strong>[${violation.criterion}] ${violation.issue}</strong><br>
                <strong>Element:</strong> ${violation.element}<br>
                <strong>Description:</strong> ${violation.description}<br>
                <strong>Suggestion:</strong> ${violation.suggestion}
            </div>`;
          });
        } else {
          html += '<div class="success">✅ No keyboard navigation violations found</div>';
        }

        // Visual Evidence
        if (result.keyboard.visualEvidence && result.keyboard.visualEvidence.length > 0) {
          html += '<h4>📸 Visual Evidence (Sample):</h4>';
          result.keyboard.visualEvidence.slice(0, 5).forEach((evidence, index) => {
            html += `
            <div class="evidence">
                <strong>Element:</strong> ${evidence.element}<br>
                <strong>Focus Visible:</strong> ${evidence.focusVisible ? '✅ Yes' : '❌ No'}<br>
                <strong>Focus Indicators:</strong> ${evidence.focusIndicators.join(', ') || 'None'}<br>
                <strong>Screenshots:</strong> ${evidence.beforeScreenshot}, ${evidence.afterScreenshot}
            </div>`;
          });
        }
      }

      // Focus Scanner Results
      if (result.focus) {
        html += `
        <h3>🎯 Focus Management Scanner</h3>
        <p><strong>Violations:</strong> ${result.focus.violations.length}</p>
        <p><strong>Logical Tab Order:</strong> ${result.focus.summary.logicalTabOrder ? '✅ Yes' : '❌ No'}</p>
        <p><strong>All Elements Have Visible Focus:</strong> ${result.focus.summary.allElementsHaveVisibleFocus ? '✅ Yes' : '❌ No'}</p>
        `;

        if (result.focus.violations.length > 0) {
          html += '<h4>🚨 Focus Violations:</h4>';
          result.focus.violations.forEach((violation, index) => {
            html += `
            <div class="violation">
                <strong>[${violation.criterion}] ${violation.issue}</strong><br>
                <strong>Element:</strong> ${violation.element || 'N/A'}<br>
                <strong>Description:</strong> ${violation.description || violation.suggestion}
            </div>`;
          });
        } else {
          html += '<div class="success">✅ No focus management violations found</div>';
        }
      }

      // Expected vs Actual Analysis
      html += `
      <h3>🎯 Expected vs Actual</h3>
      <p><strong>Expected Violations:</strong> ${result.expected.join(', ') || 'None (clean page)'}</p>
      `;

      const actualViolationTypes = [
        ...(result.keyboard?.violations?.map(v => v.issue) || []),
        ...(result.focus?.violations?.map(v => v.issue) || [])
      ];
      
      html += `<p><strong>Actual Violations Found:</strong> ${actualViolationTypes.join(', ') || 'None'}</p>`;

      // Match Analysis
      const expectedSet = new Set(result.expected);
      const actualSet = new Set(actualViolationTypes);
      const missed = result.expected.filter(e => !actualSet.has(e));
      const unexpected = actualViolationTypes.filter(a => !expectedSet.has(a));

      if (missed.length > 0) {
        html += `<div class="violation">❌ <strong>Missed Expected:</strong> ${missed.join(', ')}</div>`;
      }
      if (unexpected.length > 0) {
        html += `<div class="violation">⚠️ <strong>Unexpected:</strong> ${unexpected.join(', ')}</div>`;
      }
      if (missed.length === 0 && unexpected.length === 0 && result.expected.length > 0) {
        html += '<div class="success">✅ Perfect match with expected violations</div>';
      }
    }

    html += '</div>';
  });

  html += `
    <div class="summary">
        <h2>🔧 Next Steps for Debugging</h2>
        <ol>
            <li>Review visual evidence screenshots in tmp/keyboard-screenshots/</li>
            <li>Check for missed violation types that should have been detected</li>
            <li>Verify focus visibility detection accuracy</li>
            <li>Test tab order logic for complex layouts</li>
            <li>Validate keyboard trap detection in modals</li>
        </ol>
    </div>
</body>
</html>`;

  await fs.writeFile(reportPath, html);
  console.log(`\n📄 Debug report generated: ${reportPath}`);
}

// Run the debug test
if (require.main === module) {
  debugPhase6B().catch(console.error);
}

module.exports = { debugPhase6B };