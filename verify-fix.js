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

const background = hexToRgb('#e3f2fd'); // Light blue background
const oldColor = hexToRgb('#1976d2');   // Old failing color
const newColor = hexToRgb('#0d47a1');   // New fixed color

console.log('🔬 CONTRAST FIX VERIFICATION:');
console.log(`Background: #e3f2fd → rgb(${background.r}, ${background.g}, ${background.b})`);

const oldRatio = getContrastRatio(oldColor, background);
const newRatio = getContrastRatio(newColor, background);

console.log(`\n❌ OLD: #1976d2 → ratio ${oldRatio.toFixed(2)} (FAILS)`);
console.log(`✅ NEW: #0d47a1 → ratio ${newRatio.toFixed(2)} (${newRatio >= 4.5 ? 'PASSES' : 'FAILS'})`);
console.log(`📊 WCAG AA Requirement: 4.5`);
console.log(`📈 Improvement: +${(newRatio - oldRatio).toFixed(2)}`);