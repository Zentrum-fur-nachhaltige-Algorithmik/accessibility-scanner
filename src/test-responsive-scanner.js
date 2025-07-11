const ResponsiveDesignScanner = require('./responsive-design-scanner');
const path = require('path');

/**
 * Test script for ResponsiveDesignScanner with visual debugging
 */
async function testResponsiveScanner() {
  console.log('🚀 Testing Responsive Design Scanner...\n');
  
  const scanner = new ResponsiveDesignScanner();
  
  try {
    // Test URLs - local test pages
    const goodUrl = `file://${path.join(__dirname, '../test-pages/phase6c-good-responsive.html')}`;
    const badUrl = `file://${path.join(__dirname, '../test-pages/phase6c-bad-responsive.html')}`;
    
    console.log('📊 Testing GOOD responsive example...');
    console.log(`URL: ${goodUrl}\n`);
    
    const goodResult = await scanner.scanResponsiveCompliance(goodUrl, {
      viewports: [
        { width: 320, height: 568, devicePixelRatio: 2, name: "iPhone SE" },
        { width: 768, height: 1024, devicePixelRatio: 2, name: "iPad" },
        { width: 1920, height: 1080, devicePixelRatio: 1, name: "Desktop" }
      ],
      testZoomLevels: [100, 200, 400],
      timeout: 30000
    });
    
    console.log('✅ GOOD Example Results:');
    console.log(`  Criteria: ${goodResult.criteria.join(', ')}`);
    console.log(`  Passed: ${goodResult.passed}`);
    console.log(`  Violations: ${goodResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Reflow Works: ${goodResult.summary.reflowWorks}`);
    console.log(`    Text Resizable: ${goodResult.summary.textResizable}`);
    console.log(`    Text Spacing OK: ${goodResult.summary.textSpacingOk}`);
    console.log(`    Content Loss at 320px: ${goodResult.summary.contentLossAt320px}`);
    console.log(`    Viewports Tested: ${goodResult.summary.viewportsTested}`);
    console.log(`    Zoom Levels Tested: ${goodResult.summary.zoomLevelsTested}`);
    console.log(`  Screenshots: ${goodResult.screenshotPath}`);
    
    if (goodResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      goodResult.violations.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        if (v.viewport) console.log(`       Viewport: ${v.viewport}`);
        if (v.zoomLevel) console.log(`       Zoom: ${v.zoomLevel}%`);
      });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    console.log('📊 Testing BAD responsive example...');
    console.log(`URL: ${badUrl}\n`);
    
    const badResult = await scanner.scanResponsiveCompliance(badUrl, {
      viewports: [
        { width: 320, height: 568, devicePixelRatio: 2, name: "iPhone SE" },
        { width: 768, height: 1024, devicePixelRatio: 2, name: "iPad" },
        { width: 1920, height: 1080, devicePixelRatio: 1, name: "Desktop" }
      ],
      testZoomLevels: [100, 200, 400],
      timeout: 30000
    });
    
    console.log('❌ BAD Example Results:');
    console.log(`  Criteria: ${badResult.criteria.join(', ')}`);
    console.log(`  Passed: ${badResult.passed}`);
    console.log(`  Violations: ${badResult.violations.length}`);
    console.log(`  Summary:`);
    console.log(`    Reflow Works: ${badResult.summary.reflowWorks}`);
    console.log(`    Text Resizable: ${badResult.summary.textResizable}`);
    console.log(`    Text Spacing OK: ${badResult.summary.textSpacingOk}`);
    console.log(`    Content Loss at 320px: ${badResult.summary.contentLossAt320px}`);
    console.log(`  Screenshots: ${badResult.screenshotPath}`);
    
    if (badResult.violations.length > 0) {
      console.log('\n  Violations Found:');
      badResult.violations.slice(0, 10).forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.criterion}: ${v.description}`);
        console.log(`       Issue: ${v.issue}`);
        if (v.viewport) console.log(`       Viewport: ${v.viewport}`);
        if (v.zoomLevel) console.log(`       Zoom: ${v.zoomLevel}%`);
        if (v.element) console.log(`       Element: ${v.element}`);
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
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await scanner.close();
  }
}

// Run test
testResponsiveScanner().catch(console.error);