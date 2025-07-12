const URLPatternAnalyzer = require('./url-pattern-analyzer');
const ContentSimilarity = require('./content-similarity');

/**
 * Crawling Optimizer
 * Combines URL pattern analysis and content similarity to optimize crawling strategies
 */
class CrawlingOptimizer {
  constructor() {
    this.urlAnalyzer = new URLPatternAnalyzer();
    this.contentAnalyzer = new ContentSimilarity();
  }

  /**
   * Optimize a list of discovered pages for efficient crawling
   * @param {Array} discoveredPages - Array of discovered page objects
   * @param {Object} options - Optimization options
   * @returns {Object} Optimization results
   */
  async optimizePageList(discoveredPages, options = {}) {
    const {
      maxPages = 50,
      minPriorityScore = 15,
      maxSimilarity = 0.8,
      preserveCriticalPages = true,
      balanceAccessibilityExamples = true
    } = options;

    console.log(`🔍 Optimizing page list: ${discoveredPages.length} pages → target: ${maxPages} pages`);

    // Step 1: Filter by minimum priority score
    let optimizedPages = discoveredPages.filter(page => {
      const score = page.priorityScore || page.importance || 0;
      return score >= minPriorityScore;
    });

    console.log(`📊 After priority filtering: ${optimizedPages.length} pages`);

    // Step 2: URL pattern analysis
    const patternAnalysis = this.urlAnalyzer.identifyPatterns(optimizedPages);
    optimizedPages = patternAnalysis.representatives;

    console.log(`🔗 After pattern deduplication: ${optimizedPages.length} pages`);

    // Step 3: Content similarity analysis (if still too many pages)
    if (optimizedPages.length > maxPages) {
      const similarityAnalysis = await this.contentAnalyzer.analyzeContentSimilarity(optimizedPages);
      optimizedPages = similarityAnalysis.uniquePages.slice(0, maxPages);
      
      console.log(`📄 After content similarity filtering: ${optimizedPages.length} pages`);
    }

    // Step 4: Ensure critical pages are preserved
    if (preserveCriticalPages) {
      optimizedPages = this.preserveCriticalPages(optimizedPages, discoveredPages);
    }

    // Step 5: Balance accessibility examples
    if (balanceAccessibilityExamples) {
      optimizedPages = this.balanceAccessibilityExamples(optimizedPages, maxPages);
    }

    // Step 6: Final ranking and limiting
    optimizedPages = optimizedPages
      .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
      .slice(0, maxPages);

    const optimization = this.generateOptimizationReport(discoveredPages, optimizedPages, patternAnalysis);

    console.log(`✅ Optimization complete: ${optimizedPages.length} pages selected`);
    console.log(`📉 Reduction: ${optimization.reductionPercentage}%`);

    return {
      optimizedPages,
      optimization,
      patterns: patternAnalysis.patterns,
      originalCount: discoveredPages.length
    };
  }

  /**
   * Preserve critical pages that must be included in scanning
   * @param {Array} optimizedPages - Current optimized page list
   * @param {Array} allPages - All discovered pages
   * @returns {Array} Updated page list with critical pages preserved
   */
  preserveCriticalPages(optimizedPages, allPages) {
    const criticalKeywords = [
      'contact', 'login', 'register', 'checkout', 'cart', 'account',
      'accessibility', 'accessibility-statement', 'support', 'help'
    ];

    const optimizedUrls = new Set(optimizedPages.map(page => page.url));
    const criticalPages = allPages.filter(page => {
      if (optimizedUrls.has(page.url)) return false; // Already included

      const text = (page.text + ' ' + page.url).toLowerCase();
      return criticalKeywords.some(keyword => text.includes(keyword));
    });

    if (criticalPages.length > 0) {
      console.log(`🛡️ Adding ${criticalPages.length} critical pages`);
      return [...optimizedPages, ...criticalPages];
    }

    return optimizedPages;
  }

  /**
   * Balance accessibility examples to include both good and bad examples
   * @param {Array} pages - Page list
   * @param {number} maxPages - Maximum pages allowed
   * @returns {Array} Balanced page list
   */
  balanceAccessibilityExamples(pages, maxPages) {
    // Categorize pages by likely accessibility quality
    const goodAccessibility = [];
    const poorAccessibility = [];
    const unknown = [];

    pages.forEach(page => {
      const score = this.estimateAccessibilityQuality(page);
      
      if (score > 0.7) {
        goodAccessibility.push(page);
      } else if (score < 0.3) {
        poorAccessibility.push(page);
      } else {
        unknown.push(page);
      }
    });

    console.log(`🎭 Accessibility balance: ${goodAccessibility.length} good, ${poorAccessibility.length} poor, ${unknown.length} unknown`);

    // Try to maintain balance (60% good, 30% poor, 10% unknown)
    const targetGood = Math.floor(maxPages * 0.6);
    const targetPoor = Math.floor(maxPages * 0.3);
    const targetUnknown = maxPages - targetGood - targetPoor;

    const balanced = [
      ...goodAccessibility.slice(0, targetGood),
      ...poorAccessibility.slice(0, targetPoor),
      ...unknown.slice(0, targetUnknown)
    ];

    // Fill remaining slots with highest priority pages
    const remaining = maxPages - balanced.length;
    if (remaining > 0) {
      const allRemaining = pages.filter(page => !balanced.includes(page));
      const topRemaining = allRemaining
        .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
        .slice(0, remaining);
      
      balanced.push(...topRemaining);
    }

    return balanced;
  }

  /**
   * Estimate accessibility quality of a page based on available metadata
   * @param {Object} page - Page object
   * @returns {number} Estimated quality score (0-1)
   */
  estimateAccessibilityQuality(page) {
    let score = 0.5; // Start with neutral

    // Positive indicators
    if (page.ariaLabel && page.ariaLabel.trim()) score += 0.2;
    if (page.title && page.title.trim()) score += 0.1;
    if (page.text && page.text.trim() && page.text.length > 3) score += 0.1;
    if (page.containerType === 'semantic-nav') score += 0.2;
    if (page.context?.isInList) score += 0.1;

    // Negative indicators
    if (!page.text || page.text.trim().length === 0) score -= 0.2;
    if (!page.ariaLabel && !page.title) score -= 0.2;
    if (page.containerType === 'fallback-header') score -= 0.1;

    // Class-based indicators
    const classList = page.context?.classList || [];
    if (classList.some(cls => cls.includes('btn') || cls.includes('button'))) score += 0.1;
    if (classList.some(cls => cls.includes('accessible') || cls.includes('sr-'))) score += 0.2;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Generate comprehensive optimization report
   * @param {Array} originalPages - Original page list
   * @param {Array} optimizedPages - Optimized page list
   * @param {Object} patternAnalysis - Pattern analysis results
   * @returns {Object} Optimization report
   */
  generateOptimizationReport(originalPages, optimizedPages, patternAnalysis) {
    const reduction = Math.round((1 - optimizedPages.length / originalPages.length) * 100);
    
    // Analyze what was preserved vs removed
    const preservedUrls = new Set(optimizedPages.map(page => page.url));
    const removedPages = originalPages.filter(page => !preservedUrls.has(page.url));

    // Priority distribution
    const priorityDistribution = this.analyzePriorityDistribution(optimizedPages);
    
    // Container type distribution
    const containerDistribution = this.analyzeContainerDistribution(optimizedPages);

    // Pattern statistics
    const patternStats = this.urlAnalyzer.getOptimizationStats(patternAnalysis);

    return {
      reductionPercentage: reduction,
      originalCount: originalPages.length,
      optimizedCount: optimizedPages.length,
      removedCount: removedPages.length,
      priorityDistribution,
      containerDistribution,
      patternStats,
      efficiency: {
        avgPriorityScore: this.calculateAveragePriority(optimizedPages),
        criticalPagesIncluded: this.countCriticalPages(optimizedPages),
        accessibilityBalance: this.calculateAccessibilityBalance(optimizedPages)
      },
      recommendations: this.generateOptimizationRecommendations(originalPages, optimizedPages, reduction)
    };
  }

  /**
   * Analyze priority score distribution
   * @param {Array} pages - Page list
   * @returns {Object} Priority distribution
   */
  analyzePriorityDistribution(pages) {
    const scores = pages.map(page => page.priorityScore || 0);
    const total = scores.length;

    return {
      high: scores.filter(score => score >= 70).length / total,
      medium: scores.filter(score => score >= 40 && score < 70).length / total,
      low: scores.filter(score => score < 40).length / total,
      average: scores.reduce((sum, score) => sum + score, 0) / total
    };
  }

  /**
   * Analyze container type distribution
   * @param {Array} pages - Page list
   * @returns {Object} Container distribution
   */
  analyzeContainerDistribution(pages) {
    const distribution = {};
    
    pages.forEach(page => {
      const type = page.containerType || 'unknown';
      distribution[type] = (distribution[type] || 0) + 1;
    });

    return distribution;
  }

  /**
   * Calculate average priority score
   * @param {Array} pages - Page list
   * @returns {number} Average priority
   */
  calculateAveragePriority(pages) {
    const scores = pages.map(page => page.priorityScore || 0);
    return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  }

  /**
   * Count critical pages in the list
   * @param {Array} pages - Page list
   * @returns {number} Critical page count
   */
  countCriticalPages(pages) {
    const criticalKeywords = ['contact', 'login', 'checkout', 'cart', 'account'];
    
    return pages.filter(page => {
      const text = (page.text + ' ' + page.url).toLowerCase();
      return criticalKeywords.some(keyword => text.includes(keyword));
    }).length;
  }

  /**
   * Calculate accessibility balance score
   * @param {Array} pages - Page list
   * @returns {Object} Balance metrics
   */
  calculateAccessibilityBalance(pages) {
    const qualities = pages.map(page => this.estimateAccessibilityQuality(page));
    const good = qualities.filter(q => q > 0.7).length;
    const poor = qualities.filter(q => q < 0.3).length;
    const unknown = qualities.length - good - poor;

    return {
      good: good / qualities.length,
      poor: poor / qualities.length,
      unknown: unknown / qualities.length,
      balanceScore: Math.min(good, poor) / Math.max(good, poor, 1) // How balanced good vs poor
    };
  }

  /**
   * Generate optimization recommendations
   * @param {Array} originalPages - Original pages
   * @param {Array} optimizedPages - Optimized pages
   * @param {number} reduction - Reduction percentage
   * @returns {Array} Recommendations
   */
  generateOptimizationRecommendations(originalPages, optimizedPages, reduction) {
    const recommendations = [];

    if (reduction > 80) {
      recommendations.push({
        type: 'warning',
        message: 'Very high reduction rate may miss important pages',
        suggestion: 'Consider increasing maxPages or lowering minPriorityScore'
      });
    }

    if (reduction < 30 && originalPages.length > 20) {
      recommendations.push({
        type: 'info',
        message: 'Low reduction rate - scanning may be inefficient',
        suggestion: 'Consider stricter filtering or pattern matching'
      });
    }

    const criticalCount = this.countCriticalPages(optimizedPages);
    if (criticalCount === 0 && originalPages.length > 10) {
      recommendations.push({
        type: 'error',
        message: 'No critical pages (login, contact, etc.) included',
        suggestion: 'Ensure preserveCriticalPages option is enabled'
      });
    }

    const balance = this.calculateAccessibilityBalance(optimizedPages);
    if (balance.poor < 0.1 && optimizedPages.length > 5) {
      recommendations.push({
        type: 'warning',
        message: 'Few pages with potential accessibility issues',
        suggestion: 'Include some lower-quality pages to test scanner effectiveness'
      });
    }

    return recommendations;
  }
}

module.exports = CrawlingOptimizer;