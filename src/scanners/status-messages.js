/**
 * Status Messages Scanner.
 * WCAG 4.1.3 (EN 301 549 9.4.1.3).
 * Installs a MutationObserver that records the nodes a page actually changes,
 * drives the page's own buttons and form submits, and reports the containers
 * that gained content during an interaction step in which no live region was
 * updated.
 */
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const log = require('../utils/logger').createLogger('status-messages');

class StatusMessagesScanner extends BaseScanner {
  constructor() {
    super('status-messages', {
      wcagCriteria: ['4.1.3'],
      wcagPrinciple: 'robust',
    });
  }

  /**
   * This scanner clicks submit and action buttons to reveal JS-driven status
   * messages. Non-exclusive scanners share one page, so those clicks would
   * mutate DOM that read-only scanners inspect concurrently. Exclusive access
   * gives this scanner its own tab.
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
      simulateInteractions: true,
      timeout: TIMEOUTS.scanner,
      ...options,
    };

    // The observer has to exist before anything is clicked, or the mutations
    // the clicks cause are not witnessed.
    await this.installMutationObserver(page);

    if (scanOptions.simulateInteractions && !scanOptions.heuristicOnly) {
      await this.simulateInteractions(page, scanOptions);
    } else {
      // No simulated interactions: hold the window open anyway so content
      // that updates on its own (timers, deferred fetches) is recorded.
      await new Promise((resolve) => setTimeout(resolve, this.getObservationWindow(scanOptions)));
    }

    const violations = await this.analyzeStatusRegions(page);

    return {
      scannerId: this.id,
      criteria: ['4.1.3'],
      passed: violations.length === 0,
      violations: violations,
      summary: {
        errorMessageIssues: violations.filter((v) => v.category === 'error-message').length,
        successMessageIssues: violations.filter((v) => v.category === 'success-message').length,
        loadingStateIssues: violations.filter((v) => v.category === 'loading-state').length,
        dynamicContentIssues: violations.filter((v) => v.category === 'dynamic-content').length,
        progressIndicatorIssues: violations.filter((v) => v.category === 'progress-indicator')
          .length,
      },
      recommendations: this.generateStatusMessagesRecommendations(violations),
    };
  }

  /**
   * Minimum practical MutationObserver window (ms). Even under the "fast"
   * scan profile (`observationTime: 0`) a brief settle window is needed so a
   * DOM mutation caused by a click is recorded before the analysis pass reads
   * it.
   */
  getObservationWindow(options = {}) {
    const MIN_WINDOW_MS = 400;
    if (typeof options.observationTime === 'number') {
      return Math.max(options.observationTime, MIN_WINDOW_MS);
    }
    return MIN_WINDOW_MS;
  }

  /**
   * Install a page-lifetime MutationObserver plus the helpers every later
   * page.evaluate() in this scanner uses.
   *
   * The observer records the elements that actually changed, by identity:
   * the container whose children or text changed, every element node that was
   * inserted, and the element whose aria-valuenow/aria-valuetext changed.
   * `<html>`, `<head>` and `<body>` are never recorded: a script that appends
   * a cookie banner to the body changes the body, and treating that as
   * evidence about every element on the page is what made the previous
   * `closest()` based gate fire everywhere.
   *
   * Every record carries the interaction step it happened in
   * (window.__a11yStatusStep, advanced from Node before each click), which is
   * what lets the analysis tell "this content changed and nothing was
   * announced" from "this content changed and the page announced it in a live
   * region at the same moment".
   */
  async installMutationObserver(page) {
    await page.evaluate(`
      (function () {
        if (window.__a11yStatusObserverInstalled) return;
        window.__a11yStatusObserverInstalled = true;

        window.__a11yStatusStep = 0;
        // Element -> Set of interaction steps in which it changed.
        const mutations = new Map();

        function record(node) {
          if (!node || node.nodeType !== 1) return;
          const tag = node.tagName;
          if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY') return;
          if (!mutations.has(node)) mutations.set(node, new Set());
          mutations.get(node).add(window.__a11yStatusStep);
        }

        const observer = new MutationObserver((records) => {
          for (const m of records) {
            if (m.type === 'characterData') {
              record(m.target.parentElement);
              continue;
            }
            record(m.target);
            if (m.type === 'childList') {
              for (const added of m.addedNodes) record(added);
            }
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          characterData: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-valuenow', 'aria-valuetext'],
        });
        window.__a11yStatusObserver = observer;

        const LIVE_SELECTOR = '[aria-live], [role="status"], [role="alert"], [role="log"]';

        window.__a11yStatusHelpers = {
          // An element that is itself a live region, or sits inside one, is
          // already announced and is never a finding.
          hasLiveRegionAttributes(element) {
            if (!element) return false;
            if (element.hasAttribute('aria-live')) return true;
            const role = element.getAttribute('role');
            if (role && ['status', 'alert', 'log'].includes(role)) return true;
            return !!(element.closest && element.closest(LIVE_SELECTOR));
          },

          // The interaction steps in which some live region on the page was
          // updated. A change that happened in one of those steps was
          // accompanied by an announcement, so it is not reported: the
          // announcement may well have described it, and this scanner does not
          // read announcement text.
          announcedSteps() {
            const announced = new Set();
            for (const [node, steps] of mutations) {
              if (!node.isConnected) continue;
              if (!node.closest(LIVE_SELECTOR)) continue;
              for (const step of steps) announced.add(step);
            }
            return announced;
          },

          // Evidence: the element changed in at least one step in which no
          // live region was updated.
          unannouncedChange(element, announced) {
            const steps = mutations.get(element);
            if (!steps) return false;
            for (const step of steps) {
              if (!announced.has(step)) return true;
            }
            return false;
          },

          // Evidence for a slot that is empty at load, is referenced by a
          // control's aria-describedby/aria-errormessage, and has no live
          // region anywhere on the page to announce what will be written into
          // it.
          isDescribedbyErrorSlot(element) {
            if (!element || !element.id || element.textContent.trim()) return false;
            const referrer = document.querySelector(
              '[aria-describedby~="' + element.id + '"], [aria-errormessage="' + element.id + '"]'
            );
            if (!referrer) return false;
            return !document.querySelector(LIVE_SELECTOR);
          },
        };
      })();
    `);
  }

  /**
   * Block navigation caused by the clicks this scanner simulates.
   * A real submit or link navigation reloads the page under test: the status
   * messages under observation disappear with it, and the observer installed
   * above dies with the document.
   * Capture phase so the page's own submit and click handlers still run.
   */
  async suppressNavigation(page) {
    await page.evaluate(() => {
      document.addEventListener('submit', (event) => event.preventDefault(), true);
      document.addEventListener(
        'click',
        (event) => {
          const link = event.target.closest && event.target.closest('a[href]');
          if (link && !link.getAttribute('href').startsWith('#')) {
            event.preventDefault();
          }
        },
        true
      );
    });
  }

  /**
   * Drive the page so it produces the status messages it produces for a user:
   * submit up to three forms and click up to ten other buttons. Each
   * activation is its own interaction step, so the observer can tell which
   * change belongs to which activation. This produces no violations of its
   * own; it produces the evidence analyzeStatusRegions() reads.
   */
  async simulateInteractions(page, options) {
    const nextStep = () =>
      page.evaluate(() => {
        window.__a11yStatusStep += 1;
      });

    try {
      await this.suppressNavigation(page);

      const forms = await page.$$('form');
      for (const form of forms.slice(0, 3)) {
        const submitButton = await form.$(
          'button[type="submit"], input[type="submit"], button:not([type])'
        );
        if (!submitButton) continue;
        try {
          await nextStep();
          await submitButton.click();
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (e) {
          // A control that cannot be clicked (covered, detached) is not a finding.
        }
      }

      const buttons = await page.$$('button:not([type="submit"]), [role="button"]');
      for (const button of buttons.slice(0, 10)) {
        try {
          await nextStep();
          await button.click();
          await new Promise((resolve) => setTimeout(resolve, 400));
        } catch (e) {
          // Same as above.
        }
      }
    } catch (error) {
      log.warn('Error during interaction simulation:', error.message);
    }

    // Let late, microtask or timer scheduled updates land before the analysis
    // pass reads the observer.
    await new Promise((resolve) => setTimeout(resolve, this.getObservationWindow(options)));
  }

  /**
   * Report the status regions that changed without an announcement.
   *
   * A container is a candidate when a class or id token names it as a status
   * region (whole words, so "discount" is not a counter and "AccountButtons"
   * is not a count), it is painted, and it either changed during an
   * interaction step in which no live region was updated, or is an empty error
   * slot on a page with no live region at all. Each element is reported once,
   * under the first category that matches it.
   */
  async analyzeStatusRegions(page) {
    return await page.evaluate(`
      ${BaseScanner.visibilityFilterScript}
      (function () {
        const violations = [];
        const helpers = window.__a11yStatusHelpers;
        const announced = helpers.announcedSteps();
        const reported = new Set();

        function getElementSelector(element) {
          const tagName = element.tagName.toLowerCase();
          const id = element.id ? '#' + element.id : '';
          const className =
            element.className && typeof element.className === 'string'
              ? '.' + element.className.trim().split(/\\s+/)[0]
              : '';
          return tagName + id + className;
        }

        function tokens(element) {
          const raw =
            (typeof element.className === 'string' ? element.className : '') +
            ' ' +
            (element.id || '');
          return raw
            .split(/[^A-Za-z]+/)
            .flatMap(function (part) { return part.split(/(?=[A-Z])/); })
            .map(function (word) { return word.toLowerCase(); })
            .filter(Boolean);
        }

        const CATEGORIES = [
          {
            category: 'error-message',
            words: ['error', 'errors', 'invalid', 'danger'],
            severity: 'serious',
            description: 'Error message appeared without being announced in a live region',
            impact: 'Error messages are not announced to screen readers',
            recommendation: 'Add role="alert" or aria-live="assertive" to the error container',
          },
          {
            category: 'success-message',
            words: ['success', 'confirmation', 'confirmed', 'saved', 'submitted'],
            severity: 'moderate',
            description: 'Success message appeared without being announced in a live region',
            impact: 'Success confirmations are not announced to screen readers',
            recommendation: 'Add role="status" or aria-live="polite" to the container',
          },
          {
            category: 'loading-state',
            words: ['loading', 'spinner', 'loader', 'progress'],
            severity: 'moderate',
            description: 'Loading state changed without being announced in a live region',
            impact: 'Loading states are not announced to screen readers',
            recommendation: 'Add aria-live="polite" for loading state announcements',
          },
          {
            category: 'dynamic-content',
            words: [
              'notification',
              'notifications',
              'toast',
              'alert',
              'message',
              'notice',
              'status',
              'result',
              'results',
              'feedback',
            ],
            severity: 'moderate',
            description: 'Notification appeared without being announced in a live region',
            impact: 'Notifications are not announced to screen readers',
            recommendation: 'Add aria-live matching the urgency of the message',
          },
        ];

        function report(element, meta, evidence) {
          if (reported.has(element)) return;
          reported.add(element);
          violations.push({
            type: 'missing-live-region',
            category: meta.category,
            severity: meta.severity,
            element: getElementSelector(element),
            description: meta.description,
            details: {
              className: element.className,
              id: element.id,
              textContent: element.textContent.trim().substring(0, 100),
              currentRole: element.getAttribute('role'),
              evidence: evidence,
            },
            wcagCriteria: '4.1.3',
            impact: meta.impact,
            recommendation: meta.recommendation,
          });
        }

        const named = Array.from(document.querySelectorAll('[class], [id]'));

        for (const meta of CATEGORIES) {
          for (const element of named) {
            if (reported.has(element)) continue;
            const words = tokens(element);
            if (!words.some(function (word) { return meta.words.includes(word); })) continue;
            if (helpers.hasLiveRegionAttributes(element)) continue;
            if (!__isRendered(element)) continue;

            const hasText = !!element.textContent.trim();
            const changed = hasText && helpers.unannouncedChange(element, announced);
            const errorSlot =
              meta.category === 'error-message' && helpers.isDescribedbyErrorSlot(element);
            if (!changed && !errorSlot) continue;

            report(element, meta, { unannouncedChange: changed, describedbyErrorSlot: errorSlot });
          }
        }

        // Progress indicators: reported only when the value or the rendered
        // text was seen to change while nothing was announced. A static
        // progress bar (a skills bar on a CV page) never updates and is not a
        // status message.
        for (const progress of document.querySelectorAll('progress, [role="progressbar"]')) {
          if (reported.has(progress)) continue;
          if (helpers.hasLiveRegionAttributes(progress)) continue;
          if (progress.hasAttribute('aria-describedby')) continue;
          if (!__isRendered(progress)) continue;
          if (!helpers.unannouncedChange(progress, announced)) continue;

          report(
            progress,
            {
              category: 'progress-indicator',
              severity: 'moderate',
              description: 'Progress indicator changed without being announced in a live region',
              impact: 'Progress updates are not announced to screen readers',
              recommendation:
                'Add aria-live, or point aria-describedby at a live region that carries the progress text',
            },
            { unannouncedChange: true, describedbyErrorSlot: false }
          );
        }

        return violations;
      })();
    `);
  }

  /**
   * Generate recommendations for the reported status message issues.
   */
  generateStatusMessagesRecommendations(violations) {
    if (violations.length === 0) return [];
    return [
      {
        priority: 'high',
        issue: 'Content changed without a live region announcement',
        solution: 'Announce status changes through an ARIA live region',
        implementation:
          'Use role="alert" or aria-live="assertive" for errors, role="status" or aria-live="polite" for other updates, and write the message into a region that exists before the update',
      },
    ];
  }
}

module.exports = StatusMessagesScanner;
