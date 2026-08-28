/**
 * Error Handling Scanner.
 * WCAG 3.3.1, 3.3.2, 3.3.3 (EN 301 549 9.3.3.1 to 9.3.3.3).
 * Reports fields whose error state carries no text, fields and groups of fields
 * with no accessible name, and fields that enforce a format they never state.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: accnameCode } = require('../utils/accessible-name');
const log = require('../utils/logger').createLogger('error-handling');

class ErrorHandlingScanner extends BaseScanner {
  constructor() {
    super('error-handling', {
      wcagCriteria: ['3.3.1', '3.3.2', '3.3.3'],
      wcagPrinciple: 'understandable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page) {
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const errorResults = await this.performErrorHandlingAnalysis(page, scanDir);

    return {
      scannerId: this.id,
      criteria: ['9.3.3.1', '9.3.3.2', '9.3.3.3'],
      passed: errorResults.violations.length === 0,
      violations: errorResults.violations,
      summary: {
        errorsIdentified: errorResults.errorsIdentified,
        labelsProvided: errorResults.labelsProvided,
        suggestionsProvided: errorResults.suggestionsProvided,
      },
      screenshotPath: scanDir,
      visualEvidence: errorResults.visualEvidence,
    };
  }

  /**
   * Read every form control once and turn the readings into violations.
   */
  async performErrorHandlingAnalysis(page, scanDir) {
    const violations = [];

    log.debug('Starting error handling analysis...');

    const initialScreenshot = path.join(scanDir, 'error-handling-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    const findings = await this.analyzeForms(page);

    const criterionOf = {
      'error-message-not-associated': '9.3.3.1',
      'field-no-label': '9.3.3.2',
      'group-no-name': '9.3.3.2',
      'pattern-field-no-format-suggestion': '9.3.3.3',
    };

    for (const issue of findings) {
      violations.push({
        criterion: criterionOf[issue.type],
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        evidence: issue.evidence,
        suggestion: this.getSuggestion(issue.type),
      });
    }

    log.debug(`Error handling analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence: [
        {
          type: 'error-handling',
          screenshot: path.basename(initialScreenshot),
          findings: violations.length,
        },
      ],
      errorsIdentified: !violations.some((v) => v.criterion === '9.3.3.1'),
      labelsProvided: !violations.some((v) => v.criterion === '9.3.3.2'),
      suggestionsProvided: !violations.some((v) => v.criterion === '9.3.3.3'),
    };
  }

  /**
   * Every check reads the accessible name and description of a control, so
   * they all run in one pass over the form controls.
   */
  async analyzeForms(page) {
    return page.evaluate(
      (renderedHelpers, accnameHelpers) => {
        eval(renderedHelpers);
        eval(accnameHelpers);
        const issues = [];

        function selectorFor(el) {
          const className = typeof el.className === 'string' ? el.className : '';
          return (
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (className ? `.${className.split(' ')[0]}` : '')
          );
        }

        /** The text a screen reader reads after the name: describedby, then title. */
        function accessibleDescription(el) {
          const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
          const described = ids
            .map((id) => {
              const target = document.getElementById(id);
              return target ? target.textContent : '';
            })
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (described) return described;
          return (el.getAttribute('title') || '').trim();
        }

        const controls = Array.from(document.querySelectorAll('input, select, textarea')).filter(
          (el) => {
            const type = (el.type || '').toLowerCase();
            if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') {
              return false;
            }
            return __isRendered(el);
          }
        );

        for (const control of controls) {
          const name = __accessibleName(control) || '';
          const description = accessibleDescription(control);

          // 3.3.1: the control says it is in error, and nothing says what is
          // wrong. Naming is 4.1.2 and belongs to axe-core; this is only about
          // an announced error state with no text behind it.
          if (control.getAttribute('aria-invalid') === 'true' && !description) {
            issues.push({
              type: 'error-message-not-associated',
              element: selectorFor(control),
              description: 'Field is marked invalid but no error text is associated with it',
              severity: 'error',
              evidence: 'aria-invalid="true" with an empty accessible description',
            });
          }

          // 3.3.2: a control the user has to fill in with no name at all
          // carries neither a label nor an instruction. axe reports the same
          // elements under 4.1.2; 3.3.2 is the criterion that asks for the
          // label itself.
          if (!name) {
            issues.push({
              type: 'field-no-label',
              element: selectorFor(control),
              description: 'Form field has no label or instruction of any kind',
              severity: 'error',
              evidence: `${control.tagName.toLowerCase()} type "${control.type || ''}"`,
            });
          }

          // 3.3.3: the field rejects input that does not match a pattern and
          // never states the pattern, so a correction cannot be suggested.
          if (control.hasAttribute('pattern') && !description) {
            issues.push({
              type: 'pattern-field-no-format-suggestion',
              element: selectorFor(control),
              description: 'Field enforces a pattern but states no expected format',
              severity: 'warning',
              evidence: `pattern="${control.getAttribute('pattern')}"`,
            });
          }
        }

        // 3.3.2: a group of controls answers one question, so the group
        // needs a name of its own. A single control inside a fieldset is a
        // layout wrapper, not a group.
        const reportedGroups = new Set();
        function reportGroup(container, size, evidence) {
          if (!container || reportedGroups.has(container)) return;
          reportedGroups.add(container);
          issues.push({
            type: 'group-no-name',
            element: selectorFor(container),
            description: 'Group of form fields has no legend or other accessible name',
            severity: 'error',
            evidence: `${size} controls grouped, ${evidence}`,
          });
        }

        for (const fieldset of document.querySelectorAll('fieldset')) {
          if (!__isRendered(fieldset)) continue;
          const grouped = fieldset.querySelectorAll('input, select, textarea');
          if (grouped.length < 2 || __accessibleName(fieldset)) continue;
          reportGroup(fieldset, grouped.length, 'no legend');
        }

        // Radios and checkboxes that share a name are one group by definition,
        // whether or not the page wrapped them in anything.
        const byName = new Map();
        for (const control of controls) {
          const type = (control.type || '').toLowerCase();
          if (type !== 'radio' && type !== 'checkbox') continue;
          const key = `${type}:${control.name}`;
          if (!control.name) continue;
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key).push(control);
        }
        for (const [key, group] of byName) {
          if (group.length < 2) continue;
          const container = group[0].closest('fieldset, [role="group"], [role="radiogroup"]');
          if (container && __accessibleName(container)) continue;
          reportGroup(
            container || group[0].form || group[0].parentElement,
            group.length,
            `named "${key}"`
          );
        }

        return issues;
      },
      renderedCode,
      accnameCode
    );
  }

  getSuggestion(violationType) {
    const suggestions = {
      'error-message-not-associated':
        'Point aria-describedby at the text that says what is wrong with the entry',
      'field-no-label': 'Add a label element, aria-label or aria-labelledby to the field',
      'group-no-name': 'Add a legend to the fieldset, or name it with aria-labelledby',
      'pattern-field-no-format-suggestion':
        'Describe the expected format in a title or an aria-describedby target',
    };
    return suggestions[violationType] || 'Provide clear labels, instructions and error text';
  }
}

module.exports = ErrorHandlingScanner;
