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
   */
  formatViolation(ruleId, impact, description, nodes = [], helpUrl = '') {
    return {
      scannerId: this.id,
      ruleId,
      impact,
      description,
      nodes,
      helpUrl,
      wcagCriteria: this.wcagCriteria,
    };
  }
}

module.exports = BaseScanner;
