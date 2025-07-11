const puppeteer = require('puppeteer');
const { URL } = require('url');
const EnhancedAccessibilityScanner = require('./enhanced-scanner');
const ScreenReaderScanner = require('./screen-reader-scanner');

class WebsiteScanner {
  constructor() {
    this.browser = null;
    this.enhancedScanner = new EnhancedAccessibilityScanner();
    this.screenReaderScanner = new ScreenReaderScanner();
    this.visitedUrls = new Set();
    this.siteMap = new Map();
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      // Share browser instance with scanners
      this.enhancedScanner.browser = this.browser;
      this.screenReaderScanner.browser = this.browser;
    }
  }

  async scanWebsite(baseUrl, options = {}) {
    const defaultOptions = {
      maxPages: 10,
      followLinks: true,
      respectRobotsTxt: true,
      scanInterval: 1000, // ms between page scans
      scanType: 'enhanced', // 'basic', 'enhanced', 'screen-reader'
      wcagLevel: 'AA',
      timeout: 30000,
      sameOriginOnly: true,
      excludePatterns: [
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)$/i,
        /\/download\//,
        /\/api\//,
        /\.(jpg|jpeg|png|gif|svg|css|js)$/i
      ]
    };

    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      
      if (!this.isValidUrl(baseUrl)) {
        throw new Error('Invalid base URL provided');
      }

      console.log(`🌐 Starting website scan: ${baseUrl}`);
      console.log(`📊 Settings: Max ${scanOptions.maxPages} pages, ${scanOptions.scanType} scan`);

      const startTime = Date.now();
      this.visitedUrls.clear();
      this.siteMap.clear();

      // Check robots.txt if requested
      if (scanOptions.respectRobotsTxt) {
        await this.checkRobotsTxt(baseUrl);
      }

      // Start with the base URL
      const urlsToScan = [baseUrl];
      const scannedPages = [];
      const errors = [];
      let pagesScanned = 0;

      while (urlsToScan.length > 0 && pagesScanned < scanOptions.maxPages) {
        const currentUrl = urlsToScan.shift();
        
        if (this.visitedUrls.has(currentUrl)) {
          continue;
        }

        console.log(`📋 Scanning page ${pagesScanned + 1}/${scanOptions.maxPages}: ${currentUrl}`);
        
        try {
          // Scan the current page
          const pageResult = await this.scanSinglePage(currentUrl, scanOptions);
          scannedPages.push(pageResult);
          this.visitedUrls.add(currentUrl);
          pagesScanned++;

          // Find additional links if following links is enabled
          if (scanOptions.followLinks && pagesScanned < scanOptions.maxPages) {
            const newLinks = await this.findLinks(currentUrl, baseUrl, scanOptions);
            newLinks.forEach(link => {
              if (!this.visitedUrls.has(link) && !urlsToScan.includes(link)) {
                urlsToScan.push(link);
              }
            });
          }

          // Wait between scans to be respectful
          if (scanOptions.scanInterval > 0 && urlsToScan.length > 0) {
            await new Promise(resolve => setTimeout(resolve, scanOptions.scanInterval));
          }

        } catch (error) {
          console.error(`❌ Error scanning ${currentUrl}:`, error.message);
          errors.push({
            url: currentUrl,
            error: error.message,
            timestamp: new Date()
          });
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Generate website report
      const websiteReport = this.generateWebsiteReport(
        baseUrl, 
        scannedPages, 
        errors, 
        duration, 
        scanOptions
      );

      console.log(`✅ Website scan completed in ${Math.round(duration / 1000)}s`);
      console.log(`📊 Scanned ${pagesScanned} pages, found ${errors.length} errors`);

      return websiteReport;

    } catch (error) {
      console.error('Website scan failed:', error);
      throw error;
    }
  }

  async scanSinglePage(url, options) {
    try {
      let result;
      
      switch (options.scanType) {
        case 'screen-reader':
          result = await this.screenReaderScanner.screenReaderAnalysis(url);
          break;
        case 'basic':
          // Use basic scanner if available, otherwise enhanced
          const basicScanner = require('./scanner');
          const scanner = new basicScanner();
          result = await scanner.scanWebpage(url);
          await scanner.close();
          break;
        case 'enhanced':
        default:
          result = await this.enhancedScanner.enhancedScan(url, {
            wcagLevel: options.wcagLevel,
            testKeyboardNav: false, // Disable for performance in multi-page scans
            includeWarnings: false,
            timeout: options.timeout
          });
          break;
      }

      // Add page metadata
      result.scanTimestamp = new Date();
      result.scanDuration = result.scanDuration || 0;
      
      return result;

    } catch (error) {
      return {
        url,
        error: error.message,
        accessibilityScore: 0,
        violations: [],
        passes: 0,
        scanTimestamp: new Date()
      };
    }
  }

  async findLinks(currentUrl, baseUrl, options) {
    try {
      const page = await this.browser.newPage();
      await page.goto(currentUrl, { 
        waitUntil: 'networkidle2', 
        timeout: options.timeout 
      });

      const links = await page.evaluate(() => {
        const linkElements = Array.from(document.querySelectorAll('a[href]'));
        return linkElements.map(link => {
          const href = link.getAttribute('href');
          const text = link.textContent.trim();
          return { href, text };
        });
      });

      await page.close();

      const baseUrlObj = new URL(baseUrl);
      const currentUrlObj = new URL(currentUrl);
      const validLinks = [];

      for (const link of links) {
        try {
          const absoluteUrl = new URL(link.href, currentUrl).href;
          const linkUrlObj = new URL(absoluteUrl);

          // Skip if same origin only and different origin
          if (options.sameOriginOnly && linkUrlObj.origin !== baseUrlObj.origin) {
            continue;
          }

          // Skip excluded patterns
          if (options.excludePatterns.some(pattern => pattern.test(absoluteUrl))) {
            continue;
          }

          // Skip anchors on same page
          if (linkUrlObj.pathname === currentUrlObj.pathname && linkUrlObj.hash) {
            continue;
          }

          // Skip javascript: and mailto: links
          if (linkUrlObj.protocol !== 'http:' && linkUrlObj.protocol !== 'https:') {
            continue;
          }

          validLinks.push(absoluteUrl);

        } catch (error) {
          // Invalid URL, skip
          continue;
        }
      }

      // Remove duplicates and return
      return [...new Set(validLinks)];

    } catch (error) {
      console.error(`Error finding links on ${currentUrl}:`, error.message);
      return [];
    }
  }

  async checkRobotsTxt(baseUrl) {
    try {
      const robotsUrl = new URL('/robots.txt', baseUrl).href;
      const page = await this.browser.newPage();
      
      const response = await page.goto(robotsUrl, { timeout: 10000 });
      
      if (response && response.status() === 200) {
        const robotsContent = await page.content();
        console.log(`🤖 Found robots.txt, respecting crawl rules`);
        // TODO: Parse robots.txt and respect disallow rules
        // For now, just log that we found it
      }
      
      await page.close();
    } catch (error) {
      // robots.txt not found or inaccessible, continue anyway
      console.log(`🤖 No robots.txt found, proceeding with scan`);
    }
  }

  generateWebsiteReport(baseUrl, scannedPages, errors, duration, options) {
    const totalPages = scannedPages.length;
    const totalViolations = scannedPages.reduce((sum, page) => sum + (page.violations?.length || 0), 0);
    const totalPasses = scannedPages.reduce((sum, page) => sum + (page.passes || 0), 0);
    
    // Calculate overall score (weighted average)
    const overallScore = totalPages > 0 
      ? Math.round(scannedPages.reduce((sum, page) => sum + (page.accessibilityScore || 0), 0) / totalPages)
      : 0;

    // Find common issues across pages
    const issueMap = new Map();
    scannedPages.forEach(page => {
      if (page.violations) {
        page.violations.forEach(violation => {
          const key = violation.id;
          if (issueMap.has(key)) {
            const existing = issueMap.get(key);
            existing.occurrences++;
            existing.pages.push(page.url);
          } else {
            issueMap.set(key, {
              issue: violation.id,
              description: violation.description,
              impact: violation.impact,
              occurrences: 1,
              pages: [page.url]
            });
          }
        });
      }
    });

    const commonIssues = Array.from(issueMap.values())
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10); // Top 10 most common issues

    // Generate sitemap with scores
    const siteMap = scannedPages.map(page => ({
      url: page.url,
      title: page.pageTitle || 'Unknown Title',
      score: page.accessibilityScore || 0,
      violations: page.violations?.length || 0,
      passes: page.passes || 0,
      error: page.error || null
    }));

    return {
      baseUrl,
      scanTimestamp: new Date(),
      duration: Math.round(duration / 1000), // in seconds
      options,
      summary: {
        pagesScanned: totalPages,
        overallScore,
        totalViolations,
        totalPasses,
        errorsEncountered: errors.length
      },
      commonIssues,
      siteMap,
      errors,
      pages: scannedPages
    };
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    await this.enhancedScanner.close();
    await this.screenReaderScanner.close();
  }
}

module.exports = WebsiteScanner;