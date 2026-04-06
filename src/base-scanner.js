/**
 * BaseScanner — abstract base class for all accessibility scanners.
 *
 * Subclasses receive an already-loaded Puppeteer page and return a
 * standardized ScanResult. They must NOT launch browsers, create pages,
 * or navigate — the ScanPipeline handles all of that.
 */
class BaseScanner {
  /**
   * @param {string} id       — unique scanner identifier (e.g. 'color-contrast')
   * @param {Object} metadata — optional WCAG metadata
   * @param {string[]} metadata.wcagCriteria  — e.g. ['1.4.3', '1.4.6']
   * @param {string}   metadata.wcagPrinciple — 'perceivable' | 'operable' | 'understandable' | 'robust'
   */
  constructor(id, metadata = {}) {
    if (new.target === BaseScanner) {
      throw new Error('BaseScanner is abstract and cannot be instantiated directly');
    }
    this.id = id;
    this.wcagCriteria = metadata.wcagCriteria || [];
    this.wcagPrinciple = metadata.wcagPrinciple || 'robust';
  }

  /**
   * Core scan method. Receives an already-loaded page.
   *
   * @param {import('puppeteer').Page} page    — navigated Puppeteer page
   * @param {Object}                   options — pipeline-forwarded options
   * @returns {Promise<ScanResult>}
   *
   * @typedef {Object} ScanResult
   * @property {string}      scannerId  — this.id
   * @property {boolean}     passed     — true when violations.length === 0
   * @property {Violation[]} violations
   * @property {Object}      summary    — scanner-specific summary data
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
   * @param {string} severity — 'violation' | 'best-practice' | 'info'
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
      const submit = await form.$('button[type="submit"], input[type="submit"], button:not([type])');
      if (submit) {
        try {
          await submit.click();
          await new Promise(r => setTimeout(r, 300));
        } catch { /* non-fatal */ }
      }
    }

    // Click toggle triggers (modals, dropdowns, accordions)
    const toggleSelectors = '[data-toggle], [data-bs-toggle], [aria-haspopup="true"], [aria-expanded="false"]';
    const toggles = await page.$$(toggleSelectors);
    for (const toggle of toggles.slice(0, 5)) { // limit to 5 to avoid runaway
      try {
        await toggle.click();
        await new Promise(r => setTimeout(r, 200));
      } catch { /* non-fatal */ }
    }

    // Focus first few form inputs to trigger describedby associations
    const inputs = await page.$$('input, select, textarea');
    for (const input of inputs.slice(0, 5)) {
      try {
        await input.focus();
        await new Promise(r => setTimeout(r, 100));
      } catch { /* non-fatal */ }
    }

    // Brief settle time
    await new Promise(r => setTimeout(r, 300));
  }

  static get visibilityFilterScript() {
    return `
      function isElementVisible(el) {
        if (!el || !el.nodeType || el.nodeType !== 1) return false;
        if (el.hasAttribute('hidden')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        return true;
      }
    `;
  }
}

module.exports = BaseScanner;
