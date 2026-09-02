/**
 * Orientation Scanner.
 * WCAG 1.3.4 (EN 301 549 9.1.3.4).
 * Reports the two ways a page restricts its view and operation to one display
 * orientation: a media query on orientation that takes the page's content
 * away, and an observed call to the screen orientation lock API.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: styleSheetCode } = require('../utils/stylesheets');
const log = require('../utils/logger').createLogger('orientation');

// Records every call to the screen orientation lock API, under its current and
// its prefixed names, before any of the page's own script runs. The criterion
// is about a page that locks the orientation, and only a call locks one: the
// same text inside a comment, a feature test or a bundled library that is
// never reached restricts nothing.
const INSTRUMENTATION = `
  (function () {
    if (window.__a11yOrientationLog) return;
    var log = { calls: [] };
    window.__a11yOrientationLog = log;
    function record(api, args) {
      try {
        log.calls.push({
          api: api,
          argument: String(args && args[0] !== undefined ? args[0] : ''),
          afterLoad: document.readyState === 'complete',
        });
      } catch (e) { /* never break the page */ }
    }
    function wrap(host, prop, api) {
      try {
        if (!host || typeof host[prop] !== 'function') return;
        var orig = host[prop];
        host[prop] = function () {
          record(api, arguments);
          return orig.apply(this, arguments);
        };
      } catch (e) { /* read-only property */ }
    }
    wrap(screen, 'lockOrientation', 'screen.lockOrientation');
    wrap(screen, 'mozLockOrientation', 'screen.mozLockOrientation');
    wrap(screen, 'msLockOrientation', 'screen.msLockOrientation');
    wrap(screen, 'webkitLockOrientation', 'screen.webkitLockOrientation');
    if (screen.orientation) wrap(screen.orientation, 'lock', 'screen.orientation.lock');
    // The scan gives the page one click, because a lock call is normally made
    // from a gesture handler. The page's handlers still run; only the
    // browser's own follow-up (navigate, submit) is suppressed, so the scan
    // stays on the document it measured.
    var stop = function (e) { e.preventDefault(); };
    document.addEventListener('click', stop, true);
    document.addEventListener('submit', stop, true);
  })();
`;

class OrientationScanner extends BaseScanner {
  constructor() {
    super('orientation', {
      wcagCriteria: ['1.3.4'],
      wcagPrinciple: 'perceivable',
    });
  }

  /** Reloads the page with the lock API instrumented, so it owns its tab. */
  get needsExclusiveAccess() {
    return true;
  }

  /** Reload with the lock API wrapped. */
  async _instrument(page, options) {
    try {
      const url = page.url();
      if (!url || !/^https?:/i.test(url)) return false;
      await page.evaluateOnNewDocument(INSTRUMENTATION);
      // domcontentloaded, not networkidle0: the pipeline gives every exclusive
      // scanner its own navigation already, and a second full load of a heavy
      // page costs more than the lock call is worth. Scripts that call the API
      // run at parse time or from the load handler, which the settle below
      // covers.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: options.timeout || 30000 });
      // Deferred scripts and load handlers register and fire after DOMContentLoaded.
      await new Promise((r) => setTimeout(r, 500));
      return await page.evaluate(() => Boolean(window.__a11yOrientationLog));
    } catch (e) {
      log.warn(`orientation: lock instrumentation unavailable (${e.message})`);
      return false;
    }
  }

  /** The calls recorded so far. */
  async _lockCalls(page) {
    try {
      return (
        (await page.evaluate(() =>
          window.__a11yOrientationLog ? window.__a11yOrientationLog.calls : []
        )) || []
      );
    } catch (e) {
      return [];
    }
  }

  /** Give the page its first interaction and see whether it locks then. */
  async _firstInteraction(page) {
    try {
      // Nothing to provoke on a page that ships no script.
      const scripted = await page.evaluate(
        () => document.scripts.length > 0 || !!document.querySelector('[onclick]')
      );
      if (!scripted) return;
      const target = await page.$(
        'button, [role="button"], summary, a[href], input[type="button"], input[type="submit"]'
      );
      if (!target) return;
      await target.click({ delay: 10 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      /* an element that went away between the query and the click */
    }
  }

  async scan(page, options = {}) {
    const dismiss = BaseScanner.dismissDialogs(page);
    const instrumented = await this._instrument(page, options);
    let lockCalls = await this._lockCalls(page);

    const orientationResults = await page.evaluate(
      async (injectedCode, styleSheetInjectedCode) => {
        eval(injectedCode);
        eval(styleSheetInjectedCode);
        const violations = [];

        function getSelector(el) {
          return (
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (el.className && typeof el.className === 'string'
              ? `.${el.className.split(' ')[0]}`
              : '')
          );
        }

        // SC 1.3.4 is failed when the content or operation is RESTRICTED to
        // one orientation, not when the layout differs between the two. A
        // rule that hides something in one orientation restricts the page
        // when what it hides is the page: the document's main content, or a
        // box that covers the viewport. Hiding a duplicate that the other
        // orientation shows instead (.landscape-only beside .portrait-only)
        // takes nothing away.
        const VIEWPORT_AREA = Math.max(1, window.innerWidth * window.innerHeight);
        const PRIMARY_SELECTOR = 'html, body, main, [role="main"]';

        function restrictionOf(el) {
          if (el.matches(PRIMARY_SELECTOR)) return 'primary content';
          if (el.querySelector('main, [role="main"]')) return 'primary content';
          const rect = el.getBoundingClientRect();
          const covered =
            Math.min(rect.width, window.innerWidth) * Math.min(rect.height, window.innerHeight);
          if (covered / VIEWPORT_AREA >= 0.8) return 'the whole viewport';
          return null;
        }

        // The second shape of the restriction: the orientation query does not
        // hide the content but paints a full-screen panel over it that asks
        // the user to rotate the device.
        const ROTATE_WORDS =
          /rotate|turn your|drehen|drehe|querformat|hochformat|landscape mode|portrait mode/i;
        function isRotateOverlay(el) {
          const text = (el.textContent || '').trim();
          if (!text || !ROTATE_WORDS.test(text)) return false;
          const position = window.getComputedStyle(el).position;
          return (
            position === 'fixed' || position === 'absolute' || el.parentElement === document.body
          );
        }

        const restrictions = [];
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
                const reveals =
                  (style.getPropertyValue('display') &&
                    style.getPropertyValue('display') !== 'none') ||
                  style.getPropertyValue('visibility') === 'visible';
                if (!hides && !reveals) continue;
                let matched;
                try {
                  matched = Array.from(document.querySelectorAll(inner.selectorText));
                } catch (e) {
                  continue;
                }
                for (const el of matched) {
                  if (hides) {
                    if (!__isRendered(el)) continue;
                    const what = restrictionOf(el);
                    if (!what) continue;
                    restrictions.push({
                      selector: inner.selectorText,
                      lockedOrientation,
                      element: getSelector(el),
                      reason: `hides ${what}`,
                    });
                    continue;
                  }
                  // A revealed element is not rendered in the orientation the
                  // scan runs in, so it is judged by what it says.
                  if (!isRotateOverlay(el)) continue;
                  restrictions.push({
                    selector: inner.selectorText,
                    lockedOrientation,
                    element: getSelector(el),
                    reason: 'shows a full-screen panel asking the user to rotate the device',
                  });
                }
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

        // Cross-origin sheets are fetched and parsed, so a page whose CSS
        // sits on a CDN is measured instead of silently passing.
        const { sheets, unreadable } = await __readStyleSheets();
        for (const sheet of sheets) {
          let rules;
          try {
            rules = sheet.cssRules || sheet.rules;
          } catch (e) {
            continue;
          }
          if (rules) walkRules(rules);
        }

        const byOrientation = {};
        for (const entry of restrictions) {
          if (!byOrientation[entry.lockedOrientation]) byOrientation[entry.lockedOrientation] = [];
          byOrientation[entry.lockedOrientation].push(entry);
        }
        for (const [orientation, entries] of Object.entries(byOrientation)) {
          const selectors = [...new Set(entries.map((e) => e.selector))];
          violations.push({
            criterion: '9.1.3.4',
            element: entries[0].element,
            issue: 'orientation-lock-css',
            description: `@media (orientation: ${orientation}) ${entries[0].reason} (${selectors.slice(0, 3).join(', ')}), so the content is unavailable in that orientation`,
            severity: 'serious',
            lockedOrientation: orientation,
            affectedSelectors: selectors,
            suggestion:
              'Keep the content available in both orientations and adapt the layout instead of hiding it.',
          });
        }

        return { violations, unreadableStyleSheets: unreadable };
      },
      renderedCode,
      styleSheetCode
    );

    // The DOM is measured before the click, so a handler that navigates
    // cannot move the scan to another document.
    if (instrumented) {
      await this._firstInteraction(page);
      // The log is cumulative, so the second read is the whole record unless
      // the click navigated away and took it with it.
      const afterClick = await this._lockCalls(page);
      if (afterClick.length >= lockCalls.length) lockCalls = afterClick;
    }
    dismiss();

    const violations = orientationResults.violations;

    // Only an observed call locks the orientation.
    if (lockCalls.length > 0) {
      const call = lockCalls[0];
      violations.push({
        criterion: '9.1.3.4',
        element: 'script',
        issue: 'orientation-lock-js',
        description: `The page called ${call.api}(${call.argument}) to pin one orientation`,
        severity: 'critical',
        observedCalls: lockCalls.length,
        suggestion:
          'Remove the orientation lock and let the user view the content in any orientation.',
      });
    }

    return {
      scannerId: this.id,
      criteria: ['9.1.3.4'],
      passed: violations.length === 0,
      violations,
      summary: {
        hasOrientationLock: violations.length > 0,
        lockCallsObserved: lockCalls.length,
        lockApiInstrumented: instrumented,
        unreadableStyleSheets: orientationResults.unreadableStyleSheets.length,
        violationCount: violations.length,
      },
    };
  }
}

module.exports = OrientationScanner;
