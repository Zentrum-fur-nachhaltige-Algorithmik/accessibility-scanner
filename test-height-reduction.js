const puppeteer = require('puppeteer');

async function testHeightReduction() {
  console.log('📏 Testing Page Height Reduction');
  
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const reportPath = '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-19070166-2e45-4a9b-99a8-7e1668c4af97/index.html';
    
    await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const dimensions = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth
    }));
    
    console.log(`📊 New page dimensions: ${dimensions.width}x${dimensions.height}px`);
    
    // Try fullPage screenshot to test if it works now
    try {
      await page.screenshot({
        path: '/mnt/c/Users/T14/Desktop/accessability/visual-inspection/screenshots/height-reduction-test-full.png',
        fullPage: true,
        type: 'png'
      });
      console.log('✅ Full page screenshot successful!');
    } catch (error) {
      console.log('❌ Full page screenshot still fails:', error.message);
    }
    
    await browser.close();
    
    if (dimensions.height < 5000) {
      console.log('🎉 SUCCESS: Page height significantly reduced!');
      console.log(`  Before: >18,000px`);
      console.log(`  After: ${dimensions.height}px`);
      console.log(`  Reduction: ${Math.round((18000 - dimensions.height) / 18000 * 100)}%`);
      return true;
    } else {
      console.log(`⚠️ Still needs work: ${dimensions.height}px (target: <5000px)`);
      return false;
    }
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Test error:', error);
    return false;
  }
}

testHeightReduction();