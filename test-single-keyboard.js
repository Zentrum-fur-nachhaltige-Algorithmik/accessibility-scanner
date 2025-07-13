#!/usr/bin/env node

const KeyboardNavigationScanner = require('./src/keyboard-navigation-scanner');
const path = require('path');

async function testSingleKeyboard() {
  const scanner = new KeyboardNavigationScanner();
  
  console.log('⌨️  Testing Single Keyboard File\n');
  
  // Test just the bad keyboard access file
  const filePath = path.join(__dirname, 'test-sites', 'bad-keyboard-access.html');
  const fileUrl = `file://${filePath}`;
  
  try {
    console.log('🔍 Testing: bad-keyboard-access.html');
    
    // Reduce logging by overriding console.log temporarily
    const originalLog = console.log;
    console.log = () => {}; // Suppress scanner debug output
    
    const result = await scanner.scanKeyboardAccess(fileUrl, {
      testAllInteractives: true,
      simulateTabbing: false, // Disable visual tabbing to reduce output
      timeout: 10000
    });
    
    // Restore logging
    console.log = originalLog;
    
    console.log(`\n--- RESULTS ---`);
    console.log(`Passed: ${result.passed}`);
    console.log(`Total violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      console.log(`\n🚨 First 10 violations by type:`);
      
      // Group violations by type
      const violationsByType = {};
      result.violations.forEach(v => {
        const type = v.issue || 'unknown';
        if (!violationsByType[type]) violationsByType[type] = [];
        violationsByType[type].push(v);
      });
      
      Object.entries(violationsByType).forEach(([type, violations]) => {
        console.log(`\n${type}: ${violations.length} violations`);
        violations.slice(0, 3).forEach((violation, i) => {
          console.log(`  ${i + 1}. ${violation.element}`);
        });
        if (violations.length > 3) {
          console.log(`  ... and ${violations.length - 3} more`);
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  await scanner.close();
}

testSingleKeyboard().catch(console.error);