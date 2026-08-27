const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const log = require('../utils/logger').createLogger('error-handling');

/**
 * Error Handling Scanner for WCAG 2.2 compliance testing
 * Implements EN 301 549 criteria 9.3.3.1, 9.3.3.2, 9.3.3.3, 9.3.3.4
 * Tests error identification, labels/instructions, suggestions, and error prevention
 */
class ErrorHandlingScanner extends BaseScanner {
  constructor() {
    super('error-handling', {
      wcagCriteria: ['3.3.1', '3.3.2', '3.3.3', '3.3.4'],
      wcagPrinciple: 'understandable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      testErrorIdentification: true,
      testLabelsInstructions: true,
      testErrorSuggestions: true,
      testErrorPrevention: true,
      simulateErrors: true,
      timeout: 60000,
    };

    const scanOptions = { ...defaultOptions, ...options };

    // Create timestamped scan directory
    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const errorResults = await this.performErrorHandlingAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['9.3.3.1', '9.3.3.2', '9.3.3.3', '9.3.3.4'],
      passed: errorResults.violations.length === 0,
      violations: errorResults.violations,
      summary: {
        errorsIdentified: errorResults.errorsIdentified,
        labelsProvided: errorResults.labelsProvided,
        suggestionsProvided: errorResults.suggestionsProvided,
        preventionImplemented: errorResults.preventionImplemented,
      },
      screenshotPath: scanDir,
      visualEvidence: errorResults.visualEvidence,
    };
  }

  /**
   * Perform comprehensive error handling analysis
   */
  async performErrorHandlingAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let errorsIdentified = true;
    let labelsProvided = true;
    let suggestionsProvided = true;
    let preventionImplemented = true;

    log.debug('Starting error handling analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'error-handling-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Test error identification (WCAG 3.3.1)
    if (options.testErrorIdentification) {
      const errorIdResults = await this.analyzeErrorIdentification(page, violations);
      errorsIdentified = errorIdResults.identified;
    }

    // 2. Test labels and instructions (WCAG 3.3.2)
    if (options.testLabelsInstructions) {
      const labelsResults = await this.analyzeLabelsInstructions(page, violations);
      labelsProvided = labelsResults.provided;
    }

    // 3. Test error suggestions (WCAG 3.3.3)
    if (options.testErrorSuggestions) {
      const suggestionsResults = await this.analyzeErrorSuggestions(page, violations);
      suggestionsProvided = suggestionsResults.provided;
    }

    // 4. Test error prevention (WCAG 3.3.4)
    if (options.testErrorPrevention) {
      const preventionResults = await this.analyzeErrorPrevention(page, violations);
      preventionImplemented = preventionResults.implemented;
    }

    // 5. Simulate form errors if enabled
    if (options.simulateErrors) {
      await this.simulateFormErrors(page, scanDir, violations);
    }

    // Generate visual evidence
    visualEvidence.push({
      type: 'error-handling',
      screenshot: path.basename(initialScreenshot),
      errorsIdentified: errorsIdentified,
      labelsProvided: labelsProvided,
      suggestionsProvided: suggestionsProvided,
      preventionImplemented: preventionImplemented,
    });

    log.debug(`Error handling analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      errorsIdentified,
      labelsProvided,
      suggestionsProvided,
      preventionImplemented,
    };
  }

  /**
   * Analyze error identification (WCAG 3.3.1)
   */
  async analyzeErrorIdentification(page, violations) {
    log.debug('Analyzing error identification...');

    const errorIdAnalysis = await page.evaluate(() => {
      const issues = [];
      let identified = true;

      // Look for existing error states
      const errorElements = document.querySelectorAll(
        '[aria-invalid="true"], .error, [class*="error"], [role="alert"]'
      );

      errorElements.forEach((element) => {
        const elementInfo = {
          selector:
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : '') +
            (element.className ? `.${element.className.split(' ')[0]}` : ''),
        };

        // Check if error is properly identified
        const hasAriaInvalid = element.hasAttribute('aria-invalid');
        const hasErrorClass = element.className.toLowerCase().includes('error');
        const hasAlertRole = element.getAttribute('role') === 'alert';
        const hasErrorText =
          element.textContent.toLowerCase().includes('error') ||
          element.textContent.toLowerCase().includes('invalid') ||
          element.textContent.toLowerCase().includes('required');

        if (!hasAriaInvalid && !hasErrorClass && !hasAlertRole && !hasErrorText) {
          issues.push({
            type: 'error-not-identified',
            element: elementInfo.selector,
            description: 'Error state lacks proper identification method',
            severity: 'error',
          });
          identified = false;
        }

        // Check if error message is associated with the field
        if (element.tagName.toLowerCase() === 'input' && hasAriaInvalid) {
          const hasAriaDescribedBy = element.hasAttribute('aria-describedby');
          const hasErrorLabel =
            element.labels &&
            Array.from(element.labels).some(
              (label) =>
                label.querySelector('.error') || label.textContent.toLowerCase().includes('error')
            );

          if (!hasAriaDescribedBy && !hasErrorLabel) {
            issues.push({
              type: 'error-message-not-associated',
              element: elementInfo.selector,
              description: 'Error message is not properly associated with the form field',
              severity: 'error',
            });
            identified = false;
          }
        }
      });

      // Check for visual-only error indicators (problematic)
      const visualErrorElements = document.querySelectorAll(
        '[style*="red"], [style*="border-color"], [class*="red"]'
      );

      visualErrorElements.forEach((element) => {
        if (
          element.tagName.toLowerCase() === 'input' ||
          element.tagName.toLowerCase() === 'select' ||
          element.tagName.toLowerCase() === 'textarea'
        ) {
          const hasAccessibleError =
            element.hasAttribute('aria-invalid') ||
            element.hasAttribute('aria-describedby') ||
            element.getAttribute('role') === 'alert';

          if (!hasAccessibleError) {
            const elementInfo = {
              selector:
                element.tagName.toLowerCase() +
                (element.id ? `#${element.id}` : '') +
                (element.className ? `.${element.className.split(' ')[0]}` : ''),
            };

            issues.push({
              type: 'visual-only-error',
              element: elementInfo.selector,
              description: 'Error indicated visually only without accessible text',
              severity: 'error',
            });
            identified = false;
          }
        }
      });

      // Check for forms without error handling
      const forms = document.querySelectorAll('form');
      forms.forEach((form) => {
        const requiredFields = form.querySelectorAll(
          'input[required], select[required], textarea[required]'
        );

        if (requiredFields.length > 0) {
          const hasErrorHandling =
            form.querySelector('[aria-invalid], [role="alert"], .error') ||
            Array.from(requiredFields).some(
              (field) =>
                field.hasAttribute('aria-describedby') ||
                field.getAttribute('aria-invalid') === 'true'
            );

          if (!hasErrorHandling) {
            issues.push({
              type: 'form-no-error-handling',
              element: 'form',
              description: 'Form with required fields lacks error identification mechanism',
              severity: 'warning',
            });
          }
        }
      });

      return { issues, identified };
    });

    // Create violations for error identification issues
    errorIdAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.3.3.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getErrorIdentificationSuggestion(issue.type),
      });
    });

    return { identified: errorIdAnalysis.identified };
  }

  /**
   * Analyze labels and instructions (WCAG 3.3.2)
   */
  async analyzeLabelsInstructions(page, violations) {
    log.debug('Analyzing labels and instructions...');

    const labelsAnalysis = await page.evaluate(() => {
      const issues = [];
      let provided = true;

      // Forms that own at least one field whose own label/instruction is
      // missing. Used further down: a form only "lacks instructions" when
      // some field in it actually goes without one - 3.3.2 is a per-input
      // requirement, not a demand for a form-level blurb.
      const formsWithUninstructedFields = new Set();
      function noteUninstructedField(field) {
        const form = field.form || field.closest('form');
        if (form) formsWithUninstructedFields.add(form);
      }

      /**
       * Does this text state that input is required? Covers the near-universal
       * asterisk convention and both English and German wording - these
       * scanners run on German medical-practice sites where "Pflichtfeld" /
       * "erforderlich" is the normal phrasing and "required" never appears.
       */
      function statesRequirement(text) {
        if (!text) return false;
        if (text.includes('*')) return true;
        const t = text.toLowerCase();
        return (
          /\brequired\b|\bmandatory\b/.test(t) ||
          t.includes('pflichtfeld') ||
          t.includes('pflichtangabe') ||
          t.includes('pflichtangaben') ||
          t.includes('erforderlich') ||
          t.includes('notwendig') ||
          t.includes('obligatorisch') ||
          t.includes('muss ausgefüllt') ||
          t.includes('muss angegeben')
        );
      }

      /**
       * Label text that announces an expected input format, in English or German.
       */
      function statesFormatRequirement(text) {
        if (!text) return false;
        const t = text.toLowerCase();
        return (
          t.includes('format') ||
          t.includes('example') ||
          t.includes('beispiel') ||
          t.includes('schreibweise')
        );
      }

      /**
       * Text that spells out a password policy, in English or German. Kept
       * narrow on purpose: generic words like "number" appear in unrelated
       * labels ("Account Number") and must not silence the check.
       */
      function statesPasswordPolicy(text) {
        if (!text) return false;
        const t = text.toLowerCase();
        return (
          t.includes('character') ||
          t.includes('uppercase') ||
          t.includes('lowercase') ||
          t.includes('special char') ||
          t.includes('digit') ||
          t.includes('at least') ||
          t.includes('minimum length') ||
          t.includes('zeichen') ||
          t.includes('großbuchstab') ||
          t.includes('grossbuchstab') ||
          t.includes('kleinbuchstab') ||
          t.includes('sonderzeichen') ||
          t.includes('ziffer') ||
          t.includes('mindestens') ||
          t.includes('mindestlänge')
        );
      }

      function describedByText(field) {
        const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        return ids
          .map((id) => {
            const el = document.getElementById(id);
            return el ? el.textContent : '';
          })
          .join(' ');
      }

      // Check form fields for labels
      const formFields = document.querySelectorAll('input, select, textarea');

      formFields.forEach((field) => {
        const fieldType = field.type || field.tagName.toLowerCase();
        const elementInfo = {
          selector:
            field.tagName.toLowerCase() +
            (field.id ? `#${field.id}` : '') +
            (field.className ? `.${field.className.split(' ')[0]}` : ''),
        };

        // Skip hidden fields and buttons
        if (fieldType === 'hidden' || fieldType === 'submit' || fieldType === 'button') {
          return;
        }

        // Check for label
        const hasLabel = field.labels && field.labels.length > 0;
        const hasAriaLabel = field.hasAttribute('aria-label');
        const hasAriaLabelledBy = field.hasAttribute('aria-labelledby');
        const hasPlaceholder = field.hasAttribute('placeholder');

        // `<input type="image">` takes its accessible name from `alt` and
        // `<input type="reset">` from `value` — those ARE names, so a
        // correctly-named image submit button is not an unlabelled field.
        // (hidden/submit/button are already returned above.)
        const hasNativeAttributeName =
          (fieldType === 'image' && !!(field.getAttribute('alt') || '').trim()) ||
          (fieldType === 'reset' && !!(field.getAttribute('value') || '').trim());

        if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasNativeAttributeName) {
          issues.push({
            type: 'field-no-label',
            element: elementInfo.selector,
            description: 'Form field lacks accessible label',
            severity: 'error',
          });
          noteUninstructedField(field);
          provided = false;
        }

        // Check if placeholder is used as the only label (problematic)
        if (
          hasPlaceholder &&
          !hasLabel &&
          !hasAriaLabel &&
          !hasAriaLabelledBy &&
          !hasNativeAttributeName
        ) {
          issues.push({
            type: 'placeholder-only-label',
            element: elementInfo.selector,
            description: 'Placeholder text used as only label - accessibility issue',
            severity: 'error',
          });
          noteUninstructedField(field);
          provided = false;
        }

        // Check for required field instructions
        if (field.hasAttribute('required')) {
          // Valid mechanisms for telling the user a field is required:
          //  - the field's own label states it (asterisk convention or wording)
          //  - a <label> wrapping the control states it
          //  - the group's <legend> states it (WCAG technique H71): for radio
          //    and checkbox groups the requirement belongs to the GROUP, so
          //    "Bevorzugte Kontaktmethode *" on the legend is the correct and
          //    complete instruction for every option inside the fieldset
          //  - aria-required, or an aria-describedby target that states it
          const ownLabels = field.labels ? Array.from(field.labels) : [];
          const wrappingLabel = field.closest('label');
          const fieldset = field.closest('fieldset');
          const legend = fieldset ? fieldset.querySelector(':scope > legend') : null;

          const hasRequiredInstruction =
            ownLabels.some((label) => statesRequirement(label.textContent)) ||
            (wrappingLabel && statesRequirement(wrappingLabel.textContent)) ||
            (legend && statesRequirement(legend.textContent)) ||
            field.hasAttribute('aria-required') ||
            statesRequirement(describedByText(field)) ||
            field.hasAttribute('aria-describedby');

          if (!hasRequiredInstruction) {
            issues.push({
              type: 'required-field-no-instruction',
              element: elementInfo.selector,
              description: 'Required field lacks clear instruction about requirement',
              severity: 'warning',
            });
            noteUninstructedField(field);
          }
        }

        // Check for format instructions on specific field types
        const needsFormatInstructions = ['email', 'tel', 'url', 'password'];
        if (needsFormatInstructions.includes(fieldType)) {
          const hasFormatInstruction =
            field.hasAttribute('aria-describedby') ||
            field.hasAttribute('pattern') ||
            field.hasAttribute('minlength') ||
            (field.hasAttribute('title') && field.getAttribute('title').trim()) ||
            (field.labels &&
              Array.from(field.labels).some((label) => statesFormatRequirement(label.textContent)));

          if (!hasFormatInstruction && fieldType === 'password') {
            // Password rules are almost never rendered inside the input's
            // immediate parent: they sit in a rules list, live checker or hint
            // block elsewhere in the same form/section. Search that scope, and
            // in German as well as English.
            const scope =
              field.form ||
              field.closest('form, fieldset, section, article, main') ||
              field.parentElement;
            const hasPasswordInstructions = scope && statesPasswordPolicy(scope.textContent);

            if (!hasPasswordInstructions) {
              issues.push({
                type: 'password-no-format-instruction',
                element: elementInfo.selector,
                description: 'Password field lacks format requirements instruction',
                severity: 'warning',
              });
              noteUninstructedField(field);
            }
          }
        }
      });

      // Check for form instructions
      const forms = document.querySelectorAll('form');
      forms.forEach((form) => {
        const instructionElement = form.querySelector(
          '.form-instructions, .help-text, .hint-text, .form-hint, .instructions, .form-help, [class*="hint"], [class*="help"], [class*="hinweis"], [role="note"]'
        );
        const textElement = form.querySelector('p, div');

        // Page-level instructions frequently sit just OUTSIDE the <form>
        // ("All fields marked with * are required." above the form). Look at
        // the form's containing block too, in English and German.
        const surroundings = form.closest('main, section, article, div') || form.parentElement;
        const surroundingText = (
          surroundings ? surroundings.textContent : form.textContent
        ).toLowerCase();
        const explainsRequiredConvention =
          surroundingText.includes('required fields are marked') ||
          (surroundingText.includes('marked with') && surroundingText.includes('required')) ||
          surroundingText.includes('fields marked') ||
          surroundingText.includes('pflichtfeld') ||
          surroundingText.includes('pflichtangabe') ||
          surroundingText.includes('gekennzeichnet') ||
          surroundingText.includes('markierte felder');

        const hasFormInstructions =
          instructionElement ||
          form.hasAttribute('aria-describedby') ||
          (textElement && textElement.textContent.toLowerCase().includes('instruction')) ||
          explainsRequiredConvention;

        const requiredFields = form.querySelectorAll('[required]');
        const complexFields = form.querySelectorAll(
          'input[type="password"], input[type="email"], input[pattern]'
        );

        // Only flag if form is complex AND lacks instructions AND is visible
        const isComplexForm = requiredFields.length > 3 || complexFields.length > 1;
        const isVisible = form.offsetParent !== null;

        // WCAG 3.3.2 is a per-input requirement: a form whose every field
        // already carries its own label and instruction (a legend stating the
        // group is required, an aria-describedby hint, a documented password
        // policy) satisfies it without any form-level preamble. Only complain
        // about missing overall instructions when some field in this form
        // actually went without one.
        const hasUninstructedFields = formsWithUninstructedFields.has(form);

        if (isComplexForm && !hasFormInstructions && isVisible && hasUninstructedFields) {
          issues.push({
            type: 'form-no-instructions',
            element: 'form',
            description:
              'Complex form lacks overall instructions and contains fields without their own labels or instructions',
            severity: 'warning',
          });
        }
      });

      // Check for fieldset legends
      const fieldsets = document.querySelectorAll('fieldset');
      fieldsets.forEach((fieldset) => {
        const hasLegend = fieldset.querySelector('legend');

        if (!hasLegend) {
          issues.push({
            type: 'fieldset-no-legend',
            element: 'fieldset',
            description: 'Fieldset lacks legend to describe grouped fields',
            severity: 'error',
          });
          provided = false;
        }
      });

      return { issues, provided };
    });

    // Create violations for labels and instructions issues
    labelsAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.3.3.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getLabelsInstructionsSuggestion(issue.type),
      });
    });

    return { provided: labelsAnalysis.provided };
  }

  /**
   * Analyze error suggestions (WCAG 3.3.3)
   */
  async analyzeErrorSuggestions(page, violations) {
    log.debug('Analyzing error suggestions...');

    const suggestionsAnalysis = await page.evaluate(() => {
      const issues = [];
      let provided = true;

      // Look for error messages and check if they provide suggestions
      const errorMessages = document.querySelectorAll(
        '[role="alert"], .error-message, [class*="error"]'
      );

      errorMessages.forEach((errorElement) => {
        const errorText = errorElement.textContent.toLowerCase().trim();
        const elementInfo = {
          selector:
            errorElement.tagName.toLowerCase() +
            (errorElement.id ? `#${errorElement.id}` : '') +
            (errorElement.className ? `.${errorElement.className.split(' ')[0]}` : ''),
        };

        // Skip empty or template elements
        if (
          errorText.length < 5 ||
          errorElement.style.display === 'none' ||
          errorElement.classList.contains('hidden') ||
          !errorElement.offsetParent
        ) {
          return;
        }

        // Check if error message provides helpful suggestions
        const hasSuggestion =
          errorText.includes('try') ||
          errorText.includes('should') ||
          errorText.includes('must') ||
          errorText.includes('example') ||
          errorText.includes('format') ||
          errorText.includes('use') ||
          errorText.includes('enter') ||
          errorText.includes('select') ||
          errorText.includes('choose') ||
          errorText.includes('correct') ||
          errorText.includes('fix') ||
          errorText.includes('please');

        // Skip generic messages that don't need suggestions
        const isGenericRequired = errorText.includes('required') && errorText.split(' ').length < 5;
        const isTemplateText =
          errorText.includes('errors populated') ||
          errorText.includes('<!-- ') ||
          (errorText.includes('please correct') && errorText.split(' ').length < 8);

        if (!hasSuggestion && !isGenericRequired && !isTemplateText && errorText.length > 10) {
          issues.push({
            type: 'error-no-suggestion',
            element: elementInfo.selector,
            description: 'Error message lacks helpful suggestion for correction',
            severity: 'warning',
            errorText: errorText.substring(0, 100),
          });
        }
      });

      // Check input fields with specific patterns for format suggestions
      const patternFields = document.querySelectorAll('input[pattern]');
      patternFields.forEach((field) => {
        const elementInfo = {
          selector:
            field.tagName.toLowerCase() +
            (field.id ? `#${field.id}` : '') +
            (field.className ? `.${field.className.split(' ')[0]}` : ''),
        };

        const hasPatternTitle = field.hasAttribute('title');
        const hasAriaDescribedBy = field.hasAttribute('aria-describedby');
        const hasFormatExample =
          field.parentElement.textContent.toLowerCase().includes('example') ||
          field.parentElement.textContent.toLowerCase().includes('format');

        if (!hasPatternTitle && !hasAriaDescribedBy && !hasFormatExample) {
          issues.push({
            type: 'pattern-field-no-format-suggestion',
            element: elementInfo.selector,
            description: 'Field with pattern validation lacks format suggestion',
            severity: 'warning',
          });
        }
      });

      // Check for email fields with format suggestions
      const emailFields = document.querySelectorAll('input[type="email"]');
      emailFields.forEach((field) => {
        const elementInfo = {
          selector:
            field.tagName.toLowerCase() +
            (field.id ? `#${field.id}` : '') +
            (field.className ? `.${field.className.split(' ')[0]}` : ''),
        };

        const hasEmailSuggestion =
          field.hasAttribute('aria-describedby') ||
          field.parentElement.textContent.toLowerCase().includes('example') ||
          field.parentElement.textContent.includes('@');

        if (!hasEmailSuggestion) {
          issues.push({
            type: 'email-field-no-format-suggestion',
            element: elementInfo.selector,
            description: 'Email field lacks format example or suggestion',
            severity: 'warning',
          });
        }
      });

      // Check for date fields with format suggestions
      const dateFields = document.querySelectorAll(
        'input[type="date"], input[type="datetime-local"]'
      );
      dateFields.forEach((field) => {
        const elementInfo = {
          selector:
            field.tagName.toLowerCase() +
            (field.id ? `#${field.id}` : '') +
            (field.className ? `.${field.className.split(' ')[0]}` : ''),
        };

        const hasDateSuggestion =
          field.hasAttribute('aria-describedby') ||
          field.parentElement.textContent.toLowerCase().includes('format') ||
          field.parentElement.textContent.includes('/') ||
          field.parentElement.textContent.includes('-');

        if (!hasDateSuggestion) {
          issues.push({
            type: 'date-field-no-format-suggestion',
            element: elementInfo.selector,
            description: 'Date field lacks format suggestion or example',
            severity: 'warning',
          });
        }
      });

      return { issues, provided };
    });

    // Create violations for error suggestions issues
    suggestionsAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.3.3.3',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getErrorSuggestionsSuggestion(issue.type),
      });
    });

    return { provided: suggestionsAnalysis.provided };
  }

  /**
   * Analyze error prevention (WCAG 3.3.4)
   */
  async analyzeErrorPrevention(page, violations) {
    log.debug('Analyzing error prevention...');

    const preventionAnalysis = await page.evaluate(() => {
      const issues = [];
      let implemented = true;

      // Check for forms with important data that need error prevention.
      // WCAG 3.3.4 scopes this to legal commitments, financial transactions
      // and user-controllable data. The keyword set covers German as well as
      // English - these scanners run on German sites, where an IBAN transfer
      // form contains "Überweisung"/"Betrag" and never the word "payment".
      const IMPORTANT_DATA_TERMS = [
        'payment',
        'purchase',
        'order',
        'invoice',
        'checkout',
        'contract',
        'billing',
        'zahlung',
        'bezahl',
        'überweis',
        'ueberweis',
        'bestellung',
        'bestellen',
        'kauf',
        'rechnung',
        'vertrag',
        'kredit',
        'darlehen',
        'iban',
        'kontonummer',
        'kreditkarte',
        'lastschrift',
        'betrag',
        'honorar',
        'gebühr',
      ];
      // A bare email or password field does NOT put a form in 3.3.4 scope -
      // otherwise every contact form and every login on a German practice site
      // would be asked for a confirmation step. Only fields that carry
      // financial / account-identifying data qualify.
      const IMPORTANT_FIELD_SELECTOR = [
        'input[name*="card"]',
        'input[name*="payment"]',
        'input[name*="iban"]',
        'input[name*="konto"]',
        'input[name*="karte"]',
        'input[name*="betrag"]',
        'input[id*="card"]',
        'input[id*="iban"]',
        'input[id*="karte"]',
        'input[id*="betrag"]',
        'input[autocomplete*="cc-"]',
      ].join(', ');
      const CONFIRM_TERMS = ['confirm', 'verify', 'bestätig', 'bestaetig', 'freigeb'];
      const REVIEW_TERMS = [
        'review',
        'edit',
        'prüfen',
        'pruefen',
        'überprüf',
        'ueberpruef',
        'kontrollier',
        'korrigier',
      ];

      const forms = document.querySelectorAll('form');

      forms.forEach((form) => {
        const formText = form.textContent.toLowerCase();
        const hasImportantData =
          form.querySelector(IMPORTANT_FIELD_SELECTOR) ||
          IMPORTANT_DATA_TERMS.some((term) => formText.includes(term));

        if (hasImportantData) {
          // Check for confirmation mechanisms.
          // NOTE: an `onsubmit` attribute used to count as a confirmation
          // mechanism here, which made this check unreachable for every form
          // that has a submit handler - i.e. essentially every real form. A
          // submit handler is not evidence of a confirmation step.
          const confirmationButtons = Array.from(
            form.querySelectorAll('input[type="submit"], button[type="submit"]')
          );
          const hasConfirmation =
            confirmationButtons.some((btn) => {
              const label = `${btn.value || ''} ${btn.textContent || ''}`.toLowerCase();
              return CONFIRM_TERMS.some((term) => label.includes(term));
            }) ||
            form.querySelector('.confirmation, .review, [class*="confirm"], [class*="bestaetig"]');

          // Check for validation before submission
          const hasValidation =
            form.hasAttribute('novalidate') === false ||
            form.querySelector('[required]') ||
            form.querySelector('[pattern]');

          // Check for review/edit capability
          const hasReviewStep =
            REVIEW_TERMS.some((term) => formText.includes(term)) ||
            form.querySelector('button[type="button"]');

          if (!hasConfirmation && !hasReviewStep) {
            issues.push({
              type: 'important-form-no-confirmation',
              element: 'form',
              description: 'Important form lacks confirmation or review step',
              severity: 'error',
            });
            implemented = false;
          }

          if (!hasValidation) {
            issues.push({
              type: 'important-form-no-validation',
              element: 'form',
              description: 'Important form lacks input validation',
              severity: 'warning',
            });
          }
        }

        // Check for client-side validation
        const hasClientValidation =
          form.querySelector('[required], [pattern], [min], [max]') ||
          form.hasAttribute('onsubmit') ||
          Array.from(form.querySelectorAll('input')).some(
            (input) => input.hasAttribute('oninput') || input.hasAttribute('onchange')
          );

        if (!hasClientValidation) {
          const hasRequiredFields = form.querySelectorAll('[required]').length > 0;
          if (hasRequiredFields) {
            issues.push({
              type: 'form-no-client-validation',
              element: 'form',
              description: 'Form with required fields lacks client-side validation',
              severity: 'warning',
            });
          }
        }
      });

      // Check for password confirmation fields
      const passwordFields = document.querySelectorAll('input[type="password"]');
      passwordFields.forEach((field) => {
        const fieldName = (field.name || field.id || '').toLowerCase();

        if (fieldName.includes('new') || fieldName.includes('create')) {
          // Look for confirmation password field
          const confirmField = document.querySelector(
            'input[type="password"][name*="confirm"], input[type="password"][id*="confirm"]'
          );

          if (!confirmField) {
            const elementInfo = {
              selector:
                field.tagName.toLowerCase() +
                (field.id ? `#${field.id}` : '') +
                (field.className ? `.${field.className.split(' ')[0]}` : ''),
            };

            issues.push({
              type: 'password-no-confirmation',
              element: elementInfo.selector,
              description: 'New password field lacks confirmation field',
              severity: 'warning',
            });
          }
        }
      });

      // Check for irreversible actions
      const submitButtons = document.querySelectorAll(
        'input[type="submit"], button[type="submit"]'
      );
      submitButtons.forEach((button) => {
        const buttonText = button.textContent.toLowerCase() || button.value.toLowerCase();
        const isIrreversible =
          buttonText.includes('delete') ||
          buttonText.includes('remove') ||
          buttonText.includes('cancel') ||
          buttonText.includes('terminate');

        if (isIrreversible) {
          // Look for confirmation dialog or checkbox
          const hasConfirmation =
            button.hasAttribute('onclick') ||
            button.parentElement.querySelector('input[type="checkbox"]') ||
            button.parentElement.textContent.toLowerCase().includes('confirm');

          if (!hasConfirmation) {
            const elementInfo = {
              selector:
                button.tagName.toLowerCase() +
                (button.id ? `#${button.id}` : '') +
                (button.className ? `.${button.className.split(' ')[0]}` : ''),
            };

            issues.push({
              type: 'irreversible-action-no-confirmation',
              element: elementInfo.selector,
              description: 'Irreversible action lacks confirmation mechanism',
              severity: 'error',
            });
            implemented = false;
          }
        }
      });

      return { issues, implemented };
    });

    // Create violations for error prevention issues
    preventionAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.3.3.4',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getErrorPreventionSuggestion(issue.type),
      });
    });

    return { implemented: preventionAnalysis.implemented };
  }

  /**
   * Simulate form errors for testing
   */
  async simulateFormErrors(page, scanDir, violations) {
    log.debug('Simulating form errors for testing...');

    try {
      // Find forms and try to trigger validation errors
      const errorSimulationResults = await page.evaluate(() => {
        const results = [];
        const forms = document.querySelectorAll('form');

        forms.forEach((form) => {
          const requiredFields = form.querySelectorAll('[required]');

          requiredFields.forEach((field) => {
            // Clear the field and trigger validation
            field.value = '';
            field.dispatchEvent(new Event('blur'));
            field.dispatchEvent(new Event('invalid'));

            // Check if error message appears
            const hasErrorAfterTrigger =
              field.hasAttribute('aria-invalid') ||
              field.parentElement.querySelector('[role="alert"], .error');

            results.push({
              fieldId: field.id || 'unnamed',
              errorTriggered: hasErrorAfterTrigger,
              fieldType: field.type || field.tagName.toLowerCase(),
            });
          });
        });

        return results;
      });

      // Take screenshot after error simulation
      const errorScreenshot = path.join(scanDir, 'simulated-errors.png');
      await page.screenshot({ path: errorScreenshot, fullPage: true });

      // Analyze results
      const fieldsWithoutErrors = errorSimulationResults.filter((result) => !result.errorTriggered);

      if (fieldsWithoutErrors.length > 0) {
        violations.push({
          criterion: '9.3.3.1',
          element: 'form fields',
          issue: 'required-fields-no-error-display',
          description: `${fieldsWithoutErrors.length} required fields do not show errors when invalid`,
          severity: 'warning',
          suggestion: 'Implement client-side validation that shows errors for required fields',
        });
      }
    } catch (error) {
      log.debug('Error simulation failed:', error.message);
    }
  }

  /**
   * Get suggestion for error identification violations
   */
  getErrorIdentificationSuggestion(violationType) {
    const suggestions = {
      'error-not-identified':
        'Add aria-invalid="true" and associate error message with aria-describedby',
      'error-message-not-associated': 'Use aria-describedby to link error messages to form fields',
      'visual-only-error': 'Provide accessible error text in addition to visual styling',
      'form-no-error-handling': 'Implement error identification for required form fields',
    };
    return suggestions[violationType] || 'Ensure errors are clearly identified and accessible';
  }

  /**
   * Get suggestion for labels and instructions violations
   */
  getLabelsInstructionsSuggestion(violationType) {
    const suggestions = {
      'field-no-label': 'Add proper label element or aria-label for form field',
      'placeholder-only-label': 'Provide persistent label in addition to placeholder text',
      'required-field-no-instruction':
        'Indicate required fields with asterisk, "required" text, or aria-required',
      'password-no-format-instruction':
        'Provide clear password requirements and format instructions',
      'form-no-instructions': 'Add form instructions explaining completion requirements',
      'fieldset-no-legend': 'Add legend element to describe purpose of grouped form fields',
    };
    return (
      suggestions[violationType] || 'Provide clear labels and instructions for all form elements'
    );
  }

  /**
   * Get suggestion for error suggestions violations
   */
  getErrorSuggestionsSuggestion(violationType) {
    const suggestions = {
      'error-no-suggestion': 'Provide specific suggestions for correcting the error',
      'pattern-field-no-format-suggestion':
        'Add title attribute or aria-describedby with format requirements',
      'email-field-no-format-suggestion': 'Provide email format example (e.g., "user@example.com")',
      'date-field-no-format-suggestion': 'Include date format instruction (e.g., "MM/DD/YYYY")',
    };
    return (
      suggestions[violationType] || 'Provide helpful suggestions when input format is required'
    );
  }

  /**
   * Get suggestion for error prevention violations
   */
  getErrorPreventionSuggestion(violationType) {
    const suggestions = {
      'important-form-no-confirmation':
        'Add confirmation step or review page before final submission',
      'important-form-no-validation': 'Implement client-side and server-side validation',
      'form-no-client-validation': 'Add client-side validation for immediate feedback',
      'password-no-confirmation': 'Add password confirmation field for new passwords',
      'irreversible-action-no-confirmation':
        'Require explicit confirmation for destructive actions',
    };
    return (
      suggestions[violationType] || 'Implement error prevention mechanisms for important actions'
    );
  }
}

module.exports = ErrorHandlingScanner;
