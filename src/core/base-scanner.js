/**
 * BaseScanner
 * Abstract base class for all accessibility scanners.
 * Subclasses receive an already-loaded Puppeteer page and return a ScanResult.
 * They never launch browsers, create pages or navigate; ScanPipeline does that.
 */
const { injectableCode: renderedCode } = require('../utils/rendered');
const path = require('path');
const config = require('../config');

class BaseScanner {
  /**
   * @param {string} id - unique scanner identifier (e.g. 'color-contrast')
   * @param {Object} metadata - optional WCAG metadata
   * @param {string[]} metadata.wcagCriteria - e.g. ['1.4.3', '1.4.6']
   * @param {string}   metadata.wcagPrinciple - 'perceivable' | 'operable' | 'understandable' | 'robust'
   */
  constructor(id, metadata = {}) {
    if (new.target === BaseScanner) {
      throw new Error('BaseScanner is abstract and cannot be instantiated directly');
    }
    this.id = id;
    this.wcagCriteria = metadata.wcagCriteria || [];
    this.wcagPrinciple = metadata.wcagPrinciple || 'robust';
  }

  /** Directory for this scanner's screenshots (config.screenshotDir/<id>). */
  get screenshotDir() {
    return path.join(config.screenshotDir, this.id);
  }

  /**
   * Core scan method. Receives an already-loaded page.
   *
   * @param {import('puppeteer').Page} page - navigated Puppeteer page
   * @param {Object}                   options - pipeline-forwarded options
   * @returns {Promise<ScanResult>}
   *
   * @typedef {Object} ScanResult
   * @property {string}      scannerId - this.id
   * @property {boolean}     passed - true when violations.length === 0
   * @property {Violation[]} violations
   * @property {Object}      summary - scanner-specific summary data
   */
  async scan(page, options = {}) {
    throw new Error(`${this.id}: scan() not implemented`);
  }

  /**
   * Scanners that modify viewport, navigate, simulate keyboard input,
   * or otherwise mutate page state must return true. The pipeline will
   * re-navigate between exclusive scanners to reset state.
   */
  get needsExclusiveAccess() {
    return false;
  }

  /**
   * Helper to build a standardized violation object.
   * @param {string} severity - 'violation' | 'best-practice' | 'info'
   */
  formatViolation(ruleId, impact, description, nodes = [], helpUrl = '', severity = 'violation') {
    return {
      scannerId: this.id,
      ruleId,
      impact,
      severity,
      description,
      nodes,
      helpUrl,
      wcagCriteria: this.wcagCriteria,
    };
  }

  /**
   * Returns a self-contained JS function source string for use inside page.evaluate().
   * Checks display:none, visibility:hidden, aria-hidden="true", and the hidden attribute.
   * Usage in scanner: inject into evaluate via `${BaseScanner.visibilityFilterScript}`
   * then call `isElementVisible(el)` inside the browser context.
   */
  /**
   * Triggers common page interactions to reveal JS-driven ARIA state.
   * Opt-in via options.jsInteraction = true.
   * Submits empty forms, clicks toggle triggers, focuses inputs.
   * @param {import('puppeteer').Page} page
   */
  static async triggerCommonInteractions(page) {
    // Submit empty forms to trigger validation messages
    const forms = await page.$$('form');
    for (const form of forms) {
      const submit = await form.$(
        'button[type="submit"], input[type="submit"], button:not([type])'
      );
      if (submit) {
        try {
          await submit.click();
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          /* non-fatal */
        }
      }
    }

    // Click toggle triggers (modals, dropdowns, accordions)
    const toggleSelectors =
      '[data-toggle], [data-bs-toggle], [aria-haspopup="true"], [aria-expanded="false"]';
    const toggles = await page.$$(toggleSelectors);
    for (const toggle of toggles.slice(0, 5)) {
      // limit to 5 to avoid runaway
      try {
        await toggle.click();
        await new Promise((r) => setTimeout(r, 200));
      } catch {
        /* non-fatal */
      }
    }

    // Focus first few form inputs to trigger describedby associations
    const inputs = await page.$$('input, select, textarea');
    for (const input of inputs.slice(0, 5)) {
      try {
        await input.focus();
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        /* non-fatal */
      }
    }

    // Brief settle time
    await new Promise((r) => setTimeout(r, 300));
  }

  /**
   * Injectable helpers shared by scanners that run inside page.evaluate().
   * Includes everything from src/utils/rendered.js (__isRendered,
   * __isFocusableRendered, __isInteractiveTarget, __isSrOnly) plus
   * isElementVisible() and isSrOnly().
   *
   * isElementVisible() differs from __isRendered(): it answers
   * "is this exposed to assistive technology?" (hidden / aria-hidden /
   * display / visibility, including ancestors) and does not require a painted
   * box, so sr-only content still counts as visible to AT.
   */
  static get visibilityFilterScript() {
    return `
      ${renderedCode}
      function isElementVisible(el) {
        if (!el || !el.nodeType || el.nodeType !== 1) return false;
        if (el.closest('[hidden], [aria-hidden="true"]')) return false;
        if (typeof el.checkVisibility === 'function') {
          return el.checkVisibility({ checkVisibilityCSS: true });
        }
        let n = el;
        while (n && n.nodeType === 1) {
          const style = window.getComputedStyle(n);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          n = n.parentElement;
        }
        return true;
      }

      function isSrOnlyElement(el) {
        if (!el || el.nodeType !== 1) return false;
        const cls = el.className || '';
        if (typeof cls === 'string' && (/\\bsr-only\\b/.test(cls) || /\\bvisually-hidden\\b/.test(cls))) return true;
        return __isSrOnly(el);
      }
    `;
  }

  /**
   * Dismiss alert, confirm and prompt dialogs for as long as the returned
   * cleanup function has not been called.
   *
   * A scanner that clicks the page's own controls will sooner or later hit a
   * handler that calls alert(). A blocking dialog stops the page's JavaScript,
   * so every later click and every page.evaluate() in that scanner hangs until
   * its timeout. Puppeteer only dismisses dialogs by itself while nothing is
   * listening, and several scanners in this pipeline share one page.
   *
   * @param {import('puppeteer').Page} page
   * @returns {() => void} cleanup
   */
  static dismissDialogs(page) {
    const onDialog = (dialog) => {
      dialog.dismiss().catch(() => {});
    };
    page.on('dialog', onDialog);
    return () => page.off('dialog', onDialog);
  }
}

module.exports = BaseScanner;
