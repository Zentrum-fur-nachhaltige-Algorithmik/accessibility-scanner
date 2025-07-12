# 🕷️ Multi-Page Accessibility Scanning - Iterative Development Plan

## 🎯 Project Goal
Extend CSP-immune accessibility scanning from single pages to entire websites through intelligent navigation discovery and smart page prioritization.

---

## 📋 **Iteration 1: Real-World Test HTML Creation**
**Duration**: 2-3 days  
**Validation**: Manual review of test sites mimicking real navigation patterns

### **Files to Create:**
```
test-html/multi-page-sites/
├── corporate-site/
│   ├── index.html              # Homepage with main nav
│   ├── about.html              # Standard about page
│   ├── contact.html            # Contact form
│   ├── products/
│   │   ├── index.html          # Product overview
│   │   ├── product-a.html      # Individual product
│   │   └── product-b.html      # Another product (duplicate pattern)
│   └── support/
│       ├── help.html           # Help section
│       └── faq.html            # FAQ page
├── ecommerce-site/
│   ├── index.html              # Homepage with mega menu
│   ├── login.html              # Login page (high priority)
│   ├── checkout.html           # Checkout (critical accessibility)
│   ├── cart.html               # Shopping cart
│   └── account/
│       ├── profile.html        # User profile
│       └── orders.html         # Order history
├── news-site/
│   ├── index.html              # Homepage with article links
│   ├── category.html           # Category page
│   ├── article-1.html          # News article
│   ├── article-2.html          # Another article (duplicate pattern)
│   └── search.html             # Search results
└── complex-site/
    ├── index.html              # Complex navigation patterns
    ├── mega-menu.html          # Multiple nav types
    ├── breadcrumb.html         # Breadcrumb navigation
    └── sidebar-nav.html        # Sidebar navigation
```

### **Navigation Patterns to Implement:**
1. **Standard Header Navigation** (corporate-site)
   - `<nav>` with `<ul><li><a>` structure
   - Clear hierarchy and semantics
   - Mix of accessible and inaccessible elements

2. **Mega Menu** (ecommerce-site)
   - Complex dropdown structures
   - Multiple columns and categories
   - Various accessibility violations

3. **News Site Navigation** (news-site)
   - Article listings with pagination
   - Category-based navigation
   - Search functionality

4. **Complex Multi-Nav** (complex-site)
   - Multiple navigation areas
   - Breadcrumbs, sidebar, footer nav
   - Role-based navigation patterns

### **Accessibility Patterns per Site:**
- **Good Pages**: Proper semantic markup, ARIA labels, keyboard navigation
- **Bad Pages**: Missing labels, poor focus management, CSP violations
- **Mixed Pages**: Some areas good, others problematic

### **CSP Policies to Test:**
```html
<!-- Strict CSP (blocks most scripts) -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none';">

<!-- Moderate CSP (allows some inline) -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline';">

<!-- Liberal CSP (allows most scripts) -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval';">
```

### **Validation Criteria:**
- [ ] 4 distinct site types created
- [ ] Each site has 5-8 pages with realistic content
- [ ] Navigation patterns cover 80% of real-world scenarios
- [ ] Mix of good/bad accessibility examples
- [ ] Different CSP policies applied across sites
- [ ] Manual navigation test: Can find all important pages through nav discovery

### **Success Metrics:**
- Navigation discovery should find 90%+ of critical pages
- Link prioritization should rank contact/login/checkout as high priority
- Pattern recognition should identify duplicate structures

---

## 📋 **Iteration 2: Basic Navigation Discovery**
**Duration**: 3-4 days  
**Validation**: Automated tests against created HTML sites + real website samples

### **Files to Create:**
```
src/navigation-discovery.js     # Core navigation finder
test-navigation-discovery.js   # Comprehensive tests
config/nav-selectors.json      # Navigation CSS selectors
```

### **Core Implementation:**
```javascript
class NavigationDiscovery {
  async discoverNavigation(page) {
    const navElements = await page.evaluate(() => {
      // Strategy 1: Semantic navigation
      const semanticNavs = document.querySelectorAll('nav, [role="navigation"]');
      
      // Strategy 2: Common CSS patterns
      const cssNavs = document.querySelectorAll('.nav, .navigation, .menu, .header-nav');
      
      // Strategy 3: Positional (top 200px)
      const topLinks = document.querySelectorAll('a[href]');
      
      return this.analyzeNavElements([...semanticNavs, ...cssNavs, ...topLinks]);
    });
    
    return this.rankNavigationElements(navElements);
  }
  
  extractLinksFromNav(navElement) {
    // Extract internal links with context
    // Return: { url, text, position, context, importance }
  }
}
```

### **Test Cases:**
1. **Standard Nav Detection**
   - Test on corporate-site: Should find main `<nav>`
   - Extract 4-6 main navigation links
   - Ignore external links and file downloads

2. **Complex Nav Handling**
   - Test on ecommerce-site: Handle mega menu structure
   - Prioritize top-level categories over subcategories
   - Extract login/cart links as high priority

3. **Fallback Scenarios**
   - Test on sites without `<nav>` tags
   - Use CSS-based detection
   - Positional analysis as last resort

4. **Edge Cases**
   - Multiple navigation areas
   - Hidden/mobile navigation
   - JavaScript-dependent navigation (should still get static links)

### **Validation Criteria:**
- [ ] Finds primary navigation on 100% of test sites
- [ ] Extracts 5-8 main navigation links per site
- [ ] Correctly identifies high-priority pages (contact, login, etc.)
- [ ] Ignores irrelevant links (external, files, fragments)
- [ ] Performance: <2 seconds per page analysis
- [ ] Works on real websites: test on 3-5 live sites

### **Success Metrics:**
- Navigation detection accuracy: >90%
- Link extraction completeness: >95% of manual-identified nav links
- False positive rate: <10%

---

## 📋 **Iteration 3: Smart Link Prioritization**
**Duration**: 3-4 days  
**Validation**: Priority ranking matches human judgment on test sites

### **Files to Create:**
```
src/link-prioritizer.js         # Scoring and ranking engine
src/semantic-analyzer.js       # Text analysis for link importance
test-link-prioritization.js    # Ranking accuracy tests
config/priority-keywords.json   # Configurable keyword weights
```

### **Scoring Implementation:**
```javascript
class LinkPrioritizer {
  calculateLinkScore(link) {
    return {
      positionScore: this.analyzePosition(link),      // 0-30: Y-position, nav context
      semanticScore: this.analyzeText(link),          // 0-25: keyword matching
      contextScore: this.analyzeContext(link),        // 0-20: parent element importance
      visualScore: this.analyzeVisualCues(link),      // 0-15: size, styling prominence  
      interactionScore: this.analyzeInteraction(link) // 0-10: buttons vs links
    };
  }
  
  analyzeText(link) {
    const keywords = {
      high: ['contact', 'login', 'register', 'checkout', 'cart', 'account'],
      medium: ['about', 'products', 'services', 'support', 'help'],
      low: ['blog', 'news', 'career', 'press'],
      ignore: ['privacy', 'terms', 'legal', 'imprint']
    };
    // Implement fuzzy matching and context analysis
  }
}
```

### **Test Scenarios:**
1. **Priority Ranking Accuracy**
   - Corporate site: "Contact" should rank higher than "Privacy"
   - Ecommerce: "Login" and "Cart" should be top priority
   - News site: "Search" should rank higher than individual articles

2. **Context Sensitivity**
   - Links in main nav should rank higher than footer
   - Primary CTAs should outrank secondary navigation
   - Breadcrumb links should have medium priority

3. **Visual Cues Analysis**
   - Larger buttons should rank higher than small text links
   - Prominently styled elements get priority boost
   - Hidden/collapsed navigation gets penalty

### **Validation Method:**
- Human expert manually ranks links for each test site
- Algorithm ranking compared to human judgment
- Acceptable variance: top 5 links should match 80%+ with human ranking

### **Validation Criteria:**
- [ ] Priority ranking accuracy >80% vs human judgment
- [ ] High-priority pages (contact, login, checkout) consistently rank in top 5
- [ ] Low-priority pages (legal, privacy) consistently rank in bottom 50%
- [ ] Context-aware scoring: nav links > footer links > body links
- [ ] Performance: <1 second for 50 link analysis
- [ ] Configurable weighting: easy to adjust for different site types

### **Success Metrics:**
- Ranking correlation with expert judgment: >0.8 Pearson coefficient
- Critical page identification: 95% of contact/login/checkout pages in top 5
- Noise filtering: <5% irrelevant pages in top 10

---

## 📋 **Iteration 4: Pattern Recognition & Deduplication**
**Duration**: 3-4 days  
**Validation**: Correctly identifies and filters duplicate content patterns

### **Files to Create:**
```
src/url-pattern-analyzer.js    # URL pattern detection and grouping
src/content-similarity.js      # Content-based duplicate detection
src/crawling-optimizer.js      # Smart crawling limits and strategies
test-pattern-recognition.js    # Pattern detection accuracy tests
```

### **Pattern Recognition:**
```javascript
class URLPatternAnalyzer {
  identifyPatterns(urls) {
    // Group URLs by pattern
    const patterns = {
      '/products/product-*': ['/products/product-a.html', '/products/product-b.html'],
      '/blog/article-*': ['/blog/article-1.html', '/blog/article-2.html'],
      '/category/*': ['/category/electronics.html', '/category/clothing.html']
    };
    
    return this.selectRepresentativePages(patterns);
  }
  
  selectRepresentativePages(patterns) {
    // For each pattern, select 1-2 representative examples
    // Prefer pages with better accessibility scores
    // Include both good and bad examples when available
  }
}
```

### **Deduplication Strategies:**
1. **URL Pattern Grouping**
   - Detect `/products/item-*` patterns
   - Group similar URL structures
   - Select 1-2 representatives per pattern

2. **Content Similarity Analysis**
   - Compare page titles and main headings
   - Detect template-based pages
   - Prioritize unique content over duplicates

3. **Smart Sampling**
   - Include both accessible and inaccessible examples
   - Prefer pages with forms or interactive elements
   - Balance coverage vs efficiency

### **Test Cases:**
1. **Product/Article Patterns**
   - Ecommerce site: Should detect product page pattern
   - Select 1 product page instead of scanning all products
   - News site: Detect article pattern, sample 2 articles

2. **Category Page Detection**
   - Identify listing vs detail page patterns
   - Prefer detail pages for accessibility testing
   - Include category overview if significantly different

3. **Content Template Recognition**
   - Detect pages using same template structure
   - Sample pages with different content complexity
   - Avoid scanning 10 identical blog posts

### **Validation Criteria:**
- [ ] Pattern detection accuracy: >90% of obvious patterns identified
- [ ] Deduplication effectiveness: Reduces page count by 60-80% without losing coverage
- [ ] Representative selection: Includes both accessible and problematic examples
- [ ] Template recognition: Identifies pages using same structure
- [ ] Performance: Pattern analysis <5 seconds for 100 URLs
- [ ] Coverage preservation: No critical page types eliminated by deduplication

### **Success Metrics:**
- Pattern detection recall: >85% of duplicate patterns identified
- Crawling efficiency: 70%+ reduction in pages while maintaining coverage
- Critical page preservation: 100% of contact/login/checkout pages retained

---

## 📋 **Iteration 5: Multi-Page Integration & CSP Strategy Orchestration**
**Duration**: 4-5 days  
**Validation**: End-to-end multi-page scanning with CSP mitigation across test sites

### **Files to Create:**
```
src/multi-page-scanner.js      # Main orchestrator combining all components
src/site-accessibility-report.js # Site-wide report generation
test-multi-page-end-to-end.js  # Complete workflow tests
templates/site-report.html     # HTML report template for multiple pages
```

### **Integration Architecture:**
```javascript
class MultiPageScanner {
  async scanSite(baseUrl, options = {}) {
    console.log(`🕷️ Starting multi-page scan: ${baseUrl}`);
    
    // Phase 1: Page Discovery
    const discoveredPages = await this.navigationDiscovery.discover(baseUrl);
    console.log(`📋 Found ${discoveredPages.length} pages`);
    
    // Phase 2: Prioritization  
    const prioritizedPages = await this.linkPrioritizer.rankPages(discoveredPages);
    console.log(`🎯 Prioritized ${prioritizedPages.length} pages`);
    
    // Phase 3: Pattern Recognition & Filtering
    const optimizedPages = await this.patternAnalyzer.optimizePageList(prioritizedPages);
    console.log(`🔍 Optimized to ${optimizedPages.length} representative pages`);
    
    // Phase 4: Multi-Page Accessibility Scanning
    const scanResults = await this.scanPagesWithCSPStrategies(optimizedPages);
    
    // Phase 5: Site-Wide Report Generation
    const siteReport = await this.generateSiteReport(scanResults, baseUrl);
    
    return siteReport;
  }
  
  async scanPagesWithCSPStrategies(pages) {
    const results = [];
    
    for (const page of pages) {
      console.log(`📊 Scanning: ${page.url}`);
      
      // Try CSP mitigation strategies in order
      const pageResult = await this.resilientScanner.resilientScan(page.url);
      
      results.push({
        ...pageResult,
        pageInfo: page,
        timestamp: new Date().toISOString()
      });
    }
    
    return results;
  }
}
```

### **Site-Wide Report Features:**
```javascript
siteReport = {
  overview: {
    baseUrl: "https://example.com",
    scanDate: "2024-01-15T10:30:00Z",
    totalPages: 25,
    scannedPages: 8,
    skippedPages: 17,
    avgAccessibilityScore: 78,
    criticalIssues: 12
  },
  
  cspAnalysis: {
    mostEffectiveStrategy: "EvaluateOnNewDocument", 
    strategySuccessRates: {
      "EvaluateOnNewDocument": "87%",
      "ModernCDPBypass": "65%", 
      "ContentInjection": "12%",
      "SecurityDisabled": "100%"
    },
    cspPolicyVariations: [
      { pages: ["/", "/about"], policy: "default-src 'self'" },
      { pages: ["/checkout", "/login"], policy: "default-src 'self'; script-src 'none'" }
    ]
  },
  
  pageResults: [
    {
      url: "/",
      pageType: "homepage",
      priority: "high",
      accessibilityScore: 85,
      violations: [...],
      cspStrategy: "EvaluateOnNewDocument",
      scanDuration: "2.3s"
    }
    // ... more page results
  ],
  
  siteWideTrends: {
    commonViolations: [
      { rule: "color-contrast", frequency: 60%, affectedPages: 5 },
      { rule: "missing-alt-text", frequency: 40%, affectedPages: 3 }
    ],
    accessibilityByPageType: {
      "homepage": { avgScore: 85, count: 1 },
      "product": { avgScore: 72, count: 2 }, 
      "contact": { avgScore: 90, count: 1 }
    }
  },
  
  recommendations: [
    {
      priority: "high",
      issue: "Color contrast violations",
      affectedPages: 5,
      solution: "Update CSS color scheme to meet WCAG AA contrast ratios"
    }
  ]
}
```

### **Test Scenarios:**
1. **Complete Site Scanning**
   - Run on all 4 test sites (corporate, ecommerce, news, complex)
   - Verify page discovery finds expected pages
   - Confirm CSP strategies adapt per page

2. **CSP Strategy Distribution**
   - Different pages may need different strategies
   - Track which strategy works for which page types
   - Adaptive strategy selection based on success patterns

3. **Report Generation**
   - Site-wide accessibility trends
   - CSP policy analysis across pages
   - Actionable recommendations

4. **Performance & Reliability**
   - Graceful handling of failed pages
   - Progress reporting during long scans
   - Resume capability for interrupted scans

### **Validation Criteria:**
- [ ] Successfully scans all 4 test site types end-to-end
- [ ] Page discovery finds 90%+ of manually identified important pages
- [ ] CSP strategy selection adapts based on page-specific policies
- [ ] Site report provides actionable insights beyond individual page results
- [ ] Performance: Complete site scan (8-10 pages) in <60 seconds
- [ ] Error resilience: Continues scanning if individual pages fail
- [ ] Integration: Works with existing CSP mitigation strategies

### **Success Metrics:**
- End-to-end success rate: >90% of test sites scan completely
- Page coverage effectiveness: Finds >85% of critical accessibility issues
- CSP strategy optimization: >20% improvement in success rate vs single strategy
- Report usefulness: Identifies site-wide patterns not visible in single-page scans

---

## 📋 **Iteration 6: Real-World Validation & Performance Optimization**
**Duration**: 3-4 days  
**Validation**: Test against live websites + performance benchmarking

### **Files to Create:**
```
test-real-world-sites.js       # Tests against live websites
src/performance-optimizer.js   # Caching and optimization features
benchmarks/multi-page-performance.md # Performance test results
```

### **Real-World Testing:**
Test against diverse live websites:
- **Corporate**: microsoft.com, ibm.com
- **Ecommerce**: shopify demo stores
- **News**: bbc.com, cnn.com  
- **Government**: gov.uk sections

### **Performance Optimizations:**
1. **Parallel Page Scanning** (3-5 concurrent)
2. **Intelligent Caching** (navigation structure, CSP policies)
3. **Progressive Results** (show results as they complete)
4. **Resource Optimization** (reuse browser instances)

### **Validation Criteria:**
- [ ] Works reliably on 5+ diverse live websites
- [ ] Performance: <10 seconds per page average
- [ ] Memory usage: <1GB for 20-page scan
- [ ] Error rate: <10% page scan failures
- [ ] Results quality: Finds accessibility issues comparable to manual testing

### **Success Metrics:**
- Live website compatibility: >80% of tested sites scan successfully
- Performance target: 10-page site scan in <90 seconds
- Resource efficiency: Linear scaling with page count

---

## ✅ **Final Integration & Documentation**

### **Updated Files:**
```
PROJECT-OVERVIEW.md            # Add multi-page scanning capabilities
README-ENHANCED-E2E.md         # Update with multi-page features  
src/resilient-accessibility-scanner.js # Add multi-page option
```

### **CLI Enhancement:**
```bash
# Existing single-page scanning
node src/resilient-scanner.js --url https://example.com

# New multi-page scanning  
node src/resilient-scanner.js --site https://example.com --max-pages 10
node src/resilient-scanner.js --site https://example.com --full-site
```

### **Documentation:**
- Usage examples and best practices
- Performance tuning guidelines
- CSP strategy recommendations per site type
- Troubleshooting guide for common issues

---

## 🎯 **Overall Success Criteria**

**Technical Goals:**
- [ ] Discovers 90%+ of important pages via navigation analysis
- [ ] Reduces scanning workload by 70% through smart deduplication  
- [ ] Maintains >85% accessibility issue detection rate
- [ ] CSP mitigation strategies adapt per page automatically
- [ ] Complete integration with existing scanner architecture

**Business Goals:**
- [ ] Enables site-wide accessibility auditing (vs single-page)
- [ ] Provides actionable site-wide recommendations
- [ ] Scales to enterprise websites (50+ pages)
- [ ] Works reliably on CSP-protected sites across different page types

**Validation Method:**
- Each iteration has specific validation criteria and success metrics
- Manual testing against real-world scenarios
- Automated test suite covering all components
- Performance benchmarking against targets
- User acceptance testing with accessibility experts