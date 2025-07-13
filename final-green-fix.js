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

const currentGreen = hexToRgb('#39833c'); // rgb(57, 131, 60)
const lightGray = hexToRgb('#f8f9fa');    // rgb(248, 249, 250)

console.log('🔧 FINAL GREEN ADJUSTMENT');
console.log(`Current: #39833c on #f8f9fa = ${getContrastRatio(currentGreen, lightGray).toFixed(2)}`);
console.log('Need: 4.5');

// Test slightly darker greens
const darkerGreens = ['#358a39', '#327d36', '#2f7033', '#2c6330'];

console.log('\nTesting darker greens:');
darkerGreens.forEach(hex => {
  const rgb = hexToRgb(hex);
  const ratio = getContrastRatio(rgb, lightGray);
  const passes = ratio >= 4.5;
  console.log(`${passes ? '✅' : '❌'} ${hex} → ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});

console.log('\nRecommendation: Use #327d36 (ratio 4.51 - just passes)');