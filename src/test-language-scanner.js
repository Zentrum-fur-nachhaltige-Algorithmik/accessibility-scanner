const LanguageDetectionScanner = require('./language-detection-scanner');
const path = require('path');

/**
 * Test script for LanguageDetectionScanner with iterative debugging
 */
async function testLanguageScanner() {
  console.log('🚀 Testing Language Detection Scanner...\n');
  
  const scanner = new LanguageDetectionScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6d-good-language-html.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6d-bad-language-html.html')}`;
    
    console.log('📊 Testing GOOD language example...');
    console.log(`URL: ${goodUrl}\n`);
    
    const goodResult = await scanner.scanLanguageCompliance(goodUrl, {
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Page Language Set: ${goodResult.summary.pageLanguageSet}`);
    console.log(`    Page Language Valid: ${goodResult.summary.pageLanguageValid}`);
    console.log(`    Multilingual Content Marked: ${goodResult.summary.multilingualContentMarked}`);
    console.log(`    Language Changes Marked: ${goodResult.summary.languageChangesMarked}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        if (v.element) console.log(`       Element: ${v.element}`);
        if (v.detectedLanguage) console.log(`       Detected: ${v.detectedLanguage}`);
        if (v.declaredLanguage) console.log(`       Declared: ${v.declaredLanguage}`);
        if (v.confidence) console.log(`       Confidence: ${v.confidence}%`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    console.log('📊 Testing BAD language example...');
    console.log(`URL: ${badUrl}\n`);
    
    const badResult = await scanner.scanLanguageCompliance(badUrl, {
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Page Language Set: ${badResult.summary.pageLanguageSet}`);
    console.log(`    Page Language Valid: ${badResult.summary.pageLanguageValid}`);
    console.log(`    Multilingual Content Marked: ${badResult.summary.multilingualContentMarked}`);
    console.log(`    Language Changes Marked: ${badResult.summary.languageChangesMarked}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      badResult.violations.slice(0, 10).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        if (v.element) console.log(`       Element: ${v.element}`);
        if (v.detectedLanguage) console.log(`       Detected: ${v.detectedLanguage}`);
        if (v.declaredLanguage) console.log(`       Declared: ${v.declaredLanguage}`);
        if (v.confidence) console.log(`       Confidence: ${v.confidence}%`);
        console.log(`       Suggestion: ${v.suggestion}`);
        console.log('');
      });
      
      if (badResult.violations.length > 10) {
        console.log(`    ... and ${badResult.violations.length - 10} more violations`);
      }
    }
    
    console.log('\n🎯 Test Summary:');
    console.log(`Good example should pass: ${goodResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bad example should fail: ${!badResult.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Detection working: ${!goodResult.passed || badResult.violations.length > 0 ? '✅ YES' : '❌ NO'}`);
    
    // Show visual evidence summary
    console.log('\n📋 Visual Evidence Summary:');
    console.log(`Good example evidence items: ${goodResult.visualEvidence.length}`);
    console.log(`Bad example evidence items: ${badResult.visualEvidence.length}`);
    
    if (goodResult.visualEvidence.length > 0) {
      console.log('\nGood example language detection:');
      goodResult.visualEvidence.forEach(ev => {
        console.log(`  Page Language: ${ev.pageLanguage || 'none'}`);
        console.log(`  Detected Language: ${ev.detectedLanguage || 'unknown'}`);
        console.log(`  Detection Confidence: ${ev.confidence || 0}%`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

// Run test
testLanguageScanner().catch(console.error);