const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  try {
    console.log('Testing example.com...');
    await page.goto('https://example.com', { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('Page loaded successfully');
    
    await page.addScriptTag({ path: './node_modules/axe-core/axe.min.js' });
    console.log('Axe script added successfully');
    
    const results = await page.evaluate(() => {
      const axeAvailable = typeof axe !== 'undefined';
      console.log('In evaluate, axe available:', axeAvailable);
      return axeAvailable ? 'axe loaded' : 'axe not available';
    });
    
    console.log('Example.com results:', results);
    
    // Test gov.uk
    console.log('\nTesting gov.uk...');
    await page.goto('https://www.gov.uk', { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('Gov.uk page loaded successfully');
    
    await page.addScriptTag({ path: './node_modules/axe-core/axe.min.js' });
    console.log('Axe script added to gov.uk successfully');
    
    const govResults = await page.evaluate(() => {
      const axeAvailable = typeof axe !== 'undefined';
      console.log('In gov.uk evaluate, axe available:', axeAvailable);
      return axeAvailable ? 'axe loaded' : 'axe not available';
    });
    
    console.log('Gov.uk results:', govResults);
    
  } catch (error) {
    console.log('Caught error:', error.message);
  } finally {
    await browser.close();
  }
})();