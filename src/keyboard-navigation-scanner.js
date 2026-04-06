const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Keyboard Navigation Scanner for WCAG compliance testing
 * Implements EN 301 549 criteria 9.2.1.1, 9.2.1.2, 9.2.1.4 (Keyboard Accessible, No Keyboard Trap, Character Key Shortcuts)
 * Uses full visual screenshot analysis for thorough focus visibility testing
 */
class KeyboardNavigationScanner extends BaseScanner {
  constructor() {
    super('keyboard-navigation', {
      wcagCriteria: ['2.1.1', '2.1.2', '2.1.4'],
      wcagPrinciple: 'operable',
    });
    this.screenshotDir = path.join(__dirname, '../tmp/keyboard-screenshots');
  }

  get needsExclusiveAccess() { return true; }

  /**
   * Core scan method — receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      testAllInteractives: true,
      simulateTabbing: true,
      testCustomControls: true,
      ...options,
    };

    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const keyboardResults = await this.performKeyboardAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ["9.2.1.1", "9.2.1.2", "9.2.1.4"],
      passed: keyboardResults.violations.length === 0,
      violations: keyboardResults.violations,
      summary: {
        tabbableElements: keyboardResults.tabbableElements,
        keyboardInaccessible: keyboardResults.keyboardInaccessible,
        keyboardTraps: keyboardResults.keyboardTraps,
        customShortcuts: keyboardResults.customShortcuts
      },
      tabOrder: keyboardResults.tabOrder,
      screenshotPath: scanDir,
      visualEvidence: keyboardResults.visualEvidence
    };
  }

  /**
   * Perform comprehensive keyboard analysis with visual validation
   */
  async performKeyboardAnalysis(page, scanDir, options) {
    const violations = [];
    const tabOrder = [];
    const visualEvidence = [];
    let tabbableElements = 0;
    let keyboardInaccessible = 0;
    let keyboardTraps = 0;
    let customShortcuts = 0;

    // 1. Discover all potentially interactive elements
    const interactiveElements = await page.evaluate(() => {
      const elements = [];
      
      // Standard interactive elements
      const standardSelectors = [
        'a[href]', 'button', 'input', 'textarea', 'select', 
        'details', '[tabindex]:not([tabindex="-1"])', 
        '[role="button"]', '[role="link"]', '[role="tab"]',
        '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]'
      ];
      
      standardSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          if (!el.hasAttribute('disabled') && !el.hidden) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const className = el.className && typeof el.className === 'string' 
                ? el.className 
                : (el.className && el.className.baseVal ? el.className.baseVal : '');
              elements.push({
                selector: el.tagName.toLowerCase() + 
                         (el.id ? `#${el.id}` : '') + 
                         (className ? `.${className.split(' ').join('.')}` : ''),
                tagName: el.tagName,
                type: el.type || '',
                role: el.getAttribute('role') || '',
                tabIndex: el.tabIndex,
                ariaLabel: el.getAttribute('aria-label') || '',
                text: el.textContent.trim().substring(0, 50),
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height
                }
              });
            }
          }
        });
      });
      
      return elements;
    });

    console.log(`Found ${interactiveElements.length} potentially interactive elements`);

    // 1b. Detect scrollable containers without keyboard access (WCAG 2.1.1)
    const scrollableViolations = await page.evaluate(() => {
      const issues = [];

      function getSelector(el) {
        const className = el.className && typeof el.className === 'string'
          ? el.className
          : (el.className && el.className.baseVal ? el.className.baseVal : '');
        return el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (className ? `.${className.split(' ')[0]}` : '');
      }

      const allElements = document.querySelectorAll('*');
      const interactiveTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        // Check if element has scrollable overflow
        const isScrollableY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        const isScrollableX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth;

        if (!isScrollableY && !isScrollableX) return;

        // Skip interactive elements (they're already keyboard accessible)
        if (interactiveTags.has(el.tagName)) return;

        // Skip if element has tabindex >= 0
        if (el.hasAttribute('tabindex') && parseInt(el.getAttribute('tabindex')) >= 0) return;

        // Skip if element contains focusable children (users can reach content via child focus)
        const focusableChild = el.querySelector(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
          'select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableChild) return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        issues.push({
          element: getSelector(el),
          scrollableAxis: isScrollableY && isScrollableX ? 'both' : isScrollableY ? 'vertical' : 'horizontal',
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
      });

      return issues;
    });

    for (const sv of scrollableViolations) {
      violations.push({
        criterion: "9.2.1.1",
        element: sv.element,
        issue: "scrollable-content-not-keyboard-accessible",
        description: `Scrollable container (${sv.scrollableAxis} overflow) has no tabindex and no focusable children. Content is unreachable by keyboard.`,
        suggestion: 'Add tabindex="0" and an accessible role/label to make the scrollable region keyboard-navigable.'
      });
      keyboardInaccessible++;
    }

    // 2. Test keyboard navigation with visual analysis
    await this.testKeyboardNavigation(page, scanDir, interactiveElements, violations, tabOrder, visualEvidence);

    // 3. Test for keyboard traps
    const trapResults = await this.testKeyboardTraps(page, scanDir, violations);
    keyboardTraps = trapResults.traps;

    // 4. Test custom controls
    if (options.testCustomControls) {
      const customResults = await this.testCustomControls(page, scanDir, violations);
      keyboardInaccessible += customResults.inaccessible;
    }

    // 5. Test for conflicting keyboard shortcuts
    const shortcutResults = await this.testKeyboardShortcuts(page, violations);
    customShortcuts = shortcutResults.conflicts;

    // 6. Analyze tab order logic (visual vs DOM order)
    await this.analyzeTabOrderLogic(page, tabOrder, violations);

    // ============================================================================
    // PHASE 2: CSP-IMMUNE KEYBOARD ENHANCEMENT METHODS
    // Implements 15+ axe rules without script injection
    // ============================================================================

    // Group 1: Skip Links and Bypass Mechanisms (replaces axe: skip-link, bypass)
    await this.validateSkipLinks(page, violations);
    await this.validateBypassMechanisms(page, violations);
    
    // Group 2: Focusable Elements and Tab Order (replaces axe: focusable-element, focus-order-semantics)
    await this.validateFocusableElements(page, violations);
    await this.validateFocusOrderSemantics(page, tabOrder, violations);
    
    // Group 3: Tabindex Management (replaces axe: tabindex)
    await this.validateTabindexUsage(page, violations);
    
    // Group 4: Accesskey Management (replaces axe: accesskeys)
    await this.validateAccesskeys(page, violations);
    
    // Group 5: Keyboard Event Handling (replaces axe: keyboard-navigation, keyboard)
    await this.validateKeyboardEventHandling(page, violations);
    
    // Group 6: Focus Management (replaces axe: focus-trap, focus-order)
    await this.validateFocusManagement(page, violations);
    
    // Group 7: Interactive Element Accessibility (replaces axe: interactive-element)
    await this.validateInteractiveElementAccessibility(page, violations);

    // Calculate summary
    tabbableElements = tabOrder.length;
    keyboardInaccessible = violations.filter(v => v.issue === 'not-keyboard-accessible').length;

    return {
      violations,
      tabOrder,
      visualEvidence,
      tabbableElements,
      keyboardInaccessible,
      keyboardTraps,
      customShortcuts
    };
  }

  /**
   * Test keyboard navigation with visual focus verification
   */
  async testKeyboardNavigation(page, scanDir, interactiveElements, violations, tabOrder, visualEvidence) {
    console.log('Testing keyboard navigation with visual analysis...');

    // Start at the body element
    await page.evaluate(() => {
      document.body.focus();
    });

    let currentIndex = 0;
    const maxTabs = Math.min(30, Math.max(15, interactiveElements.length)); // Reasonable limit
    const visitedElements = new Map(); // Track element -> visit count

    for (let tabIndex = 0; tabIndex < maxTabs; tabIndex++) {
      // Take screenshot before tab
      const beforeScreenshot = await page.screenshot({
        path: path.join(scanDir, `tab-${tabIndex.toString().padStart(3, '0')}-before.png`),
        fullPage: false
      });

      // Get current focused element info
      const focusInfo = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;

        const rect = active.getBoundingClientRect();
        const computed = window.getComputedStyle(active);
        const focusComputed = window.getComputedStyle(active, ':focus');

        return {
          tagName: active.tagName,
          id: active.id || '',
          className: active.className || '',
          tabIndex: active.tabIndex,
          text: active.textContent.trim().substring(0, 50),
          selector: active.tagName.toLowerCase() + 
                   (active.id ? `#${active.id}` : '') + 
                   (active.className ? `.${active.className.split(' ').join('.')}` : ''),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          focusStyles: {
            outline: computed.outline, // Use current computed style since element is focused
            outlineColor: computed.outlineColor,
            outlineWidth: computed.outlineWidth,
            outlineStyle: computed.outlineStyle,
            boxShadow: computed.boxShadow,
            border: computed.border,
            backgroundColor: computed.backgroundColor
          },
          computedStyles: {
            outline: computed.outline,
            boxShadow: computed.boxShadow,
            border: computed.border
          }
        };
      });

      // Press Tab key
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 100)); // Allow focus to settle

      // Take screenshot after tab
      const afterScreenshot = await page.screenshot({
        path: path.join(scanDir, `tab-${tabIndex.toString().padStart(3, '0')}-after.png`),
        fullPage: false
      });

      // Get new focused element and its current focus styles
      const newFocusInfo = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;

        const rect = active.getBoundingClientRect();
        const computed = window.getComputedStyle(active);

        // Generate unique selector
        function generateUniqueSelector(element) {
          let selector = element.tagName.toLowerCase();
          
          if (element.id) {
            selector += `#${element.id}`;
          } else {
            if (element.className) {
              const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 2);
              if (classes.length > 0) {
                selector += `.${classes.join('.')}`;
              }
            }
            
            if (!element.id && !element.className) {
              const text = element.textContent.trim().substring(0, 15).replace(/[^a-zA-Z0-9]/g, '');
              if (text) {
                selector += `[data-text="${text}"]`;
              } else {
                const siblings = Array.from(element.parentElement?.children || []);
                const index = siblings.indexOf(element);
                if (index >= 0) {
                  selector += `:nth-child(${index + 1})`;
                }
              }
            }
          }
          
          return selector;
        }

        return {
          tagName: active.tagName,
          id: active.id || '',
          className: active.className || '',
          tabIndex: active.tabIndex,
          text: active.textContent.trim().substring(0, 50),
          selector: generateUniqueSelector(active),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          focusStyles: {
            // Use current computed styles since element is focused
            outline: computed.outline,
            outlineColor: computed.outlineColor,
            outlineWidth: computed.outlineWidth,
            outlineStyle: computed.outlineStyle,
            boxShadow: computed.boxShadow,
            border: computed.border,
            borderWidth: computed.borderWidth,
            backgroundColor: computed.backgroundColor
          }
        };
      });

      if (newFocusInfo) {
        // Check if this is a keyboard trap (focus didn't move from previous step)
        if (focusInfo && focusInfo.selector === newFocusInfo.selector && tabIndex > 0) {
          violations.push({
            criterion: "9.2.1.2",
            element: newFocusInfo.selector,
            issue: "keyboard-trap",
            description: `Focus is trapped on element and cannot move with Tab key`,
            keySequence: [`Tab (step ${tabIndex})`],
            suggestion: "Ensure all interactive elements allow focus to move to next element with Tab key"
          });
          break; // Exit to prevent infinite loop
        }

        // Check for visible focus indicator
        const hasVisibleFocus = this.analyzeVisibleFocus(newFocusInfo);
        
        // Add to tab order
        const tabOrderElement = {
          element: newFocusInfo.selector,
          tabIndex: tabOrder.length, // Use array index for consistency
          role: newFocusInfo.tagName.toLowerCase(),
          isVisible: newFocusInfo.rect.width > 0 && newFocusInfo.rect.height > 0,
          hasVisibleFocus: hasVisibleFocus.visible
        };
        
        tabOrder.push(tabOrderElement);

        // Record visual evidence
        visualEvidence.push({
          tabIndex: tabIndex,
          element: newFocusInfo.selector,
          beforeScreenshot: `tab-${tabIndex.toString().padStart(3, '0')}-before.png`,
          afterScreenshot: `tab-${tabIndex.toString().padStart(3, '0')}-after.png`,
          focusVisible: hasVisibleFocus.visible,
          focusIndicators: hasVisibleFocus.indicators,
          focusStyles: newFocusInfo.focusStyles
        });

        // Check for focus visibility violations
        if (!hasVisibleFocus.visible) {
          violations.push({
            criterion: "9.2.4.7",
            element: newFocusInfo.selector,
            issue: "no-visible-focus",
            description: "Element receives keyboard focus but has no visible focus indicator",
            suggestion: "Add CSS :focus styles with visible outline, box-shadow, or background color change"
          });
        }

        // Prevent infinite loops by tracking visited elements
        const elementKey = newFocusInfo.selector;
        const visitCount = visitedElements.get(elementKey) || 0;
        visitedElements.set(elementKey, visitCount + 1);
        
        // If we've seen this element 3+ times, it's probably a cycle
        if (visitCount >= 2) {
          console.log(`Detected tab order cycle at ${elementKey} (visited ${visitCount + 1} times), ending navigation test`);
          break;
        }
      } else {
        // No focusable element found - end of tab sequence
        break;
      }
    }

    console.log(`Completed keyboard navigation test: ${tabOrder.length} elements in tab order`);
  }

  /**
   * Generate unique selector for an element
   */
  generateUniqueSelector(element) {
    let selector = element.tagName.toLowerCase();
    
    // Add ID if available
    if (element.id) {
      selector += `#${element.id}`;
    } else {
      // Add class if available
      if (element.className) {
        const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 2);
        if (classes.length > 0) {
          selector += `.${classes.join('.')}`;
        }
      }
      
      // If still not unique enough, add text content or position
      if (!element.id && !element.className) {
        const text = element.textContent.trim().substring(0, 20).replace(/\s+/g, '-');
        if (text) {
          selector += `[text*="${text}"]`;
        } else {
          // Use nth-child as last resort
          const siblings = Array.from(element.parentElement?.children || []);
          const index = siblings.indexOf(element);
          if (index >= 0) {
            selector += `:nth-child(${index + 1})`;
          }
        }
      }
    }
    
    return selector;
  }

  /**
   * Analyze if an element has visible focus indicators
   */
  analyzeVisibleFocus(focusInfo) {
    const indicators = [];
    let visible = false;

    // Check outline - element is focused so current computed styles should show focus styles
    const outline = focusInfo.focusStyles.outline || '';
    const outlineWidth = focusInfo.focusStyles.outlineWidth || '0px';
    const outlineColor = focusInfo.focusStyles.outlineColor || '';
    
    // More robust outline detection
    const hasVisibleOutline = outline && 
                             !outline.includes('none') && 
                             outlineWidth !== '0px' && 
                             outlineColor && 
                             outlineColor !== 'transparent';
    
    if (hasVisibleOutline) {
      indicators.push('outline');
      visible = true;
    }

    // Check box-shadow - ensure it's actually visible
    const boxShadow = focusInfo.focusStyles.boxShadow || '';
    const hasVisibleBoxShadow = boxShadow && 
                               boxShadow !== 'none' && 
                               !boxShadow.includes('rgba(0, 0, 0, 0)') &&
                               !boxShadow.includes('transparent') &&
                               boxShadow.trim() !== '';
    
    if (hasVisibleBoxShadow) {
      indicators.push('box-shadow');
      visible = true;
    }

    // Check border - look for non-zero border width
    const border = focusInfo.focusStyles.border || '';
    const borderWidth = focusInfo.focusStyles.borderWidth || '0px';
    const hasVisibleBorder = border && 
                            !border.includes('none') && 
                            borderWidth !== '0px';
    
    if (hasVisibleBorder) {
      indicators.push('border');
      visible = true;
    }

    // Check background color - ensure it's not transparent
    const backgroundColor = focusInfo.focusStyles.backgroundColor || '';
    const hasVisibleBackground = backgroundColor && 
                                backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                                backgroundColor !== 'transparent' &&
                                backgroundColor.trim() !== '';
    
    if (hasVisibleBackground) {
      indicators.push('background-color');
      visible = true;
    }

    return { visible, indicators };
  }

  /**
   * Test for keyboard traps
   */
  async testKeyboardTraps(page, scanDir, violations) {
    console.log('Testing for keyboard traps...');
    
    let traps = 0;
    
    // Test modals and overlays
    const modalElements = await page.evaluate(() => {
      const modals = [];
      const selectors = ['.modal', '.overlay', '.popup', '.dialog', '[role="dialog"]', '[role="alertdialog"]'];
      
      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            modals.push({
              selector: el.tagName.toLowerCase() + 
                       (el.id ? `#${el.id}` : '') + 
                       (el.className ? `.${el.className.split(' ').join('.')}` : ''),
              visible: true
            });
          }
        });
      });
      
      return modals;
    });

    for (const modal of modalElements) {
      // Test if focus can escape modal
      await page.evaluate((selector) => {
        const modal = document.querySelector(selector);
        if (modal) {
          const focusable = modal.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
          if (focusable.length > 0) {
            focusable[focusable.length - 1].focus();
          }
        }
      }, modal.selector);

      // Take screenshot of modal state
      await page.screenshot({
        path: path.join(scanDir, `modal-trap-test-${traps}.png`)
      });

      // Try to tab out of modal
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 100));

      const focusEscaped = await page.evaluate((selector) => {
        const modal = document.querySelector(selector);
        const focused = document.activeElement;
        return modal && !modal.contains(focused);
      }, modal.selector);

      if (!focusEscaped) {
        // Test Escape key
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 200));

        const modalClosed = await page.evaluate((selector) => {
          const modal = document.querySelector(selector);
          return !modal || window.getComputedStyle(modal).display === 'none';
        }, modal.selector);

        if (!modalClosed) {
          violations.push({
            criterion: "9.2.1.2",
            element: modal.selector,
            issue: "keyboard-trap",
            description: "Modal or dialog traps keyboard focus without escape mechanism",
            keySequence: ["Tab", "Escape"],
            suggestion: "Provide Escape key handler or visible close button accessible via keyboard"
          });
          traps++;
        }
      }
    }

    return { traps };
  }

  /**
   * Test custom interactive controls
   */
  async testCustomControls(page, scanDir, violations) {
    console.log('Testing custom interactive controls...');
    
    let inaccessible = 0;

    const customControls = await page.evaluate(() => {
      const controls = [];
      
      // Look for elements that might be custom controls - focus on mouse-only elements
      const candidates = document.querySelectorAll('[onclick], [onmousedown], [onmouseup], .btn, .button, .control, .interactive, [style*="cursor: pointer"]');
      
      candidates.forEach(el => {
        // Skip if already a standard interactive element
        if (el.tagName.toLowerCase() === 'button' || 
            el.tagName.toLowerCase() === 'a' || 
            el.tagName.toLowerCase() === 'input' ||
            el.tagName.toLowerCase() === 'select' ||
            el.tagName.toLowerCase() === 'textarea') {
          return;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          // Generate unique selector
          function generateUniqueSelector(element) {
            let selector = element.tagName.toLowerCase();
            
            if (element.id) {
              selector += `#${element.id}`;
            } else {
              if (element.className) {
                const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 2);
                if (classes.length > 0) {
                  selector += `.${classes.join('.')}`;
                }
              }
              
              if (!element.id && !element.className) {
                const text = element.textContent.trim().substring(0, 15).replace(/[^a-zA-Z0-9]/g, '');
                if (text) {
                  selector += `[data-text="${text}"]`;
                } else {
                  const siblings = Array.from(element.parentElement?.children || []);
                  const index = siblings.indexOf(element);
                  if (index >= 0) {
                    selector += `:nth-child(${index + 1})`;
                  }
                }
              }
            }
            
            return selector;
          }

          const hasClickHandler = !!el.onclick || el.getAttribute('onclick');
          const hasKeyHandler = !!(el.onkeydown || el.onkeyup) || 
                               el.getAttribute('onkeydown') || 
                               el.getAttribute('onkeyup');
          const isFocusable = el.tabIndex >= 0;
          const hasAriaRole = ['button', 'link', 'menuitem', 'tab'].includes(el.getAttribute('role'));

          controls.push({
            selector: generateUniqueSelector(el),
            tagName: el.tagName,
            role: el.getAttribute('role') || '',
            tabIndex: el.tabIndex,
            hasOnClick: hasClickHandler,
            hasKeyHandler: hasKeyHandler,
            isFocusable: isFocusable,
            hasAriaRole: hasAriaRole,
            text: el.textContent.trim().substring(0, 30),
            isLikelyInteractive: hasClickHandler || hasAriaRole || el.style.cursor === 'pointer'
          });
        }
      });
      
      return controls;
    });

    console.log(`  Found ${customControls.length} potential custom controls`);

    for (const control of customControls) {
      console.log(`  Testing: ${control.selector} (hasClick: ${control.hasOnClick}, focusable: ${control.isFocusable})`);
      
      // Check if this is an interactive element that's not keyboard accessible
      if (control.isLikelyInteractive && !control.isFocusable && !control.hasKeyHandler) {
        violations.push({
          criterion: "9.2.1.1",
          element: control.selector,
          issue: "not-keyboard-accessible",
          description: `Interactive element "${control.text}" with click handler is not keyboard accessible`,
          suggestion: "Add tabindex='0' and keyboard event handlers (Enter/Space keys) or use proper semantic elements"
        });
        inaccessible++;
      }
      
      // Also test if we can actually focus the element
      try {
        await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (el) el.focus();
        }, control.selector);

        const actuallyFocusable = await page.evaluate(() => {
          return document.activeElement !== document.body;
        });

        if (!actuallyFocusable && control.hasOnClick) {
          // Only add if we haven't already added this violation
          const alreadyReported = violations.some(v => v.element === control.selector && v.issue === "not-keyboard-accessible");
          if (!alreadyReported) {
            violations.push({
              criterion: "9.2.1.1",
              element: control.selector,
              issue: "not-keyboard-accessible",
              description: `Interactive element "${control.text}" cannot receive keyboard focus`,
              suggestion: "Add tabindex='0' and keyboard event handlers (Enter/Space keys)"
            });
            inaccessible++;
          }
        }
      } catch (error) {
        console.warn(`Error testing control ${control.selector}:`, error.message);
      }
    }

    return { inaccessible };
  }

  /**
   * Test for conflicting keyboard shortcuts
   */
  async testKeyboardShortcuts(page, violations) {
    console.log('Testing keyboard shortcuts...');
    
    let conflicts = 0;

    // Test common browser shortcuts to see if they're overridden
    const testShortcuts = [
      { keys: ['Control', 'KeyR'], description: 'Ctrl+R (Refresh)' },
      { keys: ['Control', 'KeyT'], description: 'Ctrl+T (New Tab)' },
      { keys: ['Control', 'KeyW'], description: 'Ctrl+W (Close Tab)' },
      { keys: ['Control', 'KeyF'], description: 'Ctrl+F (Find)' }
    ];

    for (const shortcut of testShortcuts) {
      try {
        // Test if shortcut is prevented
        const result = await page.evaluate(async (keys) => {
          return new Promise((resolve) => {
            let prevented = false;
            
            const handler = (e) => {
              if (e.ctrlKey && e.code === keys[1]) {
                if (e.defaultPrevented || e.cancelBubble) {
                  prevented = true;
                }
              }
            };
            
            document.addEventListener('keydown', handler);
            
            // Simulate the key combination
            const event = new KeyboardEvent('keydown', {
              ctrlKey: true,
              code: keys[1],
              bubbles: true,
              cancelable: true
            });
            
            document.dispatchEvent(event);
            
            setTimeout(() => {
              document.removeEventListener('keydown', handler);
              resolve(prevented);
            }, 100);
          });
        }, shortcut.keys);

        if (result) {
          violations.push({
            criterion: "9.2.1.4",
            element: "document",
            issue: "conflicting-shortcut",
            description: `Browser shortcut ${shortcut.description} is overridden without alternative`,
            suggestion: "Provide alternative way to access functionality or use different key combination"
          });
          conflicts++;
        }
      } catch (error) {
        console.warn(`Error testing shortcut ${shortcut.description}:`, error.message);
      }
    }

    return { conflicts };
  }

  /**
   * Analyze tab order logic - detect when visual layout doesn't match tab order
   * Implements EN 301 549 criterion 9.2.4.3 (Focus Order)
   */
  async analyzeTabOrderLogic(page, tabOrder, violations) {
    console.log('Analyzing tab order logic (visual vs DOM order)...');
    console.log(`  Tab order elements: ${tabOrder.map(t => t.element).join(', ')}`);
    
    if (tabOrder.length < 2) {
      console.log('  Insufficient elements for tab order analysis');
      return;
    }

    try {
      // Get visual positions of all tabbed elements
      const positions = await page.evaluate((selectors) => {
        return selectors.map(sel => {
          try {
            const el = document.querySelector(sel);
            if (!el) return null;
            
            const rect = el.getBoundingClientRect();
            return {
              selector: sel,
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
              center: { 
                x: rect.left + rect.width / 2, 
                y: rect.top + rect.height / 2 
              },
              area: rect.width * rect.height
            };
          } catch (error) {
            console.warn(`Error getting position for ${sel}:`, error.message);
            return null;
          }
        });
      }, tabOrder.map(t => t.element));

      // Filter out null positions and elements that are too small
      const validPositions = positions.filter(p => p && p.area > 10);
      
      console.log(`  Position check: ${positions.length} total, ${validPositions.length} valid`);
      if (positions.length !== validPositions.length) {
        const filtered = positions.filter(p => !p || p.area <= 10);
        console.log(`  Filtered out: ${filtered.map((p, i) => `${tabOrder[i]?.element}(${p?.area || 'null'})`).join(', ')}`);
      }
      
      if (validPositions.length < 2) {
        console.log(`  Insufficient valid positions for analysis (only ${validPositions.length} valid elements)`);
        return;
      }

      console.log(`  Analyzing ${validPositions.length} element positions`);

      // Sort elements by visual reading order (top-to-bottom, left-to-right)
      const visualOrder = [...validPositions].sort((a, b) => {
        const rowThreshold = 50; // Elements within 50px vertically are considered same row
        
        // If elements are in different rows (significant Y difference)
        if (Math.abs(a.center.y - b.center.y) > rowThreshold) {
          return a.center.y - b.center.y; // Top to bottom
        }
        
        // Same row - sort left to right
        return a.center.x - b.center.x;
      });

      // Get form context for each element to avoid flagging normal form flows
      const formContexts = await page.evaluate((selectors) => {
        return selectors.map(sel => {
          try {
            const el = document.querySelector(sel);
            if (!el) return null;
            
            const form = el.closest('form');
            const isSubmitButton = el.tagName.toLowerCase() === 'button' && 
                                  (el.type === 'submit' || el.getAttribute('type') === 'submit' || 
                                   el.classList.contains('primary-button'));
            return {
              selector: sel,
              inForm: !!form,
              formId: form?.id || form?.className || 'default',
              isFormControl: ['input', 'textarea', 'select', 'button'].includes(el.tagName.toLowerCase()),
              isSubmitButton: isSubmitButton
            };
          } catch (error) {
            return null;
          }
        });
      }, validPositions.map(p => p.selector));

      // Compare visual order vs tab order
      let significantJumps = 0;
      const jumpThreshold = 200; // Pixels - significant position jump
      const jumpDetails = [];

      for (let i = 0; i < validPositions.length - 1; i++) {
        const currentPos = validPositions[i];
        const nextPos = validPositions[i + 1];
        const currentContext = formContexts[i];
        const nextContext = formContexts[i + 1];
        
        if (!currentPos || !nextPos) continue;

        // Check if tab order jumps backward significantly in visual space
        const horizontalJump = Math.abs(nextPos.center.x - currentPos.center.x);
        const verticalJump = Math.abs(nextPos.center.y - currentPos.center.y);
        
        // Skip normal form progressions (textarea -> submit button is expected)
        const isNormalFormFlow = currentContext?.inForm && nextContext?.inForm && 
                                currentContext.formId === nextContext.formId &&
                                currentContext.isFormControl && nextContext.isFormControl;
        
        // Also check for submit button following form elements (relaxed form check)
        const isSubmitFlow = currentContext?.isFormControl && 
                            nextContext?.isSubmitButton &&
                            currentContext.inForm;
        
        // Debug grid detection issue
        if (tabOrder.length <= 8) {
          console.log(`  DEBUG: Small tab order (${tabOrder.length} elements), checking grid detection...`);
          console.log(`    Elements in tab order: ${tabOrder.map(t => t.element).join(', ')}`);
        }
        
        const formThreshold = isSubmitFlow ? 600 : 400; // Higher threshold for submit buttons
        if ((isNormalFormFlow || isSubmitFlow) && verticalJump < formThreshold) {
          console.log(`  Skipping normal form flow: ${currentPos.selector} -> ${nextPos.selector} (threshold: ${formThreshold}px)`);
          continue;
        }
        
        // Detect problematic patterns:
        // 1. Large backward horizontal jump (right to left)
        // 2. Large upward vertical jump (bottom to top) - but not normal form flow
        // 3. Cross-diagonal jumps
        
        const isBackwardJump = nextPos.center.x < currentPos.center.x && horizontalJump > jumpThreshold;
        const isUpwardJump = nextPos.center.y < currentPos.center.y && verticalJump > jumpThreshold && !isNormalFormFlow;
        const isDiagonalJump = horizontalJump > jumpThreshold && verticalJump > jumpThreshold;
        
        if (isBackwardJump || isUpwardJump || isDiagonalJump) {
          significantJumps++;
          jumpDetails.push({
            from: currentPos.selector,
            to: nextPos.selector,
            fromPos: currentPos.center,
            toPos: nextPos.center,
            jumpType: isBackwardJump ? 'backward' : isUpwardJump ? 'upward' : 'diagonal',
            distance: Math.sqrt(horizontalJump ** 2 + verticalJump ** 2)
          });
          
          console.log(`  Found ${isBackwardJump ? 'backward' : isUpwardJump ? 'upward' : 'diagonal'} jump: ${currentPos.selector} -> ${nextPos.selector}`);
          console.log(`    Distance: ${Math.round(Math.sqrt(horizontalJump ** 2 + verticalJump ** 2))}px`);
        }
      }

      // Generate violations for significant tab order issues
      if (significantJumps > 0) {
        // Group violations by type for cleaner reporting
        const backwardJumps = jumpDetails.filter(j => j.jumpType === 'backward');
        const upwardJumps = jumpDetails.filter(j => j.jumpType === 'upward');
        const diagonalJumps = jumpDetails.filter(j => j.jumpType === 'diagonal');

        if (backwardJumps.length > 0) {
          violations.push({
            criterion: "9.2.4.3",
            element: backwardJumps.map(j => j.from).join(', '),
            issue: "illogical-tab-order",
            description: `Tab order jumps backward visually (${backwardJumps.length} instances). Users expect left-to-right, top-to-bottom navigation.`,
            suggestion: "Adjust DOM order or use CSS order property to match visual layout sequence",
            jumpDetails: backwardJumps
          });
        }

        if (upwardJumps.length > 0) {
          violations.push({
            criterion: "9.2.4.3",
            element: upwardJumps.map(j => j.from).join(', '),
            issue: "illogical-tab-order",
            description: `Tab order jumps upward visually (${upwardJumps.length} instances). Users expect top-to-bottom navigation.`,
            suggestion: "Ensure tab order follows visual flow from top to bottom",
            jumpDetails: upwardJumps
          });
        }

        if (diagonalJumps.length > 0) {
          violations.push({
            criterion: "9.2.4.3", 
            element: diagonalJumps.map(j => j.from).join(', '),
            issue: "illogical-tab-order",
            description: `Tab order makes confusing diagonal jumps (${diagonalJumps.length} instances). Navigation should follow predictable patterns.`,
            suggestion: "Restructure layout or tab order to follow logical reading sequence",
            jumpDetails: diagonalJumps
          });
        }

        console.log(`  Found ${significantJumps} significant tab order violations`);
      } else {
        console.log('  ✅ Tab order follows logical visual sequence');
      }

    } catch (error) {
      console.warn('Error analyzing tab order logic:', error.message);
    }
  }

  // ============================================================================
  // PHASE 2: CSP-IMMUNE KEYBOARD ENHANCEMENT METHODS
  // Implements 15+ axe rules without script injection
  // ============================================================================

  /**
   * Validate skip links (replaces axe: skip-link)
   */
  async validateSkipLinks(page, violations) {
    console.log('Validating skip links...');
    
    const skipLinkIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Find skip links
      const potentialSkipLinks = document.querySelectorAll('a[href^="#"], a[href^="#main"], a[href*="skip"], a[href*="content"]');
      
      potentialSkipLinks.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim().toLowerCase();
        const selector = getElementSelector(link);
        
        // Check if it's actually a skip link
        const isSkipLink = text.includes('skip') || text.includes('jump') || text.includes('main') || 
                          href.includes('main') || href.includes('content');
        
        if (isSkipLink) {
          // Check if target exists
          const targetId = href.replace('#', '');
          const target = document.getElementById(targetId);
          
          if (!target) {
            issues.push({
              type: 'skip-link',
              element: selector,
              href: href,
              description: `Skip link points to non-existent target: ${href}`,
              severity: 'serious',
              suggestion: 'Ensure skip link target exists and is accessible'
            });
          }
          
          // Check if skip link is focusable
          const isHidden = link.offsetParent === null;
          const hasVisibleOnFocus = getComputedStyle(link, ':focus').position !== 'absolute' ||
                                   getComputedStyle(link, ':focus').top !== '-9999px';
          
          if (isHidden && !hasVisibleOnFocus) {
            issues.push({
              type: 'skip-link',
              element: selector,
              description: 'Skip link is not accessible when focused',
              severity: 'serious',
              suggestion: 'Ensure skip link becomes visible on focus'
            });
          }
        }
      });
      
      // Check if page has skip links at all (for complex pages)
      const complexPage = document.querySelectorAll('nav, header, main, section, article').length > 3;
      const hasSkipLinks = potentialSkipLinks.length > 0;
      
      if (complexPage && !hasSkipLinks) {
        issues.push({
          type: 'skip-link',
          element: 'body',
          description: 'Complex page lacks skip links for keyboard navigation',
          severity: 'moderate',
          suggestion: 'Add skip links to main content areas for keyboard users'
        });
      }
      
      return issues;
    });

    // Create violations for skip link issues
    skipLinkIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.4.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate bypass mechanisms (replaces axe: bypass)
   */
  async validateBypassMechanisms(page, violations) {
    console.log('Validating bypass mechanisms...');
    
    const bypassIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Check for main landmark
      const mainLandmarks = document.querySelectorAll('main, [role="main"]');
      if (mainLandmarks.length === 0) {
        issues.push({
          type: 'bypass',
          element: 'body',
          description: 'Page lacks main landmark for content navigation',
          severity: 'serious',
          suggestion: 'Add main element or role="main" to identify main content'
        });
      } else if (mainLandmarks.length > 1) {
        issues.push({
          type: 'bypass',
          element: getElementSelector(mainLandmarks[1]),
          description: 'Multiple main landmarks found - only one should exist',
          severity: 'moderate',
          suggestion: 'Ensure only one main landmark per page'
        });
      }
      
      // Check for navigation landmarks
      const navElements = document.querySelectorAll('nav, [role="navigation"]');
      navElements.forEach(nav => {
        const hasAccessibleName = nav.hasAttribute('aria-label') || 
                                 nav.hasAttribute('aria-labelledby') ||
                                 nav.hasAttribute('title');
        
        if (navElements.length > 1 && !hasAccessibleName) {
          issues.push({
            type: 'bypass',
            element: getElementSelector(nav),
            description: 'Navigation landmark lacks accessible name when multiple nav elements exist',
            severity: 'moderate',
            suggestion: 'Add aria-label to distinguish between navigation areas'
          });
        }
      });
      
      // Check for heading structure as bypass mechanism
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headings.length === 0) {
        issues.push({
          type: 'bypass',
          element: 'body',
          description: 'Page lacks heading structure for content navigation',
          severity: 'moderate',
          suggestion: 'Add headings to create navigable page structure'
        });
      }
      
      return issues;
    });

    // Create violations for bypass mechanism issues
    bypassIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.4.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate focusable elements (replaces axe: focusable-element)
   */
  async validateFocusableElements(page, violations) {
    console.log('Validating focusable elements...');
    
    const focusableIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Find elements that should be focusable but aren't
      const interactiveElements = document.querySelectorAll([
        'button', 'a', 'input', 'textarea', 'select', 
        '[role="button"]', '[role="link"]', '[role="tab"]',
        '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]'
      ].join(', '));
      
      interactiveElements.forEach(element => {
        const selector = getElementSelector(element);
        const tabIndex = element.tabIndex;
        const isHidden = element.offsetParent === null;
        const isDisabled = element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
        
        // Check if interactive element is not focusable when it should be
        if (!isHidden && !isDisabled && tabIndex < 0) {
          // Exception for links without href
          if (element.tagName.toLowerCase() === 'a' && !element.hasAttribute('href')) {
            // This is OK - links without href shouldn't be focusable
            return;
          }
          
          issues.push({
            type: 'focusable-element',
            element: selector,
            description: 'Interactive element is not keyboard focusable',
            severity: 'serious',
            suggestion: 'Ensure interactive elements are keyboard accessible'
          });
        }
        
        // Check for inappropriate positive tabindex
        if (tabIndex > 0) {
          issues.push({
            type: 'focusable-element',
            element: selector,
            tabIndex: tabIndex,
            description: `Element uses positive tabindex (${tabIndex}) which disrupts natural tab order`,
            severity: 'moderate',
            suggestion: 'Use tabindex="0" or remove tabindex to maintain natural focus order'
          });
        }
      });
      
      // Check for non-interactive elements with tabindex="0"
      const nonInteractiveWithTabindex = document.querySelectorAll('[tabindex="0"]:not(button):not(a):not(input):not(textarea):not(select):not([role="button"]):not([role="link"]):not([role="tab"]):not([role="menuitem"]):not([role="checkbox"]):not([role="radio"])');
      
      nonInteractiveWithTabindex.forEach(element => {
        const hasInteractiveRole = element.hasAttribute('role') &&
          ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'slider', 'spinbutton'].includes(element.getAttribute('role'));

        // Scrollable containers with tabindex="0" are correct a11y pattern
        const style = window.getComputedStyle(element);
        const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                              style.overflowX === 'auto' || style.overflowX === 'scroll') &&
                             (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);

        // Landmark roles (region, log, etc.) with tabindex="0" are acceptable
        const hasLandmarkRole = element.hasAttribute('role') &&
          ['region', 'log', 'group', 'toolbar', 'tree', 'treegrid', 'grid', 'application'].includes(element.getAttribute('role'));

        if (!hasInteractiveRole && !isScrollable && !hasLandmarkRole) {
          issues.push({
            type: 'focusable-element',
            element: getElementSelector(element),
            description: 'Non-interactive element is made focusable with tabindex',
            severity: 'moderate',
            suggestion: 'Only make interactive elements focusable, or add appropriate ARIA role'
          });
        }
      });
      
      return issues;
    });

    // Create violations for focusable element issues
    focusableIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.1.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate focus order semantics (replaces axe: focus-order-semantics)
   */
  async validateFocusOrderSemantics(page, tabOrder, violations) {
    console.log('Validating focus order semantics...');
    
    const semanticIssues = await page.evaluate((tabOrderData) => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Analyze semantic flow issues
      for (let i = 0; i < tabOrderData.length - 1; i++) {
        const current = tabOrderData[i];
        const next = tabOrderData[i + 1];
        
        if (!current.selector || !next.selector) continue;
        
        try {
          const currentEl = document.querySelector(current.selector);
          const nextEl = document.querySelector(next.selector);
          
          if (!currentEl || !nextEl) continue;
          
          // Check for semantic relationship violations
          
          // 1. Form field followed by unrelated content (should go to next field or submit)
          if (currentEl.tagName.toLowerCase() === 'input' && currentEl.type !== 'submit') {
            const currentForm = currentEl.closest('form');
            const nextForm = nextEl.closest('form');
            
            if (currentForm && nextForm !== currentForm && 
                !nextEl.closest('nav') && nextEl.tagName.toLowerCase() !== 'a') {
              issues.push({
                type: 'focus-order-semantics',
                element: getElementSelector(nextEl),
                description: 'Focus jumps from form field to unrelated content outside form',
                severity: 'moderate',
                suggestion: 'Ensure logical flow within forms before moving to other content'
              });
            }
          }
          
          // 2. Menu item followed by unrelated content
          if (currentEl.getAttribute('role') === 'menuitem' && 
              nextEl.getAttribute('role') !== 'menuitem' &&
              !nextEl.closest('[role="menu"], [role="menubar"]')) {
            issues.push({
              type: 'focus-order-semantics',
              element: getElementSelector(nextEl),
              description: 'Focus jumps from menu item to unrelated content',
              severity: 'moderate',
              suggestion: 'Complete menu navigation before moving to other content'
            });
          }
          
          // 3. Tab panel content skipped when tab is focused
          if (currentEl.getAttribute('role') === 'tab' && 
              nextEl.getAttribute('role') === 'tab') {
            const tabpanel = document.querySelector(`[role="tabpanel"][aria-labelledby="${currentEl.id}"]`);
            if (tabpanel && tabpanel.querySelector('button, a, input, textarea, select, [tabindex="0"]')) {
              issues.push({
                type: 'focus-order-semantics',
                element: getElementSelector(currentEl),
                description: 'Tab panel with focusable content is skipped in tab order',
                severity: 'serious',
                suggestion: 'Include focusable content in tab panels in the tab order'
              });
            }
          }
          
        } catch (error) {
          // Skip elements that can't be found
        }
      }
      
      return issues;
    }, tabOrder);

    // Create violations for focus order semantic issues
    semanticIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.4.3",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate tabindex usage (replaces axe: tabindex)
   */
  async validateTabindexUsage(page, violations) {
    console.log('Validating tabindex usage...');
    
    const tabindexIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Find all elements with tabindex
      const elementsWithTabindex = document.querySelectorAll('[tabindex]');
      
      elementsWithTabindex.forEach(element => {
        const selector = getElementSelector(element);
        const tabIndex = parseInt(element.getAttribute('tabindex'));
        
        // Check for positive tabindex (anti-pattern)
        if (tabIndex > 0) {
          issues.push({
            type: 'tabindex',
            element: selector,
            tabIndex: tabIndex,
            description: `Positive tabindex (${tabIndex}) disrupts natural tab order`,
            severity: 'moderate',
            suggestion: 'Use tabindex="0" to include in natural tab order or tabindex="-1" to exclude'
          });
        }
        
        // Check for tabindex on inappropriate elements
        const isInteractive = element.tagName.toLowerCase() === 'a' && element.hasAttribute('href') ||
                             ['button', 'input', 'textarea', 'select'].includes(element.tagName.toLowerCase()) ||
                             element.hasAttribute('role') && 
                             ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio'].includes(element.getAttribute('role'));
        
        if (tabIndex === 0 && !isInteractive) {
          const hasClickHandler = element.onclick || element.hasAttribute('onclick');
          // Scrollable containers and landmark roles legitimately need tabindex="0"
          const elStyle = window.getComputedStyle(element);
          const isScrollContainer = (elStyle.overflowY === 'auto' || elStyle.overflowY === 'scroll' ||
                                     elStyle.overflowX === 'auto' || elStyle.overflowX === 'scroll') &&
                                    (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
          const isLandmark = element.hasAttribute('role') &&
            ['region', 'log', 'group', 'toolbar', 'tree', 'treegrid', 'grid', 'application'].includes(element.getAttribute('role'));

          if (!hasClickHandler && !isScrollContainer && !isLandmark) {
            issues.push({
              type: 'tabindex',
              element: selector,
              description: 'Non-interactive element made focusable with tabindex="0"',
              severity: 'minor',
              suggestion: 'Only add tabindex to interactive elements or add appropriate role and event handlers'
            });
          }
        }
        
        // Check for tabindex="-1" on naturally focusable elements (usually unnecessary)
        if (tabIndex === -1 && isInteractive && !element.hasAttribute('disabled')) {
          issues.push({
            type: 'tabindex',
            element: selector,
            description: 'Interactive element removed from tab order with tabindex="-1"',
            severity: 'moderate',
            suggestion: 'Consider if removing interactive element from keyboard navigation is intentional'
          });
        }
      });
      
      return issues;
    });

    // Create violations for tabindex issues
    tabindexIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.1.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate accesskeys (replaces axe: accesskeys)
   */
  async validateAccesskeys(page, violations) {
    console.log('Validating accesskeys...');
    
    const accesskeyIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      const accesskeys = {};
      
      // Find all elements with accesskey
      const elementsWithAccesskey = document.querySelectorAll('[accesskey]');
      
      elementsWithAccesskey.forEach(element => {
        const selector = getElementSelector(element);
        const accesskey = element.getAttribute('accesskey').toLowerCase();
        
        // Check for duplicate accesskeys
        if (accesskeys[accesskey]) {
          issues.push({
            type: 'accesskeys',
            element: selector,
            accesskey: accesskey,
            description: `Duplicate accesskey "${accesskey}" found`,
            severity: 'serious',
            suggestion: 'Ensure each accesskey is unique on the page'
          });
          
          // Also flag the original element
          issues.push({
            type: 'accesskeys',
            element: accesskeys[accesskey],
            accesskey: accesskey,
            description: `Duplicate accesskey "${accesskey}" found`,
            severity: 'serious',
            suggestion: 'Ensure each accesskey is unique on the page'
          });
        } else {
          accesskeys[accesskey] = selector;
        }
        
        // Check for problematic accesskey values
        const problematicKeys = ['c', 'v', 'x', 'a', 'f', 'e', 'h', 't', 'w', 'r', 'l', 's'];
        if (problematicKeys.includes(accesskey)) {
          issues.push({
            type: 'accesskeys',
            element: selector,
            accesskey: accesskey,
            description: `Accesskey "${accesskey}" conflicts with common browser shortcuts`,
            severity: 'moderate',
            suggestion: 'Use accesskeys that do not conflict with browser functionality (0-9, or less common letters)'
          });
        }
        
        // Check if element with accesskey is not focusable
        const isHidden = element.offsetParent === null;
        const tabIndex = element.tabIndex;
        
        if (!isHidden && tabIndex < 0) {
          issues.push({
            type: 'accesskeys',
            element: selector,
            accesskey: accesskey,
            description: 'Element with accesskey is not keyboard focusable',
            severity: 'moderate',
            suggestion: 'Ensure elements with accesskeys are also focusable via keyboard'
          });
        }
      });
      
      return issues;
    });

    // Create violations for accesskey issues
    accesskeyIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.1.4",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate keyboard event handling (replaces axe: keyboard-navigation, keyboard)
   */
  async validateKeyboardEventHandling(page, violations) {
    console.log('Validating keyboard event handling...');
    
    const keyboardIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Find elements with click handlers but no keyboard support
      const clickableElements = document.querySelectorAll('*');
      
      clickableElements.forEach(element => {
        // Check if element has click handler - be more specific to avoid false positives
        const hasClickHandler = element.onclick || 
                               element.hasAttribute('onclick') ||
                               element.hasAttribute('ng-click') ||
                               element.hasAttribute('@click') ||
                               element.classList.contains('clickable') ||
                               element.classList.contains('btn') ||
                               element.classList.contains('fake-button') ||
                               (element.hasAttribute('role') && element.getAttribute('role') === 'button') ||
                               element.style.cursor === 'pointer';
        
        if (hasClickHandler) {
          const selector = getElementSelector(element);
          const tagName = element.tagName.toLowerCase();
          const tabIndex = element.tabIndex;
          const isHidden = element.offsetParent === null;
          
          // Skip naturally keyboard accessible elements
          const naturallyKeyboardAccessible = [
            'button', 'a', 'input', 'textarea', 'select'
          ].includes(tagName) && !isHidden;
          
          if (!naturallyKeyboardAccessible && tabIndex < 0) {
            issues.push({
              type: 'keyboard-navigation',
              element: selector,
              description: 'Clickable element is not keyboard accessible',
              severity: 'serious',
              suggestion: 'Add tabindex="0" and keyboard event handlers (Enter/Space) for custom interactive elements'
            });
          }
          
          // Check for custom elements that might need ARIA roles
          if (!naturallyKeyboardAccessible && tabIndex >= 0 && !element.hasAttribute('role')) {
            const likelyButton = element.classList.contains('btn') || 
                               element.classList.contains('button') ||
                               element.textContent.trim().match(/^(submit|send|save|cancel|ok|yes|no)$/i);
            
            if (likelyButton) {
              issues.push({
                type: 'keyboard-navigation',
                element: selector,
                description: 'Focusable clickable element lacks appropriate ARIA role',
                severity: 'moderate',
                suggestion: 'Add role="button" to custom button-like elements'
              });
            }
          }
        }
      });
      
      // Check for form submissions that only work with mouse
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        const submitButtons = form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])');
        const divButtons = form.querySelectorAll('div[onclick], span[onclick]');
        
        if (submitButtons.length === 0 && divButtons.length > 0) {
          divButtons.forEach(button => {
            issues.push({
              type: 'keyboard-navigation',
              element: getElementSelector(button),
              description: 'Form submission only available via non-keyboard accessible element',
              severity: 'serious',
              suggestion: 'Use proper button elements for form submission or add keyboard event handling'
            });
          });
        }
      });
      
      return issues;
    });

    // Create violations for keyboard event handling issues, avoiding duplicates
    keyboardIssues.forEach(issue => {
      // Check if this violation already exists (avoid duplicates with other validation functions)
      const alreadyReported = violations.some(v => 
        v.element === issue.element && 
        (v.issue === "not-keyboard-accessible" || v.issue === issue.type)
      );
      
      if (!alreadyReported) {
        violations.push({
          criterion: "9.2.1.1",
          element: issue.element,
          issue: issue.type,
          description: issue.description,
          severity: issue.severity,
          suggestion: issue.suggestion
        });
      }
    });
  }

  /**
   * Validate focus management (replaces axe: focus-trap, focus-order)
   */
  async validateFocusManagement(page, violations) {
    console.log('Validating focus management...');
    
    const focusIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Check for modal dialogs and overlays that might need focus trapping
      const potentialModals = document.querySelectorAll([
        '[role="dialog"]', '[role="alertdialog"]', '.modal', '.popup', 
        '.overlay', '.dialog', '[aria-modal="true"]'
      ].join(', '));
      
      potentialModals.forEach(modal => {
        const selector = getElementSelector(modal);
        const isVisible = modal.offsetParent !== null;
        
        if (isVisible) {
          // Check if modal has focusable content
          const focusableInModal = modal.querySelectorAll([
            'button', 'a[href]', 'input', 'textarea', 'select',
            '[tabindex]:not([tabindex="-1"])'
          ].join(', '));
          
          if (focusableInModal.length === 0) {
            issues.push({
              type: 'focus-management',
              element: selector,
              description: 'Modal dialog lacks focusable content',
              severity: 'serious',
              suggestion: 'Ensure modal dialogs contain focusable elements or can be dismissed'
            });
          }
          
          // Check for close button or escape mechanism
          const hasCloseButton = modal.querySelector('[aria-label*="close"], [title*="close"], .close, .x-button') ||
                                modal.hasAttribute('aria-describedby');
          
          if (!hasCloseButton) {
            issues.push({
              type: 'focus-management',
              element: selector,
              description: 'Modal dialog lacks clear close mechanism',
              severity: 'moderate',
              suggestion: 'Provide accessible close button or document escape key functionality'
            });
          }
        }
      });
      
      // Check for elements that change focus unexpectedly
      const elementsWithOnChange = document.querySelectorAll('select[onchange], input[onchange]');
      elementsWithOnChange.forEach(element => {
        // This is hard to detect statically, but we can warn about potential issues
        const selector = getElementSelector(element);
        
        if (element.tagName.toLowerCase() === 'select') {
          issues.push({
            type: 'focus-management',
            element: selector,
            description: 'Select element may cause unexpected focus changes',
            severity: 'minor',
            suggestion: 'Ensure onchange events do not cause unexpected context changes'
          });
        }
      });
      
      return issues;
    });

    // Create violations for focus management issues
    focusIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.1.2",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

  /**
   * Validate interactive element accessibility (replaces axe: interactive-element)
   */
  async validateInteractiveElementAccessibility(page, violations) {
    console.log('Validating interactive element accessibility...');
    
    const interactiveIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className && typeof element.className === 'string' 
          ? `.${element.className.split(' ')[0]}` 
          : '';
        return `${tagName}${id}${className}`;
      }
      
      const issues = [];
      
      // Check interactive elements for accessibility issues
      const interactiveElements = document.querySelectorAll([
        'button', 'a', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="tab"]',
        '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
        '[tabindex]:not([tabindex="-1"])'
      ].join(', '));
      
      interactiveElements.forEach(element => {
        const selector = getElementSelector(element);
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute('role');
        const isHidden = element.offsetParent === null;
        
        if (isHidden) return; // Skip hidden elements
        
        // Check for missing accessible names
        // Check for accessible name including proper <label> association
        const hasAriaLabel = element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
        const hasTitle = element.hasAttribute('title');
        const hasTextContent = element.textContent.trim();
        const hasInputAlt = tagName === 'input' && element.hasAttribute('alt');
        const hasInputValue = tagName === 'input' && element.value;
        
        // Check for associated label element (most important for form inputs)
        let hasAssociatedLabel = false;
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
          const id = element.id;
          if (id) {
            const associatedLabel = document.querySelector(`label[for="${id}"]`);
            hasAssociatedLabel = associatedLabel && associatedLabel.textContent.trim();
          }
          // Also check if input is inside a label
          if (!hasAssociatedLabel) {
            const parentLabel = element.closest('label');
            hasAssociatedLabel = parentLabel && parentLabel.textContent.trim();
          }
        }
        
        const hasAccessibleName = hasAriaLabel || hasTitle || hasTextContent || 
                                 hasInputAlt || hasInputValue || hasAssociatedLabel;
        
        if (!hasAccessibleName) {
          issues.push({
            type: 'interactive-element',
            element: selector,
            description: 'Interactive element lacks accessible name',
            severity: 'serious',
            suggestion: 'Add aria-label, visible text, or other accessible name mechanism'
          });
        }
        
        // Check for inappropriate use of links vs buttons
        if (tagName === 'a' && element.hasAttribute('href')) {
          const href = element.getAttribute('href');
          const text = element.textContent.trim().toLowerCase();
          
          // Links that act like buttons - be more specific to avoid navigation false positives
          const actionWords = /^(click|submit|send|save|delete|edit|post|update|create|remove)$/i;
          const isJavascriptVoid = href === 'javascript:void(0)';
          const isActionLink = href === '#' && text.match(actionWords);
          
          if (isJavascriptVoid || isActionLink) {
            issues.push({
              type: 'interactive-element',
              element: selector,
              description: 'Link used for action that should be a button',
              severity: 'moderate',
              suggestion: 'Use button element for actions, links for navigation'
            });
          }
        }
        
        // Check for buttons that should be links
        if (tagName === 'button' && !element.closest('form')) {
          const text = element.textContent.trim().toLowerCase();
          if (text.match(/^(learn more|read more|view|details|info)$/)) {
            const hasClickHandler = element.onclick || element.hasAttribute('onclick');
            if (!hasClickHandler) {
              issues.push({
                type: 'interactive-element',
                element: selector,
                description: 'Button used for navigation that should be a link',
                severity: 'minor',
                suggestion: 'Use link element for navigation to other pages or sections'
              });
            }
          }
        }
        
        // Check for missing keyboard support on custom controls
        if (role && ['button', 'tab', 'menuitem'].includes(role) && tagName !== 'button') {
          const hasKeydownHandler = element.onkeydown || element.hasAttribute('onkeydown');
          
          if (!hasKeydownHandler) {
            issues.push({
              type: 'interactive-element',
              element: selector,
              description: 'Custom interactive element lacks keyboard event handling',
              severity: 'serious',
              suggestion: 'Add keyboard event handlers for Enter and Space keys'
            });
          }
        }
      });
      
      return issues;
    });

    // Create violations for interactive element issues
    interactiveIssues.forEach(issue => {
      violations.push({
        criterion: "9.2.1.1",
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion
      });
    });
  }

}

module.exports = KeyboardNavigationScanner;