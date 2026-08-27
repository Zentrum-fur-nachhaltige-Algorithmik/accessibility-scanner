const BaseScanner = require('../core/base-scanner');

/**
 * Use of Color Scanner for WCAG compliance testing
 * Implements EN 301 549 criterion 9.1.4.1 (Use of Color)
 * Detects when color is used as the only means of conveying information
 */
class UseOfColorScanner extends BaseScanner {
  constructor() {
    super('use-of-color', {
      wcagCriteria: ['1.4.1'],
      wcagPrinciple: 'perceivable'
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const colorDependencyResults = await page.evaluate(() => {
      const violations = [];
      let colorOnlyElements = 0;
      let formErrorsColorOnly = 0;
      let linksColorOnly = 0;

      // Helper function to get computed styles
      function getComputedColor(element, property) {
        return window.getComputedStyle(element).getPropertyValue(property);
      }

      // Helper function to check if element has non-color indicators
      function hasNonColorIndicators(element) {
        const computed = window.getComputedStyle(element);

        // Check for text decorations - any explicit text decoration is good
        const textDecoration = computed.textDecoration;
        if (textDecoration && (textDecoration.includes('underline') || textDecoration.includes('overline'))) return true;

        // Check for bold text
        const fontWeight = computed.fontWeight;
        if (fontWeight && (fontWeight === 'bold' || parseInt(fontWeight) >= 700)) return true;

        // Check for borders
        const border = computed.border;
        if (border && border !== 'none' && !border.includes('0px')) return true;

        // Check for background images/icons
        const backgroundImage = computed.backgroundImage;
        if (backgroundImage && backgroundImage !== 'none') return true;

        // Check if element contains icons or symbols in text
        const text = element.textContent || '';
        const iconSymbols = ['✓', '✗', '⚠', '!', '*', '→', '←', '↑', '↓', '◦', '●', '•'];
        if (iconSymbols.some(symbol => text.includes(symbol))) return true;

        // Check for role-based indicators (buttons, navigation items are often styled differently)
        const role = element.getAttribute('role') || '';
        if (['button', 'navigation', 'menuitem', 'tab'].includes(role)) return true;

        // Check if link is part of navigation structure
        const isInNav = element.closest('nav, .nav, .navigation, .menu, header, footer, .header, .footer');
        if (isInNav) return true;

        // Check for focus indicators - if element has proper focus styling, it's likely accessible
        if (computed.outline && computed.outline !== 'none') return true;

        return false;
      }

      // Helper function to check for text-based indicators
      function hasTextIndicators(element) {
        const text = element.textContent.toLowerCase().trim();
        const indicators = ['error', 'required', 'invalid', 'warning', 'alert', 'success', 'info', '*', '✗', '✓', '⚠'];

        // Check if element has meaningful text content beyond just the indicator words
        if (text.length <= 1) return false; // Just a symbol might not be enough

        return indicators.some(indicator => text.includes(indicator));
      }

      // Generate element selector
      function getElementSelector(element) {
        let selector = element.tagName.toLowerCase();
        if (element.id) selector += `#${element.id}`;
        // SVG/MathML elements expose className as an SVGAnimatedString, not a string
        if (element.className && typeof element.className === 'string') selector += `.${element.className.split(' ').join('.')}`;
        return selector;
      }

      // 1. Check links that might rely only on color
      const links = document.querySelectorAll('a[href]');

      links.forEach(link => {
        const linkColor = getComputedColor(link, 'color');
        const parentColor = getComputedColor(link.parentElement, 'color');

        // Check if link has different color than surrounding text
        const hasColorDifference = linkColor !== parentColor && linkColor !== 'inherit';

        // Skip if this is not actually a text link (no text content)
        const linkText = link.textContent.trim();
        if (!linkText || linkText.length < 2) return;

        // Skip if link is in navigation - nav links are often styled differently and that's acceptable
        const isInMainContent = !link.closest('nav, .nav, .navigation, .menu, header, footer, .header, .footer, .sidebar, aside');

        // Only flag links in main content that truly rely ONLY on color
        if (hasColorDifference && isInMainContent && !hasNonColorIndicators(link)) {
          // Additional check: ensure this is really a problematic color-only link
          // Skip if the link has sufficient context or is obviously distinguishable
          const hasContext = link.closest('p, article, .content, main') &&
                            link.parentElement.textContent.trim().length > linkText.length;

          if (hasContext) {
            linksColorOnly++;
            colorOnlyElements++;
            violations.push({
              element: getElementSelector(link),
              issue: 'link-color-only',
              description: 'Link in content area is differentiated from surrounding text only by color',
              suggestion: 'Add underline, bold text, or other visual indicator to distinguish links'
            });
          }
        }
      });

      // 2. Check form fields and their error states
      const formElements = document.querySelectorAll('input, select, textarea');
      formElements.forEach(formElement => {
        const fieldContainer = formElement.closest('.form-group, .field, .input-group') || formElement.parentElement;

        // Look for error indicators
        const errorElements = fieldContainer.querySelectorAll('.error, .invalid, .warning, [class*="error"], [class*="invalid"]');
        errorElements.forEach(errorElement => {
          const errorColor = getComputedColor(errorElement, 'color');
          const errorBgColor = getComputedColor(errorElement, 'background-color');
          const text = errorElement.textContent.trim();

          // Check if element has red-like color (simple detection)
          const isRedish = errorColor.includes('rgb(255, 0, 0)') || errorColor.includes('red') ||
                         errorColor.includes('rgb(220, 53, 69)') || errorColor.includes('#ff0000');

          // Check if error uses only color without adequate text or icons
          if (isRedish && text.toLowerCase() === 'error message' && !hasNonColorIndicators(errorElement)) {
            formErrorsColorOnly++;
            colorOnlyElements++;
            violations.push({
              element: getElementSelector(formElement),
              issue: 'form-error-color-only',
              description: 'Error indication uses only red color without text or icon',
              suggestion: 'Add error icon or text message alongside color'
            });
          }
        });

        // Check for required field indicators
        const requiredIndicators = fieldContainer.querySelectorAll('.required, [class*="required"]');
        requiredIndicators.forEach(indicator => {
          if (!hasTextIndicators(indicator) && !hasNonColorIndicators(indicator)) {
            colorOnlyElements++;
            violations.push({
              element: getElementSelector(formElement),
              issue: 'required-field-color-only',
              description: 'Required field indication uses only color',
              suggestion: 'Add asterisk (*) or "required" text alongside color indicator'
            });
          }
        });
      });

      // 3. Check status messages and alerts
      const statusElements = document.querySelectorAll('.status, .alert, .message, .notification, [class*="status"], [class*="alert"], [class*="success"], [class*="warning"], [class*="info"]');
      statusElements.forEach(statusElement => {
        const hasColorStyling = getComputedColor(statusElement, 'background-color') !== 'rgba(0, 0, 0, 0)' ||
                               getComputedColor(statusElement, 'color') !== getComputedColor(statusElement.parentElement, 'color');

        if (hasColorStyling && !hasTextIndicators(statusElement) && !hasNonColorIndicators(statusElement)) {
          colorOnlyElements++;
          violations.push({
            element: getElementSelector(statusElement),
            issue: 'status-color-only',
            description: 'Status message uses only color to convey information',
            suggestion: 'Add descriptive text or icons to indicate status type'
          });
        }
      });

      // 4. Check charts and data visualizations. A bare <svg> is almost always
      // an icon; only treat it as a chart when it is large and uses several
      // fill colours (i.e. could encode data series by colour).
      const chartCandidates = [...document.querySelectorAll('canvas, .chart, .graph, [class*="chart"], [class*="graph"]')];
      document.querySelectorAll('svg').forEach(svg => {
        if (chartCandidates.includes(svg)) return;
        const r = svg.getBoundingClientRect();
        if (r.width < 150 || r.height < 100) return;
        const fills = new Set();
        svg.querySelectorAll('path, rect, circle, polygon, ellipse').forEach(sh => {
          const f = window.getComputedStyle(sh).fill;
          if (f && f !== 'none') fills.add(f);
        });
        if (fills.size >= 3) chartCandidates.push(svg);
      });
      const charts = chartCandidates;
      charts.forEach(chart => {
        // Basic check for chart elements that might rely on color
        const hasLegend = chart.querySelector('.legend, [class*="legend"]') ||
                         document.querySelector('.legend, [class*="legend"]');
        const hasLabels = chart.querySelector('text, .label, [class*="label"]');

        if (!hasLegend && !hasLabels) {
          colorOnlyElements++;
          violations.push({
            element: getElementSelector(chart),
            issue: 'chart-color-only',
            description: 'Chart or graph may rely only on color to distinguish data',
            suggestion: 'Add patterns, textures, labels, or legend to differentiate data series'
          });
        }
      });

      return {
        violations,
        colorOnlyElements,
        formErrorsColorOnly,
        linksColorOnly
      };
    });

    // Create report according to interface
    return {
      scannerId: this.id,
      criterion: "9.1.4.1",
      passed: colorDependencyResults.violations.length === 0,
      violations: colorDependencyResults.violations,
      summary: {
        colorOnlyElements: colorDependencyResults.colorOnlyElements,
        formErrorsColorOnly: colorDependencyResults.formErrorsColorOnly,
        linksColorOnly: colorDependencyResults.linksColorOnly
      }
    };
  }

}

module.exports = UseOfColorScanner;
