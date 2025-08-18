const puppeteer = require('puppeteer');

async function showBeeproducedReport() {
  console.log('📸 Capturing beeproduced.com comprehensive report...');
  
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const reportPath = '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-fb9473c5-7551-4da4-a514-ff9b13a81209/index.html';
    
    await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take full report screenshot
    await page.screenshot({
      path: '/mnt/c/Users/T14/Desktop/accessability/beeproduced-comprehensive-report.png',
      fullPage: true,
      type: 'png'
    });
    
    // Also take viewport screenshot of main interface
    await page.screenshot({
      path: '/mnt/c/Users/T14/Desktop/accessability/beeproduced-report-main.png',
      fullPage: false,
      type: 'png'
    });
    
    // Test clicking on a violation to show inspector panel
    const violations = await page.$$('.violation-overlay');
    if (violations.length > 0) {
      await violations[0].click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await page.screenshot({
        path: '/mnt/c/Users/T14/Desktop/accessability/beeproduced-report-inspector.png',
        fullPage: false,
        type: 'png'
      });
      
      console.log('✅ Inspector panel screenshot captured');
    }
    
    await browser.close();
    
    console.log('✅ All beeproduced.com report screenshots captured!');
    console.log('📁 Files:');
    console.log('  - beeproduced-comprehensive-report.png (full report)');
    console.log('  - beeproduced-report-main.png (main interface)');
    console.log('  - beeproduced-report-inspector.png (inspector panel active)');
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error);
  }
}

showBeeproduced();