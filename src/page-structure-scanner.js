const puppeteer = require('puppeteer');

/**
 * Page Structure Scanner for WCAG compliance testing
 * Implements EN 301 549 criteria 9.2.4.2, 9.2.4.4, 9.2.4.5, 9.2.4.6
 * (Page Titles, Link Purpose, Multiple Ways, Headings and Labels)
 */
class PageStructureScanner {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  /**
   * Scan page structure compliance
   * @param {string} url - URL to scan
   * @returns {Promise<Object>} PageStructureReport
   */
  async scanPageStructure(url) {
    try {
      await this.init();
      const page = await this.browser.newPage();
      
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

      const structureResults = await this.analyzePageStructure(page);
      
      await page.close();

      // Create report according to interface
      const report = {
        criteria: ["9.2.4.2", "9.2.4.4", "9.2.4.5", "9.2.4.6"],
        passed: structureResults.violations.length === 0,
        violations: structureResults.violations,
        summary: {
          hasPageTitle: structureResults.hasPageTitle,
          titleDescriptive: structureResults.titleDescriptive,
          linksHavePurpose: structureResults.linksHavePurpose,
          multipleWaysAvailable: structureResults.multipleWaysAvailable,
          headingsDescriptive: structureResults.headingsDescriptive
        }
      };

      return report;

    } catch (error) {
      throw new Error(`Page structure scan failed: ${error.message}`);
    }
  }

  /**
   * Analyze page structure elements
   */
  async analyzePageStructure(page) {
    const violations = [];
    let hasPageTitle = false;
    let titleDescriptive = false;
    let linksHavePurpose = true;
    let multipleWaysAvailable = false;
    let headingsDescriptive = true;

    console.log('Analyzing page structure...');

    // 1. Test Page Title (9.2.4.2)
    const titleResults = await this.testPageTitle(page);
    hasPageTitle = titleResults.hasTitle;
    titleDescriptive = titleResults.isDescriptive;
    if (titleResults.violations.length > 0) {
      violations.push(...titleResults.violations);
    }

    // 2. Test Link Purpose (9.2.4.4)
    const linkResults = await this.testLinkPurpose(page);
    linksHavePurpose = linkResults.allLinksHavePurpose;
    if (linkResults.violations.length > 0) {
      violations.push(...linkResults.violations);
    }

    // 3. Test Multiple Ways (9.2.4.5)
    const navigationResults = await this.testMultipleWays(page);
    multipleWaysAvailable = navigationResults.hasMultipleWays;
    if (navigationResults.violations.length > 0) {
      violations.push(...navigationResults.violations);
    }

    // 4. Test Headings and Labels (9.2.4.6)
    const headingResults = await this.testHeadingsAndLabels(page);
    headingsDescriptive = headingResults.allHeadingsDescriptive;
    if (headingResults.violations.length > 0) {
      violations.push(...headingResults.violations);
    }

    return {
      violations,
      hasPageTitle,
      titleDescriptive,
      linksHavePurpose,
      multipleWaysAvailable,
      headingsDescriptive
    };
  }

  /**
   * Test page title compliance (9.2.4.2)
   */
  async testPageTitle(page) {
    console.log('  Testing page title...');
    const violations = [];

    const titleInfo = await page.evaluate(() => {
      const titleElement = document.querySelector('title');
      const title = titleElement ? titleElement.textContent.trim() : '';
      
      return {
        hasTitle: !!title,
        title: title,
        length: title.length
      };
    });

    const hasTitle = titleInfo.hasTitle && titleInfo.length > 0;
    let isDescriptive = false;

    if (!hasTitle) {
      violations.push({
        criterion: "9.2.4.2",
        element: "title",
        issue: "no-page-title",
        description: "Page does not have a title element or title is empty",
        suggestion: "Add a descriptive <title> element to the document head"
      });
    } else {
      // Check if title is descriptive
      const title = titleInfo.title.toLowerCase();
      const genericTitles = ['untitled', 'document', 'page', 'new page', 'home', 'welcome'];
      const isGeneric = genericTitles.some(generic => title === generic || title.startsWith(generic + ' '));
      const isShort = titleInfo.length < 5;
      const hasOnlySpecialChars = /^[^a-zA-Z0-9]+$/.test(titleInfo.title);

      if (isGeneric || isShort || hasOnlySpecialChars) {
        violations.push({
          criterion: "9.2.4.2",
          element: "title",
          issue: "generic-page-title",
          description: `Page title "${titleInfo.title}" is not descriptive enough`,
          suggestion: "Use a specific, descriptive title that identifies the page purpose or content"
        });
      } else {
        isDescriptive = true;
      }
    }

    return {
      hasTitle,
      isDescriptive,
      violations
    };
  }

  /**
   * Test link purpose compliance (9.2.4.4)
   */
  async testLinkPurpose(page) {
    console.log('  Testing link purpose...');
    const violations = [];

    const linkResults = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const problematicLinks = [];

      links.forEach((link, index) => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim();
        const ariaLabel = link.getAttribute('aria-label');
        const title = link.getAttribute('title');
        const ariaLabelledBy = link.getAttribute('aria-labelledby');
        
        // Skip skip links and anchors
        if (href.startsWith('#') || link.classList.contains('skip-link')) {
          return;
        }

        // Generate selector
        const selector = link.id ? `a#${link.id}` : 
                        link.className ? `a.${link.className.split(' ').join('.')}` :
                        `a:nth-child(${index + 1})`;

        // Check if link has meaningful text
        const genericTexts = ['click here', 'here', 'read more', 'more', 'link', 'this', 'continue'];
        const isGeneric = genericTexts.some(generic => text.toLowerCase() === generic);
        const isEmpty = !text && !ariaLabel && !title && !ariaLabelledBy;
        const isOnlySymbols = text && /^[^\w\s]+$/.test(text);
        const isVague = text.length > 0 && text.length < 3 && !ariaLabel;

        if (isEmpty || isGeneric || isOnlySymbols || isVague) {
          problematicLinks.push({
            selector,
            text: text || '[empty]',
            href: href.substring(0, 50),
            issue: isEmpty ? 'empty-link-text' : 
                   isGeneric ? 'generic-link-text' : 
                   isOnlySymbols ? 'symbol-only-link' : 'vague-link-text',
            hasAriaLabel: !!ariaLabel,
            hasTitle: !!title
          });
        }
      });

      return {
        totalLinks: links.length,
        problematicLinks
      };
    });

    const allLinksHavePurpose = linkResults.problematicLinks.length === 0;

    linkResults.problematicLinks.forEach(link => {
      violations.push({
        criterion: "9.2.4.4",
        element: link.selector,
        issue: "ambiguous-link",
        description: `Link text "${link.text}" does not clearly describe the link's purpose`,
        suggestion: link.issue === 'empty-link-text' ? 
          "Add descriptive text content, aria-label, or title attribute" :
          "Use more specific, descriptive link text that explains where the link goes or what it does"
      });
    });

    console.log(`    Found ${linkResults.totalLinks} links, ${linkResults.problematicLinks.length} problematic`);

    return {
      allLinksHavePurpose,
      violations
    };
  }

  /**
   * Test multiple ways to locate content (9.2.4.5)
   */
  async testMultipleWays(page) {
    console.log('  Testing multiple ways to locate content...');
    const violations = [];

    const navigationResults = await page.evaluate(() => {
      const ways = {
        mainNavigation: false,
        breadcrumbs: false,
        sitemap: false,
        searchFunction: false,
        tableOfContents: false
      };

      // Check for main navigation
      const navElements = document.querySelectorAll('nav, [role="navigation"], .navigation, .nav-menu, .main-nav');
      ways.mainNavigation = navElements.length > 0;

      // Check for breadcrumbs
      const breadcrumbSelectors = ['.breadcrumb', '.breadcrumbs', '[aria-label*="breadcrumb"]', '[role="navigation"] ol', '[role="navigation"] ul'];
      ways.breadcrumbs = breadcrumbSelectors.some(selector => document.querySelector(selector));

      // Check for sitemap links
      const sitemapLinks = Array.from(document.querySelectorAll('a')).some(link => 
        link.textContent.toLowerCase().includes('sitemap') || 
        link.href.toLowerCase().includes('sitemap')
      );
      ways.sitemap = sitemapLinks;

      // Check for search functionality
      const searchElements = document.querySelectorAll('input[type="search"], [role="search"], .search-box, .search-form, #search');
      ways.searchFunction = searchElements.length > 0;

      // Check for table of contents
      const tocSelectors = ['.toc', '.table-of-contents', '#toc', '#table-of-contents'];
      ways.tableOfContents = tocSelectors.some(selector => document.querySelector(selector));

      const availableWays = Object.values(ways).filter(Boolean).length;

      return {
        ways,
        availableWays,
        hasMultipleWays: availableWays >= 2
      };
    });

    if (!navigationResults.hasMultipleWays) {
      violations.push({
        criterion: "9.2.4.5",
        element: "document",
        issue: "no-multiple-ways",
        description: `Only ${navigationResults.availableWays} way(s) to locate content found. WCAG requires at least 2 ways.`,
        suggestion: "Provide multiple ways to locate content: navigation menu, breadcrumbs, search function, sitemap, or table of contents"
      });
    }

    console.log(`    Found ${navigationResults.availableWays} ways to locate content`);

    return {
      hasMultipleWays: navigationResults.hasMultipleWays,
      violations
    };
  }

  /**
   * Test headings and labels (9.2.4.6)
   */
  async testHeadingsAndLabels(page) {
    console.log('  Testing headings and labels...');
    const violations = [];

    const headingResults = await page.evaluate(() => {
      const problematicHeadings = [];
      const problematicLabels = [];

      // Check headings (h1-h6)
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      headings.forEach((heading, index) => {
        const text = heading.textContent.trim();
        const level = heading.tagName.toLowerCase();
        
        const selector = heading.id ? `${level}#${heading.id}` : 
                        heading.className ? `${level}.${heading.className.split(' ').join('.')}` :
                        `${level}:nth-child(${index + 1})`;

        // Check if heading is descriptive
        const isEmpty = !text;
        const isGeneric = ['heading', 'title', 'section', 'content'].includes(text.toLowerCase());
        const isVague = text.length > 0 && text.length < 3;
        const isOnlyNumbers = /^\d+$/.test(text);

        if (isEmpty || isGeneric || isVague || isOnlyNumbers) {
          problematicHeadings.push({
            selector,
            text: text || '[empty]',
            level,
            issue: isEmpty ? 'empty-heading' : 
                   isGeneric ? 'generic-heading' : 
                   isVague ? 'vague-heading' : 'numeric-only-heading'
          });
        }
      });

      // Check form labels
      const formControls = Array.from(document.querySelectorAll('input, textarea, select'));
      formControls.forEach((control, index) => {
        const type = control.type || control.tagName.toLowerCase();
        const id = control.id;
        const name = control.name;
        
        // Skip hidden inputs and buttons
        if (type === 'hidden' || type === 'submit' || type === 'button') {
          return;
        }

        const selector = id ? `${control.tagName.toLowerCase()}#${id}` : 
                        name ? `${control.tagName.toLowerCase()}[name="${name}"]` :
                        `${control.tagName.toLowerCase()}:nth-child(${index + 1})`;

        // Check for associated label
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = control.getAttribute('aria-label');
        const hasAriaLabelledBy = control.getAttribute('aria-labelledby');
        const hasTitle = control.getAttribute('title');
        const placeholder = control.getAttribute('placeholder');

        const hasAnyLabel = hasLabel || hasAriaLabel || hasAriaLabelledBy || hasTitle;

        if (!hasAnyLabel) {
          problematicLabels.push({
            selector,
            type,
            hasPlaceholder: !!placeholder,
            issue: 'missing-label'
          });
        }
      });

      return {
        totalHeadings: headings.length,
        problematicHeadings,
        totalFormControls: formControls.length,
        problematicLabels
      };
    });

    // Add heading violations
    headingResults.problematicHeadings.forEach(heading => {
      violations.push({
        criterion: "9.2.4.6",
        element: heading.selector,
        issue: "poor-heading",
        description: `Heading "${heading.text}" is not descriptive (${heading.issue})`,
        suggestion: "Use clear, descriptive headings that explain the section content"
      });
    });

    // Add label violations
    headingResults.problematicLabels.forEach(label => {
      violations.push({
        criterion: "9.2.4.6",
        element: label.selector,
        issue: "missing-label",
        description: `Form control (${label.type}) lacks a proper label`,
        suggestion: label.hasPlaceholder ? 
          "Add a proper <label> element in addition to placeholder text" :
          "Add a <label> element, aria-label, aria-labelledby, or title attribute"
      });
    });

    const allHeadingsDescriptive = headingResults.problematicHeadings.length === 0 && 
                                  headingResults.problematicLabels.length === 0;

    console.log(`    Analyzed ${headingResults.totalHeadings} headings, ${headingResults.totalFormControls} form controls`);
    console.log(`    Found ${headingResults.problematicHeadings.length} heading issues, ${headingResults.problematicLabels.length} label issues`);

    return {
      allHeadingsDescriptive,
      violations
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = PageStructureScanner;