const ImagesOfTextScanner = require('./src/images-of-text-scanner');

/**
 * Debug the Images of Text scanner to understand false positives
 */
async function debugImagesScanner() {
  console.log('🔍 Debugging Images of Text Scanner...\n');
  
  const scanner = new ImagesOfTextScanner();
  
  try {
    const result = await scanner.scanImagesOfText('https://webaim.org', {
      useOCR: false,
      skipLogos: true,
      skipDecorative: true
    });
    
    console.log(`📊 Results Summary:`);
    console.log(`  Total Violations: ${result.violations.length}`);
    console.log(`  Scanner Passed: ${result.passed}`);
    console.log(`  Total Images: ${result.summary.totalImages}`);
    console.log(`  Suspected Text Images: ${result.summary.suspectedTextImages}`);
    console.log(`  Confirmed Text Images: ${result.summary.confirmedTextImages}`);
    
    console.log(`\n📋 Violation Details:`);
    result.violations.slice(0, 10).forEach((violation, i) => {
      console.log(`  ${i + 1}. Element: ${violation.element}`);
      console.log(`     Image URL: ${violation.imageUrl}`);
      console.log(`     Detected Text: ${violation.detectedText}`);
      console.log(`     Confidence: ${violation.confidence}%`);
      console.log(`     Reason: ${violation.reason}`);
      console.log(`     Suggestion: ${violation.suggestion}`);
      console.log('');
    });
    
    if (result.violations.length > 10) {
      console.log(`  ... and ${result.violations.length - 10} more violations`);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await scanner.close();
  }
}

// Run debug
debugImagesScanner().catch(console.error);