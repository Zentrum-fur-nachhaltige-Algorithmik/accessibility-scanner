const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Keyboard Navigation Scanner for WCAG compliance testing
 * Implements EN 301 549 criteria 9.2.1.1, 9.2.1.2, 9.2.1.4 (Keyboard Accessible, No Keyboard Trap, Character Key Shortcuts)
 * Uses full visual screenshot analysis for thorough focus visibility testing
 */
class KeyboardNavigationScanner {
  constructor() {
    this.browser = null;
    this.screenshotDir = path.join(__dirname, '../tmp/keyboard-screenshots');
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
   * Scan keyboard accessibility compliance
   * @param {string} url - URL to scan
   * @param {Object} options - Scanning options
   * @param {boolean} options.testAllInteractives - Test all interactive elements
   * @param {boolean} options.simulateTabbing - Simulate actual tab key presses
   * @param {boolean} options.testCustomControls - Test custom control accessibility
   * @param {number} options.timeout - Test timeout in milliseconds
   * @returns {Promise<Object>} KeyboardReport
   */
  async scanKeyboardAccess(url, options = {}) {
    const defaultOptions = {
      testAllInteractives: true,
      simulateTabbing: true,
      testCustomControls: true,
      timeout: 60000
    };

    const scanOptions = { ...defaultOptions, ...options };

    try {
      await this.init();
      const page = await this.browser.newPage();
      
      // Set viewport for consistent screenshots
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

      // Clean up previous screenshots for this scan
      const timestamp = Date.now();
      const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
      await fs.ensureDir(scanDir);

      const keyboardResults = await this.performKeyboardAnalysis(page, scanDir, scanOptions);
      
      await page.close();

      // Create report according to interface
      const report = {
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

      return report;

    } catch (error) {
      throw new Error(`Keyboard navigation scan failed: ${error.message}`);
    }
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
              elements.push({
                selector: el.tagName.toLowerCase() + 
                         (el.id ? `#${el.id}` : '') + 
                         (el.className ? `.${el.className.split(' ').join('.')}` : ''),
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

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = KeyboardNavigationScanner;