const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Responsive Design Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.1.4.4, 9.1.4.10, 9.1.4.12 (Resize Text, Reflow, Text Spacing)
 * Uses visual screenshot analysis for thorough responsive design testing
 */
class ResponsiveDesignScanner extends BaseScanner {
  constructor() {
    super('responsive-design', {
      wcagCriteria: ['1.4.4', '1.4.10', '1.4.12'],
      wcagPrinciple: 'perceivable',
    });
    this.screenshotDir = path.join(__dirname, '../tmp/responsive-screenshots');
  }

  get needsExclusiveAccess() { return true; }

  /**
   * Core scan method — receives an already-navigated Puppeteer page.
   * Note: This scanner re-navigates internally (viewport/zoom testing) since it has exclusive access.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      viewports: [
        { width: 320, height: 568, devicePixelRatio: 2, name: "iPhone SE" },
        { width: 375, height: 667, devicePixelRatio: 2, name: "iPhone 8" },
        { width: 768, height: 1024, devicePixelRatio: 2, name: "iPad" },
        { width: 1920, height: 1080, devicePixelRatio: 1, name: "Desktop" }
      ],
      testZoomLevels: [100, 200, 320, 400],
      testOrientation: false,
      timeout: 60000,
      ...options,
    };

    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    // Fast heuristic-only mode: skip viewport cycling, run CSS heuristics
    if (scanOptions.heuristicOnly) {
      const [textSpacingResult, reflowResult, textResizeResult] = await Promise.all([
        this.heuristicTextSpacingCheck(page),
        this.heuristicReflowCheck(page),
        this.heuristicTextResizeCheck(page),
      ]);

      const allViolations = [
        ...textSpacingResult.violations,
        ...reflowResult.violations,
        ...textResizeResult.violations,
      ];

      return {
        scannerId: this.id,
        criteria: ["9.1.4.4", "9.1.4.10", "9.1.4.12"],
        passed: allViolations.length === 0,
        violations: allViolations,
        summary: {
          textSpacingOk: textSpacingResult.violations.length === 0,
          reflowOk: reflowResult.violations.length === 0,
          textResizeOk: textResizeResult.violations.length === 0,
          heuristicOnly: true,
          clippingContainers: textSpacingResult.clippingContainers,
          importantOverrides: textSpacingResult.importantOverrides,
        },
      };
    }

    // Get the current URL from the already-navigated page for internal re-navigation
    const url = page.url();
    const responsiveResults = await this.performResponsiveAnalysis(page, url, scanDir, scanOptions);

    // Navigate back to original page for CSS heuristic checks (viewport cycling changes the page)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Also run CSS heuristic checks in full mode to catch patterns the viewport/zoom tests miss
    const [reflowHeuristic, textResizeHeuristic] = await Promise.all([
      this.heuristicReflowCheck(page),
      this.heuristicTextResizeCheck(page),
    ]);

    const allViolations = [
      ...responsiveResults.violations,
      ...reflowHeuristic.violations,
      ...textResizeHeuristic.violations,
    ];

    return {
      scannerId: this.id,
      criteria: ["9.1.4.4", "9.1.4.10", "9.1.4.12"],
      passed: allViolations.length === 0,
      violations: allViolations,
      summary: {
        reflowWorks: responsiveResults.reflowWorks,
        textResizable: responsiveResults.textResizable,
        textSpacingOk: responsiveResults.textSpacingOk,
        contentLossAt320px: responsiveResults.contentLossAt320px,
        viewportsTested: scanOptions.viewports.length,
        zoomLevelsTested: scanOptions.testZoomLevels.length
      },
      screenshotPath: scanDir,
      visualEvidence: responsiveResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive responsive analysis with visual validation
   */
  async performResponsiveAnalysis(page, url, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let reflowWorks = true;
    let textResizable = true;
    let textSpacingOk = true;
    let contentLossAt320px = false;

    console.log('Starting responsive design analysis...');

    // Load the page initially
    await page.goto(url, { waitUntil: 'networkidle0', timeout: options.timeout });

    // 1. Test each viewport
    for (const viewport of options.viewports) {
      console.log(`Testing viewport: ${viewport.name} (${viewport.width}x${viewport.height})`);
      
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.devicePixelRatio || 1
      });

      // Wait for layout to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Take baseline screenshot
      const baselineScreenshot = path.join(scanDir, `${viewport.name.replace(/\s+/g, '-')}-baseline.png`);
      await page.screenshot({ path: baselineScreenshot, fullPage: true });

      // 2. Test zoom levels for this viewport
      for (const zoomLevel of options.testZoomLevels) {
        console.log(`  Testing ${zoomLevel}% zoom...`);
        
        const zoomResults = await this.testZoomLevel(page, scanDir, viewport, zoomLevel, violations);
        
        if (zoomLevel === 400 && viewport.width === 320) {
          // Critical test: 320px width at 400% zoom should not have horizontal scroll
          if (zoomResults.hasHorizontalScroll) {
            reflowWorks = false;
            contentLossAt320px = zoomResults.contentLoss;
          }
        }
        
        if (zoomLevel === 200 && zoomResults.textNotReadable) {
          textResizable = false;
        }

        visualEvidence.push({
          viewport: viewport.name,
          zoomLevel: zoomLevel,
          screenshot: zoomResults.screenshot,
          hasHorizontalScroll: zoomResults.hasHorizontalScroll,
          contentLoss: zoomResults.contentLoss,
          textReadable: !zoomResults.textNotReadable
        });
      }

      // 3. Test text spacing at this viewport
      const textSpacingResult = await this.testTextSpacing(page, scanDir, viewport, violations);
      if (!textSpacingResult.spacingOk) {
        textSpacingOk = false;
      }
    }

    // 4. Test content reflow specifically
    await this.testContentReflow(page, scanDir, violations, options);

    // Deduplicate violations by element + issue type across viewport/zoom combos
    const dedupedViolations = this.deduplicateViolations(violations);

    console.log(`Responsive analysis complete: ${violations.length} raw → ${dedupedViolations.length} deduplicated violations`);

    return {
      violations: dedupedViolations,
      visualEvidence,
      reflowWorks,
      textResizable,
      textSpacingOk,
      contentLossAt320px
    };
  }

  /**
   * Test specific zoom level for responsive issues
   */
  async testZoomLevel(page, scanDir, viewport, zoomLevel, violations) {
    // Set zoom level
    await page.evaluateOnNewDocument((zoom) => {
      document.body.style.zoom = zoom / 100;
    }, zoomLevel);

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 300));

    // Take screenshot
    const screenshotName = `${viewport.name.replace(/\s+/g, '-')}-zoom-${zoomLevel}.png`;
    const screenshotPath = path.join(scanDir, screenshotName);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Check for horizontal scrolling and content issues
    const scrollAnalysis = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      
      const scrollWidth = Math.max(body.scrollWidth, html.scrollWidth);
      const clientWidth = Math.max(body.clientWidth, html.clientWidth);
      
      // Check if content overflows horizontally
      const hasHorizontalScroll = scrollWidth > clientWidth;
      
      // Check for content that might be cut off or overlapping
      const elements = document.querySelectorAll('*');
      let contentLoss = false;
      let overlappingElements = 0;

      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (rect.width === 0 || rect.height === 0) return;

        // Check for elements that overflow beyond viewport AND clip content
        if (rect.right > clientWidth && style.overflow === 'hidden' &&
            el.scrollWidth > el.clientWidth && el.textContent.trim().length > 0) {
          contentLoss = true;
        }

        // Check for overlapping text — skip off-screen/visually-hidden elements
        if (style.position === 'absolute' || style.position === 'fixed') {
          // Skip elements that are intentionally off-screen (skip links, sr-only, etc.)
          if (rect.width <= 1 || rect.height <= 1) return;
          if (rect.right < 0 || rect.bottom < 0) return;
          if (style.clip && style.clip !== 'auto') return;
          if (style.clipPath && style.clipPath !== 'none') return;

          const siblings = Array.from(el.parentElement?.children || []);
          siblings.forEach(sibling => {
            if (sibling !== el) {
              const siblingStyle = window.getComputedStyle(sibling);
              if (siblingStyle.display === 'none' || siblingStyle.visibility === 'hidden') return;
              const siblingRect = sibling.getBoundingClientRect();
              if (siblingRect.width === 0 || siblingRect.height === 0) return;
              if (rect.left < siblingRect.right && rect.right > siblingRect.left &&
                  rect.top < siblingRect.bottom && rect.bottom > siblingRect.top) {
                overlappingElements++;
              }
            }
          });
        }
      });

      // Check text readability — only flag if actual text content is affected
      const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, li, td, th, label, a');
      let textNotReadable = false;

      textElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const text = el.textContent.trim();
        if (!text) return;
        const fontSize = parseFloat(style.fontSize);

        // Only flag genuinely tiny text, not overflow:hidden (which is often intentional)
        if (fontSize < 8) {
          textNotReadable = true;
        }
      });

      return {
        hasHorizontalScroll,
        contentLoss,
        overlappingElements,
        textNotReadable,
        scrollWidth,
        clientWidth
      };
    });

    // Generate violations for issues found
    if (scrollAnalysis.hasHorizontalScroll) {
      violations.push({
        criterion: "9.1.4.10",
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: "horizontal-scroll",
        description: `Horizontal scrolling required at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: "Implement responsive design to eliminate horizontal scrolling at all zoom levels"
      });
    }

    if (scrollAnalysis.contentLoss) {
      violations.push({
        criterion: "9.1.4.10",
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: "content-loss",
        description: `Content is cut off or hidden at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: "Ensure all content remains accessible when zoomed"
      });
    }

    if (scrollAnalysis.overlappingElements > 0) {
      violations.push({
        criterion: "9.1.4.10",
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: "overlapping-content",
        description: `${scrollAnalysis.overlappingElements} elements overlap at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: "Adjust layout to prevent content overlap when zoomed"
      });
    }

    if (scrollAnalysis.textNotReadable) {
      violations.push({
        criterion: "9.1.4.4",
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: "non-resizable-text",
        description: `Text becomes unreadable at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: "Use relative units (em, rem, %) for font sizes to support text scaling"
      });
    }

    return {
      screenshot: screenshotName,
      hasHorizontalScroll: scrollAnalysis.hasHorizontalScroll,
      contentLoss: scrollAnalysis.contentLoss,
      textNotReadable: scrollAnalysis.textNotReadable
    };
  }

  /**
   * Test text spacing customization (WCAG 1.4.12)
   */
  async testTextSpacing(page, scanDir, viewport, violations) {
    console.log(`  Testing text spacing for ${viewport.name}...`);

    // Apply text spacing modifications per WCAG 1.4.12
    const spacingResult = await page.evaluate(() => {
      // Store original styles
      const originalStyles = [];
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        originalStyles.push({
          element: el,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          wordSpacing: style.wordSpacing
        });
      });

      // Apply WCAG 1.4.12 text spacing requirements
      const style = document.createElement('style');
      style.textContent = `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p {
          margin-bottom: 2em !important;
        }
      `;
      document.head.appendChild(style);

      // Wait for layout to settle
      return new Promise(resolve => {
        setTimeout(() => {
          // Check for layout breaks
          let layoutBroken = false;
          let overlappingText = false;
          let cutOffContent = false;
          
          allElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(el);
            
            // Check for content that overflows or gets cut off
            if (computedStyle.overflow === 'hidden' && 
                (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
              cutOffContent = true;
            }
            
            // Check for negative margins or positions that might indicate broken layout
            if (rect.width < 0 || rect.height < 0) {
              layoutBroken = true;
            }
          });

          // Remove the test style
          document.head.removeChild(style);
          
          resolve({
            layoutBroken,
            overlappingText,
            cutOffContent
          });
        }, 500);
      });
    });

    // Take screenshot with modified text spacing
    const spacingScreenshot = path.join(scanDir, `${viewport.name.replace(/\s+/g, '-')}-text-spacing.png`);
    
    // Temporarily apply spacing for screenshot
    await page.addStyleTag({
      content: `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p {
          margin-bottom: 2em !important;
        }
      `
    });
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await page.screenshot({ path: spacingScreenshot, fullPage: true });

    if (spacingResult.layoutBroken || spacingResult.cutOffContent) {
      violations.push({
        criterion: "9.1.4.12",
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        issue: "text-spacing-failure",
        description: "Layout breaks when text spacing is customized per WCAG requirements",
        screenshot: `${viewport.name.replace(/\s+/g, '-')}-text-spacing.png`,
        suggestion: "Design layout to accommodate user text spacing customizations"
      });
    }

    return {
      spacingOk: !spacingResult.layoutBroken && !spacingResult.cutOffContent
    };
  }

  /**
   * Test content reflow at critical breakpoints
   */
  async testContentReflow(page, scanDir, violations, options) {
    console.log('Testing content reflow at 320px...');

    // Test the critical 320px width requirement
    await page.setViewport({ width: 320, height: 568 });
    await new Promise(resolve => setTimeout(resolve, 500));

    const reflowAnalysis = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;

      // Check if an element or any ancestor has overflow:auto/scroll (scrollable container)
      function isInsideScrollableContainer(el) {
        let parent = el.parentElement;
        while (parent && parent !== document.documentElement) {
          const ps = window.getComputedStyle(parent);
          if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') return true;
          parent = parent.parentElement;
        }
        return false;
      }

      // Check for fixed-width elements that don't reflow
      const fixedElements = [];
      const allElements = document.querySelectorAll('*');

      allElements.forEach(el => {
        // Skip structural elements that naturally match viewport width
        const tag = el.tagName.toLowerCase();
        if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style') return;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const rect = el.getBoundingClientRect();
        // Skip zero-size elements
        if (rect.width === 0 || rect.height === 0) return;

        // Only flag elements with explicit fixed CSS widths or min-widths that exceed 320px
        const hasFixedCssWidth = style.width && style.width.includes('px') && parseInt(style.width) > 320;
        const hasFixedMinWidth = style.minWidth && style.minWidth.includes('px') && parseInt(style.minWidth) > 320;

        if (!hasFixedCssWidth && !hasFixedMinWidth) return;
        // Skip elements properly contained in a scrollable ancestor
        if (isInsideScrollableContainer(el)) return;

        const selector = el.tagName.toLowerCase() +
                        (el.id ? `#${el.id}` : '') +
                        (el.className && typeof el.className === 'string' ? `.${el.className.split(' ').join('.')}` : '');

        fixedElements.push({
          selector,
          width: rect.width,
          fixedWidth: style.width,
          minWidth: style.minWidth
        });
      });

      return {
        hasHorizontalScroll: Math.max(body.scrollWidth, html.scrollWidth) > 320,
        fixedElements: fixedElements.slice(0, 10) // Limit to first 10
      };
    });

    // Take reflow test screenshot
    const reflowScreenshot = path.join(scanDir, 'reflow-test-320px.png');
    await page.screenshot({ path: reflowScreenshot, fullPage: true });

    if (reflowAnalysis.hasHorizontalScroll) {
      violations.push({
        criterion: "9.1.4.10",
        viewport: "320px width",
        issue: "reflow-failure",
        description: "Content does not reflow properly at 320px width - horizontal scrolling required",
        screenshot: "reflow-test-320px.png",
        suggestion: "Use responsive design techniques to ensure content reflows at 320px width"
      });
    }

    // Report specific fixed-width elements
    reflowAnalysis.fixedElements.forEach(element => {
      violations.push({
        criterion: "9.1.4.10",
        element: element.selector,
        viewport: "320px width",
        issue: "fixed-width-element",
        description: `Element has fixed width (${element.width}px) that exceeds viewport`,
        suggestion: "Use relative units (%, em, rem) or responsive design for element widths"
      });
    });
  }

  /**
   * Heuristic text spacing check (WCAG 1.4.12) — concurrent-compatible, pure page.evaluate
   * Detects CSS patterns that would cause clipping when text spacing is increased
   */
  async heuristicTextSpacingCheck(page) {
    console.log('Running heuristic text spacing check...');

    const result = await page.evaluate(() => {
      const violations = [];
      let clippingContainers = 0;
      let importantOverrides = 0;

      function getSelector(el) {
        return el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');
      }

      function hasTextContent(el) {
        // Check if element directly contains text (not just child elements)
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) return true;
        }
        return false;
      }

      const allElements = document.querySelectorAll('*');

      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const overflow = style.overflow;
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        const isOverflowHidden = overflow === 'hidden' || overflowY === 'hidden' || overflowX === 'hidden';

        if (!isOverflowHidden) return;

        // Only check elements with text content
        const text = el.textContent.trim();
        if (!text || text.length < 5) return;

        const height = style.height;
        const maxHeight = style.maxHeight;
        const whiteSpace = style.whiteSpace;
        const textOverflow = style.textOverflow;
        const webkitLineClamp = style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp');

        const hasFixedHeight = height && height !== 'auto' && height.includes('px');
        const hasMaxHeight = maxHeight && maxHeight !== 'none' && maxHeight.includes('px');
        const hasNowrap = whiteSpace === 'nowrap';
        const hasEllipsis = textOverflow === 'ellipsis';
        const hasLineClamp = webkitLineClamp && webkitLineClamp !== 'none';

        if (hasFixedHeight || hasMaxHeight) {
          clippingContainers++;
          violations.push({
            criterion: '9.1.4.12',
            element: getSelector(el),
            issue: 'text-spacing-clip-risk',
            description: `Element with overflow:hidden and ${hasFixedHeight ? `fixed height (${height})` : `max-height (${maxHeight})`} will clip text when spacing is increased`,
            severity: 'serious',
            suggestion: 'Use min-height instead of fixed height, or remove overflow:hidden to allow content to expand.',
          });
        }

        if (hasNowrap && isOverflowHidden) {
          clippingContainers++;
          violations.push({
            criterion: '9.1.4.12',
            element: getSelector(el),
            issue: 'text-spacing-nowrap-clip',
            description: 'Element with white-space:nowrap and overflow:hidden will clip text when letter/word spacing increases',
            severity: 'serious',
            suggestion: 'Remove white-space:nowrap or change overflow to auto/visible.',
          });
        }

        if (hasLineClamp) {
          clippingContainers++;
          violations.push({
            criterion: '9.1.4.12',
            element: getSelector(el),
            issue: 'text-spacing-line-clamp',
            description: '-webkit-line-clamp restricts visible lines and will clip content when line-height increases',
            severity: 'moderate',
            suggestion: 'Allow content to expand by removing line-clamp, or use a "show more" toggle.',
          });
        }
      });

      // Check for !important on spacing properties in stylesheets
      try {
        for (const sheet of document.styleSheets) {
          // Skip disabled stylesheets
          if (sheet.disabled) continue;
          if (sheet.ownerNode && sheet.ownerNode.disabled) continue;

          let rules;
          try {
            rules = sheet.cssRules || sheet.rules;
          } catch (e) {
            continue; // cross-origin
          }
          if (!rules) continue;

          for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            const style = rule.style;
            const sel = rule.selectorText || '';

            // Skip universal selectors — these are typically user-override styles,
            // not author-lock styles (e.g. * { line-height: 1.5 !important })
            if (sel.trim() === '*') continue;

            const spacingProps = ['line-height', 'letter-spacing', 'word-spacing'];
            for (const prop of spacingProps) {
              if (style.getPropertyPriority(prop) === 'important') {
                // Verify the selector targets real elements
                const matched = document.querySelectorAll(sel);
                if (matched.length > 0) {
                  importantOverrides++;
                  violations.push({
                    criterion: '9.1.4.12',
                    element: rule.selectorText,
                    issue: 'text-spacing-important-override',
                    description: `${prop} is set with !important, preventing user override for text spacing`,
                    severity: 'serious',
                    suggestion: `Remove !important from ${prop} to allow user text spacing customization.`,
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        // stylesheet access error — non-fatal
      }

      return { violations, clippingContainers, importantOverrides };
    });

    console.log(`Heuristic text spacing check complete: ${result.violations.length} violations found`);
    return result;
  }

  /**
   * Heuristic reflow check (WCAG 1.4.10) — detects fixed-width elements that prevent reflow at 320px.
   * Scans CSS rules (not computed styles) to avoid false positives from responsive layouts.
   */
  async heuristicReflowCheck(page) {
    console.log('Running heuristic reflow check...');

    const result = await page.evaluate(() => {
      const violations = [];

      function isInsideScrollableContainer(el) {
        let parent = el.parentElement;
        while (parent && parent !== document.documentElement) {
          const ps = window.getComputedStyle(parent);
          if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') return true;
          parent = parent.parentElement;
        }
        return false;
      }

      // Scan stylesheets for explicit px width/min-width declarations > 320px
      const pxWidthRules = [];
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules || []) {
              if (!(rule instanceof CSSStyleRule)) continue;
              const sel = rule.selectorText || '';
              if (sel.includes('::')) continue;

              const widthVal = rule.style.width;
              const minWidthVal = rule.style.minWidth;

              if (widthVal && widthVal.endsWith('px') && parseFloat(widthVal) > 320) {
                const matched = document.querySelectorAll(sel);
                const validMatches = Array.from(matched).filter(el => {
                  const s = window.getComputedStyle(el);
                  return s.display !== 'none' && s.visibility !== 'hidden' && !isInsideScrollableContainer(el);
                });
                if (validMatches.length > 0) {
                  pxWidthRules.push({ selector: sel, property: 'width', value: widthVal, count: validMatches.length });
                }
              }

              if (minWidthVal && minWidthVal.endsWith('px') && parseFloat(minWidthVal) > 320) {
                const matched = document.querySelectorAll(sel);
                const validMatches = Array.from(matched).filter(el => {
                  const s = window.getComputedStyle(el);
                  return s.display !== 'none' && s.visibility !== 'hidden' && !isInsideScrollableContainer(el);
                });
                if (validMatches.length > 0) {
                  pxWidthRules.push({ selector: sel, property: 'min-width', value: minWidthVal, count: validMatches.length });
                }
              }
            }
          } catch (e) { /* cross-origin */ }
        }
      } catch (e) { /* no stylesheets */ }

      for (const rule of pxWidthRules) {
        violations.push({
          criterion: '9.1.4.10',
          element: rule.selector,
          issue: rule.property === 'width' ? 'reflow-fixed-width' : 'reflow-min-width',
          description: `CSS rule "${rule.selector}" sets ${rule.property}: ${rule.value} which exceeds 320px reflow threshold, affecting ${rule.count} element(s)`,
          severity: 'serious',
          suggestion: 'Use max-width with relative units (%, vw, rem) instead of fixed pixel width.',
        });
      }

      // Also check inline styles on elements
      const allElements = document.querySelectorAll('[style]');
      allElements.forEach(el => {
        const inlineWidth = el.style.width;
        const inlineMinWidth = el.style.minWidth;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (isInsideScrollableContainer(el)) return;

        const getSelector = (e) => e.tagName.toLowerCase() +
          (e.id ? `#${e.id}` : '') +
          (e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : '');

        if (inlineWidth && inlineWidth.endsWith('px') && parseFloat(inlineWidth) > 320) {
          violations.push({
            criterion: '9.1.4.10',
            element: getSelector(el),
            issue: 'reflow-fixed-width',
            description: `Element has inline style width: ${inlineWidth} which exceeds 320px reflow threshold`,
            severity: 'serious',
            suggestion: 'Use max-width with relative units (%, vw, rem) instead of fixed pixel width.',
          });
        }

        if (inlineMinWidth && inlineMinWidth.endsWith('px') && parseFloat(inlineMinWidth) > 320) {
          violations.push({
            criterion: '9.1.4.10',
            element: getSelector(el),
            issue: 'reflow-min-width',
            description: `Element has inline style min-width: ${inlineMinWidth} which prevents reflow below 320px`,
            severity: 'serious',
            suggestion: 'Remove or reduce min-width to allow content to reflow at narrow viewports.',
          });
        }
      });

      return { violations };
    });

    console.log(`Heuristic reflow check complete: ${result.violations.length} violations found`);
    return result;
  }

  /**
   * Heuristic text resize check (WCAG 1.4.4) — detects fixed font sizes and clipping containers
   */
  async heuristicTextResizeCheck(page) {
    console.log('Running heuristic text resize check...');

    const result = await page.evaluate(() => {
      const violations = [];

      function getSelector(el) {
        return el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');
      }

      // Scan stylesheets for font-size declarations in px
      const pxFontRules = [];
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules || []) {
              if (!(rule instanceof CSSStyleRule)) continue;
              const fontSize = rule.style.fontSize;
              if (fontSize && fontSize.endsWith('px')) {
                const sel = rule.selectorText || '';
                // Skip selectors that are pseudo-elements or already use relative patterns
                if (sel.includes('::')) continue;
                const matched = document.querySelectorAll(sel);
                if (matched.length > 0) {
                  pxFontRules.push({ selector: sel, fontSize, count: matched.length });
                }
              }
            }
          } catch (e) { /* cross-origin */ }
        }
      } catch (e) { /* no stylesheets */ }

      // Report px font-size rules
      for (const rule of pxFontRules) {
        violations.push({
          criterion: '9.1.4.4',
          element: rule.selector,
          issue: 'text-resize-fixed-font',
          description: `CSS rule "${rule.selector}" sets font-size: ${rule.fontSize} (absolute unit) affecting ${rule.count} element(s). Text may not resize properly to 200%`,
          severity: 'serious',
          suggestion: 'Use relative units (rem, em, %) for font-size to allow text to scale with user zoom.',
        });
      }

      // Check for fixed-height containers with overflow:hidden that contain text
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const isOverflowHidden = style.overflow === 'hidden' ||
          style.overflowY === 'hidden';
        const height = style.height;
        const hasFixedHeight = height && height !== 'auto' && height.endsWith('px');

        if (isOverflowHidden && hasFixedHeight) {
          const text = el.textContent.trim();
          if (text && text.length > 10) {
            violations.push({
              criterion: '9.1.4.4',
              element: getSelector(el),
              issue: 'text-resize-clip-risk',
              description: `Text container with height: ${height} and overflow: hidden will clip content when text is zoomed to 200%`,
              severity: 'serious',
              suggestion: 'Use min-height instead of fixed height, or change overflow to auto/visible.',
            });
          }
        }
      });

      return { violations };
    });

    console.log(`Heuristic text resize check complete: ${result.violations.length} violations found`);
    return result;
  }

  /**
   * Deduplicate violations by element+issue type, merging viewport/zoom metadata.
   * A single CSS overflow issue reported at 16 viewport/zoom combos becomes one
   * violation with an affectedViewports array.
   */
  deduplicateViolations(violations) {
    const map = new Map();

    for (const v of violations) {
      // Build dedup key from element selector (or description fallback) + issue type
      const elementKey = v.element || v.description || '';
      const key = `${elementKey}::${v.issue}::${v.criterion}`;

      if (map.has(key)) {
        const existing = map.get(key);
        // Merge viewport/zoom info
        if (v.viewport || v.zoomLevel) {
          existing.affectedViewports.push({
            viewport: v.viewport || 'unknown',
            zoomLevel: v.zoomLevel || null,
            screenshot: v.screenshot || null,
          });
        }
      } else {
        const deduped = {
          criterion: v.criterion,
          element: v.element || null,
          issue: v.issue,
          description: v.description,
          suggestion: v.suggestion,
          severity: v.severity || null,
          affectedViewports: [],
        };
        if (v.viewport || v.zoomLevel) {
          deduped.affectedViewports.push({
            viewport: v.viewport || 'unknown',
            zoomLevel: v.zoomLevel || null,
            screenshot: v.screenshot || null,
          });
        }
        // Preserve screenshot for single-viewport violations
        if (v.screenshot && !v.viewport) {
          deduped.screenshot = v.screenshot;
        }
        map.set(key, deduped);
      }
    }

    return Array.from(map.values());
  }

}

module.exports = ResponsiveDesignScanner;