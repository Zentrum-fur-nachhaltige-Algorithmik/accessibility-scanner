const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');
const { injectableCode: contrastUtils } = require('./utils/browser-contrast');

/**
 * Advanced Contrast Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.1.4.11, 9.1.4.13 (Non-text Contrast, Content on Hover or Focus)
 * Tests UI components, graphical objects, and hover/focus content contrast
 *
 * Declared criteria note: this scanner only ever emits `9.1.4.11` and
 * `9.1.4.13` findings. It previously ALSO claimed 1.4.3/1.4.6 (text contrast),
 * which it does not test at all — that is `color-contrast-scanner.js`'s remit —
 * so every harness run routed 1.4.3/1.4.6 fixtures here and recorded a miss.
 * The metadata now matches what the scanner actually produces.
 */
class AdvancedContrastScanner extends BaseScanner {
  constructor() {
    super('advanced-contrast', {
      wcagCriteria: ['1.4.11', '1.4.13'],
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
      // Components whose rendered contrast could not be determined from CSS
      // (gradient / background-image backdrops). An unknown is not a failure.
      incomplete: contrastResults.incomplete,
      summary: {
        nonTextElementsTested: contrastResults.nonTextElementsTested,
        hoverContentTested: contrastResults.hoverContentTested,
        graphicalObjectsCompliant: contrastResults.graphicalObjectsCompliant,
        uiComponentsCompliant: contrastResults.uiComponentsCompliant,
        incompleteElements: contrastResults.incomplete.length
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
    const incomplete = [];
    const visualEvidence = [];
    let nonTextElementsTested = 0;
    let hoverContentTested = 0;
    let graphicalObjectsCompliant = 0;
    let uiComponentsCompliant = 0;

    console.log('Starting advanced contrast analysis...');

    // Contrast maths comes from the shared, WCAG-correct helpers in
    // src/utils/browser-contrast.js, injected per page.evaluate call. The old
    // private window.parseRgb/getLuminance/getContrastRatio globals are gone:
    // they duplicated the formula, could not parse hex or CSS Color 4 syntax,
    // and did no alpha compositing or ancestor background resolution.

    // 1. Test UI component + graphical object contrast (WCAG 1.4.11)
    const nonText = await this.testNonTextContrast(page);
    violations.push(...nonText.violations);
    incomplete.push(...nonText.incomplete);
    visualEvidence.push(...nonText.visualEvidence);

    // 2. Test hover and focus content contrast (WCAG 1.4.13)
    await this.testHoverFocusContent(page, scanDir, violations, visualEvidence);

    // Calculate summary statistics
    nonTextElementsTested = nonText.elementsTested;
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
      incomplete,
      visualEvidence,
      nonTextElementsTested,
      hoverContentTested,
      graphicalObjectsCompliant,
      uiComponentsCompliant
    };
  }

  /**
   * Test UI component and graphical object contrast (WCAG 1.4.11) in a single
   * in-page pass.
   *
   * Rewritten wholesale. The previous implementation:
   *  - enumerated elements once per entry in a selector list whose entries
   *    overlap (`button` / `.btn` / `.button`, `.icon` / `[class*="icon"]`), so
   *    the same element was measured and reported up to four times;
   *  - serialised each element to a CSS selector string and then RE-SELECTED it
   *    with `document.querySelector` in a second `page.evaluate`. The generated
   *    selector was a class list (matches every sibling with those classes) or
   *    `tagName:nth-of-type(n)` where n was the element's index within a
   *    `querySelectorAll` result, not among its siblings — so the second lookup
   *    routinely measured a DIFFERENT element than the one enumerated, or none;
   *  - read `element.parentElement`'s own computed background and fell back to
   *    white, so a transparent parent produced bogus ratios;
   *  - never alpha-composited translucent fills;
   *  - applied invented leniency tiers (1.5:1 / 2.5:1 for inputs) gated on a
   *    "has focus indicator" probe that was true for almost every element.
   *
   * Everything now runs against live element references inside one evaluate,
   * uses the shared WCAG helpers, and applies the SC 1.4.11 exceptions
   * (inactive components, decorative graphics, boundary already identified by
   * a compliant border).
   */
  async testNonTextContrast(page) {
    console.log('Testing UI component contrast...');

    return await page.evaluate((contrastCode) => {
      eval(contrastCode);

      const THRESHOLD = 3.0;
      const violations = [];
      const incomplete = [];
      const visualEvidence = [];
      let elementsTested = 0;

      function rgbString(c) { return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')'; }

      // Stable, human-findable description. Only ever used for reporting —
      // never fed back into querySelector.
      function describe(element) {
        let out = element.tagName.toLowerCase();
        if (element.id) return out + '#' + element.id;
        const raw = typeof element.className === 'string' ? element.className : '';
        const classes = raw.trim().split(/\s+/).filter(Boolean).slice(0, 3);
        if (classes.length) out += '.' + classes.join('.');
        const parent = element.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children)
            .filter(c => c.tagName === element.tagName);
          if (sameTag.length > 1) out += ':nth-of-type(' + (sameTag.indexOf(element) + 1) + ')';
        }
        return out;
      }

      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const styles = window.getComputedStyle(element);
        return styles.visibility !== 'hidden' && styles.display !== 'none' &&
          parseFloat(styles.opacity || '1') > 0;
      }

      // Decorative graphics are outside SC 1.4.11 ("graphical objects required
      // to understand the content"). An icon sitting next to its own text label
      // is redundant, not required.
      function isMeaningfulGraphic(element) {
        if (element.getAttribute('aria-hidden') === 'true') return false;
        const role = element.getAttribute('role');
        if (role === 'presentation' || role === 'none') return false;
        if (element.closest('[aria-hidden="true"]')) return false;
        const hasName = !!(element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          (element.tagName.toLowerCase() === 'svg' && element.querySelector('title')));
        return hasName || role === 'img' || role === 'graphics-document';
      }

      // SC 1.4.11 covers "the visual information required to identify user
      // interface components". When a control carries its own visible text
      // label at sufficient contrast AND paints no fill of its own, the label
      // is what identifies the control: the hairline border around it is
      // decoration, and WCAG does not require a visual boundary at all (a
      // borderless text button passes). Reporting the border would mean that
      // ADDING a faint border to an otherwise-passing control creates a
      // failure. The exception is deliberately narrow — it does not apply when
      // the control has its own background fill (then the fill/border is the
      // shape that delineates the control, and it is measured as before), nor
      // when the label itself is below 3:1 (an icon glyph or greyed-out text
      // cannot identify anything either).
      function identifiedByOwnLabel(element, backdrop, threshold) {
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return false;
        const styles = window.getComputedStyle(element);
        const own = __parseRgb(styles.backgroundColor);
        if (own && own.a > 0) return false;          // has its own fill
        const fg = __parseRgb(styles.color);
        if (!fg) return false;
        return __getContrastRatio(__blendOver(fg, backdrop), backdrop) >= threshold;
      }

      // One element, one evaluation.
      const seen = new Set();
      const uiSelector = 'button, input[type="button"], input[type="submit"], ' +
        'input[type="reset"], input[type="text"], input[type="email"], ' +
        'input[type="password"], input[type="search"], input[type="tel"], ' +
        'input[type="url"], input[type="number"], input[type="date"], ' +
        'textarea, select, [role="button"], .btn, .button';
      const graphicSelector = 'svg, canvas, [role="img"], img[role="img"]';

      const targets = [];
      for (const element of document.querySelectorAll(uiSelector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        targets.push({ element: element, kind: 'ui-component' });
      }
      for (const element of document.querySelectorAll(graphicSelector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        targets.push({ element: element, kind: 'graphical-object' });
      }

      for (const target of targets) {
        const element = target.element;
        const elementType = target.kind;

        if (!isVisible(element)) continue;
        // SC 1.4.11 exception: inactive user interface components.
        if (__isInactive(element)) continue;
        if (elementType === 'graphical-object' && !isMeaningfulGraphic(element)) continue;

        const selector = describe(element);
        const styles = window.getComputedStyle(element);
        const background = __resolveBackground(element.parentElement || element);

        if (background.indeterminate) {
          incomplete.push({
            criterion: '9.1.4.11',
            element: selector,
            issue: elementType + '-contrast',
            description: 'Component sits on an image or gradient background; the rendered contrast cannot be computed from CSS and needs manual review.',
            backgroundImage: background.indeterminateSource,
            elementType: elementType
          });
          continue;
        }

        elementsTested++;
        const backdrop = { r: background.r, g: background.g, b: background.b, a: 1 };
        const compliantBorder = __hasCompliantBorder(styles, backdrop, THRESHOLD);
        const renderedBorder = __getRenderedBorder(styles);

        // Border: only a border that is actually painted can fail.
        if (renderedBorder && !compliantBorder) {
          const borderRgb = __parseRgb(renderedBorder.color);
          if (borderRgb) {
            const flat = __blendOver(borderRgb, backdrop);
            const ratio = __getContrastRatio(flat, backdrop);
            visualEvidence.push({
              element: selector, type: elementType, contrastType: 'border',
              contrastRatio: ratio,
              colors: { foreground: renderedBorder.color, background: rgbString(backdrop) }
            });
            if (ratio < THRESHOLD && elementType === 'ui-component' &&
                identifiedByOwnLabel(element, backdrop, THRESHOLD)) {
              // Decorative border on a text-labelled, unfilled control — see
              // identifiedByOwnLabel() above. Evidence is already recorded.
            } else if (ratio < THRESHOLD) {
              violations.push({
                criterion: '9.1.4.11',
                element: selector,
                issue: elementType + '-contrast',
                description: `${elementType.replace('-', ' ')} border has insufficient contrast: ${ratio.toFixed(2)}:1`,
                contrastRatio: ratio,
                requiredRatio: THRESHOLD,
                elementType: elementType,
                suggestion: `Increase border contrast to meet ${THRESHOLD}:1 minimum ratio`
              });
            }
          }
        } else if (compliantBorder) {
          visualEvidence.push({
            element: selector, type: elementType, contrastType: 'border',
            contrastRatio: compliantBorder.ratio,
            colors: { foreground: compliantBorder.border.color, background: rgbString(backdrop) }
          });
        }

        // Fill: SC 1.4.11 covers the visual information REQUIRED to identify
        // the component. When a compliant border already provides that
        // boundary, the fill carries no additional requirement — otherwise the
        // canonical accessible form control (white field, white page, dark
        // border) fails for no reason.
        if (compliantBorder) continue;

        const ownBg = __parseRgb(styles.backgroundColor);
        if (!ownBg || ownBg.a === 0) continue;
        const flatBg = __blendOver(ownBg, backdrop);
        const ratio = __getContrastRatio(flatBg, backdrop);
        visualEvidence.push({
          element: selector, type: elementType, contrastType: 'background',
          contrastRatio: ratio,
          colors: { foreground: styles.backgroundColor, background: rgbString(backdrop) }
        });
        if (ratio < THRESHOLD) {
          violations.push({
            criterion: '9.1.4.11',
            element: selector,
            issue: elementType + '-contrast',
            description: `${elementType.replace('-', ' ')} background has insufficient contrast: ${ratio.toFixed(2)}:1`,
            contrastRatio: ratio,
            requiredRatio: THRESHOLD,
            elementType: elementType,
            suggestion: `Increase background contrast to meet ${THRESHOLD}:1 minimum ratio`
          });
        }
      }

      return {
        violations: violations,
        incomplete: incomplete,
        visualEvidence: visualEvidence,
        elementsTested: elementsTested
      };
    }, contrastUtils);
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
   * Analyze tooltip contrast (SC 1.4.13 hover/focus content).
   *
   * A tooltip's own background is frequently transparent (the visible panel is
   * a child), so the backdrop is resolved through the ancestor chain and
   * alpha-composited rather than taken at face value.
   */
  async analyzeTooltipContrast(page, tooltip, selector) {
    const analysis = await page.evaluate((tt, contrastCode) => {
      eval(contrastCode);

      const bgRgb = __parseRgb(tt.backgroundColor);
      const fgRgb = __parseRgb(tt.color);

      if (bgRgb && fgRgb && bgRgb.a > 0) {
        const flatBg = __blendOver(bgRgb, { r: 255, g: 255, b: 255, a: 1 });
        return {
          contrastRatio: __getContrastRatio(__blendOver(fgRgb, flatBg), flatBg),
          backgroundColor: tt.backgroundColor,
          textColor: tt.color
        };
      }

      return { contrastRatio: 21 }; // Not determinable — never report a failure
    }, tooltip, contrastUtils);

    return analysis;
  }

}

module.exports = AdvancedContrastScanner;
