/**
 * Label in Name Scanner.
 * WCAG 2.5.3 (EN 301 549 9.2.5.3).
 * Compares the visible label of a rendered control with its accessible name,
 * through the shared 2.5.3 decision in src/utils/accessible-name.js.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: accnameUtils } = require('../utils/accessible-name');
// __visibleLabelText leaves out screen-reader-only text, which it can only
// recognise with the rendered-state helpers injected alongside it.
const { injectableCode: renderedUtils } = require('../utils/rendered');
const injectedUtils = `${renderedUtils}
${accnameUtils}`;

class LabelInNameScanner extends BaseScanner {
  constructor() {
    super('label-in-name', {
      wcagCriteria: ['2.5.3'],
      wcagPrinciple: 'operable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const violations = await page.evaluate((accnameCode) => {
      // Shared ACCNAME implementation and the single 2.5.3 decision
      // (__labelInNameOk), see src/utils/accessible-name.js.
      eval(accnameCode);

      const violations = [];

      function describe(el, index) {
        return {
          element: `${el.tagName.toLowerCase()}[${index}]`,
          details: {
            visibleText: __visibleLabelText(el).full,
            accessibleName: __accessibleName(el),
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: typeof el.className === 'string' ? el.className : null,
            ariaLabel: el.getAttribute('aria-label'),
            ariaLabelledby: el.getAttribute('aria-labelledby'),
          },
        };
      }

      function report(el, index, { type, category, severity, description, recommendation }) {
        const base = describe(el, index);
        violations.push({
          type,
          category,
          severity,
          element: base.element,
          description,
          details: base.details,
          wcagCriteria: '2.5.3',
          impact: `Speech input users cannot address this control by speaking "${base.details.visibleText}"`,
          recommendation,
        });
      }

      // Controls whose label is their own content: buttons, links and the ARIA
      // roles whose name may come FROM CONTENT. listbox, combobox, slider and
      // spinbutton are not among them: their subtree is options or a value,
      // not a label, so a <ul role="listbox" aria-label="Results"> holding
      // "Laptop / Mouse / Keyboard" is not compared against its options.
      const NAMED_BY_CONTENT =
        'button, input[type="button"], input[type="submit"], input[type="reset"], a[href], ' +
        '[role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], ' +
        '[role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], ' +
        '[role="treeitem"], [role="link"]';

      Array.from(document.querySelectorAll(NAMED_BY_CONTENT)).forEach((el, index) => {
        if (!__isRendered(el)) return; // no visible label, nothing to speak
        if (__labelInNameOk(el, __accessibleName(el))) return;
        const isLink = el.tagName === 'A' || el.getAttribute('role') === 'link';
        report(el, index, {
          type: isLink ? 'link-text-not-in-name' : 'label-not-in-name',
          category: isLink ? 'link' : 'button',
          severity: isLink ? 'moderate' : 'serious',
          description: `Visible text of the ${isLink ? 'link' : 'control'} is not contained in its accessible name`,
          recommendation: 'Keep the visible text inside the accessible name.',
        });
      });

      // Form controls take their label from an element outside themselves, so
      // the visible side is that label's rendered text. A `placeholder` is not
      // read as a label: it is a hint that disappears on input, and comparing
      // it to the name reports every field whose aria-label is more explicit
      // than its example value.
      const FORM_CONTROLS =
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]), select, textarea';

      Array.from(document.querySelectorAll(FORM_CONTROLS)).forEach((control, index) => {
        if (!__isRendered(control)) return;
        const labels = Array.from(control.labels || []).filter(__isRendered);
        if (labels.length === 0) return; // no visible label: 2.5.3 does not apply
        const visible = __visibleLabelNormalize(
          labels.map((l) => __visibleLabelText(l).full).join(' ')
        );
        if (!visible) return;
        const name = __visibleLabelNormalize(__accessibleName(control));
        if (!name) return; // unnamed control is 4.1.2, reported by axe-core
        if (__nameContainsLabel(name, visible)) return;
        const base = describe(control, index);
        violations.push({
          type: 'form-label-not-in-name',
          category: 'form-control',
          severity: 'serious',
          element: base.element,
          description: `Visible label "${labels.map((l) => __visibleLabelText(l).full).join(' ')}" is not contained in the accessible name`,
          details: { ...base.details, visibleText: visible },
          wcagCriteria: '2.5.3',
          impact: `Speech input users cannot address this field by speaking "${visible}"`,
          recommendation:
            'Let the <label> name the control, or include its text in the aria-label.',
        });
      });

      return violations;
    }, injectedUtils);

    return {
      scannerId: this.id,
      criteria: ['2.5.3'],
      passed: violations.length === 0,
      violations,
      summary: {
        buttonIssues: violations.filter((v) => v.category === 'button').length,
        formControlIssues: violations.filter((v) => v.category === 'form-control').length,
        linkIssues: violations.filter((v) => v.category === 'link').length,
        violationCount: violations.length,
      },
      recommendations: this.generateLabelInNameRecommendations(violations),
    };
  }

  /**
   * One recommendation per issue type present.
   */
  generateLabelInNameRecommendations(violations) {
    const recommendations = [];
    const issueTypes = new Set(violations.map((v) => v.type));

    if (issueTypes.has('label-not-in-name')) {
      recommendations.push({
        priority: 'critical',
        issue: 'Visible text of a control is not in its accessible name',
        solution: 'Include the visible text in the accessible name',
        implementation:
          'Use an aria-label that contains the visible text, e.g. aria-label="Submit form" for the button text "Submit"',
      });
    }

    if (issueTypes.has('form-label-not-in-name')) {
      recommendations.push({
        priority: 'high',
        issue: 'Visible label of a field is not in its accessible name',
        solution: 'Let the <label> name the field, or repeat its text in the aria-label',
        implementation:
          'Associate the label with <label for="id">, and drop any aria-label that replaces it',
      });
    }

    if (issueTypes.has('link-text-not-in-name')) {
      recommendations.push({
        priority: 'medium',
        issue: 'Visible text of a link is not in its accessible name',
        solution: 'Keep the visible link text inside the accessible name',
        implementation: 'Do not override link text with an aria-label that omits it',
      });
    }

    return recommendations;
  }
}

module.exports = LabelInNameScanner;
