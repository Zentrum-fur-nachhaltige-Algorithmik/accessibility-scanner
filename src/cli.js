#!/usr/bin/env node

const AccessibilityScanner = require('./scanner');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node src/cli.js <url>');
    console.log('Example: node src/cli.js https://example.com');
    process.exit(1);
  }

  const url = args[0];
  const scanner = new AccessibilityScanner();

  try {
    console.log(`Scanning: ${url}`);
    console.log('Please wait...');
    
    const result = await scanner.scanWebpage(url);
    
    console.log('\n=== Accessibility Scan Report ===');
    console.log(`URL: ${result.url}`);
    console.log(`Timestamp: ${result.timestamp}`);
    console.log(`Page Title: ${result.pageTitle}`);
    console.log(`Accessibility Score: ${result.accessibilityScore}/100`);
    console.log(`Passes: ${result.passes}`);
    console.log(`Violations: ${result.violations.length}`);
    
    if (result.error) {
      console.log(`\nError: ${result.error}`);
    }
    
    if (result.violations.length > 0) {
      console.log('\n=== Violations ===');
      result.violations.forEach((violation, index) => {
        console.log(`\n${index + 1}. ${violation.id} (${violation.impact})`);
        console.log(`   Description: ${violation.description}`);
        console.log(`   Help: ${violation.helpUrl}`);
        console.log(`   Affected elements: ${violation.nodes.join(', ')}`);
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error.message);
    process.exit(1);
  } finally {
    await scanner.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = main;