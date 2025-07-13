#!/usr/bin/env node

/**
 * ROOT CAUSE ANALYSIS: Color Parsing Logic
 * Test the exact colors that fail vs pass to find the parsing issue
 */

// Simulate the current parseRgb function from color-contrast-scanner.js
function parseRgb(rgbString) {
  const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return null;
  
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
    a: match[4] ? parseFloat(match[4]) : 1
  };
}

// Test colors from the CLEAN file (good-accessibility.html) 
console.log('=== CLEAN FILE COLORS (Should work) ===');
const cleanColors = [
  '#ffffff',
  '#333333', 
  '#2c3e50',
  '#555555',
  '#0066cc'
];

cleanColors.forEach(color => {
  console.log(`Color: ${color} → Parsed: ${JSON.stringify(parseRgb(color))}`);
});

// Test colors from PROBLEMATIC file (good-cognitive-accessibility.html)
console.log('\n=== PROBLEMATIC FILE COLORS (Currently failing) ===');
const problematicColors = [
  '#f1f8e9',
  '#e3f2fd', 
  '#2196f3',
  '#4caf50',
  '#2e7d32',
  '#1976d2'
];

problematicColors.forEach(color => {
  console.log(`Color: ${color} → Parsed: ${JSON.stringify(parseRgb(color))}`);
});

// Test computed styles that might be causing issues
console.log('\n=== COMPUTED STYLE EXAMPLES ===');
const computedExamples = [
  'rgb(241, 248, 233)', // #f1f8e9 as computed
  'rgb(227, 242, 253)', // #e3f2fd as computed  
  'rgb(33, 150, 243)',  // #2196f3 as computed
  'rgba(0, 0, 0, 0.87)', // Material Design text
  'transparent'
];

computedExamples.forEach(color => {
  console.log(`Computed: ${color} → Parsed: ${JSON.stringify(parseRgb(color))}`);
});

console.log('\n🔍 ROOT CAUSE ANALYSIS:');
console.log('- Clean file uses direct hex colors → but scanner gets computed RGB values');
console.log('- Problem: parseRgb() only handles rgb() format, not hex colors');
console.log('- Solution: Scanner needs to handle both hex AND computed rgb values');