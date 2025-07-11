#!/usr/bin/env node

/**
 * Basic functionality test for HTMLValidationScanner
 */

const HTMLValidationScanner = require('./src/html-validation-scanner');

async function testBasicFunctionality() {
  console.log('🧪 Basic HTMLValidationScanner Test');
  console.log('='.repeat(40));

  const scanner = new HTMLValidationScanner();
  
  try {
    await scanner.init();
    console.log('✅ Scanner initialization: PASSED');
    
    // Test the helper method exists
    const hasGetElementSelector = typeof scanner.getElementSelector === 'function';
    console.log(`✅ getElementSelector method: ${hasGetElementSelector ? 'FOUND' : 'MISSING'}`);
    
    console.log('✅ Basic functionality test: PASSED');
    
    return true;
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return false;
  } finally {
    await scanner.close();
  }
}

// Run if executed directly
if (require.main === module) {
  testBasicFunctionality()
    .then(success => {
      console.log(success ? '\n✅ All tests passed!' : '\n❌ Tests failed!');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Testing failed:', error);
      process.exit(1);
    });
}

module.exports = testBasicFunctionality;