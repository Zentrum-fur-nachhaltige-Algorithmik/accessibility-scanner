/**
 * Content Similarity Analyzer
 * Detects duplicate content patterns and template-based pages
 */
class ContentSimilarity {
  constructor() {
    this.contentCache = new Map();
  }

  /**
   * Analyze content similarity across pages
   * @param {Array} pages - Array of page objects with content metadata
   * @returns {Object} Similarity analysis results
   */
  async analyzeContentSimilarity(pages) {
    console.log(`🔍 Analyzing content similarity for ${pages.length} pages...`);

    const similarityGroups = [];
    const processed = new Set();

    for (let i = 0; i < pages.length; i++) {
      if (processed.has(i)) continue;

      const currentPage = pages[i];
      const similarPages = [currentPage];
      processed.add(i);

      // Find similar pages
      for (let j = i + 1; j < pages.length; j++) {
        if (processed.has(j)) continue;

        const otherPage = pages[j];
        const similarity = this.calculateContentSimilarity(currentPage, otherPage);

        if (similarity > 0.7) { // 70% similarity threshold
          similarPages.push(otherPage);
          processed.add(j);
        }
      }

      if (similarPages.length > 1) {
        similarityGroups.push({
          pages: similarPages,
          similarity: this.calculateGroupSimilarity(similarPages),
          representative: this.selectRepresentative(similarPages)
        });
      } else {
        // Unique page
        similarityGroups.push({
          pages: similarPages,
          similarity: 1.0,
          representative: currentPage
        });
      }
    }

    console.log(`📊 Found ${similarityGroups.length} content groups`);

    return {
      groups: similarityGroups,
      originalCount: pages.length,
      uniquePages: similarityGroups.map(group => group.representative),
      reductionPercentage: Math.round((1 - similarityGroups.length / pages.length) * 100)
    };
  }

  /**
   * Calculate content similarity between two pages
   * @param {Object} page1 - First page object
   * @param {Object} page2 - Second page object
   * @returns {number} Similarity score (0-1)
   */
  calculateContentSimilarity(page1, page2) {
    let totalScore = 0;
    let weightSum = 0;

    // Text content similarity (40% weight)
    const textSimilarity = this.calculateTextSimilarity(
      this.extractTextContent(page1),
      this.extractTextContent(page2)
    );
    totalScore += textSimilarity * 0.4;
    weightSum += 0.4;

    // URL structure similarity (30% weight)
    const urlSimilarity = this.calculateUrlStructureSimilarity(page1.url, page2.url);
    totalScore += urlSimilarity * 0.3;
    weightSum += 0.3;

    // Title similarity (20% weight)
    const titleSimilarity = this.calculateTextSimilarity(
      page1.title || '',
      page2.title || ''
    );
    totalScore += titleSimilarity * 0.2;
    weightSum += 0.2;

    // Context similarity (10% weight)
    const contextSimilarity = this.calculateContextSimilarity(page1, page2);
    totalScore += contextSimilarity * 0.1;
    weightSum += 0.1;

    return weightSum > 0 ? totalScore / weightSum : 0;
  }

  /**
   * Extract text content from page object
   * @param {Object} page - Page object
   * @returns {string} Combined text content
   */
  extractTextContent(page) {
    const parts = [
      page.text || '',
      page.title || '',
      page.ariaLabel || '',
      page.url ? new URL(page.url).pathname : ''
    ];
    
    return parts.join(' ').toLowerCase().trim();
  }

  /**
   * Calculate text similarity using Jaccard similarity
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} Similarity score (0-1)
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;

    const words1 = new Set(this.tokenize(text1));
    const words2 = new Set(this.tokenize(text2));

    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Tokenize text into words
   * @param {string} text - Input text
   * @returns {Array} Array of tokens
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out short words
  }

  /**
   * Calculate URL structure similarity
   * @param {string} url1 - First URL
   * @param {string} url2 - Second URL
   * @returns {number} Similarity score (0-1)
   */
  calculateUrlStructureSimilarity(url1, url2) {
    try {
      const path1 = new URL(url1).pathname.split('/').filter(segment => segment);
      const path2 = new URL(url2).pathname.split('/').filter(segment => segment);

      if (path1.length === 0 && path2.length === 0) return 1;
      if (path1.length === 0 || path2.length === 0) return 0;

      // Compare path structure
      const maxLength = Math.max(path1.length, path2.length);
      let matches = 0;

      for (let i = 0; i < maxLength; i++) {
        const segment1 = path1[i];
        const segment2 = path2[i];

        if (segment1 === segment2) {
          matches++;
        } else if (segment1 && segment2) {
          // Check if segments are similar (both numeric, both slug-like, etc.)
          if (this.areSegmentsSimilar(segment1, segment2)) {
            matches += 0.5;
          }
        }
      }

      return matches / maxLength;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Check if two URL segments are similar in type
   * @param {string} segment1 - First segment
   * @param {string} segment2 - Second segment
   * @returns {boolean} True if similar
   */
  areSegmentsSimilar(segment1, segment2) {
    const isNumeric1 = /^\d+$/.test(segment1);
    const isNumeric2 = /^\d+$/.test(segment2);
    
    const isSlug1 = /^[a-z0-9-]+$/.test(segment1) && segment1.includes('-');
    const isSlug2 = /^[a-z0-9-]+$/.test(segment2) && segment2.includes('-');

    // Both numeric or both slug-like
    return (isNumeric1 && isNumeric2) || (isSlug1 && isSlug2);
  }

  /**
   * Calculate context similarity between pages
   * @param {Object} page1 - First page
   * @param {Object} page2 - Second page
   * @returns {number} Similarity score (0-1)
   */
  calculateContextSimilarity(page1, page2) {
    const context1 = page1.context || {};
    const context2 = page2.context || {};

    let score = 0;
    let factors = 0;

    // Container type similarity
    if (context1.parent && context2.parent) {
      score += context1.parent === context2.parent ? 1 : 0;
      factors++;
    }

    // List context similarity
    if (context1.isInList !== undefined && context2.isInList !== undefined) {
      score += context1.isInList === context2.isInList ? 1 : 0;
      factors++;
    }

    // Position similarity (within 100px)
    const pos1 = page1.position || {};
    const pos2 = page2.position || {};
    if (pos1.y !== undefined && pos2.y !== undefined) {
      const yDiff = Math.abs(pos1.y - pos2.y);
      score += yDiff < 100 ? 1 : 0;
      factors++;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Calculate overall similarity for a group of pages
   * @param {Array} pages - Array of similar pages
   * @returns {number} Average similarity score
   */
  calculateGroupSimilarity(pages) {
    if (pages.length < 2) return 1;

    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < pages.length; i++) {
      for (let j = i + 1; j < pages.length; j++) {
        totalSimilarity += this.calculateContentSimilarity(pages[i], pages[j]);
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  /**
   * Select representative page from a group of similar pages
   * @param {Array} pages - Array of similar pages
   * @returns {Object} Representative page
   */
  selectRepresentative(pages) {
    if (pages.length === 1) return pages[0];

    // Sort by priority score or importance
    const sorted = pages.sort((a, b) => {
      const scoreA = a.priorityScore || a.importance || 0;
      const scoreB = b.priorityScore || b.importance || 0;
      return scoreB - scoreA;
    });

    // Prefer pages with better accessibility characteristics
    const withGoodAccessibility = sorted.filter(page => 
      this.hasGoodAccessibilityIndicators(page)
    );

    if (withGoodAccessibility.length > 0) {
      return withGoodAccessibility[0];
    }

    // Fallback to highest scored page
    return sorted[0];
  }

  /**
   * Check if page has good accessibility indicators
   * @param {Object} page - Page object
   * @returns {boolean} True if has good indicators
   */
  hasGoodAccessibilityIndicators(page) {
    // Has ARIA label
    if (page.ariaLabel && page.ariaLabel.trim()) return true;

    // Has meaningful title
    if (page.title && page.title.trim() && page.title.length > 5) return true;

    // Has meaningful text content
    if (page.text && page.text.trim() && page.text.length > 3) return true;

    // In semantic navigation
    if (page.containerType === 'semantic-nav') return true;

    return false;
  }

  /**
   * Generate template detection report
   * @param {Array} similarityGroups - Groups from similarity analysis
   * @returns {Object} Template detection report
   */
  generateTemplateReport(similarityGroups) {
    const templates = [];
    const uniquePages = [];

    similarityGroups.forEach(group => {
      if (group.pages.length > 1) {
        templates.push({
          templateId: `template_${templates.length + 1}`,
          pageCount: group.pages.length,
          similarity: group.similarity,
          representative: group.representative,
          pages: group.pages.map(page => page.url),
          potentialIssues: this.identifyTemplatePotentialIssues(group)
        });
      } else {
        uniquePages.push(group.pages[0]);
      }
    });

    return {
      templates: templates,
      uniquePages: uniquePages,
      templateCount: templates.length,
      totalReduction: templates.reduce((sum, template) => sum + (template.pageCount - 1), 0)
    };
  }

  /**
   * Identify potential accessibility issues in template groups
   * @param {Object} group - Similarity group
   * @returns {Array} Array of potential issues
   */
  identifyTemplatePotentialIssues(group) {
    const issues = [];

    // Check for missing accessibility features across the group
    const hasAriaLabels = group.pages.filter(page => page.ariaLabel).length;
    const hasTitles = group.pages.filter(page => page.title).length;
    const hasMeaningfulText = group.pages.filter(page => page.text && page.text.length > 3).length;

    if (hasAriaLabels < group.pages.length * 0.5) {
      issues.push('Inconsistent ARIA labels across template instances');
    }

    if (hasTitles < group.pages.length * 0.5) {
      issues.push('Missing title attributes on some template instances');
    }

    if (hasMeaningfulText < group.pages.length * 0.5) {
      issues.push('Some template instances lack meaningful text content');
    }

    // Check for potential duplicate content issues
    if (group.similarity > 0.9) {
      issues.push('Very high content similarity may indicate duplicate content');
    }

    return issues;
  }
}

module.exports = ContentSimilarity;