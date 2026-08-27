const BaseScanner = require('../core/base-scanner');

/**
 * Orientation Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criterion 9.1.3.4 (Orientation)
 * Detects CSS/JS-based orientation locks that restrict content to a single display orientation
 */
class OrientationScanner extends BaseScanner {
  constructor() {
    super('orientation', {
      wcagCriteria: ['1.3.4'],
      wcagPrinciple: 'perceivable',
    });
  }

  get needsExclusiveAccess() {
    return false;
  }

  async scan(page, options = {}) {
    const orientationResults = await page.evaluate(() => {
      const violations = [];

      function getSelector(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '')
        );
      }

      // 1. Check CSS @media orientation rules
      const orientationMediaViolations = [];
      try {
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules || sheet.rules;
          } catch (e) {
            // Cross-origin stylesheet — skip
            continue;
          }
          if (!rules) continue;

          for (const rule of rules) {
            if (rule instanceof CSSMediaRule) {
              const media = rule.conditionText || rule.media?.mediaText || '';
              const orientationMatch = media.match(/orientation\s*:\s*(portrait|landscape)/i);
              if (!orientationMatch) continue;

              const lockedOrientation = orientationMatch[1].toLowerCase();

              // Check for content-hiding rules within this media query
              for (const innerRule of rule.cssRules || []) {
                if (!(innerRule instanceof CSSStyleRule)) continue;
                const style = innerRule.style;
                const display = style.getPropertyValue('display');
                const visibility = style.getPropertyValue('visibility');
                const width = style.getPropertyValue('width');
                const height = style.getPropertyValue('height');
                const maxHeight = style.getPropertyValue('max-height');

                const hidesContent =
                  display === 'none' ||
                  visibility === 'hidden' ||
                  width === '0' ||
                  width === '0px' ||
                  height === '0' ||
                  height === '0px' ||
                  maxHeight === '0' ||
                  maxHeight === '0px';

                if (hidesContent) {
                  // Verify the selector targets real elements
                  const matched = document.querySelectorAll(innerRule.selectorText);
                  if (matched.length > 0) {
                    orientationMediaViolations.push({
                      selector: innerRule.selectorText,
                      lockedOrientation,
                      property:
                        display === 'none'
                          ? 'display:none'
                          : visibility === 'hidden'
                            ? 'visibility:hidden'
                            : 'dimension:0',
                    });
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // Stylesheet access error — non-fatal
      }

      if (orientationMediaViolations.length > 0) {
        // Deduplicate — group by locked orientation
        const byOrientation = {};
        for (const v of orientationMediaViolations) {
          const key = v.lockedOrientation;
          if (!byOrientation[key]) byOrientation[key] = [];
          byOrientation[key].push(v.selector);
        }
        for (const [orientation, selectors] of Object.entries(byOrientation)) {
          violations.push({
            criterion: '9.1.3.4',
            element: selectors[0],
            issue: 'orientation-lock-css',
            description: `CSS @media (orientation: ${orientation}) hides content (${selectors.length} element(s) affected: ${selectors.slice(0, 3).join(', ')}${selectors.length > 3 ? '...' : ''})`,
            severity: 'serious',
            lockedOrientation: orientation,
            affectedSelectors: selectors,
            suggestion:
              'Remove orientation-dependent display:none/visibility:hidden rules. Use responsive layout that works in both orientations.',
          });
        }
      }

      // 2. Check for forced fixed dimensions that only work in one orientation
      const forcedLandscape = document.querySelectorAll('[style*="min-width"]');
      forcedLandscape.forEach((el) => {
        const style = window.getComputedStyle(el);
        const minWidth = parseFloat(style.minWidth);
        const overflow = style.overflow;
        if (minWidth >= 800 && overflow === 'hidden') {
          violations.push({
            criterion: '9.1.3.4',
            element: getSelector(el),
            issue: 'forced-dimensions',
            description: `Element has min-width: ${Math.round(minWidth)}px with overflow:hidden — forces landscape-only viewing`,
            severity: 'serious',
            suggestion:
              'Use responsive width (max-width, %, vw) and allow overflow:auto or remove overflow:hidden.',
          });
        }
      });

      // Also check CSS classes with forced dimensions
      const allElements = document.querySelectorAll('*');
      allElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const minWidth = parseFloat(style.minWidth);
        const overflow = style.overflow;
        const display = style.display;
        if (display === 'none' || !el.textContent.trim()) return;
        if (minWidth >= 800 && overflow === 'hidden') {
          // Avoid duplicates from inline style check above
          if (el.style.minWidth) return;
          violations.push({
            criterion: '9.1.3.4',
            element: getSelector(el),
            issue: 'forced-dimensions',
            description: `Element has min-width: ${Math.round(minWidth)}px with overflow:hidden — content inaccessible in portrait`,
            severity: 'serious',
            suggestion: 'Use responsive sizing. Replace fixed min-width with flexible layout.',
          });
        }
      });

      // 3. Check JavaScript for orientation lock calls
      const scripts = document.querySelectorAll('script:not([src])');
      scripts.forEach((script) => {
        const code = script.textContent || '';

        if (/screen\.orientation\.lock/i.test(code) || /screen\.lockOrientation/i.test(code)) {
          violations.push({
            criterion: '9.1.3.4',
            element: 'script',
            issue: 'orientation-lock-js',
            description:
              'JavaScript calls screen.orientation.lock() to force a specific orientation',
            severity: 'critical',
            suggestion:
              'Remove screen.orientation.lock() calls. Allow users to view content in any orientation.',
          });
        }
      });

      // 4. Check for "rotate your device" messages
      const rotatePatterns =
        /\b(rotate|drehen|drehung).{0,30}(device|phone|tablet|gerät|bildschirm)/i;
      const landscapeOnly = /\b(landscape|querformat)\s+(only|mode|modus|required|erforderlich)\b/i;
      const portraitOnly = /\b(portrait|hochformat)\s+(only|mode|modus|required|erforderlich)\b/i;

      allElements.forEach((el) => {
        if (el.children.length > 0) return; // only leaf text nodes
        const text = el.textContent.trim();
        if (!text || text.length > 200) return;

        if (rotatePatterns.test(text) || landscapeOnly.test(text) || portraitOnly.test(text)) {
          // Check if this element or a parent becomes visible via orientation media query
          const style = window.getComputedStyle(el);
          if (style.display !== 'none') {
            violations.push({
              criterion: '9.1.3.4',
              element: getSelector(el),
              issue: 'rotate-device-message',
              description: `"Rotate your device" message detected: "${text.substring(0, 80)}..."`,
              severity: 'serious',
              suggestion:
                'Design a responsive layout that works in both orientations instead of asking users to rotate.',
            });
          }
        }
      });

      return {
        violations,
        hasOrientationLock: violations.some(
          (v) => v.issue === 'orientation-lock-js' || v.issue === 'orientation-lock-css'
        ),
        hasForcedDimensions: violations.some((v) => v.issue === 'forced-dimensions'),
        hasRotateMessage: violations.some((v) => v.issue === 'rotate-device-message'),
      };
    });

    return {
      scannerId: this.id,
      criteria: ['9.1.3.4'],
      passed: orientationResults.violations.length === 0,
      violations: orientationResults.violations,
      summary: {
        hasOrientationLock: orientationResults.hasOrientationLock,
        hasForcedDimensions: orientationResults.hasForcedDimensions,
        hasRotateMessage: orientationResults.hasRotateMessage,
        violationCount: orientationResults.violations.length,
      },
    };
  }
}

module.exports = OrientationScanner;
