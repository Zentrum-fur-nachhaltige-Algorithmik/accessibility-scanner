/**
 * Text Resize Scanner.
 * WCAG 1.4.4 (EN 301 549 9.1.4.4).
 * Emulates 200% and 400% zoom by shrinking the viewport and measures
 * horizontal overflow, clipped text and covered interactive elements.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: clipCode } = require('../utils/text-clipping');

class TextResizeScanner extends BaseScanner {
  constructor() {
    super('text-resize', {
      wcagCriteria: ['1.4.4'],
      wcagPrinciple: 'perceivable',
    });
    // Browser zoom Z% on a 1280px window is a viewport of 1280/Z CSS px.
    // WCAG 1.4.10 sets the floor at 320 CSS px (= 400% of 1280); there is
    // no requirement to reflow below that.
    this.testViewports = [
      { width: 1280, height: 1024, name: 'desktop', scale: 1 },
      { width: 640, height: 512, name: 'desktop-200%', scale: 2 },
      { width: 320, height: 256, name: 'desktop-400%', scale: 4 },
      { width: 375, height: 667, name: 'mobile', scale: 1 },
    ];
  }

  /**
   * This scanner modifies viewport, so it needs exclusive access.
   */
  get needsExclusiveAccess() {
    return true;
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * Loops through multiple viewports using the provided page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      testZoomLevels: [200, 400],
      checkMobile: true,
      detectFixedElements: true,
      analyzeTextFlow: true,
      timeout: TIMEOUTS.scanner,
    };

    const scanOptions = { ...defaultOptions, ...options };
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const violations = [];
    const viewportResults = {};

    // Get the current URL from the page for reloads after viewport changes
    const currentUrl = page.url();

    // Test each viewport for zoom compliance using the provided page
    for (const viewport of scanOptions.viewports || this.testViewports) {
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale,
      });

      // Reload so the page renders at the new viewport
      await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

      const result = await this.analyzeTextResizeCompliance(page, viewport, scanDir);
      viewportResults[viewport.name] = result;

      if (result.violations.length > 0) {
        violations.push(
          ...result.violations.map((v) => ({
            ...v,
            viewport: viewport.name,
            zoomLevel: viewport.scale === 1 ? '100%' : `${viewport.scale * 100}%`,
          }))
        );
      }
    }

    // Additional CSS analysis using the provided page (reset to desktop viewport)
    await page.setViewport({ width: 1280, height: 1024, deviceScaleFactor: 1 });
    await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });
    const cssViolations = await this._analyzeCSSFromPage(page);
    violations.push(...cssViolations);

    const finalViolations = this.groupBlockingByOverlay(
      this.deduplicateAcrossViewports(
        this.filterZoomInducedBlocking(violations, scanOptions.viewports || this.testViewports)
      )
    );

    return {
      scannerId: this.id,
      criteria: ['1.4.4'],
      passed: finalViolations.length === 0,
      violations: finalViolations,
      summary: {
        totalViewportsTested: this.testViewports.length,
        zoomLevelsSupported: this.calculateZoomSupport(viewportResults),
        horizontalScrollIssues: finalViolations.filter((v) => v.type === 'horizontal-scroll')
          .length,
        fixedElementIssues: finalViolations.filter((v) => v.type === 'fixed-size').length,
        textFlowIssues: finalViolations.filter((v) => v.type === 'text-overflow').length,
      },
      viewportResults: viewportResults,
      screenshotPath: scanDir,
      recommendations: this.generateTextResizeRecommendations(finalViolations),
    };
  }

  /**
   * `interaction-blocked` claims a resize/reflow failure (1.4.4 / 1.4.10), so
   * it may only report overlaps that the *narrow* viewport creates. An
   * element that is covered at the wide desktop reference viewport as well is
   * a permanent layering problem (2.4.11 territory, checked by
   * focus-management-scanner) and is not blamed on zoom here.
   */
  filterZoomInducedBlocking(violations, viewports) {
    const isReference = (v) => v.scale === 1 && v.width >= 1024;
    const referenceNames = new Set(viewports.filter(isReference).map((v) => v.name));
    const reflowNames = new Set(viewports.filter((v) => !isReference(v)).map((v) => v.name));
    const baselineKeys = new Set(
      violations
        .filter((v) => v.type === 'interaction-blocked' && referenceNames.has(v.viewport))
        .map((v) => v.blockedKey)
    );
    return violations.filter((v) => {
      if (v.type !== 'interaction-blocked') return true;
      if (!reflowNames.has(v.viewport)) return false;
      return !baselineKeys.has(v.blockedKey);
    });
  }

  /**
   * One overlay = one defect. A fixed/sticky bar that covers the footer's legal
   * links covers *every* link in that row; reporting each of them separately
   * multiplies a single layout bug. The covering element becomes the reported
   * element, the covered ones are listed in `details.blockedElements`.
   */
  groupBlockingByOverlay(violations) {
    const map = new Map();
    const rest = [];
    for (const v of violations) {
      if (v.type !== 'interaction-blocked') {
        rest.push(v);
        continue;
      }
      const overlay = (v.details && v.details.coveredBy) || 'unknown';
      if (map.has(overlay)) {
        const g = map.get(overlay);
        g.details.blockedElements.push(v.element);
        for (const vp of v.affectedViewports || []) {
          if (!g.affectedViewports.includes(vp)) g.affectedViewports.push(vp);
        }
        continue;
      }
      map.set(overlay, {
        ...v,
        element: overlay,
        description: `${overlay} covers interactive content at reduced viewport widths`,
        details: { ...v.details, blockedElements: [v.element] },
        affectedViewports: [...(v.affectedViewports || [])],
      });
    }
    for (const g of map.values()) {
      g.description = `${g.element} covers ${g.details.blockedElements.length} interactive element(s) at reduced viewport widths`;
    }
    return [...rest, ...map.values()];
  }

  /**
   * One finding per (type, element) across the tested viewports. The same
   * clipped container measured at 200% and at 400% is one defect, not two;
   * the viewports it was observed at are kept in `affectedViewports`.
   */
  deduplicateAcrossViewports(violations) {
    const map = new Map();
    for (const v of violations) {
      // blockedKey disambiguates elements whose selector is just a tag name
      const key = `${v.type}::${v.blockedKey || v.element || v.selector || ''}`;
      if (map.has(key)) {
        const existing = map.get(key);
        if (v.viewport && !existing.affectedViewports.includes(v.viewport)) {
          existing.affectedViewports.push(v.viewport);
        }
        continue;
      }
      map.set(key, { ...v, affectedViewports: v.viewport ? [v.viewport] : [] });
    }
    return [...map.values()];
  }

  /**
   * Analyze CSS for text resize issues using an already-loaded page.
   * @private
   */
  async _analyzeCSSFromPage(page) {
    const violations = [];

    const cssAnalysis = await page.evaluate(() => {
      const issues = [];
      const sheets = Array.from(document.styleSheets);

      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules || sheet.rules || []);

          for (const rule of rules) {
            if (rule.style) {
              const selector = rule.selectorText;
              const styles = rule.style;

              if (
                styles.fontSize &&
                styles.fontSize.endsWith('px') &&
                parseInt(styles.fontSize) < 12
              ) {
                issues.push({
                  type: 'small-fixed-font',
                  selector,
                  property: 'font-size',
                  value: styles.fontSize,
                  severity: 'info',
                });
              }
              // The following four are CSS *smells*, not failures:
              // a px width/min-width/max-width or an overflow:hidden
              // box only violates 1.4.4/1.4.10 if it actually clips
              // content or forces horizontal scrolling, and that is
              // measured per viewport (horizontal-scroll, text-overflow,
              // fixed-size). A rule like `.card { width: 900px }` inside
              // a `@media (min-width: 1200px)` block reflows perfectly.
              // Reported as `info` so they stay visible as hints without
              // counting as violations.
              if (styles.width && styles.width.endsWith('px')) {
                const width = parseInt(styles.width);
                if (width > 800) {
                  issues.push({
                    type: 'fixed-width',
                    selector,
                    property: 'width',
                    value: styles.width,
                    severity: 'info',
                  });
                }
              }
              if (styles.minWidth && styles.minWidth.endsWith('px')) {
                const minWidth = parseInt(styles.minWidth);
                if (minWidth > 600) {
                  issues.push({
                    type: 'fixed-min-width',
                    selector,
                    property: 'min-width',
                    value: styles.minWidth,
                    severity: 'info',
                  });
                }
              }
              if (styles.maxWidth && styles.maxWidth.endsWith('px')) {
                const maxWidth = parseInt(styles.maxWidth);
                if (maxWidth < 320) {
                  issues.push({
                    type: 'restrictive-max-width',
                    selector,
                    property: 'max-width',
                    value: styles.maxWidth,
                    severity: 'info',
                  });
                }
              }
              if (
                styles.overflow === 'hidden' &&
                (styles.width?.endsWith('px') || styles.height?.endsWith('px'))
              ) {
                issues.push({
                  type: 'overflow-hidden-fixed',
                  selector,
                  properties: {
                    overflow: styles.overflow,
                    width: styles.width,
                    height: styles.height,
                  },
                  severity: 'info',
                });
              }
            }
          }
        } catch (e) {
          // Skip stylesheets that can't be accessed (CORS)
        }
      }

      return issues;
    });

    for (const issue of cssAnalysis) {
      violations.push({
        type: issue.type,
        severity: issue.severity,
        description: this.getCSSIssueDescription(issue.type),
        selector: issue.selector,
        details: issue.properties || { [issue.property]: issue.value },
        wcagCriteria: '1.4.4',
        impact: this.getCSSIssueImpact(issue.type),
        recommendation: this.getCSSRecommendation(issue.type),
      });
    }

    return violations;
  }

  /**
   * Analyze text resize compliance for a specific viewport
   */
  async analyzeTextResizeCompliance(page, viewport, scanDir) {
    const violations = [];

    // Take screenshot for visual analysis
    const screenshotPath = path.join(scanDir, `${viewport.name}.png`);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    // Check for horizontal scrolling
    const scrollInfo = await page.evaluate(() => {
      return {
        // 1px tolerance: sub-pixel rounding must not count as overflow
        hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        bodyWidth: document.body ? document.body.scrollWidth : 0,
      };
    });

    if (scrollInfo.hasHorizontalScroll && viewport.scale >= 2) {
      violations.push({
        type: 'horizontal-scroll',
        severity: 'serious',
        description: `Horizontal scrolling required at ${viewport.scale * 100}% zoom (${scrollInfo.viewportWidth}px viewport)`,
        details: {
          viewportWidth: scrollInfo.viewportWidth,
          contentWidth: scrollInfo.scrollWidth,
          overflow: scrollInfo.scrollWidth - scrollInfo.viewportWidth,
        },
        wcagCriteria: '1.4.10',
        impact: 'Users cannot access content without horizontal scrolling',
      });
    }

    // Analyze fixed-size elements
    const fixedElements = await page.evaluate(() => {
      const elements = [];
      const allElements = document.querySelectorAll('*');

      for (const el of allElements) {
        const styles = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        // Skip sr-only / visually-hidden elements
        const cls = el.className || '';
        if (typeof cls === 'string' && (/\bsr-only\b/.test(cls) || /\bvisually-hidden\b/.test(cls)))
          continue;

        // Skip elements using responsive layout
        const maxW = styles.maxWidth;
        const isResponsiveMaxWidth =
          maxW && (maxW.endsWith('%') || maxW.endsWith('vw') || maxW === '100%');
        if (isResponsiveMaxWidth) continue;

        // Only flag elements with an EXPLICITLY set fixed width (inline style or CSS rule).
        // getComputedStyle().width always returns px, even for block elements flowing naturally.
        // Check if width is explicitly set by looking at inline style and whether the element
        // fills its parent (natural block flow = not fixed).
        const hasInlineWidth = el.style.width && el.style.width.endsWith('px');
        const hasInlineMinWidth = el.style.minWidth && el.style.minWidth.endsWith('px');
        const parentWidth = el.parentElement
          ? el.parentElement.getBoundingClientRect().width
          : rect.width;
        // Element fills parent = natural flow, not fixed width
        const fillsParent = Math.abs(rect.width - parentWidth) < 2;
        const isBlockDisplay =
          styles.display === 'block' ||
          styles.display === 'flex' ||
          styles.display === 'grid' ||
          styles.display === 'table' ||
          styles.display === 'list-item' ||
          styles.display === 'inline-flex' ||
          styles.display === 'inline-grid';
        const isNaturalFlow = fillsParent && isBlockDisplay && !hasInlineWidth;
        if (isNaturalFlow) continue;

        const parentStyles = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
        const isFlexGridChild =
          parentStyles &&
          (parentStyles.display === 'flex' ||
            parentStyles.display === 'grid' ||
            parentStyles.display === 'inline-flex' ||
            parentStyles.display === 'inline-grid');
        if (isFlexGridChild) continue;

        // Check for problematic fixed sizes: only width from inline style or non-flowing layout
        const widthIssue = hasInlineWidth && parseInt(el.style.width) > 400;
        const minWidthIssue = hasInlineMinWidth && parseInt(el.style.minWidth) > 400;
        const maxWidthTooSmall =
          styles.maxWidth && styles.maxWidth.endsWith('px') && parseInt(styles.maxWidth) < 200;
        if (widthIssue || minWidthIssue || maxWidthTooSmall) {
          elements.push({
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            width: styles.width,
            minWidth: styles.minWidth,
            maxWidth: styles.maxWidth,
            rect: {
              width: rect.width,
              height: rect.height,
              x: rect.x,
              y: rect.y,
            },
            overflowX: styles.overflowX,
            position: styles.position,
          });
        }
      }

      return elements;
    });

    for (const el of fixedElements) {
      violations.push({
        type: 'fixed-size',
        severity: 'serious',
        description: `Element with fixed size that may not scale properly`,
        element: `${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ')[0] : ''}`,
        details: {
          width: el.width,
          minWidth: el.minWidth,
          maxWidth: el.maxWidth,
          computedWidth: el.rect.width,
          overflowX: el.overflowX,
        },
        wcagCriteria: '1.4.4',
        impact: 'Element may not resize properly at zoom levels',
      });
    }

    // Text that is provably clipped away at this viewport.
    //
    // WCAG 1.4.4 / 1.4.10 are about loss of information, so the painted
    // glyph boxes (Range.getClientRects) are measured against the container's
    // padding box instead of comparing scrollWidth/clientWidth, which fires
    // on containers whose child box sticks out by a few rounded pixels while
    // all text stays inside (see src/utils/text-clipping.js).
    const clippedText = await page.evaluate(
      (renderedCode, clipCode) => {
        eval(renderedCode);
        eval(clipCode);
        return window.__findClippedText({ minChars: 3 });
      },
      renderedCode,
      clipCode
    );

    for (const issue of clippedText) {
      violations.push({
        type: 'text-overflow',
        // Declared truncation (line-clamp / ellipsis) looks identical at every
        // zoom level and keeps the text in the accessibility tree: a hint,
        // not a 1.4.4/1.4.10 failure.
        severity: issue.truncationDeclared ? 'info' : 'serious',
        description: issue.truncationDeclared
          ? `Text is visually truncated (${issue.lineClamp !== 'none' ? 'line-clamp' : 'ellipsis'}); full text remains in the DOM`
          : `Text is cut off (${issue.axis}) by an unscrollable overflow:hidden container at this viewport`,
        element: issue.selector,
        details: {
          truncationDeclared: issue.truncationDeclared,
          lineClamp: issue.lineClamp,
          axis: issue.axis,
          overshootX: issue.overshootX,
          overshootY: issue.overshootY,
          clippedCharacters: issue.clippedChars,
          clippedTextSamples: issue.samples,
          scrollWidth: issue.scrollWidth,
          clientWidth: issue.clientWidth,
          scrollHeight: issue.scrollHeight,
          clientHeight: issue.clientHeight,
          height: issue.height,
          overflow: issue.overflow,
          whiteSpace: issue.whiteSpace,
        },
        // Clipping that only appears once the viewport is reduced to the
        // reflow floor is a 1.4.10 failure; at the base viewport it is a
        // 1.4.4 (text does not fit its container) failure.
        wcagCriteria: viewport.scale >= 2 ? '1.4.10' : '1.4.4',
        impact: 'Text content is cut off and cannot be revealed by scrolling',
      });
    }

    // Interactive elements that are rendered and keyboard-reachable but
    // whose centre is covered by another element at this zoom level.
    // Elements that are display:none (responsive nav behind a hamburger),
    // off-canvas, or simply scrolled out of view are not blocked.
    const interactionIssues = await page.evaluate((renderedCode) => {
      eval(renderedCode);
      const issues = [];
      const prevX = window.scrollX,
        prevY = window.scrollY;
      // `scroll-behavior: smooth` would animate scrollIntoView and the
      // measurement would run before the scroll happened.
      const noSmooth = document.createElement('style');
      noSmooth.textContent = 'html, body { scroll-behavior: auto !important; }';
      document.head.appendChild(noSmooth);
      const candidates = [
        ...document.querySelectorAll(
          'a, button, input, select, textarea, [tabindex], [role="button"], [role="link"]'
        ),
      ]
        .filter((el) => __isFocusableRendered(el))
        .slice(0, 200);
      for (const el of candidates) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        // Probe the real centre. Clamping it to the viewport edge would test
        // a point that belongs to some other element and report anything
        // that cannot be scrolled fully into view as blocked.
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit.contains(el)) continue;
        // A label wrapping its control, or the control's own label, is fine.
        if (
          hit.closest('label') &&
          (hit.closest('label').control === el || hit.closest('label').contains(el))
        )
          continue;
        const hitStyle = window.getComputedStyle(hit);
        if (hitStyle.pointerEvents === 'none') continue;
        issues.push({
          tagName: el.tagName.toLowerCase(),
          type: el.type || null,
          id: el.id || null,
          className: typeof el.className === 'string' ? el.className : null,
          // Stable identity across reloads (the page is re-navigated per
          // viewport, so DOM node identity cannot be used).
          key: [
            el.tagName.toLowerCase(),
            el.id || '',
            typeof el.className === 'string' ? el.className : '',
            (el.textContent || '').trim().slice(0, 40),
          ].join('|'),
          text: (el.textContent || '').trim().slice(0, 60),
          rect: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
          coveredBy:
            hit.tagName.toLowerCase() +
            (hit.id ? '#' + hit.id : '') +
            (typeof hit.className === 'string' && hit.className.trim()
              ? '.' + hit.className.trim().split(/\s+/)[0]
              : ''),
        });
      }
      noSmooth.remove();
      window.scrollTo(prevX, prevY);
      return issues;
    }, renderedCode);

    for (const issue of interactionIssues) {
      violations.push({
        type: 'interaction-blocked',
        blockedKey: issue.key,
        severity: 'serious',
        description: `Interactive element is covered by ${issue.coveredBy} at this zoom level`,
        element:
          `${issue.tagName}${issue.type ? `[type="${issue.type}"]` : ''}${issue.id ? '#' + issue.id : ''}` +
          `${issue.className ? '.' + issue.className.trim().split(/\s+/)[0] : ''}` +
          `${issue.text ? ` ("${issue.text}")` : ''}`,
        details: {
          text: issue.text,
          elementSize: `${Math.round(issue.rect.width)}x${Math.round(issue.rect.height)}`,
          position: `${Math.round(issue.rect.x)}, ${Math.round(issue.rect.y)}`,
          coveredBy: issue.coveredBy,
        },
        wcagCriteria: '1.4.10',
        impact: 'User cannot interact with this element at zoom level',
      });
    }

    return {
      viewport: viewport.name,
      zoomLevel: viewport.scale,
      violations: violations,
      screenshotPath: screenshotPath,
      scrollInfo: scrollInfo,
      summary: {
        horizontalScrollRequired: scrollInfo.hasHorizontalScroll,
        fixedElementsFound: fixedElements.length,
        textOverflowIssues: clippedText.length,
        interactionIssues: interactionIssues.length,
      },
    };
  }

  /**
   * Analyze CSS for text resize compliance issues
   */
  async analyzeCSSForTextResizeIssues(url, options) {
    const violations = [];
    const page = await this.browser.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: options.timeout });

      // Extract and analyze CSS rules
      const cssAnalysis = await page.evaluate(() => {
        const issues = [];
        const sheets = Array.from(document.styleSheets);

        for (const sheet of sheets) {
          try {
            const rules = Array.from(sheet.cssRules || sheet.rules || []);

            for (const rule of rules) {
              if (rule.style) {
                const selector = rule.selectorText;
                const styles = rule.style;

                // Check for problematic CSS properties
                if (
                  styles.fontSize &&
                  styles.fontSize.endsWith('px') &&
                  parseInt(styles.fontSize) < 12
                ) {
                  // px font sizes DO scale with browser zoom; a small
                  // size is a readability hint, not a 1.4.4 failure.
                  issues.push({
                    type: 'small-fixed-font',
                    selector: selector,
                    property: 'font-size',
                    value: styles.fontSize,
                    severity: 'info',
                  });
                }

                if (styles.width && styles.width.endsWith('px')) {
                  const width = parseInt(styles.width);
                  if (width > 800) {
                    issues.push({
                      type: 'fixed-width',
                      selector: selector,
                      property: 'width',
                      value: styles.width,
                      severity: 'serious',
                    });
                  }
                }

                if (styles.minWidth && styles.minWidth.endsWith('px')) {
                  const minWidth = parseInt(styles.minWidth);
                  if (minWidth > 600) {
                    issues.push({
                      type: 'fixed-min-width',
                      selector: selector,
                      property: 'min-width',
                      value: styles.minWidth,
                      severity: 'serious',
                    });
                  }
                }

                if (styles.maxWidth && styles.maxWidth.endsWith('px')) {
                  const maxWidth = parseInt(styles.maxWidth);
                  if (maxWidth < 320) {
                    issues.push({
                      type: 'restrictive-max-width',
                      selector: selector,
                      property: 'max-width',
                      value: styles.maxWidth,
                      severity: 'moderate',
                    });
                  }
                }

                if (
                  styles.overflow === 'hidden' &&
                  (styles.width?.endsWith('px') || styles.height?.endsWith('px'))
                ) {
                  issues.push({
                    type: 'overflow-hidden-fixed',
                    selector: selector,
                    properties: {
                      overflow: styles.overflow,
                      width: styles.width,
                      height: styles.height,
                    },
                    severity: 'serious',
                  });
                }
              }
            }
          } catch (e) {
            // Skip stylesheets that can't be accessed (CORS)
          }
        }

        return issues;
      });

      for (const issue of cssAnalysis) {
        violations.push({
          type: issue.type,
          severity: issue.severity,
          description: this.getCSSIssueDescription(issue.type),
          selector: issue.selector,
          details: issue.properties || { [issue.property]: issue.value },
          wcagCriteria: '1.4.4',
          impact: this.getCSSIssueImpact(issue.type),
          recommendation: this.getCSSRecommendation(issue.type),
        });
      }
    } finally {
      await page.close();
    }

    return violations;
  }

  /**
   * Calculate zoom support across viewports
   */
  calculateZoomSupport(viewportResults) {
    const support = {
      '100%': true, // Baseline
      '200%': true,
      '400%': true,
    };

    for (const [name, result] of Object.entries(viewportResults)) {
      if (name.includes('200%') && result.violations.length > 0) {
        support['200%'] = false;
      }
      if (name.includes('400%') && result.violations.length > 0) {
        support['400%'] = false;
      }
    }

    return support;
  }

  /**
   * Generate recommendations for text resize issues
   */
  generateTextResizeRecommendations(violations) {
    const recommendations = [];
    const issueTypes = [...new Set(violations.map((v) => v.type))];

    if (issueTypes.includes('horizontal-scroll')) {
      recommendations.push({
        priority: 'critical',
        issue: 'Horizontal scrolling at zoom',
        solution: 'Use relative units (em, rem, %) instead of fixed pixel widths',
        implementation: 'Replace fixed widths with max-width: 100% and flexible layouts',
      });
    }

    if (issueTypes.includes('fixed-size')) {
      recommendations.push({
        priority: 'high',
        issue: 'Fixed-size elements',
        solution: 'Use responsive design with flexible containers',
        implementation:
          'Convert px widths to %, em, or rem units with proper max-width constraints',
      });
    }

    if (issueTypes.includes('text-overflow')) {
      recommendations.push({
        priority: 'high',
        issue: 'Text content truncation',
        solution: 'Allow text to wrap and containers to expand',
        implementation: 'Remove overflow: hidden on text containers, use word-wrap: break-word',
      });
    }

    if (issueTypes.includes('interaction-blocked')) {
      recommendations.push({
        priority: 'critical',
        issue: 'Interactive elements inaccessible',
        solution: 'Ensure all interactive elements remain accessible at zoom',
        implementation: 'Use flexible positioning and adequate spacing between elements',
      });
    }

    return recommendations;
  }

  /**
   * Get description for CSS issue types
   */
  getCSSIssueDescription(type) {
    const descriptions = {
      'small-fixed-font': 'Font size below 12px may not scale properly',
      'fixed-width': 'Large fixed width may cause horizontal scrolling at zoom',
      'fixed-min-width': 'Large minimum width restricts responsive behavior',
      'restrictive-max-width': 'Very small maximum width may truncate content',
      'overflow-hidden-fixed': 'Overflow hidden on fixed-size container may hide content at zoom',
    };
    return descriptions[type] || 'CSS property may impact text resize compliance';
  }

  /**
   * Get impact description for CSS issues
   */
  getCSSIssueImpact(type) {
    const impacts = {
      'small-fixed-font': 'Text may remain too small at zoom levels',
      'fixed-width': 'Content may require horizontal scrolling',
      'fixed-min-width': 'Layout may not adapt to smaller viewports',
      'restrictive-max-width': 'Content may be unnecessarily constrained',
      'overflow-hidden-fixed': 'Content may be cut off and inaccessible',
    };
    return impacts[type] || 'May prevent proper scaling at zoom levels';
  }

  /**
   * Get recommendation for CSS issues
   */
  getCSSRecommendation(type) {
    const recommendations = {
      'small-fixed-font': 'Use relative units (em, rem) or minimum 14px font size',
      'fixed-width': 'Use percentage widths or max-width with 100% width',
      'fixed-min-width': 'Use relative min-width or remove restrictive minimums',
      'restrictive-max-width': 'Increase max-width or use flexible constraints',
      'overflow-hidden-fixed': 'Allow content to expand or use scrollable containers',
    };
    return recommendations[type] || 'Use relative units and flexible layouts';
  }
}

module.exports = TextResizeScanner;
