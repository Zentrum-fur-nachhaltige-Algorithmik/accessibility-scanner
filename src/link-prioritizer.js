const fs = require('fs-extra');
const path = require('path');

/**
 * Smart Link Prioritization Engine
 * Analyzes and ranks discovered links by importance for accessibility scanning
 */
class LinkPrioritizer {
  constructor() {
    // Load configurable keyword weights
    this.keywordWeights = this.loadKeywordWeights();
  }

  /**
   * Load keyword weights from configuration
   * @returns {Object} Keyword weight mappings
   */
  loadKeywordWeights() {
    const defaultWeights = {
      critical: {
        keywords: ['contact', 'login', 'sign-in', 'signin', 'register', 'signup', 'sign-up', 'checkout', 'cart', 'account', 'profile'],
        weight: 25
      },
      high: {
        keywords: ['about', 'products', 'services', 'support', 'help', 'shop', 'store', 'buy', 'order', 'booking', 'book'],
        weight: 20
      },
      medium: {
        keywords: ['blog', 'news', 'events', 'team', 'portfolio', 'gallery', 'testimonials', 'reviews', 'faq', 'search'],
        weight: 15
      },
      low: {
        keywords: ['career', 'careers', 'jobs', 'press', 'media', 'investor', 'partners', 'affiliate'],
        weight: 10
      },
      minimal: {
        keywords: ['privacy', 'terms', 'legal', 'imprint', 'disclaimer', 'cookies', 'sitemap'],
        weight: 5
      }
    };

    try {
      const configPath = path.join(__dirname, '../config/priority-keywords.json');
      if (fs.existsSync(configPath)) {
        const customWeights = fs.readJsonSync(configPath);
        return { ...defaultWeights, ...customWeights };
      }
    } catch (error) {
      console.log('Using default keyword weights');
    }

    return defaultWeights;
  }

  /**
   * Rank pages by priority for accessibility scanning
   * @param {Array} discoveredPages - Array of discovered page objects
   * @param {Object} options - Ranking options
   * @returns {Array} Ranked pages with priority scores
   */
  rankPages(discoveredPages, options = {}) {
    const {
      maxPages = 50,
      includeScore = true
    } = options;

    console.log(`🎯 Prioritizing ${discoveredPages.length} discovered pages...`);

    // Calculate scores for all pages
    const scoredPages = discoveredPages.map(page => {
      const score = this.calculateLinkScore(page);
      return {
        ...page,
        priorityScore: score.total,
        scoreBreakdown: includeScore ? score : undefined
      };
    });

    // Sort by priority score (highest first)
    const rankedPages = scoredPages.sort((a, b) => b.priorityScore - a.priorityScore);

    // Limit to maxPages
    const limitedPages = rankedPages.slice(0, maxPages);

    console.log(`📊 Prioritization complete. Top ${limitedPages.length} pages selected.`);
    
    return limitedPages;
  }

  /**
   * Calculate comprehensive link score
   * @param {Object} link - Link object with metadata
   * @returns {Object} Score breakdown and total
   */
  calculateLinkScore(link) {
    const scores = {
      positionScore: this.analyzePosition(link),      // 0-30: Y-position, nav context
      semanticScore: this.analyzeText(link),          // 0-25: keyword matching
      contextScore: this.analyzeContext(link),        // 0-20: parent element importance
      visualScore: this.analyzeVisualCues(link),      // 0-15: size, styling prominence
      interactionScore: this.analyzeInteraction(link) // 0-10: buttons vs links
    };

    const total = Object.values(scores).reduce((sum, score) => sum + score, 0);

    return {
      ...scores,
      total: Math.round(total)
    };
  }

  /**
   * Analyze position-based importance
   * @param {Object} link - Link object
   * @returns {number} Position score (0-30)
   */
  analyzePosition(link) {
    let score = 0;

    // Y-position scoring (higher = more important)
    const y = link.position?.y || 1000;
    if (y < 100) score += 15;        // Top 100px - very important
    else if (y < 200) score += 12;   // Top 200px - important
    else if (y < 400) score += 8;    // Top 400px - moderate
    else if (y < 600) score += 4;    // Visible fold - some importance
    // Below fold gets 0 points

    // Navigation context scoring
    const containerScores = {
      'semantic-nav': 15,
      'header': 12,
      'mega-menu': 10,
      'css-nav': 8,
      'sidebar': 6,
      'footer': 2,
      'fallback-header': 5
    };
    
    score += containerScores[link.containerType] || 0;

    return Math.min(score, 30);
  }

  /**
   * Analyze text content for semantic importance
   * @param {Object} link - Link object
   * @returns {number} Semantic score (0-25)
   */
  analyzeText(link) {
    const text = (
      (link.text || '') + ' ' + 
      (link.title || '') + ' ' + 
      (link.ariaLabel || '') + ' ' +
      (link.url || '')
    ).toLowerCase();

    let score = 0;
    let matchedPriority = null;

    // Check keyword categories (highest priority wins)
    Object.entries(this.keywordWeights).forEach(([priority, config]) => {
      const { keywords, weight } = config;
      const hasMatch = keywords.some(keyword => {
        // Fuzzy matching for common variations
        const variations = this.generateKeywordVariations(keyword);
        return variations.some(variation => text.includes(variation));
      });

      if (hasMatch && (!matchedPriority || weight > score)) {
        score = weight;
        matchedPriority = priority;
      }
    });

    // Homepage detection
    if (text.includes('home') || text.includes('homepage') || link.url?.endsWith('/')) {
      score = Math.max(score, 22);
    }

    // URL path analysis for additional context
    const urlPath = link.url ? new URL(link.url).pathname : '';
    if (urlPath === '/' || urlPath === '/index' || urlPath === '/home') {
      score = Math.max(score, 20);
    }

    return Math.min(score, 25);
  }

  /**
   * Generate keyword variations for fuzzy matching
   * @param {string} keyword - Base keyword
   * @returns {Array} Array of keyword variations
   */
  generateKeywordVariations(keyword) {
    const variations = [keyword];
    
    // Add plurals
    if (!keyword.endsWith('s')) {
      variations.push(keyword + 's');
    }
    
    // Add common prefixes/suffixes
    variations.push('my-' + keyword);
    variations.push(keyword + '-us');
    variations.push(keyword + '-page');
    
    // Add hyphenated versions
    if (keyword.includes('-')) {
      variations.push(keyword.replace('-', ''));
    } else {
      variations.push(keyword.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
    }

    return variations;
  }

  /**
   * Analyze context-based importance
   * @param {Object} link - Link object
   * @returns {number} Context score (0-20)
   */
  analyzeContext(link) {
    let score = 0;

    const context = link.context || {};

    // List context (navigation lists are important)
    if (context.isInList) score += 8;

    // Mega menu context
    if (context.isInMegaMenu) score += 6;

    // Parent element type
    const parentScores = {
      'nav': 10,
      'header': 8,
      'main': 6,
      'aside': 4,
      'footer': 2
    };
    score += parentScores[context.parent] || 0;

    // Link depth (shallower = more important)
    const depth = context.depth || 10;
    if (depth < 5) score += 6;
    else if (depth < 8) score += 4;
    else if (depth < 12) score += 2;

    return Math.min(score, 20);
  }

  /**
   * Analyze visual cues for importance
   * @param {Object} link - Link object
   * @returns {number} Visual score (0-15)
   */
  analyzeVisualCues(link) {
    let score = 0;

    const position = link.position || {};

    // Size-based scoring
    const width = position.width || 0;
    const height = position.height || 0;
    const area = width * height;

    if (area > 5000) score += 10;      // Large elements
    else if (area > 2000) score += 8;  // Medium elements
    else if (area > 500) score += 6;   // Small but visible elements
    else if (area > 100) score += 3;   // Very small elements

    // Visibility check
    if (link.isVisible) score += 5;

    // CSS class analysis for importance indicators
    const classList = link.context?.classList || [];
    const importantClasses = ['btn', 'button', 'cta', 'call-to-action', 'primary', 'main', 'featured'];
    const hasImportantClass = classList.some(cls => 
      importantClasses.some(important => cls.includes(important))
    );
    if (hasImportantClass) score += 3;

    return Math.min(score, 15);
  }

  /**
   * Analyze interaction patterns
   * @param {Object} link - Link object
   * @returns {number} Interaction score (0-10)
   */
  analyzeInteraction(link) {
    let score = 0;

    // Button-like elements are often more important
    const classList = link.context?.classList || [];
    const isButtonLike = classList.some(cls => 
      ['btn', 'button', 'submit', 'action'].some(type => cls.includes(type))
    );
    if (isButtonLike) score += 5;

    // ARIA labels suggest importance
    if (link.ariaLabel && link.ariaLabel.trim()) score += 3;

    // Title attributes provide context
    if (link.title && link.title.trim()) score += 2;

    return Math.min(score, 10);
  }

  /**
   * Filter pages to remove duplicates and low-value pages
   * @param {Array} rankedPages - Ranked pages array
   * @param {Object} options - Filtering options
   * @returns {Array} Filtered pages
   */
  filterPages(rankedPages, options = {}) {
    const {
      minScore = 10,
      removeDuplicates = true,
      maxSimilarity = 0.8
    } = options;

    let filtered = rankedPages;

    // Remove pages below minimum score
    filtered = filtered.filter(page => page.priorityScore >= minScore);

    // Remove duplicates based on URL similarity
    if (removeDuplicates) {
      filtered = this.removeDuplicateUrls(filtered, maxSimilarity);
    }

    console.log(`🔍 Filtered ${rankedPages.length} pages to ${filtered.length} high-value pages`);
    
    return filtered;
  }

  /**
   * Remove duplicate URLs based on similarity
   * @param {Array} pages - Pages array
   * @param {number} maxSimilarity - Maximum similarity threshold
   * @returns {Array} Deduplicated pages
   */
  removeDuplicateUrls(pages, maxSimilarity) {
    const seen = new Set();
    const unique = [];

    for (const page of pages) {
      const url = page.url;
      let isDuplicate = false;

      // Check against already seen URLs
      for (const seenUrl of seen) {
        const similarity = this.calculateUrlSimilarity(url, seenUrl);
        if (similarity > maxSimilarity) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        seen.add(url);
        unique.push(page);
      }
    }

    return unique;
  }

  /**
   * Calculate URL similarity score
   * @param {string} url1 - First URL
   * @param {string} url2 - Second URL
   * @returns {number} Similarity score (0-1)
   */
  calculateUrlSimilarity(url1, url2) {
    try {
      const path1 = new URL(url1).pathname;
      const path2 = new URL(url2).pathname;

      // Simple Levenshtein distance-based similarity
      const maxLength = Math.max(path1.length, path2.length);
      if (maxLength === 0) return 1;

      const distance = this.levenshteinDistance(path1, path2);
      return 1 - (distance / maxLength);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Edit distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }
}

module.exports = LinkPrioritizer;