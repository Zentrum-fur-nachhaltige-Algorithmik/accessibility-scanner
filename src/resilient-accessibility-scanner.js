const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

// Import existing scanners
const ScreenReaderScanner = require('./screen-reader-scanner');
const ColorContrastScanner = require('./color-contrast-scanner');
const HTMLValidationScanner = require('./html-validation-scanner');
const KeyboardNavigationScanner = require('./keyboard-navigation-scanner');
const LanguageDetectionScanner = require('./language-detection-scanner');

/**
 * Resilient Accessibility Scanner with 3-Tier Fallback Strategy
 * 
 * Tier 1: Standard axe scanning
 * Tier 2: CSP mitigation techniques
 * Tier 3: Axe-independent fallback scanners
 */
class ResilientAccessibilityScanner {
  constructor() {
    this.browser = null;
    this.screenshotDir = path.join(__dirname, '../tmp/resilient-screenshots');
    
    // Initialize specialized scanners
    this.screenReaderScanner = new ScreenReaderScanner();
    this.colorContrastScanner = new ColorContrastScanner();
    this.htmlValidationScanner = new HTMLValidationScanner();
    this.keyboardNavigationScanner = new KeyboardNavigationScanner();
    this.languageDetectionScanner = new LanguageDetectionScanner();
    
    // CSP Mitigation strategies (ordered by success probability)
    this.cspMitigations = [
      {
        name: 'EvaluateOnNewDocument',
        description: 'Inject axe before CSP loads',
        apply: this.applyEvaluateOnNewDocument.bind(this)
      },
      {
        name: 'ModernCDPBypass',
        description: 'Use modern CDP session to bypass CSP',
        apply: this.applyCSPBypass.bind(this)
      },
      {
        name: 'ContentInjection',
        description: 'Inject axe source code directly',
        apply: this.applyContentInjection.bind(this)
      },
      {
        name: 'SecurityDisabled',
        description: 'Launch with security disabled',
        apply: this.applySecurityDisabled.bind(this)
      }
    ];
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    await fs.ensureDir(this.screenshotDir);
  }

  /**
   * Main resilient scanning method with 3-tier fallback
   */
  async resilientScan(url, options = {}) {
    const scanId = `scan-${Date.now()}`;
    const scanDir = path.join(this.screenshotDir, scanId);
    await fs.ensureDir(scanDir);

    console.log(`🔍 Starting resilient scan for: ${url}`);
    
    const report = {
      url,
      scanId,
      timestamp: new Date().toISOString(),
      strategy: null,
      screenshots: [],
      axeResults: null,
      fallbackResults: null,
      errors: [],
      performance: {}
    };

    // TIER 1: Standard Axe Scanning
    console.log('📊 TIER 1: Attempting standard axe scan...');
    const tier1Start = Date.now();
    
    try {
      const axeResult = await this.standardAxeScan(url, scanDir);
      report.strategy = 'StandardAxe';
      report.axeResults = axeResult;
      report.performance.tier1Duration = Date.now() - tier1Start;
      
      console.log('✅ TIER 1: Standard axe scan successful!');
      await this.captureVisualValidation(url, scanDir, 'tier1-success');
      
      return report;
    } catch (error) {
      report.errors.push({ tier: 1, error: error.message, strategy: 'StandardAxe' });
      console.log(`❌ TIER 1: Standard axe failed - ${error.message}`);
    }

    // TIER 2: CSP Mitigation Attempts
    console.log('🛠️ TIER 2: Attempting CSP mitigations...');
    
    for (const mitigation of this.cspMitigations) {
      const tier2Start = Date.now();
      console.log(`   🔧 Trying ${mitigation.name}: ${mitigation.description}`);
      
      try {
        const axeResult = await mitigation.apply(url, scanDir);
        report.strategy = `CSPMitigation_${mitigation.name}`;
        report.axeResults = axeResult;
        report.performance[`tier2_${mitigation.name}Duration`] = Date.now() - tier2Start;
        
        console.log(`✅ TIER 2: ${mitigation.name} successful!`);
        await this.captureVisualValidation(url, scanDir, `tier2-${mitigation.name}-success`);
        
        return report;
      } catch (error) {
        report.errors.push({ 
          tier: 2, 
          error: error.message, 
          strategy: mitigation.name 
        });
        console.log(`   ❌ ${mitigation.name} failed - ${error.message}`);
      }
    }

    // TIER 3: Axe-Independent Fallback
    console.log('🔄 TIER 3: Using axe-independent fallback scanners...');
    const tier3Start = Date.now();
    
    try {
      const fallbackResult = await this.comprehensiveFallbackScan(url, scanDir);
      report.strategy = 'AxeIndependentFallback';
      report.fallbackResults = fallbackResult;
      report.performance.tier3Duration = Date.now() - tier3Start;
      
      console.log('✅ TIER 3: Fallback scanners successful!');
      await this.captureVisualValidation(url, scanDir, 'tier3-fallback-success');
      
      return report;
    } catch (error) {
      report.errors.push({ tier: 3, error: error.message, strategy: 'FallbackScanners' });
      console.log(`❌ TIER 3: Fallback scanners failed - ${error.message}`);
      throw new Error(`All tiers failed for ${url}`);
    }
  }

  /**
   * TIER 1: Standard Axe Scanning
   */
  async standardAxeScan(url, scanDir) {
    await this.init();
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // ENHANCED TIMING: Wait for dynamic Vue.js/Nuxt.js content
      console.log('   ⏱️  Waiting for dynamic content to fully load...');
      
      // Wait for specific elements that we know should be there
      try {
        await page.waitForSelector('img', { timeout: 10000 });
        console.log('   ✅ Images detected');
      } catch {
        console.log('   ⚠️  No images found within 10s');
      }
      
      try {
        await page.waitForSelector('input[type=\"email\"], input[placeholder*=\"mail\"]', { timeout: 10000 });
        console.log('   ✅ Email inputs detected');
      } catch {
        console.log('   ⚠️  No email inputs found within 10s');
      }
      
      // Additional wait for Vue.js hydration
      await new Promise(resolve => setTimeout(resolve, 8000));
      console.log('   ✅ Extended wait completed');
      
      // Take screenshot before axe injection
      await page.screenshot({ 
        path: path.join(scanDir, 'before-axe-injection.png'),
        fullPage: true 
      });

      // Standard axe injection
      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });

      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ error: 'axe is not defined after injection' });
            return;
          }
          
          // COMPREHENSIVE SCAN with ALL available rules + role="none" override
          const axeConfig = {
            // Include ALL WCAG levels and best practices
            tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'],
            // Explicitly enable critical rules and override role-based exclusions
            rules: {
              'image-alt': { 
                enabled: true,
                // Override role="none" exclusion for functional images
                selector: 'img, [role="img"], svg[role="img"]'
              },
              'label': { enabled: true },               // Form labels
              'input-image-alt': { enabled: true },     // Input image alt
              'aria-hidden-focus': { enabled: true },   // Hidden focus
              'color-contrast': { enabled: true },      // Color contrast
              'heading-order': { enabled: true },       // Heading hierarchy
              'landmark-one-main': { enabled: true },   // Main landmark
              'region': { enabled: true },              // Page regions
              'form-field-multiple-labels': { enabled: true }
            },
            // Override default exclusions
            exclude: [],
            // Force checking of elements that might be ignored
            allowedOrigins: ['<same>'],
            // Check elements regardless of presentation role
            elementRef: true
          };
          
          axe.run(axeConfig, (err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      });

      if (results.error) {
        throw new Error(results.error);
      }

      // Take screenshot after successful axe run
      await page.screenshot({ 
        path: path.join(scanDir, 'after-axe-success.png'),
        fullPage: true 
      });

      return this.processAxeResults(results, await page.title());
    } finally {
      await page.close();
    }
  }

  /**
   * TIER 2 Mitigation: EvaluateOnNewDocument (inject before CSP)
   */
  async applyEvaluateOnNewDocument(url, scanDir) {
    await this.init();
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Read axe source and inject before page loads (before CSP applies)
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      await page.evaluateOnNewDocument(axeSource);
      
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ error: 'axe is not defined after evaluateOnNewDocument' });
            return;
          }
          
          axe.run((err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      });

      if (results.error) {
        throw new Error(results.error);
      }

      await page.screenshot({ 
        path: path.join(scanDir, 'evaluate-on-new-document-success.png'),
        fullPage: true 
      });

      return this.processAxeResults(results, await page.title());
    } finally {
      await page.close();
    }
  }

  /**
   * TIER 2 Mitigation: Content Injection
   */
  async applyContentInjection(url, scanDir) {
    await this.init();
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Read axe source code
      const axeSource = await fs.readFile('./node_modules/axe-core/axe.min.js', 'utf8');
      
      // Inject axe source directly
      await page.addScriptTag({ content: axeSource });
      
      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ error: 'axe is not defined after content injection' });
            return;
          }
          
          axe.run((err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      });

      if (results.error) {
        throw new Error(results.error);
      }

      await page.screenshot({ 
        path: path.join(scanDir, 'content-injection-success.png'),
        fullPage: true 
      });

      return this.processAxeResults(results, await page.title());
    } finally {
      await page.close();
    }
  }

  /**
   * TIER 2 Mitigation: Modern CDP CSP Bypass
   */
  async applyCSPBypass(url, scanDir) {
    await this.init();
    const page = await this.browser.newPage();
    
    try {
      // Use modern CDP session API
      const client = await page.target().createCDPSession();
      await client.send('Page.setBypassCSP', { enabled: true });
      
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });

      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ error: 'axe is not defined after CSP bypass' });
            return;
          }
          
          axe.run((err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      });

      if (results.error) {
        throw new Error(results.error);
      }

      await page.screenshot({ 
        path: path.join(scanDir, 'csp-bypass-success.png'),
        fullPage: true 
      });

      await client.detach();
      return this.processAxeResults(results, await page.title());
    } finally {
      await page.close();
    }
  }

  /**
   * TIER 2 Mitigation: Security Disabled
   */
  async applySecurityDisabled(url, scanDir) {
    // Close current browser and launch with security disabled
    if (this.browser) {
      await this.browser.close();
    }
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizSecurityPolicy'
      ]
    });
    
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      await page.addScriptTag({
        path: './node_modules/axe-core/axe.min.js'
      });

      const results = await page.evaluate(() => {
        return new Promise((resolve) => {
          if (typeof axe === 'undefined') {
            resolve({ error: 'axe is not defined with security disabled' });
            return;
          }
          
          axe.run((err, results) => {
            if (err) {
              resolve({ error: err.message });
            } else {
              resolve(results);
            }
          });
        });
      });

      if (results.error) {
        throw new Error(results.error);
      }

      await page.screenshot({ 
        path: path.join(scanDir, 'security-disabled-success.png'),
        fullPage: true 
      });

      return this.processAxeResults(results, await page.title());
    } finally {
      await page.close();
      
      // Restore normal browser for fallback scans
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * TIER 3: Comprehensive Fallback Scanning
   */
  async comprehensiveFallbackScan(url, scanDir) {
    console.log('   🔍 Running specialized scanners...');
    
    const fallbackResults = {
      strategy: 'AxeIndependentFallback',
      scanners: {},
      aggregatedScore: 0,
      totalViolations: 0,
      coverage: []
    };

    // Run all specialized scanners in parallel
    const scannerPromises = [
      this.runSpecializedScanner('ScreenReader', () => 
        this.screenReaderScanner.screenReaderAnalysis(url)),
      this.runSpecializedScanner('ColorContrast', () => 
        this.colorContrastScanner.scanColorContrast(url, { wcagLevel: 'AA' })),
      this.runSpecializedScanner('HTMLValidation', () => 
        this.htmlValidationScanner.scanHTMLCompliance(url)),
      this.runSpecializedScanner('KeyboardNavigation', () => 
        this.keyboardNavigationScanner.scanKeyboardAccess(url)),
      this.runSpecializedScanner('LanguageDetection', () => 
        this.languageDetectionScanner.scanLanguageCompliance(url))
    ];

    const scannerResults = await Promise.allSettled(scannerPromises);

    // Process scanner results
    scannerResults.forEach((result, index) => {
      const scannerName = ['ScreenReader', 'ColorContrast', 'HTMLValidation', 'KeyboardNavigation', 'LanguageDetection'][index];
      
      if (result.status === 'fulfilled') {
        fallbackResults.scanners[scannerName] = result.value;
        fallbackResults.coverage.push(scannerName);
        console.log(`   ✅ ${scannerName} scanner completed`);
      } else {
        fallbackResults.scanners[scannerName] = { error: result.reason.message };
        console.log(`   ❌ ${scannerName} scanner failed: ${result.reason.message}`);
      }
    });

    // Calculate aggregated metrics
    fallbackResults.aggregatedScore = this.calculateFallbackScore(fallbackResults.scanners);
    fallbackResults.totalViolations = this.countFallbackViolations(fallbackResults.scanners);

    // Take comprehensive screenshot
    await this.captureVisualValidation(url, scanDir, 'fallback-comprehensive');

    return fallbackResults;
  }

  async runSpecializedScanner(name, scanFunction) {
    try {
      const result = await scanFunction();
      return { name, success: true, result };
    } catch (error) {
      return { name, success: false, error: error.message };
    }
  }

  async captureVisualValidation(url, scanDir, phase) {
    await this.init();
    const page = await this.browser.newPage();
    
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Full page screenshot
      await page.screenshot({ 
        path: path.join(scanDir, `${phase}-fullpage.png`),
        fullPage: true 
      });
      
      // Viewport screenshot
      await page.screenshot({ 
        path: path.join(scanDir, `${phase}-viewport.png`)
      });
      
      // Mobile viewport screenshot
      await page.setViewport({ width: 375, height: 667 });
      await page.screenshot({ 
        path: path.join(scanDir, `${phase}-mobile.png`)
      });
      
      console.log(`📸 Visual validation screenshots saved for ${phase}`);
    } finally {
      await page.close();
    }
  }

  processAxeResults(axeResults, pageTitle) {
    const violations = axeResults.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact || 'minor',
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map(node => node.target[0] || 'unknown'),
      wcagCriteria: violation.tags?.filter(tag => tag.startsWith('wcag')) || []
    }));

    const totalChecks = axeResults.passes.length + violations.length;
    const accessibilityScore = totalChecks > 0 
      ? Math.round((axeResults.passes.length / totalChecks) * 100)
      : 0;

    return {
      accessibilityScore,
      violations,
      passes: axeResults.passes.length,
      pageTitle,
      totalChecks,
      wcagCompliance: this.assessWCAGCompliance(violations)
    };
  }

  calculateFallbackScore(scanners) {
    let totalScore = 0;
    let validScanners = 0;
    
    Object.values(scanners).forEach(scanner => {
      if (scanner.result && typeof scanner.result.score === 'number') {
        totalScore += scanner.result.score;
        validScanners++;
      }
    });
    
    return validScanners > 0 ? Math.round(totalScore / validScanners) : 0;
  }

  countFallbackViolations(scanners) {
    let totalViolations = 0;
    
    Object.values(scanners).forEach(scanner => {
      if (scanner.result && Array.isArray(scanner.result.violations)) {
        totalViolations += scanner.result.violations.length;
      }
    });
    
    return totalViolations;
  }

  assessWCAGCompliance(violations) {
    const criteria = violations.flatMap(v => v.wcagCriteria || []);
    return {
      level: criteria.some(c => c.includes('wcagaaa')) ? 'AAA' : 'AA',
      criteria: [...new Set(criteria)]
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    
    // Close specialized scanners
    if (this.screenReaderScanner.close) await this.screenReaderScanner.close();
    if (this.colorContrastScanner.close) await this.colorContrastScanner.close();
    if (this.htmlValidationScanner.close) await this.htmlValidationScanner.close();
    if (this.keyboardNavigationScanner.close) await this.keyboardNavigationScanner.close();
    if (this.languageDetectionScanner.close) await this.languageDetectionScanner.close();
  }
}

module.exports = ResilientAccessibilityScanner;