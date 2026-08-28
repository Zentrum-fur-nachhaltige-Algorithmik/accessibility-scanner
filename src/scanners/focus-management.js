/**
 * Focus Management Scanner.
 * WCAG 2.4.3, 2.4.7, 2.4.11 (EN 301 549 9.2.4.3, 9.2.4.7, 9.2.4.11).
 * Walks the tab sequence to check focus order, visible focus indicators,
 * focus not obscured and focus handling in modals, with screenshot evidence.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const {
  tabWalk,
  cleanupTabWalk,
  TAB_ATTR,
  EMBEDDED_CONTENT_TAGS,
} = require('../utils/keyboard-focus');
const { injectableCode: renderedCode } = require('../utils/rendered');
const log = require('../utils/logger').createLogger('focus-management');

class FocusManagementScanner extends BaseScanner {
  constructor() {
    super('focus-management', {
      wcagCriteria: ['2.4.3', '2.4.7', '2.4.11'],
      wcagPrinciple: 'operable',
    });
  }

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
    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `focus-scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const focusResults = await this.performFocusAnalysis(page, scanDir);

    return {
      scannerId: this.id,
      criteria: ['9.2.4.3', '9.2.4.7', '9.2.4.11'],
      passed: focusResults.violations.length === 0,
      violations: focusResults.violations,
      summary: {
        logicalTabOrder: focusResults.logicalTabOrder,
        allElementsHaveVisibleFocus: focusResults.allElementsHaveVisibleFocus,
        focusTraps: focusResults.focusTraps,
        focusNotObscured: focusResults.focusNotObscured,
      },
      screenshotPath: scanDir,
      focusSequence: focusResults.focusSequence,
      visualAnalysis: focusResults.visualAnalysis,
    };
  }

  /**
   * Perform comprehensive focus analysis
   */
  async performFocusAnalysis(page, scanDir) {
    const violations = [];
    let logicalTabOrder = true;
    let allElementsHaveVisibleFocus = true;
    let focusTraps = 0;

    log.debug('Analyzing focus management with visual validation...');

    // 1. Analyze reading order vs. tab order
    const readingOrderAnalysis = await this.analyzeReadingOrder(page, scanDir);

    // 2. Test focus sequence with visual validation
    const focusTestResults = await this.testFocusSequence(page, scanDir);

    // 3. Focus order (SC 2.4.3). The one order defect a machine can decide is
    //    a tab sequence that walks BACKWARDS through the document, which only
    //    a positive tabindex produces. Measured during the walk itself
    //    (step.domOrderBack), so a multi-column layout, an RTL page or a
    //    source-order-for-mobile sidebar, all of which move focus visually
    //    upwards or leftwards while following the document, stay silent.
    const backwardSteps = this.findBackwardTabSteps(focusTestResults.sequence);
    logicalTabOrder = backwardSteps.length === 0;
    if (backwardSteps.length > 0) {
      const first = backwardSteps[0];
      violations.push({
        criterion: '9.2.4.3',
        element: first.element,
        issue: 'illogical-tab-order',
        description:
          `Tab moves backwards through the document at "${first.element}"` +
          (first.tabIndexValue > 0 ? ` (tabindex="${first.tabIndexValue}")` : '') +
          `: ${backwardSteps.length} of ${focusTestResults.sequence.length} tab stops are reached ` +
          'out of document order, so the focus order does not follow the reading order.',
        occurrences: backwardSteps.length,
        affectedElements: backwardSteps.slice(0, 25).map((s) => s.element),
        suggestion:
          'Remove positive tabindex values and put the elements in the document in the order they should be read.',
      });
    }

    // 4. Validate focus visibility for all elements (SC 2.4.7: an indicator
    //    must exist). Indicator CONTRAST is SC 1.4.11 and is reported once, by
    //    nontext-contrast: a low-contrast ring is visible, so it is not a
    //    2.4.7 failure and must not be double-counted here.
    for (const focusItem of focusTestResults.sequence) {
      if (
        !focusItem.hasVisibleFocus &&
        !focusItem.lowContrastFocus &&
        focusItem.indicatorConfirmed &&
        !EMBEDDED_CONTENT_TAGS.has(focusItem.tag)
      ) {
        allElementsHaveVisibleFocus = false;
        violations.push({
          criterion: '9.2.4.7',
          element: focusItem.element,
          issue: 'no-visible-focus',
          description: 'Element receives focus but has no visible focus indicator',
          suggestion:
            'Add CSS :focus-visible styles with visible outline, box-shadow, or background color',
        });
      }
    }

    // 5. Test focus not obscured (WCAG 2.4.11) BEFORE the modal tests below
    //    open dialogs and leave fixed overlays on the page
    let focusNotObscured = true;
    const obscuredResults = await this.analyzeFocusObscured(
      page,
      focusTestResults.sequence,
      violations
    );
    focusNotObscured = obscuredResults.notObscured;

    // 6. Test focus management in dynamic content
    const dynamicFocusResults = await this.testDynamicFocusManagement(page, scanDir);
    violations.push(...dynamicFocusResults.violations);

    return {
      violations,
      logicalTabOrder,
      allElementsHaveVisibleFocus,
      focusTraps: focusTraps,
      focusNotObscured,
      focusSequence: focusTestResults.sequence,
      visualAnalysis: focusTestResults.visualAnalysis,
      readingOrderAnalysis,
    };
  }

  /**
   * Analyze reading order vs. visual layout
   */
  async analyzeReadingOrder(page, scanDir) {
    log.debug('Analyzing reading order vs. visual layout...');

    // Take full page screenshot for layout analysis
    await page.screenshot({
      path: path.join(scanDir, 'layout-analysis.png'),
      fullPage: true,
    });

    const layoutAnalysis = await page.evaluate(() => {
      const elements = [];
      const focusableSelector =
        'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

      document.querySelectorAll(focusableSelector).forEach((el, index) => {
        if (!el.hasAttribute('disabled') && !el.hidden) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            elements.push({
              index,
              element:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (el.className ? `.${el.className.split(' ').join('.')}` : ''),
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                left: rect.left,
              },
              tabIndex: el.tabIndex,
              text: el.textContent.trim().substring(0, 30),
            });
          }
        }
      });

      // Sort by visual position (top to bottom, left to right)
      const visualOrder = [...elements].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 10) {
          // If elements are on different lines
          return yDiff;
        }
        return a.rect.left - b.rect.left; // Same line, sort by left position
      });

      // Compare DOM order vs visual order
      const orderMismatches = [];
      elements.forEach((el, domIndex) => {
        const visualIndex = visualOrder.findIndex((vel) => vel.element === el.element);
        if (Math.abs(domIndex - visualIndex) > 2) {
          // Allow some tolerance
          orderMismatches.push({
            element: el.element,
            domOrder: domIndex,
            visualOrder: visualIndex,
            suggestion: 'Consider reordering elements in DOM to match visual layout',
          });
        }
      });

      return {
        totalElements: elements.length,
        domOrder: elements,
        visualOrder,
        orderMismatches,
      };
    });

    return layoutAnalysis;
  }

  /**
   * Test focus sequence with visual validation
   */
  async testFocusSequence(page, scanDir) {
    log.debug('Testing focus sequence with visual validation...');

    // Real keyboard Tab via src/utils/keyboard-focus.js: element identity by
    // tab id (two `a.nav__link`s are two elements, not a "trap"), focus
    // styles read from the live computed style after a genuine keyboard
    // focus so `:focus-visible` rules apply. The old loop compared
    // `getComputedStyle(el, ':focus')` (a pseudo-ELEMENT query that returns
    // the plain style) against itself, so border/background changes were
    // never detected.
    const sequence = [];
    const visualAnalysis = [];
    let stepIndex = 0;

    try {
      for await (const step of tabWalk(page, { maxSteps: 60, settleMs: 120 })) {
        if (step.stuck) {
          log.debug('Focus trap detected, ending sequence');
          break;
        }
        if (!step.rendered) continue;

        const afterPath = path.join(
          scanDir,
          `focus-step-${String(stepIndex).padStart(3, '0')}.png`
        );
        try {
          await page.screenshot({ path: afterPath });
        } catch (e) {
          /* screenshots are best-effort */
        }

        const ind = step.indicator;
        const item = {
          element: step.selector,
          tabId: step.tabId,
          rect: {
            x: step.rect.x + step.scrollX,
            y: step.rect.y + step.scrollY,
            width: step.rect.width,
            height: step.rect.height,
          },
          text: step.text,
          tag: step.tag,
          domOrderBack: step.domOrderBack === true,
          // Stamped during the walk instead of before it: revealed by the page
          // itself, so it has no place in the document's static order.
          dynamic: String(step.tabId).startsWith('dyn-'),
          tabIndexValue: step.tabIndexValue,
          hasVisibleFocus: ind.visible,
          lowContrastFocus: ind.lowContrast,
          // tabWalk re-measures every "no indicator" candidate (blur/refocus
          // comparison). Without that confirmation the verdict rests on the
          // absence of evidence in a single sample and must not be reported.
          indicatorConfirmed: ind.confirmed !== false,
          focusIndicators: {
            outline: ind.reasons.includes('outline') || ind.reasons.includes('outline-auto'),
            boxShadow: ind.reasons.includes('box-shadow'),
            borderChange: ind.reasons.includes('border'),
            backgroundChange: ind.reasons.includes('background'),
            other: ind.reasons.filter(
              (r) => !['outline', 'outline-auto', 'box-shadow', 'border', 'background'].includes(r)
            ),
          },
          styles: {
            outline: ind.outline,
            outlineColor: step.after.outlineColor,
            boxShadow: step.after.boxShadow,
            backgroundColor: step.after.backgroundColor,
            contrastRatio: ind.ratio,
          },
        };
        sequence.push(item);
        visualAnalysis.push({
          step: stepIndex,
          element: item.element,
          afterScreenshot: path.basename(afterPath),
          focusVisible: item.hasVisibleFocus,
          focusIndicators: item.focusIndicators,
          position: item.rect,
        });
        stepIndex++;
      }
    } finally {
      await cleanupTabWalk(page);
    }

    log.debug(`Focus sequence analysis complete: ${sequence.length} focusable elements`);
    return { sequence, visualAnalysis };
  }

  /**
   * Tab stops that were reached out of document order.
   * `domOrderBack` is measured inside the walk: the element that Tab landed on
   * comes BEFORE the previous tab stop in the document. Dynamically revealed
   * stops (a menu that opens during the walk) are left out, because their
   * position in the document says nothing about the order the user meets them.
   * @param {object[]} sequence tab stops from testFocusSequence
   * @returns {object[]} the offending stops
   */
  findBackwardTabSteps(sequence) {
    return sequence.filter((item, i) => i > 0 && item.domOrderBack && !item.dynamic);
  }

  /**
   * Focus handling when a dialog opens (SC 2.4.3).
   * Only elements that declare that they open a dialog are activated, and a
   * finding needs a dialog that was NOT on screen before the activation and
   * that does not contain focus afterwards. A page whose consent dialog was
   * already open, or whose button navigates somewhere, produces nothing.
   */
  async testDynamicFocusManagement(page, scanDir) {
    log.debug('Testing dynamic focus management...');

    const violations = [];

    const triggers = await page.evaluate((renderedHelpers) => {
      eval(renderedHelpers);
      const out = [];
      const candidates = document.querySelectorAll(
        '[aria-haspopup="dialog"], [data-toggle="modal"], [data-bs-toggle="modal"], [data-modal]'
      );
      let i = 0;
      for (const el of candidates) {
        if (!__isFocusableRendered(el)) continue;
        const marker = 'a11y-dialog-trigger-' + i++;
        el.setAttribute('data-a11y-dialog-trigger', marker);
        out.push({
          selector: '[data-a11y-dialog-trigger="' + marker + '"]',
          label:
            el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/)[0]
              : ''),
        });
      }
      return out;
    }, renderedCode);

    const dialogSelector =
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

    for (const [index, trigger] of triggers.entries()) {
      try {
        const openBefore = await page.evaluate(
          (renderedHelpers, sel, triggerSel) => {
            eval(renderedHelpers);
            const el = document.querySelector(triggerSel);
            if (el) el.focus();
            return [...document.querySelectorAll(sel)]
              .filter(__isRendered)
              .map((d) => d.outerHTML.slice(0, 120));
          },
          renderedCode,
          dialogSelector,
          trigger.selector
        );

        await page.keyboard.press('Enter');
        await new Promise((resolve) => setTimeout(resolve, 500));

        await page.screenshot({
          path: path.join(scanDir, `modal-test-${index}-after.png`),
        });

        const opened = await page.evaluate(
          (renderedHelpers, sel, before) => {
            eval(renderedHelpers);
            const focused = document.activeElement;
            for (const dialog of document.querySelectorAll(sel)) {
              if (!__isRendered(dialog)) continue;
              const key = dialog.outerHTML.slice(0, 120);
              if (before.includes(key)) continue; // already open before the activation
              return {
                selector:
                  dialog.tagName.toLowerCase() +
                  (dialog.id ? '#' + dialog.id : '') +
                  (typeof dialog.className === 'string' && dialog.className.trim()
                    ? '.' + dialog.className.trim().split(/\s+/)[0]
                    : ''),
                containsFocus: dialog.contains(focused),
              };
            }
            return null;
          },
          renderedCode,
          dialogSelector,
          openBefore
        );

        if (opened && !opened.containsFocus) {
          violations.push({
            criterion: '9.2.4.3',
            element: trigger.label,
            issue: 'focus-lost',
            description: `Activating "${trigger.label}" opens the dialog "${opened.selector}", but focus stays outside it`,
            suggestion:
              'Move focus into the dialog when it opens, to its first focusable element or to the dialog itself',
          });
        }

        // Leave the page as it was found for the checks that follow.
        await page.keyboard.press('Escape');
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        log.warn(`Error testing dialog trigger ${trigger.label}:`, error.message);
      }
    }

    await page
      .evaluate(() => {
        document
          .querySelectorAll('[data-a11y-dialog-trigger]')
          .forEach((el) => el.removeAttribute('data-a11y-dialog-trigger'));
      })
      .catch(() => {});

    return { violations };
  }

  /**
   * Analyze focus not obscured (WCAG 2.4.11)
   * Checks if focused elements are covered by fixed/sticky positioned elements
   */
  async analyzeFocusObscured(page, focusSequence, violations) {
    log.debug('Analyzing focus obscured by fixed/sticky elements...');

    // SC 2.4.11 is about the OUTCOME: when an element receives keyboard focus,
    // is it entirely hidden behind author-created content? So we tab through
    // the page for real and hit-test the focused element where it actually
    // ended up, instead of guessing from scroll-padding vs. header height
    // (which flagged closed mobile menus and position:static footers, FP-7)
    // or from stale rectangles that ignored that a link INSIDE a sticky header
    // is not obscured BY that header (FP-9).
    const hasFixed = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const p = window.getComputedStyle(el).position;
        if (p === 'fixed' || p === 'sticky') return true;
      }
      return false;
    });
    if (!hasFixed) return { notObscured: true };

    let notObscured = true;
    // One overlay, one defect: a fixed call-to-action bar that swallows the
    // footer links hides ALL of them for the same reason and is fixed once.
    // Grouped by the covering element, reported with the full element list.
    const byOverlay = new Map();

    // A 1920x1080 tab fits most pages without scrolling, so nothing can be
    // scrolled behind a fixed bar. Test at a common laptop viewport instead
    // and restore afterwards.
    const prevViewport = page.viewport();
    await page.setViewport({ width: 1280, height: 720 });

    try {
      for await (const step of tabWalk(page, { maxSteps: 80, settleMs: 120 })) {
        if (step.stuck) break;
        if (!step.rendered) continue;

        const result = await page.evaluate(
          (ATTR, tabId) => {
            const el = document.querySelector(`[${ATTR}="${tabId}"]`);
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            const inset = Math.min(2, rect.width / 4, rect.height / 4);
            const points = [
              [rect.left + rect.width / 2, rect.top + rect.height / 2],
              [rect.left + inset, rect.top + inset],
              [rect.right - inset, rect.top + inset],
              [rect.left + inset, rect.bottom - inset],
              [rect.right - inset, rect.bottom - inset],
            ];
            const vw = window.innerWidth,
              vh = window.innerHeight;
            let covered = 0,
              coverer = null,
              position = null,
              offscreen = 0;
            for (const [x, y] of points) {
              if (x < 0 || y < 0 || x >= vw || y >= vh) {
                offscreen++;
                continue;
              }
              const hit = document.elementFromPoint(x, y);
              if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
              // Is the covering element (or an ancestor of it) fixed/sticky and NOT an ancestor of el?
              let n = hit,
                overlay = null;
              while (n && n !== document.body) {
                const pos = window.getComputedStyle(n).position;
                if ((pos === 'fixed' || pos === 'sticky') && !n.contains(el)) {
                  overlay = n;
                  break;
                }
                n = n.parentElement;
              }
              if (!overlay) continue;
              // A transparent layer hides nothing. The element the hit test
              // returned covers the point only if it, or something between it
              // and the overlay, actually paints: a background colour with
              // alpha, a background image, or its own text.
              let paints = false;
              for (let m = hit; m; m = m.parentElement) {
                const ms = window.getComputedStyle(m);
                const bg = ms.backgroundColor || '';
                const rgba = bg.match(/rgba?\(([^)]+)\)/);
                const alpha = rgba ? parseFloat(rgba[1].split(',')[3] ?? '1') : 0;
                if (alpha > 0.05 || ms.backgroundImage !== 'none' || ms.backdropFilter !== 'none') {
                  paints = true;
                  break;
                }
                if (m === overlay) break;
              }
              if (!paints && !(hit.textContent || '').trim()) continue;
              covered++;
              if (!coverer) {
                position = window.getComputedStyle(overlay).position;
                coverer =
                  overlay.tagName.toLowerCase() +
                  (overlay.id ? '#' + overlay.id : '') +
                  (typeof overlay.className === 'string' && overlay.className.trim()
                    ? '.' + overlay.className.trim().split(/\s+/)[0]
                    : '');
              }
            }
            // Entirely hidden = every on-screen sample point is behind an overlay.
            const sampled = points.length - offscreen;
            return {
              sampled,
              covered,
              coverer,
              position,
              entirely: sampled > 0 && covered === sampled,
            };
          },
          TAB_ATTR,
          step.tabId
        );

        if (!result || !result.entirely) continue;
        const key = `${result.position}|${result.coverer}`;
        let group = byOverlay.get(key);
        if (!group) {
          group = { coverer: result.coverer, position: result.position, elements: [] };
          byOverlay.set(key, group);
        }
        if (!group.elements.some((e) => e.selector === step.selector)) {
          group.elements.push({ selector: step.selector, text: step.text });
        }
        notObscured = false;
      }
    } finally {
      await cleanupTabWalk(page);
      if (prevViewport) await page.setViewport(prevViewport).catch(() => {});
    }

    for (const group of byOverlay.values()) {
      const first = group.elements[0];
      const more = group.elements.length > 1 ? ` (and ${group.elements.length - 1} more)` : '';
      violations.push({
        criterion: '9.2.4.11',
        element: first.selector,
        issue: `focus-obscured-by-${group.position}-element`,
        description: `Focused element "${first.selector}"${more} is entirely hidden behind ${group.position} element "${group.coverer}"`,
        severity: 'serious',
        occurrences: group.elements.length,
        affectedElements: group.elements.slice(0, 25).map((e) => e.selector),
        suggestion: `Add scroll-padding (or scroll-margin on focus targets) so focused elements scroll clear of "${group.coverer}", or reduce that element's size/z-index.`,
      });
    }

    return { notObscured };
  }
}

module.exports = FocusManagementScanner;
