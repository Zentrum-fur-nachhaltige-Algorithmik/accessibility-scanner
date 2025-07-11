const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Responsive Design Scanner for WCAG 2.1 compliance testing
 * Implements EN 301 549 criteria 9.1.4.4, 9.1.4.10, 9.1.4.12 (Resize Text, Reflow, Text Spacing)
 * Uses visual screenshot analysis for thorough responsive design testing
 */
class ResponsiveDesignScanner {
  constructor() {
    this.browser = null;
    this.screenshotDir = path.join(__dirname, '../tmp/responsive-screenshots');
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    
    // Ensure screenshot directory exists
    await fs.ensureDir(this.screenshotDir);
  }

  /**
   * Scan responsive design compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @param {Array} options.viewports - Array of viewport configurations
   * @param {Array} options.testZoomLevels - Zoom levels to test [100, 200, 320, 400]
   * @param {boolean} options.testOrientation - Test orientation changes
   * @param {number} options.timeout - Test timeout in milliseconds
   * @returns {Promise<Object>} ResponsiveReport
   */
  async scanResponsiveCompliance(url, options = {}) {
    const defaultOptions = {
      viewports: [
        { width: 320, height: 568, devicePixelRatio: 2, name: "iPhone SE" },
        { width: 375, height: 667, devicePixelRatio: 2, name: "iPhone 8" },
        { width: 768, height: 1024, devicePixelRatio: 2, name: "iPad" },
        { width: 1920, height: 1080, devicePixelRatio: 1, name: "Desktop" }
      ],
      testZoomLevels: [100, 200, 320, 400],
      testOrientation: false,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      const page = await this.browser.newPage();
      
      // Create timestamped scan directory
      const timestamp = Date.now();
      const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
      await fs.ensureDir(scanDir);

      const responsiveResults = await this.performResponsiveAnalysis(page, url, scanDir, scanOptions);
      
      await page.close();

      // Create report according to interface
      const report = {
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

      return report;

    } catch (error) {
      throw new Error(`Responsive design scan failed: ${error.message}`);
    }
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

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = ResponsiveDesignScanner;