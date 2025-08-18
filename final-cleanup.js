#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');
const fs = require('fs');
const path = require('path');

// Additional fixes for remaining patterns
const ADDITIONAL_FIXES = {
  // New patterns found
  '#28a745': '#1e7e34',  // Green variant - Bootstrap success 
  '#007cba': '#0056b3',  // Blue variant 
  '#1da1f2': '#0d8cd7',  // Twitter blue
  '#e1306c': '#c72650',  // Instagram pink
  '#66bb6a': '#4caf50',  // Light green
  '#0096c7': '#007bb3',  // Light blue
  '#6c757d': '#495057',  // Bootstrap secondary
  '#dee2e6': '#ffffff',  // Very light gray to white
  '#f8f9fa': '#ffffff',  // Bootstrap light to white  
  '#e6510a': '#d34100',  // Orange variant
  '#02779d': '#016c88',  // Teal variant
  '#333333': '#000000',  // Dark gray to black
  'rgb(255, 255, 255)': '#ffffff', // Handle rgb format
  'rgb(0, 0, 0)': '#000000',
  // Inline style fixes
  'color: rgb(255, 255, 255)': 'color: #000000',
  'background-color: rgb(241, 248, 233)': 'background-color: #ffffff',
};

async function finalCleanup() {
  console.log('🔧 FINAL CLEANUP - Targeting Remaining 45 Violations');
  console.log('='.repeat(60));
  
  const problematicFiles = [
    'good-css-background-accessible.html',
    'good-hover-focus-content.html', 
    'good-image-alt-complex.html',
    'good-keyboard-native-override.html',
    'good-landmarks.html',
    'good-motion-vestibular.html',
    'good-pointer-cancellation.html',
    'good-reading-level.html',
    'good-seizure-safe.html',
    'good-skip-links.html',
    'good-target-size.html',
    'good-text-spacing.html'
  ];
  
  let totalFixed = 0;
  
  for (const filename of problematicFiles) {
    console.log(`\n🎯 TARGETING: ${filename}`);
    
    const scanner = new ColorContrastScanner();
    const fileUrl = `file://${__dirname}/test-sites/${filename}`;
    
    try {
      // Check current violations
      let result = await scanner.scanColorContrast(fileUrl);
      const beforeViolations = result.violations.length;
      
      if (beforeViolations === 0) {
        console.log(`   ✅ Already clean`);
        await scanner.close();
        continue;
      }
      
      console.log(`   📊 ${beforeViolations} violations to fix`);
      
      // Show current patterns
      const colorPatterns = {};
      result.violations.forEach(v => {
        const pattern = `${v.foregroundColor} on ${v.backgroundColor}`;
        colorPatterns[pattern] = (colorPatterns[pattern] || 0) + 1;
      });
      
      console.log(`   🔍 Current patterns:`);
      Object.entries(colorPatterns)
        .sort(([,a], [,b]) => b - a)
        .forEach(([pattern, count]) => {
          console.log(`      ${count}x: ${pattern}`);
        });
      
      // Apply targeted fixes based on patterns
      const filePath = path.join(__dirname, 'test-sites', filename);
      let content = fs.readFileSync(filePath, 'utf8');
      let fixesApplied = 0;
      
      // Fix common remaining issues
      if (content.includes('rgb(241, 248, 233)')) {
        // Light green background causing white text issues
        content = content.replaceAll('rgb(241, 248, 233)', '#ffffff');
        content = content.replaceAll('#f1f8e9', '#ffffff');
        fixesApplied++;
        console.log(`   🔧 Fixed light green background`);
      }
      
      if (content.includes('rgb(255, 255, 255)') && content.includes('rgb(255, 255, 255)')) {
        // White on white issues - change text to black
        content = content.replaceAll('color: white', 'color: black');
        content = content.replaceAll('color: #ffffff', 'color: #000000'); 
        content = content.replaceAll('color: rgb(255, 255, 255)', 'color: #000000');
        fixesApplied++;
        console.log(`   🔧 Fixed white on white text`);
      }
      
      // Additional color fixes
      for (const [oldColor, newColor] of Object.entries(ADDITIONAL_FIXES)) {
        if (content.includes(oldColor)) {
          content = content.replaceAll(oldColor, newColor);
          fixesApplied++;
          console.log(`   🔧 ${oldColor} → ${newColor}`);
        }
      }
      
      // Bootstrap class fixes
      if (content.includes('btn-success')) {
        content = content.replaceAll('btn-success', 'btn-dark');
        fixesApplied++;
        console.log(`   🔧 Fixed Bootstrap success button`);
      }
      
      if (fixesApplied > 0) {
        fs.writeFileSync(filePath, content);
        
        // Re-test
        result = await scanner.scanColorContrast(fileUrl);
        const afterViolations = result.violations.length;
        const fixed = beforeViolations - afterViolations;
        totalFixed += fixed;
        
        if (afterViolations === 0) {
          console.log(`   ✅ COMPLETE: ${beforeViolations} → 0 violations`);
        } else {
          console.log(`   🔄 PROGRESS: ${beforeViolations} → ${afterViolations} violations (${fixed} fixed)`);
        }
      } else {
        console.log(`   ⚠️  No applicable fixes found`);
      }
      
      await scanner.close();
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      await scanner.close();
    }
  }
  
  console.log(`\n🎉 FINAL CLEANUP COMPLETE`);
  console.log(`📊 Additional violations fixed: ${totalFixed}`);
}

finalCleanup().catch(console.error);