#!/usr/bin/env node

/**
 * Debug CSP Bypass Methods & CDP API Issues
 * Tests various CSP circumvention techniques
 */

const puppeteer = require('puppeteer');
const fs = require('fs-extra');

class CSPBypassDebugger {
  constructor() {
    this.browser = null;
    this.testResults = [];
  }

  async init() {
    console.log('🔧 Initializing CSP Bypass Debugger...');
    console.log(`📦 Puppeteer version: ${require('puppeteer/package.json').version}`);
  }

  /**
   * Test all CSP bypass methods systematically
   */
  async testAllBypassMethods() {
    const testUrl = 'https://www.gov.uk';
    console.log(`\n🎯 Testing CSP bypass methods on: ${testUrl}\n`);

    const methods = [
      {
        name: 'CDP_APIv1',
        description: 'Classic CDP page._client.send',
        test: this.testCDPv1.bind(this)
      },
      {
        name: 'CDP_APIv2', 
        description: 'Modern CDP session approach',
        test: this.testCDPv2.bind(this)
      },
      {
        name: 'EvaluateOnNewDocument',
        description: 'Inject before CSP loads',
        test: this.testEvaluateOnNewDocument.bind(this)
      },
      {
        name: 'BrowserArgsExtreme',
        description: 'Extreme browser security disable',
        test: this.testExtremeSecurityDisable.bind(this)
      },
      {
        name: 'ContextOverride',
        description: 'Custom browser context',
        test: this.testContextOverride.bind(this)
      },
      {
        name: 'ResponseInterception',
        description: 'Intercept and modify CSP headers',
        test: this.testResponseInterception.bind(this)
      }
    ];

    for (const method of methods) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🧪 TESTING: ${method.name}`);
      console.log(`📋 Description: ${method.description}`);
      console.log(`${'='.repeat(60)}`);

      try {
        const result = await method.test(testUrl);
        this.testResults.push({
          method: method.name,
          success: result.success,
          error: result.error,
          details: result.details
        });

        if (result.success) {
          console.log(`✅ ${method.name} SUCCESS!`);
          console.log(`📊 Details: ${JSON.stringify(result.details, null, 2)}`);
        } else {
          console.log(`❌ ${method.name} FAILED: ${result.error}`);
        }
      } catch (error) {
        console.log(`💥 ${method.name} CRASHED: ${error.message}`);
        this.testResults.push({
          method: method.name,
          success: false,
          error: error.message,
          details: null
        });
      }

      // Clean up between tests
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.printSummary();
  }

  /**
   * Method 1: Classic CDP API (page._client.send)
   */
  async testCDPv1(url) {
    this.browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await this.browser.newPage();

    try {
      console.log('   🔍 Testing page._client.send availability...');
      
      const hasClient = typeof page._client !== 'undefined';
      const hasSend = hasClient && typeof page._client.send === 'function';
      
      console.log(`   📊 page._client exists: ${hasClient}`);
      console.log(`   📊 page._client.send exists: ${hasSend}`);

      if (!hasSend) {
        return {
          success: false,
          error: 'page._client.send is not available',
          details: { hasClient, hasSend }
        };
      }

      // Try to use it
      await page._client.send('Page.setBypassCSP', { enabled: true });
      console.log('   ✅ CDP command sent successfully');

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.addScriptTag({ content: axeSource });

      const axeAvailable = await page.evaluate(() => typeof axe !== 'undefined');
      
      return {
        success: axeAvailable,
        error: axeAvailable ? null : 'Axe still not available after CDP bypass',
        details: { cdpBypassSent: true, axeAvailable }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: null
      };
    }
  }

  /**
   * Method 2: Modern CDP Session API
   */
  async testCDPv2(url) {
    this.browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await this.browser.newPage();

    try {
      console.log('   🔍 Testing modern CDP session API...');
      
      // Get CDP session
      const client = await page.target().createCDPSession();
      console.log('   📊 CDP session created');

      // Try bypass
      await client.send('Page.setBypassCSP', { enabled: true });
      console.log('   ✅ CSP bypass sent via CDP session');

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.addScriptTag({ content: axeSource });

      const axeAvailable = await page.evaluate(() => typeof axe !== 'undefined');
      
      return {
        success: axeAvailable,
        error: axeAvailable ? null : 'Axe still not available after modern CDP bypass',
        details: { cdpSessionCreated: true, axeAvailable }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: null
      };
    }
  }

  /**
   * Method 3: evaluateOnNewDocument (before CSP)
   */
  async testEvaluateOnNewDocument(url) {
    this.browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await this.browser.newPage();

    try {
      console.log('   🔍 Testing evaluateOnNewDocument injection...');
      
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      
      // Inject before page loads (before CSP)
      await page.evaluateOnNewDocument(axeSource);
      console.log('   ✅ Axe injected via evaluateOnNewDocument');

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      
      const axeAvailable = await page.evaluate(() => typeof axe !== 'undefined');
      
      return {
        success: axeAvailable,
        error: axeAvailable ? null : 'Axe not available after pre-load injection',
        details: { preLoadInjection: true, axeAvailable }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: null
      };
    }
  }

  /**
   * Method 4: Extreme Security Disable
   */
  async testExtremeSecurityDisable(url) {
    try {
      console.log('   🔍 Testing extreme security disable flags...');
      
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizSecurityPolicy',
          '--disable-site-isolation-trials',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--aggressive-cache-discard',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-field-trial-config',
          '--disable-ipc-flooding-protection'
        ]
      });

      const page = await this.browser.newPage();
      
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.addScriptTag({ content: axeSource });

      const axeAvailable = await page.evaluate(() => typeof axe !== 'undefined');
      
      return {
        success: axeAvailable,
        error: axeAvailable ? null : 'Axe not available even with extreme flags',
        details: { extremeFlags: true, axeAvailable }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: null
      };
    }
  }

  /**
   * Method 5: Custom Browser Context
   */
  async testContextOverride(url) {
    try {
      console.log('   🔍 Testing custom browser context...');
      
      this.browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-web-security'] 
      });

      // Create custom context
      const context = await this.browser.createIncognitoBrowserContext();
      const page = await context.newPage();

      // Override permissions
      await context.overridePermissions(url, ['geolocation', 'notifications']);
      
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.addScriptTag({ content: axeSource });

      const axeAvailable = await page.evaluate(() => typeof axe !== 'undefined');
      
      return {
        success: axeAvailable,
        error: axeAvailable ? null : 'Axe not available with custom context',
        details: { customContext: true, axeAvailable }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: null
      };
    }
  }

  /**
   * Method 6: Response Interception & CSP Header Modification
   */
  async testResponseInterception(url) {
    this.browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await this.browser.newPage();

    try {
      console.log('   🔍 Testing response interception...');
      
      // Enable request interception
      await page.setRequestInterception(true);
      
      let cspHeaderFound = false;
      
      page.on('response', response => {
        const headers = response.headers();
        if (headers['content-security-policy']) {
          cspHeaderFound = true;
          console.log(`   📋 CSP Header found: ${headers['content-security-policy'].substring(0, 100)}...`);
        }
      });

      page.on('request', request => {
        // Modify requests to disable CSP
        const headers = { ...request.headers() };
        delete headers['content-security-policy'];
        
        request.continue({ headers });
      });

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.addScriptTag({ content: axeSource });

      const axeAvailable = await page.evaluate(() => typeof axe !== 'undefined');
      
      return {
        success: axeAvailable,
        error: axeAvailable ? null : 'Axe not available despite response interception',
        details: { cspHeaderFound, requestInterception: true, axeAvailable }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: null
      };
    }
  }

  printSummary() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎯 CSP BYPASS METHODS SUMMARY');
    console.log(`${'='.repeat(80)}`);

    const successful = this.testResults.filter(r => r.success);
    const failed = this.testResults.filter(r => !r.success);

    console.log(`✅ Successful methods: ${successful.length}/${this.testResults.length}`);
    console.log(`❌ Failed methods: ${failed.length}/${this.testResults.length}`);

    if (successful.length > 0) {
      console.log('\n🏆 WORKING METHODS:');
      successful.forEach(result => {
        console.log(`   ✅ ${result.method}`);
      });
    }

    if (failed.length > 0) {
      console.log('\n💥 FAILED METHODS:');
      failed.forEach(result => {
        console.log(`   ❌ ${result.method}: ${result.error}`);
      });
    }

    // Save detailed results
    fs.writeJsonSync('./tmp/csp-bypass-debug-results.json', {
      timestamp: new Date().toISOString(),
      puppeteerVersion: require('puppeteer/package.json').version,
      results: this.testResults
    }, { spaces: 2 });

    console.log(`\n📊 Detailed results saved to: ./tmp/csp-bypass-debug-results.json`);
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Run if executed directly
if (require.main === module) {
  const cspDebugger = new CSPBypassDebugger();
  
  cspDebugger.init()
    .then(() => cspDebugger.testAllBypassMethods())
    .then(() => cspDebugger.cleanup())
    .then(() => {
      console.log('\n✅ CSP bypass debugging completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Debug session failed:', error);
      process.exit(1);
    });
}

module.exports = CSPBypassDebugger;