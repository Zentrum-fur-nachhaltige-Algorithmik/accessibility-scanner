#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');

async function debugAriaStateUpdates() {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/good-aria-state-updates.html`;
  
  console.log('🔍 ANALYZING: good-aria-state-updates.html');
  console.log('Expected: 24 violations (4 color-contrast + 14 keyboard + 6 html)');
  console.log('Purpose: Test dynamic ARIA state management');
  console.log('='.repeat(60));
  
  try {
    const result = await scanner.scanColorContrast(fileUrl);
    
    console.log(`📊 COLOR CONTRAST RESULTS:`);
    console.log(`- Passed: ${result.passed}`);
    console.log(`- Violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      // Group by color pattern
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

debugAriaStateUpdates().catch(console.error);