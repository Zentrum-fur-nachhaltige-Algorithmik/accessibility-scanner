#!/usr/bin/env node

/**
 * VERIFY: Calculate contrast ratio manually to confirm scanner accuracy
 */

function getLuminance(rgb) {
  const { r, g, b } = rgb;
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(color1, color2) {
  const lum1 = getLuminance(color1);
  const lum2 = getLuminance(color2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Test the reported violation
const foreground = { r: 25, g: 118, b: 210 };  // rgb(25, 118, 210) - blue
const background = { r: 227, g: 242, b: 253 }; // rgb(227, 242, 253) - light blue

console.log('🔬 MANUAL CONTRAST CALCULATION:');
console.log(`Foreground: rgb(${foreground.r}, ${foreground.g}, ${foreground.b})`);
console.log(`Background: rgb(${background.r}, ${background.g}, ${background.b})`);

const ratio = getContrastRatio(foreground, background);
console.log(`\n📊 Calculated Ratio: ${ratio.toFixed(2)}`);
console.log(`📐 WCAG AA Required: 4.5`);
console.log(`📐 WCAG AAA Required: 7.0`);

if (ratio >= 4.5) {
  console.log(`✅ PASSES WCAG AA`);
} else {
  console.log(`❌ FAILS WCAG AA (ratio too low)`);
}

if (ratio >= 7.0) {
  console.log(`✅ PASSES WCAG AAA`);
} else {
  console.log(`❌ FAILS WCAG AAA (ratio too low)`);
}

console.log('\n🎯 CONCLUSION:');
if (ratio < 4.5) {
  console.log('✅ Scanner is CORRECT - this IS a real accessibility violation');
  console.log('❌ The "good" file actually contains bad accessibility');
} else {
  console.log('❌ Scanner is WRONG - this should pass');
}

// Test a few more combinations from the cognitive file
console.log('\n' + '='.repeat(50));
console.log('TEST OTHER COLOR COMBINATIONS:');

const testCombinations = [
  // From .good-section
  { fg: { r: 46, g: 125, b: 50 }, bg: { r: 241, g: 248, b: 233 }, desc: '.good-title on .good-section' },
  // From .good-instructions  
  { fg: { r: 25, g: 118, b: 210 }, bg: { r: 227, g: 242, b: 253 }, desc: '.good-instructions h4' },
  // Body text
  { fg: { r: 0, g: 0, b: 0 }, bg: { r: 255, g: 255, b: 255 }, desc: 'body text' }
];

testCombinations.forEach(test => {
  const ratio = getContrastRatio(test.fg, test.bg);
  const passes = ratio >= 4.5;
  console.log(`${passes ? '✅' : '❌'} ${test.desc}: ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});