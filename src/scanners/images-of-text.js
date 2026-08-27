const BaseScanner = require('../core/base-scanner');

/**
 * Images of Text Scanner for WCAG compliance testing
 * Implements EN 301 549 criterion 9.1.4.5 (Images of Text)
 * Detects when images are used to present text that could be presented as real text
 */
class ImagesOfTextScanner extends BaseScanner {
  constructor() {
    super('images-of-text', {
      wcagCriteria: ['1.4.5', '1.4.9'],
      wcagPrinciple: 'perceivable',
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
      useOCR: options.useOCR || false,
      skipLogos: options.skipLogos !== false,
      skipDecorative: options.skipDecorative !== false,
    };

    const imageTextResults = await page.evaluate((options) => {
      const violations = [];
      let totalImages = 0;
      let suspectedTextImages = 0;
      let confirmedTextImages = 0;

      // Helper function to generate element selector
      function getElementSelector(element) {
        let selector = element.tagName.toLowerCase();
        if (element.id) selector += `#${element.id}`;
        if (element.className) selector += `.${element.className.split(' ').join('.')}`;
        return selector;
      }

      // Helper function to check if image might be decorative
      function isLikelyDecorative(img) {
        const alt = img.getAttribute('alt') || '';
        const src = img.src || '';
        const className = img.className || '';

        // Check for decorative indicators
        const decorativeKeywords = ['decoration', 'ornament', 'separator', 'spacer', 'bullet'];
        const isDecorative = decorativeKeywords.some(
          (keyword) =>
            alt.toLowerCase().includes(keyword) ||
            src.toLowerCase().includes(keyword) ||
            className.toLowerCase().includes(keyword)
        );

        // Empty alt attribute often indicates decorative image
        return isDecorative || alt === '';
      }

      // Helper function to check if image might be a logo
      function isLikelyLogo(img) {
        const alt = img.getAttribute('alt') || '';
        const src = img.src || '';
        const className = img.className || '';

        const logoKeywords = ['logo', 'brand', 'company'];
        return logoKeywords.some(
          (keyword) =>
            alt.toLowerCase().includes(keyword) ||
            src.toLowerCase().includes(keyword) ||
            className.toLowerCase().includes(keyword)
        );
      }

      // Helper function to detect potential text in images using heuristics
      function analyzeImageForText(img) {
        const alt = img.getAttribute('alt') || '';
        const src = img.src || '';
        const title = img.getAttribute('title') || '';

        // Heuristics for text detection (without actual OCR)
        const textIndicators = {
          // Alt text suggests text content
          hasTextualAlt: alt.length > 0 && !isLikelyDecorative(img) && !isLikelyLogo(img),

          // Filename suggests text content
          filenameIndicatesText: /\b(text|caption|heading|title|quote|message)\b/i.test(src),

          // Common text image patterns in filename
          commonTextPatterns:
            /\b(btn|button|banner|header|nav|menu)\b/i.test(src) &&
            !/\b(bg|background|decoration)\b/i.test(src),

          // Image dimensions suggest text (often wide and short)
          dimensionsSuggestText: false, // Will be calculated below
        };

        // Check image dimensions
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const aspectRatio = rect.width / rect.height;
          // Text images often have high aspect ratios (wider than tall)
          // or are small square buttons
          textIndicators.dimensionsSuggestText =
            aspectRatio > 2.5 || // Wide banners/headers
            (rect.width < 200 && rect.height < 200 && aspectRatio > 1.5); // Small buttons
        }

        return textIndicators;
      }

      // Helper function to provide suggestions based on violation type
      function getSuggestion(reason, element) {
        switch (reason) {
          case 'contains-text':
            return 'Replace image with HTML text using appropriate styling (CSS) to achieve the same visual effect';
          case 'essential-text':
            return 'If text presentation is essential, ensure sufficient contrast and provide alternative text';
          case 'customizable-text':
            return 'Allow users to customize text appearance or provide text alternatives';
          default:
            return 'Consider replacing with HTML text or providing comprehensive alternative text';
        }
      }

      // Find all images
      const images = document.querySelectorAll('img');

      images.forEach((img) => {
        totalImages++;

        // Skip if options indicate to skip certain types
        if (options.skipDecorative && isLikelyDecorative(img)) return;
        if (options.skipLogos && isLikelyLogo(img)) return;

        const textAnalysis = analyzeImageForText(img);

        // Calculate confidence score (0-100)
        let confidence = 0;
        let reasons = [];

        if (textAnalysis.hasTextualAlt) {
          confidence += 40;
          reasons.push('has descriptive alt text suggesting text content');
        }

        if (textAnalysis.filenameIndicatesText) {
          confidence += 25;
          reasons.push('filename suggests text content');
        }

        if (textAnalysis.commonTextPatterns) {
          confidence += 20;
          reasons.push('filename matches common text element patterns');
        }

        if (textAnalysis.dimensionsSuggestText) {
          confidence += 15;
          reasons.push('dimensions typical of text images');
        }

        // Additional checks for button-like elements
        const isInButton = img.closest('button, .btn, [role="button"]');
        if (isInButton) {
          confidence += 20;
          reasons.push('contained within button element');
        }

        // Check for text-like class names
        const className = img.className || '';
        if (/\b(text|caption|heading|title)\b/i.test(className)) {
          confidence += 15;
          reasons.push('class name suggests text content');
        }

        // If confidence is above threshold, consider it a suspected text image
        if (confidence > 60) {
          suspectedTextImages++;

          // Higher confidence means more likely to be confirmed
          if (confidence > 60) {
            confirmedTextImages++;
          }

          const alt = img.getAttribute('alt') || '';
          let reason = 'contains-text';

          // Determine specific reason
          if (isInButton || /button|btn/i.test(img.src)) {
            reason = 'essential-text'; // Button text might be considered essential
          } else if (confidence > 80) {
            reason = 'customizable-text'; // High confidence suggests customizable presentation
          }

          violations.push({
            element: getElementSelector(img),
            imageUrl: img.src,
            detectedText: alt || 'Text detected in image',
            confidence: Math.min(confidence, 100),
            reason: reason,
            suggestion: getSuggestion(reason, img),
          });
        }
      });

      // Check CSS background images - but only flag real problems
      // Text over background images is GOOD accessibility practice, not a violation
      // Only flag if there's evidence this is actually text rendered as an image
      const allElements = document.querySelectorAll('*');

      allElements.forEach((element) => {
        const computed = window.getComputedStyle(element);
        const bgImage = computed.backgroundImage;

        if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
          const hasTextContent = element.textContent.trim().length > 0;
          const rect = element.getBoundingClientRect();
          const imageUrl = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] || '';

          // Only flag if there are strong indicators this is text rendered as image
          let confidence = 0;
          let reasons = [];

          // Check if filename suggests text content (instead of decorative background)
          if (/\b(text|caption|heading|title|quote|message|logo-text)\b/i.test(imageUrl)) {
            confidence += 40;
            reasons.push('filename suggests text content');
          }

          // Check if element is very small (likely a text button/badge)
          if (rect.width < 150 && rect.height < 50 && hasTextContent && rect.width > 0) {
            confidence += 30;
            reasons.push('small element size suggests text image');
          }

          // Check if text content exactly matches common button/badge text
          const text = element.textContent.trim().toLowerCase();
          if (
            text.length < 20 &&
            /^(button|click|download|submit|login|signup|register)$/.test(text)
          ) {
            confidence += 25;
            reasons.push('text matches common button patterns');
          }

          // Only flag if confidence is high enough
          if (confidence > 60) {
            totalImages++;
            suspectedTextImages++;

            violations.push({
              element: getElementSelector(element),
              imageUrl: imageUrl,
              detectedText: element.textContent.trim().substring(0, 100),
              confidence: Math.min(confidence, 100),
              reason: 'contains-text',
              suggestion: 'Replace background image text with HTML text and CSS styling',
            });
          }
        }
      });

      return {
        violations,
        totalImages,
        suspectedTextImages,
        confirmedTextImages,
      };
    }, scanOptions);

    // Create report according to interface
    return {
      scannerId: this.id,
      criterion: '9.1.4.5',
      passed: imageTextResults.violations.length === 0,
      violations: imageTextResults.violations,
      summary: {
        totalImages: imageTextResults.totalImages,
        suspectedTextImages: imageTextResults.suspectedTextImages,
        confirmedTextImages: imageTextResults.confirmedTextImages,
      },
    };
  }
}

module.exports = ImagesOfTextScanner;
