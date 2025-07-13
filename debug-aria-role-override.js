#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');

async function debugAriaRoleOverride() {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/good-aria-role-override.html`;
  
  console.log('🔍 ANALYZING: good-aria-role-override.html');
  console.log('Expected: 24 violations (11 color-contrast + 11 keyboard + 2 html)');
  console.log('Purpose: Test ARIA role override patterns');
  console.log('='.repeat(60));
  
  try {
    const result = await scanner.scanColorContrast(fileUrl);
    
    console.log(`📊 COLOR CONTRAST RESULTS:`);
    console.log(`- Passed: ${result.passed}`);
    console.log(`- Total Elements: ${result.summary.totalElements}`);
    console.log(`- Failed Elements: ${result.summary.failedElements}`);
    console.log(`- Violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      console.log(`\n❌ ALL VIOLATIONS:`);
      result.violations.forEach((violation, i) => {
        console.log(`  ${i+1}. ${violation.element}`);
        console.log(`     Ratio: ${violation.currentRatio} (required: ${violation.requiredRatio})`);
        console.log(`     Colors: ${violation.foregroundColor} on ${violation.backgroundColor}`);
        console.log('');
      });
      
      // Analyze color patterns
      const colorPatterns = {};
      result.violations.forEach(v => {
        const pattern = `${v.foregroundColor} on ${v.backgroundColor}`;
        colorPatterns[pattern] = (colorPatterns[pattern] || 0) + 1;
      });
      
      console.log(`\n🔍 COLOR PATTERN ANALYSIS:`);
      Object.entries(colorPatterns)
        .sort(([,a], [,b]) => b - a)
        .forEach(([pattern, count]) => {
          console.log(`  ${count}x: ${pattern}`);
        });
    }
    
    await scanner.close();
    return result;
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    await scanner.close();
    return null;
  }
}

debugAriaRoleOverride().catch(console.error);