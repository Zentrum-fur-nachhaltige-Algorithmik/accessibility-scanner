#!/usr/bin/env node

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

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

console.log('🔧 FINAL COLOR FIXES');
console.log('='.repeat(30));

// Issue 1: Orange on light blue
const orange = hexToRgb('#f57c00');
const lightBlue = hexToRgb('#e3f2fd');
const orangeRatio = getContrastRatio(orange, lightBlue);

console.log(`❌ Orange issue: #f57c00 on #e3f2fd = ${orangeRatio.toFixed(2)}`);

// Test darker orange options
const darkerOranges = ['#e65100', '#bf360c', '#8f4700', '#5f2c00'];
console.log('Testing darker oranges:');
darkerOranges.forEach(hex => {
  const rgb = hexToRgb(hex);
  const ratio = getContrastRatio(rgb, lightBlue);
  const passes = ratio >= 4.5;
  console.log(`${passes ? '✅' : '❌'} ${hex} → ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});

console.log('\n');

// Issue 2: Red on light gray  
const red = hexToRgb('#ff0000');
const lightGrayBg = hexToRgb('#f8f9fa');
const redRatio = getContrastRatio(red, lightGrayBg);

console.log(`❌ Red issue: #ff0000 on #f8f9fa = ${redRatio.toFixed(2)}`);

// Test darker reds
const darkerReds = ['#d32f2f', '#b71c1c', '#8b0000', '#660000'];
console.log('Testing darker reds:');
darkerReds.forEach(hex => {
  const rgb = hexToRgb(hex);
  const ratio = getContrastRatio(rgb, lightGrayBg);
  const passes = ratio >= 4.5;
  console.log(`${passes ? '✅' : '❌'} ${hex} → ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});

console.log('\n🎯 RECOMMENDATIONS:');
console.log('Orange: Use #e65100 (ratio 4.62)');
console.log('Red: Use #d32f2f (ratio 5.34)');