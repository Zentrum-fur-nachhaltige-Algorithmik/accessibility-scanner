const EnhancedAccessibilityScanner = require('./enhanced-scanner');

/**
 * Test Phase 6A integration with Enhanced Scanner
 */
async function testPhase6AIntegration() {
  console.log('🚀 Testing Phase 6A Integration with Enhanced Scanner...\n');

  const scanner = new EnhancedAccessibilityScanner();

  try {
    // Test HTML with known Phase 6A issues
    const testHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>Phase 6A Integration Test</title>
          <meta charset="utf-8">
        </head>
        <body style="color: black; background: white;">
          <h1>Integration Test Page</h1>
          
          <!-- Color contrast issues -->
          <div style="color: #999; background: #bbb; padding: 10px;">
            Low contrast text that should be detected
          </div>
          
          <!-- Use of color issues -->
          <p>Click on this <a href="#" style="color: red; text-decoration: none;">important link</a> for more info.</p>
          
          <form>
            <label for="email">Email:</label>
            <input type="email" id="email">
            <div class="error" style="color: red;">Error message</div>
          </form>
          
          <!-- Images of text -->
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==" 
               alt="Submit Now" class="button-text">
          
          <p>This page has regular content with good contrast.</p>
        </body>
      </html>
    `;

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;

    // Test regular scan (without Phase 6A)
    console.log('📋 Testing regular enhanced scan...');
    const regularResult = await scanner.enhancedScan(dataUrl, {
      wcagLevel: 'AA',
      includePhase6A: false
    });

    console.log(`  Regular scan violations: ${regularResult.violations.length}`);
    console.log(`  Regular accessibility score: ${regularResult.accessibilityScore}%`);
    console.log(`  Has Phase 6A results: ${!!regularResult.phase6ACompliance}\n`);

    // Test enhanced scan with Phase 6A
    console.log('📋 Testing enhanced scan with Phase 6A...');
    const enhancedResult = await scanner.enhancedScan(dataUrl, {
      wcagLevel: 'AA',
      includePhase6A: true
    });

    console.log(`  Enhanced scan violations: ${enhancedResult.violations.length}`);
    console.log(`  Enhanced accessibility score: ${enhancedResult.accessibilityScore}%`);
    console.log(`  Has Phase 6A results: ${!!enhancedResult.phase6ACompliance}`);

    if (enhancedResult.phase6ACompliance) {
      const { colorContrast, useOfColor, imagesOfText } = enhancedResult.phase6ACompliance;
      
      console.log(`  Phase 6A Score: ${enhancedResult.phase6AScore}%`);
      console.log(`  Phase 6A Total Violations: ${enhancedResult.phase6AViolations}`);
      console.log(`  Color Contrast: ${colorContrast.violations.length} violations (${colorContrast.passed ? 'PASS' : 'FAIL'})`);
      console.log(`  Use of Color: ${useOfColor.violations.length} violations (${useOfColor.passed ? 'PASS' : 'FAIL'})`);
      console.log(`  Images of Text: ${imagesOfText.violations.length} violations (${imagesOfText.passed ? 'PASS' : 'FAIL'})`);
      
      // Display some violation details
      if (colorContrast.violations.length > 0) {
        console.log(`    Color contrast ratio: ${colorContrast.violations[0].currentRatio} (required: ${colorContrast.violations[0].requiredRatio})`);
      }
      
      if (useOfColor.violations.length > 0) {
        console.log(`    Use of color issue: ${useOfColor.violations[0].issue}`);
      }
      
      if (imagesOfText.violations.length > 0) {
        console.log(`    Images of text confidence: ${imagesOfText.violations[0].confidence}%`);
      }
    }

    // Test WCAG AAA level
    console.log('\n📋 Testing WCAG AAA level...');
    const aaaResult = await scanner.enhancedScan(dataUrl, {
      wcagLevel: 'AAA',
      includePhase6A: true
    });

    console.log(`  AAA violations: ${aaaResult.violations.length}`);
    console.log(`  AAA Phase 6A violations: ${aaaResult.phase6AViolations}`);

    // Validation
    console.log('\n✅ Integration Validation:');
    const validations = [
      {
        name: 'Phase 6A results included when enabled',
        passed: !!enhancedResult.phase6ACompliance
      },
      {
        name: 'Phase 6A results not included when disabled',
        passed: !regularResult.phase6ACompliance
      },
      {
        name: 'Color contrast violations detected',
        passed: enhancedResult.phase6ACompliance.colorContrast.violations.length > 0
      },
      {
        name: 'Use of color violations detected',
        passed: enhancedResult.phase6ACompliance.useOfColor.violations.length > 0
      },
      {
        name: 'Images of text violations detected',
        passed: enhancedResult.phase6ACompliance.imagesOfText.violations.length > 0
      },
      {
        name: 'Phase 6A score calculated',
        passed: typeof enhancedResult.phase6AScore === 'number'
      },
      {
        name: 'WCAG AAA support works',
        passed: aaaResult.phase6ACompliance.colorContrast.summary.minimumRatio === 7
      }
    ];

    validations.forEach(validation => {
      console.log(`  ${validation.passed ? '✅' : '❌'} ${validation.name}`);
    });

    const allPassed = validations.every(v => v.passed);
    console.log(`\n🎯 Integration Test Result: ${allPassed ? 'SUCCESS' : 'FAILED'}`);

    if (!allPassed) {
      throw new Error('Some integration validations failed');
    }

  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    throw error;
  } finally {
    await scanner.close();
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testPhase6AIntegration().catch(console.error);
}

module.exports = testPhase6AIntegration;