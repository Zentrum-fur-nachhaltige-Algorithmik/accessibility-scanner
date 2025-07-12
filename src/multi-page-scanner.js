const NavigationDiscovery = require('./navigation-discovery');
const LinkPrioritizer = require('./link-prioritizer');
const CrawlingOptimizer = require('./crawling-optimizer');
const ResilientAccessibilityScanner = require('./resilient-accessibility-scanner');
const fs = require('fs-extra');
const path = require('path');

/**
 * Multi-Page Accessibility Scanner
 * Main orchestrator combining navigation discovery, prioritization, and CSP-aware scanning
 */
class MultiPageScanner {
  constructor(options = {}) {
    this.navigationDiscovery = new NavigationDiscovery();
    this.linkPrioritizer = new LinkPrioritizer();
    this.crawlingOptimizer = new CrawlingOptimizer();
    this.resilientScanner = new ResilientAccessibilityScanner();
    
    this.options = {
      maxPages: 50,
      maxDepth: 2,
      timeout: 30000,
      includeScreenshots: true,
      generateReport: true,
      ...options
    };

    this.scanResults = [];
    this.scanMetrics = {
      startTime: null,
      endTime: null,
      pagesDiscovered: 0,
      pagesScanned: 0,
      pagesSkipped: 0,
      cspStrategiesUsed: {},
      errors: []
    };
  }

  /**
   * Scan entire website for accessibility issues
   * @param {string} baseUrl - Website base URL
   * @param {Object} scanOptions - Scanning options
   * @returns {Object} Complete site scan results
   */
  async scanSite(baseUrl, scanOptions = {}) {
    const options = { ...this.options, ...scanOptions };
    
    console.log(`🕷️ Starting multi-page accessibility scan: ${baseUrl}`);
    console.log(`📋 Configuration: maxPages=${options.maxPages}, maxDepth=${options.maxDepth}`);
    
    this.scanMetrics.startTime = new Date();
    
    try {
      // Phase 1: Page Discovery
      console.log('\n📍 Phase 1: Page Discovery');
      const discoveredPages = await this.discoverPages(baseUrl, options);
      this.scanMetrics.pagesDiscovered = discoveredPages.length;
      
      if (discoveredPages.length === 0) {
        throw new Error('No pages discovered for scanning');
      }

      // Phase 2: Prioritization  
      console.log('\n🎯 Phase 2: Page Prioritization');
      const prioritizedPages = this.prioritizePages(discoveredPages, options);
      
      // Phase 3: Pattern Recognition & Optimization
      console.log('\n🔍 Phase 3: Pattern Recognition & Optimization');
      const optimizationResult = await this.optimizePageList(prioritizedPages, options);
      const finalPages = optimizationResult.optimizedPages;
      
      console.log(`📊 Optimization complete: ${discoveredPages.length} → ${finalPages.length} pages (${optimizationResult.optimization.reductionPercentage}% reduction)`);

      // Phase 4: Multi-Page Accessibility Scanning
      console.log('\n📊 Phase 4: Multi-Page Accessibility Scanning');
      const scanResults = await this.scanPagesWithCSPStrategies(finalPages, options);
      
      // Phase 5: Site-Wide Report Generation
      console.log('\n📄 Phase 5: Site-Wide Report Generation');
      const siteReport = await this.generateSiteReport(scanResults, baseUrl, {
        discoveredPages,
        optimization: optimizationResult.optimization,
        patterns: optimizationResult.patterns
      });
      
      this.scanMetrics.endTime = new Date();
      
      console.log(`\n✅ Multi-page scan completed successfully!`);
      console.log(`⏱️  Total time: ${this.scanMetrics.endTime - this.scanMetrics.startTime}ms`);
      console.log(`📊 Scanned ${this.scanMetrics.pagesScanned}/${this.scanMetrics.pagesDiscovered} pages`);
      
      return siteReport;
      
    } catch (error) {
      this.scanMetrics.endTime = new Date();
      this.scanMetrics.errors.push(error.message);
      
      console.error('❌ Multi-page scan failed:', error.message);
      throw error;
    } finally {
      // Cleanup
      await this.cleanup();
    }
  }

  /**
   * Discover pages through navigation analysis
   * @param {string} baseUrl - Base URL
   * @param {Object} options - Discovery options
   * @returns {Array} Discovered pages
   */
  async discoverPages(baseUrl, options) {
    try {
      const discovered = await this.navigationDiscovery.discoverNavigation(baseUrl, {
        maxDepth: options.maxDepth,
        timeout: options.timeout
      });
      
      if (discovered.length === 0) {
        console.log('⚠️  No navigation discovered, will scan homepage only');
        return [{
          url: baseUrl,
          text: 'Homepage',
          containerType: 'homepage',
          importance: 100,
          priorityScore: 100
        }];
      }
      
      console.log(`✅ Discovered ${discovered.length} pages via navigation analysis`);
      return discovered;
      
    } catch (error) {
      console.error('❌ Page discovery failed:', error.message);
      // Fallback to homepage only
      return [{
        url: baseUrl,
        text: 'Homepage (fallback)',
        containerType: 'homepage',
        importance: 100,
        priorityScore: 100
      }];
    }
  }

  /**
   * Prioritize discovered pages
   * @param {Array} discoveredPages - Discovered pages
   * @param {Object} options - Prioritization options
   * @returns {Array} Prioritized pages
   */
  prioritizePages(discoveredPages, options) {
    const prioritized = this.linkPrioritizer.rankPages(discoveredPages, {
      maxPages: options.maxPages * 2, // Allow extra for optimization phase
      includeScore: true
    });
    
    const filtered = this.linkPrioritizer.filterPages(prioritized, {
      minScore: 10,
      removeDuplicates: true
    });
    
    console.log(`✅ Prioritized pages: ${filtered.length} high-value pages identified`);
    return filtered;
  }

  /**
   * Optimize page list using pattern recognition
   * @param {Array} prioritizedPages - Prioritized pages
   * @param {Object} options - Optimization options
   * @returns {Object} Optimization results
   */
  async optimizePageList(prioritizedPages, options) {
    const optimizationResult = await this.crawlingOptimizer.optimizePageList(prioritizedPages, {
      maxPages: options.maxPages,
      preserveCriticalPages: true,
      balanceAccessibilityExamples: true
    });
    
    console.log(`✅ Page optimization completed`);
    return optimizationResult;
  }

  /**
   * Scan pages with CSP strategy adaptation
   * @param {Array} pages - Pages to scan
   * @param {Object} options - Scanning options
   * @returns {Array} Scan results
   */
  async scanPagesWithCSPStrategies(pages, options) {
    const results = [];
    const startTime = Date.now();
    
    console.log(`🔍 Scanning ${pages.length} pages with adaptive CSP strategies...`);
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNumber = i + 1;
      
      console.log(`\n📊 [${pageNumber}/${pages.length}] Scanning: ${page.url}`);
      console.log(`   Priority Score: ${page.priorityScore || 'N/A'}`);
      console.log(`   Container Type: ${page.containerType || 'unknown'}`);
      
      try {
        const pageStartTime = Date.now();
        
        // Perform resilient accessibility scan
        const pageResult = await this.resilientScanner.resilientScan(page.url, {
          includeScreenshot: options.includeScreenshots,
          timeout: options.timeout
        });
        
        const scanDuration = Date.now() - pageStartTime;
        
        // Track CSP strategy used
        if (pageResult.cspStrategy) {
          this.scanMetrics.cspStrategiesUsed[pageResult.cspStrategy] = 
            (this.scanMetrics.cspStrategiesUsed[pageResult.cspStrategy] || 0) + 1;
        }
        
        const enrichedResult = {
          ...pageResult,
          pageInfo: page,
          scanDuration: scanDuration,
          timestamp: new Date().toISOString(),
          pageNumber: pageNumber
        };
        
        results.push(enrichedResult);
        this.scanMetrics.pagesScanned++;
        
        console.log(`   ✅ Completed in ${scanDuration}ms`);
        console.log(`   Strategy: ${pageResult.cspStrategy || 'Standard'}`);
        console.log(`   Issues: ${pageResult.violations?.length || 0} violations found`);
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        
        this.scanMetrics.pagesSkipped++;
        this.scanMetrics.errors.push(`Page ${page.url}: ${error.message}`);
        
        // Add failed result for completeness
        results.push({
          url: page.url,
          success: false,
          error: error.message,
          pageInfo: page,
          timestamp: new Date().toISOString(),
          pageNumber: pageNumber
        });
      }
      
      // Progress update
      const elapsed = Date.now() - startTime;
      const avgTimePerPage = elapsed / pageNumber;
      const estimatedTimeRemaining = avgTimePerPage * (pages.length - pageNumber);
      
      console.log(`   📈 Progress: ${pageNumber}/${pages.length} (${Math.round(pageNumber/pages.length*100)}%)`);
      console.log(`   ⏱️  ETA: ${Math.round(estimatedTimeRemaining/1000)}s remaining`);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`\n✅ Scanning phase completed in ${Math.round(totalTime/1000)}s`);
    console.log(`📊 Success rate: ${this.scanMetrics.pagesScanned}/${pages.length} (${Math.round(this.scanMetrics.pagesScanned/pages.length*100)}%)`);
    
    return results;
  }

  /**
   * Generate comprehensive site-wide accessibility report
   * @param {Array} scanResults - Results from page scanning
   * @param {string} baseUrl - Base URL
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Site report
   */
  async generateSiteReport(scanResults, baseUrl, metadata = {}) {
    const reportId = `site-scan-${Date.now()}`;
    const successfulScans = scanResults.filter(result => result.success !== false);
    
    const siteReport = {
      reportId,
      baseUrl,
      scanDate: new Date().toISOString(),
      
      // Overview statistics
      overview: {
        totalPages: metadata.discoveredPages?.length || 0,
        scannedPages: this.scanMetrics.pagesScanned,
        skippedPages: this.scanMetrics.pagesSkipped,
        successRate: Math.round((this.scanMetrics.pagesScanned / scanResults.length) * 100),
        totalScanTime: this.scanMetrics.endTime - this.scanMetrics.startTime,
        averagePageScanTime: this.calculateAveragePageScanTime(successfulScans)
      },
      
      // CSP analysis
      cspAnalysis: this.analyzeCspPerformance(scanResults),
      
      // Individual page results
      pageResults: successfulScans.map(result => ({
        url: result.url,
        pageType: this.categorizePageType(result),
        priority: result.pageInfo?.priorityScore || 0,
        accessibilityScore: this.calculatePageAccessibilityScore(result),
        violations: result.violations || [],
        cspStrategy: result.cspStrategy || 'standard',
        scanDuration: result.scanDuration || 0,
        timestamp: result.timestamp
      })),
      
      // Site-wide trends and analysis
      siteWideTrends: this.analyzeSiteWideTrends(successfulScans),
      
      // Optimization analysis
      optimization: metadata.optimization || {},
      
      // Patterns discovered
      patterns: metadata.patterns || {},
      
      // Actionable recommendations
      recommendations: this.generateSiteRecommendations(successfulScans, metadata),
      
      // Technical metadata
      metadata: {
        scannerVersion: '1.0.0',
        pagesDiscovered: this.scanMetrics.pagesDiscovered,
        cspStrategiesUsed: this.scanMetrics.cspStrategiesUsed,
        errors: this.scanMetrics.errors
      }
    };
    
    // Save report to file if requested
    if (this.options.generateReport) {
      await this.saveReportToFile(siteReport);
    }
    
    return siteReport;
  }

  /**
   * Calculate average page scan time
   * @param {Array} results - Successful scan results
   * @returns {number} Average time in milliseconds
   */
  calculateAveragePageScanTime(results) {
    if (results.length === 0) return 0;
    
    const totalTime = results.reduce((sum, result) => sum + (result.scanDuration || 0), 0);
    return Math.round(totalTime / results.length);
  }

  /**
   * Analyze CSP strategy performance across the site
   * @param {Array} scanResults - All scan results
   * @returns {Object} CSP analysis
   */
  analyzeCspPerformance(scanResults) {
    const successfulScans = scanResults.filter(result => result.success !== false);
    const strategyStats = {};
    
    successfulScans.forEach(result => {
      const strategy = result.cspStrategy || 'standard';
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = { count: 0, totalTime: 0 };
      }
      strategyStats[strategy].count++;
      strategyStats[strategy].totalTime += result.scanDuration || 0;
    });
    
    // Calculate success rates and average times
    const strategyAnalysis = {};
    Object.entries(strategyStats).forEach(([strategy, stats]) => {
      strategyAnalysis[strategy] = {
        successRate: Math.round((stats.count / scanResults.length) * 100),
        averageTime: Math.round(stats.totalTime / stats.count),
        usageCount: stats.count
      };
    });
    
    // Determine most effective strategy
    const mostEffective = Object.entries(strategyAnalysis)
      .sort((a, b) => b[1].successRate - a[1].successRate)[0];
    
    return {
      mostEffectiveStrategy: mostEffective?.[0] || 'standard',
      strategyPerformance: strategyAnalysis,
      totalStrategiesUsed: Object.keys(strategyAnalysis).length
    };
  }

  /**
   * Categorize page type based on URL and content
   * @param {Object} result - Scan result
   * @returns {string} Page type
   */
  categorizePageType(result) {
    const url = result.url.toLowerCase();
    const pageInfo = result.pageInfo || {};
    
    if (url.includes('contact')) return 'contact';
    if (url.includes('login') || url.includes('signin')) return 'authentication';
    if (url.includes('checkout') || url.includes('cart')) return 'ecommerce';
    if (url.includes('about')) return 'about';
    if (url.includes('product') || url.includes('service')) return 'product';
    if (url.includes('support') || url.includes('help')) return 'support';
    if (url.includes('blog') || url.includes('news')) return 'content';
    if (url === new URL(result.url).origin + '/' || url.includes('home')) return 'homepage';
    
    return 'other';
  }

  /**
   * Calculate accessibility score for a page
   * @param {Object} result - Scan result
   * @returns {number} Accessibility score (0-100)
   */
  calculatePageAccessibilityScore(result) {
    if (!result.violations) return 100; // No violations = perfect score
    
    const totalViolations = result.violations.length;
    if (totalViolations === 0) return 100; // No violations = perfect score
    
    const criticalViolations = result.violations.filter(v => v.impact === 'critical').length;
    const seriousViolations = result.violations.filter(v => v.impact === 'serious').length;
    
    // Simple scoring algorithm (can be enhanced)
    let score = 100;
    score -= criticalViolations * 15;
    score -= seriousViolations * 10;
    score -= (totalViolations - criticalViolations - seriousViolations) * 5;
    
    return Math.max(0, Math.round(score));
  }

  /**
   * Analyze site-wide accessibility trends
   * @param {Array} results - Successful scan results
   * @returns {Object} Trends analysis
   */
  analyzeSiteWideTrends(results) {
    if (results.length === 0) return {};
    
    // Common violations across the site
    const violationCounts = {};
    results.forEach(result => {
      (result.violations || []).forEach(violation => {
        const ruleId = violation.id;
        violationCounts[ruleId] = (violationCounts[ruleId] || 0) + 1;
      });
    });
    
    const commonViolations = Object.entries(violationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ruleId, count]) => ({
        rule: ruleId,
        frequency: Math.round((count / results.length) * 100),
        affectedPages: count
      }));
    
    // Accessibility by page type
    const pageTypeScores = {};
    results.forEach(result => {
      const pageType = this.categorizePageType(result);
      const score = this.calculatePageAccessibilityScore(result);
      
      if (!pageTypeScores[pageType]) {
        pageTypeScores[pageType] = { totalScore: 0, count: 0 };
      }
      pageTypeScores[pageType].totalScore += score;
      pageTypeScores[pageType].count++;
    });
    
    const accessibilityByPageType = {};
    Object.entries(pageTypeScores).forEach(([pageType, stats]) => {
      accessibilityByPageType[pageType] = {
        avgScore: Math.round(stats.totalScore / stats.count),
        count: stats.count
      };
    });
    
    return {
      commonViolations,
      accessibilityByPageType,
      averageAccessibilityScore: Math.round(
        results.reduce((sum, result) => sum + this.calculatePageAccessibilityScore(result), 0) / results.length
      )
    };
  }

  /**
   * Generate actionable recommendations
   * @param {Array} results - Scan results
   * @param {Object} metadata - Additional metadata
   * @returns {Array} Recommendations
   */
  generateSiteRecommendations(results, metadata) {
    const recommendations = [];
    const trends = this.analyzeSiteWideTrends(results);
    
    // High-frequency violations
    if (trends.commonViolations && trends.commonViolations.length > 0) {
      const topViolation = trends.commonViolations[0];
      if (topViolation.frequency > 50) {
        recommendations.push({
          priority: 'high',
          category: 'widespread-issue',
          issue: `${topViolation.rule} violations`,
          affectedPages: topViolation.affectedPages,
          frequency: `${topViolation.frequency}%`,
          solution: this.getViolationSolution(topViolation.rule)
        });
      }
    }
    
    // Low accessibility scores
    const lowScorePages = results.filter(result => 
      this.calculatePageAccessibilityScore(result) < 60
    );
    
    if (lowScorePages.length > results.length * 0.3) {
      recommendations.push({
        priority: 'high',
        category: 'overall-quality',
        issue: 'Multiple pages with low accessibility scores',
        affectedPages: lowScorePages.length,
        solution: 'Implement comprehensive accessibility review and testing process'
      });
    }
    
    // Critical page issues
    const criticalPages = results.filter(result => {
      const pageType = this.categorizePageType(result);
      return ['contact', 'authentication', 'ecommerce'].includes(pageType);
    });
    
    const criticalIssues = criticalPages.filter(result => 
      this.calculatePageAccessibilityScore(result) < 70
    );
    
    if (criticalIssues.length > 0) {
      recommendations.push({
        priority: 'critical',
        category: 'critical-pages',
        issue: 'Critical business pages have accessibility issues',
        affectedPages: criticalIssues.length,
        solution: 'Prioritize fixing accessibility issues on contact, login, and checkout pages'
      });
    }
    
    return recommendations;
  }

  /**
   * Get solution text for common violations
   * @param {string} ruleId - Axe rule ID
   * @returns {string} Solution description
   */
  getViolationSolution(ruleId) {
    const solutions = {
      'color-contrast': 'Update color scheme to meet WCAG AA contrast ratios (4.5:1 for normal text)',
      'missing-alt-text': 'Add meaningful alt text to all images',
      'form-label': 'Ensure all form inputs have associated labels',
      'heading-order': 'Use proper heading hierarchy (h1, h2, h3, etc.) in logical order',
      'link-name': 'Provide descriptive link text that explains the link destination'
    };
    
    return solutions[ruleId] || 'Review and fix accessibility violation according to WCAG guidelines';
  }

  /**
   * Save report to file
   * @param {Object} siteReport - Site report object
   */
  async saveReportToFile(siteReport) {
    try {
      const reportsDir = path.join(__dirname, '../reports');
      await fs.ensureDir(reportsDir);
      
      const fileName = `multi-page-scan-${siteReport.reportId}.json`;
      const filePath = path.join(reportsDir, fileName);
      
      await fs.writeJson(filePath, siteReport, { spaces: 2 });
      
      console.log(`📄 Report saved: ${filePath}`);
      
    } catch (error) {
      console.error('Failed to save report:', error.message);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      await this.navigationDiscovery.close();
      // Add any other cleanup needed
    } catch (error) {
      console.error('Cleanup error:', error.message);
    }
  }
}

module.exports = MultiPageScanner;