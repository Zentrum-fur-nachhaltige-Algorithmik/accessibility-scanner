const puppeteer = require('puppeteer');

async function debugScreenshot() {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const reportPath = '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-289e5a1d-961c-441e-985b-9b5b18e0a92c/index.html';
    await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try viewport screenshot instead of fullPage
    await page.screenshot({
      path: '/mnt/c/Users/T14/Desktop/accessability/visual-inspection/screenshots/debug-viewport.png',
      fullPage: false,
      type: 'png'
    });
    
    console.log('✅ Viewport screenshot saved');
    
    // Check page dimensions
    const dimensions = await page.evaluate(() => {
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });
    
    console.log('📊 Page dimensions:', dimensions);
    
    // Check if violations are in DOM
    const violationCount = await page.evaluate(() => {
      return document.querySelectorAll('.violation-overlay').length;
    });
    
    console.log(`📊 Violations in DOM: ${violationCount}`);
    
    await browser.close();
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error);
  }
}

debugScreenshot();