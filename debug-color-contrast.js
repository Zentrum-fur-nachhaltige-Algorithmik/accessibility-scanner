#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner');
const path = require('path');

async function debugColorContrast() {
  const scanner = new ColorContrastScanner();
  
  console.log('🔍 Debugging Color Contrast Scanner\n');
  
  // Test bad contrast file
  const badFile = path.join(__dirname, 'test-sites', 'bad-color-contrast.html');
  const badUrl = `file://${badFile}`;
  
  try {
    console.log('📛 Testing BAD contrast file:', badFile);
    const badResult = await scanner.scanColorContrast(badUrl);
    
    console.log('\n--- BAD FILE RESULTS ---');
    console.log('Passed:', badResult.passed);
    console.log('Total elements:', badResult.summary.totalElements);
    console.log('Failed elements:', badResult.summary.failedElements);
    console.log('Violations found:', badResult.violations.length);
    
    if (badResult.violations.length > 0) {
      console.log('\n🚨 First 5 violations:');
      badResult.violations.slice(0, 5).forEach((violation, i) => {
        console.log(`${i + 1}. ${violation.element}`);
        console.log(`   Ratio: ${violation.currentRatio}:1 (Required: ${violation.requiredRatio}:1)`);
        console.log(`   Colors: ${violation.foregroundColor} on ${violation.backgroundColor}`);
        console.log(`   Large text: ${violation.isLargeText}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error testing bad file:', error.message);
  }
  
  // Test good contrast file
  const goodFile = path.join(__dirname, 'test-sites', 'good-accessibility.html');
  const goodUrl = `file://${goodFile}`;
  
  try {
    console.log('\n✅ Testing GOOD contrast file:', goodFile);
    const goodResult = await scanner.scanColorContrast(goodUrl);
    
    console.log('\n--- GOOD FILE RESULTS ---');
    console.log('Passed:', goodResult.passed);
    console.log('Total elements:', goodResult.summary.totalElements);
    console.log('Failed elements:', goodResult.summary.failedElements);
    console.log('Violations found:', goodResult.violations.length);
    
    if (goodResult.violations.length > 0) {
      console.log('\n⚠️ Unexpected violations in GOOD file:');
      goodResult.violations.slice(0, 3).forEach((violation, i) => {
        console.log(`${i + 1}. ${violation.element}`);
        console.log(`   Ratio: ${violation.currentRatio}:1 (Required: ${violation.requiredRatio}:1)`);
        console.log(`   Colors: ${violation.foregroundColor} on ${violation.backgroundColor}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error testing good file:', error.message);
  }
  
  await scanner.close();
}

debugColorContrast().catch(console.error);