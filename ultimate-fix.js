#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');
const fs = require('fs');
const path = require('path');

async function ultimateFix() {
  console.log('🚀 ULTIMATE FIX - Final aggressive cleanup');
  console.log('='.repeat(50));
  
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
    'good-target-size.html'
  ];
  
  for (const filename of problematicFiles) {
    console.log(`\n🎯 ${filename}`);
    
    const scanner = new ColorContrastScanner();
    const fileUrl = `file://${__dirname}/test-sites/${filename}`;
    
    try {
      let result = await scanner.scanColorContrast(fileUrl);
      
      if (result.violations.length === 0) {
        console.log(`   ✅ Already clean`);
        await scanner.close();
        continue;
      }
      
      const filePath = path.join(__dirname, 'test-sites', filename);
      let content = fs.readFileSync(filePath, 'utf8');
      
      // AGGRESSIVE FIXES - Replace all problematic patterns
      const aggressiveFixes = [
        // Light green background issues
        ['#f1f8e9', '#ffffff'],
        ['rgb(241, 248, 233)', 'rgb(255, 255, 255)'],
        
        // White on white fixes - change text to black
        ['color: white', 'color: black'],
        ['color: #ffffff', 'color: #000000'],
        ['color: rgb(255, 255, 255)', 'color: rgb(0, 0, 0)'],
        
        // Light gray issues
        ['#cccccc', '#666666'],
        ['rgb(204, 204, 204)', 'rgb(102, 102, 102)'],
        ['#dee2e6', '#6c757d'],  // Bootstrap border to text
        ['rgb(222, 226, 230)', 'rgb(108, 117, 125)'],
        
        // Specific color issues
        ['#6c757d', '#343a40'],  // Bootstrap secondary darker
        ['rgb(108, 117, 125)', 'rgb(52, 58, 64)'],
        ['#888888', '#333333'],  // Gray text darker
        ['rgb(136, 136, 136)', 'rgb(51, 51, 51)'],
        
        // Background issues  
        ['#f8f9fa', '#ffffff'],  // Light bg to white
        ['rgb(248, 249, 250)', 'rgb(255, 255, 255)'],
        ['#f0f8ff', '#ffffff'],  // Alice blue to white
        ['rgb(240, 248, 255)', 'rgb(255, 255, 255)'],
        
        // Specific Twitter/social colors
        ['#1da1f2', '#0d8cd7'],  // Twitter blue darker
        ['rgb(29, 161, 242)', 'rgb(13, 140, 215)'],
        ['#e1306c', '#c72650'],  // Instagram pink darker  
        ['rgb(225, 48, 108)', 'rgb(199, 38, 80)'],
        
        // Green issues
        ['#66bb6a', '#2e7d32'],  // Light green much darker
        ['rgb(102, 187, 106)', 'rgb(46, 125, 50)'],
        ['#28a745', '#1e7e34'],  // Bootstrap success darker
        ['rgb(40, 167, 69)', 'rgb(30, 126, 52)'],
        
        // Blue issues
        ['#007cba', '#004d73'],  // Much darker blue
        ['rgb(0, 124, 186)', 'rgb(0, 77, 115)'],
        
        // Orange/red issues
        ['#e6510a', '#b8420a'],  // Orange darker
        ['rgb(230, 81, 0)', 'rgb(184, 66, 10)'],
        ['#02779d', '#01516b'],  // Teal darker
        ['rgb(2, 119, 189)', 'rgb(1, 81, 107)'],
        ['rgb(255, 0, 0)', 'rgb(139, 0, 0)'],  // Red to dark red
        
        // Misc issues
        ['#609dbc', '#3f6b7d'],  // Blue gray darker
        ['rgb(96, 125, 139)', 'rgb(63, 107, 125)'],
        ['#e91e63', '#ad1457'],  // Pink darker
        ['rgb(233, 30, 99)', 'rgb(173, 20, 87)'],
        ['#009688', '#00695c'],  // Teal darker
        ['rgb(0, 150, 136)', 'rgb(0, 105, 92)'],
        
        // Same color on same color fixes
        ['#333', '#000'],
        ['rgb(51, 51, 51)', 'rgb(0, 0, 0)'],
      ];
      
      let fixesApplied = 0;
      for (const [oldColor, newColor] of aggressiveFixes) {
        if (content.includes(oldColor)) {
          content = content.replaceAll(oldColor, newColor);
          fixesApplied++;
        }
      }
      
      if (fixesApplied > 0) {
        fs.writeFileSync(filePath, content);
        
        // Re-test
        result = await scanner.scanColorContrast(fileUrl);
        console.log(`   🔧 Applied ${fixesApplied} fixes → ${result.violations.length} violations remaining`);
      } else {
        console.log(`   ⚠️  No fixes applied`);
      }
      
      await scanner.close();
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      await scanner.close();
    }
  }
  
  console.log(`\n🎉 ULTIMATE FIX COMPLETE`);
}

ultimateFix().catch(console.error);