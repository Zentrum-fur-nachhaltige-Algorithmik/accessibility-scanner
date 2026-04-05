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

    // Fast heuristic-only mode: skip viewport cycling, only run text spacing heuristic
    if (scanOptions.heuristicOnly) {
      const heuristicResult = await this.heuristicTextSpacingCheck(page);
      return {
        scannerId: this.id,
        criteria: ["9.1.4.12"],
        passed: heuristicResult.violations.length === 0,
        violations: heuristicResult.violations,
        summary: {
          textSpacingOk: heuristicResult.violations.length === 0,
          heuristicOnly: true,
          clippingContainers: heuristicResult.clippingContainers,
          importantOverrides: heuristicResult.importantOverrides,
        },
      };
    }

    // Get the current URL from the already-navigated page for internal re-navigation
    const url = page.url();
    const responsiveResults = await this.performResponsiveAnalysis(page, url, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["9.1.4.4", "9.1.4.10", "9.1.4.12"],
      passed: responsiveResults.violations.length === 0,
      violations: responsiveResults.violations,
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

    console.log(`Responsive analysis complete: ${violations.length} violations found`);

    return {
      violations,
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
        
        // Check for elements that overflow beyond viewport
        if (rect.right > clientWidth && style.overflow === 'hidden') {
          contentLoss = true;
        }
        
        // Check for overlapping text
        if (style.position === 'absolute' || style.position === 'fixed') {
          const siblings = Array.from(el.parentElement?.children || []);
          siblings.forEach(sibling => {
            if (sibling !== el) {
              const siblingRect = sibling.getBoundingClientRect();
              if (rect.left < siblingRect.right && rect.right > siblingRect.left &&
                  rect.top < siblingRect.bottom && rect.bottom > siblingRect.top) {
                overlappingElements++;
              }
            }
          });
        }
      });

      // Check text readability
      const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div');
      let textNotReadable = false;
      
      textElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        
        // At high zoom, text should still be readable (not too small or cut off)
        if (fontSize < 8 || style.overflow === 'hidden') {
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
      
      // Check for fixed-width elements that don't reflow
      const fixedElements = [];
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        // Check for elements with fixed widths that exceed viewport
        if ((style.width && style.width.includes('px') && parseInt(style.width) > 320) ||
            (style.minWidth && style.minWidth.includes('px') && parseInt(style.minWidth) > 320) ||
            rect.width > 320) {
          
          const selector = el.tagName.toLowerCase() + 
                          (el.id ? `#${el.id}` : '') + 
                          (el.className ? `.${el.className.split(' ').join('.')}` : '');
          
          fixedElements.push({
            selector,
            width: rect.width,
            fixedWidth: style.width,
            minWidth: style.minWidth
          });
        }
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

            const spacingProps = ['line-height', 'letter-spacing', 'word-spacing'];
            for (const prop of spacingProps) {
              if (style.getPropertyPriority(prop) === 'important') {
                // Verify the selector targets real elements
                const matched = document.querySelectorAll(rule.selectorText);
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

}

module.exports = ResponsiveDesignScanner;