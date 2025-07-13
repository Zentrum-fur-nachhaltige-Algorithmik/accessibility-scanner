#!/usr/bin/env node

const KeyboardNavigationScanner = require('./src/keyboard-navigation-scanner');
const path = require('path');

async function testGoodKeyboard() {
  const scanner = new KeyboardNavigationScanner();
  
  console.log('⌨️  Testing Good Keyboard File\n');
  
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
      simulateTabbing: false, // Disable visual tabbing to reduce output
      timeout: 10000
    });
    
    // Restore logging
    console.log = originalLog;
    
    console.log(`\n--- RESULTS ---`);
    console.log(`Passed: ${result.passed}`);
    console.log(`Total violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      console.log(`\n⚠️ Violations in GOOD file (should be zero):`);
      
      // Group violations by type
      const violationsByType = {};
      result.violations.forEach(v => {
        const type = v.issue || 'unknown';
        if (!violationsByType[type]) violationsByType[type] = [];
        violationsByType[type].push(v);
      });
      
      Object.entries(violationsByType).forEach(([type, violations]) => {
        console.log(`\n${type}: ${violations.length} violations`);
        violations.slice(0, 5).forEach((violation, i) => {
          console.log(`  ${i + 1}. ${violation.element}: ${violation.description || 'No description'}`);
        });
        if (violations.length > 5) {
          console.log(`  ... and ${violations.length - 5} more`);
        }
      });
    } else {
      console.log('\n✅ No violations found - keyboard scanner working correctly!');
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
  
  await scanner.close();
}

testGoodKeyboard().catch(console.error);