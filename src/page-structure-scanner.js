const BaseScanner = require('./base-scanner');

/**
 * Page Structure Scanner for WCAG compliance testing
 * Implements EN 301 549 criteria 9.2.4.2, 9.2.4.4, 9.2.4.5, 9.2.4.6
 * (Page Titles, Link Purpose, Multiple Ways, Headings and Labels)
 */
class PageStructureScanner extends BaseScanner {
  constructor() {
    super('page-structure', {
      wcagCriteria: ['1.3.1', '2.4.1', '2.4.2', '2.4.6'],
      wcagPrinciple: 'robust'
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const structureResults = await this.analyzePageStructure(page, options);

    return {
      scannerId: this.id,
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
  }

  /**
   * Analyze page structure elements
   */
  async analyzePageStructure(page, options = {}) {
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
    const navigationResults = await this.testMultipleWays(page, options);
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

    const linkResults = await page.evaluate((visScript) => {
      eval(visScript);
      const links = Array.from(document.querySelectorAll('a[href]')).filter(isElementVisible);
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
    }, BaseScanner.visibilityFilterScript);

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
  async testMultipleWays(page, options = {}) {
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

      // Evidence that this page is actually part of a larger multi-page site: at
      // least 2 same-origin links to distinct paths. Fragment-only ("#..."),
      // "javascript:", "mailto:", and "tel:" links don't count — none of them point
      // at "another page" of a site/process, so they can't establish that SC 2.4.5
      // (a whole-site criterion) even applies here.
      const internalPaths = new Set();
      Array.from(document.querySelectorAll('a[href]')).forEach(link => {
        const raw = (link.getAttribute('href') || '').trim();
        if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) {
          return;
        }
        let url;
        try {
          url = new URL(raw, document.baseURI);
        } catch (e) {
          return;
        }
        if (url.origin !== location.origin) {
          return;
        }
        internalPaths.add(url.pathname);
      });
      const hasEvidenceOfLargerSite = internalPaths.size >= 2;

      return {
        ways,
        availableWays,
        hasMultipleWays: availableWays >= 2,
        hasEvidenceOfLargerSite
      };
    });

    // SC 2.4.5 "Multiple Ways" (9.2.4.5) is defined over a *set of web pages* in a
    // site or process — applying it to a single isolated page is a category error.
    // We therefore only emit `no-multiple-ways` when BOTH of the following hold:
    //  (a) the caller hasn't opted this scan out of multi-page criteria via
    //      `options.singlePageContext === true` or `options.skipMultiPageCriteria
    //      === true` (set this for standalone fixtures/previews known not to be
    //      part of a larger site — multi-page/EAA site scans should leave it unset
    //      so this check still runs); and
    //  (b) — when the caller hasn't given either signal above — the page itself
    //      shows real evidence of belonging to a larger site (see
    //      hasEvidenceOfLargerSite above). A standalone page with no such links is
    //      structurally out of scope for 2.4.5 and must not be flagged, even though
    //      it's the safe (non-opted-out) default.
    const skipMultiPageCriteria = options.singlePageContext === true || options.skipMultiPageCriteria === true;
    const shouldCheckMultipleWays = !skipMultiPageCriteria && navigationResults.hasEvidenceOfLargerSite;

    if (!navigationResults.hasMultipleWays && shouldCheckMultipleWays) {
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

    const headingResults = await page.evaluate((visScript) => {
      eval(visScript);
      const problematicHeadings = [];
      const problematicLabels = [];

      // Check headings (h1-h6) — skip hidden
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(isElementVisible);
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

      // Check form labels — skip hidden
      const formControls = Array.from(document.querySelectorAll('input, textarea, select')).filter(isElementVisible);

      // Build a lookup of ids that have a non-empty `label[for]` association, once,
      // up front. Interpolating an arbitrary control `id` into a CSS selector string
      // (the old `document.querySelector(\`label[for="${id}"]\`)` per-control) throws
      // at runtime for ids containing CSS-special characters (e.g. "a.b", an id
      // starting with a digit, etc.) — iterating label[for] once and comparing the
      // raw attribute value sidesteps selector injection entirely. A `label[for]`
      // whose text is empty provides no accessible name and is NOT a valid label.
      const explicitlyLabeledIds = new Set();
      Array.from(document.querySelectorAll('label[for]')).forEach(label => {
        const forId = label.getAttribute('for');
        if (forId && label.textContent.trim()) {
          explicitlyLabeledIds.add(forId);
        }
      });

      formControls.forEach((control, index) => {
        const type = control.type || control.tagName.toLowerCase();
        const id = control.id;
        const name = control.name;

        // Skip hidden inputs and buttons. Native `submit`/`button` inputs always carry
        // a browser-supplied default accessible name (e.g. "Submit Query") even with
        // no `value`/text, so they're exempt outright; `type="reset"` isn't skipped —
        // it's handled below via its `value` attribute like the other button types.
        if (type === 'hidden' || type === 'submit' || type === 'button') {
          return;
        }

        const selector = id ? `${control.tagName.toLowerCase()}#${id}` :
                        name ? `${control.tagName.toLowerCase()}[name="${name}"]` :
                        `${control.tagName.toLowerCase()}:nth-child(${index + 1})`;

        // Check for an associated accessible name via any valid HTML/ARIA mechanism:
        //  1. explicit `label[for=id]` with non-empty text (looked up above)
        //  2. implicit wrapping `<label>...control...</label>` — the second, equally
        //     valid HTML label-association mechanism. Valid only if the label's own
        //     text — excluding the control's own subtree (e.g. a <select>'s <option>
        //     text, or a <textarea>'s value/content) — is non-empty after trimming.
        //     (Note: a <fieldset>+<legend> wrapper does NOT name individual controls
        //     inside it and is deliberately not treated as a label here.)
        //  3. `aria-labelledby` pointing at an existing element with non-empty text
        //  4. `aria-label` with non-empty text
        //  5. `title` with non-empty text
        //  6. for type="reset" inputs (submit/button are already skipped above), the
        //     `value` attribute IS the accessible name
        const hasLabel = !!(id && explicitlyLabeledIds.has(id));

        let hasImplicitLabel = false;
        const wrappingLabel = control.closest('label');
        if (wrappingLabel) {
          const clone = wrappingLabel.cloneNode(true);
          clone.querySelectorAll('input, textarea, select').forEach(el => el.remove());
          hasImplicitLabel = clone.textContent.trim().length > 0;
        }

        const ariaLabelledBy = control.getAttribute('aria-labelledby');
        let hasAriaLabelledBy = false;
        if (ariaLabelledBy) {
          hasAriaLabelledBy = ariaLabelledBy.split(/\s+/).some(refId => {
            const refEl = document.getElementById(refId);
            return !!(refEl && refEl.textContent.trim());
          });
        }

        const hasAriaLabel = !!(control.getAttribute('aria-label') || '').trim();
        const hasTitle = !!(control.getAttribute('title') || '').trim();

        const isValueLabeledType = type === 'reset';
        const hasValueAsName = isValueLabeledType && !!(control.getAttribute('value') || '').trim();

        const placeholder = control.getAttribute('placeholder');

        const hasAnyLabel = hasLabel || hasImplicitLabel || hasAriaLabelledBy ||
                             hasAriaLabel || hasTitle || hasValueAsName;

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
    }, BaseScanner.visibilityFilterScript);

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

}

module.exports = PageStructureScanner;