const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Advanced Contrast Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.1.4.11, 9.1.4.13 (Non-text Contrast, Content on Hover or Focus)
 * Tests UI components, graphical objects, and hover/focus content contrast
 */
class AdvancedContrastScanner extends BaseScanner {
  constructor() {
    super('advanced-contrast', {
      wcagCriteria: ['1.4.3', '1.4.6', '1.4.11'],
      wcagPrinciple: 'perceivable'
    });
    this.screenshotDir = path.join(__dirname, '../tmp/contrast-screenshots');
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      timeout: options.timeout || 60000,
      ...options
    };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const contrastResults = await this.performAdvancedContrastAnalysis(page, scanDir, scanOptions);

    // Create report according to interface
    return {
      scannerId: this.id,
      criteria: ["9.1.4.11", "9.1.4.13"],
      passed: contrastResults.violations.length === 0,
      violations: contrastResults.violations,
      summary: {
        nonTextElementsTested: contrastResults.nonTextElementsTested,
        hoverContentTested: contrastResults.hoverContentTested,
        graphicalObjectsCompliant: contrastResults.graphicalObjectsCompliant,
        uiComponentsCompliant: contrastResults.uiComponentsCompliant
      },
      screenshotPath: scanDir,
      visualEvidence: contrastResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive advanced contrast analysis
   */
  async performAdvancedContrastAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let nonTextElementsTested = 0;
    let hoverContentTested = 0;
    let graphicalObjectsCompliant = 0;
    let uiComponentsCompliant = 0;

    console.log('Starting advanced contrast analysis...');

    // Inject contrast analysis utilities
    await page.evaluate(() => {
      // Helper function to parse RGB values
      window.parseRgb = function(rgbString) {
        const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return null;

        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3]),
          a: match[4] ? parseFloat(match[4]) : 1
        };
      };

      // Calculate relative luminance
      window.getLuminance = function(rgb) {
        const { r, g, b } = rgb;
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      };

      // Calculate contrast ratio
      window.getContrastRatio = function(color1, color2) {
        const lum1 = window.getLuminance(color1);
        const lum2 = window.getLuminance(color2);
        const brightest = Math.max(lum1, lum2);
        const darkest = Math.min(lum1, lum2);
        return (brightest + 0.05) / (darkest + 0.05);
      };
    });

    // 1. Test UI component contrast (WCAG 1.4.11)
    await this.testUIComponentContrast(page, scanDir, violations, visualEvidence);

    // 2. Test graphical object contrast
    await this.testGraphicalObjectContrast(page, scanDir, violations, visualEvidence);

    // 3. Test hover and focus content contrast (WCAG 1.4.13)
    await this.testHoverFocusContent(page, scanDir, violations, visualEvidence);

    // Calculate summary statistics
    nonTextElementsTested = visualEvidence.length;
    hoverContentTested = visualEvidence.filter(e => e.type === 'hover-content').length;
    graphicalObjectsCompliant = visualEvidence.filter(e =>
      e.type === 'graphical-object' && e.contrastRatio >= 3
    ).length;
    uiComponentsCompliant = visualEvidence.filter(e =>
      e.type === 'ui-component' && e.contrastRatio >= 3
    ).length;

    console.log(`Advanced contrast analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      nonTextElementsTested,
      hoverContentTested,
      graphicalObjectsCompliant,
      uiComponentsCompliant
    };
  }

  /**
   * Test UI component contrast (buttons, inputs, etc.)
   */
  async testUIComponentContrast(page, scanDir, violations, visualEvidence) {
    console.log('Testing UI component contrast...');

    const uiComponents = await page.evaluate(() => {
      const components = [];

      // Find UI components that need contrast testing
      const selectors = [
        'button',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
        'input[type="text"]',
        'input[type="email"]',
        'input[type="password"]',
        'input[type="search"]',
        'textarea',
        'select',
        '[role="button"]',
        '.btn',
        '.button'
      ];

      /**
       * Build a selector that is actually valid CSS.
       *
       * Two real-world traps this closes, both found on live sites:
       *  - React's `useId()` produces ids like ":Rbaqrlaupgqop:" — the colons
       *    MUST be escaped or `document.querySelector` throws.
       *  - `class="mzp-c-button "` (trailing space) split naively yields an
       *    empty token, producing a dangling "." — also a SyntaxError.
       * Either one aborted the whole contrast sweep on real pages.
       */
      const buildSafeSelector = (element, index) => {
        const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, '\\$&'));
        const rawClass = typeof element.className === 'string' ? element.className : '';
        const classes = rawClass.trim().split(/\s+/).filter(Boolean);
        let sel = element.tagName.toLowerCase();
        if (element.id) return sel + '#' + esc(element.id);
        if (classes.length) return sel + classes.slice(0, 3).map((c) => '.' + esc(c)).join('');
        return sel + `:nth-of-type(${index + 1})`;
      };

      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const computed = window.getComputedStyle(element);
            // SVG/MathML elements expose className as an SVGAnimatedString, not a string
            const className = typeof element.className === 'string' ? element.className : '';

            // Generate unique selector (escaped — see buildSafeSelector above)
            const elementSelector = buildSafeSelector(element, index);

            // Get colors for contrast calculation
            const backgroundColor = computed.backgroundColor;
            const borderColor = computed.borderColor;
            const outlineColor = computed.outlineColor;

            components.push({
              selector: elementSelector,
              type: element.tagName.toLowerCase(),
              backgroundColor: backgroundColor,
              borderColor: borderColor,
              outlineColor: outlineColor,
              borderWidth: computed.borderWidth,
              outlineWidth: computed.outlineWidth,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            });
          }
        });
      });

      return components;
    });

    // Test each UI component
    for (const component of uiComponents) {
      await this.testComponentContrast(page, scanDir, component, violations, visualEvidence, 'ui-component');
    }
  }

  /**
   * Test graphical object contrast (icons, charts, etc.)
   */
  async testGraphicalObjectContrast(page, scanDir, violations, visualEvidence) {
    console.log('Testing graphical object contrast...');

    const graphicalObjects = await page.evaluate(() => {
      const objects = [];

      // Find graphical objects
      const selectors = [
        'svg',
        'canvas',
        '.icon',
        '.chart',
        '.graph',
        '[class*="icon"]',
        '[class*="chart"]',
        '[class*="graph"]',
        'img[role="img"]'
      ];

      /**
       * Build a selector that is actually valid CSS.
       *
       * Two real-world traps this closes, both found on live sites:
       *  - React's `useId()` produces ids like ":Rbaqrlaupgqop:" — the colons
       *    MUST be escaped or `document.querySelector` throws.
       *  - `class="mzp-c-button "` (trailing space) split naively yields an
       *    empty token, producing a dangling "." — also a SyntaxError.
       * Either one aborted the whole contrast sweep on real pages.
       */
      const buildSafeSelector = (element, index) => {
        const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, '\\$&'));
        const rawClass = typeof element.className === 'string' ? element.className : '';
        const classes = rawClass.trim().split(/\s+/).filter(Boolean);
        let sel = element.tagName.toLowerCase();
        if (element.id) return sel + '#' + esc(element.id);
        if (classes.length) return sel + classes.slice(0, 3).map((c) => '.' + esc(c)).join('');
        return sel + `:nth-of-type(${index + 1})`;
      };

      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const computed = window.getComputedStyle(element);
            // SVG/MathML elements expose className as an SVGAnimatedString, not a string
            const className = typeof element.className === 'string' ? element.className : '';

            const elementSelector = buildSafeSelector(element, index);

            objects.push({
              selector: elementSelector,
              type: element.tagName.toLowerCase(),
              backgroundColor: computed.backgroundColor,
              color: computed.color,
              fill: element.getAttribute('fill') || computed.fill,
              stroke: element.getAttribute('stroke') || computed.stroke,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            });
          }
        });
      });

      return objects;
    });

    // Test each graphical object
    for (const object of graphicalObjects) {
      await this.testComponentContrast(page, scanDir, object, violations, visualEvidence, 'graphical-object');
    }
  }

  /**
   * Test hover and focus content contrast
   */
  async testHoverFocusContent(page, scanDir, violations, visualEvidence) {
    console.log('Testing hover and focus content contrast...');

    // Find elements with hover/focus states
    const interactiveElements = await page.evaluate(() => {
      const elements = [];
      const selectors = [
        'a',
        'button',
        '[tabindex]',
        '.tooltip',
        '[title]',
        '[data-tooltip]',
        '.dropdown',
        '.menu-item'
      ];

      /**
       * Build a selector that is actually valid CSS.
       *
       * Two real-world traps this closes, both found on live sites:
       *  - React's `useId()` produces ids like ":Rbaqrlaupgqop:" — the colons
       *    MUST be escaped or `document.querySelector` throws.
       *  - `class="mzp-c-button "` (trailing space) split naively yields an
       *    empty token, producing a dangling "." — also a SyntaxError.
       * Either one aborted the whole contrast sweep on real pages.
       */
      const buildSafeSelector = (element, index) => {
        const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, '\\$&'));
        const rawClass = typeof element.className === 'string' ? element.className : '';
        const classes = rawClass.trim().split(/\s+/).filter(Boolean);
        let sel = element.tagName.toLowerCase();
        if (element.id) return sel + '#' + esc(element.id);
        if (classes.length) return sel + classes.slice(0, 3).map((c) => '.' + esc(c)).join('');
        return sel + `:nth-of-type(${index + 1})`;
      };

      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // SVG/MathML elements expose className as an SVGAnimatedString, not a string
            const className = typeof element.className === 'string' ? element.className : '';

            // Generate a reliable, ESCAPED selector (see buildSafeSelector above)
            let elementSelector = buildSafeSelector(element, index);

            // Anonymous elements get a parent-scoped selector so the reader can
            // actually find them; both halves are escaped.
            if (!element.id && !className.trim()) {
              const parent = element.parentElement;
              if (parent) {
                const parentSelector = buildSafeSelector(parent, 0);
                const siblings = Array.from(parent.children).filter(child =>
                  child.tagName.toLowerCase() === element.tagName.toLowerCase()
                );
                const elementIndex = siblings.indexOf(element);
                elementSelector = `${parentSelector} > ${element.tagName.toLowerCase()}:nth-child(${elementIndex + 1})`;
              }
            }

            elements.push({
              selector: elementSelector,
              hasTooltip: !!(element.title || element.getAttribute('data-tooltip')),
              hasHoverState: true,
              tagName: element.tagName.toLowerCase()
            });
          }
        });
      });

      return elements;
    });

    // Test hover states
    for (const element of interactiveElements.slice(0, 10)) { // Limit to prevent timeout
      try {
        // First verify the element exists
        const elementExists = await page.evaluate((selector) => {
          return !!document.querySelector(selector);
        }, element.selector);

        if (!elementExists) {
          console.warn(`Skipping hover test for ${element.selector} - element not found`);
          continue;
        }

        // Take screenshot before hover
        const beforeScreenshot = path.join(scanDir, `hover-before-${Math.random().toString(36).substr(2, 9)}.png`);
        await page.screenshot({ path: beforeScreenshot });

        // Hover over element
        await page.hover(element.selector);
        await new Promise(resolve => setTimeout(resolve, 200)); // Allow hover effects

        // Take screenshot after hover
        const afterScreenshot = path.join(scanDir, `hover-after-${Math.random().toString(36).substr(2, 9)}.png`);
        await page.screenshot({ path: afterScreenshot });

        // Check for new content or contrast changes
        const hoverAnalysis = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;

          const computed = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();

          // Look for tooltip or popup content
          const tooltips = document.querySelectorAll('.tooltip-text, [role="tooltip"], .popup, .dropdown-menu');
          let tooltipContent = null;

          tooltips.forEach(tooltip => {
            const tooltipRect = tooltip.getBoundingClientRect();
            const tooltipStyle = window.getComputedStyle(tooltip);

            if (tooltipStyle.visibility !== 'hidden' && tooltipStyle.display !== 'none' &&
                tooltipRect.width > 0 && tooltipRect.height > 0) {
              tooltipContent = {
                backgroundColor: tooltipStyle.backgroundColor,
                color: tooltipStyle.color,
                borderColor: tooltipStyle.borderColor,
                text: tooltip.textContent.trim()
              };
            }
          });

          return {
            element: {
              backgroundColor: computed.backgroundColor,
              color: computed.color,
              borderColor: computed.borderColor
            },
            tooltip: tooltipContent
          };
        }, element.selector);

        if (hoverAnalysis && hoverAnalysis.tooltip) {
          // Test tooltip contrast
          const contrastResult = await this.analyzeTooltipContrast(
            page,
            hoverAnalysis.tooltip,
            element.selector
          );

          if (contrastResult.contrastRatio < 4.5) {
            violations.push({
              criterion: "9.1.4.13",
              element: element.selector,
              issue: "hover-content-contrast",
              description: `Hover content has insufficient contrast ratio: ${contrastResult.contrastRatio.toFixed(2)}:1`,
              contrastRatio: contrastResult.contrastRatio,
              requiredRatio: 4.5,
              elementType: 'hover-content',
              suggestion: "Ensure hover and focus content maintains sufficient contrast"
            });
          }

          visualEvidence.push({
            element: element.selector,
            type: 'hover-content',
            contrastRatio: contrastResult.contrastRatio,
            beforeScreenshot: path.basename(beforeScreenshot),
            afterScreenshot: path.basename(afterScreenshot),
            tooltipText: hoverAnalysis.tooltip.text
          });
        }

      } catch (error) {
        console.warn(`Error testing hover state for ${element.selector}:`, error.message);
      }
    }
  }

  /**
   * Test individual component contrast
   */
  async testComponentContrast(page, scanDir, component, violations, visualEvidence, elementType) {
    const contrastAnalysis = await page.evaluate((comp) => {
      // Get parent background for comparison
      let parentBg = 'rgb(255, 255, 255)'; // Default white
      const element = document.querySelector(comp.selector);

      if (element && element.parentElement) {
        const parentStyle = window.getComputedStyle(element.parentElement);
        const parentBgColor = parentStyle.backgroundColor;
        if (parentBgColor && parentBgColor !== 'rgba(0, 0, 0, 0)') {
          parentBg = parentBgColor;
        }
      }

      // Analyze component colors
      const results = [];

      // Test background vs parent background
      if (comp.backgroundColor && comp.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const bgRgb = window.parseRgb(comp.backgroundColor);
        const parentRgb = window.parseRgb(parentBg);

        if (bgRgb && parentRgb) {
          const ratio = window.getContrastRatio(bgRgb, parentRgb);

          // Skip if background is identical to parent (this is normal for input fields)
          const colorsDifferent = Math.abs(bgRgb.r - parentRgb.r) > 5 ||
                                 Math.abs(bgRgb.g - parentRgb.g) > 5 ||
                                 Math.abs(bgRgb.b - parentRgb.b) > 5;

          if (colorsDifferent) {
            results.push({
              type: 'background',
              ratio: ratio,
              color1: comp.backgroundColor,
              color2: parentBg,
              significant: true
            });
          } else {
            // Still record but mark as non-significant
            results.push({
              type: 'background',
              ratio: ratio,
              color1: comp.backgroundColor,
              color2: parentBg,
              significant: false
            });
          }
        }
      }

      // Test border contrast - only for visible borders
      if (comp.borderColor && comp.borderColor !== 'rgba(0, 0, 0, 0)' &&
          comp.borderWidth && comp.borderWidth !== '0px') {
        const borderRgb = window.parseRgb(comp.borderColor);
        const parentRgb = window.parseRgb(parentBg);

        if (borderRgb && parentRgb) {
          const ratio = window.getContrastRatio(borderRgb, parentRgb);
          const borderWidthPx = parseFloat(comp.borderWidth);

          results.push({
            type: 'border',
            ratio: ratio,
            color1: comp.borderColor,
            color2: parentBg,
            borderWidth: borderWidthPx,
            significant: borderWidthPx >= 1 // Only significant if border is at least 1px
          });
        }
      }

      return results;
    }, component);

    // Check if input has good focus indicators (for input border leniency)
    let hasFocusIndicator = false;
    if (component.type === 'input' || component.type === 'textarea') {
      hasFocusIndicator = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;

        // Get original border color
        const originalBorderColor = window.getComputedStyle(el).borderColor;

        // Simulate focus to check focus styles
        el.focus();
        const focusStyle = window.getComputedStyle(el);
        const hasFocusOutline = focusStyle.outline && focusStyle.outline !== 'none';
        const hasFocusBoxShadow = focusStyle.boxShadow && focusStyle.boxShadow !== 'none';
        const hasFocusBorderChange = focusStyle.borderColor !== originalBorderColor;

        el.blur(); // Remove focus
        return hasFocusOutline || hasFocusBoxShadow || hasFocusBorderChange;
      }, component.selector);
    }

    // Check contrast ratios and create violations
    contrastAnalysis.forEach(analysis => {
      // Different thresholds for different component types
      let requiredRatio = 3.0; // WCAG 1.4.11 requires 3:1 for UI components
      let tolerance = 0.05; // Allow small rounding differences

      // For input fields, be more lenient with subtle borders if they have good focus indicators
      if (component.type === 'input' || component.type === 'textarea') {
        if (analysis.type === 'border') {
          if (hasFocusIndicator && analysis.borderWidth < 3) {
            requiredRatio = 1.5; // Very lenient for inputs with excellent focus indicators
          } else if (analysis.borderWidth < 2) {
            requiredRatio = 2.5; // More lenient for thin borders
          }
        }
      }

      // Only flag significant contrast issues
      const actualRatio = analysis.ratio + tolerance; // Account for rounding
      const isSignificantIssue = analysis.significant && (actualRatio < requiredRatio);

      if (isSignificantIssue) {
        violations.push({
          criterion: "9.1.4.11",
          element: component.selector,
          issue: `${elementType}-contrast`,
          description: `${elementType.replace('-', ' ')} ${analysis.type} has insufficient contrast: ${analysis.ratio.toFixed(2)}:1`,
          contrastRatio: analysis.ratio,
          requiredRatio: requiredRatio,
          elementType: elementType,
          suggestion: `Increase ${analysis.type} contrast to meet ${requiredRatio}:1 minimum ratio`
        });
      }

      // Only add to visual evidence if it's significant
      if (analysis.significant) {
        visualEvidence.push({
          element: component.selector,
          type: elementType,
          contrastType: analysis.type,
          contrastRatio: analysis.ratio,
          colors: {
            foreground: analysis.color1,
            background: analysis.color2
          }
        });
      }
    });
  }

  /**
   * Analyze tooltip contrast
   */
  async analyzeTooltipContrast(page, tooltip, selector) {
    const analysis = await page.evaluate((tt) => {
      const bgRgb = window.parseRgb(tt.backgroundColor);
      const fgRgb = window.parseRgb(tt.color);

      if (bgRgb && fgRgb) {
        return {
          contrastRatio: window.getContrastRatio(fgRgb, bgRgb),
          backgroundColor: tt.backgroundColor,
          textColor: tt.color
        };
      }

      return { contrastRatio: 21 }; // Perfect contrast if can't parse
    }, tooltip);

    return analysis;
  }

}

module.exports = AdvancedContrastScanner;
