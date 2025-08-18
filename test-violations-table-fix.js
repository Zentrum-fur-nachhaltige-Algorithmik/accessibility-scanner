const puppeteer = require('puppeteer');

/**
 * Test the violations table fix
 */
async function testViolationsTableFix() {
  console.log('🧪 Testing Violations Table Fix');
  
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Test the newly generated report
    const reportPath = '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-697b2351-be94-4ea2-98b8-12781441e248/index.html';
    console.log('📄 Loading test report...');
    
    await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check page dimensions
    const dimensions = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth
    }));
    
    console.log(`📊 Page dimensions: ${dimensions.width}x${dimensions.height}px`);
    
    // Check if violations table exists and is properly formatted
    const tableInfo = await page.evaluate(() => {
      const table = document.querySelector('.violations-table');
      if (!table) return { exists: false };
      
      const rows = table.querySelectorAll('tbody tr');
      const headers = table.querySelectorAll('thead th');
      
      return {
        exists: true,
        headerCount: headers.length,
        rowCount: rows.length,
        tableHTML: table.outerHTML.substring(0, 500),
        isCorrupted: table.innerHTML.includes('undefined') || table.innerHTML.includes('[object Object]')
      };
    });
    
    console.log('📋 Violations table check:', tableInfo);
    
    // Take a screenshot focused on the violations table
    await page.evaluate(() => {
      const violationsSection = document.querySelector('.violations-list');
      if (violationsSection) {
        violationsSection.scrollIntoView();
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await page.screenshot({
      path: '/mnt/c/Users/T14/Desktop/accessability/visual-inspection/screenshots/violations-table-fix-test.png',
      fullPage: false,
      type: 'png'
    });
    
    console.log('📸 Table screenshot saved: violations-table-fix-test.png');
    
    await browser.close();
    
    // Results
    if (dimensions.height < 10000 && tableInfo.exists && !tableInfo.isCorrupted) {
      console.log('✅ VIOLATIONS TABLE FIX SUCCESSFUL!');
      console.log(`  - Page height reduced to ${dimensions.height}px (was >18k)`);
      console.log(`  - Table has ${tableInfo.headerCount} headers and ${tableInfo.rowCount} rows`);
      console.log(`  - No corruption detected`);
      return true;
    } else {
      console.log('❌ Issues still exist:');
      if (dimensions.height >= 10000) console.log(`  - Page still too tall: ${dimensions.height}px`);
      if (!tableInfo.exists) console.log(`  - Violations table missing`);
      if (tableInfo.isCorrupted) console.log(`  - Table still corrupted`);
      return false;
    }
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Test error:', error.message);
    return false;
  }
}

testViolationsTableFix()
  .then(success => {
    if (success) {
      console.log('\n🎉 Phase 1 Fix Complete - Ready for Phase 2!');
    } else {
      console.log('\n🔧 Phase 1 needs more work');
    }
  });