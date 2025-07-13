#!/usr/bin/env node

/**
 * DEBUG: Test single scanner on both files to compare violations
 */

const ColorContrastScanner = require('./src/color-contrast-scanner.js');

async function debugSingleFile(filename) {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/${filename}`;
  
  console.log(`\n🔍 TESTING: ${filename}`);
  console.log(`URL: ${fileUrl}`);
  
  try {
    const result = await scanner.scanColorContrast(fileUrl);
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`- Passed: ${result.passed}`);
    console.log(`- Total Elements: ${result.summary.totalElements}`);
    console.log(`- Failed Elements: ${result.summary.failedElements}`);
    console.log(`- Violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      console.log(`\n❌ FIRST 3 VIOLATIONS:`);
      result.violations.slice(0, 3).forEach((violation, i) => {
        console.log(`  ${i+1}. Element: ${violation.element}`);
        console.log(`     Ratio: ${violation.currentRatio} (required: ${violation.requiredRatio})`);
        console.log(`     FG: ${violation.foregroundColor} | BG: ${violation.backgroundColor}`);
        console.log(`     Large text: ${violation.isLargeText}`);
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

async function compareFiles() {
  console.log('='.repeat(60));
  console.log('ROOT CAUSE ANALYSIS: Compare clean vs problematic file');
  console.log('='.repeat(60));
  
  // Test the CLEAN file first
  const cleanResult = await debugSingleFile('good-accessibility.html');
  
  // Test the PROBLEMATIC file  
  const problematicResult = await debugSingleFile('good-cognitive-accessibility.html');
  
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON ANALYSIS:');
  console.log('='.repeat(60));
  
  if (cleanResult && problematicResult) {
    console.log(`✅ Clean file violations: ${cleanResult.violations.length}`);
    console.log(`❌ Problematic file violations: ${problematicResult.violations.length}`);
    console.log(`📊 Difference: ${problematicResult.violations.length - cleanResult.violations.length} more violations`);
    
    if (cleanResult.violations.length === 0 && problematicResult.violations.length > 0) {
      console.log('\n🔍 ROOT CAUSE: Clean file has no contrast issues, problematic file does');
      console.log('   → This suggests the problematic file might have actual contrast issues');
      console.log('   → OR the scanner logic has edge cases not covered by clean file');
    }
  }
}

// Run the comparison
compareFiles().catch(console.error);