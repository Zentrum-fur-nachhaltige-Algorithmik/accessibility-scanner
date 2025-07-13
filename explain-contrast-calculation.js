#!/usr/bin/env node

/**
 * WCAG Contrast Ratio Calculation - Step by Step
 * Red background rgb(244, 67, 54) with white text rgb(255, 255, 255)
 */

console.log('🔬 WCAG CONTRAST RATIO CALCULATION');
console.log('='.repeat(50));

// Step 1: Define colors
const red = { r: 244, g: 67, b: 54 };    // Red background
const white = { r: 255, g: 255, b: 255 }; // White text

console.log(`Background (red): rgb(${red.r}, ${red.g}, ${red.b})`);
console.log(`Foreground (white): rgb(${white.r}, ${white.g}, ${white.b})`);

// Step 2: Convert to relative luminance values (0-1 scale)
function calculateLuminance(rgb) {
  console.log(`\n📐 Calculating luminance for rgb(${rgb.r}, ${rgb.g}, ${rgb.b}):`);
  
  // Step 2a: Convert to 0-1 scale
  const rNorm = rgb.r / 255;
  const gNorm = rgb.g / 255; 
  const bNorm = rgb.b / 255;
  console.log(`  Normalized: r=${rNorm.toFixed(3)}, g=${gNorm.toFixed(3)}, b=${bNorm.toFixed(3)}`);
  
  // Step 2b: Apply gamma correction
  function gammaCorrect(c) {
    if (c <= 0.03928) {
      return c / 12.92;
    } else {
      return Math.pow((c + 0.055) / 1.055, 2.4);
    }
  }
  
  const rLinear = gammaCorrect(rNorm);
  const gLinear = gammaCorrect(gNorm);
  const bLinear = gammaCorrect(bNorm);
  console.log(`  Gamma corrected: r=${rLinear.toFixed(3)}, g=${gLinear.toFixed(3)}, b=${bLinear.toFixed(3)}`);
  
  // Step 2c: Calculate relative luminance using WCAG formula
  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
  console.log(`  Formula: 0.2126×${rLinear.toFixed(3)} + 0.7152×${gLinear.toFixed(3)} + 0.0722×${bLinear.toFixed(3)}`);
  console.log(`  Luminance: ${luminance.toFixed(3)}`);
  
  return luminance;
}

console.log('\n🔍 STEP 1: Calculate relative luminance');
const redLuminance = calculateLuminance(red);
const whiteLuminance = calculateLuminance(white);

// Step 3: Calculate contrast ratio
console.log('\n🔍 STEP 2: Calculate contrast ratio');
console.log(`Red luminance: ${redLuminance.toFixed(3)}`);
console.log(`White luminance: ${whiteLuminance.toFixed(3)}`);

const brightest = Math.max(redLuminance, whiteLuminance);
const darkest = Math.min(redLuminance, whiteLuminance);

console.log(`Brightest: ${brightest.toFixed(3)} (white is brighter)`);
console.log(`Darkest: ${darkest.toFixed(3)} (red is darker)`);

// WCAG formula: (L1 + 0.05) / (L2 + 0.05)
const contrastRatio = (brightest + 0.05) / (darkest + 0.05);

console.log(`\nFormula: (${brightest.toFixed(3)} + 0.05) / (${darkest.toFixed(3)} + 0.05)`);
console.log(`= ${(brightest + 0.05).toFixed(3)} / ${(darkest + 0.05).toFixed(3)}`);
console.log(`= ${contrastRatio.toFixed(2)}`);

// Step 4: Check WCAG requirements
console.log('\n🎯 WCAG COMPLIANCE CHECK:');
console.log(`Calculated ratio: ${contrastRatio.toFixed(2)}`);
console.log(`WCAG AA requirement: 4.5`);
console.log(`WCAG AAA requirement: 7.0`);

if (contrastRatio >= 4.5) {
  console.log(`✅ PASSES WCAG AA`);
} else {
  console.log(`❌ FAILS WCAG AA (need at least 4.5, got ${contrastRatio.toFixed(2)})`);
}

if (contrastRatio >= 7.0) {
  console.log(`✅ PASSES WCAG AAA`);
} else {
  console.log(`❌ FAILS WCAG AAA (need at least 7.0, got ${contrastRatio.toFixed(2)})`);
}

console.log('\n💡 WHAT THIS MEANS:');
console.log('- White text on this red background is too hard to read');
console.log('- Needs darker red or different approach for accessibility');
console.log(`- Current ratio ${contrastRatio.toFixed(2)} is ${(4.5 - contrastRatio).toFixed(2)} points below minimum`);