const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * HTML Validation Scanner for WCAG 2.1 compliance testing
 * Implements EN 301 549 criteria 9.4.1.1, 9.4.1.3 (Parsing, Status Messages)
 * Validates HTML syntax, ARIA usage, and status message implementation
 */
class HTMLValidationScanner {
  constructor() {
    this.browser = null;
    this.screenshotDir = path.join(__dirname, '../tmp/html-validation-screenshots');
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    
    // Ensure screenshot directory exists
    await fs.ensureDir(this.screenshotDir);
  }

  /**
   * Scan HTML compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @param {boolean} options.strictValidation - Enable strict HTML validation
   * @param {boolean} options.checkAccessibilityMarkup - Check accessibility-specific markup
   * @param {boolean} options.validateARIA - Enable ARIA validation
   * @param {number} options.timeout - Test timeout in milliseconds
   * @returns {Promise<Object>} HTMLReport
   */
  async scanHTMLCompliance(url, options = {}) {
    const defaultOptions = {
      strictValidation: true,
      checkAccessibilityMarkup: true,
      validateARIA: true,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      const page = await this.browser.newPage();
      
      // Set viewport for consistent testing
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

      // Create timestamped scan directory
      const timestamp = Date.now();
      const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
      await fs.ensureDir(scanDir);

      const htmlResults = await this.performHTMLValidation(page, scanDir, scanOptions);
      
      await page.close();

      // Create report according to interface
      const report = {
        criteria: ["9.4.1.1", "9.4.1.3"],
        passed: htmlResults.violations.length === 0,
        violations: htmlResults.violations,
        summary: {
          syntaxErrors: htmlResults.syntaxErrors,
          duplicateIds: htmlResults.duplicateIds,
          invalidARIA: htmlResults.invalidARIA,
          statusMessagesProper: htmlResults.statusMessagesProper
        },
        screenshotPath: scanDir,
        visualEvidence: htmlResults.visualEvidence
      };

      return report;

    } catch (error) {
      throw new Error(`HTML validation scan failed: ${error.message}`);
    }
  }

  /**
   * Perform comprehensive HTML validation
   */
  async performHTMLValidation(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let syntaxErrors = 0;
    let duplicateIds = 0;
    let invalidARIA = 0;
    let statusMessagesProper = true;

    console.log('Starting HTML validation analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'html-validation.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Check for duplicate IDs (WCAG 4.1.1)
    const duplicateIdResults = await this.checkDuplicateIds(page, violations);
    duplicateIds = duplicateIdResults.count;
    syntaxErrors += duplicateIds;

    // 2. Validate HTML structure and syntax (WCAG 4.1.1)
    const structureResults = await this.validateHTMLStructure(page, violations);
    syntaxErrors += structureResults.errors;

    // 3. Validate ARIA usage (WCAG 4.1.1)
    if (options.validateARIA) {
      const ariaResults = await this.validateARIAUsage(page, violations);
      invalidARIA = ariaResults.errors;
      syntaxErrors += invalidARIA;
    }

    // 4. Check status messages (WCAG 4.1.3)
    const statusResults = await this.validateStatusMessages(page, violations);
    statusMessagesProper = statusResults.proper;

    // 5. Check accessibility markup
    if (options.checkAccessibilityMarkup) {
      await this.validateAccessibilityMarkup(page, violations);
    }

    // Generate visual evidence
    visualEvidence.push({
      type: 'html-validation',
      screenshot: path.basename(initialScreenshot),
      syntaxErrors: syntaxErrors,
      duplicateIds: duplicateIds,
      invalidARIA: invalidARIA
    });

    console.log(`HTML validation complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      syntaxErrors,
      duplicateIds,
      invalidARIA,
      statusMessagesProper
    };
  }

  /**
   * Check for duplicate IDs
   */
  async checkDuplicateIds(page, violations) {
    console.log('Checking for duplicate IDs...');

    const duplicateIdInfo = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*[id]');
      const idCounts = {};
      const duplicates = [];

      // Count occurrences of each ID
      allElements.forEach(element => {
        const id = element.id;
        if (idCounts[id]) {
          idCounts[id]++;
        } else {
          idCounts[id] = 1;
        }
      });

      // Find duplicates
      Object.entries(idCounts).forEach(([id, count]) => {
        if (count > 1) {
          const elements = document.querySelectorAll(`#${CSS.escape(id)}`);
          elements.forEach((element, index) => {
            duplicates.push({
              id: id,
              element: element.tagName.toLowerCase(),
              selector: element.tagName.toLowerCase() + 
                       `#${id}` + 
                       (element.className ? `.${element.className.split(' ')[0]}` : ''),
              occurrence: index + 1,
              totalOccurrences: count,
              textContent: element.textContent.trim().substring(0, 50)
            });
          });
        }
      });

      return duplicates;
    });

    // Create violations for duplicate IDs
    const duplicateGroups = {};
    duplicateIdInfo.forEach(dup => {
      if (!duplicateGroups[dup.id]) {
        duplicateGroups[dup.id] = [];
      }
      duplicateGroups[dup.id].push(dup);
    });

    Object.entries(duplicateGroups).forEach(([id, elements]) => {
      violations.push({
        criterion: "9.4.1.1",
        element: elements.map(e => e.selector).join(', '),
        issue: "duplicate-id",
        description: `ID "${id}" is used ${elements.length} times. IDs must be unique within a document.`,
        duplicateId: id,
        occurrences: elements.length,
        severity: 'error',
        suggestion: `Ensure each ID is unique. Consider using classes instead of IDs for styling, or add suffixes to make IDs unique.`
      });
    });

    return { count: Object.keys(duplicateGroups).length };
  }

  /**
   * Validate HTML structure and syntax
   */
  async validateHTMLStructure(page, violations) {
    console.log('Validating HTML structure...');

    const structureIssues = await page.evaluate(() => {
      const issues = [];

      // Check for common HTML structure issues
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(element => {
        const tagName = element.tagName.toLowerCase();
        const selector = tagName + 
                        (element.id ? `#${element.id}` : '') + 
                        (element.className ? `.${element.className.split(' ')[0]}` : '');

        // Check for invalid nesting
        if (tagName === 'div' && element.closest('span, em, strong, a')) {
          issues.push({
            type: 'invalid-nesting',
            element: selector,
            description: 'Block element nested inside inline element',
            suggestion: 'Use appropriate element types or restructure markup'
          });
        }

        // Check for required attributes
        if (tagName === 'img' && !element.hasAttribute('alt')) {
          issues.push({
            type: 'missing-alt',
            element: selector,
            description: 'Image missing alt attribute',
            suggestion: 'Add alt attribute to describe the image or use alt="" for decorative images'
          });
        }

        // Check for empty headings
        if (/^h[1-6]$/.test(tagName) && !element.textContent.trim()) {
          issues.push({
            type: 'empty-heading',
            element: selector,
            description: 'Heading element is empty',
            suggestion: 'Provide meaningful heading text or remove empty heading'
          });
        }

        // Check for form controls without labels
        if (['input', 'textarea', 'select'].includes(tagName) && 
            element.type !== 'hidden' && element.type !== 'submit' && element.type !== 'button') {
          
          const hasLabel = element.hasAttribute('aria-label') ||
                          element.hasAttribute('aria-labelledby') ||
                          document.querySelector(`label[for="${element.id}"]`) ||
                          element.closest('label');
          
          if (!hasLabel) {
            issues.push({
              type: 'unlabeled-form-control',
              element: selector,
              description: 'Form control missing accessible label',
              suggestion: 'Add label element, aria-label, or aria-labelledby attribute'
            });
          }
        }

        // Check for invalid attributes
        const invalidAttrs = [];
        Array.from(element.attributes).forEach(attr => {
          // Basic check for obviously invalid attributes
          if (attr.name.includes('invalid') || attr.name.includes('not-allowed')) {
            invalidAttrs.push(attr.name);
          }
        });

        if (invalidAttrs.length > 0) {
          issues.push({
            type: 'invalid-attributes',
            element: selector,
            description: `Element has invalid attributes: ${invalidAttrs.join(', ')}`,
            suggestion: 'Remove invalid attributes or use valid HTML attributes'
          });
        }

        // Check for list structure violations
        if (tagName === 'ul' || tagName === 'ol') {
          const directChildren = Array.from(element.children);
          const invalidChildren = directChildren.filter(child => child.tagName.toLowerCase() !== 'li');
          
          if (invalidChildren.length > 0) {
            issues.push({
              type: 'invalid-list-structure',
              element: selector,
              description: `List contains non-list-item children: ${invalidChildren.map(c => c.tagName).join(', ')}`,
              suggestion: 'Only <li> elements should be direct children of <ul> or <ol>'
            });
          }
        }

        // Check for table structure
        if (tagName === 'table') {
          const hasProperStructure = element.querySelector('thead, tbody, th');
          if (!hasProperStructure) {
            issues.push({
              type: 'invalid-table-structure',
              element: selector,
              description: 'Table lacks proper structure (thead, tbody, th elements)',
              suggestion: 'Use proper table structure with thead, tbody, and th elements'
            });
          }
        }
      });

      return issues;
    });

    // Create violations for structure issues
    structureIssues.forEach(issue => {
      violations.push({
        criterion: "9.4.1.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.type === 'missing-alt' ? 'error' : 'warning',
        suggestion: issue.suggestion
      });
    });

    return { errors: structureIssues.length };
  }

  /**
   * Validate ARIA usage
   */
  async validateARIAUsage(page, violations) {
    console.log('Validating ARIA usage...');

    const ariaIssues = await page.evaluate(() => {
      const issues = [];
      const validRoles = [
        'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox',
        'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog',
        'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group',
        'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee',
        'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
        'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 'radiogroup',
        'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox',
        'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist',
        'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid',
        'treeitem'
      ];

      const validAriaStates = [
        'aria-atomic', 'aria-busy', 'aria-checked', 'aria-current', 'aria-describedby',
        'aria-disabled', 'aria-expanded', 'aria-grabbed', 'aria-haspopup', 'aria-hidden',
        'aria-invalid', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live',
        'aria-owns', 'aria-pressed', 'aria-readonly', 'aria-relevant', 'aria-required',
        'aria-selected', 'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow',
        'aria-valuetext', 'aria-controls', 'aria-flowto', 'aria-orientation', 'aria-setsize',
        'aria-posinset'
      ];

      // Find all elements with ARIA attributes
      const elementsWithAria = document.querySelectorAll('[role], [aria-label], [aria-labelledby], [aria-describedby], [aria-expanded], [aria-hidden], [aria-live], [aria-current], [aria-checked], [aria-selected], [aria-pressed], [aria-disabled], [aria-required], [aria-invalid], [class*="aria-"], [id*="aria-"]');

      elementsWithAria.forEach(element => {
        const selector = element.tagName.toLowerCase() + 
                        (element.id ? `#${element.id}` : '') + 
                        (element.className ? `.${element.className.split(' ')[0]}` : '');

        // Check for invalid roles
        const role = element.getAttribute('role');
        if (role && !validRoles.includes(role)) {
          issues.push({
            type: 'invalid-role',
            element: selector,
            attribute: 'role',
            value: role,
            description: `Invalid ARIA role: "${role}"`,
            suggestion: 'Use a valid ARIA role or remove the role attribute'
          });
        }

        // Check for invalid ARIA attributes
        Array.from(element.attributes).forEach(attr => {
          if (attr.name.startsWith('aria-') && !validAriaStates.includes(attr.name)) {
            issues.push({
              type: 'invalid-aria-attribute',
              element: selector,
              attribute: attr.name,
              value: attr.value,
              description: `Invalid ARIA attribute: "${attr.name}"`,
              suggestion: 'Use valid ARIA attributes according to the specification'
            });
          }

          // Check for invalid ARIA values
          if (attr.name === 'aria-current' && !['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(attr.value)) {
            issues.push({
              type: 'invalid-aria-value',
              element: selector,
              attribute: attr.name,
              value: attr.value,
              description: `Invalid value for aria-current: "${attr.value}"`,
              suggestion: 'Use valid aria-current values: page, step, location, date, time, true, or false'
            });
          }

          if ((attr.name === 'aria-expanded' || attr.name === 'aria-hidden') && !['true', 'false'].includes(attr.value)) {
            issues.push({
              type: 'invalid-aria-value',
              element: selector,
              attribute: attr.name,
              value: attr.value,
              description: `Invalid boolean value for ${attr.name}: "${attr.value}"`,
              suggestion: `Use "true" or "false" for ${attr.name}`
            });
          }
        });

        // Check for missing required ARIA attributes
        if (role === 'button' && !element.hasAttribute('aria-pressed') && element.tagName.toLowerCase() !== 'button') {
          // This is actually optional, so we'll skip this check
        }

        // Check for conflicting ARIA states
        const ariaHidden = element.getAttribute('aria-hidden');
        const ariaExpanded = element.getAttribute('aria-expanded');
        const hidden = element.hasAttribute('hidden');
        
        if (ariaHidden === 'true' && ariaExpanded === 'true') {
          issues.push({
            type: 'conflicting-aria-states',
            element: selector,
            description: 'Element has conflicting ARIA states: aria-hidden="true" and aria-expanded="true"',
            suggestion: 'Remove conflicting ARIA attributes or use appropriate values'
          });
        }

        if (ariaHidden === 'false' && hidden) {
          issues.push({
            type: 'conflicting-aria-states',
            element: selector,
            description: 'Element has conflicting visibility states: aria-hidden="false" and hidden attribute',
            suggestion: 'Remove conflicting visibility attributes'
          });
        }

        // Check for aria-labelledby pointing to non-existent elements
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelIds = labelledBy.split(/\s+/);
          labelIds.forEach(id => {
            if (!document.getElementById(id)) {
              issues.push({
                type: 'invalid-aria-reference',
                element: selector,
                attribute: 'aria-labelledby',
                value: id,
                description: `aria-labelledby references non-existent element: "${id}"`,
                suggestion: 'Ensure aria-labelledby references existing element IDs'
              });
            }
          });
        }

        // Check for aria-describedby pointing to non-existent elements
        const describedBy = element.getAttribute('aria-describedby');
        if (describedBy) {
          const descIds = describedBy.split(/\s+/);
          descIds.forEach(id => {
            if (!document.getElementById(id)) {
              issues.push({
                type: 'invalid-aria-reference',
                element: selector,
                attribute: 'aria-describedby',
                value: id,
                description: `aria-describedby references non-existent element: "${id}"`,
                suggestion: 'Ensure aria-describedby references existing element IDs'
              });
            }
          });
        }
      });

      return issues;
    });

    // Create violations for ARIA issues
    ariaIssues.forEach(issue => {
      violations.push({
        criterion: "9.4.1.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        attribute: issue.attribute,
        value: issue.value,
        severity: 'error',
        suggestion: issue.suggestion
      });
    });

    return { errors: ariaIssues.length };
  }

  /**
   * Validate status messages
   */
  async validateStatusMessages(page, violations) {
    console.log('Validating status messages...');

    const statusMessageIssues = await page.evaluate(() => {
      const issues = [];
      
      // Find potential status message elements
      const statusSelectors = [
        '.status', '.alert', '.message', '.notification', '.success', '.error', '.warning', '.info',
        '[role="status"]', '[role="alert"]', '[aria-live]', '[class*="status"]', '[class*="alert"]',
        '[class*="message"]', '[class*="notification"]', '[id*="status"]', '[id*="alert"]', '[id*="message"]'
      ];

      const statusElements = [];
      statusSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(element => {
            if (!statusElements.includes(element)) {
              statusElements.push(element);
            }
          });
        } catch (e) {
          // Invalid selector, skip
        }
      });

      statusElements.forEach(element => {
        const selector = element.tagName.toLowerCase() + 
                        (element.id ? `#${element.id}` : '') + 
                        (element.className ? `.${element.className.split(' ')[0]}` : '');

        const role = element.getAttribute('role');
        const ariaLive = element.getAttribute('aria-live');
        const hasStatusClass = element.className.toLowerCase().includes('status') ||
                               element.className.toLowerCase().includes('alert') ||
                               element.className.toLowerCase().includes('message') ||
                               element.className.toLowerCase().includes('error') ||
                               element.className.toLowerCase().includes('success');

        // Check if status messages have proper ARIA attributes
        if (hasStatusClass || element.id.toLowerCase().includes('status') || element.id.toLowerCase().includes('alert')) {
          if (!role && !ariaLive) {
            issues.push({
              type: 'missing-status-attributes',
              element: selector,
              description: 'Status message element lacks role="status", role="alert", or aria-live attribute',
              suggestion: 'Add role="status" for info messages, role="alert" for errors, or aria-live="polite/assertive"'
            });
          }

          // Check for appropriate role usage
          if (role === 'alert' && !element.textContent.toLowerCase().includes('error') && 
              !element.textContent.toLowerCase().includes('invalid') &&
              !element.className.toLowerCase().includes('error')) {
            // This might be too strict, so we'll make it a warning
            issues.push({
              type: 'inappropriate-alert-role',
              element: selector,
              description: 'Element uses role="alert" but content doesn\'t appear to be an error or critical message',
              severity: 'warning',
              suggestion: 'Use role="alert" only for error messages and critical notifications'
            });
          }
        }

        // Check for elements that change content but don't have live regions
        // Only check for actual dynamic content containers, not form fields or help text
        const hasChangingContent = element.id && (
          element.id.includes('loading') || 
          (element.id.includes('status') && !element.closest('form')) || 
          (element.id.includes('message') && !element.closest('form') && !element.hasAttribute('for') && element.tagName.toLowerCase() !== 'small')
        );

        // Exclude form elements and their associated help text
        const isFormRelated = element.tagName.toLowerCase() === 'input' ||
                             element.tagName.toLowerCase() === 'textarea' ||
                             element.tagName.toLowerCase() === 'select' ||
                             element.tagName.toLowerCase() === 'small' ||
                             element.hasAttribute('for') ||
                             element.closest('form');

        if (hasChangingContent && !ariaLive && !role && !isFormRelated) {
          issues.push({
            type: 'missing-live-region',
            element: selector,
            description: 'Element that likely contains dynamic content lacks aria-live or status role',
            suggestion: 'Add aria-live="polite" for status updates or aria-live="assertive" for urgent messages'
          });
        }
      });

      return issues;
    });

    let statusMessagesProper = true;

    // Create violations for status message issues
    statusMessageIssues.forEach(issue => {
      statusMessagesProper = false;
      violations.push({
        criterion: "9.4.1.3",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity || 'error',
        suggestion: issue.suggestion
      });
    });

    return { proper: statusMessagesProper };
  }

  /**
   * Validate accessibility-specific markup
   */
  async validateAccessibilityMarkup(page, violations) {
    console.log('Validating accessibility markup...');

    await page.evaluate(() => {
      // Additional accessibility checks can go here
      // This is a placeholder for future accessibility-specific validation
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = HTMLValidationScanner;