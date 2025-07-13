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

// Current failing combination
const gray = { r: 102, g: 102, b: 102 }; // #666
const lightGray = { r: 224, g: 224, b: 224 }; // #e0e0e0

console.log('🔍 GRAY COLOR FIX ANALYSIS');
console.log('Current failing: #666 on #e0e0e0');

const currentRatio = getContrastRatio(gray, lightGray);
console.log(`Current ratio: ${currentRatio.toFixed(2)} (needs 4.5)`);

// Test darker grays
const darkGrayOptions = [
  '#555', '#444', '#333', '#222'  
];

console.log('\nTesting darker grays:');
darkGrayOptions.forEach(hex => {
  const r = parseInt(hex.slice(1).repeat(2/hex.slice(1).length), 16);
  const rgb = { r, g: r, b: r };
  const ratio = getContrastRatio(rgb, lightGray);
  const passes = ratio >= 4.5;
  
  console.log(`${passes ? '✅' : '❌'} ${hex} → ratio ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});

// Or test lighter background
console.log('\nOr keep #666 and use lighter background:');
const lightOptions = ['#f0f0f0', '#f5f5f5', '#f8f8f8', '#fafafa'];

lightOptions.forEach(hex => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgb = { r, g, b };
  const ratio = getContrastRatio(gray, rgb);
  const passes = ratio >= 4.5;
  
  console.log(`${passes ? '✅' : '❌'} #666 on ${hex} → ratio ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});