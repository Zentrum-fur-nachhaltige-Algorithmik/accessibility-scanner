#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');

async function debugConcurrentInput() {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/good-concurrent-input.html`;
  
  console.log('🔍 ANALYZING: good-concurrent-input.html');
  console.log('Expected: 38 violations (21 color-contrast + 16 keyboard + 1 html)');
  console.log('='.repeat(60));
  
  try {
    const result = await scanner.scanColorContrast(fileUrl);
    
    console.log(`📊 COLOR CONTRAST RESULTS:`);
    console.log(`- Passed: ${result.passed}`);
    console.log(`- Total Elements: ${result.summary.totalElements}`);
    console.log(`- Failed Elements: ${result.summary.failedElements}`);
    console.log(`- Violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      console.log(`\n❌ TOP 10 VIOLATIONS:`);
      result.violations.slice(0, 10).forEach((violation, i) => {
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
        .slice(0, 5)
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

debugConcurrentInput().catch(console.error);