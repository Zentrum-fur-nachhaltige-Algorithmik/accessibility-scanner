const puppeteer = require('puppeteer');

class BrowserPoolManager {
  constructor(options = {}) {
    this.maxBrowsers = options.maxBrowsers || 3;
    this.browsers = new Map();
    this.pagePool = new Map();
    this.browserConfigs = {
      'csp-bypass': {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox', 
          '--disable-web-security',
          '--disable-features=VizSecurityPolicy',
          '--disable-site-isolation-trials'
        ]
      },
      'strict': {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      },
      'mobile': {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 375, height: 667, isMobile: true }
      }
    };
    this.usage = new Map();
  }
  
  async getBrowser(type = 'csp-bypass') {
    if (!this.browsers.has(type)) {
      if (this.browsers.size >= this.maxBrowsers) {
        // Close least used browser
        const leastUsedType = this.getLeastUsedBrowserType();
        await this.closeBrowser(leastUsedType);
      }
      
      const config = this.browserConfigs[type];
      if (!config) {
        throw new Error(`Unknown browser type: ${type}`);
      }
      
      const browser = await puppeteer.launch(config);
      this.browsers.set(type, browser);
      this.usage.set(type, 0);
      
      console.log(`🌐 Created new browser instance: ${type}`);
    }
    
    this.usage.set(type, this.usage.get(type) + 1);
    return this.browsers.get(type);
  }
  
  async getPage(browserType = 'csp-bypass', options = {}) {
    const browser = await this.getBrowser(browserType);
    const page = await browser.newPage();
    
    // Apply page-specific configurations
    if (options.viewport) {
      await page.setViewport(options.viewport);
    }
    
    if (options.blockResources) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const blockedTypes = ['image', 'stylesheet', 'font', 'media'];
        if (blockedTypes.includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }
    
    return page;
  }
  
  getLeastUsedBrowserType() {
    let leastUsed = null;
    let minUsage = Infinity;
    
    for (const [type, usage] of this.usage.entries()) {
      if (usage < minUsage) {
        minUsage = usage;
        leastUsed = type;
      }
    }
    
    return leastUsed;
  }
  
  async closeBrowser(type) {
    const browser = this.browsers.get(type);
    if (browser) {
      await browser.close();
      this.browsers.delete(type);
      this.usage.delete(type);
      console.log(`🗑️ Closed browser instance: ${type}`);
    }
  }
  
  async closeAllBrowsers() {
    const closePromises = Array.from(this.browsers.values()).map(browser => browser.close());
    await Promise.all(closePromises);
    this.browsers.clear();
    this.usage.clear();
    console.log(`🗑️ Closed all browser instances`);
  }
  
  getStats() {
    return {
      activeBrowsers: this.browsers.size,
      maxBrowsers: this.maxBrowsers,
      usage: Object.fromEntries(this.usage),
      memoryUsage: process.memoryUsage()
    };
  }
}

module.exports = { BrowserPoolManager };