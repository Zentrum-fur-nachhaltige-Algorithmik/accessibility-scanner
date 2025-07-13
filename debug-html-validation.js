#!/usr/bin/env node

const HTMLValidationScanner = require('./src/html-validation-scanner');
const path = require('path');

async function debugHTMLValidation() {
  const scanner = new HTMLValidationScanner();
  
  console.log('📋 Debugging HTML Validation Scanner\n');
  
  // Test bad HTML validation
  const badFile = 'bad-html-validation.html';
  const badPath = path.join(__dirname, 'test-sites', badFile);
  const badUrl = `file://${badPath}`;
  
  // Test good accessibility file  
  const goodFile = 'good-accessibility.html';
  const goodPath = path.join(__dirname, 'test-sites', goodFile);
  const goodUrl = `file://${goodPath}`;
  
  try {
    console.log('📛 Testing BAD HTML validation file...');
    
    const badResult = await scanner.scanHTMLCompliance(badUrl);
    
    console.log(`\n--- BAD FILE RESULTS ---`);
    console.log(`Passed: ${badResult.passed}`);
    console.log(`Total violations: ${badResult.violations.length}`);
    
    if (badResult.violations.length > 0) {
      console.log(`\n🚨 First 5 violations by type:`);
      
      const violationsByType = {};
      badResult.violations.forEach(v => {
        const type = v.type || v.issue || 'unknown';
        if (!violationsByType[type]) violationsByType[type] = [];
        violationsByType[type].push(v);
      });
      
      Object.entries(violationsByType).forEach(([type, violations]) => {
        console.log(`\n${type}: ${violations.length} violations`);
        violations.slice(0, 3).forEach((violation, i) => {
          console.log(`  ${i + 1}. ${violation.element || violation.selector}`);
          if (violation.description) {
            console.log(`     ${violation.description}`);
          }
        });
        if (violations.length > 3) {
          console.log(`  ... and ${violations.length - 3} more`);
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ Error testing bad file: ${error.message}`);
  }
  
  try {
    console.log(`\n\n✅ Testing GOOD HTML file...`);
    
    const goodResult = await scanner.scanHTMLCompliance(goodUrl);
    
    console.log(`\n--- GOOD FILE RESULTS ---`);
    console.log(`Passed: ${goodResult.passed}`);
    console.log(`Total violations: ${goodResult.violations.length}`);
    
    if (goodResult.violations.length > 0) {
      console.log(`\n⚠️ Unexpected violations in GOOD file:`);
      
      const violationsByType = {};
      goodResult.violations.forEach(v => {
        const type = v.type || v.issue || 'unknown';
        if (!violationsByType[type]) violationsByType[type] = [];
        violationsByType[type].push(v);
      });
      
      Object.entries(violationsByType).forEach(([type, violations]) => {
        console.log(`\n${type}: ${violations.length} violations`);
        violations.slice(0, 3).forEach((violation, i) => {
          console.log(`  ${i + 1}. ${violation.element || violation.selector}`);
          if (violation.description) {
            console.log(`     ${violation.description}`);
          }
        });
        if (violations.length > 3) {
          console.log(`  ... and ${violations.length - 3} more`);
        }
      });
    } else {
      console.log('\n✅ No violations found - HTML validation scanner working correctly!');
    }
    
  } catch (error) {
    console.error(`❌ Error testing good file: ${error.message}`);
  }
  
  await scanner.close();
}

debugHTMLValidation().catch(console.error);