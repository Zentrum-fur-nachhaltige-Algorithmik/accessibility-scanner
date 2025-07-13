#!/usr/bin/env node

const ScreenReaderScanner = require('./src/screen-reader-scanner');
const path = require('path');

async function verifyFormLabels() {
  const scanner = new ScreenReaderScanner();
  
  console.log('🔍 Verifying Form Label Detection\n');
  
  const testFile = path.join(__dirname, 'test-sites', 'bad-form-labels.html');
  const testUrl = `file://${testFile}`;
  
  try {
    console.log('📋 Testing: bad-form-labels.html with Screen Reader Scanner');
    
    const result = await scanner.screenReaderAnalysis(testUrl);
    
    console.log('\n--- FORM ANALYSIS RESULTS ---');
    console.log(`Total forms: ${result.forms.totalForms}`);
    console.log(`Total inputs: ${result.forms.totalInputs}`);
    console.log(`Labels correct: ${result.forms.labelsCorrect ? 'YES' : 'NO'}`);
    console.log(`Required fields: ${result.forms.requiredFields?.length || 0}`);
    
    // Check for unlabeled inputs
    if (result.forms.requiredFields) {
      const unlabeled = result.forms.requiredFields.filter(f => f.issue === 'No associated label found');
      console.log(`Unlabeled inputs found: ${unlabeled.length}`);
      
      if (unlabeled.length > 0) {
        console.log('\n🚨 Unlabeled inputs:');
        unlabeled.forEach((field, i) => {
          console.log(`  ${i + 1}. ${field.type} (ID: ${field.id || 'no ID'})`);
        });
      }
    }
    
    console.log('\n--- COMPARISON ---');
    console.log(`Screen Reader Scanner: ${result.forms.totalInputs} total inputs`);
    console.log(`Keyboard Scanner (via API): 12 violations`);
    
    if (!result.forms.labelsCorrect) {
      console.log('✅ Screen Reader Scanner confirms form label issues');
    } else {
      console.log('❌ Screen Reader Scanner says labels are correct');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  await scanner.close();
}

verifyFormLabels().catch(console.error);