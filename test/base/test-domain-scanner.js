const { DomainScanner } = require('../../src/base/domain-scanner');
const puppeteer = require('puppeteer');

const BASE_SCANNER_TESTS = [
  {
    name: 'Domain Scanner Initialization',
    domain: 'visual',
    options: { securityMode: 'bypass', timeout: 30000 },
    expectedProperties: ['domain', 'browser', 'securityMode', 'screenshotDir'],
    description: 'Scanner should initialize with correct properties'
  },
  {
    name: 'Secure Browser Configuration - Bypass Mode',
    domain: 'interaction', 
    options: { securityMode: 'bypass', cspBypass: true },
    expectedArgs: ['--disable-web-security', '--disable-features=VizSecurityPolicy'],
    description: 'CSP bypass mode should include security disable flags'
  },
  {
    name: 'Secure Browser Configuration - Strict Mode',
    domain: 'content',
    options: { securityMode: 'strict', cspBypass: false },
    expectedArgs: ['--no-sandbox'],
    unexpectedArgs: ['--disable-web-security'],
    description: 'Strict mode should not include security bypass flags'
  }
];

async function runBaseScannerTests() {
  console.log('🏗️ Testing Base Scanner Class...');
  let passed = 0, failed = 0;
  
  for (const test of BASE_SCANNER_TESTS) {
    try {
      const scanner = new DomainScanner(test.domain, test.options);
      
      // Test initialization
      if (test.expectedProperties) {
        const hasAllProperties = test.expectedProperties.every(prop => 
          scanner.hasOwnProperty(prop)
        );
        
        if (hasAllProperties && scanner.domain === test.domain) {
          console.log(`✅ ${test.name}: PASS`);
          passed++;
        } else {
          console.log(`❌ ${test.name}: FAIL - Missing properties or incorrect domain`);
          failed++;
        }
      }
      
      // Test browser configuration
      if (test.expectedArgs || test.unexpectedArgs) {
        const browserConfig = scanner.createBrowserConfig();
        
        const hasExpected = !test.expectedArgs || test.expectedArgs.every(arg => 
          browserConfig.includes(arg)
        );
        
        const lacksUnexpected = !test.unexpectedArgs || !test.unexpectedArgs.some(arg => 
          browserConfig.includes(arg)
        );
        
        if (hasExpected && lacksUnexpected) {
          console.log(`✅ ${test.name}: PASS`);
          passed++;
        } else {
          console.log(`❌ ${test.name}: FAIL - Browser config incorrect`);
          console.log(`   Expected: ${test.expectedArgs}`);
          console.log(`   Actual: ${browserConfig}`);
          failed++;
        }
      }
      
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR - ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Base Scanner Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed, total: BASE_SCANNER_TESTS.length };
}

module.exports = { runBaseScannerTests };