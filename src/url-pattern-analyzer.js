/**
 * URL Pattern Analyzer
 * Identifies patterns in URLs to group similar pages and select representatives
 */
class URLPatternAnalyzer {
  constructor() {
    this.patterns = new Map();
    this.representatives = new Map();
  }

  /**
   * Identify patterns in a collection of URLs
   * @param {Array} urls - Array of URL strings or objects with url property
   * @returns {Object} Pattern analysis results
   */
  identifyPatterns(urls) {
    console.log(`🔍 Analyzing URL patterns for ${urls.length} URLs...`);

    // Extract URLs if objects are passed
    const urlStrings = urls.map(item => typeof item === 'string' ? item : item.url);
    
    // Group URLs by pattern
    const patterns = this.groupUrlsByPattern(urlStrings);
    
    // Select representative pages for each pattern
    const representatives = this.selectRepresentativePages(patterns, urls);
    
    console.log(`📊 Found ${Object.keys(patterns).length} URL patterns`);
    
    return {
      patterns,
      representatives,
      originalCount: urls.length,
      optimizedCount: representatives.length,
      reduction: Math.round((1 - representatives.length / urls.length) * 100)
    };
  }

  /**
   * Group URLs by detected patterns
   * @param {Array} urls - Array of URL strings
   * @returns {Object} Grouped patterns
   */
  groupUrlsByPattern(urls) {
    const patterns = {};
    const processedUrls = new Set();

    urls.forEach(url => {
      if (processedUrls.has(url)) return;

      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        
        // Generate pattern candidates
        const patternCandidates = this.generatePatternCandidates(pathname);
        
        // Find the best pattern that matches other URLs
        let bestPattern = pathname; // Default to exact match
        let bestMatches = [url];

        patternCandidates.forEach(pattern => {
          const matches = urls.filter(otherUrl => {
            if (processedUrls.has(otherUrl) || otherUrl === url) return false;
            
            try {
              const otherPathname = new URL(otherUrl).pathname;
              return this.matchesPattern(otherPathname, pattern);
            } catch {
              return false;
            }
          });

          // If this pattern matches more URLs, use it
          if (matches.length > 0) {
            bestPattern = pattern;
            bestMatches = [url, ...matches];
          }
        });

        // Only create pattern if it matches multiple URLs
        if (bestMatches.length > 1) {
          patterns[bestPattern] = bestMatches;
          bestMatches.forEach(matchedUrl => processedUrls.add(matchedUrl));
        } else {
          // Single URL, no pattern
          patterns[pathname] = [url];
          processedUrls.add(url);
        }

      } catch (error) {
        console.log(`Error processing URL ${url}: ${error.message}`);
        patterns[url] = [url];
        processedUrls.add(url);
      }
    });

    return patterns;
  }

  /**
   * Generate pattern candidates for a URL pathname
   * @param {string} pathname - URL pathname
   * @returns {Array} Array of pattern candidates
   */
  generatePatternCandidates(pathname) {
    const patterns = [];
    const segments = pathname.split('/').filter(segment => segment.length > 0);

    // Generate patterns by replacing segments with wildcards
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // Skip if segment looks like a static path component
      if (this.isStaticSegment(segment)) continue;

      // Create pattern with wildcard
      const patternSegments = [...segments];
      patternSegments[i] = '*';
      patterns.push('/' + patternSegments.join('/'));

      // Create pattern with specific wildcard types
      if (this.isNumericSegment(segment)) {
        patternSegments[i] = '{id}';
        patterns.push('/' + patternSegments.join('/'));
      } else if (this.isSlugSegment(segment)) {
        patternSegments[i] = '{slug}';
        patterns.push('/' + patternSegments.join('/'));
      }
    }

    // Generate patterns for file extensions
    if (pathname.includes('.')) {
      const withoutExtension = pathname.replace(/\.[^.]+$/, '.*');
      patterns.push(withoutExtension);
    }

    // Generate patterns for date-like segments
    const datePattern = this.generateDatePatterns(pathname);
    if (datePattern) {
      patterns.push(datePattern);
    }

    return patterns;
  }

  /**
   * Check if a segment is likely static (shouldn't be wildcarded)
   * @param {string} segment - URL segment
   * @returns {boolean} True if static
   */
  isStaticSegment(segment) {
    const staticKeywords = [
      'about', 'contact', 'home', 'index', 'api', 'admin', 'login',
      'register', 'search', 'help', 'support', 'faq', 'terms', 'privacy'
    ];
    return staticKeywords.includes(segment.toLowerCase());
  }

  /**
   * Check if a segment is numeric (likely an ID)
   * @param {string} segment - URL segment
   * @returns {boolean} True if numeric
   */
  isNumericSegment(segment) {
    return /^\d+$/.test(segment);
  }

  /**
   * Check if a segment is a slug (text with hyphens)
   * @param {string} segment - URL segment
   * @returns {boolean} True if slug-like
   */
  isSlugSegment(segment) {
    return /^[a-z0-9-]+$/.test(segment) && segment.includes('-');
  }

  /**
   * Generate date patterns for URLs containing dates
   * @param {string} pathname - URL pathname
   * @returns {string|null} Date pattern or null
   */
  generateDatePatterns(pathname) {
    // Match patterns like /2024/01/15/ or /2024-01-15/
    const dateRegex = /\/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\//;
    if (dateRegex.test(pathname)) {
      return pathname.replace(dateRegex, '/{year}/{month}/{day}/');
    }

    // Match year patterns like /2024/
    const yearRegex = /\/(\d{4})\//;
    if (yearRegex.test(pathname)) {
      return pathname.replace(yearRegex, '/{year}/');
    }

    return null;
  }

  /**
   * Check if a pathname matches a pattern
   * @param {string} pathname - URL pathname to check
   * @param {string} pattern - Pattern to match against
   * @returns {boolean} True if matches
   */
  matchesPattern(pathname, pattern) {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '[^/]+')           // * matches any segment
      .replace(/\{id\}/g, '\\d+')        // {id} matches numbers
      .replace(/\{slug\}/g, '[a-z0-9-]+') // {slug} matches slug format
      .replace(/\{year\}/g, '\\d{4}')     // {year} matches 4 digits
      .replace(/\{month\}/g, '\\d{1,2}')  // {month} matches 1-2 digits
      .replace(/\{day\}/g, '\\d{1,2}')    // {day} matches 1-2 digits
      .replace(/\.\*/g, '\\.[^.]+');      // .* matches any extension

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(pathname);
  }

  /**
   * Select representative pages for each pattern
   * @param {Object} patterns - Grouped patterns
   * @param {Array} originalUrls - Original URL objects with metadata
   * @returns {Array} Representative pages
   */
  selectRepresentativePages(patterns, originalUrls) {
    const representatives = [];
    const urlToObject = new Map();

    // Create URL to object mapping
    originalUrls.forEach(item => {
      const url = typeof item === 'string' ? item : item.url;
      urlToObject.set(url, item);
    });

    Object.entries(patterns).forEach(([pattern, urls]) => {
      if (urls.length === 1) {
        // Single URL, always include
        const urlObj = urlToObject.get(urls[0]);
        if (urlObj) {
          representatives.push({
            ...urlObj,
            pattern: pattern,
            patternGroup: urls,
            isRepresentative: true,
            groupSize: 1
          });
        }
      } else {
        // Multiple URLs, select representatives
        const selected = this.selectFromGroup(urls, urlToObject, pattern);
        representatives.push(...selected);
      }
    });

    return representatives;
  }

  /**
   * Select representative URLs from a group
   * @param {Array} urls - URLs in the group
   * @param {Map} urlToObject - Mapping from URL to object
   * @param {string} pattern - Pattern identifier
   * @returns {Array} Selected representatives
   */
  selectFromGroup(urls, urlToObject, pattern) {
    const urlObjects = urls
      .map(url => urlToObject.get(url))
      .filter(obj => obj);

    if (urlObjects.length === 0) return [];

    // Sort by priority score if available
    const sorted = urlObjects.sort((a, b) => {
      const scoreA = a.priorityScore || a.importance || 0;
      const scoreB = b.priorityScore || b.importance || 0;
      return scoreB - scoreA;
    });

    const representatives = [];
    
    // Always include the highest priority page
    representatives.push({
      ...sorted[0],
      pattern: pattern,
      patternGroup: urls,
      isRepresentative: true,
      groupSize: urls.length,
      role: 'primary'
    });

    // For large groups, include a secondary representative
    if (urls.length > 5 && sorted.length > 1) {
      // Look for a page with different characteristics
      let secondary = null;
      
      for (let i = 1; i < sorted.length; i++) {
        const candidate = sorted[i];
        if (this.isDifferentEnough(sorted[0], candidate)) {
          secondary = candidate;
          break;
        }
      }

      if (secondary) {
        representatives.push({
          ...secondary,
          pattern: pattern,
          patternGroup: urls,
          isRepresentative: true,
          groupSize: urls.length,
          role: 'secondary'
        });
      }
    }

    console.log(`📋 Pattern "${pattern}": Selected ${representatives.length} from ${urls.length} pages`);
    
    return representatives;
  }

  /**
   * Check if two URL objects are different enough to warrant separate scanning
   * @param {Object} url1 - First URL object
   * @param {Object} url2 - Second URL object
   * @returns {boolean} True if different enough
   */
  isDifferentEnough(url1, url2) {
    // Different text content suggests different functionality
    const text1 = (url1.text || '').toLowerCase();
    const text2 = (url2.text || '').toLowerCase();
    
    if (text1 !== text2 && text1.length > 0 && text2.length > 0) {
      return true;
    }

    // Different container types suggest different contexts
    if (url1.containerType !== url2.containerType) {
      return true;
    }

    // Significantly different positions suggest different importance
    const pos1 = url1.position || {};
    const pos2 = url2.position || {};
    const yDiff = Math.abs((pos1.y || 0) - (pos2.y || 0));
    
    if (yDiff > 200) {
      return true;
    }

    return false;
  }

  /**
   * Get optimization statistics
   * @param {Object} analysisResult - Result from identifyPatterns
   * @returns {Object} Statistics
   */
  getOptimizationStats(analysisResult) {
    const { patterns, originalCount, optimizedCount, reduction } = analysisResult;
    
    const patternStats = Object.entries(patterns).map(([pattern, urls]) => ({
      pattern,
      count: urls.length,
      saved: urls.length - (urls.length > 1 ? Math.min(2, urls.length) : 1)
    }));

    const totalSaved = patternStats.reduce((sum, stat) => sum + stat.saved, 0);

    return {
      originalPages: originalCount,
      optimizedPages: optimizedCount,
      reductionPercentage: reduction,
      pagesSaved: totalSaved,
      patterns: patternStats.length,
      largestPattern: Math.max(...patternStats.map(stat => stat.count))
    };
  }
}

module.exports = URLPatternAnalyzer;