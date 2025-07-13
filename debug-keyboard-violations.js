#!/usr/bin/env node

const KeyboardNavigationScanner = require('./src/keyboard-navigation-scanner');
const path = require('path');

async function debugKeyboardViolations() {
  const scanner = new KeyboardNavigationScanner();
  
  console.log('⌨️  Debugging Keyboard Violations Detail\n');
  
  // Test the good accessibility file
  const filePath = path.join(__dirname, 'test-sites', 'good-accessibility.html');
  const fileUrl = `file://${filePath}`;
  
  try {
    console.log('🔍 Testing: good-accessibility.html');
    
    // Reduce logging by overriding console.log temporarily
    const originalLog = console.log;
    console.log = () => {}; // Suppress scanner debug output
    
    const result = await scanner.scanKeyboardAccess(fileUrl, {
      testAllInteractives: true,
      simulateTabbing: false,
      timeout: 10000
    });
    
    // Restore logging
    console.log = originalLog;
    
    console.log(`\n--- DETAILED VIOLATION ANALYSIS ---`);
    console.log(`Total violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      console.log(`\n🔍 All violation details:`);
      
      result.violations.forEach((violation, i) => {
        console.log(`\n${i + 1}. Violation:`);
        console.log(`   Issue: ${violation.issue}`);
        console.log(`   Element: ${violation.element}`);
        console.log(`   Description: ${violation.description || 'N/A'}`);
        console.log(`   Criterion: ${violation.criterion}`);
        console.log(`   Severity: ${violation.severity || 'N/A'}`);
        console.log(`   Suggestion: ${violation.suggestion || 'N/A'}`);
      });
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  await scanner.close();
}

debugKeyboardViolations().catch(console.error);