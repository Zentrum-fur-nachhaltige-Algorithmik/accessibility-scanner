const EnhancedScanner = require('./src/enhanced-scanner');

/**
 * Test script to reproduce the 33% scoring bug
 */
async function test33PercentBug() {
  console.log('🐛 Testing 33% Scoring Bug...\n');
  
  const scanner = new EnhancedScanner();
  
  // Test URLs - mix of good and bad accessibility
  const testUrls = [
    'file:///mnt/c/Users/T14/Desktop/accessability/test-pages/phase6b-good-keyboard.html', // Should score high
    'file:///mnt/c/Users/T14/Desktop/accessability/test-pages/phase6b-bad-keyboard-v2.html', // Should score low
    'https://www.gov.uk', // Known good accessibility
    'https://webaim.org', // Known good accessibility
  ];
  
  for (const url of testUrls) {
    try {
      console.log(`📊 Testing: ${url}`);
      
      const result = await scanner.enhancedScan(url, {
        includePhase6A: true,
        wcagLevel: 'AA'
      });
      
      console.log(`  Overall Score: ${result.accessibilityScore}%`);
      console.log(`  Phase 6A Score: ${result.phase6AScore || 'N/A'}%`);
      console.log(`  Total Violations: ${result.violations.length}`);
      console.log(`  Phase 6A Violations: ${result.phase6AViolations || 0}`);
      
      if (result.phase6ACompliance) {
        console.log(`    Color Contrast: ${result.phase6ACompliance.colorContrast.violations.length} violations (${result.phase6ACompliance.colorContrast.passed ? 'PASS' : 'FAIL'})`);
        console.log(`    Use of Color: ${result.phase6ACompliance.useOfColor.violations.length} violations (${result.phase6ACompliance.useOfColor.passed ? 'PASS' : 'FAIL'})`);
        console.log(`    Images of Text: ${result.phase6ACompliance.imagesOfText.violations.length} violations (${result.phase6ACompliance.imagesOfText.passed ? 'PASS' : 'FAIL'})`);
        
        // Show details of violations
        if (result.phase6ACompliance.colorContrast.violations.length > 0) {
          console.log(`      Color Contrast Details:`);
          result.phase6ACompliance.colorContrast.violations.slice(0, 3).forEach((v, i) => {
            console.log(`        ${i+1}. ${v.element}: ${v.currentRatio} (need ${v.requiredRatio})`);
          });
        }
      }
      
      console.log('');
      
    } catch (error) {
      console.error(`❌ Error testing ${url}:`, error.message);
    }
  }
  
  await scanner.close();
}

// Run test
test33PercentBug().catch(console.error);