#!/usr/bin/env node

/**
 * SYSTEMATIC COLOR ANALYSIS: Find all failing color combinations
 * and calculate proper replacements
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

function rgbToHex(rgb) {
  return '#' + [rgb.r, rgb.g, rgb.b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// Generate darker version of a color that passes WCAG AA
function findPassingColor(originalHex, textColor = { r: 255, g: 255, b: 255 }) {
  const original = hexToRgb(originalHex);
  
  // Try progressively darker versions
  for (let factor = 0.9; factor >= 0.3; factor -= 0.05) {
    const darker = {
      r: Math.round(original.r * factor),
      g: Math.round(original.g * factor),
      b: Math.round(original.b * factor)
    };
    
    const ratio = getContrastRatio(darker, textColor);
    if (ratio >= 4.5) {
      return {
        hex: rgbToHex(darker),
        ratio: ratio.toFixed(2)
      };
    }
  }
  
  return null;
}

console.log('🎯 SYSTEMATIC COLOR FIX ANALYSIS');
console.log('='.repeat(50));

// Known failing combinations from scanner output
const failingCombinations = [
  // Green violations (step completed buttons)
  { bg: '#4caf50', fg: '#ffffff', context: 'step-item.completed, requirement-status.valid' },
  
  // Blue violations (current step, instructions)  
  { bg: '#2196f3', fg: '#ffffff', context: 'step-item.current, good-instructions border' },
  
  // Other Material Design colors that might fail
  { bg: '#ff9800', fg: '#ffffff', context: 'warning buttons, timeout display' },
  { bg: '#757575', fg: '#ffffff', context: 'secondary buttons' },
  { bg: '#f57c00', fg: '#000000', context: 'timeout-display text' }
];

console.log('Analyzing failing color combinations:');
console.log('');

const fixes = [];

failingCombinations.forEach(combo => {
  const bgRgb = hexToRgb(combo.bg);
  const fgRgb = hexToRgb(combo.fg);
  const currentRatio = getContrastRatio(bgRgb, fgRgb);
  
  console.log(`❌ ${combo.bg} + ${combo.fg} → ${currentRatio.toFixed(2)} (${combo.context})`);
  
  if (currentRatio < 4.5) {
    const fix = findPassingColor(combo.bg, fgRgb);
    if (fix) {
      console.log(`   ✅ FIX: ${fix.hex} → ratio ${fix.ratio}`);
      fixes.push({
        original: combo.bg,
        fixed: fix.hex,
        context: combo.context,
        oldRatio: currentRatio.toFixed(2),
        newRatio: fix.ratio
      });
    } else {
      console.log(`   ⚠️  Need different approach (color too light)`);
    }
  } else {
    console.log(`   ✅ Actually passes (false alarm)`);
  }
  console.log('');
});

console.log('🔧 CSS FIXES NEEDED:');
console.log('='.repeat(30));

fixes.forEach(fix => {
  console.log(`/* ${fix.context} */`);
  console.log(`/* Change ${fix.original} → ${fix.fixed} (${fix.oldRatio} → ${fix.newRatio}) */`);
  console.log('');
});

// Export fixes for systematic application
module.exports = fixes;