const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');
const { injectableCode: contrastUtils } = require('./utils/browser-contrast');

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
    this.screenshotDir = path.join(__dirname, '../tmp/focus-screenshots');
  }

  get needsExclusiveAccess() { return true; }

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
      criteria: ["9.2.4.3", "9.2.4.7", "9.2.4.11"],
      passed: focusResults.violations.length === 0,
      violations: focusResults.violations,
      summary: {
        logicalTabOrder: focusResults.logicalTabOrder,
        allElementsHaveVisibleFocus: focusResults.allElementsHaveVisibleFocus,
        focusTraps: focusResults.focusTraps,
        focusNotObscured: focusResults.focusNotObscured
      },
      screenshotPath: scanDir,
      focusSequence: focusResults.focusSequence,
      visualAnalysis: focusResults.visualAnalysis
    };
  }

  /**
   * Perform comprehensive focus analysis
   */
  async performFocusAnalysis(page, scanDir) {
    const violations = [];
    const focusSequence = [];
    const visualAnalysis = [];
    let logicalTabOrder = true;
    let allElementsHaveVisibleFocus = true;
    let focusTraps = 0;

    console.log('Analyzing focus management with visual validation...');

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
                const isBroadFocus = /^(\*)?:focus$/.test(sel.trim()) ||
                  /^:focus$/.test(sel.trim()) ||
                  sel.trim() === '*:focus' ||
                  sel.trim() === ':focus';
                if (isBroadFocus) {
                  const outline = rule.style.outline || rule.style.outlineStyle || '';
                  const outlineWidth = rule.style.outlineWidth || '';
                  const outlineColor = rule.style.outlineColor || '';
                  if (outline === 'none' || outline === '0' ||
                      outlineWidth === '0' || outlineWidth === '0px' ||
                      outlineColor === 'transparent') {
                    suppressions.push({
                      selector: sel,
                      property: outline ? `outline: ${outline}` :
                        outlineWidth ? `outline-width: ${outlineWidth}` :
                        `outline-color: ${outlineColor}`,
                      source: sheet.href || 'inline'
                    });
                  }
                }
              }
            }
          } catch (e) { /* cross-origin stylesheet */ }
        }
      } catch (e) { /* no stylesheets */ }
      return suppressions;
    });

    for (const suppression of globalFocusSuppression) {
      violations.push({
        criterion: "9.2.4.7",
        element: suppression.selector,
        issue: "global-focus-outline-removed",
        description: `Global CSS rule "${suppression.selector} { ${suppression.property} }" removes focus indicators from all elements`,
        suggestion: "Remove the global focus suppression or replace with custom visible focus styles"
      });
    }

    // 2. Test focus sequence with visual validation
    const focusTestResults = await this.testFocusSequence(page, scanDir);
    
    // 3. Check for logical tab order violations
    logicalTabOrder = this.validateTabOrder(focusTestResults.sequence);
    if (!logicalTabOrder) {
      violations.push({
        criterion: "9.2.4.3",
        element: "document",
        issue: "illogical-tab-order",
        description: "Tab order does not follow a logical sequence",
        suggestion: "Adjust tabindex values or DOM order to match visual layout"
      });
    }

    // 4. Validate focus visibility for all elements
    for (const focusItem of focusTestResults.sequence) {
      if (!focusItem.hasVisibleFocus) {
        allElementsHaveVisibleFocus = false;
        if (focusItem.lowContrastFocus) {
          violations.push({
            criterion: "9.2.4.7",
            element: focusItem.element,
            issue: "low-contrast-focus-indicator",
            description: `Focus indicator has insufficient contrast against background (requires 3:1 minimum). Outline: ${focusItem.styles?.outlineColor || 'unknown'}, Background: ${focusItem.styles?.backgroundColor || 'unknown'}`,
            suggestion: "Use a focus indicator color with at least 3:1 contrast ratio against the background"
          });
        } else {
          violations.push({
            criterion: "9.2.4.7",
            element: focusItem.element,
            issue: "no-visible-focus",
            description: "Element receives focus but has no visible focus indicator",
            suggestion: "Add CSS :focus styles with visible outline, box-shadow, or background color"
          });
        }
      }
    }

    // 5. Test focus management in dynamic content
    const dynamicFocusResults = await this.testDynamicFocusManagement(page, scanDir);
    violations.push(...dynamicFocusResults.violations);

    // 6. Test focus restoration
    const focusRestorationResults = await this.testFocusRestoration(page, scanDir);
    violations.push(...focusRestorationResults.violations);

    // 7. Test focus not obscured (WCAG 2.4.11)
    let focusNotObscured = true;
    const obscuredResults = await this.analyzeFocusObscured(page, focusTestResults.sequence, violations);
    focusNotObscured = obscuredResults.notObscured;

    return {
      violations,
      logicalTabOrder,
      allElementsHaveVisibleFocus,
      focusTraps: focusTraps,
      focusNotObscured,
      focusSequence: focusTestResults.sequence,
      visualAnalysis: focusTestResults.visualAnalysis,
      readingOrderAnalysis
    };
  }

  /**
   * Analyze reading order vs. visual layout
   */
  async analyzeReadingOrder(page, scanDir) {
    console.log('Analyzing reading order vs. visual layout...');

    // Take full page screenshot for layout analysis
    await page.screenshot({
      path: path.join(scanDir, 'layout-analysis.png'),
      fullPage: true
    });

    const layoutAnalysis = await page.evaluate(() => {
      const elements = [];
      const focusableSelector = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';
      
      document.querySelectorAll(focusableSelector).forEach((el, index) => {
        if (!el.hasAttribute('disabled') && !el.hidden) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            elements.push({
              index,
              element: el.tagName.toLowerCase() + 
                      (el.id ? `#${el.id}` : '') + 
                      (el.className ? `.${el.className.split(' ').join('.')}` : ''),
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                left: rect.left
              },
              tabIndex: el.tabIndex,
              text: el.textContent.trim().substring(0, 30)
            });
          }
        }
      });

      // Sort by visual position (top to bottom, left to right)
      const visualOrder = [...elements].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 10) { // If elements are on different lines
          return yDiff;
        }
        return a.rect.left - b.rect.left; // Same line, sort by left position
      });

      // Compare DOM order vs visual order
      const orderMismatches = [];
      elements.forEach((el, domIndex) => {
        const visualIndex = visualOrder.findIndex(vel => vel.element === el.element);
        if (Math.abs(domIndex - visualIndex) > 2) { // Allow some tolerance
          orderMismatches.push({
            element: el.element,
            domOrder: domIndex,
            visualOrder: visualIndex,
            suggestion: 'Consider reordering elements in DOM to match visual layout'
          });
        }
      });

      return {
        totalElements: elements.length,
        domOrder: elements,
        visualOrder,
        orderMismatches
      };
    });

    return layoutAnalysis;
  }

  /**
   * Test focus sequence with visual validation
   */
  async testFocusSequence(page, scanDir) {
    console.log('Testing focus sequence with visual validation...');

    const sequence = [];
    const visualAnalysis = [];
    
    // Reset focus to body
    await page.evaluate(() => document.body.focus());
    
    let stepIndex = 0;
    const maxSteps = 30;
    const seenElements = new Set();

    while (stepIndex < maxSteps) {
      // Take before screenshot
      const beforePath = path.join(scanDir, `focus-step-${stepIndex.toString().padStart(3, '0')}-before.png`);
      await page.screenshot({ path: beforePath });

      // Get current focus state
      const beforeFocus = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;

        const rect = active.getBoundingClientRect();
        return {
          element: active.tagName.toLowerCase() + 
                  (active.id ? `#${active.id}` : '') + 
                  (active.className ? `.${active.className.split(' ').join('.')}` : ''),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          text: active.textContent.trim().substring(0, 30)
        };
      });

      // Press Tab
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 200)); // Allow focus transition

      // Take after screenshot
      const afterPath = path.join(scanDir, `focus-step-${stepIndex.toString().padStart(3, '0')}-after.png`);
      await page.screenshot({ path: afterPath });

      // Get new focus state and analyze visibility
      const afterFocus = await page.evaluate((contrastCode) => {
        // Inject contrast utilities
        eval(contrastCode);

        const active = document.activeElement;
        if (!active || active === document.body) return null;

        const rect = active.getBoundingClientRect();
        const computed = window.getComputedStyle(active);
        // Note: getComputedStyle(el, ':focus') does NOT return pseudo-class styles,
        // but the element IS focused right now, so computed styles reflect the focus state.
        const focusComputed = window.getComputedStyle(active, ':focus');

        // Analyze focus visibility — tightened checks for transparent/invisible outlines
        const outlineColor = computed.outlineColor || '';
        const isOutlineTransparent = __isColorTransparent(outlineColor);

        let hasOutline = focusComputed.outline &&
                          focusComputed.outline !== 'none' &&
                          focusComputed.outlineWidth !== '0px' &&
                          !isOutlineTransparent;

        // Check outline-to-background contrast ratio (minimum 3:1 per WCAG 2.4.7)
        let lowContrastFocus = false;
        if (hasOutline) {
          const outlineParsed = __parseRgb(outlineColor);
          const bgParsed = __getEffectiveBackgroundColor(active);
          if (outlineParsed && bgParsed) {
            const ratio = __getContrastRatio(outlineParsed, bgParsed);
            if (ratio < 3) {
              hasOutline = false;
              lowContrastFocus = true;
            }
          }
        }

        const hasBoxShadow = focusComputed.boxShadow &&
                            focusComputed.boxShadow !== 'none';

        const hasBorderChange = focusComputed.border !== computed.border;

        const hasBackgroundChange = focusComputed.backgroundColor !== computed.backgroundColor &&
                                   focusComputed.backgroundColor !== 'rgba(0, 0, 0, 0)';

        const hasVisibleFocus = hasOutline || hasBoxShadow || hasBorderChange || hasBackgroundChange;

        return {
          element: active.tagName.toLowerCase() +
                  (active.id ? `#${active.id}` : '') +
                  (active.className ? `.${active.className.split(' ').join('.')}` : ''),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          text: active.textContent.trim().substring(0, 30),
          tabIndex: active.tabIndex,
          hasVisibleFocus,
          lowContrastFocus,
          focusIndicators: {
            outline: hasOutline,
            boxShadow: hasBoxShadow,
            borderChange: hasBorderChange,
            backgroundChange: hasBackgroundChange
          },
          styles: {
            outline: focusComputed.outline,
            outlineColor: outlineColor,
            boxShadow: focusComputed.boxShadow,
            border: focusComputed.border,
            backgroundColor: focusComputed.backgroundColor
          }
        };
      }, contrastUtils);

      if (afterFocus) {
        const elementKey = afterFocus.element;
        
        // Check for focus trap (same element focused twice)
        if (beforeFocus && beforeFocus.element === afterFocus.element) {
          console.log('Focus trap detected, ending sequence');
          break;
        }

        // Check for cycle (element seen before)
        if (seenElements.has(elementKey)) {
          console.log('Focus cycle detected, ending sequence');
          break;
        }

        seenElements.add(elementKey);
        sequence.push(afterFocus);

        // Record visual analysis
        visualAnalysis.push({
          step: stepIndex,
          element: afterFocus.element,
          beforeScreenshot: `focus-step-${stepIndex.toString().padStart(3, '0')}-before.png`,
          afterScreenshot: `focus-step-${stepIndex.toString().padStart(3, '0')}-after.png`,
          focusVisible: afterFocus.hasVisibleFocus,
          focusIndicators: afterFocus.focusIndicators,
          position: afterFocus.rect
        });

      } else {
        // No focusable element, end of sequence
        break;
      }

      stepIndex++;
    }

    console.log(`Focus sequence analysis complete: ${sequence.length} focusable elements`);
    
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

      // If current element is significantly above previous element, might be illogical
      const yDiff = curr.rect.y - prev.rect.y;
      if (yDiff < -50) { // Current element is 50px+ above previous
        return false;
      }

      // If on same row, check left-to-right order
      if (Math.abs(yDiff) <= 20) { // Same row (within 20px)
        const xDiff = curr.rect.x - prev.rect.x;
        if (xDiff < -100) { // Current element is 100px+ to the left
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
    console.log('Testing dynamic focus management...');
    
    const violations = [];

    // Look for modal triggers
    const modalTriggers = await page.evaluate(() => {
      const triggers = [];
      const selectors = [
        '[data-toggle="modal"]', '[data-target*="modal"]', 
        '.modal-trigger', '.open-modal', '.show-modal',
        'button[aria-haspopup="dialog"]'
      ];
      
      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            triggers.push({
              element: el.tagName.toLowerCase() + 
                      (el.id ? `#${el.id}` : '') + 
                      (el.className ? `.${el.className.split(' ').join('.')}` : ''),
              text: el.textContent.trim().substring(0, 30)
            });
          }
        });
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
          path: path.join(scanDir, `modal-test-${index}-before.png`)
        });

        // Activate modal (try click and Enter key)
        await page.keyboard.press('Enter');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Take screenshot after activation
        await page.screenshot({
          path: path.join(scanDir, `modal-test-${index}-after.png`)
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
                  modalSelector: modal.tagName.toLowerCase() + 
                                (modal.id ? `#${modal.id}` : '') + 
                                (modal.className ? `.${modal.className.split(' ').join('.')}` : '')
                };
              }
            }
          }
          
          return { modalFound: false, focusInModal: false };
        });

        if (focusInModal.modalFound && !focusInModal.focusInModal) {
          violations.push({
            criterion: "9.2.4.3",
            element: trigger.element,
            issue: "focus-lost",
            description: "Focus is not properly managed when modal opens",
            suggestion: "Move focus to first focusable element in modal when opened"
          });
        }

        // Try to close modal with Escape
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.warn(`Error testing modal trigger ${trigger.element}:`, error.message);
      }
    }

    return { violations };
  }

  /**
   * Test focus restoration after interactions
   */
  async testFocusRestoration(page, scanDir) {
    console.log('Testing focus restoration...');
    
    const violations = [];

    // Test dropdown focus restoration
    const dropdownTriggers = await page.evaluate(() => {
      const triggers = [];
      const selectors = [
        '[aria-haspopup="menu"]', '[aria-haspopup="listbox"]',
        '.dropdown-trigger', '.dropdown-toggle', 'select'
      ];
      
      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            triggers.push({
              element: el.tagName.toLowerCase() + 
                      (el.id ? `#${el.id}` : '') + 
                      (el.className ? `.${el.className.split(' ').join('.')}` : '')
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
          path: path.join(scanDir, `dropdown-focus-${index}-initial.png`)
        });

        // Open dropdown
        await page.keyboard.press('Enter');
        await new Promise(resolve => setTimeout(resolve, 300));

        await page.screenshot({
          path: path.join(scanDir, `dropdown-focus-${index}-opened.png`)
        });

        // Close with Escape
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 300));

        await page.screenshot({
          path: path.join(scanDir, `dropdown-focus-${index}-closed.png`)
        });

        // Check if focus returned to trigger
        const focusRestored = await page.evaluate((selector) => {
          const trigger = document.querySelector(selector);
          return document.activeElement === trigger;
        }, trigger.element);

        if (!focusRestored) {
          violations.push({
            criterion: "9.2.4.3",
            element: trigger.element,
            issue: "focus-not-restored",
            description: "Focus is not restored to trigger element after dropdown closes",
            suggestion: "Return focus to the element that opened the dropdown when it closes"
          });
        }

      } catch (error) {
        console.warn(`Error testing dropdown ${trigger.element}:`, error.message);
      }
    }

    return { violations };
  }

  /**
   * Analyze focus not obscured (WCAG 2.4.11)
   * Checks if focused elements are covered by fixed/sticky positioned elements
   */
  async analyzeFocusObscured(page, focusSequence, violations) {
    console.log('Analyzing focus obscured by fixed/sticky elements...');

    // First, collect all fixed/sticky elements and their rects
    const fixedElements = await page.evaluate(() => {
      const fixed = [];
      const allElements = document.querySelectorAll('*');

      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'sticky') return;
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const zIndex = parseInt(style.zIndex) || 0;
        const selector = el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');

        fixed.push({
          selector,
          position: style.position,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
                  width: rect.width, height: rect.height },
          zIndex,
        });
      });

      return fixed;
    });

    if (fixedElements.length === 0) {
      return { notObscured: true };
    }

    // Check heuristic: scroll-padding compensation
    const scrollPaddingCheck = await page.evaluate((fixedEls) => {
      const htmlStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = window.getComputedStyle(document.body);

      const scrollPaddingTop = parseFloat(htmlStyle.scrollPaddingTop) || parseFloat(bodyStyle.scrollPaddingTop) || 0;
      const scrollPaddingBottom = parseFloat(htmlStyle.scrollPaddingBottom) || parseFloat(bodyStyle.scrollPaddingBottom) || 0;

      // Find top-most fixed header and bottom-most fixed footer
      let maxHeaderHeight = 0;
      let maxFooterHeight = 0;

      for (const el of fixedEls) {
        if (el.rect.top <= 10) maxHeaderHeight = Math.max(maxHeaderHeight, el.rect.height);
        if (el.rect.bottom >= window.innerHeight - 10) maxFooterHeight = Math.max(maxFooterHeight, el.rect.height);
      }

      return {
        scrollPaddingTop,
        scrollPaddingBottom,
        maxHeaderHeight,
        maxFooterHeight,
        missingTopPadding: maxHeaderHeight > 0 && scrollPaddingTop < maxHeaderHeight,
        missingBottomPadding: maxFooterHeight > 0 && scrollPaddingBottom < maxFooterHeight,
      };
    }, fixedElements);

    let notObscured = true;

    if (scrollPaddingCheck.missingTopPadding) {
      violations.push({
        criterion: '9.2.4.11',
        element: 'html',
        issue: 'missing-scroll-padding',
        description: `Fixed header is ${Math.round(scrollPaddingCheck.maxHeaderHeight)}px tall but scroll-padding-top is only ${Math.round(scrollPaddingCheck.scrollPaddingTop)}px — focused elements may scroll behind the header`,
        severity: 'serious',
        suggestion: `Add scroll-padding-top: ${Math.round(scrollPaddingCheck.maxHeaderHeight + 10)}px to html or body to prevent focused elements from being hidden behind the fixed header.`,
      });
      notObscured = false;
    }

    if (scrollPaddingCheck.missingBottomPadding) {
      violations.push({
        criterion: '9.2.4.11',
        element: 'html',
        issue: 'missing-scroll-padding',
        description: `Fixed footer/banner is ${Math.round(scrollPaddingCheck.maxFooterHeight)}px tall but scroll-padding-bottom is only ${Math.round(scrollPaddingCheck.scrollPaddingBottom)}px — focused elements may be hidden behind it`,
        severity: 'serious',
        suggestion: `Add scroll-padding-bottom: ${Math.round(scrollPaddingCheck.maxFooterHeight + 10)}px to html or body.`,
      });
      notObscured = false;
    }

    // Interactive check: Tab through focusable elements and check overlap with fixed elements
    // Reset focus to beginning
    await page.evaluate(() => document.body.focus());

    const maxSteps = 20;
    const seenElements = new Set();

    for (let i = 0; i < maxSteps; i++) {
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 150));

      const overlapResult = await page.evaluate((fixedEls) => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;

        const rect = active.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const selector = active.tagName.toLowerCase() +
          (active.id ? `#${active.id}` : '') +
          (active.className && typeof active.className === 'string' ? `.${active.className.split(' ')[0]}` : '');

        // Check overlap with each fixed element
        for (const fixedEl of fixedEls) {
          const f = fixedEl.rect;

          // Calculate overlap area
          const overlapLeft = Math.max(rect.left, f.left);
          const overlapRight = Math.min(rect.right, f.right);
          const overlapTop = Math.max(rect.top, f.top);
          const overlapBottom = Math.min(rect.bottom, f.bottom);

          if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
            const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
            const elementArea = rect.width * rect.height;
            const overlapRatio = elementArea > 0 ? overlapArea / elementArea : 0;

            // WCAG 2.4.11 (minimum): violation only if element is ENTIRELY hidden
            if (overlapRatio >= 0.99) {
              return {
                obscured: true,
                focusedElement: selector,
                obscuredBy: fixedEl.selector,
                overlapRatio: Math.round(overlapRatio * 100),
                fixedPosition: fixedEl.position,
              };
            }
          }
        }

        return { obscured: false, focusedElement: selector };
      }, fixedElements);

      if (!overlapResult) break;

      if (seenElements.has(overlapResult.focusedElement)) break;
      seenElements.add(overlapResult.focusedElement);

      if (overlapResult.obscured) {
        violations.push({
          criterion: '9.2.4.11',
          element: overlapResult.focusedElement,
          issue: `focus-obscured-by-${overlapResult.fixedPosition}-element`,
          description: `Focused element "${overlapResult.focusedElement}" is ${overlapResult.overlapRatio}% covered by ${overlapResult.fixedPosition} element "${overlapResult.obscuredBy}"`,
          severity: 'serious',
          suggestion: `Add scroll-padding to compensate for ${overlapResult.fixedPosition} elements, or reduce the z-index/size of the overlapping element.`,
        });
        notObscured = false;
      }
    }

    return { notObscured };
  }

}

module.exports = FocusManagementScanner;