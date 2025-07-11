const puppeteer = require('puppeteer');

class AccessibilityScanner {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  async scanWebpage(url) {
    try {
      await this.init();
      
      if (!this.isValidUrl(url)) {
        return this.createErrorReport(url, 'Invalid URL format');
      }

      const page = await this.browser.newPage();
      
      await page.goto(url, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });

      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });

      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          axe.run((err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      });

      const pageTitle = await page.title();
      await page.close();

      if (results.error) {
        return this.createErrorReport(url, results.error);
      }

      return this.createReport(url, results, pageTitle);

    } catch (error) {
      let errorMessage = 'Unknown error occurred';
      
      if (error.name === 'TimeoutError') {
        errorMessage = 'Failed to load page: Timeout';
      } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        errorMessage = 'Failed to load page: DNS lookup failed';
      } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
        errorMessage = 'Failed to load page: Connection refused';
      }

      return this.createErrorReport(url, errorMessage);
    }
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  createReport(url, axeResults, pageTitle) {
    const violations = axeResults.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact || 'minor',
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map(node => node.target[0] || 'unknown')
    }));

    const totalChecks = axeResults.passes.length + violations.length;
    const accessibilityScore = totalChecks > 0 
      ? Math.round((axeResults.passes.length / totalChecks) * 100)
      : 0;

    return {
      url,
      timestamp: new Date(),
      accessibilityScore,
      violations,
      passes: axeResults.passes.length,
      pageTitle: pageTitle || ''
    };
  }

  createErrorReport(url, errorMessage) {
    return {
      url,
      timestamp: new Date(),
      accessibilityScore: 0,
      violations: [],
      passes: 0,
      pageTitle: '',
      error: errorMessage
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = AccessibilityScanner;