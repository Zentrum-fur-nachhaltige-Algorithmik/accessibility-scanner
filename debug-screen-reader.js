#!/usr/bin/env node

const ScreenReaderScanner = require('./src/screen-reader-scanner');
const path = require('path');

async function debugScreenReader() {
  const scanner = new ScreenReaderScanner();
  
  console.log('🔊 Debugging Screen Reader Scanner\n');
  
  // Test files
  const testFiles = [
    { name: 'bad-image-alt.html', expected: 'FAIL' },
    { name: 'bad-form-labels.html', expected: 'FAIL' },
    { name: 'good-accessibility.html', expected: 'PASS' }
  ];
  
  for (const testFile of testFiles) {
    const filePath = path.join(__dirname, 'test-sites', testFile.name);
    const fileUrl = `file://${filePath}`;
    
    try {
      console.log(`🔍 Testing: ${testFile.name} (expecting ${testFile.expected})`);
      
      // Suppress debug output
      const originalLog = console.log;
      console.log = () => {};
      
      const result = await scanner.screenReaderAnalysis(fileUrl);
      
      // Restore logging
      console.log = originalLog;
      
      console.log(`\n--- SCREEN READER ANALYSIS RESULTS ---`);
      console.log(`Page Title: ${result.pageTitle}`);
      console.log(`EU Compliance Score: ${result.euCompliance?.score || 'N/A'}%`);
      
      // Analyze heading structure
      if (result.headingStructure) {
        console.log(`\nHeading Structure:`);
        console.log(`  Total headings: ${result.headingStructure.totalHeadings}`);
        console.log(`  Logical order: ${result.headingStructure.logicalOrder ? 'YES' : 'NO'}`);
        if (result.headingStructure.violations?.length > 0) {
          console.log(`  Heading violations: ${result.headingStructure.violations.length}`);
        }
      }
      
      // Analyze images
      if (result.images) {
        console.log(`\nImage Analysis:`);
        console.log(`  Total images: ${result.images.totalImages}`);
        console.log(`  Missing alt text: ${result.images.missingAlt?.length || 0}`);
        console.log(`  Empty alt text: ${result.images.emptyAlt?.length || 0}`);
      }
      
      // Analyze forms
      if (result.forms) {
        console.log(`\nForm Analysis:`);
        console.log(`  Total forms: ${result.forms.totalForms}`);
        console.log(`  Unlabeled inputs: ${result.forms.unlabeledInputs?.length || 0}`);
      }
      
      // Analyze landmarks
      if (result.landmarks) {
        console.log(`\nLandmarks:`);
        console.log(`  Main landmarks: ${result.landmarks.main?.length || 0}`);
        console.log(`  Navigation landmarks: ${result.landmarks.navigation?.length || 0}`);
      }
      
      // Estimate pass/fail based on violations
      const hasViolations = (result.headingStructure?.violations?.length > 0) ||
                           (result.images?.missingAlt?.length > 0) ||
                           (result.forms?.unlabeledInputs?.length > 0);
      
      const actualResult = hasViolations ? 'FAIL' : 'PASS';
      console.log(`\nEstimated Result: ${actualResult} (based on violations)`);
      
      if (actualResult === testFile.expected) {
        console.log(`✅ CORRECT: Scanner behavior matches expectation`);
      } else {
        console.log(`❌ MISMATCH: Expected ${testFile.expected}, got ${actualResult}`);
      }
      
      console.log('\n' + '='.repeat(60) + '\n');
      
    } catch (error) {
      console.error(`❌ Error testing ${testFile.name}: ${error.message}\n`);
    }
  }
  
  await scanner.close();
}

debugScreenReader().catch(console.error);