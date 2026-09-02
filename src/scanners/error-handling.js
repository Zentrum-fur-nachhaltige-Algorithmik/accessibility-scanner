/**
 * Error Handling Scanner.
 * WCAG 3.3.1 (EN 301 549 9.3.3.1) for a field the page itself marks as being in
 * error, 3.3.2 (9.3.3.2) for a format a field enforces but never states, and
 * 1.3.1 (9.1.3.1) for a group of controls whose grouping is only visual.
 *
 * Naming a single control is axe-core's (`label`, `select-name`,
 * `aria-input-field-name`), and 3.3.3 Error Suggestion needs an error the scan
 * triggered, which this scanner never does; both are gone.
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
      wcagCriteria: ['1.3.1', '3.3.1', '3.3.2'],
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
      criteria: ['9.1.3.1', '9.3.3.1', '9.3.3.2'],
      passed: errorResults.violations.length === 0,
      violations: errorResults.violations,
      needsReview: errorResults.needsReview,
      summary: {
        errorsObserved: errorResults.errorsObserved,
        groupsNamed: errorResults.groupsNamed,
        formatsStated: errorResults.formatsStated,
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
    const needsReview = [];

    log.debug('Starting error handling analysis...');

    const initialScreenshot = path.join(scanDir, 'error-handling-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    const findings = await this.analyzeForms(page);

    const criterionOf = {
      'error-message-not-associated': '9.3.3.1',
      // A set of controls that answers one question is a relationship the
      // page conveys visually; a missing group name loses it. That is 1.3.1,
      // not a missing label on any one control.
      'group-no-name': '9.1.3.1',
      // An unstated required format is a missing instruction (technique G89),
      // which 3.3.2 asks for. 3.3.3 needs a detected error, which nothing here
      // observes.
      'pattern-field-no-format-suggestion': '9.3.3.2',
    };

    for (const issue of findings) {
      if (issue.type === 'error-visible-only') {
        // The error text stands beside the field, where a sighted user reads
        // it, and nothing associates it programmatically. Whether the two
        // belong together is a reading, not a measurement.
        needsReview.push({
          ...this.formatViolation(
            'error-message-not-associated',
            'moderate',
            issue.description,
            [{ selector: issue.element }],
            'https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html',
            'info',
            {
              verdict: 'needs-review',
              dossier: {
                question:
                  'Is the text beside this field its error message, and is it reachable for a screen reader?',
                element: { selector: issue.element, html: null, role: null, name: null },
                measurements: { ariaInvalid: true, associatedDescription: false },
                context: { visibleText: issue.evidence, fieldName: issue.fieldName },
              },
            }
          ),
          criterion: '9.3.3.1',
          wcagCriteria: ['3.3.1'],
          issue: 'error-message-not-associated',
          element: issue.element,
          evidence: issue.evidence,
        });
        continue;
      }
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
      needsReview,
      visualEvidence: [
        {
          type: 'error-handling',
          screenshot: path.basename(initialScreenshot),
          findings: violations.length,
          questions: needsReview.length,
        },
      ],
      errorsObserved: findings.some(
        (f) => f.type === 'error-message-not-associated' || f.type === 'error-visible-only'
      ),
      groupsNamed: !violations.some((v) => v.issue === 'group-no-name'),
      formatsStated: !violations.some((v) => v.issue === 'pattern-field-no-format-suggestion'),
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

        /**
         * The text a screen reader reads after the name. `aria-errormessage`
         * is the attribute made for exactly this case, so it is read beside
         * `aria-describedby` and `title`.
         */
        function accessibleDescription(el) {
          const ids = [
            ...(el.getAttribute('aria-describedby') || '').split(/\s+/),
            ...(el.getAttribute('aria-errormessage') || '').split(/\s+/),
          ].filter(Boolean);
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

        /**
         * Text a sighted user reads as the error: the next rendered sibling of
         * the field or of its wrapper, or text inside its own label. It is not
         * an association (a screen reader never reaches it from the field),
         * but it is evidence that the page did say what is wrong.
         */
        function visibleErrorText(el) {
          const CONTROLISH =
            'input, select, textarea, button, a[href], label, [role="button"], [role="link"]';
          const scopes = [el, el.parentElement].filter(Boolean);
          for (const scope of scopes) {
            const next = scope.nextElementSibling;
            if (!next || !__isRendered(next)) continue;
            // The caption of the submit button below the field is not an
            // error message, and neither is the next field's label.
            if (next.matches(CONTROLISH) || next.querySelector(CONTROLISH)) continue;
            const text = (next.textContent || '').replace(/\s+/g, ' ').trim();
            if (text && text.length <= 200) return text;
          }
          const label =
            el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
          if (label) {
            const text = (label.textContent || '').replace(/\s+/g, ' ').trim();
            if (/error|fehler|invalid|ung[üu]ltig|required|pflicht/i.test(text)) return text;
          }
          return null;
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

          // 3.3.1: the page itself says this control is in error. Without
          // that declaration no error was observed and the criterion has not
          // been triggered, so the rule stays silent. Naming is 4.1.2 and
          // belongs to axe-core; this is only about an announced error state
          // with no text behind it.
          if (control.getAttribute('aria-invalid') === 'true' && !description) {
            const visible = visibleErrorText(control);
            issues.push({
              type: visible ? 'error-visible-only' : 'error-message-not-associated',
              element: selectorFor(control),
              fieldName: name,
              description: visible
                ? 'Field is marked invalid and the error text beside it is not associated with it'
                : 'Field is marked invalid but no error text is associated with it',
              severity: 'error',
              evidence: visible || 'aria-invalid="true" with an empty accessible description',
            });
          }

          // 3.3.2: the field rejects input that does not match a pattern and
          // never states the pattern, so the user is told the format only by
          // being refused (technique G89 asks for the instruction up front).
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

        // 1.3.1: a set of controls that answers one question is a group. The
        // page shows the grouping visually; if nothing carries the group's
        // name programmatically, that relationship is lost.
        const reportedGroups = new Set();
        function reportGroup(offender, size, evidence) {
          if (!offender || reportedGroups.has(offender)) return;
          reportedGroups.add(offender);
          issues.push({
            type: 'group-no-name',
            element: selectorFor(offender),
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

        /**
         * A heading standing directly above the list of controls names the
         * question the group asks. "Directly above" is the previous element
         * sibling of the first control, of the label around it, or of a
         * wrapper that holds nothing but this group: a page heading further up
         * names the page, not the group.
         */
        const HEADING = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
        function headedByAHeading(group) {
          const own = new Set(group);
          const holdsOtherControls = (node) =>
            Array.from(node.querySelectorAll('input, select, textarea')).some((c) => !own.has(c));
          let scope = group[0].closest('label') || group[0];
          for (let level = 0; level < 4 && scope && scope !== document.body; level++) {
            const prev = scope.previousElementSibling;
            if (prev && prev.matches(HEADING) && (prev.textContent || '').trim()) return true;
            const parent = scope.parentElement;
            if (!parent || parent === document.body || holdsOtherControls(parent)) break;
            scope = parent;
          }
          return false;
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
          if (container) {
            // A real group container: it is the thing that has to carry the
            // name, and it was already read above if it is a fieldset.
            if (!__accessibleName(container))
              reportGroup(container, group.length, `named "${key}"`);
            continue;
          }
          // No group container at all. The offender is the group itself, named
          // by its first control: the <form> around it, or whatever parent
          // happens to hold it, is not the group and must not be reported as
          // one. A heading directly above the controls names the question the
          // group asks, so it is not reported either.
          if (headedByAHeading(group)) continue;
          reportGroup(group[0], group.length, `named "${key}", no group container`);
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
        'Point aria-errormessage or aria-describedby at the text that says what is wrong with the entry',
      'group-no-name':
        'Wrap the controls in a fieldset with a legend, or in a [role=group] named with aria-labelledby',
      'pattern-field-no-format-suggestion':
        'Describe the expected format in a title or an aria-describedby target',
    };
    return suggestions[violationType] || 'Provide clear labels, instructions and error text';
  }
}

module.exports = ErrorHandlingScanner;
