const puppeteer = require('puppeteer');
const { URL } = require('url');

/**
 * Navigation Discovery Engine
 * Discovers navigation patterns and extracts internal links from websites
 */
class NavigationDiscovery {
  constructor() {
    this.browser = null;
    this.discoveredPages = new Set();
  }

  /**
   * Main navigation discovery method
   * @param {string} baseUrl - The website's base URL
   * @param {Object} options - Discovery options
   * @returns {Array} Array of discovered pages with metadata
   */
  async discoverNavigation(baseUrl, options = {}) {
    const {
      maxDepth = 2,
      includeExternalLinks = false,
      timeout = 30000
    } = options;

    try {
      console.log(`🕷️ Starting navigation discovery for: ${baseUrl}`);
      
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      const page = await this.browser.newPage();
      page.setDefaultTimeout(timeout);
      
      // Navigate to base URL
      await page.goto(baseUrl, { waitUntil: 'networkidle0' });
      
      // Extract navigation elements and links
      const navElements = await this.extractNavigationElements(page, baseUrl);
      
      await page.close();
      
      console.log(`📋 Found ${navElements.length} navigation links`);
      return navElements;
      
    } catch (error) {
      console.error('Navigation discovery failed:', error.message);
      return [];
    }
  }

  /**
   * Extract navigation elements from page
   * @param {Page} page - Puppeteer page object
   * @param {string} baseUrl - Base URL for filtering internal links
   * @returns {Array} Navigation elements with metadata
   */
  async extractNavigationElements(page, baseUrl) {
    return await page.evaluate((baseUrl) => {
      const results = [];
      const baseHost = new URL(baseUrl).hostname;

      // Helper functions (defined first for availability)
      function identifyContainerType(container) {
        if (container.matches('nav, [role="navigation"]')) {
          return 'semantic-nav';
        }
        if (container.matches('.mega-menu, .dropdown')) {
          return 'mega-menu';
        }
        if (container.matches('header, .header')) {
          return 'header';
        }
        if (container.matches('.sidebar, .side-nav')) {
          return 'sidebar';
        }
        if (container.matches('footer, .footer')) {
          return 'footer';
        }
        return 'css-nav';
      }

      function isFileDownload(url) {
        const fileExtensions = /\.(pdf|doc|docx|xls|xlsx|zip|rar|exe|dmg|iso|mp4|mp3|avi|mov)$/i;
        return fileExtensions.test(url);
      }

      function calculateLinkDepth(element) {
        let depth = 0;
        let current = element;
        while (current.parentElement) {
          depth++;
          current = current.parentElement;
        }
        return depth;
      }

      // Strategy 1: Semantic navigation elements
      const semanticNavs = document.querySelectorAll('nav, [role="navigation"]');
      
      // Strategy 2: Common CSS navigation patterns  
      const cssNavs = document.querySelectorAll(`
        .nav, .navigation, .menu, .header-nav, .main-nav, .primary-nav,
        .navbar, .site-nav, .top-nav, .nav-menu, .mega-menu, .nav-bar,
        .navigation-menu, .nav-links, .main-menu, .primary-menu, .header-menu,
        .footer-nav, .footer-menu, .sidebar-nav, .mobile-nav, .dropdown-menu
      `);
      
      // Strategy 3: Header area links (top 200px)
      const headerArea = document.elementFromPoint(window.innerWidth / 2, 100);
      const headerContainer = headerArea?.closest('header') || 
                             document.querySelector('header') ||
                             document.querySelector('.header') ||
                             document.querySelector('#header');

      // Combine all navigation containers
      const navContainers = new Set([
        ...semanticNavs,
        ...cssNavs,
        ...(headerContainer ? [headerContainer] : [])
      ]);

      // Extract links from each navigation container
      navContainers.forEach((container, index) => {
        const containerType = identifyContainerType(container);
        const links = container.querySelectorAll('a[href]');
        
        links.forEach((link, linkIndex) => {
          try {
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
              return; // Skip anchors and javascript links
            }

            // Resolve relative URLs
            const fullUrl = new URL(href, baseUrl).href;
            const linkHost = new URL(fullUrl).hostname;
            
            // Filter internal links only (unless external links are requested)
            if (linkHost !== baseHost) {
              return; // Skip external links for now
            }

            // Skip file downloads and non-HTML content
            if (isFileDownload(fullUrl)) {
              return;
            }

            const linkText = (link.textContent || '').trim();
            const linkTitle = link.getAttribute('title') || '';
            const ariaLabel = link.getAttribute('aria-label') || '';
            
            // Skip empty links
            if (!linkText && !linkTitle && !ariaLabel) {
              return;
            }

            // Calculate position and context
            const rect = link.getBoundingClientRect();
            const position = {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            };

            results.push({
              url: fullUrl,
              text: linkText,
              title: linkTitle,
              ariaLabel: ariaLabel,
              position: position,
              containerType: containerType,
              containerIndex: index,
              linkIndex: linkIndex,
              isVisible: rect.width > 0 && rect.height > 0,
              context: {
                parent: link.parentElement?.tagName?.toLowerCase(),
                classList: Array.from(link.classList),
                isInList: !!link.closest('ul, ol'),
                isInMegaMenu: !!link.closest('.mega-menu, .dropdown, .submenu'),
                depth: calculateLinkDepth(link)
              }
            });
          } catch (error) {
            console.log('Error processing link:', error.message);
          }
        });
      });

      // Fallback: If no navigation found, get all relevant links
      if (results.length === 0) {
        console.log('No navigation found, using expanded fallback strategy');
        const allLinks = document.querySelectorAll('a[href]');
        const candidateLinks = Array.from(allLinks)
          .filter(link => {
            const rect = link.getBoundingClientRect();
            const text = (link.textContent || '').trim().toLowerCase();
            
            // Include header links, footer links, and important page links
            const isHeaderLink = rect.top < 300;
            const isFooterLink = rect.top > window.innerHeight - 200;
            const isImportantLink = ['home', 'about', 'contact', 'blog', 'services', 'products', 'shop', 'portfolio', 'team', 'careers', 'news', 'support', 'help', 'login', 'register'].some(keyword => text.includes(keyword));
            
            return (isHeaderLink || isFooterLink || isImportantLink) && rect.width > 0 && rect.height > 0;
          })
          .slice(0, 20); // Increased limit

        candidateLinks.forEach((link, index) => {
          try {
            const href = link.getAttribute('href');
            const fullUrl = new URL(href, baseUrl).href;
            const linkHost = new URL(fullUrl).hostname;
            
            if (linkHost === baseHost && !isFileDownload(fullUrl)) {
              const rect = link.getBoundingClientRect();
              results.push({
                url: fullUrl,
                text: (link.textContent || '').trim(),
                title: link.getAttribute('title') || '',
                ariaLabel: link.getAttribute('aria-label') || '',
                position: {
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height
                },
                containerType: 'fallback-header',
                containerIndex: 0,
                linkIndex: index,
                isVisible: true,
                context: {
                  parent: link.parentElement?.tagName?.toLowerCase(),
                  classList: Array.from(link.classList),
                  isInList: !!link.closest('ul, ol'),
                  isInMegaMenu: false,
                  depth: calculateLinkDepth(link)
                }
              });
            }
          } catch (error) {
            console.log('Error in fallback link processing:', error.message);
          }
        });
      }

      return results;

    }, baseUrl);
  }

  /**
   * Rank navigation elements by importance
   * @param {Array} navElements - Array of navigation elements
   * @returns {Array} Ranked navigation elements
   */
  rankNavigationElements(navElements) {
    return navElements
      .map(element => ({
        ...element,
        importance: this.calculateImportance(element)
      }))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Calculate importance score for a navigation element
   * @param {Object} element - Navigation element
   * @returns {number} Importance score (0-100)
   */
  calculateImportance(element) {
    let score = 0;

    // Container type scoring
    const containerScores = {
      'semantic-nav': 30,
      'header': 25,
      'mega-menu': 20,
      'css-nav': 15,
      'sidebar': 10,
      'footer': 5,
      'fallback-header': 12
    };
    score += containerScores[element.containerType] || 0;

    // Position scoring (higher positions are more important)
    if (element.position.y < 100) score += 20;
    else if (element.position.y < 200) score += 15;
    else if (element.position.y < 400) score += 10;

    // Text analysis scoring
    const text = (element.text + ' ' + element.title + ' ' + element.ariaLabel).toLowerCase();
    
    // High priority keywords
    const highPriorityKeywords = ['home', 'about', 'contact', 'services', 'products', 'shop', 'login', 'register'];
    const mediumPriorityKeywords = ['blog', 'news', 'support', 'help', 'faq', 'team', 'portfolio'];
    
    highPriorityKeywords.forEach(keyword => {
      if (text.includes(keyword)) score += 15;
    });
    
    mediumPriorityKeywords.forEach(keyword => {
      if (text.includes(keyword)) score += 8;
    });

    // Visibility and size scoring
    if (element.isVisible) score += 10;
    if (element.position.width > 50 && element.position.height > 20) score += 5;

    // Context scoring
    if (element.context.isInList) score += 5;
    if (element.context.isInMegaMenu) score += 3;

    return Math.min(score, 100); // Cap at 100
  }

  /**
   * Close browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = NavigationDiscovery;