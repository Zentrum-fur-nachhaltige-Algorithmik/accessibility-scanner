const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Hover/Focus Content Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criterion 9.1.4.13 (Content on Hover or Focus)
 * Checks: dismissable, hoverable, persistent
 * Hybrid: heuristic CSS/DOM check + interactive hover/focus simulation
 */
class HoverFocusContentScanner extends BaseScanner {
  constructor() {
    super('hover-focus-content', {
      wcagCriteria: ['1.4.13'],
      wcagPrinciple: 'perceivable',
    });
    this.screenshotDir = path.join(__dirname, '../tmp/hover-focus-screenshots');
  }

  get needsExclusiveAccess() { return true; }

  async scan(page, options = {}) {
    if (options.heuristicOnly) {
      return this.heuristicScan(page);
    }
    return this.fullScan(page, options);
  }

  /**
   * Heuristic scan — concurrent-compatible, pure CSS/DOM analysis
   */
  async heuristicScan(page) {
    console.log('Running heuristic hover/focus content check...');

    const result = await page.evaluate(() => {
      const violations = [];

      function getSelector(el) {
        return el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');
      }

      // 1. Scan stylesheets for :hover/:focus rules that toggle visibility
      const hoverContentSelectors = [];
      try {
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules || sheet.rules; } catch (e) { continue; }
          if (!rules) continue;

          for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            const sel = rule.selectorText || '';

            // Match patterns like .trigger:hover .content { display:block/opacity:1/visibility:visible }
            const isHoverRule = /:hover/i.test(sel);
            const isFocusRule = /:focus/i.test(sel);
            if (!isHoverRule && !isFocusRule) continue;

            const style = rule.style;
            const showsContent =
              style.display === 'block' || style.display === 'flex' || style.display === 'grid' ||
              style.visibility === 'visible' ||
              style.opacity === '1' ||
              (style.left && !style.left.startsWith('-')) ||
              (style.right && style.right !== '-300px');

            if (!showsContent) continue;

            // Handle comma-separated selectors: ".a:hover .b, .a:focus .b"
            // If the same rule contains both :hover and :focus selectors, mark as having equivalent
            const selectorParts = sel.split(',').map(s => s.trim());
            const hasHoverPart = selectorParts.some(s => /:hover/i.test(s));
            const hasFocusPart = selectorParts.some(s => /:focus/i.test(s));

            if (hasHoverPart) {
              hoverContentSelectors.push({
                selector: sel,
                type: 'hover',
                hasFocusEquivalent: hasFocusPart, // true if same rule also has :focus
              });
            }
            if (hasFocusPart && !hasHoverPart) {
              hoverContentSelectors.push({
                selector: sel,
                type: 'focus',
                hasFocusEquivalent: false,
              });
            }
          }

          // Check if hover-only rules have focus equivalents in OTHER rules
          for (const entry of hoverContentSelectors) {
            if (entry.type === 'hover' && !entry.hasFocusEquivalent) {
              const focusEquivalent = entry.selector.replace(/:hover/g, ':focus');
              const focusWithinEquivalent = entry.selector.replace(/:hover/g, ':focus-within');
              entry.hasFocusEquivalent = hoverContentSelectors.some(
                e => e.selector === focusEquivalent || e.selector === focusWithinEquivalent
              );
            }
          }
        }
      } catch (e) { /* stylesheet access error */ }

      // Flag hover-only content (no focus equivalent)
      for (const entry of hoverContentSelectors) {
        if (entry.type === 'hover' && !entry.hasFocusEquivalent) {
          violations.push({
            criterion: '9.1.4.13',
            element: entry.selector,
            issue: 'hover-only-no-focus',
            description: `Content shown on :hover has no :focus equivalent — keyboard users cannot access it`,
            severity: 'serious',
            suggestion: 'Add a :focus or :focus-within CSS rule that shows the same content.',
          });
        }
      }

      // 2. Check pointer-events:none on hover-revealed elements
      for (const entry of hoverContentSelectors) {
        // Extract the revealed content selector (part after :hover)
        const parts = entry.selector.split(/\s*:hover\s*/);
        if (parts.length < 2) continue;
        const contentSelector = parts[1].trim();
        if (!contentSelector) continue;

        try {
          const contentElements = document.querySelectorAll(contentSelector);
          contentElements.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.pointerEvents === 'none') {
              violations.push({
                criterion: '9.1.4.13',
                element: getSelector(el),
                issue: 'hover-content-not-hoverable',
                description: 'Hover-revealed content has pointer-events:none — users cannot move pointer to read it',
                severity: 'serious',
                suggestion: 'Remove pointer-events:none from hover-revealed content to make it hoverable.',
              });
            }
          });
        } catch (e) { /* invalid selector */ }
      }

      // 3. Flag title attributes on interactive elements
      const interactiveWithTitle = document.querySelectorAll(
        'a[title], button[title], input[title], [role="button"][title], [tabindex][title]'
      );
      interactiveWithTitle.forEach(el => {
        const title = el.getAttribute('title');
        if (!title || title.length < 5) return; // Skip trivially short titles
        // Check if there's also visible text or aria-label with the same info
        const text = el.textContent.trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        if (text.includes(title) || ariaLabel.includes(title)) return; // info already accessible

        violations.push({
          criterion: '9.1.4.13',
          element: getSelector(el),
          issue: 'title-attribute-as-content',
          description: `title="${title.substring(0, 50)}..." conveys content that is not dismissable or hoverable`,
          severity: 'moderate',
          suggestion: 'Use a visible tooltip pattern instead of the title attribute, with Escape to dismiss.',
        });
      });

      // 4. Check for mouseenter/mouseover inline handlers without focus equivalents
      const mouseOnlyHandlers = document.querySelectorAll('[onmouseenter], [onmouseover]');
      mouseOnlyHandlers.forEach(el => {
        const hasFocusHandler = el.hasAttribute('onfocus') || el.hasAttribute('onfocusin');
        if (!hasFocusHandler) {
          violations.push({
            criterion: '9.1.4.13',
            element: getSelector(el),
            issue: 'hover-only-no-focus',
            description: 'Element has mouseenter/mouseover handler but no focus handler — content not accessible via keyboard',
            severity: 'serious',
            suggestion: 'Add onfocus/onfocusin handlers that show the same content as the hover handler.',
          });
        }
      });

      // 5. Check for setTimeout patterns in scripts (auto-dismiss)
      let hasAutoClose = false;
      const scripts = document.querySelectorAll('script:not([src])');
      scripts.forEach(script => {
        const code = script.textContent || '';
        // Detect setTimeout near hide/close/display=none/remove patterns
        const autoClosePattern = /setTimeout\s*\([^)]*(?:display\s*=\s*['"]none|\.hide\(|\.remove\(|classList\.remove|\.close\(|opacity\s*=\s*['"]?0)/i;
        if (autoClosePattern.test(code)) {
          hasAutoClose = true;
        }
      });

      if (hasAutoClose) {
        violations.push({
          criterion: '9.1.4.13',
          element: 'script',
          issue: 'hover-content-not-persistent',
          description: 'JavaScript uses setTimeout to auto-hide content — content is not persistent until user dismisses it',
          severity: 'serious',
          suggestion: 'Remove auto-close timers. Content should remain visible until the user dismisses it or moves focus/pointer away.',
        });
      }

      // 6. Check for Escape key handler presence (absence = not dismissable)
      let hasEscapeHandler = false;
      scripts.forEach(script => {
        const code = script.textContent || '';
        if (/['"]Escape['"]/i.test(code) || /keyCode\s*===?\s*27/.test(code) || /key\s*===?\s*['"]Escape['"]/i.test(code)) {
          hasEscapeHandler = true;
        }
      });

      // Check inline handlers too
      if (!hasEscapeHandler) {
        const escInline = document.querySelectorAll('[onkeydown], [onkeyup], [onkeypress]');
        escInline.forEach(el => {
          const handler = (el.getAttribute('onkeydown') || '') + (el.getAttribute('onkeyup') || '');
          if (/Escape|27/.test(handler)) hasEscapeHandler = true;
        });
      }

      if (hoverContentSelectors.length > 0 && !hasEscapeHandler) {
        violations.push({
          criterion: '9.1.4.13',
          element: 'document',
          issue: 'hover-content-not-dismissable',
          description: 'Page has hover/focus-triggered content but no Escape key handler to dismiss it',
          severity: 'serious',
          suggestion: 'Add a keydown listener for Escape to dismiss any hover/focus-triggered content.',
        });
      }

      return {
        violations,
        hoverContentCount: hoverContentSelectors.length,
        hasAutoClose,
        hasEscapeHandler,
      };
    });

    return {
      scannerId: this.id,
      criteria: ['9.1.4.13'],
      passed: result.violations.length === 0,
      violations: result.violations,
      summary: {
        heuristicOnly: true,
        hoverContentCount: result.hoverContentCount,
        hasAutoClose: result.hasAutoClose,
        hasEscapeHandler: result.hasEscapeHandler,
        violationCount: result.violations.length,
      },
    };
  }

  /**
   * Full interactive scan — hover and focus elements to test dismissable/hoverable/persistent
   */
  async fullScan(page, options = {}) {
    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);
    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `hover-focus-scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    console.log('Running full interactive hover/focus content check...');

    // Run heuristic first to collect violations and identify hover content
    const heuristicResult = await this.heuristicScan(page);
    const violations = [...heuristicResult.violations];

    // Find hover-triggered elements to test interactively
    const hoverTriggers = await page.evaluate(() => {
      const triggers = [];

      // Find elements whose children become visible on hover
      const candidates = document.querySelectorAll(
        '[class*="tooltip"], [class*="dropdown"], [class*="popup"], [class*="popover"], ' +
        '[class*="hover"], [data-tooltip], [aria-describedby]'
      );

      candidates.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const selector = el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');

        triggers.push({
          selector,
          rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        });
      });

      return triggers.slice(0, 10); // Limit to avoid long scan times
    });

    // Test each hover trigger interactively
    for (const [i, trigger] of hoverTriggers.entries()) {
      try {
        // Move to trigger and hover
        await page.mouse.move(trigger.rect.x, trigger.rect.y);
        await new Promise(resolve => setTimeout(resolve, 400));

        // Take screenshot to see if new content appeared
        await page.screenshot({ path: path.join(scanDir, `hover-${i}-active.png`) });

        // Check if new content appeared
        const hoverContent = await page.evaluate((triggerSel) => {
          const trigger = document.querySelector(triggerSel);
          if (!trigger) return null;

          // Look for child elements that might have become visible
          const children = trigger.querySelectorAll('*');
          for (const child of children) {
            const style = window.getComputedStyle(child);
            if ((style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) &&
                child.offsetHeight > 0 && child.offsetWidth > 0) {
              const rect = child.getBoundingClientRect();
              const triggerRect = trigger.getBoundingClientRect();
              // Check if this is a "revealed" element (positioned outside trigger bounds)
              if (rect.bottom > triggerRect.bottom + 5 || rect.top < triggerRect.top - 5 ||
                  rect.right > triggerRect.right + 100) {
                return {
                  found: true,
                  contentRect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
                  contentSelector: child.tagName.toLowerCase() +
                    (child.id ? `#${child.id}` : '') +
                    (child.className && typeof child.className === 'string' ? `.${child.className.split(' ')[0]}` : ''),
                };
              }
            }
          }
          return { found: false };
        }, trigger.selector);

        if (hoverContent && hoverContent.found) {
          // Test hoverable: move pointer to the revealed content
          await page.mouse.move(hoverContent.contentRect.x, hoverContent.contentRect.y);
          await new Promise(resolve => setTimeout(resolve, 300));

          const contentStillVisible = await page.evaluate((contentSel) => {
            const el = document.querySelector(contentSel);
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
          }, hoverContent.contentSelector);

          if (!contentStillVisible) {
            // Check if already flagged by heuristic
            const alreadyFlagged = violations.some(
              v => v.issue === 'hover-content-not-hoverable' && v.element === hoverContent.contentSelector
            );
            if (!alreadyFlagged) {
              violations.push({
                criterion: '9.1.4.13',
                element: hoverContent.contentSelector,
                issue: 'hover-content-not-hoverable',
                description: 'Hover-triggered content disappears when pointer moves to it — content is not hoverable',
                severity: 'serious',
                suggestion: 'Ensure hover content remains visible when the pointer moves from trigger to content.',
              });
            }
          }

          // Test dismissable: press Escape
          await page.mouse.move(trigger.rect.x, trigger.rect.y);
          await new Promise(resolve => setTimeout(resolve, 400));
          await page.keyboard.press('Escape');
          await new Promise(resolve => setTimeout(resolve, 300));

          const dismissedByEscape = await page.evaluate((contentSel) => {
            const el = document.querySelector(contentSel);
            if (!el) return true;
            const style = window.getComputedStyle(el);
            return style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0;
          }, hoverContent.contentSelector);

          if (!dismissedByEscape) {
            const alreadyFlagged = violations.some(
              v => v.issue === 'hover-content-not-dismissable' && v.element !== 'document'
            );
            if (!alreadyFlagged) {
              violations.push({
                criterion: '9.1.4.13',
                element: trigger.selector,
                issue: 'hover-content-not-dismissable',
                description: 'Hover-triggered content is not dismissed by pressing Escape',
                severity: 'serious',
                suggestion: 'Add Escape key handler to dismiss hover/focus-triggered content without moving the pointer.',
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Error testing hover trigger ${trigger.selector}:`, error.message);
      }
    }

    return {
      scannerId: this.id,
      criteria: ['9.1.4.13'],
      passed: violations.length === 0,
      violations,
      summary: {
        hoverTriggersFound: hoverTriggers.length,
        heuristicViolations: heuristicResult.violations.length,
        interactiveViolations: violations.length - heuristicResult.violations.length,
        violationCount: violations.length,
      },
      screenshotPath: scanDir,
    };
  }
}

module.exports = HoverFocusContentScanner;
