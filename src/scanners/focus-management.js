const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { tabWalk, cleanupTabWalk, TAB_ATTR } = require('../utils/keyboard-focus');
const log = require('../utils/logger').createLogger('focus-management');

/**
 * Focus Management Scanner for WCAG compliance testing
 * Implements EN 301 549 criteria 9.2.4.3, 9.2.4.7 (Focus Order, Focus Visible)
 * Analyzes logical tab order and visual focus indicators with screenshot validation
 */
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
   * Core scan method — receives an already-navigated Puppeteer page.
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

    // 1b. Check for global CSS rules that suppress focus indicators
    const globalFocusSuppression = await page.evaluate(() => {
      const suppressions = [];
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule instanceof CSSStyleRule && rule.selectorText) {
                const sel = rule.selectorText;
                // Detect broad :focus selectors that suppress outlines
                const isBroadFocus =
                  /^(\*)?:focus$/.test(sel.trim()) ||
                  /^:focus$/.test(sel.trim()) ||
                  sel.trim() === '*:focus' ||
                  sel.trim() === ':focus';
                if (isBroadFocus) {
                  const outline = rule.style.outline || rule.style.outlineStyle || '';
                  const outlineWidth = rule.style.outlineWidth || '';
                  const outlineColor = rule.style.outlineColor || '';
                  if (
                    outline === 'none' ||
                    outline === '0' ||
                    outlineWidth === '0' ||
                    outlineWidth === '0px' ||
                    outlineColor === 'transparent'
                  ) {
                    suppressions.push({
                      selector: sel,
                      property: outline
                        ? `outline: ${outline}`
                        : outlineWidth
                          ? `outline-width: ${outlineWidth}`
                          : `outline-color: ${outlineColor}`,
                      source: sheet.href || 'inline',
                    });
                  }
                }
              }
            }
          } catch (e) {
            /* cross-origin stylesheet */
          }
        }
      } catch (e) {
        /* no stylesheets */
      }
      return suppressions;
    });

    for (const suppression of globalFocusSuppression) {
      violations.push({
        criterion: '9.2.4.7',
        element: suppression.selector,
        issue: 'global-focus-outline-removed',
        description: `Global CSS rule "${suppression.selector} { ${suppression.property} }" removes focus indicators from all elements`,
        suggestion:
          'Remove the global focus suppression or replace with custom visible focus styles',
      });
    }

    // 2. Test focus sequence with visual validation
    const focusTestResults = await this.testFocusSequence(page, scanDir);

    // 3. Check for logical tab order violations
    logicalTabOrder = this.validateTabOrder(focusTestResults.sequence);
    if (!logicalTabOrder) {
      violations.push({
        criterion: '9.2.4.3',
        element: 'document',
        issue: 'illogical-tab-order',
        description: 'Tab order does not follow a logical sequence',
        suggestion: 'Adjust tabindex values or DOM order to match visual layout',
      });
    }

    // 4. Validate focus visibility for all elements (SC 2.4.7: an indicator
    //    must exist). Indicator CONTRAST is SC 1.4.11 and is reported once, by
    //    nontext-contrast — a low-contrast ring is visible, so it is not a
    //    2.4.7 failure and must not be double-counted here.
    for (const focusItem of focusTestResults.sequence) {
      if (
        !focusItem.hasVisibleFocus &&
        !focusItem.lowContrastFocus &&
        focusItem.indicatorConfirmed
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

    // 5. Test focus not obscured (WCAG 2.4.11) — BEFORE the modal tests below
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

    // 7. Test focus restoration
    const focusRestorationResults = await this.testFocusRestoration(page, scanDir);
    violations.push(...focusRestorationResults.violations);

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
   * Validate logical tab order
   */
  validateTabOrder(sequence) {
    if (sequence.length < 2) return true;

    // Check if tab order generally follows visual order (top-to-bottom, left-to-right)
    for (let i = 1; i < sequence.length; i++) {
      const prev = sequence[i - 1];
      const curr = sequence[i];

      // Moving UP is only illogical if we did not also move to a new column
      // on the right (multi-column footers, sidebars, card grids all do that).
      const yDiff = curr.rect.y - prev.rect.y;
      const xDiff = curr.rect.x - prev.rect.x;
      if (yDiff < -50 && xDiff < 50) {
        return false;
      }

      // If on same row, check left-to-right order
      if (Math.abs(yDiff) <= 20) {
        // Same row (within 20px)
        const xDiff = curr.rect.x - prev.rect.x;
        if (xDiff < -100) {
          // Current element is 100px+ to the left
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Test focus management in dynamic content (modals, dropdowns, etc.)
   */
  async testDynamicFocusManagement(page, scanDir) {
    log.debug('Testing dynamic focus management...');

    const violations = [];

    // Look for modal triggers (expanded selectors + text matching)
    const modalTriggers = await page.evaluate(() => {
      const triggers = [];
      const seen = new Set();
      const selectors = [
        '[data-toggle="modal"]',
        '[data-target*="modal"]',
        '[data-bs-toggle="modal"]',
        'button[data-modal]',
        '.modal-trigger',
        '.open-modal',
        '.show-modal',
        'button[aria-haspopup="dialog"]',
        '[aria-haspopup="true"]',
        '[aria-haspopup="dialog"]',
      ];

      function addTrigger(el) {
        const key = el.tagName + (el.id || '') + el.textContent.trim().substring(0, 20);
        if (seen.has(key)) return;
        seen.add(key);
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const className = el.className && typeof el.className === 'string' ? el.className : '';
          triggers.push({
            element:
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (className ? `.${className.split(' ').join('.')}` : ''),
            text: el.textContent.trim().substring(0, 30),
          });
        }
      }

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach(addTrigger);
      });

      // Text-based matching for buttons
      const modalTextPattern = /modal|dialog|öffnen|open|popup/i;
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const text =
          (el.textContent || '').trim() +
          (el.getAttribute('aria-label') || '') +
          (el.getAttribute('title') || '');
        if (modalTextPattern.test(text)) {
          addTrigger(el);
        }
      });

      return triggers;
    });

    // Test each modal trigger
    for (const [index, trigger] of modalTriggers.entries()) {
      try {
        // Focus on trigger
        await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (el) el.focus();
        }, trigger.element);

        // Take screenshot before activation
        await page.screenshot({
          path: path.join(scanDir, `modal-test-${index}-before.png`),
        });

        // Activate modal (try click and Enter key)
        await page.keyboard.press('Enter');
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Take screenshot after activation
        await page.screenshot({
          path: path.join(scanDir, `modal-test-${index}-after.png`),
        });

        // Check if focus moved to modal
        const focusInModal = await page.evaluate(() => {
          const modals = document.querySelectorAll('.modal, [role="dialog"], [role="alertdialog"]');
          const focused = document.activeElement;

          for (const modal of modals) {
            const modalRect = modal.getBoundingClientRect();
            if (modalRect.width > 0 && modalRect.height > 0) {
              if (modal.contains(focused)) {
                return {
                  modalFound: true,
                  focusInModal: true,
                  modalSelector:
                    modal.tagName.toLowerCase() +
                    (modal.id ? `#${modal.id}` : '') +
                    (modal.className ? `.${modal.className.split(' ').join('.')}` : ''),
                };
              }
            }
          }

          return { modalFound: false, focusInModal: false };
        });

        if (focusInModal.modalFound && !focusInModal.focusInModal) {
          violations.push({
            criterion: '9.2.4.3',
            element: trigger.element,
            issue: 'focus-lost',
            description: 'Focus is not properly managed when modal opens',
            suggestion: 'Move focus to first focusable element in modal when opened',
          });
        }

        // Try to close modal with Escape
        await page.keyboard.press('Escape');
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        log.warn(`Error testing modal trigger ${trigger.element}:`, error.message);
      }
    }

    // Test focus management after delete/remove actions
    const deleteButtons = await page.evaluate(() => {
      const buttons = [];
      const deletePattern = /delete|remove|löschen|entfernen|close|schließen/i;
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const text =
          (el.textContent || '').trim() +
          (el.getAttribute('aria-label') || '') +
          (el.getAttribute('title') || '');
        if (deletePattern.test(text)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const className = el.className && typeof el.className === 'string' ? el.className : '';
            buttons.push({
              element:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (className ? `.${className.split(' ')[0]}` : ''),
              text: el.textContent.trim().substring(0, 30),
            });
          }
        }
      });
      return buttons;
    });

    // Test first few delete buttons (avoid testing too many)
    for (const btn of deleteButtons.slice(0, 3)) {
      try {
        // Record DOM state before
        const before = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          el.focus();
          return {
            activeElement: document.activeElement?.tagName?.toLowerCase() || 'unknown',
            bodyChildCount: document.body.querySelectorAll('*').length,
          };
        }, btn.element);

        if (!before) continue;

        // Click the delete button
        const clicked = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.click();
            return true;
          }
          return false;
        }, btn.element);

        if (!clicked) continue;
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check if focus fell to body (bad) or stayed on a meaningful element (good)
        const after = await page.evaluate(() => {
          const active = document.activeElement;
          const isBody = !active || active === document.body || active === document.documentElement;
          return {
            isBody,
            activeElement: active?.tagName?.toLowerCase() || 'body',
            activeId: active?.id || '',
          };
        });

        // Check if DOM actually changed (something was deleted)
        const domChanged = await page.evaluate((prevCount) => {
          return document.body.querySelectorAll('*').length < prevCount;
        }, before.bodyChildCount);

        if (domChanged && after.isBody) {
          violations.push({
            criterion: '9.2.4.3',
            element: btn.element,
            issue: 'focus-lost-after-deletion',
            description: `After clicking "${btn.text}", an element was removed and focus fell to document body instead of moving to a sibling or parent`,
            suggestion:
              'After removing an element, move focus to the next sibling, previous sibling, or parent container',
          });
        }
      } catch (error) {
        log.warn(`Error testing delete button ${btn.element}:`, error.message);
      }
    }

    // Test focus management after load-more actions
    const loadMoreButtons = await page.evaluate(() => {
      const buttons = [];
      const loadPattern = /load more|mehr laden|show more|mehr anzeigen|weitere/i;
      document.querySelectorAll('button, [role="button"], a[href]').forEach((el) => {
        const text = (el.textContent || '').trim() + (el.getAttribute('aria-label') || '');
        if (loadPattern.test(text)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const className = el.className && typeof el.className === 'string' ? el.className : '';
            buttons.push({
              element:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (className ? `.${className.split(' ')[0]}` : ''),
              text: el.textContent.trim().substring(0, 30),
            });
          }
        }
      });
      return buttons;
    });

    for (const btn of loadMoreButtons.slice(0, 2)) {
      try {
        const beforeCount = await page.evaluate(() => document.body.querySelectorAll('*').length);

        const clicked = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.click();
            return true;
          }
          return false;
        }, btn.element);

        if (!clicked) continue;
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const after = await page.evaluate((prevCount) => {
          const newCount = document.body.querySelectorAll('*').length;
          const contentAdded = newCount > prevCount;
          const active = document.activeElement;
          const isBody = !active || active === document.body || active === document.documentElement;
          return { contentAdded, isBody, newCount, prevCount };
        }, beforeCount);

        if (after.contentAdded && after.isBody) {
          violations.push({
            criterion: '9.2.4.3',
            element: btn.element,
            issue: 'focus-lost-after-load-more',
            description: `After clicking "${btn.text}", new content was added but focus fell to document body instead of moving to the new content`,
            suggestion:
              'After loading more content, move focus to the first new element or announce the addition to screen readers',
          });
        }
      } catch (error) {
        log.warn(`Error testing load-more button ${btn.element}:`, error.message);
      }
    }

    return { violations };
  }

  /**
   * Test focus restoration after interactions
   */
  async testFocusRestoration(page, scanDir) {
    log.debug('Testing focus restoration...');

    const violations = [];

    // Test dropdown focus restoration
    const dropdownTriggers = await page.evaluate(() => {
      const triggers = [];
      const selectors = [
        '[aria-haspopup="menu"]',
        '[aria-haspopup="listbox"]',
        '.dropdown-trigger',
        '.dropdown-toggle',
        'select',
      ];

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            triggers.push({
              element:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (el.className ? `.${el.className.split(' ').join('.')}` : ''),
            });
          }
        });
      });

      return triggers;
    });

    for (const [index, trigger] of dropdownTriggers.entries()) {
      try {
        // Focus on trigger and record initial state
        await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (el) el.focus();
        }, trigger.element);

        await page.screenshot({
          path: path.join(scanDir, `dropdown-focus-${index}-initial.png`),
        });

        // Open dropdown
        await page.keyboard.press('Enter');
        await new Promise((resolve) => setTimeout(resolve, 300));

        await page.screenshot({
          path: path.join(scanDir, `dropdown-focus-${index}-opened.png`),
        });

        // Close with Escape
        await page.keyboard.press('Escape');
        await new Promise((resolve) => setTimeout(resolve, 300));

        await page.screenshot({
          path: path.join(scanDir, `dropdown-focus-${index}-closed.png`),
        });

        // Check if focus returned to trigger
        const focusRestored = await page.evaluate((selector) => {
          const trigger = document.querySelector(selector);
          return document.activeElement === trigger;
        }, trigger.element);

        if (!focusRestored) {
          violations.push({
            criterion: '9.2.4.3',
            element: trigger.element,
            issue: 'focus-not-restored',
            description: 'Focus is not restored to trigger element after dropdown closes',
            suggestion: 'Return focus to the element that opened the dropdown when it closes',
          });
        }
      } catch (error) {
        log.warn(`Error testing dropdown ${trigger.element}:`, error.message);
      }
    }

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
