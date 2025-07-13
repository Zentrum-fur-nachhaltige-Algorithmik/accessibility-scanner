#!/usr/bin/env node

/**
 * Find a better red color that passes WCAG AA with white text
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

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

const white = { r: 255, g: 255, b: 255 };

console.log('🔍 FINDING BETTER RED FOR WHITE TEXT');
console.log('Target: WCAG AA (4.5) with white text');
console.log('='.repeat(40));

// Test various red shades - darker reds should work better
const redCandidates = [
  '#f44336', // Current failing red  
  '#e53935', // Slightly darker
  '#d32f2f', // Material red 700
  '#c62828', // Material red 800
  '#b71c1c', // Material red 900
  '#8b0000', // Dark red
  '#990000', // Custom dark red
  '#cc0000'  // Medium dark red
];

console.log('Testing red candidates:');
redCandidates.forEach(hex => {
  const rgb = hexToRgb(hex);
  const ratio = getContrastRatio(rgb, white);
  const passes = ratio >= 4.5;
  
  console.log(`${passes ? '✅' : '❌'} ${hex} → ratio ${ratio.toFixed(2)} ${passes ? 'PASS' : 'FAIL'}`);
});

// Find the lightest red that still passes
console.log('\n🎯 RECOMMENDATION:');
const passingReds = redCandidates.filter(hex => {
  const rgb = hexToRgb(hex);
  const ratio = getContrastRatio(rgb, white);
  return ratio >= 4.5;
});

if (passingReds.length > 0) {
  console.log(`Use: ${passingReds[0]} (lightest red that passes WCAG AA)`);
} else {
  console.log('No tested reds pass - need even darker red or different approach');
}