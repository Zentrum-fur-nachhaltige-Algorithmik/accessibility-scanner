#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');

async function debugAutoSubmittingForm() {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/good-auto-submitting-form.html`;
  
  console.log('🔍 ANALYZING: good-auto-submitting-form.html');
  console.log('Expected: 19 violations (11 color-contrast + 3 keyboard + 5 html)');
  console.log('Purpose: Test accessible auto-submitting form patterns');
  console.log('='.repeat(60));
  
  try {
    const result = await scanner.scanColorContrast(fileUrl);
    
    console.log(`📊 COLOR CONTRAST RESULTS:`);
    console.log(`- Passed: ${result.passed}`);
    console.log(`- Violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      // Show just the pattern analysis for efficiency
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

debugAutoSubmittingForm().catch(console.error);