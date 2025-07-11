const PageStructureScanner = require('./src/page-structure-scanner');
const path = require('path');

/**
 * Quick test for Page Structure Scanner
 */
async function testPageStructureScanner() {
  console.log('🔍 Testing Page Structure Scanner');
  
  const scanner = new PageStructureScanner();
  
  try {
    // Test with good page
    const goodUrl = `file://${path.join(__dirname, 'test-pages/phase6b-good-keyboard.html')}`;
    console.log('\n📋 Testing Good Page Structure');
    const goodResult = await scanner.scanPageStructure(goodUrl);
    
    console.log('Results:');
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Has Page Title: ${goodResult.summary.hasPageTitle}`);
    console.log(`  Title Descriptive: ${goodResult.summary.titleDescriptive}`);
    console.log(`  Links Have Purpose: ${goodResult.summary.linksHavePurpose}`);
    console.log(`  Multiple Ways Available: ${goodResult.summary.multipleWaysAvailable}`);
    console.log(`  Headings Descriptive: ${goodResult.summary.headingsDescriptive}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\n🚨 Violations found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`  ${i + 1}. [${v.criterion}] ${v.issue}: ${v.description}`);
      });
    }

    // Test with bad page  
    const badUrl = `file://${path.join(__dirname, 'test-pages/phase6b-bad-keyboard-v2.html')}`;
    console.log('\n📋 Testing Bad Page Structure');
    const badResult = await scanner.scanPageStructure(badUrl);
    
    console.log('Results:');
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Has Page Title: ${badResult.summary.hasPageTitle}`);
    console.log(`  Title Descriptive: ${badResult.summary.titleDescriptive}`);
    console.log(`  Links Have Purpose: ${badResult.summary.linksHavePurpose}`);
    console.log(`  Multiple Ways Available: ${badResult.summary.multipleWaysAvailable}`);
    console.log(`  Headings Descriptive: ${badResult.summary.headingsDescriptive}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n🚨 Violations found:');
      badResult.violations.forEach((v, i) => {
        console.log(`  ${i + 1}. [${v.criterion}] ${v.issue}: ${v.description}`);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await scanner.close();
  }
}

if (require.main === module) {
  testPageStructureScanner().catch(console.error);
}