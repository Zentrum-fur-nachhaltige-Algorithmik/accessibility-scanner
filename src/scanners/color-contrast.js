/**
 * Color Contrast Scanner.
 * WCAG 1.4.6 Contrast (Enhanced) (EN 301 549 9.1.4.6).
 * SC 1.4.3 is axe-core's: its `color-contrast` rule (cat.color, wcag2aa, wcag143) runs in
 * every profile of src/scanners/axe-core.js. Its AAA companion `color-contrast-enhanced`
 * (wcag2aaa) does not, so the enhanced thresholds are measured here, and only for a scan
 * that asks for AAA.
 * All colour maths comes from the shared helpers in src/utils/browser-contrast.js
 * (relative luminance, alpha compositing, ancestor background resolution).
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: contrastUtils } = require('../utils/browser-contrast');

class ColorContrastScanner extends BaseScanner {
  constructor() {
    super('color-contrast', {
      wcagCriteria: ['1.4.6'],
      wcagPrinciple: 'perceivable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @param {string} [options.wcagLevel] - 'AAA' enables the enhanced-contrast measurement
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const emptyResult = {
      scannerId: this.id,
      criterion: '9.1.4.6',
      passed: true,
      violations: [],
      incomplete: [],
      summary: {
        totalElements: 0,
        failedElements: 0,
        passedElements: 0,
        exemptElements: 0,
        incompleteElements: 0,
        minimumRatio: 7,
        evaluated: false,
      },
    };

    // An AA audit has no enhanced-contrast requirement, and reporting 7:1
    // failures beside axe-core's 4.5:1 ones would report the same text twice.
    if (options.wcagLevel !== 'AAA') return emptyResult;

    const scanOptions = {
      ignoreTransparent: options.ignoreTransparent !== false,
    };

    const contrastResults = await page.evaluate(
      (options, contrastCode) => {
        // Inject the shared WCAG contrast helpers (__parseRgb, __getLuminance,
        // __getContrastRatio, __blendOver, __resolveBackground, __isInactive,
        // __isLargeText, ...).
        eval(contrastCode);

        function rgbString(c) {
          return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
        }

        // Get all text elements
        const textElements = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);

        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (
            parent &&
            node.textContent.trim() &&
            window.getComputedStyle(parent).display !== 'none' &&
            window.getComputedStyle(parent).visibility !== 'hidden'
          ) {
            textElements.push(parent);
          }
        }

        // Remove duplicates and get unique elements
        const uniqueElements = [...new Set(textElements)];

        const violations = [];
        const incomplete = [];
        let totalElements = 0;
        let passedElements = 0;
        let failedElements = 0;
        let exemptElements = 0;

        // SC 1.4.6: 7:1, and 4.5:1 for large text.
        const requiredRatio = 7;
        const requiredRatioLarge = 4.5;

        function describe(element) {
          let selector = element.tagName.toLowerCase();
          if (element.id) selector += `#${element.id}`;
          if (element.className && typeof element.className === 'string') {
            const cls = element.className.trim().split(/\s+/).filter(Boolean);
            if (cls.length) selector += `.${cls.join('.')}`;
          }
          return selector;
        }

        uniqueElements.forEach((element) => {
          try {
            const computed = window.getComputedStyle(element);
            const foregroundColor = computed.getPropertyValue('color');

            // SC 1.4.6 exception "Incidental": text that is part of an INACTIVE
            // user interface component has no contrast requirement. A disabled
            // button rendered in grey-on-grey is the intended affordance, not a
            // defect.
            if (__isInactive(element)) {
              exemptElements++;
              return;
            }

            const background = __resolveBackground(element);
            const fgRgb = __parseRgb(foregroundColor);
            if (!fgRgb) return;

            // A gradient or background-image behind the text means the rendered
            // backdrop cannot be derived from the CSSOM. Report it as needing
            // review instead of guessing a backdrop.
            if (background.indeterminate) {
              incomplete.push({
                element: describe(element),
                reason: 'indeterminate-background',
                description:
                  'Background is painted by an image or gradient; the rendered contrast cannot be computed from CSS and needs manual review.',
                foregroundColor: foregroundColor,
                backgroundImage: background.indeterminateSource,
                requiredRatio: __isLargeText(computed) ? requiredRatioLarge : requiredRatio,
              });
              return;
            }

            // Fully transparent text paints nothing: there is no contrast to
            // measure and no text to read, so 1.4.6 does not apply.
            // Semi-transparent text is still measured; __blendOver() below
            // composites the alpha onto the backdrop.
            if (options.ignoreTransparent && fgRgb.a === 0) return;

            const bgRgb = { r: background.r, g: background.g, b: background.b, a: 1 };
            const fgFlat = __blendOver(fgRgb, bgRgb);

            totalElements++;

            // Rounded to the two decimals the report shows, so a ratio of
            // 6.9996 is not reported as "7:1 is below 7:1".
            const contrastRatio = Math.round(__getContrastRatio(fgFlat, bgRgb) * 100) / 100;
            const largeText = __isLargeText(computed);
            const minimumRatio = largeText ? requiredRatioLarge : requiredRatio;

            if (contrastRatio < minimumRatio) {
              failedElements++;

              // Generate suggestions
              const suggestedForeground = bgRgb.r + bgRgb.g + bgRgb.b > 384 ? '#000000' : '#ffffff';

              // `type` identifies the rule everywhere downstream
              // (report grouping, the golden-corpus harness, severity.ruleKey()).
              violations.push({
                type: 'insufficient-enhanced-text-contrast',
                category: 'contrast',
                severity: 'serious',
                wcagCriteria: '1.4.6',
                description: `Text contrast ${contrastRatio}:1 is below the enhanced ${minimumRatio}:1`,
                impact: 'Users with low vision cannot read this text',
                recommendation: `Use ${suggestedForeground} for the text, or darken/lighten the background, to reach ${minimumRatio}:1`,
                element: describe(element),
                currentRatio: contrastRatio,
                requiredRatio: minimumRatio,
                foregroundColor: foregroundColor,
                backgroundColor: rgbString(bgRgb),
                isLargeText: largeText,
                suggestedForeground: suggestedForeground,
              });
            } else {
              passedElements++;
            }
          } catch (e) {
            // A single unreadable element is not evidence of a contrast defect.
          }
        });

        return {
          totalElements,
          passedElements,
          failedElements,
          exemptElements,
          violations,
          incomplete,
          minimumRatio: requiredRatio,
        };
      },
      scanOptions,
      contrastUtils
    );

    // Create report according to interface
    return {
      scannerId: this.id,
      criterion: '9.1.4.6',
      passed: contrastResults.violations.length === 0,
      violations: contrastResults.violations,
      // Elements whose rendered background could not be determined from CSS
      // (gradients/background images). Not violations: an unknown is a
      // question for a reviewer, carried with what was measured.
      needsReview: contrastResults.incomplete.map((item) =>
        this.formatViolation(
          'text-contrast-indeterminate-background',
          'moderate',
          item.description,
          [{ selector: item.element }],
          'https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html',
          'info',
          {
            verdict: 'needs-review',
            dossier: {
              question: `Does the text in ${item.element} reach ${item.requiredRatio}:1 against the image or gradient it is painted on (WCAG 1.4.6)?`,
              element: { selector: item.element, html: null, role: null, name: null },
              measurements: {
                foregroundColor: item.foregroundColor,
                requiredRatio: item.requiredRatio,
              },
              context: { backgroundImage: item.backgroundImage },
            },
          }
        )
      ),
      summary: {
        totalElements: contrastResults.totalElements,
        failedElements: contrastResults.failedElements,
        passedElements: contrastResults.passedElements,
        exemptElements: contrastResults.exemptElements,
        incompleteElements: contrastResults.incomplete.length,
        minimumRatio: contrastResults.minimumRatio,
        evaluated: true,
      },
    };
  }
}

module.exports = ColorContrastScanner;
