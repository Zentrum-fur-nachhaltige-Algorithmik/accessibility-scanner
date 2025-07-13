#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner');
const path = require('path');

async function testIsolatedContrast() {
  const scanner = new ColorContrastScanner();
  
  console.log('🔍 Testing Isolated Color Contrast Cases\n');
  
  const isolatedFile = path.join(__dirname, 'isolated-tests', 'color-contrast-false-positives.html');
  const isolatedUrl = `file://${isolatedFile}`;
  
  try {
    console.log('📋 Testing isolated false positive cases...');
    const result = await scanner.scanColorContrast(isolatedUrl);
    
    console.log('\n--- ISOLATED TEST RESULTS ---');
    console.log('Total elements tested:', result.summary.totalElements);
    console.log('Failed elements:', result.summary.failedElements);
    console.log('Violations found:', result.violations.length);
    
    if (result.violations.length > 0) {
      console.log('\n🚨 Violations detected:');
      result.violations.forEach((violation, i) => {
        console.log(`\n${i + 1}. Element: ${violation.element}`);
        console.log(`   Contrast Ratio: ${violation.currentRatio}:1`);
        console.log(`   Required Ratio: ${violation.requiredRatio}:1`);
        console.log(`   Foreground: ${violation.foregroundColor}`);
        console.log(`   Background: ${violation.backgroundColor}`);
        console.log(`   Large Text: ${violation.isLargeText}`);
        console.log(`   Gap: ${(violation.requiredRatio - violation.currentRatio).toFixed(2)} ratio points below threshold`);
      });
    }
    
    // Manual verification of specific color combinations
    console.log('\n--- MANUAL VERIFICATION ---');
    
    // Test Case 1: White on #4a90e2
    const case1 = calculateContrastManual('#ffffff', '#4a90e2');
    console.log(`Case 1 - White on blue: ${case1.toFixed(2)}:1`);
    
    // Test Case 2: #6c757d on #f8f9fa  
    const case2 = calculateContrastManual('#6c757d', '#f8f9fa');
    console.log(`Case 2 - Gray on light gray: ${case2.toFixed(2)}:1`);
    
    // Test Case 3: White on #28a745
    const case3 = calculateContrastManual('#ffffff', '#28a745');
    console.log(`Case 3 - White on green: ${case3.toFixed(2)}:1`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  await scanner.close();
}

// Manual contrast calculation for verification
function calculateContrastManual(color1, color2) {
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }
  
  function getLuminance(rgb) {
    const { r, g, b } = rgb;
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  
  if (!rgb1 || !rgb2) return 0;
  
  const lum1 = getLuminance(rgb1);
  const lum2 = getLuminance(rgb2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  
  return (brightest + 0.05) / (darkest + 0.05);
}

testIsolatedContrast().catch(console.error);