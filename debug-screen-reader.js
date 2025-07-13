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
        console.log(`  Structure valid: ${result.headingStructure.valid ? 'YES' : 'NO'}`);
        console.log(`  H1 count: ${result.headingStructure.h1Count}`);
        if (result.headingStructure.issues?.length > 0) {
          console.log(`  Heading issues: ${result.headingStructure.issues.length}`);
          result.headingStructure.issues.slice(0, 3).forEach((issue, i) => {
            console.log(`    ${i + 1}. ${issue}`);
          });
        }
      }
      
      // Analyze images
      if (result.images) {
        console.log(`\nImage Analysis:`);
        console.log(`  Total images: ${result.images.total}`);
        console.log(`  With alt text: ${result.images.withAlt}`);
        console.log(`  Decorative: ${result.images.decorative}`);
        console.log(`  Problematic: ${result.images.problematic?.length || 0}`);
        if (result.images.problematic?.length > 0) {
          console.log(`  Image issues:`);
          result.images.problematic.slice(0, 3).forEach((issue, i) => {
            console.log(`    ${i + 1}. ${issue.issue} (${issue.severity})`);
          });
        }
      }
      
      // Analyze forms
      if (result.forms) {
        console.log(`\nForm Analysis:`);
        console.log(`  Total forms: ${result.forms.totalForms}`);
        console.log(`  Total inputs: ${result.forms.totalInputs}`);
        console.log(`  Labels correct: ${result.forms.labelsCorrect ? 'YES' : 'NO'}`);
        console.log(`  Error handling: ${result.forms.errorHandling ? 'YES' : 'NO'}`);
        console.log(`  Required fields: ${result.forms.requiredFields?.length || 0}`);
        if (result.forms.requiredFields?.length > 0) {
          const unlabeled = result.forms.requiredFields.filter(f => f.issue === 'No associated label found');
          if (unlabeled.length > 0) {
            console.log(`  Unlabeled inputs: ${unlabeled.length}`);
            unlabeled.slice(0, 2).forEach((field, i) => {
              console.log(`    ${i + 1}. ${field.type} (${field.id || 'no ID'})`);
            });
          }
        }
      }
      
      // Analyze landmarks
      if (result.landmarks) {
        console.log(`\nLandmarks:`);
        console.log(`  Main landmarks: ${result.landmarks.main?.length || 0}`);
        console.log(`  Navigation landmarks: ${result.landmarks.navigation?.length || 0}`);
      }
      
      // Estimate pass/fail based on violations
      const hasImageViolations = result.images?.problematic?.length > 0;
      const hasFormViolations = !result.forms?.labelsCorrect;
      const hasHeadingViolations = !result.headingStructure?.valid;
      
      const hasViolations = hasImageViolations || hasFormViolations || hasHeadingViolations;
      
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