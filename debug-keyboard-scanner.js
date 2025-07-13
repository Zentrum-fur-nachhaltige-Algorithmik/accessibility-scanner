#!/usr/bin/env node

const KeyboardNavigationScanner = require('./src/keyboard-navigation-scanner');
const path = require('path');

async function debugKeyboardScanner() {
  const scanner = new KeyboardNavigationScanner();
  
  console.log('⌨️  Debugging Keyboard Navigation Scanner\n');
  
  // Test keyboard accessibility bad examples
  const keyboardBadFiles = [
    'bad-keyboard-access.html',
    'bad-keyboard-trap.html', 
    'bad-focus-order.html',
    'bad-focus-visible.html'
  ];
  
  // Test keyboard accessibility good examples  
  const keyboardGoodFiles = [
    'good-accessibility.html'
  ];
  
  console.log('📛 Testing BAD keyboard examples...\n');
  
  for (const filename of keyboardBadFiles) {
    const filePath = path.join(__dirname, 'test-sites', filename);
    const fileUrl = `file://${filePath}`;
    
    try {
      console.log(`🔍 Testing: ${filename}`);
      const result = await scanner.scanKeyboardAccess(fileUrl, {
        testAllInteractives: true,
        simulateTabbing: true,
        timeout: 30000
      });
      
      console.log(`   Passed: ${result.passed}`);
      console.log(`   Total violations: ${result.violations.length}`);
      console.log(`   Interactive elements: ${result.summary?.totalInteractiveElements || 'N/A'}`);
      
      if (result.violations.length > 0) {
        console.log(`   🚨 First 3 violations:`);
        result.violations.slice(0, 3).forEach((violation, i) => {
          console.log(`     ${i + 1}. ${violation.type}: ${violation.element || violation.description}`);
        });
      }
      console.log('');
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  console.log('✅ Testing GOOD keyboard examples...\n');
  
  for (const filename of keyboardGoodFiles) {
    const filePath = path.join(__dirname, 'test-sites', filename);
    const fileUrl = `file://${filePath}`;
    
    try {
      console.log(`🔍 Testing: ${filename}`);
      const result = await scanner.scanKeyboardAccess(fileUrl, {
        testAllInteractives: true,
        simulateTabbing: true,
        timeout: 30000
      });
      
      console.log(`   Passed: ${result.passed}`);
      console.log(`   Total violations: ${result.violations.length}`);
      console.log(`   Interactive elements: ${result.summary?.totalInteractiveElements || 'N/A'}`);
      
      if (result.violations.length > 0) {
        console.log(`   ⚠️ Unexpected violations:`);
        result.violations.slice(0, 3).forEach((violation, i) => {
          console.log(`     ${i + 1}. ${violation.type}: ${violation.element || violation.description}`);
        });
      }
      console.log('');
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  await scanner.close();
}

debugKeyboardScanner().catch(console.error);