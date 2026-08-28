/**
 * Responsive Design Scanner.
 * WCAG 1.4.10, 1.4.12 (EN 301 549 9.1.4.10, 9.1.4.12).
 * Measures reflow at the 320 CSS px reference viewport and, after injecting
 * the 1.4.12 text spacing values, the text those values push out of its box.
 * 1.4.4 (resize text) belongs to the text-resize scanner.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS, DEVICES } = require('../core/constants');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: textClippingCode } = require('../utils/text-clipping');
const log = require('../utils/logger').createLogger('responsive-design');

/**
 * The user text spacing of WCAG 1.4.12, injected as a style sheet so the
 * page is measured in the state the criterion describes.
 */
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

/**
 * Horizontal overflow of the whole page, measured without the images that
 * show nothing: an image with no intrinsic width has delivered no pixels, and
 * a dead <img width="1400"> laid out at its attribute width would otherwise be
 * read as a reflow failure of a layout that reflows.
 */
const OVERFLOW_CODE = `
if (typeof window.__pageOverflow !== 'function') {
  window.__pageOverflow = function () {
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    var width = function () {
      return Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    };
    var scrollWidth = width();
    // 1px tolerance: sub-pixel rounding of borders and shadows is not reflow
    if (scrollWidth <= viewportWidth + 1) {
      return { overflows: false, scrollWidth: scrollWidth, viewportWidth: viewportWidth, brokenImages: 0 };
    }
    var broken = [];
    var images = document.querySelectorAll('img');
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      if (img.naturalWidth === 0 && img.getBoundingClientRect().width > 0) broken.push(img);
    }
    if (!broken.length) {
      return { overflows: true, scrollWidth: scrollWidth, viewportWidth: viewportWidth, brokenImages: 0 };
    }
    var saved = broken.map(function (img) { return img.getAttribute('style'); });
    broken.forEach(function (img) { img.style.setProperty('display', 'none', 'important'); });
    var without = width();
    broken.forEach(function (img, k) {
      if (saved[k] === null) img.removeAttribute('style');
      else img.setAttribute('style', saved[k]);
    });
    return {
      overflows: without > viewportWidth + 1,
      scrollWidth: without,
      viewportWidth: viewportWidth,
      brokenImages: broken.length
    };
  };
}
`;

class ResponsiveDesignScanner extends BaseScanner {
  constructor() {
    super('responsive-design', {
      wcagCriteria: ['1.4.10', '1.4.12'],
      wcagPrinciple: 'perceivable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * Re-navigates internally (viewport cycling) since it has exclusive access.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      viewports: [DEVICES.reflow320, DEVICES.iphoneSe, DEVICES.ipad, DEVICES.desktop],
      testZoomLevels: [100, 200, 320, 400],
      timeout: TIMEOUTS.scanner,
      ...options,
    };

    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    // Fast mode: the same two measurements, without the viewport matrix and
    // without screenshots. Both still measure; neither reads a declaration.
    if (scanOptions.heuristicOnly) {
      const original = page.viewport();
      const spacing = await this.measureTextSpacing(page);
      const reflow = await this.measureReflow(page);
      if (original) await page.setViewport(original);

      const allViolations = this.deduplicateViolations([...spacing, ...reflow]);
      return {
        scannerId: this.id,
        criteria: ['9.1.4.10', '9.1.4.12'],
        passed: allViolations.length === 0,
        violations: allViolations,
        summary: {
          textSpacingOk: spacing.length === 0,
          reflowOk: reflow.length === 0,
          heuristicOnly: true,
        },
      };
    }

    const url = page.url();
    const responsiveResults = await this.performResponsiveAnalysis(page, url, scanDir, scanOptions);
    const allViolations = this.deduplicateViolations(responsiveResults.violations);

    return {
      scannerId: this.id,
      criteria: ['9.1.4.10', '9.1.4.12'],
      passed: allViolations.length === 0,
      violations: allViolations,
      summary: {
        reflowWorks: responsiveResults.reflowWorks,
        textSpacingOk: responsiveResults.textSpacingOk,
        viewportsTested: scanOptions.viewports.length,
        zoomLevelsTested: scanOptions.testZoomLevels.length,
      },
      screenshotPath: scanDir,
      visualEvidence: responsiveResults.visualEvidence,
    };
  }

  /**
   * Full mode: every viewport and zoom level, with screenshots as evidence.
   */
  async performResponsiveAnalysis(page, url, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let reflowWorks = true;
    let textSpacingOk = true;

    log.debug('Starting responsive design analysis...');

    await page.goto(url, { waitUntil: 'networkidle0', timeout: options.timeout });

    for (const viewport of options.viewports) {
      log.debug(`Testing viewport: ${viewport.name} (${viewport.width}x${viewport.height})`);

      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const baselineScreenshot = path.join(
        scanDir,
        `${viewport.name.replace(/\s+/g, '-')}-baseline.png`
      );
      await page.screenshot({ path: baselineScreenshot, fullPage: true });

      for (const zoomLevel of options.testZoomLevels) {
        const zoomResults = await this.testZoomLevel(
          page,
          scanDir,
          viewport,
          zoomLevel,
          violations
        );
        if (zoomResults.skipped) continue;
        if (zoomResults.hasHorizontalScroll) reflowWorks = false;
        visualEvidence.push({
          viewport: viewport.name,
          zoomLevel: zoomLevel,
          screenshot: zoomResults.screenshot,
          hasHorizontalScroll: zoomResults.hasHorizontalScroll,
        });
      }

      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const spacing = await this.measureTextSpacing(page, {
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        scanDir,
        screenshotName: `${viewport.name.replace(/\s+/g, '-')}-text-spacing.png`,
      });
      if (spacing.length > 0) textSpacingOk = false;
      violations.push(...spacing);
    }

    const reflow = await this.measureReflow(page, { scanDir });
    if (reflow.some((v) => v.issue === 'reflow-failure')) {
      reflowWorks = false;
      // The page-level overflow is one failure of 1.4.10. The 320px reference
      // measurement owns it; the zoom steps of the viewport matrix see the
      // same overflow and must not report it a second time.
      for (let i = violations.length - 1; i >= 0; i--) {
        if (violations[i].issue === 'horizontal-scroll') violations.splice(i, 1);
      }
    }
    violations.push(...reflow);

    log.debug(`Responsive analysis complete: ${violations.length} raw violations`);

    return { violations, visualEvidence, reflowWorks, textSpacingOk };
  }

  /**
   * Test one zoom level for horizontal scrolling (WCAG 1.4.10).
   *
   * Zoom is emulated by shrinking the CSS viewport (width / zoom), which is
   * what browser zoom does to layout; `body.style.zoom` would break
   * position:fixed/sticky and vw units. WCAG 1.4.10 only requires reflow down
   * to 320 CSS px, so a combination that emulates a narrower width is skipped,
   * and so is the 320 px reference width itself, which `measureReflow` owns.
   */
  async testZoomLevel(page, scanDir, viewport, zoomLevel, violations) {
    const MIN_REFLOW_WIDTH = 320;
    const cssWidth = Math.round((viewport.width * 100) / zoomLevel);
    const cssHeight = Math.max(Math.round((viewport.height * 100) / zoomLevel), 256);

    if (cssWidth <= MIN_REFLOW_WIDTH) {
      return { screenshot: null, hasHorizontalScroll: false, skipped: true };
    }

    await page.setViewport({ width: cssWidth, height: cssHeight, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const screenshotName = `${viewport.name.replace(/\s+/g, '-')}-zoom-${zoomLevel}.png`;
    await page.screenshot({ path: path.join(scanDir, screenshotName), fullPage: true });

    const scrollAnalysis = await page.evaluate((overflowSrc) => {
      eval(overflowSrc);
      const measured = window.__pageOverflow();
      return {
        hasHorizontalScroll: measured.overflows,
        scrollWidth: measured.scrollWidth,
        clientWidth: measured.viewportWidth,
      };
    }, OVERFLOW_CODE);

    if (scrollAnalysis.hasHorizontalScroll) {
      violations.push({
        criterion: '9.1.4.10',
        viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
        zoomLevel: zoomLevel,
        issue: 'horizontal-scroll',
        severity: 'serious',
        description: `Content is ${scrollAnalysis.scrollWidth}px wide in a ${scrollAnalysis.clientWidth}px viewport at ${zoomLevel}% zoom, so it has to be scrolled sideways`,
        screenshot: screenshotName,
        suggestion:
          'Implement responsive design to eliminate horizontal scrolling at all zoom levels',
      });
    }

    return {
      screenshot: screenshotName,
      hasHorizontalScroll: scrollAnalysis.hasHorizontalScroll,
    };
  }

  /**
   * Measure WCAG 1.4.12 by applying the spacing values and looking for text
   * that is pushed out of its box.
   *
   * Clipping is measured before and after the injection and only text that
   * becomes newly clipped is reported: a carousel, a custom scrollbar or a
   * decorative overflow:hidden container that was already overflowing is not
   * a 1.4.12 failure. A page that already meets the spacing values is
   * measured in its own state. One finding per element.
   *
   * The declarations themselves decide nothing: a nowrap pill button with 24px
   * of padding never clips its label, and a user style sheet's `!important`
   * beats an author's in the cascade.
   */
  async measureTextSpacing(page, options = {}) {
    const spacingResult = await page.evaluate(
      (renderedSrc, css) => {
        eval(renderedSrc);

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
          const truncated = cs.whiteSpace === 'nowrap';
          // Author-declared truncation (-webkit-line-clamp, text-overflow:
          // ellipsis) cuts the text off at every width and zoom level alike
          // and keeps it in the DOM; it is a design decision, not a spacing
          // failure, so those elements are not candidates at all.
          const lineClamp = cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp');
          if ((lineClamp && lineClamp !== 'none') || cs.textOverflow === 'ellipsis') return;
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
              // Text that WAS fully visible and is clipped by the injected
              // spacing, or already clipped on a page that applies the 1.4.12
              // spacing itself (vertical clipping only; a horizontally clipped
              // baseline is a carousel, a marquee or an ellipsis).
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

    let screenshotName = null;
    if (options.scanDir && options.screenshotName) {
      screenshotName = options.screenshotName;
      await page
        .addStyleTag({ content: SPACING_CSS })
        .then(
          (h) =>
            h && h.evaluate((el) => el.setAttribute('data-a11y-text-spacing', '')).catch(() => {})
        );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(options.scanDir, screenshotName), fullPage: true });
      await page.evaluate(() => {
        document.querySelectorAll('style[data-a11y-text-spacing]').forEach((el) => el.remove());
      });
    }

    if (spacingResult.issues.length > 20) {
      log.debug(
        `  text-spacing: ${spacingResult.issues.length} clipped elements, reporting first 20`
      );
    }

    return spacingResult.issues.slice(0, 20).map((issue) => ({
      criterion: '9.1.4.12',
      element: issue.element,
      viewport: options.viewport,
      issue: 'text-spacing-failure',
      description: `Text in ${issue.element} is clipped by ${issue.clippedPx}px inside ${issue.container} when WCAG 1.4.12 text spacing is applied ("${issue.text}")`,
      severity: 'serious',
      screenshot: screenshotName,
      suggestion:
        'Let the container grow with its content (avoid fixed heights with overflow:hidden on text) so user text-spacing overrides do not clip text',
    }));
  }

  /**
   * Measure WCAG 1.4.10 at the 320 CSS px reference viewport.
   *
   * Three findings, all measured at that viewport: the document scrolls
   * sideways, an element with an authored px width wider than the viewport
   * causes it, and text is clipped away by an unscrollable container. An
   * authored width is read from the cascade rather than from
   * `getComputedStyle().width`, which is always a used px length and would
   * make every fluid box "fixed width"; `max-width` and a scrollable ancestor
   * (a permitted two-dimensional container) both clear the element.
   */
  async measureReflow(page, options = {}) {
    log.debug('Measuring reflow at 320px...');

    await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const reflowAnalysis = await page.evaluate(
      (renderedSrc, clipSrc, overflowSrc) => {
        eval(renderedSrc);
        eval(clipSrc);
        eval(overflowSrc);

        const viewportWidth = window.innerWidth || 320;

        /**
         * An ancestor that scrolls absorbs a wide child: the page does not
         * scroll sideways, and 1.4.10 allows a two-dimensional container.
         */
        function isInsideScrollableContainer(el) {
          let node = el;
          while (node && node !== document.documentElement) {
            const s = window.getComputedStyle(node);
            if (node !== el && (s.overflowX === 'auto' || s.overflowX === 'scroll')) return true;
            node = node.parentElement;
          }
          return false;
        }

        // Authored width and min-width, from the cascade.
        const styleRules = [];
        try {
          for (const sheet of document.styleSheets) {
            let rules;
            try {
              rules = sheet.cssRules;
            } catch (e) {
              continue; // cross-origin
            }
            if (!rules) continue;
            const walk = (list) => {
              for (const rule of list) {
                if (rule.media && rule.cssRules) {
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
              continue; // ::pseudo etc.
            }
            if (matches) take(r.width, r.minWidth);
          }
          take(el.style.width, el.style.minWidth); // inline style wins
          return { width, minWidth };
        }

        const fixedElements = [];
        document.querySelectorAll('body *').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
          if (!__isRendered(el)) return;

          const rect = el.getBoundingClientRect();
          // Only an element that really overflows the reference viewport can
          // break reflow: `.container{width:1140px;max-width:100%}` does not.
          if (rect.width <= viewportWidth + 1) return;

          const authored = authoredWidths(el);
          const hasFixedCssWidth = authored.width && parseFloat(authored.width) > 320;
          const hasFixedMinWidth = authored.minWidth && parseFloat(authored.minWidth) > 320;
          if (!hasFixedCssWidth && !hasFixedMinWidth) return;
          if (isInsideScrollableContainer(el)) return;

          const selector =
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (el.className && typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/)[0]}`
              : '');

          fixedElements.push({
            selector,
            width: Math.round(rect.width),
            fixedWidth: hasFixedCssWidth ? authored.width : null,
            minWidth: hasFixedMinWidth ? authored.minWidth : null,
          });
        });

        const clipped = (window.__findClippedText({ minChars: 3 }) || []).filter(
          // Author-declared truncation (ellipsis, -webkit-line-clamp) looks the
          // same at every width and keeps the full text in the DOM.
          (c) => !c.truncationDeclared
        );

        const overflow = window.__pageOverflow();

        return {
          hasHorizontalScroll: overflow.overflows,
          documentWidth: overflow.scrollWidth,
          viewportWidth,
          fixedElements: fixedElements.slice(0, 10),
          clipped: clipped.slice(0, 10),
        };
      },
      renderedCode,
      textClippingCode,
      OVERFLOW_CODE
    );

    if (options.scanDir) {
      await page.screenshot({
        path: path.join(options.scanDir, 'reflow-test-320px.png'),
        fullPage: true,
      });
    }

    const violations = [];

    if (reflowAnalysis.hasHorizontalScroll) {
      violations.push({
        criterion: '9.1.4.10',
        viewport: '320px width',
        issue: 'reflow-failure',
        description: `Content is ${reflowAnalysis.documentWidth}px wide at the 320px reflow viewport, so it has to be scrolled sideways`,
        severity: 'serious',
        screenshot: options.scanDir ? 'reflow-test-320px.png' : null,
        suggestion: 'Use responsive design techniques to ensure content reflows at 320px width',
      });
    }

    for (const element of reflowAnalysis.fixedElements) {
      violations.push({
        criterion: '9.1.4.10',
        element: element.selector,
        viewport: '320px width',
        issue: 'fixed-width-element',
        description: `Element declares ${element.fixedWidth ? `width: ${element.fixedWidth}` : `min-width: ${element.minWidth}`} and renders ${element.width}px wide, exceeding the 320px reflow viewport`,
        severity: 'serious',
        suggestion: 'Use relative units (%, em, rem) or responsive design for element widths',
      });
    }

    for (const c of reflowAnalysis.clipped) {
      const axis =
        c.axis === 'both'
          ? `${c.overshootX}px horizontally and ${c.overshootY}px vertically`
          : c.axis === 'horizontal'
            ? `${c.overshootX}px horizontally`
            : `${c.overshootY}px vertically`;
      violations.push({
        criterion: '9.1.4.10',
        element: c.selector,
        viewport: '320px width',
        issue: 'reflow-content-clipped',
        description: `Text is cut off inside ${c.selector} (overflow: ${c.overflow}, height: ${c.height}) at the 320px reflow viewport: ${c.clippedChars} characters extend ${axis} beyond the visible box, e.g. "${c.samples[0]}"`,
        severity: 'serious',
        suggestion:
          'Use min-height instead of a fixed height, or change overflow to auto/visible, so the text stays visible when the layout reflows.',
      });
    }

    return violations;
  }

  /**
   * Deduplicate violations by element+issue type, merging viewport/zoom metadata.
   * A single overflow reported at several viewport/zoom combinations becomes
   * one violation with an affectedViewports array.
   */
  deduplicateViolations(violations) {
    const map = new Map();

    for (const v of violations) {
      const elementKey = v.element || v.issue || '';
      const key = `${elementKey}::${v.issue}::${v.criterion}`;

      if (map.has(key)) {
        const existing = map.get(key);
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
