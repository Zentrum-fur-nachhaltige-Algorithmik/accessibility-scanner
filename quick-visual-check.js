const puppeteer = require('puppeteer');
const path = require('path');

/**
 * Quick visual inspection of a specific report
 */
async function quickVisualCheck() {
  console.log('📸 Quick Visual Inspection - Medium Violations Report');
  
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    // Set desktop viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Load the medium violations report
    const reportPath = '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-289e5a1d-961c-441e-985b-9b5b18e0a92c/index.html';
    console.log('Loading:', reportPath);
    
    await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take full page screenshot
    await page.screenshot({
      path: '/mnt/c/Users/T14/Desktop/accessability/visual-inspection/screenshots/manual-medium-violations-full.png',
      fullPage: true,
      type: 'png'
    });
    
    console.log('✅ Screenshot saved: manual-medium-violations-full.png');
    
    // Check if violations are visible
    const violationOverlays = await page.$$('.violation-overlay');
    console.log(`📊 Found ${violationOverlays.length} violation overlays`);
    
    // Check if inspector panel works
    if (violationOverlays.length > 0) {
      console.log('🖱️ Clicking first violation...');
      await violationOverlays[0].click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await page.screenshot({
        path: '/mnt/c/Users/T14/Desktop/accessability/visual-inspection/screenshots/manual-medium-violations-inspector.png',
        fullPage: true,
        type: 'png'
      });
      
      console.log('✅ Inspector screenshot saved: manual-medium-violations-inspector.png');
    }
    
    await browser.close();
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error.message);
  }
}

quickVisualCheck();