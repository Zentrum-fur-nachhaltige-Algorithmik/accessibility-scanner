/**
 * Responsive Design Scanner.
 * WCAG 1.4.4, 1.4.10, 1.4.12 (EN 301 549 9.1.4.4, 9.1.4.10, 9.1.4.12).
 * Cycles viewports and emulated zoom levels, injects text-spacing overrides
 * and measures clipped text and horizontal overflow; screenshots as evidence.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS, DEVICES } = require('../core/constants');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: textClippingCode } = require('../utils/text-clipping');
const log = require('../utils/logger').createLogger('responsive-design');

class ResponsiveDesignScanner extends BaseScanner {
  constructor() {
    super('responsive-design', {
      wcagCriteria: ['1.4.4', '1.4.10', '1.4.12'],
      wcagPrinciple: 'perceivable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * Re-navigates internally (viewport/zoom testing) since it has exclusive access.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      viewports: [DEVICES.reflow320, DEVICES.iphoneSe, DEVICES.ipad, DEVICES.desktop],
      testZoomLevels: [100, 200, 320, 400],
      testOrientation: false,
      timeout: TIMEOUTS.scanner,
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

      const rawViolations = [
        ...textSpacingResult.violations,
        ...reflowResult.violations,
        ...textResizeResult.violations,
      ];
      const allViolations = this.deduplicateViolations(rawViolations);

      return {
        scannerId: this.id,
        criteria: ['9.1.4.4', '9.1.4.10', '9.1.4.12'],
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

    const rawViolations = [
      ...responsiveResults.violations,
      ...reflowHeuristic.violations,
      ...textResizeHeuristic.violations,
    ];
    const allViolations = this.deduplicateViolations(rawViolations);

    return {
      scannerId: this.id,
      criteria: ['9.1.4.4', '9.1.4.10', '9.1.4.12'],
      passed: allViolations.length === 0,
      violations: allViolations,
      summary: {
        reflowWorks: responsiveResults.reflowWorks,
        textResizable: responsiveResults.textResizable,
        textSpacingOk: responsiveResults.textSpacingOk,
        contentLossAt320px: responsiveResults.contentLossAt320px,
        viewportsTested: scanOptions.viewports.length,
        zoomLevelsTested: scanOptions.testZoomLevels.length,
      },
      screenshotPath: scanDir,
      visualEvidence: responsiveResults.visualEvidence,
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

    log.debug('Starting responsive design analysis...');

    // Load the page initially
    await page.goto(url, { waitUntil: 'networkidle0', timeout: options.timeout });

    // 1. Test each viewport
    for (const viewport of options.viewports) {
      log.debug(`Testing viewport: ${viewport.name} (${viewport.width}x${viewport.height})`);

      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
      });

      // Wait for layout to settle
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Take baseline screenshot
      const baselineScreenshot = path.join(
        scanDir,
        `${viewport.name.replace(/\s+/g, '-')}-baseline.png`
      );
      await page.screenshot({ path: baselineScreenshot, fullPage: true });

      // 2. Test zoom levels for this viewport
      for (const zoomLevel of options.testZoomLevels) {
        log.debug(`  Testing ${zoomLevel}% zoom...`);

        const zoomResults = await this.testZoomLevel(
          page,
          scanDir,
          viewport,
          zoomLevel,
          violations
        );

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
          textReadable: !zoomResults.textNotReadable,
        });
      }

      // Restore the real viewport after zoom emulation
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 300));

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

    log.debug(
      `Responsive analysis complete: ${violations.length} raw → ${dedupedViolations.length} deduplicated violations`
    );

    return {
      violations: dedupedViolations,
      visualEvidence,
      reflowWorks,
      textResizable,
      textSpacingOk,
      contentLossAt320px,
    };
  }

  /**
   * Test specific zoom level for responsive issues.
   *
   * Zoom is emulated by shrinking the CSS viewport (width / zoom), which is
   * what browser zoom does to layout; `body.style.zoom` would break
   * position:fixed/sticky and vw units. WCAG 1.4.10 only requires reflow
   * down to 320 CSS px, so the emulated width is clamped at 320; a
   * combination whose clamped width is already covered by a wider base
   * viewport is skipped as redundant.
   */
  async testZoomLevel(page, scanDir, viewport, zoomLevel, violations) {
    const MIN_REFLOW_WIDTH = 320;
    const rawWidth = Math.round((viewport.width * 100) / zoomLevel);
    const rawHeight = Math.round((viewport.height * 100) / zoomLevel);
    const cssWidth = Math.max(MIN_REFLOW_WIDTH, rawWidth);
    const cssHeight = Math.max(Math.round((rawHeight * cssWidth) / Math.max(rawWidth, 1)), 256);

    // Below 320 CSS px everything clamps to the same 320px layout. Measure it
    // once (the canonical 320px @ 400% check) and skip the other combinations.
    if (
      rawWidth < MIN_REFLOW_WIDTH &&
      !(viewport.width === MIN_REFLOW_WIDTH && zoomLevel === 400)
    ) {
      return {
        screenshot: null,
        hasHorizontalScroll: false,
        contentLoss: false,
        textNotReadable: false,
        skipped: true,
      };
    }

    await page.setViewport({ width: cssWidth, height: cssHeight, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Take screenshot
    const screenshotName = `${viewport.name.replace(/\s+/g, '-')}-zoom-${zoomLevel}.png`;
    const screenshotPath = path.join(scanDir, screenshotName);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Check for horizontal scrolling and content issues
    const scrollAnalysis = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;

      const scrollWidth = Math.max(body.scrollWidth, html.scrollWidth);
      const clientWidth = window.innerWidth;

      // 1px tolerance: sub-pixel rounding of borders/shadows is not a reflow failure
      const hasHorizontalScroll = scrollWidth > clientWidth + 1;

      // Check for content that might be cut off or overlapping
      const elements = document.querySelectorAll('*');
      let contentLoss = false;
      let overlappingElements = 0;

      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (rect.width === 0 || rect.height === 0) return;

        // Check for elements that overflow beyond viewport AND clip content
        if (
          rect.right > clientWidth &&
          style.overflow === 'hidden' &&
          el.scrollWidth > el.clientWidth &&
          el.textContent.trim().length > 0
        ) {
          contentLoss = true;
        }

        // Overlapping text: an absolutely positioned element painted over a
        // sibling's text. position:fixed overlays (sticky CTAs, headers,
        // cookie banners) float above the page by design and are skipped;
        // they are checked by the focus-obscured logic instead.
        if (style.position === 'absolute') {
          if (rect.width <= 1 || rect.height <= 1) return;
          if (rect.right < 0 || rect.bottom < 0) return;
          if (style.clip && style.clip !== 'auto') return;
          if (style.clipPath && style.clipPath !== 'none') return;
          if (style.pointerEvents === 'none' && parseFloat(style.opacity) < 1) return;
          const ownText = (el.textContent || '').trim().length > 0;
          const bg = style.backgroundColor;
          const opaqueBg =
            bg && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(bg) && bg !== 'transparent';
          if (!ownText && !opaqueBg && style.backgroundImage === 'none') return; // invisible box
          const area = rect.width * rect.height;

          const siblings = Array.from(el.parentElement?.children || []);
          siblings.forEach((sibling) => {
            if (sibling === el) return;
            const siblingStyle = window.getComputedStyle(sibling);
            if (siblingStyle.display === 'none' || siblingStyle.visibility === 'hidden') return;
            if (siblingStyle.position === 'absolute' || siblingStyle.position === 'fixed') return;
            const hasText = Array.from(sibling.childNodes).some(
              (n) => n.nodeType === 3 && n.textContent.trim()
            );
            if (!hasText) return;
            const siblingRect = sibling.getBoundingClientRect();
            if (siblingRect.width === 0 || siblingRect.height === 0) return;
            const ix =
              Math.min(rect.right, siblingRect.right) - Math.max(rect.left, siblingRect.left);
            const iy =
              Math.min(rect.bottom, siblingRect.bottom) - Math.max(rect.top, siblingRect.top);
            if (ix <= 0 || iy <= 0) return;
            const overlap = ix * iy;
            // Meaningful only when a substantial part of the text block is covered
            if (overlap / (siblingRect.width * siblingRect.height) > 0.25 || overlap / area > 0.5) {
              overlappingElements++;
            }
          });
        }
      });

      // Check text readability: only flag if actual text content is affected
      const textElements = document.querySelectorAll(
        'p, h1, h2, h3, h4, h5, h6, span, li, td, th, label, a'
      );
      let textNotReadable = false;

      textElements.forEach((el) => {
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
        clientWidth,
      };
    });

    // Generate violations for issues found
    if (scrollAnalysis.hasHorizontalScroll) {
      violations.push({
        criterion: '9.1.4.10',
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: 'horizontal-scroll',
        description: `Horizontal scrolling required at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion:
          'Implement responsive design to eliminate horizontal scrolling at all zoom levels',
      });
    }

    if (scrollAnalysis.contentLoss) {
      violations.push({
        criterion: '9.1.4.10',
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: 'content-loss',
        description: `Content is cut off or hidden at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: 'Ensure all content remains accessible when zoomed',
      });
    }

    if (scrollAnalysis.overlappingElements > 0) {
      violations.push({
        criterion: '9.1.4.10',
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: 'overlapping-content',
        description: `${scrollAnalysis.overlappingElements} elements overlap at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: 'Adjust layout to prevent content overlap when zoomed',
      });
    }

    if (scrollAnalysis.textNotReadable) {
      violations.push({
        criterion: '9.1.4.4',
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: 'non-resizable-text',
        description: `Text becomes unreadable at ${zoomLevel}% zoom`,
        screenshot: screenshotName,
        suggestion: 'Use relative units (em, rem, %) for font sizes to support text scaling',
      });
    }

    return {
      screenshot: screenshotName,
      hasHorizontalScroll: scrollAnalysis.hasHorizontalScroll,
      contentLoss: scrollAnalysis.contentLoss,
      textNotReadable: scrollAnalysis.textNotReadable,
    };
  }

  /**
   * Test text spacing customization (WCAG 1.4.12).
   *
   * Measures clipping BEFORE and AFTER injecting the 1.4.12 values and reports
   * only text that becomes newly clipped: carousels, custom scrollbars and
   * decorative overflow:hidden containers that were already "overflowing"
   * before the injection are not 1.4.12 failures. One finding per element.
   */
  async testTextSpacing(page, scanDir, viewport, violations) {
    log.debug(`  Testing text spacing for ${viewport.name}...`);

    const SPACING_CSS = `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p {
          margin-bottom: 2em !important;
        }
    `;

    const spacingResult = await page.evaluate(
      (renderedCode, css) => {
        eval(renderedCode);

        function selectorOf(el) {
          return (
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (el.className && typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
              : '')
          );
        }

        function hasDirectText(el) {
          for (const n of el.childNodes) {
            if (n.nodeType === 3 && n.textContent.trim().length > 0) return true;
          }
          return false;
        }

        /** Nearest ancestor (or self) that clips on the given axis. */
        function clipperOf(el) {
          let n = el;
          while (n && n !== document.documentElement) {
            const cs = window.getComputedStyle(n);
            const cx = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
            const cy = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
            if (cx || cy) return { el: n, cx, cy };
            n = n.parentElement;
          }
          return null;
        }

        /** Union rect of the element's direct text nodes. */
        function textRect(el) {
          const range = document.createRange();
          let out = null;
          for (const n of el.childNodes) {
            if (n.nodeType !== 3 || !n.textContent.trim()) continue;
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) {
              if (r.width === 0 || r.height === 0) continue;
              out = out
                ? {
                    left: Math.min(out.left, r.left),
                    top: Math.min(out.top, r.top),
                    right: Math.max(out.right, r.right),
                    bottom: Math.max(out.bottom, r.bottom),
                  }
                : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            }
          }
          return out;
        }

        /** Pixels of the element's text lying outside its clipping container (0 = not clipped). */
        function clippedPx(el, clipper) {
          if (!clipper) return 0;
          const t = textRect(el);
          if (!t) return 0;
          const c = clipper.el.getBoundingClientRect();
          let px = 0;
          if (clipper.cx) px = Math.max(px, t.right - c.right, c.left - t.left);
          if (clipper.cy) px = Math.max(px, t.bottom - c.bottom, c.top - t.top);
          return px > 1 ? px : 0; // sub-pixel rounding is not clipping
        }

        function verticallyClipped(el, clipper) {
          const t = textRect(el);
          if (!t) return false;
          const c = clipper.el.getBoundingClientRect();
          return t.bottom - c.bottom > 1 || c.top - t.top > 1;
        }

        const candidates = [];
        document.querySelectorAll('body *').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return;
          if (!hasDirectText(el) || !__isRendered(el)) return;
          const clipper = clipperOf(el);
          if (!clipper) return;
          const cs = window.getComputedStyle(el);
          const fs = parseFloat(cs.fontSize) || 16;
          const lh = cs.lineHeight === 'normal' ? 1.2 * fs : parseFloat(cs.lineHeight);
          const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing);
          const ws = cs.wordSpacing === 'normal' ? 0 : parseFloat(cs.wordSpacing);
          // Already at (or beyond) the 1.4.12 values: baseline clipping IS the 1.4.12 state.
          const alreadySpaced =
            lh >= 1.5 * fs - 0.5 && ls >= 0.12 * fs - 0.1 && ws >= 0.16 * fs - 0.1;
          const truncated = cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis';
          candidates.push({
            el,
            clipper,
            before: clippedPx(el, clipper),
            alreadySpaced,
            truncated,
          });
        });

        const style = document.createElement('style');
        style.setAttribute('data-a11y-text-spacing', '');
        style.textContent = css;
        document.head.appendChild(style);

        return new Promise((resolve) => {
          setTimeout(() => {
            const issues = [];
            for (const c of candidates) {
              const after = clippedPx(c.el, c.clipper);
              if (!__isRendered(c.el)) continue;
              // Text that WAS fully visible and is clipped by the injected spacing, or already clipped on a page
              // that already applies 1.4.12 spacing (vertical clipping only; a
              // horizontally clipped baseline is a carousel/marquee/ellipsis, not 1.4.12).
              const newlyClipped = c.before === 0 && after > 0;
              const clippedAtSpec =
                after > 0 &&
                c.alreadySpaced &&
                !c.truncated &&
                c.clipper.cy &&
                verticallyClipped(c.el, c.clipper);
              if (newlyClipped || clippedAtSpec) {
                issues.push({
                  element: selectorOf(c.el),
                  container: selectorOf(c.clipper.el),
                  clippedPx: Math.round(after),
                  text: c.el.textContent.trim().slice(0, 60),
                });
              }
            }
            document.head.removeChild(style);
            resolve({ issues, candidates: candidates.length });
          }, 500);
        });
      },
      renderedCode,
      SPACING_CSS
    );

    // Screenshot with the spacing applied, then restore the page state
    const screenshotName = `${viewport.name.replace(/\s+/g, '-')}-text-spacing.png`;
    await page
      .addStyleTag({ content: SPACING_CSS })
      .then(
        (h) =>
          h && h.evaluate((el) => el.setAttribute('data-a11y-text-spacing', '')).catch(() => {})
      );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({ path: path.join(scanDir, screenshotName), fullPage: true });
    await page.evaluate(() => {
      document.querySelectorAll('style[data-a11y-text-spacing]').forEach((el) => el.remove());
    });

    for (const issue of spacingResult.issues.slice(0, 20)) {
      violations.push({
        criterion: '9.1.4.12',
        element: issue.element,
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        issue: 'text-spacing-failure',
        description: `Text in ${issue.element} is clipped by ${issue.clippedPx}px inside ${issue.container} when WCAG 1.4.12 text spacing is applied ("${issue.text}")`,
        screenshot: screenshotName,
        suggestion:
          'Let the container grow with its content (avoid fixed heights with overflow:hidden on text) so user text-spacing overrides do not clip text',
      });
    }
    if (spacingResult.issues.length > 20) {
      log.debug(
        `  text-spacing: ${spacingResult.issues.length} clipped elements, reporting first 20`
      );
    }

    return { spacingOk: spacingResult.issues.length === 0 };
  }

  /**
   * Test content reflow at critical breakpoints
   *
   * `fixed-width-element` is derived from the *authored* CSS (inline style or a
   * matching style rule), never from `getComputedStyle().width`: the computed
   * value is always a used px length, so reading it would flag every element
   * that happens to be wider than 320px (fluid tables, `width:100%` wrappers)
   * as "fixed width".
   */
  async testContentReflow(page, scanDir, violations, options) {
    log.debug('Testing content reflow at 320px...');

    // Test the critical 320px width requirement
    await page.setViewport({ width: 320, height: 568 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const reflowAnalysis = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const viewportWidth = window.innerWidth || 320;

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

      /**
       * Authored (declared) width/min-width of an element in px, or null.
       * Looks at the inline style first, then at every matching CSSStyleRule
       * whose media query currently applies. Only absolute px declarations
       * count; %, vw, rem-with-max-width etc. reflow by definition.
       */
      const styleRules = [];
      try {
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch (e) {
            continue;
          } // cross-origin
          if (!rules) continue;
          const walk = (list) => {
            for (const rule of list) {
              if (rule.media && rule.cssRules) {
                // Only rules from media queries that currently match
                if (window.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules);
                continue;
              }
              if (rule.cssRules && !rule.selectorText) {
                walk(rule.cssRules);
                continue;
              }
              if (!rule.selectorText || !rule.style) continue;
              const w = rule.style.getPropertyValue('width');
              const mw = rule.style.getPropertyValue('min-width');
              if (!w && !mw) continue;
              styleRules.push({ selector: rule.selectorText, width: w, minWidth: mw });
            }
          };
          walk(rules);
        }
      } catch (e) {
        /* no stylesheets */
      }

      function authoredWidths(el) {
        let width = null;
        let minWidth = null;
        const take = (w, mw) => {
          if (w && w.trim().endsWith('px')) width = w.trim();
          if (mw && mw.trim().endsWith('px')) minWidth = mw.trim();
        };
        for (const r of styleRules) {
          let matches = false;
          try {
            matches = el.matches(r.selector);
          } catch (e) {
            continue;
          } // ::pseudo etc.
          if (matches) take(r.width, r.minWidth);
        }
        take(el.style.width, el.style.minWidth); // inline style wins
        return { width, minWidth };
      }

      // Check for fixed-width elements that don't reflow
      const fixedElements = [];
      const allElements = document.querySelectorAll('*');

      allElements.forEach((el) => {
        // Skip structural elements that naturally match viewport width
        const tag = el.tagName.toLowerCase();
        if (
          tag === 'html' ||
          tag === 'body' ||
          tag === 'head' ||
          tag === 'script' ||
          tag === 'style'
        )
          return;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const rect = el.getBoundingClientRect();
        // Skip zero-size elements
        if (rect.width === 0 || rect.height === 0) return;

        // Only an element that actually overflows the 320px viewport can break reflow
        if (rect.width <= viewportWidth + 1) return;

        // Only flag elements with an authored fixed width / min-width above 320px
        const authored = authoredWidths(el);
        const hasFixedCssWidth = authored.width && parseFloat(authored.width) > 320;
        const hasFixedMinWidth = authored.minWidth && parseFloat(authored.minWidth) > 320;

        if (!hasFixedCssWidth && !hasFixedMinWidth) return;
        // Skip elements properly contained in a scrollable ancestor
        if (isInsideScrollableContainer(el)) return;

        const selector =
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string'
            ? `.${el.className.split(' ').join('.')}`
            : '');

        fixedElements.push({
          selector,
          width: Math.round(rect.width),
          fixedWidth: hasFixedCssWidth ? authored.width : null,
          minWidth: hasFixedMinWidth ? authored.minWidth : null,
        });
      });

      return {
        // 1px tolerance for sub-pixel rounding of borders/shadows
        hasHorizontalScroll: Math.max(body.scrollWidth, html.scrollWidth) > viewportWidth + 1,
        fixedElements: fixedElements.slice(0, 10), // Limit to first 10
      };
    });

    // Take reflow test screenshot
    const reflowScreenshot = path.join(scanDir, 'reflow-test-320px.png');
    await page.screenshot({ path: reflowScreenshot, fullPage: true });

    if (reflowAnalysis.hasHorizontalScroll) {
      violations.push({
        criterion: '9.1.4.10',
        viewport: '320px width',
        issue: 'reflow-failure',
        description:
          'Content does not reflow properly at 320px width - horizontal scrolling required',
        screenshot: 'reflow-test-320px.png',
        suggestion: 'Use responsive design techniques to ensure content reflows at 320px width',
      });
    }

    // Report specific fixed-width elements
    reflowAnalysis.fixedElements.forEach((element) => {
      violations.push({
        criterion: '9.1.4.10',
        element: element.selector,
        viewport: '320px width',
        issue: 'fixed-width-element',
        description: `Element declares ${element.fixedWidth ? `width: ${element.fixedWidth}` : `min-width: ${element.minWidth}`} and renders ${element.width}px wide, exceeding the 320px reflow viewport`,
        suggestion: 'Use relative units (%, em, rem) or responsive design for element widths',
      });
    });
  }

  /**
   * Heuristic text spacing check (WCAG 1.4.12): concurrent-compatible, pure page.evaluate.
   * Detects CSS patterns that would cause clipping when text spacing is increased
   */
  async heuristicTextSpacingCheck(page) {
    log.debug('Running heuristic text spacing check...');

    const result = await page.evaluate(() => {
      const violations = [];
      let clippingContainers = 0;
      let importantOverrides = 0;

      function getSelector(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '')
        );
      }

      const allElements = document.querySelectorAll('*');

      function isSrOnly(el) {
        if (!el || el.nodeType !== 1) return false;
        const cls = el.className || '';
        if (typeof cls === 'string' && (/\bsr-only\b/.test(cls) || /\bvisually-hidden\b/.test(cls)))
          return true;
        const s = window.getComputedStyle(el);
        if (s.position !== 'absolute' && s.position !== 'fixed') return false;
        const w = parseFloat(s.width),
          h = parseFloat(s.height);
        if (w > 1 || h > 1) return false;
        if (s.overflow !== 'hidden') return false;
        return true;
      }

      /**
       * Height the author declared in px, from the inline style or from any
       * matching rule whose media query applies. getComputedStyle reports the
       * used height in px for every rendered box, so it cannot tell a box that
       * is pinned to a height from one that simply has one.
       */
      function authoredPxHeight(el, property) {
        const inline = el.style.getPropertyValue(property);
        if (inline && inline.endsWith('px')) return parseFloat(inline);
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules || []) {
              const apply = (styleRule) => {
                const value = styleRule.style.getPropertyValue(property);
                if (!value || !value.endsWith('px')) return null;
                try {
                  return el.matches(styleRule.selectorText) ? parseFloat(value) : null;
                } catch (e) {
                  return null;
                }
              };
              if (rule instanceof CSSStyleRule) {
                const hit = apply(rule);
                if (hit !== null) return hit;
              } else if (
                rule instanceof CSSMediaRule &&
                window.matchMedia(rule.conditionText).matches
              ) {
                for (const inner of rule.cssRules) {
                  if (!(inner instanceof CSSStyleRule)) continue;
                  const hit = apply(inner);
                  if (hit !== null) return hit;
                }
              }
            }
          } catch (e) {
            /* cross-origin */
          }
        }
        return null;
      }

      allElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (isSrOnly(el)) return;

        const overflow = style.overflow;
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        const isOverflowHidden =
          overflow === 'hidden' || overflowY === 'hidden' || overflowX === 'hidden';

        if (!isOverflowHidden) return;

        // Only check elements with text content
        const text = el.textContent.trim();
        if (!text || text.length < 5) return;

        const height = style.height;
        const maxHeight = style.maxHeight;
        const whiteSpace = style.whiteSpace;
        const webkitLineClamp =
          style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp');

        const declaredHeight = authoredPxHeight(el, 'height');
        const declaredMaxHeight = authoredPxHeight(el, 'max-height');
        const hasFixedHeight = declaredHeight !== null;
        const hasMaxHeight = declaredMaxHeight !== null;
        const hasNowrap = whiteSpace === 'nowrap';
        const hasLineClamp = webkitLineClamp && webkitLineClamp !== 'none';

        if (hasFixedHeight || hasMaxHeight) {
          clippingContainers++;
          violations.push({
            criterion: '9.1.4.12',
            element: getSelector(el),
            issue: 'text-spacing-clip-risk',
            description: `Element with overflow:hidden and ${hasFixedHeight ? `fixed height (${height})` : `max-height (${maxHeight})`} will clip text when spacing is increased`,
            severity: 'serious',
            suggestion:
              'Use min-height instead of fixed height, or remove overflow:hidden to allow content to expand.',
          });
        }

        if (hasNowrap && isOverflowHidden) {
          clippingContainers++;
          violations.push({
            criterion: '9.1.4.12',
            element: getSelector(el),
            issue: 'text-spacing-nowrap-clip',
            description:
              'Element with white-space:nowrap and overflow:hidden will clip text when letter/word spacing increases',
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
            description:
              '-webkit-line-clamp restricts visible lines and will clip content when line-height increases',
            severity: 'moderate',
            suggestion:
              'Allow content to expand by removing line-clamp, or use a "show more" toggle.',
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

            // Skip universal selectors: these are typically user-override styles,
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
        // stylesheet access error, non-fatal
      }

      return { violations, clippingContainers, importantOverrides };
    });

    log.debug(
      `Heuristic text spacing check complete: ${result.violations.length} violations found`
    );
    return result;
  }

  /**
   * Heuristic reflow check (WCAG 1.4.10): detects fixed-width elements that prevent reflow at 320px.
   * Scans CSS rules (not computed styles) to avoid false positives from responsive layouts.
   */
  async heuristicReflowCheck(page) {
    log.debug('Running heuristic reflow check...');

    const result = await page.evaluate(() => {
      const violations = [];

      // An ancestor that scrolls or clips absorbs a wide child: it never
      // reaches the document and cannot force the page to scroll sideways.
      function isInsideScrollableContainer(el) {
        let parent = el.parentElement;
        while (parent && parent !== document.documentElement) {
          const ps = window.getComputedStyle(parent);
          if (['auto', 'scroll', 'hidden', 'clip'].includes(ps.overflowX)) return true;
          parent = parent.parentElement;
        }
        return false;
      }

      function isSrOnly(el) {
        if (!el || el.nodeType !== 1) return false;
        const cls = el.className || '';
        if (typeof cls === 'string' && (/\bsr-only\b/.test(cls) || /\bvisually-hidden\b/.test(cls)))
          return true;
        const s = window.getComputedStyle(el);
        if (s.position !== 'absolute' && s.position !== 'fixed') return false;
        const w = parseFloat(s.width),
          h = parseFloat(s.height);
        if (w > 1 || h > 1) return false;
        if (s.overflow !== 'hidden') return false;
        return true;
      }

      // Selectors the author also styles inside a media query. Their width at
      // the reflow viewport is decided by the cascade, which reading one rule
      // cannot tell; testContentReflow measures those at 320px instead.
      const responsiveSelectors = new Set();
      const collectMediaSelectors = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules) {
            if (rule instanceof CSSMediaRule) {
              for (const inner of rule.cssRules) {
                if (inner.selectorText) responsiveSelectors.add(inner.selectorText);
              }
            }
            collectMediaSelectors(Array.from(rule.cssRules));
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          collectMediaSelectors(Array.from(sheet.cssRules || []));
        } catch (e) {
          /* cross-origin */
        }
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
              if (responsiveSelectors.has(sel)) continue;

              const widthVal = rule.style.width;
              const minWidthVal = rule.style.minWidth;

              if (widthVal && widthVal.endsWith('px') && parseFloat(widthVal) > 320) {
                const matched = document.querySelectorAll(sel);
                const validMatches = Array.from(matched).filter((el) => {
                  const s = window.getComputedStyle(el);
                  return (
                    s.display !== 'none' &&
                    s.visibility !== 'hidden' &&
                    !isInsideScrollableContainer(el) &&
                    !isSrOnly(el)
                  );
                });
                if (validMatches.length > 0) {
                  pxWidthRules.push({
                    selector: sel,
                    property: 'width',
                    value: widthVal,
                    count: validMatches.length,
                  });
                }
              }

              if (minWidthVal && minWidthVal.endsWith('px') && parseFloat(minWidthVal) > 320) {
                const matched = document.querySelectorAll(sel);
                const validMatches = Array.from(matched).filter((el) => {
                  const s = window.getComputedStyle(el);
                  return (
                    s.display !== 'none' &&
                    s.visibility !== 'hidden' &&
                    !isInsideScrollableContainer(el) &&
                    !isSrOnly(el)
                  );
                });
                if (validMatches.length > 0) {
                  pxWidthRules.push({
                    selector: sel,
                    property: 'min-width',
                    value: minWidthVal,
                    count: validMatches.length,
                  });
                }
              }
            }
          } catch (e) {
            /* cross-origin */
          }
        }
      } catch (e) {
        /* no stylesheets */
      }

      for (const rule of pxWidthRules) {
        violations.push({
          criterion: '9.1.4.10',
          element: rule.selector,
          issue: rule.property === 'width' ? 'reflow-fixed-width' : 'reflow-min-width',
          description: `CSS rule "${rule.selector}" sets ${rule.property}: ${rule.value} which exceeds 320px reflow threshold, affecting ${rule.count} element(s)`,
          severity: 'serious',
          suggestion:
            'Use max-width with relative units (%, vw, rem) instead of fixed pixel width.',
        });
      }

      // Also check inline styles on elements
      const allElements = document.querySelectorAll('[style]');
      allElements.forEach((el) => {
        const inlineWidth = el.style.width;
        const inlineMinWidth = el.style.minWidth;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (isInsideScrollableContainer(el)) return;
        if (isSrOnly(el)) return;

        const getSelector = (e) =>
          e.tagName.toLowerCase() +
          (e.id ? `#${e.id}` : '') +
          (e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : '');

        if (inlineWidth && inlineWidth.endsWith('px') && parseFloat(inlineWidth) > 320) {
          violations.push({
            criterion: '9.1.4.10',
            element: getSelector(el),
            issue: 'reflow-fixed-width',
            description: `Element has inline style width: ${inlineWidth} which exceeds 320px reflow threshold`,
            severity: 'serious',
            suggestion:
              'Use max-width with relative units (%, vw, rem) instead of fixed pixel width.',
          });
        }

        if (inlineMinWidth && inlineMinWidth.endsWith('px') && parseFloat(inlineMinWidth) > 320) {
          violations.push({
            criterion: '9.1.4.10',
            element: getSelector(el),
            issue: 'reflow-min-width',
            description: `Element has inline style min-width: ${inlineMinWidth} which prevents reflow below 320px`,
            severity: 'serious',
            suggestion:
              'Remove or reduce min-width to allow content to reflow at narrow viewports.',
          });
        }
      });

      return { violations };
    });

    log.debug(`Heuristic reflow check complete: ${result.violations.length} violations found`);
    return result;
  }

  /**
   * Heuristic text resize check (WCAG 1.4.4): concurrent-compatible, pure read.
   *
   * Reports only text that is measurably cut off: `__findClippedText()`
   * compares the painted line boxes of every text node against the padding box
   * of its innermost clipping container. A px font-size alone is not a resize
   * failure (browser zoom scales px text like rem text), and an
   * `overflow: hidden` container with no clipped characters is not one either.
   */
  async heuristicTextResizeCheck(page) {
    log.debug('Running heuristic text resize check...');

    const result = await page.evaluate(
      (renderedCode, clipCode) => {
        eval(renderedCode);
        eval(clipCode);

        const violations = [];
        const clipped = window.__findClippedText({ minChars: 3 }) || [];

        for (const c of clipped) {
          // Author-declared truncation (ellipsis / -webkit-line-clamp) is a design
          // decision that applies at every size; the full text stays in the DOM.
          if (c.truncationDeclared) continue;

          const axis =
            c.axis === 'both'
              ? `${c.overshootX}px horizontally and ${c.overshootY}px vertically`
              : c.axis === 'horizontal'
                ? `${c.overshootX}px horizontally`
                : `${c.overshootY}px vertically`;

          violations.push({
            criterion: '9.1.4.4',
            element: c.selector,
            issue: 'text-resize-clip-risk',
            description: `Text is cut off inside ${c.selector} (overflow: ${c.overflow}, height: ${c.height}): ${c.clippedChars} characters extend ${axis} beyond the visible box, e.g. "${c.samples[0]}"`,
            severity: 'serious',
            suggestion:
              'Use min-height instead of a fixed height, or change overflow to auto/visible, so the text stays visible when it is enlarged.',
          });
        }

        return { violations };
      },
      renderedCode,
      textClippingCode
    );

    log.debug(`Heuristic text resize check complete: ${result.violations.length} violations found`);
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
