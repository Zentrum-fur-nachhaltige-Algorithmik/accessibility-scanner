/**
 * Text Resize Scanner.
 * WCAG 1.4.4 (EN 301 549 9.1.4.4).
 * Loads the page at its reference width and again at half of it (200 percent
 * zoom) and reports the content and the functionality that the enlargement
 * loses: text a container cuts off, and controls another element covers.
 * Reflow at 320 CSS px (1.4.10) belongs to the responsive-design scanner.
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
    // 1.4.4 requires 200 percent; the reference run at 100 percent is what
    // makes "lost by the enlargement" measurable rather than assumed.
    this.testViewports = [
      { width: 1280, height: 1024, name: 'desktop', scale: 1 },
      { width: 640, height: 512, name: 'desktop-200%', scale: 2 },
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
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      timeout: TIMEOUTS.scanner,
      ...options,
    };

    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const violations = [];
    const viewportResults = {};
    const currentUrl = page.url();
    const viewports = scanOptions.viewports || this.testViewports;

    for (const viewport of viewports) {
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale,
      });

      // Reload so the page renders at the new viewport
      await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

      const result = await this.analyzeTextResizeCompliance(page, viewport, scanDir);
      viewportResults[viewport.name] = result;

      violations.push(
        ...result.violations.map((v) => ({
          ...v,
          viewport: viewport.name,
          zoomLevel: viewport.scale === 1 ? '100%' : `${viewport.scale * 100}%`,
        }))
      );
    }

    const finalViolations = this.groupBlockingByOverlay(
      this.deduplicateAcrossViewports(this.filterZoomInducedLoss(violations, viewports))
    );

    return {
      scannerId: this.id,
      criteria: ['1.4.4'],
      passed: finalViolations.length === 0,
      violations: finalViolations,
      summary: {
        totalViewportsTested: viewports.length,
        textFlowIssues: finalViolations.filter((v) => v.type === 'text-overflow').length,
        blockedInteractions: finalViolations.filter((v) => v.type === 'interaction-blocked').length,
      },
      viewportResults: viewportResults,
      screenshotPath: scanDir,
      recommendations: this.generateTextResizeRecommendations(finalViolations),
    };
  }

  /**
   * 1.4.4 is about what the enlargement costs, so only what the reference run
   * did not already show counts.
   *
   * A carousel track whose off-frame slides are clipped at every width, and an
   * element that a fixed bar covers at the reference width as well, are
   * permanent layout facts (the second is 2.4.11, measured by
   * focus-management); neither is caused by zooming to 200 percent.
   */
  filterZoomInducedLoss(violations, viewports) {
    const isReference = (v) => v.scale === 1 && v.width >= 1024;
    const referenceNames = new Set(viewports.filter(isReference).map((v) => v.name));
    const zoomNames = new Set(viewports.filter((v) => !isReference(v)).map((v) => v.name));
    const baselineKeys = new Set(
      violations
        .filter((v) => referenceNames.has(v.viewport))
        .map((v) => `${v.type}::${v.blockedKey || v.element || ''}`)
    );
    return violations.filter((v) => {
      if (!zoomNames.has(v.viewport)) return false;
      return !baselineKeys.has(`${v.type}::${v.blockedKey || v.element || ''}`);
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
        description: `${overlay} covers interactive content at 200 percent zoom`,
        details: { ...v.details, blockedElements: [v.element] },
        affectedViewports: [...(v.affectedViewports || [])],
      });
    }
    for (const g of map.values()) {
      g.description = `${g.element} covers ${g.details.blockedElements.length} interactive element(s) at 200 percent zoom`;
    }
    return [...rest, ...map.values()];
  }

  /**
   * One finding per (type, element) across the tested viewports.
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
   * Measure one viewport: text cut off, and controls covered.
   */
  async analyzeTextResizeCompliance(page, viewport, scanDir) {
    const violations = [];

    const screenshotPath = path.join(scanDir, `${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Text that is provably clipped away at this viewport.
    //
    // WCAG 1.4.4 is about loss of information, so the painted glyph boxes
    // (Range.getClientRects) are measured against the container's padding box
    // instead of comparing scrollWidth/clientWidth, which fires on containers
    // whose child box sticks out by a few rounded pixels while all text stays
    // inside (see src/utils/text-clipping.js).
    const clippedText = await page.evaluate(
      (renderedSrc, clipSrc) => {
        eval(renderedSrc);
        eval(clipSrc);
        return window.__findClippedText({ minChars: 3 });
      },
      renderedCode,
      clipCode
    );

    for (const issue of clippedText) {
      // Declared truncation (line-clamp / ellipsis) looks identical at every
      // zoom level and keeps the text in the accessibility tree.
      if (issue.truncationDeclared) continue;
      violations.push({
        type: 'text-overflow',
        severity: 'serious',
        description: `Text is cut off (${issue.axis}) by an unscrollable overflow:hidden container at 200 percent zoom`,
        element: issue.selector,
        details: {
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
        wcagCriteria: '1.4.4',
        impact: 'Text content is cut off and cannot be revealed by scrolling',
      });
    }

    // Interactive elements that are rendered and keyboard-reachable but
    // whose centre is covered by another element at this zoom level.
    // Elements that are display:none (responsive nav behind a hamburger),
    // off-canvas, or simply scrolled out of view are not blocked.
    const interactionIssues = await page.evaluate((renderedSrc) => {
      eval(renderedSrc);
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
        wcagCriteria: '1.4.4',
        impact: 'User cannot interact with this element at 200 percent zoom',
      });
    }

    return {
      viewport: viewport.name,
      zoomLevel: viewport.scale,
      violations: violations,
      screenshotPath: screenshotPath,
      summary: {
        textOverflowIssues: clippedText.length,
        interactionIssues: interactionIssues.length,
      },
    };
  }

  /**
   * Generate recommendations for text resize issues
   */
  generateTextResizeRecommendations(violations) {
    const recommendations = [];
    const issueTypes = [...new Set(violations.map((v) => v.type))];

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
}

module.exports = TextResizeScanner;
