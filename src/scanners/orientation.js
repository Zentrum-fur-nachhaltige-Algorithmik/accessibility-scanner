/**
 * Orientation Scanner.
 * WCAG 1.3.4 (EN 301 549 9.1.3.4).
 * Reports the two ways a page locks itself to one display orientation: a media
 * query on orientation that hides rendered content, and a call to the screen
 * orientation lock API.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');

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
    const orientationResults = await page.evaluate((injectedCode) => {
      eval(injectedCode);
      const violations = [];

      function getSelector(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '')
        );
      }

      // A media query on orientation that hides content the user can see in the
      // current orientation: rotating the device removes it. Rules whose
      // selector matches nothing, or only elements that are not painted anyway,
      // hide nothing.
      const hiddenByOrientation = [];
      const walkRules = (rules) => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule) {
            const media = rule.conditionText || rule.media?.mediaText || '';
            const match = media.match(/orientation\s*:\s*(portrait|landscape)/i);
            if (!match) {
              if (rule.cssRules) walkRules(rule.cssRules);
              continue;
            }
            const lockedOrientation = match[1].toLowerCase();
            for (const inner of rule.cssRules || []) {
              if (!(inner instanceof CSSStyleRule)) continue;
              const style = inner.style;
              const zero = (v) => v === '0' || v === '0px';
              const hides =
                style.getPropertyValue('display') === 'none' ||
                style.getPropertyValue('visibility') === 'hidden' ||
                zero(style.getPropertyValue('width')) ||
                zero(style.getPropertyValue('height')) ||
                zero(style.getPropertyValue('max-height'));
              if (!hides) continue;
              let matched;
              try {
                matched = Array.from(document.querySelectorAll(inner.selectorText));
              } catch (e) {
                continue;
              }
              const rendered = matched.filter((el) => __isRendered(el));
              if (rendered.length === 0) continue;
              hiddenByOrientation.push({
                selector: inner.selectorText,
                lockedOrientation,
                elements: rendered.map(getSelector),
              });
            }
            continue;
          }
          if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
            try {
              walkRules(rule.cssRules);
            } catch (e) {
              /* nested rules of an unreadable sheet */
            }
          }
        }
      };
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules || sheet.rules;
        } catch (e) {
          continue; // cross-origin stylesheet
        }
        if (rules) walkRules(rules);
      }

      const byOrientation = {};
      for (const entry of hiddenByOrientation) {
        if (!byOrientation[entry.lockedOrientation]) byOrientation[entry.lockedOrientation] = [];
        byOrientation[entry.lockedOrientation].push(entry);
      }
      for (const [orientation, entries] of Object.entries(byOrientation)) {
        const selectors = entries.map((e) => e.selector);
        const elements = entries.flatMap((e) => e.elements);
        violations.push({
          criterion: '9.1.3.4',
          element: elements[0] || selectors[0],
          issue: 'orientation-lock-css',
          description: `@media (orientation: ${orientation}) hides ${elements.length} rendered element(s) (${selectors.slice(0, 3).join(', ')}), so the content is unavailable in that orientation`,
          severity: 'serious',
          lockedOrientation: orientation,
          affectedSelectors: selectors,
          suggestion:
            'Keep the content available in both orientations and adapt the layout instead of hiding it.',
        });
      }

      // The screen orientation lock API is the only way a page can pin the
      // display orientation itself. A call to it is the failure.
      const lockCall = /screen\s*\.\s*orientation\s*\.\s*lock\s*\(|\.\s*lockOrientation\s*\(/;
      for (const script of document.querySelectorAll('script:not([src])')) {
        if (!lockCall.test(script.textContent || '')) continue;
        violations.push({
          criterion: '9.1.3.4',
          element: 'script',
          issue: 'orientation-lock-js',
          description: 'The page calls the screen orientation lock API to pin one orientation',
          severity: 'critical',
          suggestion:
            'Remove the orientation lock and let the user view the content in any orientation.',
        });
        break;
      }

      return {
        violations,
        hasOrientationLock: violations.length > 0,
      };
    }, renderedCode);

    return {
      scannerId: this.id,
      criteria: ['9.1.3.4'],
      passed: orientationResults.violations.length === 0,
      violations: orientationResults.violations,
      summary: {
        hasOrientationLock: orientationResults.hasOrientationLock,
        violationCount: orientationResults.violations.length,
      },
    };
  }
}

module.exports = OrientationScanner;
