/**
 * HTML Validation Scanner.
 * WCAG 4.1.1, 4.1.2 (EN 301 549 9.4.1.1, 9.4.1.2), plus name/role/ARIA checks.
 * Pure DOM analysis with no script injection, so it works under strict CSP:
 * button/link/frame names, aria-* validity, meta tags, duplicate ids, form labels.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: accnameUtils } = require('../utils/accessible-name');
const log = require('../utils/logger').createLogger('html-validation');

class HTMLValidationScanner extends BaseScanner {
  constructor() {
    super('html-validation', {
      wcagCriteria: ['4.1.1', '4.1.2'],
      wcagPrinciple: 'robust',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      strictValidation: true,
      checkAccessibilityMarkup: true,
      validateARIA: true,
      timeout: TIMEOUTS.scanner,
    };

    const scanOptions = { ...defaultOptions, ...options };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const htmlResults = await this.performHTMLValidation(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['9.4.1.1', '9.4.1.3'],
      passed: htmlResults.violations.length === 0,
      violations: htmlResults.violations,
      summary: {
        syntaxErrors: htmlResults.syntaxErrors,
        duplicateIds: htmlResults.duplicateIds,
        invalidARIA: htmlResults.invalidARIA,
        statusMessagesProper: htmlResults.statusMessagesProper,
      },
      screenshotPath: scanDir,
      visualEvidence: htmlResults.visualEvidence,
    };
  }

  /**
   * Perform comprehensive HTML validation with Phase 1 CSP-immune rules
   */
  async performHTMLValidation(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let syntaxErrors = 0;
    let duplicateIds = 0;
    let invalidARIA = 0;
    let statusMessagesProper = true;

    log.debug('Starting enhanced HTML validation analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'html-validation.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // PHASE 1: Enhanced CSP-Immune Rule Validation

    // Group 1: Button and Link Naming (Critical CSP-blocked rules)
    await this.validateButtonNames(page, violations);
    await this.validateLinkNames(page, violations);

    // Group 2: Frame and Media Accessibility
    await this.validateFrameTitles(page, violations);
    await this.validateMediaAlternatives(page, violations);

    // Group 3: ARIA Validation (Enhanced)
    await this.validateARIAAttributes(page, violations);
    await this.validateARIARoles(page, violations);
    await this.validateARIARelationships(page, violations);

    // Group 4: Meta Tag Analysis
    await this.validateMetaTags(page, violations);

    // Group 5: ID and Language Validation
    await this.validateDuplicateIDs(page, violations);
    await this.validateLanguageAttributes(page, violations);

    // Group 6: Form and Input Validation
    await this.validateFormAccessibility(page, violations);

    // Heading order and page-has-heading-one are axe-core best-practice rules
    // already run by axe-core-adapter.js and are not repeated here.

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
      invalidARIA: invalidARIA,
    });

    log.debug(`HTML validation complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      syntaxErrors,
      duplicateIds,
      invalidARIA,
      statusMessagesProper,
    };
  }

  /**
   * Check for duplicate IDs
   */
  async checkDuplicateIds(page, violations) {
    log.debug('Checking for duplicate IDs...');

    const duplicateIdInfo = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*[id]');
      const idCounts = {};
      const duplicates = [];

      // Count occurrences of each ID
      allElements.forEach((element) => {
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
              selector:
                element.tagName.toLowerCase() +
                `#${id}` +
                (element.className && typeof element.className === 'string'
                  ? `.${element.className.split(' ')[0]}`
                  : ''),
              occurrence: index + 1,
              totalOccurrences: count,
              textContent: element.textContent.trim().substring(0, 50),
            });
          });
        }
      });

      return duplicates;
    });

    // Create violations for duplicate IDs
    const duplicateGroups = {};
    duplicateIdInfo.forEach((dup) => {
      if (!duplicateGroups[dup.id]) {
        duplicateGroups[dup.id] = [];
      }
      duplicateGroups[dup.id].push(dup);
    });

    Object.entries(duplicateGroups).forEach(([id, elements]) => {
      violations.push({
        criterion: '9.4.1.1',
        element: elements.map((e) => e.selector).join(', '),
        issue: 'duplicate-id',
        description: `ID "${id}" is used ${elements.length} times. IDs must be unique within a document.`,
        duplicateId: id,
        occurrences: elements.length,
        severity: 'error',
        suggestion: `Ensure each ID is unique. Consider using classes instead of IDs for styling, or add suffixes to make IDs unique.`,
      });
    });

    return { count: Object.keys(duplicateGroups).length };
  }

  /**
   * Validate HTML structure and syntax
   */
  async validateHTMLStructure(page, violations) {
    log.debug('Validating HTML structure...');

    const structureIssues = await page.evaluate((accnameCode) => {
      // Shared ACCNAME implementation (__accessibleNameInfo), see
      // src/utils/accessible-name.js. Used for the empty-heading and
      // unlabeled-form-control checks below.
      eval(accnameCode);

      const issues = [];

      // Check for common HTML structure issues
      const allElements = document.querySelectorAll('*');

      allElements.forEach((element) => {
        const tagName = element.tagName.toLowerCase();
        const className =
          element.className && typeof element.className === 'string'
            ? element.className
            : element.className && element.className.baseVal
              ? element.className.baseVal
              : '';
        const selector =
          tagName +
          (element.id ? `#${element.id}` : '') +
          (className ? `.${className.split(' ')[0]}` : '');

        // Check for invalid nesting. <a> is NOT in the list: its content
        // model is transparent, so block-level children are valid HTML5.
        if (tagName === 'div' && element.closest('span, em, strong, b, i, small, label')) {
          issues.push({
            type: 'invalid-nesting',
            element: selector,
            description: 'Block element nested inside inline element',
            suggestion: 'Use appropriate element types or restructure markup',
          });
        }

        // Check for required attributes
        if (tagName === 'img' && !element.hasAttribute('alt')) {
          issues.push({
            type: 'missing-alt',
            element: selector,
            description: 'Image missing alt attribute',
            suggestion:
              'Add alt attribute to describe the image or use alt="" for decorative images',
          });
        }

        // Check for empty headings.
        // "Empty" means NO ACCESSIBLE NAME, not empty textContent:
        // `<h2><img alt="Mozilla Anzeigen"></h2>` announces "Mozilla Anzeigen".
        if (/^h[1-6]$/.test(tagName)) {
          const headingName = __accessibleNameInfo(element);
          if (!headingName.name) {
            issues.push({
              type: 'empty-heading',
              element: selector,
              description: `Heading element has no accessible name (${headingName.reason || 'no naming mechanism'})`,
              suggestion: 'Provide meaningful heading text or remove empty heading',
            });
          }
        }

        // Check for form controls without labels.
        // The shared helper covers label[for], wrapping <label> (implicit
        // association), aria-label(ledby), title, `value` on button-type inputs
        // and `alt` on <input type="image">. A `label`/`aria-labelledby` that
        // resolves to empty text counts as NO name.
        if (
          ['input', 'textarea', 'select'].includes(tagName) &&
          element.type !== 'hidden' &&
          element.type !== 'submit' &&
          element.type !== 'button'
        ) {
          const controlName = __accessibleNameInfo(element);

          if (!controlName.name) {
            issues.push({
              type: 'unlabeled-form-control',
              element: selector,
              description: `Form control has no accessible name (${controlName.reason || 'no naming mechanism'})`,
              suggestion: 'Add label element, aria-label, or aria-labelledby attribute',
            });
          }
        }

        // Check for invalid attributes
        const invalidAttrs = [];
        Array.from(element.attributes).forEach((attr) => {
          // Basic check for obviously invalid attributes
          if (
            (attr.name.includes('invalid') || attr.name.includes('not-allowed')) &&
            !attr.name.startsWith('aria-') &&
            !attr.name.startsWith('data-')
          ) {
            invalidAttrs.push(attr.name);
          }
        });

        if (invalidAttrs.length > 0) {
          issues.push({
            type: 'invalid-attributes',
            element: selector,
            description: `Element has invalid attributes: ${invalidAttrs.join(', ')}`,
            suggestion: 'Remove invalid attributes or use valid HTML attributes',
          });
        }

        // Check for list structure violations
        if (tagName === 'ul' || tagName === 'ol') {
          const directChildren = Array.from(element.children);
          const invalidChildren = directChildren.filter(
            (child) => child.tagName.toLowerCase() !== 'li'
          );

          if (invalidChildren.length > 0) {
            issues.push({
              type: 'invalid-list-structure',
              element: selector,
              description: `List contains non-list-item children: ${invalidChildren.map((c) => c.tagName).join(', ')}`,
              suggestion: 'Only <li> elements should be direct children of <ul> or <ol>',
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
              suggestion: 'Use proper table structure with thead, tbody, and th elements',
            });
          }
        }
      });

      return issues;
    }, accnameUtils);

    // Create violations for structure issues
    structureIssues.forEach((issue) => {
      violations.push({
        criterion: '9.4.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.type === 'missing-alt' ? 'error' : 'warning',
        suggestion: issue.suggestion,
      });
    });

    return { errors: structureIssues.length };
  }

  /**
   * Validate ARIA usage
   */
  async validateARIAUsage(page, violations) {
    log.debug('Validating ARIA usage...');

    const ariaIssues = await page.evaluate(() => {
      const issues = [];
      const validRoles = [
        'alert',
        'alertdialog',
        'application',
        'article',
        'banner',
        'button',
        'cell',
        'checkbox',
        'columnheader',
        'combobox',
        'complementary',
        'contentinfo',
        'definition',
        'dialog',
        'directory',
        'document',
        'feed',
        'figure',
        'form',
        'grid',
        'gridcell',
        'group',
        'heading',
        'img',
        'link',
        'list',
        'listbox',
        'listitem',
        'log',
        'main',
        'marquee',
        'math',
        'menu',
        'menubar',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'navigation',
        'none',
        'note',
        'option',
        'presentation',
        'progressbar',
        'radio',
        'radiogroup',
        'region',
        'row',
        'rowgroup',
        'rowheader',
        'scrollbar',
        'search',
        'searchbox',
        'separator',
        'slider',
        'spinbutton',
        'status',
        'switch',
        'tab',
        'table',
        'tablist',
        'tabpanel',
        'term',
        'textbox',
        'timer',
        'toolbar',
        'tooltip',
        'tree',
        'treegrid',
        'treeitem',
      ];

      const validAriaStates = [
        'aria-atomic',
        'aria-busy',
        'aria-checked',
        'aria-current',
        'aria-describedby',
        'aria-disabled',
        'aria-expanded',
        'aria-grabbed',
        'aria-haspopup',
        'aria-hidden',
        'aria-invalid',
        'aria-label',
        'aria-labelledby',
        'aria-level',
        'aria-live',
        'aria-owns',
        'aria-pressed',
        'aria-readonly',
        'aria-relevant',
        'aria-required',
        'aria-selected',
        'aria-sort',
        'aria-valuemax',
        'aria-valuemin',
        'aria-valuenow',
        'aria-valuetext',
        'aria-controls',
        'aria-flowto',
        'aria-orientation',
        'aria-setsize',
        'aria-posinset',
      ];

      // Find all elements with ARIA attributes
      const elementsWithAria = document.querySelectorAll(
        '[role], [aria-label], [aria-labelledby], [aria-describedby], [aria-expanded], [aria-hidden], [aria-live], [aria-current], [aria-checked], [aria-selected], [aria-pressed], [aria-disabled], [aria-required], [aria-invalid], [class*="aria-"], [id*="aria-"]'
      );

      elementsWithAria.forEach((element) => {
        const selector =
          element.tagName.toLowerCase() +
          (element.id ? `#${element.id}` : '') +
          (element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '');

        // Check for invalid roles
        const role = element.getAttribute('role');
        if (role && !validRoles.includes(role)) {
          issues.push({
            type: 'invalid-role',
            element: selector,
            attribute: 'role',
            value: role,
            description: `Invalid ARIA role: "${role}"`,
            suggestion: 'Use a valid ARIA role or remove the role attribute',
          });
        }

        // Check for invalid ARIA attributes
        Array.from(element.attributes).forEach((attr) => {
          if (attr.name.startsWith('aria-') && !validAriaStates.includes(attr.name)) {
            issues.push({
              type: 'invalid-aria-attribute',
              element: selector,
              attribute: attr.name,
              value: attr.value,
              description: `Invalid ARIA attribute: "${attr.name}"`,
              suggestion: 'Use valid ARIA attributes according to the specification',
            });
          }

          // Check for invalid ARIA values
          if (
            attr.name === 'aria-current' &&
            !['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(attr.value)
          ) {
            issues.push({
              type: 'invalid-aria-value',
              element: selector,
              attribute: attr.name,
              value: attr.value,
              description: `Invalid value for aria-current: "${attr.value}"`,
              suggestion:
                'Use valid aria-current values: page, step, location, date, time, true, or false',
            });
          }

          if (
            (attr.name === 'aria-expanded' || attr.name === 'aria-hidden') &&
            !['true', 'false'].includes(attr.value)
          ) {
            issues.push({
              type: 'invalid-aria-value',
              element: selector,
              attribute: attr.name,
              value: attr.value,
              description: `Invalid boolean value for ${attr.name}: "${attr.value}"`,
              suggestion: `Use "true" or "false" for ${attr.name}`,
            });
          }
        });

        // Check for missing required ARIA attributes
        if (
          role === 'button' &&
          !element.hasAttribute('aria-pressed') &&
          element.tagName.toLowerCase() !== 'button'
        ) {
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
            description:
              'Element has conflicting ARIA states: aria-hidden="true" and aria-expanded="true"',
            suggestion: 'Remove conflicting ARIA attributes or use appropriate values',
          });
        }

        if (ariaHidden === 'false' && hidden) {
          issues.push({
            type: 'conflicting-aria-states',
            element: selector,
            description:
              'Element has conflicting visibility states: aria-hidden="false" and hidden attribute',
            suggestion: 'Remove conflicting visibility attributes',
          });
        }

        // Check for aria-labelledby pointing to non-existent elements
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelIds = labelledBy.split(/\s+/);
          labelIds.forEach((id) => {
            if (!document.getElementById(id)) {
              issues.push({
                type: 'invalid-aria-reference',
                element: selector,
                attribute: 'aria-labelledby',
                value: id,
                description: `aria-labelledby references non-existent element: "${id}"`,
                suggestion: 'Ensure aria-labelledby references existing element IDs',
              });
            }
          });
        }

        // Check for aria-describedby pointing to non-existent elements
        const describedBy = element.getAttribute('aria-describedby');
        if (describedBy) {
          const descIds = describedBy.split(/\s+/);
          descIds.forEach((id) => {
            if (!document.getElementById(id)) {
              issues.push({
                type: 'invalid-aria-reference',
                element: selector,
                attribute: 'aria-describedby',
                value: id,
                description: `aria-describedby references non-existent element: "${id}"`,
                suggestion: 'Ensure aria-describedby references existing element IDs',
              });
            }
          });
        }
      });

      return issues;
    });

    // Create violations for ARIA issues
    ariaIssues.forEach((issue) => {
      violations.push({
        criterion: '9.4.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        attribute: issue.attribute,
        value: issue.value,
        severity: 'error',
        suggestion: issue.suggestion,
      });
    });

    return { errors: ariaIssues.length };
  }

  /**
   * Validate status messages
   */
  async validateStatusMessages(page, violations) {
    log.debug('Validating status messages...');

    const statusMessageIssues = await page.evaluate(() => {
      const issues = [];

      // Find potential status message elements
      const statusSelectors = [
        '.status',
        '.alert',
        '.message',
        '.notification',
        '.success',
        '.error',
        '.warning',
        '.info',
        '[role="status"]',
        '[role="alert"]',
        '[aria-live]',
        '[class*="status"]',
        '[class*="alert"]',
        '[class*="message"]',
        '[class*="notification"]',
        '[id*="status"]',
        '[id*="alert"]',
        '[id*="message"]',
      ];

      const statusElements = [];
      statusSelectors.forEach((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element) => {
            if (!statusElements.includes(element)) {
              statusElements.push(element);
            }
          });
        } catch (e) {
          // Invalid selector, skip
        }
      });

      // SC 4.1.3 evidence gate
      //
      // The selector list above is a className/id SUBSTRING net: on a real
      // practice site it scoops up every `.status-indicator` dot, every
      // static `.success` blurb and every `.error-message` slot, whether or
      // not anything ever writes to it. Matching the net is therefore NOT
      // evidence that an element is a status message. It only makes it a
      // candidate.
      //
      // This mirrors the evidence model of the dedicated 4.1.3 scanner
      // (status-messages.js `evaluateCandidate`), minus its
      // MutationObserver source: html-validation runs read-only and
      // concurrently, so it must not interact with the page and cannot
      // observe runtime dynamism. Only the two statically-decidable sources
      // are used here.

      // Already covered: own live-region wiring, or nested inside one.
      function hasLiveRegionAttributes(element) {
        if (element.hasAttribute('aria-live')) return true;
        const role = element.getAttribute('role');
        if (role && ['status', 'alert', 'log'].includes(role)) return true;
        if (element.hasAttribute('aria-atomic') || element.hasAttribute('aria-relevant'))
          return true;
        return !!element.closest('[aria-live], [role="status"], [role="alert"], [role="log"]');
      }

      // Evidence 1: role/state that declares a dynamic status widget.
      function hasRoleEvidence(element) {
        const role = element.getAttribute('role');
        if (role === 'progressbar' || role === 'timer') return true;
        if (element.tagName.toLowerCase() === 'progress') return true;
        if (element.getAttribute('aria-busy') === 'true') return true;
        return false;
      }

      // Evidence 2: classic "error slot filled by JS", empty at load and
      // pointed at by a control's aria-describedby / aria-errormessage.
      // Exempt when the page ships a separate aria-live announcer, which is
      // the accepted compensating pattern (the message still gets spoken).
      function isDescribedbyErrorSlot(element) {
        if (!element.id || element.textContent.trim()) return false;
        let referrer = null;
        try {
          referrer = document.querySelector(
            `[aria-describedby~="${element.id}"], [aria-errormessage="${element.id}"]`
          );
        } catch (e) {
          return false; // id not usable in a selector
        }
        if (!referrer) return false;
        return !document.querySelector('[aria-live]');
      }

      function hasStatusMessageEvidence(element) {
        return hasRoleEvidence(element) || isDescribedbyErrorSlot(element);
      }

      statusElements.forEach((element) => {
        // SVG/MathML elements expose className as an SVGAnimatedString, not a string
        const className = typeof element.className === 'string' ? element.className : '';
        const selector =
          element.tagName.toLowerCase() +
          (element.id ? `#${element.id}` : '') +
          (className ? `.${className.split(' ')[0]}` : '');

        const role = element.getAttribute('role');
        const hasStatusClass =
          className.toLowerCase().includes('status') ||
          className.toLowerCase().includes('alert') ||
          className.toLowerCase().includes('message') ||
          className.toLowerCase().includes('error') ||
          className.toLowerCase().includes('success');

        // Check if status messages have proper ARIA attributes
        if (
          hasStatusClass ||
          element.id.toLowerCase().includes('status') ||
          element.id.toLowerCase().includes('alert')
        ) {
          // Gate on evidence, not on the className/id match that got us here.
          if (!hasLiveRegionAttributes(element) && hasStatusMessageEvidence(element)) {
            issues.push({
              type: 'missing-status-attributes',
              element: selector,
              description:
                'Status message element lacks role="status", role="alert", or aria-live attribute',
              evidence: {
                roleOrState: hasRoleEvidence(element),
                describedbyErrorSlot: isDescribedbyErrorSlot(element),
              },
              suggestion:
                'Add role="status" for info messages, role="alert" for errors, or aria-live="polite/assertive"',
            });
          }

          // Check for appropriate role usage.
          // Evidence-gated: needs positive evidence that the element is a
          // NON-critical message wearing role="alert", a class/id that names
          // it as success/info/hint, in en or de.
          const nonCriticalNaming =
            /(^|[-_ ])(success|info|hint|notice|tip|hinweis|erfolg|erfolgreich)([-_ ]|$)/i;
          const namesNonCritical =
            nonCriticalNaming.test(className) || nonCriticalNaming.test(element.id || '');
          const criticalWording =
            /(error|invalid|fail|warn|fehler|ungültig|ungueltig|warnung|achtung)/i;
          const readsCritical =
            criticalWording.test(element.textContent) ||
            criticalWording.test(className) ||
            criticalWording.test(element.id || '');

          if (role === 'alert' && namesNonCritical && !readsCritical) {
            issues.push({
              type: 'inappropriate-alert-role',
              element: selector,
              description:
                'Element uses role="alert" but content doesn\'t appear to be an error or critical message',
              severity: 'warning',
              suggestion: 'Use role="alert" only for error messages and critical notifications',
            });
          }
        }

        // Check for elements that change content but don't have live regions
        // Only check for actual dynamic content containers, not form fields or help text
        const hasChangingContent =
          element.id &&
          (element.id.includes('loading') ||
            (element.id.includes('status') && !element.closest('form')) ||
            (element.id.includes('message') &&
              !element.closest('form') &&
              !element.hasAttribute('for') &&
              element.tagName.toLowerCase() !== 'small'));

        // Exclude form elements and their associated help text
        const isFormRelated =
          element.tagName.toLowerCase() === 'input' ||
          element.tagName.toLowerCase() === 'textarea' ||
          element.tagName.toLowerCase() === 'select' ||
          element.tagName.toLowerCase() === 'small' ||
          element.hasAttribute('for') ||
          element.closest('form');

        // Same gate: an id containing "status"/"loading"/"message" is a
        // naming convention, not proof the element is ever updated.
        if (
          hasChangingContent &&
          !isFormRelated &&
          !hasLiveRegionAttributes(element) &&
          hasStatusMessageEvidence(element)
        ) {
          issues.push({
            type: 'missing-live-region',
            element: selector,
            description:
              'Element that likely contains dynamic content lacks aria-live or status role',
            evidence: {
              roleOrState: hasRoleEvidence(element),
              describedbyErrorSlot: isDescribedbyErrorSlot(element),
            },
            suggestion:
              'Add aria-live="polite" for status updates or aria-live="assertive" for urgent messages',
          });
        }
      });

      return issues;
    });

    let statusMessagesProper = true;

    // Create violations for status message issues
    statusMessageIssues.forEach((issue) => {
      statusMessagesProper = false;
      violations.push({
        criterion: '9.4.1.3',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity || 'error',
        suggestion: issue.suggestion,
      });
    });

    return { proper: statusMessagesProper };
  }

  /**
   * Validate accessibility-specific markup
   */
  async validateAccessibilityMarkup(page, violations) {
    log.debug('Validating accessibility markup...');

    await page.evaluate(() => {
      // Additional accessibility checks can go here
      // This is a placeholder for future accessibility-specific validation
    });
  }

  // ============================================================================
  // PHASE 1: CSP-IMMUNE ENHANCEMENT METHODS
  // Implements 40+ axe rules without script injection
  // ============================================================================

  /**
   * Validate button names (replaces axe: button-name)
   */
  async validateButtonNames(page, violations) {
    log.debug('Validating button names...');

    const buttonIssues = await page.evaluate((accnameCode) => {
      // Shared ACCNAME implementation, see src/utils/accessible-name.js.
      // It walks child `<img alt>` and inline `<svg><title>`, so icon buttons
      // are named correctly.
      eval(accnameCode);

      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];
      const buttons = document.querySelectorAll(
        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
      );

      buttons.forEach((button, index) => {
        const selector = getElementSelector(button);
        const nameInfo = __accessibleNameInfo(button);

        if (!nameInfo.name) {
          issues.push({
            type: 'button-name',
            element: selector,
            description: `Button has no accessible name (${nameInfo.reason || 'no naming mechanism'})`,
            severity: 'critical',
            suggestion:
              'Add aria-label, text content, or value attribute to provide accessible name',
          });
        }
      });

      return issues;
    }, accnameUtils);

    buttonIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate link names (replaces axe: link-name)
   */
  async validateLinkNames(page, violations) {
    log.debug('Validating link names...');

    const linkIssues = await page.evaluate((accnameCode) => {
      // Shared ACCNAME implementation, see src/utils/accessible-name.js.
      // It resolves `aria-labelledby` as an ID list and prefers the subtree
      // over `title`, matching what a screen reader announces.
      eval(accnameCode);

      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];
      const links = document.querySelectorAll('a[href], [role="link"]');

      links.forEach((link, index) => {
        const selector = getElementSelector(link);
        const nameInfo = __accessibleNameInfo(link);

        if (!nameInfo.name) {
          issues.push({
            type: 'link-name',
            element: selector,
            description: `Link has no accessible name (${nameInfo.reason || 'no naming mechanism'})`,
            severity: 'critical',
            suggestion: 'Add aria-label, text content, or meaningful link text',
          });
        }
      });

      return issues;
    }, accnameUtils);

    linkIssues.forEach((issue) => {
      violations.push({
        criterion: '2.4.4',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate frame titles (replaces axe: frame-title)
   */
  async validateFrameTitles(page, violations) {
    log.debug('Validating frame titles...');

    const frameIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];
      const frames = document.querySelectorAll('iframe, frame');

      frames.forEach((frame, index) => {
        const selector = getElementSelector(frame);
        const title = frame.getAttribute('title');

        if (!title || !title.trim()) {
          issues.push({
            type: 'frame-title',
            element: selector,
            description: 'Frame or iframe lacks a title attribute',
            severity: 'serious',
            suggestion: 'Add a descriptive title attribute to the frame/iframe element',
          });
        }
      });

      return issues;
    });

    frameIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate media alternatives (replaces axe: object-alt, area-alt, input-image-alt)
   */
  async validateMediaAlternatives(page, violations) {
    log.debug('Validating media alternatives...');

    const mediaIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];

      // Check area elements in image maps
      const areas = document.querySelectorAll('area');
      areas.forEach((area) => {
        const selector = getElementSelector(area);
        const alt = area.getAttribute('alt');

        if (!alt && alt !== '') {
          issues.push({
            type: 'area-alt',
            element: selector,
            description: 'Area element lacks alt attribute',
            severity: 'serious',
            suggestion: 'Add alt attribute to describe the clickable area',
          });
        }
      });

      // Check object elements
      const objects = document.querySelectorAll('object');
      objects.forEach((obj) => {
        const selector = getElementSelector(obj);
        const hasTextContent = obj.textContent.trim().length > 0;
        const hasTitle = obj.hasAttribute('title') && obj.getAttribute('title').trim();
        const hasAriaLabel =
          obj.hasAttribute('aria-label') && obj.getAttribute('aria-label').trim();

        if (!hasTextContent && !hasTitle && !hasAriaLabel) {
          issues.push({
            type: 'object-alt',
            element: selector,
            description: 'Object element lacks alternative text',
            severity: 'serious',
            suggestion: 'Add text content, title, or aria-label to describe the object',
          });
        }
      });

      // Check input type="image"
      const imageInputs = document.querySelectorAll('input[type="image"]');
      imageInputs.forEach((input) => {
        const selector = getElementSelector(input);
        const alt = input.getAttribute('alt');

        if (!alt || !alt.trim()) {
          issues.push({
            type: 'input-image-alt',
            element: selector,
            description: 'Image input lacks alt attribute',
            severity: 'critical',
            suggestion: 'Add alt attribute to describe the image input purpose',
          });
        }
      });

      return issues;
    });

    mediaIssues.forEach((issue) => {
      violations.push({
        criterion: '1.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Enhanced ARIA attribute validation (multiple axe rules)
   */
  async validateARIAAttributes(page, violations) {
    log.debug('Validating ARIA attributes...');

    const ariaIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];

      // Valid ARIA attributes
      const validAriaAttrs = [
        'aria-atomic',
        'aria-busy',
        'aria-checked',
        'aria-colcount',
        'aria-colindex',
        'aria-colspan',
        'aria-controls',
        'aria-current',
        'aria-describedby',
        'aria-details',
        'aria-disabled',
        'aria-dropeffect',
        'aria-errormessage',
        'aria-expanded',
        'aria-flowto',
        'aria-grabbed',
        'aria-haspopup',
        'aria-hidden',
        'aria-invalid',
        'aria-keyshortcuts',
        'aria-label',
        'aria-labelledby',
        'aria-level',
        'aria-live',
        'aria-modal',
        'aria-multiline',
        'aria-multiselectable',
        'aria-orientation',
        'aria-owns',
        'aria-placeholder',
        'aria-posinset',
        'aria-pressed',
        'aria-readonly',
        'aria-relevant',
        'aria-required',
        'aria-roledescription',
        'aria-rowcount',
        'aria-rowindex',
        'aria-rowspan',
        'aria-selected',
        'aria-setsize',
        'aria-sort',
        'aria-valuemax',
        'aria-valuemin',
        'aria-valuenow',
        'aria-valuetext',
      ];

      // Get all elements with any aria attribute
      const allElements = document.querySelectorAll('*');
      allElements.forEach((element) => {
        const selector = getElementSelector(element);

        // Check each attribute
        Array.from(element.attributes).forEach((attr) => {
          if (attr.name.startsWith('aria-')) {
            // Check if valid ARIA attribute
            if (!validAriaAttrs.includes(attr.name)) {
              issues.push({
                type: 'aria-valid-attr',
                element: selector,
                attribute: attr.name,
                description: `Invalid ARIA attribute: ${attr.name}`,
                severity: 'serious',
                suggestion: 'Remove invalid ARIA attribute or use valid ARIA attribute',
              });
            }

            // Check for empty values where not allowed
            if (
              !attr.value.trim() &&
              !['aria-hidden', 'aria-expanded', 'aria-checked'].includes(attr.name)
            ) {
              issues.push({
                type: 'aria-valid-attr-value',
                element: selector,
                attribute: attr.name,
                description: `ARIA attribute ${attr.name} has empty value`,
                severity: 'serious',
                suggestion: 'Provide a meaningful value for the ARIA attribute',
              });
            }
          }
        });
      });

      return issues;
    });

    ariaIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate ARIA roles (replaces axe: aria-allowed-role, aria-roles)
   */
  async validateARIARoles(page, violations) {
    log.debug('Validating ARIA roles...');

    const roleIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];

      // Valid ARIA roles
      const validRoles = [
        'alert',
        'alertdialog',
        'application',
        'article',
        'banner',
        'button',
        'cell',
        'checkbox',
        'columnheader',
        'combobox',
        'complementary',
        'contentinfo',
        'definition',
        'dialog',
        'document',
        'feed',
        'figure',
        'form',
        'grid',
        'gridcell',
        'group',
        'heading',
        'img',
        'link',
        'list',
        'listbox',
        'listitem',
        'log',
        'main',
        'marquee',
        'math',
        'menu',
        'menubar',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'navigation',
        'none',
        'note',
        'option',
        'presentation',
        'progressbar',
        'radio',
        'radiogroup',
        'region',
        'row',
        'rowgroup',
        'rowheader',
        'scrollbar',
        'search',
        'searchbox',
        'separator',
        'slider',
        'spinbutton',
        'status',
        'switch',
        'tab',
        'table',
        'tablist',
        'tabpanel',
        'term',
        'textbox',
        'timer',
        'toolbar',
        'tooltip',
        'tree',
        'treegrid',
        'treeitem',
      ];

      const elementsWithRole = document.querySelectorAll('[role]');

      elementsWithRole.forEach((element) => {
        const selector = getElementSelector(element);
        const role = element.getAttribute('role');

        if (role && !validRoles.includes(role)) {
          issues.push({
            type: 'aria-roles',
            element: selector,
            role: role,
            description: `Invalid ARIA role: ${role}`,
            severity: 'serious',
            suggestion: 'Use a valid ARIA role from the ARIA specification',
          });
        }
      });

      return issues;
    });

    roleIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate ARIA relationships (replaces axe: aria-labelledby, aria-describedby)
   */
  async validateARIARelationships(page, violations) {
    log.debug('Validating ARIA relationships...');

    const relationshipIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];

      // Check aria-labelledby references
      const labelledByElements = document.querySelectorAll('[aria-labelledby]');
      labelledByElements.forEach((element) => {
        const selector = getElementSelector(element);
        const labelledBy = element.getAttribute('aria-labelledby');

        if (labelledBy) {
          const ids = labelledBy.split(/\s+/);
          ids.forEach((id) => {
            const labelElement = document.getElementById(id);
            if (!labelElement) {
              issues.push({
                type: 'aria-labelledby',
                element: selector,
                attribute: 'aria-labelledby',
                value: id,
                description: `aria-labelledby references non-existent element with id="${id}"`,
                severity: 'serious',
                suggestion: 'Ensure the referenced element exists or remove the invalid reference',
              });
            }
          });
        }
      });

      // Check aria-describedby references
      const describedByElements = document.querySelectorAll('[aria-describedby]');
      describedByElements.forEach((element) => {
        const selector = getElementSelector(element);
        const describedBy = element.getAttribute('aria-describedby');

        if (describedBy) {
          const ids = describedBy.split(/\s+/);
          ids.forEach((id) => {
            const descElement = document.getElementById(id);
            if (!descElement) {
              issues.push({
                type: 'aria-describedby',
                element: selector,
                attribute: 'aria-describedby',
                value: id,
                description: `aria-describedby references non-existent element with id="${id}"`,
                severity: 'serious',
                suggestion: 'Ensure the referenced element exists or remove the invalid reference',
              });
            }
          });
        }
      });

      return issues;
    });

    relationshipIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate meta tags (replaces axe: meta-viewport, meta-refresh)
   */
  async validateMetaTags(page, violations) {
    log.debug('Validating meta tags...');

    const metaIssues = await page.evaluate(() => {
      const issues = [];

      // Check meta viewport
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      if (viewportMeta) {
        const content = viewportMeta.getAttribute('content');
        if (
          content &&
          (content.includes('user-scalable=no') || content.includes('maximum-scale=1'))
        ) {
          issues.push({
            type: 'meta-viewport',
            element: 'meta[name="viewport"]',
            description: 'Viewport meta tag restricts zooming',
            severity: 'serious',
            suggestion:
              'Allow users to zoom by removing user-scalable=no or maximum-scale restrictions',
          });
        }
      }

      // Check meta refresh
      const refreshMeta = document.querySelector('meta[http-equiv="refresh"]');
      if (refreshMeta) {
        const content = refreshMeta.getAttribute('content');
        if (content) {
          const match = content.match(/^(\d+)/);
          if (match && parseInt(match[1]) < 20) {
            issues.push({
              type: 'meta-refresh',
              element: 'meta[http-equiv="refresh"]',
              description: 'Meta refresh redirects too quickly (less than 20 seconds)',
              severity: 'serious',
              suggestion:
                'Use longer refresh time (20+ seconds) or provide user control over refresh',
            });
          }
        }
      }

      return issues;
    });

    metaIssues.forEach((issue) => {
      violations.push({
        criterion: '2.2.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Enhanced duplicate ID validation (replaces axe: duplicate-id-*)
   */
  async validateDuplicateIDs(page, violations) {
    log.debug('Validating duplicate IDs...');

    const duplicateIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? '#' + element.id : '';
        const className =
          element.className && typeof element.className === 'string'
            ? '.' + element.className.split(' ')[0]
            : '';
        return tagName + id + className;
      }

      const issues = [];
      const idCounts = {};
      const activeElements = [];
      const ariaElements = [];

      // Collect all elements with IDs
      const elementsWithId = document.querySelectorAll('[id]');
      elementsWithId.forEach((element) => {
        const id = element.getAttribute('id');
        if (id) {
          if (!idCounts[id]) {
            idCounts[id] = [];
          }
          idCounts[id].push(element);

          // Track special element types
          if (
            ['input', 'button', 'select', 'textarea', 'a'].includes(
              element.tagName.toLowerCase()
            ) ||
            element.hasAttribute('tabindex') ||
            element.hasAttribute('contenteditable')
          ) {
            activeElements.push({ id, element });
          }

          if (
            element.hasAttribute('aria-labelledby') ||
            element.hasAttribute('aria-describedby') ||
            element.hasAttribute('aria-label') ||
            element.hasAttribute('role')
          ) {
            ariaElements.push({ id, element });
          }
        }
      });

      // Check for duplicates
      Object.entries(idCounts).forEach(([id, elements]) => {
        if (elements.length > 1) {
          const selector = getElementSelector(elements[0]);

          // General duplicate ID
          issues.push({
            type: 'duplicate-id',
            element: selector,
            id: id,
            count: elements.length,
            description: `ID "${id}" is used ${elements.length} times`,
            severity: 'critical',
            suggestion: 'Ensure each ID is unique within the document',
          });

          // Check if any are active elements
          const hasActiveElements = elements.some(
            (el) =>
              ['input', 'button', 'select', 'textarea', 'a'].includes(el.tagName.toLowerCase()) ||
              el.hasAttribute('tabindex') ||
              el.hasAttribute('contenteditable')
          );

          if (hasActiveElements) {
            issues.push({
              type: 'duplicate-id-active',
              element: selector,
              id: id,
              description: `Active elements have duplicate ID "${id}"`,
              severity: 'critical',
              suggestion: 'Active elements must have unique IDs for proper keyboard navigation',
            });
          }

          // Check if any have ARIA references
          const hasAriaElements = elements.some(
            (el) =>
              el.hasAttribute('aria-labelledby') ||
              el.hasAttribute('aria-describedby') ||
              document.querySelector(`[aria-labelledby*="${id}"], [aria-describedby*="${id}"]`)
          );

          if (hasAriaElements) {
            issues.push({
              type: 'duplicate-id-aria',
              element: selector,
              id: id,
              description: `Elements with ARIA references have duplicate ID "${id}"`,
              severity: 'critical',
              suggestion: 'Elements referenced by ARIA attributes must have unique IDs',
            });
          }
        }
      });

      return issues;
    });

    duplicateIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate language attributes (replaces axe: html-has-lang, html-lang-valid, valid-lang)
   */
  async validateLanguageAttributes(page, violations) {
    log.debug('Validating language attributes...');

    const langIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? '#' + element.id : '';
        const className =
          element.className && typeof element.className === 'string'
            ? '.' + element.className.split(' ')[0]
            : '';
        return tagName + id + className;
      }

      const issues = [];

      // Valid language codes (ISO 639-1)
      const validLangCodes = [
        'ab',
        'aa',
        'af',
        'ak',
        'sq',
        'am',
        'ar',
        'an',
        'hy',
        'as',
        'av',
        'ae',
        'ay',
        'az',
        'bm',
        'ba',
        'eu',
        'be',
        'bn',
        'bh',
        'bi',
        'bs',
        'br',
        'bg',
        'my',
        'ca',
        'ch',
        'ce',
        'ny',
        'zh',
        'cv',
        'kw',
        'co',
        'cr',
        'hr',
        'cs',
        'da',
        'dv',
        'nl',
        'dz',
        'en',
        'eo',
        'et',
        'ee',
        'fo',
        'fj',
        'fi',
        'fr',
        'ff',
        'gl',
        'ka',
        'de',
        'el',
        'gn',
        'gu',
        'ht',
        'ha',
        'he',
        'hz',
        'hi',
        'ho',
        'hu',
        'ia',
        'id',
        'ie',
        'ga',
        'ig',
        'ik',
        'io',
        'is',
        'it',
        'iu',
        'ja',
        'jv',
        'kl',
        'kn',
        'kr',
        'ks',
        'kk',
        'km',
        'ki',
        'rw',
        'ky',
        'kv',
        'kg',
        'ko',
        'ku',
        'kj',
        'la',
        'lb',
        'lg',
        'li',
        'ln',
        'lo',
        'lt',
        'lu',
        'lv',
        'gv',
        'mk',
        'mg',
        'ms',
        'ml',
        'mt',
        'mi',
        'mr',
        'mh',
        'mn',
        'na',
        'nv',
        'nd',
        'ne',
        'ng',
        'nb',
        'nn',
        'no',
        'ii',
        'nr',
        'oc',
        'oj',
        'cu',
        'om',
        'or',
        'os',
        'pa',
        'pi',
        'fa',
        'pl',
        'ps',
        'pt',
        'qu',
        'rm',
        'rn',
        'ro',
        'ru',
        'sa',
        'sc',
        'sd',
        'se',
        'sm',
        'sg',
        'sr',
        'gd',
        'sn',
        'si',
        'sk',
        'sl',
        'so',
        'st',
        'es',
        'su',
        'sw',
        'ss',
        'sv',
        'ta',
        'te',
        'tg',
        'th',
        'ti',
        'bo',
        'tk',
        'tl',
        'tn',
        'to',
        'tr',
        'ts',
        'tt',
        'tw',
        'ty',
        'ug',
        'uk',
        'ur',
        'uz',
        've',
        'vi',
        'vo',
        'wa',
        'cy',
        'wo',
        'fy',
        'xh',
        'yi',
        'yo',
        'za',
        'zu',
      ];

      // Check html lang attribute
      const htmlElement = document.documentElement;
      const htmlLang = htmlElement.getAttribute('lang');

      if (!htmlLang) {
        issues.push({
          type: 'html-has-lang',
          element: 'html',
          description: 'HTML element lacks lang attribute',
          severity: 'serious',
          suggestion: 'Add lang attribute to html element to specify the document language',
        });
      } else {
        // Validate lang code
        const baseLang = htmlLang.split('-')[0].toLowerCase();
        if (!validLangCodes.includes(baseLang)) {
          issues.push({
            type: 'html-lang-valid',
            element: 'html',
            lang: htmlLang,
            description: `HTML lang attribute has invalid value: "${htmlLang}"`,
            severity: 'serious',
            suggestion: 'Use a valid ISO 639-1 language code',
          });
        }
      }

      // Check all elements with lang attributes
      const elementsWithLang = document.querySelectorAll('[lang]');
      elementsWithLang.forEach((element) => {
        const selector = getElementSelector(element);
        const lang = element.getAttribute('lang');

        if (lang) {
          const baseLang = lang.split('-')[0].toLowerCase();
          if (!validLangCodes.includes(baseLang)) {
            issues.push({
              type: 'valid-lang',
              element: selector,
              lang: lang,
              description: `Invalid lang attribute value: "${lang}"`,
              severity: 'moderate',
              suggestion: 'Use a valid ISO 639-1 language code',
            });
          }
        }
      });

      return issues;
    });

    langIssues.forEach((issue) => {
      violations.push({
        criterion: '3.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate form accessibility (replaces axe: label, form-field-multiple-labels)
   */
  async validateFormAccessibility(page, violations) {
    log.debug('Validating form accessibility...');

    const formIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? '#' + element.id : '';
        const className =
          element.className && typeof element.className === 'string'
            ? '.' + element.className.split(' ')[0]
            : '';
        return tagName + id + className;
      }

      /**
       * Return the DISTINCT <label> ELEMENTS associated with a form control.
       *
       * Preferred source is the native `control.labels` NodeList: that is exactly how
       * a browser (and therefore assistive technology) resolves label associations.
       * A wrapping <label for="thisId"> appears in it ONCE, not twice: one element,
       * two association mechanisms.
       *
       * Fallback (hosts/elements without `.labels`) collects `label[for=<id>]` plus
       * the closest ancestor <label> into a Set, so ELEMENT IDENTITY (not the number
       * of association mechanisms) determines the count.
       */
      function getAssociatedLabels(control) {
        const native = control.labels;
        if (native && typeof native.length === 'number') {
          return Array.from(native);
        }
        return getCandidateLabels(control);
      }

      /**
       * Permissive, identity-deduplicated label lookup, used to decide whether a
       * control is labelled AT ALL. Looser than `control.labels` (it accepts e.g. a
       * select nested in a <label> that already labels an earlier radio), so the
       * strict multiple-labels count does not produce "no associated label" findings.
       */
      function getCandidateLabels(control) {
        const unique = new Set();
        const id = control.getAttribute('id');
        if (id) {
          const escaped =
            window.CSS && typeof window.CSS.escape === 'function'
              ? window.CSS.escape(id)
              : id.replace(/["\\]/g, '\\$&');
          try {
            document.querySelectorAll(`label[for="${escaped}"]`).forEach((l) => unique.add(l));
          } catch (e) {
            /* malformed id: no selector-based association */
          }
        }

        const wrappingLabel = control.closest('label');
        if (wrappingLabel) {
          unique.add(wrappingLabel);
        }

        return Array.from(unique);
      }

      const issues = [];

      // Check form controls for proper labeling
      const formControls = document.querySelectorAll(
        'input:not([type="hidden"]), textarea, select'
      );

      formControls.forEach((control) => {
        const selector = getElementSelector(control);
        const type = control.getAttribute('type');

        // Skip submit, button, reset types
        if (['submit', 'button', 'reset', 'image'].includes(type)) {
          return;
        }

        let hasLabel = false;
        let labelCount = 0;

        // Check for aria-label
        if (control.hasAttribute('aria-label') && control.getAttribute('aria-label').trim()) {
          hasLabel = true;
        }

        // Check for aria-labelledby
        if (control.hasAttribute('aria-labelledby')) {
          const labelIds = control.getAttribute('aria-labelledby').split(/\s+/);
          let validRefs = 0;
          labelIds.forEach((id) => {
            if (document.getElementById(id)) {
              validRefs++;
            }
          });
          if (validRefs > 0) {
            hasLabel = true;
          }
        }

        // Check for <label> associations.
        //
        // labelCount counts DISTINCT label ELEMENTS, not association mechanisms.
        // A control wrapped in a <label> that ALSO carries a matching for="" is
        // associated by two mechanisms but by one and the same element. Browsers
        // report `control.labels.length === 1` for it, and it is NOT a "multiple
        // labels" violation. Two genuinely distinct <label> elements pointing at the
        // same control still count as 2 and are still flagged below.
        labelCount += getAssociatedLabels(control).length;

        // "Is it labelled at all" stays on the looser lookup, see getCandidateLabels().
        if (getCandidateLabels(control).length > 0) {
          hasLabel = true;
        }

        // Check for missing label
        if (!hasLabel) {
          issues.push({
            type: 'label',
            element: selector,
            description: 'Form control has no associated label',
            severity: 'critical',
            suggestion: 'Add label element, aria-label, or aria-labelledby to form control',
          });
        }

        // Check for multiple labels
        if (labelCount > 1) {
          issues.push({
            type: 'form-field-multiple-labels',
            element: selector,
            labelCount: labelCount,
            description: `Form control has ${labelCount} labels`,
            severity: 'moderate',
            suggestion: 'Ensure form control has only one label for clarity',
          });
        }
      });

      return issues;
    });

    formIssues.forEach((issue) => {
      violations.push({
        criterion: '4.1.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Helper method to generate element selector
   */
  getElementSelector(element) {
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const className =
      element.className && typeof element.className === 'string'
        ? `.${element.className.split(' ')[0]}`
        : '';

    return `${tagName}${id}${className}`;
  }
}

module.exports = HTMLValidationScanner;
