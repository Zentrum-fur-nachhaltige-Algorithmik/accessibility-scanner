const BaseScanner = require('./base-scanner');

/**
 * Color Contrast Scanner for WCAG compliance testing
 * Implements EN 301 549 criterion 9.1.4.3 (Contrast Minimum)
 */
class ColorContrastScanner extends BaseScanner {
  constructor() {
    super('color-contrast', {
      wcagCriteria: ['1.4.3', '1.4.6'],
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
    const scanOptions = {
      wcagLevel: options.wcagLevel || 'AA',
      includeGradients: options.includeGradients || false,
      checkLargeText: options.checkLargeText !== false,
      ignoreTransparent: options.ignoreTransparent !== false,
    };

    const contrastResults = await page.evaluate((options) => {
      // Helper function to get computed styles
      function getComputedColor(element, property) {
        const computed = window.getComputedStyle(element);
        return computed.getPropertyValue(property);
      }

      // Helper function to parse RGB values
      function parseRgb(rgbString) {
        const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return null;

        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3]),
          a: match[4] ? parseFloat(match[4]) : 1
        };
      }

      // Calculate relative luminance
      function getLuminance(rgb) {
        const { r, g, b } = rgb;
        const [rs, gs, bs] = [r, g, b].map(c => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }

      // Calculate contrast ratio
      function getContrastRatio(color1, color2) {
        const lum1 = getLuminance(color1);
        const lum2 = getLuminance(color2);
        const brightest = Math.max(lum1, lum2);
        const darkest = Math.min(lum1, lum2);
        return (brightest + 0.05) / (darkest + 0.05);
      }

      // Check if text is large (18pt+ or 14pt+ bold)
      function isLargeText(element) {
        const computed = window.getComputedStyle(element);
        const fontSize = parseFloat(computed.fontSize);
        const fontWeight = computed.fontWeight;

        // Convert px to pt (1pt = 1.33px approximately)
        const fontSizePt = fontSize * 0.75;

        return fontSizePt >= 18 || (fontSizePt >= 14 && (fontWeight === 'bold' || parseInt(fontWeight) >= 700));
      }

      // Get background color, handling inheritance
      function getEffectiveBackgroundColor(element) {
        let currentElement = element;
        let backgroundColor = 'transparent';

        while (currentElement && currentElement !== document.body.parentElement) {
          const bgColor = getComputedColor(currentElement, 'background-color');
          const bgColorParsed = parseRgb(bgColor);

          if (bgColorParsed && bgColorParsed.a > 0) {
            if (backgroundColor === 'transparent') {
              backgroundColor = bgColor;
            } else {
              // Handle transparency blending (simplified)
              backgroundColor = bgColor;
            }
            break;
          }
          currentElement = currentElement.parentElement;
        }

        return backgroundColor === 'transparent' ? 'rgb(255, 255, 255)' : backgroundColor;
      }

      // Get all text elements
      const textElements = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let node;
      while (node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent && node.textContent.trim() &&
            window.getComputedStyle(parent).display !== 'none' &&
            window.getComputedStyle(parent).visibility !== 'hidden') {
          textElements.push(parent);
        }
      }

      // Remove duplicates and get unique elements
      const uniqueElements = [...new Set(textElements)];

      const violations = [];
      let totalElements = 0;
      let passedElements = 0;
      let failedElements = 0;

      const requiredRatio = options.wcagLevel === 'AAA' ? 7 : 4.5;
      const requiredRatioLarge = options.wcagLevel === 'AAA' ? 4.5 : 3;

      uniqueElements.forEach(element => {
        try {
          const foregroundColor = getComputedColor(element, 'color');
          const backgroundColor = getEffectiveBackgroundColor(element);

          const fgRgb = parseRgb(foregroundColor);
          const bgRgb = parseRgb(backgroundColor);

          if (!fgRgb || !bgRgb) return;

          // Skip transparent elements if option is set
          if (options.ignoreTransparent && (fgRgb.a < 1 || bgRgb.a < 1)) return;

          totalElements++;

          const contrastRatio = getContrastRatio(fgRgb, bgRgb);
          const largeText = isLargeText(element);
          const minimumRatio = largeText ? requiredRatioLarge : requiredRatio;

          if (contrastRatio < minimumRatio) {
            failedElements++;

            // Generate selector for element
            let selector = element.tagName.toLowerCase();
            if (element.id) selector += `#${element.id}`;
            if (element.className) selector += `.${element.className.split(' ').join('.')}`;

            // Generate suggestions
            const suggestedForeground = contrastRatio < minimumRatio ?
              (bgRgb.r + bgRgb.g + bgRgb.b > 384 ? '#000000' : '#ffffff') : null;

            violations.push({
              element: selector,
              currentRatio: Math.round(contrastRatio * 100) / 100,
              requiredRatio: minimumRatio,
              foregroundColor: foregroundColor,
              backgroundColor: backgroundColor,
              isLargeText: largeText,
              suggestedForeground: suggestedForeground
            });
          } else {
            passedElements++;
          }
        } catch (error) {
          console.warn('Error checking contrast for element:', error);
        }
      });

      return {
        totalElements,
        passedElements,
        failedElements,
        violations,
        minimumRatio: requiredRatio
      };
    }, scanOptions);

    // Create report according to interface
    return {
      scannerId: this.id,
      criterion: "9.1.4.3",
      passed: contrastResults.violations.length === 0,
      violations: contrastResults.violations,
      summary: {
        totalElements: contrastResults.totalElements,
        failedElements: contrastResults.failedElements,
        passedElements: contrastResults.passedElements,
        minimumRatio: contrastResults.minimumRatio
      }
    };
  }

}

module.exports = ColorContrastScanner;
