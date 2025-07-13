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

// The current failing combination (must be on some background that gives 4.08 ratio)
const currentBlue = hexToRgb('#1a78c2');

// Test possible backgrounds that would give 4.08 ratio
const possibleBackgrounds = [
  '#f8f9fa',  // Light gray
  '#ffffff',  // White
  '#f5f5f5',  // Another light gray
  '#e3f2fd'   // Light blue
];

console.log('🔧 IDENTIFYING LAST VIOLATION');
console.log('Current blue: #1a78c2');

possibleBackgrounds.forEach(bgHex => {
  const bg = hexToRgb(bgHex);
  const ratio = getContrastRatio(currentBlue, bg);
  console.log(`On ${bgHex}: ratio ${ratio.toFixed(2)} ${ratio < 4.5 ? '❌ FAIL' : '✅ PASS'}`);
});

// The failing one must be around 4.08, so let's find a darker blue
console.log('\n🎯 TESTING DARKER BLUES:');
const darkerBlues = ['#186cb0', '#16619e', '#14568c', '#124b7a'];

// Assume it's failing on #f8f9fa (most likely light background)
const likelyBackground = hexToRgb('#f8f9fa');

darkerBlues.forEach(hex => {
  const rgb = hexToRgb(hex);
  const ratio = getContrastRatio(rgb, likelyBackground);
  const passes = ratio >= 4.5;
  console.log(`${passes ? '✅' : '❌'} ${hex} → ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});

console.log('\nRecommendation: Use #16619e');