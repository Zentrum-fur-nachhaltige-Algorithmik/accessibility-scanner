const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');

class DomainScanner {
  constructor(domain, options = {}) {
    this.domain = domain; // 'visual', 'interaction', 'content', 'assistive-tech', 'compliance'
    this.browser = null;
    this.securityMode = options.securityMode || 'bypass'; // 'bypass' | 'strict'
    this.cspBypass = options.cspBypass !== false;
    this.timeout = options.timeout || 60000;
    this.screenshotDir = this.getDomainScreenshotDir(domain);
    this.performanceMetrics = {
      startTime: null,
      endTime: null,
      memoryUsage: null,
      screenshotCount: 0
    };
  }
  
  // Domain-specific screenshot directory
  getDomainScreenshotDir(domain) {
    return path.join(__dirname, `../tmp/${domain}-screenshots`);
  }
  
  // Secure browser configuration
  createBrowserConfig() {
    const baseArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    
    if (this.securityMode === 'bypass' && this.cspBypass) {
      return [
        ...baseArgs,
        '--disable-web-security',
        '--disable-features=VizSecurityPolicy',
        '--disable-site-isolation-trials'
      ];
    }
    
    return baseArgs; // Strict mode
  }
  
  // Gemeinsame Browser-Initialisierung
  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: this.createBrowserConfig()
      });
    }
    await fs.ensureDir(this.screenshotDir);
    this.performanceMetrics.startTime = Date.now();
  }
  
  // Gemeinsame Page-Setup
  async setupPage(url, options = {}) {
    const page = await this.browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Performance optimization: Block unnecessary resources
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
    
    await page.goto(url, { 
      waitUntil: 'networkidle0', 
      timeout: this.timeout 
    });
    
    return page;
  }
  
  // Einheitliche Element-Selector-Generierung
  generateElementSelector(element) {
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const className = element.className && typeof element.className === 'string' 
      ? `.${element.className.split(' ')[0]}` 
      : '';
    const position = this.getElementPosition(element);
    return {
      selector: `${tagName}${id}${className}`,
      position,
      tagName,
      id: element.id,
      className: element.className
    };
  }
  
  getElementPosition(element) {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height
    };
  }
  
  // Standardisierte Screenshot-Verwaltung
  async takeScreenshot(page, filename = 'analysis.png', options = {}) {
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);
    
    const screenshotPath = path.join(scanDir, filename);
    await page.screenshot({
      path: screenshotPath,
      fullPage: options.fullPage !== false,
      ...options
    });
    
    this.performanceMetrics.screenshotCount++;
    return { path: screenshotPath, scanDir };
  }
  
  // Einheitliche Report-Struktur
  createReport(criteria, violations, summary, scanDir, visualEvidence = []) {
    this.performanceMetrics.endTime = Date.now();
    this.performanceMetrics.memoryUsage = process.memoryUsage();
    
    return {
      criteria,
      passed: violations.length === 0,
      violations,
      summary: {
        ...summary,
        domain: this.domain,
        totalViolations: violations.length,
        scanDuration: this.performanceMetrics.endTime - this.performanceMetrics.startTime,
        memoryUsage: this.performanceMetrics.memoryUsage,
        screenshotCount: this.performanceMetrics.screenshotCount
      },
      screenshotPath: scanDir,
      visualEvidence,
      timestamp: new Date().toISOString(),
      performance: this.performanceMetrics
    };
  }
  
  // Gemeinsame Cleanup
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
  
  // Error handling mit Context
  handleScannerError(error, context = {}) {
    const scannerError = new Error(`[${this.domain}] ${error.message}`);
    scannerError.originalError = error;
    scannerError.context = {
      domain: this.domain,
      timestamp: new Date().toISOString(),
      ...context
    };
    throw scannerError;
  }
}

module.exports = { DomainScanner };