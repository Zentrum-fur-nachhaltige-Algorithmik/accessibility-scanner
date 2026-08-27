const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: accnameUtils } = require('../utils/accessible-name');

/**
 * Label in Name Scanner for WCAG 2.5.3 compliance testing
 * Ensures visible text is contained in accessible name for voice control compatibility
 * Critical for Dragon NaturallySpeaking, Voice Control, and other speech recognition software
 */
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
    const defaultOptions = {
      checkButtons: true,
      checkFormControls: true,
      checkLinks: true,
      checkImageButtons: true,
      checkCustomControls: true,
      caseSensitive: false,
      ignoreWhitespace: true,
      timeout: TIMEOUTS.scanner,
    };

    const scanOptions = { ...defaultOptions, ...options };

    const violations = [];

    // Analyze different types of elements
    if (scanOptions.checkButtons) {
      const buttonViolations = await this.analyzeButtons(page, scanOptions);
      violations.push(...buttonViolations);
    }

    if (scanOptions.checkFormControls) {
      const formViolations = await this.analyzeFormControls(page, scanOptions);
      violations.push(...formViolations);
    }

    if (scanOptions.checkLinks) {
      const linkViolations = await this.analyzeLinks(page, scanOptions);
      violations.push(...linkViolations);
    }

    if (scanOptions.checkImageButtons) {
      const imageViolations = await this.analyzeImageButtons(page, scanOptions);
      violations.push(...imageViolations);
    }

    if (scanOptions.checkCustomControls) {
      const customViolations = await this.analyzeCustomControls(page, scanOptions);
      violations.push(...customViolations);
    }

    return {
      scannerId: this.id,
      criteria: ['2.5.3'],
      passed: violations.length === 0,
      violations: violations,
      summary: {
        totalElementsChecked: violations.length + this.getPassedElementsCount(violations),
        buttonIssues: violations.filter((v) => v.category === 'button').length,
        formControlIssues: violations.filter((v) => v.category === 'form-control').length,
        linkIssues: violations.filter((v) => v.category === 'link').length,
        imageButtonIssues: violations.filter((v) => v.category === 'image-button').length,
        customControlIssues: violations.filter((v) => v.category === 'custom-control').length,
        voiceControlFailures: violations.length,
      },
      recommendations: this.generateLabelInNameRecommendations(violations),
      voiceControlTesting: this.generateVoiceControlTestCases(violations),
    };
  }

  /**
   * Analyze buttons for label in name compliance
   */
  async analyzeButtons(page, options) {
    return await page.evaluate(
      (scanOptions, accnameCode) => {
        // Shared ACCNAME implementation — see src/utils/accessible-name.js.
        eval(accnameCode);

        const violations = [];

        // Helper function to normalize text for comparison
        function normalizeText(text) {
          if (!text) return '';
          let normalized = text.trim();
          if (scanOptions.ignoreWhitespace) {
            normalized = normalized.replace(/\s+/g, ' ');
          }
          if (!scanOptions.caseSensitive) {
            normalized = normalized.toLowerCase();
          }
          return normalized;
        }

        // Accessible name, per ACCNAME.
        //
        // The previous local implementation returned `element.textContent`
        // for BUTTON/A, so an icon button whose only child is
        // `<img alt="Menu">` computed an EMPTY accessible name while
        // getVisibleText() below deliberately DOES fold in that same alt
        // text — the two disagreed and every icon button was reported as a
        // 2.5.3 "visible text not in accessible name" failure.
        function getAccessibleName(element) {
          return __accessibleName(element);
        }

        // Helper function to get visible text
        function getVisibleText(element) {
          // Clone element to manipulate
          const clone = element.cloneNode(true);

          // Remove screen-reader only text
          const srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]');
          srOnly.forEach((el) => el.remove());

          // Remove icon fonts and decorative elements
          const icons = clone.querySelectorAll('[class*="icon"], [class*="fa-"], .material-icons');
          icons.forEach((el) => {
            // Only remove if it's purely decorative (no meaningful text)
            if (el.textContent.trim().length <= 2) {
              el.remove();
            }
          });

          // Get the remaining text content
          let text = clone.textContent || '';

          // For images within buttons, include alt text
          const images = element.querySelectorAll('img');
          images.forEach((img) => {
            const alt = img.getAttribute('alt');
            if (alt) {
              text += ' ' + alt;
            }
          });

          return text;
        }

        // Check regular buttons
        const buttons = document.querySelectorAll(
          'button, input[type="button"], input[type="submit"], input[type="reset"]'
        );
        for (let i = 0; i < buttons.length; i++) {
          const button = buttons[i];
          const visibleText = normalizeText(getVisibleText(button));
          const accessibleName = normalizeText(getAccessibleName(button));

          // Skip buttons without visible text
          if (visibleText.length === 0) continue;

          // The 2.5.3 decision lives in __labelInNameOk()
          // (src/utils/accessible-name.js) so that every scanner testing
          // this criterion agrees. It normalises BOTH sides the same way
          // (case, punctuation, whitespace — the visible side comes from
          // text nodes, the name side from ACCNAME, and the two insert
          // separators at different places), accepts the visible words as
          // an ordered subsequence of the name, and compares against both
          // the full visible text and the reduced LABEL (monograms and
          // sub-headline taglines dropped). See that file for why.
          if (!__labelInNameOk(button, getAccessibleName(button))) {
            violations.push({
              type: 'label-not-in-name',
              category: 'button',
              severity: 'serious',
              element: `button[${i}]`,
              description: 'Button visible text is not contained in accessible name',
              details: {
                visibleText: getVisibleText(button),
                accessibleName: getAccessibleName(button),
                visibleTextNormalized: visibleText,
                accessibleNameNormalized: accessibleName,
                tagName: button.tagName.toLowerCase(),
                type: button.type || null,
                id: button.id || null,
                className: button.className || null,
                ariaLabel: button.getAttribute('aria-label'),
                ariaLabelledby: button.getAttribute('aria-labelledby'),
              },
              wcagCriteria: '2.5.3',
              impact:
                'Voice control users cannot activate this button by speaking its visible text',
              voiceControlCommand: `"Click ${getVisibleText(button)}" will fail`,
              recommendation: 'Ensure accessible name contains the visible text',
            });
          }
        }

        return violations;
      },
      options,
      accnameUtils
    );
  }

  /**
   * Analyze form controls for label in name compliance
   */
  async analyzeFormControls(page, options) {
    return await page.evaluate(
      (scanOptions, accnameCode) => {
        // Shared ACCNAME + 2.5.3 helpers — see src/utils/accessible-name.js.
        eval(accnameCode);

        const violations = [];

        function normalizeText(text) {
          if (!text) return '';
          let normalized = text.trim();
          if (scanOptions.ignoreWhitespace) {
            normalized = normalized.replace(/\s+/g, ' ');
          }
          if (!scanOptions.caseSensitive) {
            normalized = normalized.toLowerCase();
          }
          return normalized;
        }

        // NOT migrated to the shared __accessibleName() helper, on purpose.
        //
        // This variant is paired with getVisibleLabelText() below, and SC
        // 2.5.3 here compares the control's VISIBLE label against its
        // accessible name — both sides must read the label the same way.
        // The shared helper resolves aria-labelledby BEFORE aria-label
        // (which is correct per ACCNAME) and folds a label's child
        // `<img alt>` into the name; swapping only this side in would
        // change which pairs compare equal, and the 2.5.3 fixtures are not
        // covered by the deterministic exclusive harness, so the change
        // could not be verified loss-free here. It produces no member of
        // the child-img-alt false-positive family: its selector excludes
        // button/submit/reset/hidden inputs, and when the visible label is
        // empty the control is skipped outright.
        function getAccessibleName(element) {
          if (element.getAttribute('aria-label')) {
            return element.getAttribute('aria-label');
          }

          const labelledBy = element.getAttribute('aria-labelledby');
          if (labelledBy) {
            const referencedElements = labelledBy
              .split(' ')
              .map((id) => document.getElementById(id))
              .filter((el) => el);
            if (referencedElements.length > 0) {
              return referencedElements.map((el) => el.textContent).join(' ');
            }
          }

          const labels = element.labels;
          if (labels && labels.length > 0) {
            return Array.from(labels)
              .map((label) => label.textContent)
              .join(' ');
          }

          if (element.getAttribute('title')) {
            return element.getAttribute('title');
          }

          return '';
        }

        function getVisibleLabelText(element) {
          // Look for associated label elements
          const labels = element.labels;
          if (labels && labels.length > 0) {
            return Array.from(labels)
              .map((label) => label.textContent.trim())
              .join(' ');
          }

          // Look for aria-labelledby references
          const labelledBy = element.getAttribute('aria-labelledby');
          if (labelledBy) {
            const referencedElements = labelledBy
              .split(' ')
              .map((id) => document.getElementById(id))
              .filter((el) => el);
            if (referencedElements.length > 0) {
              return referencedElements.map((el) => el.textContent.trim()).join(' ');
            }
          }

          // Look for placeholder text as visible text
          const placeholder = element.getAttribute('placeholder');
          if (placeholder) {
            return placeholder;
          }

          // For select elements, check if there's visible text nearby
          if (element.tagName === 'SELECT') {
            const parent = element.parentElement;
            if (parent) {
              const textNodes = [];
              for (let child of parent.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                  const text = child.textContent.trim();
                  if (text) textNodes.push(text);
                }
              }
              if (textNodes.length > 0) {
                return textNodes.join(' ');
              }
            }
          }

          return '';
        }

        // Check form controls
        const formControls = document.querySelectorAll(
          'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]), select, textarea'
        );
        for (let i = 0; i < formControls.length; i++) {
          const control = formControls[i];
          const visibleText = normalizeText(getVisibleLabelText(control));
          const accessibleName = normalizeText(getAccessibleName(control));

          // Skip controls without visible label text
          if (visibleText.length === 0) continue;

          // Both sides go through the SAME normalisation
          // (__visibleLabelNormalize: case, punctuation, whitespace) and
          // the same ordered-subsequence test as every other 2.5.3 check
          // in the codebase. Without the punctuation step a perfectly
          // conformant field — visible label "E-Mail:", accessible name
          // "E-Mail-Adresse für Kontakt" — failed on the trailing colon
          // and the hyphen alone.
          if (
            !__nameContainsLabel(
              __visibleLabelNormalize(getAccessibleName(control)),
              __visibleLabelNormalize(getVisibleLabelText(control))
            )
          ) {
            violations.push({
              type: 'form-label-not-in-name',
              category: 'form-control',
              severity: 'serious',
              element: `${control.tagName.toLowerCase()}[${i}]`,
              description: 'Form control visible label is not contained in accessible name',
              details: {
                visibleText: getVisibleLabelText(control),
                accessibleName: getAccessibleName(control),
                visibleTextNormalized: visibleText,
                accessibleNameNormalized: accessibleName,
                tagName: control.tagName.toLowerCase(),
                type: control.type || null,
                id: control.id || null,
                name: control.name || null,
                placeholder: control.getAttribute('placeholder'),
                ariaLabel: control.getAttribute('aria-label'),
                ariaLabelledby: control.getAttribute('aria-labelledby'),
                hasLabels: control.labels && control.labels.length > 0,
              },
              wcagCriteria: '2.5.3',
              impact:
                'Voice control users cannot target this form field by speaking its visible label',
              voiceControlCommand: `"Click ${getVisibleLabelText(control)}" will fail`,
              recommendation: 'Ensure accessible name contains the visible label text',
            });
          }
        }

        return violations;
      },
      options,
      accnameUtils
    );
  }

  /**
   * Analyze links for label in name compliance
   */
  async analyzeLinks(page, options) {
    return await page.evaluate(
      (scanOptions, accnameCode) => {
        // Shared ACCNAME implementation — see src/utils/accessible-name.js.
        eval(accnameCode);

        const violations = [];

        function normalizeText(text) {
          if (!text) return '';
          let normalized = text.trim();
          if (scanOptions.ignoreWhitespace) {
            normalized = normalized.replace(/\s+/g, ' ');
          }
          if (!scanOptions.caseSensitive) {
            normalized = normalized.toLowerCase();
          }
          return normalized;
        }

        // Accessible name, per ACCNAME. The previous local implementation
        // fell back to `element.textContent`, which is empty for a logo
        // link `<a><img alt="Logo"></a>` — while getVisibleText() below
        // folds that alt in, so the two disagreed and every image link was
        // reported as a 2.5.3 failure. It also read `title` BEFORE the
        // subtree and resolved aria-labelledby as a single id.
        function getAccessibleName(element) {
          return __accessibleName(element);
        }

        function getVisibleText(element) {
          const clone = element.cloneNode(true);

          // Remove screen-reader only text
          const srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]');
          srOnly.forEach((el) => el.remove());

          // Remove decorative icons but keep meaningful text
          const icons = clone.querySelectorAll('[class*="icon"], [class*="fa-"], .material-icons');
          icons.forEach((el) => {
            if (el.textContent.trim().length <= 2) {
              el.remove();
            }
          });

          let text = clone.textContent || '';

          // Include alt text from images
          const images = element.querySelectorAll('img');
          images.forEach((img) => {
            const alt = img.getAttribute('alt');
            if (alt) {
              text += ' ' + alt;
            }
          });

          return text;
        }

        // Check links
        const links = document.querySelectorAll('a[href]');
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          const visibleText = normalizeText(getVisibleText(link));
          const accessibleName = normalizeText(getAccessibleName(link));

          // Skip links without visible text
          if (visibleText.length === 0) continue;

          // Skip links that are just URLs or very generic
          if (
            visibleText === 'here' ||
            visibleText === 'click here' ||
            visibleText === 'more' ||
            visibleText === 'read more' ||
            visibleText.startsWith('http')
          ) {
            continue;
          }

          // The 2.5.3 decision lives in __labelInNameOk()
          // (src/utils/accessible-name.js) so that every scanner testing
          // this criterion agrees. It normalises BOTH sides the same way
          // (case, punctuation, whitespace — the visible side comes from
          // text nodes, the name side from ACCNAME, and the two insert
          // separators at different places), accepts the visible words as
          // an ordered subsequence of the name, and compares against both
          // the full visible text and the reduced LABEL (monograms and
          // sub-headline taglines dropped). See that file for why.
          if (!__labelInNameOk(link, getAccessibleName(link))) {
            violations.push({
              type: 'link-text-not-in-name',
              category: 'link',
              severity: 'moderate',
              element: `a[${i}]`,
              description: 'Link visible text is not contained in accessible name',
              details: {
                visibleText: getVisibleText(link),
                accessibleName: getAccessibleName(link),
                visibleTextNormalized: visibleText,
                accessibleNameNormalized: accessibleName,
                href: link.href,
                id: link.id || null,
                className: link.className || null,
                ariaLabel: link.getAttribute('aria-label'),
                ariaLabelledby: link.getAttribute('aria-labelledby'),
                title: link.getAttribute('title'),
              },
              wcagCriteria: '2.5.3',
              impact: 'Voice control users cannot activate this link by speaking its visible text',
              voiceControlCommand: `"Click ${getVisibleText(link)}" will fail`,
              recommendation: 'Ensure accessible name contains the visible link text',
            });
          }
        }

        return violations;
      },
      options,
      accnameUtils
    );
  }

  /**
   * Analyze image buttons for label in name compliance
   */
  async analyzeImageButtons(page, options) {
    return await page.evaluate(
      (scanOptions, accnameCode) => {
        // Shared ACCNAME implementation — see src/utils/accessible-name.js.
        eval(accnameCode);

        const violations = [];

        function normalizeText(text) {
          if (!text) return '';
          let normalized = text.trim();
          if (scanOptions.ignoreWhitespace) {
            normalized = normalized.replace(/\s+/g, ' ');
          }
          if (!scanOptions.caseSensitive) {
            normalized = normalized.toLowerCase();
          }
          return normalized;
        }

        // Check input type="image"
        const imageInputs = document.querySelectorAll('input[type="image"]');
        for (let i = 0; i < imageInputs.length; i++) {
          const input = imageInputs[i];
          const alt = input.getAttribute('alt') || '';
          const ariaLabel = input.getAttribute('aria-label') || '';
          const title = input.getAttribute('title') || '';

          const accessibleName = ariaLabel || alt || title;

          if (
            alt &&
            accessibleName &&
            !normalizeText(accessibleName).includes(normalizeText(alt))
          ) {
            violations.push({
              type: 'image-button-alt-not-in-name',
              category: 'image-button',
              severity: 'serious',
              element: `input[type="image"][${i}]`,
              description: 'Image button alt text is not contained in accessible name',
              details: {
                altText: alt,
                accessibleName: accessibleName,
                ariaLabel: ariaLabel,
                title: title,
                id: input.id || null,
                src: input.src,
              },
              wcagCriteria: '2.5.3',
              impact:
                'Voice control users cannot activate this image button by speaking its alt text',
              voiceControlCommand: `"Click ${alt}" will fail`,
              recommendation: 'Ensure accessible name contains the alt text',
            });
          }
        }

        // Check buttons containing images
        const buttonsWithImages = document.querySelectorAll('button img, a img');
        for (let i = 0; i < buttonsWithImages.length; i++) {
          const img = buttonsWithImages[i];
          const button = img.closest('button') || img.closest('a');
          if (!button) continue;

          const imgAlt = img.getAttribute('alt') || '';
          const buttonText = button.textContent || '';

          // The accessible name of `<a><img alt="Logo">Home</a>` is
          // "Logo Home", not "Home": name-from-content folds in the
          // child image's alt. Computing it as `textContent` reported
          // every such link as "alt text not in accessible name".
          const accessibleName = __accessibleName(button);

          if (
            imgAlt &&
            accessibleName &&
            !normalizeText(accessibleName).includes(normalizeText(imgAlt))
          ) {
            violations.push({
              type: 'button-image-alt-not-in-name',
              category: 'image-button',
              severity: 'moderate',
              element: `${button.tagName.toLowerCase()} img[${i}]`,
              description: 'Button containing image - alt text not in accessible name',
              details: {
                imageAlt: imgAlt,
                buttonText: buttonText,
                buttonAccessibleName: accessibleName,
                buttonTagName: button.tagName.toLowerCase(),
                buttonId: button.id || null,
                imgSrc: img.src,
              },
              wcagCriteria: '2.5.3',
              impact:
                'Voice control users may not be able to activate button using image description',
              voiceControlCommand: `"Click ${imgAlt}" may fail`,
              recommendation: "Include image alt text in button's accessible name",
            });
          }
        }

        return violations;
      },
      options,
      accnameUtils
    );
  }

  /**
   * Analyze custom controls for label in name compliance
   */
  async analyzeCustomControls(page, options) {
    return await page.evaluate(
      (scanOptions, accnameCode) => {
        // Shared ACCNAME implementation — see src/utils/accessible-name.js.
        eval(accnameCode);

        const violations = [];

        function normalizeText(text) {
          if (!text) return '';
          let normalized = text.trim();
          if (scanOptions.ignoreWhitespace) {
            normalized = normalized.replace(/\s+/g, ' ');
          }
          if (!scanOptions.caseSensitive) {
            normalized = normalized.toLowerCase();
          }
          return normalized;
        }

        // Accessible name, per ACCNAME — the local version read `title`
        // before the subtree and ignored a descendant's own name
        // (`<img alt>`, `<svg><title>`, nested aria-label).
        function getAccessibleName(element) {
          return __accessibleName(element);
        }

        function getVisibleText(element) {
          const clone = element.cloneNode(true);
          const srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]');
          srOnly.forEach((el) => el.remove());
          return clone.textContent || '';
        }

        // Only roles whose accessible name may come FROM CONTENT can fail
        // 2.5.3 this way: for those, the subtree text IS the visible label.
        //
        // listbox/combobox/slider/spinbutton are deliberately NOT in this
        // list. Their subtree is options or a value, not a label — a
        // `<ul role="listbox" aria-label="Suchergebnisse">` holding
        // "Laptop / Maus / Tastatur" was reported as a 2.5.3 failure
        // because the option texts were treated as its visible label. ARIA
        // gives those roles "namefrom: author" precisely because content
        // and label are different things there.
        const customControls = document.querySelectorAll(
          '[role="button"], [role="checkbox"], [role="radio"], [role="switch"], ' +
            '[role="option"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], ' +
            '[role="menuitemradio"], [role="treeitem"], [role="link"]'
        );

        for (let i = 0; i < customControls.length; i++) {
          const control = customControls[i];
          const visibleText = normalizeText(getVisibleText(control));
          const accessibleName = normalizeText(getAccessibleName(control));
          const role = control.getAttribute('role');

          // Skip controls without visible text
          if (visibleText.length === 0) continue;

          // The 2.5.3 decision lives in __labelInNameOk()
          // (src/utils/accessible-name.js) so that every scanner testing
          // this criterion agrees — see that file for the normalisation
          // and for why a monogram/tagline is not part of the label.
          if (!__labelInNameOk(control, getAccessibleName(control))) {
            violations.push({
              type: 'custom-control-label-not-in-name',
              category: 'custom-control',
              severity: 'serious',
              element: `[role="${role}"][${i}]`,
              description: 'Custom control visible text is not contained in accessible name',
              details: {
                visibleText: getVisibleText(control),
                accessibleName: getAccessibleName(control),
                visibleTextNormalized: visibleText,
                accessibleNameNormalized: accessibleName,
                role: role,
                tagName: control.tagName.toLowerCase(),
                id: control.id || null,
                className: control.className || null,
                ariaLabel: control.getAttribute('aria-label'),
                ariaLabelledby: control.getAttribute('aria-labelledby'),
              },
              wcagCriteria: '2.5.3',
              impact:
                'Voice control users cannot activate this custom control by speaking its visible text',
              voiceControlCommand: `"Click ${getVisibleText(control)}" will fail`,
              recommendation: 'Ensure accessible name contains the visible text',
            });
          }
        }

        return violations;
      },
      options,
      accnameUtils
    );
  }

  /**
   * Get count of passed elements (estimated)
   */
  getPassedElementsCount(violations) {
    return Math.max(30 - violations.length, 0);
  }

  /**
   * Generate recommendations for label in name issues
   */
  generateLabelInNameRecommendations(violations) {
    const recommendations = [];
    const issueTypes = [...new Set(violations.map((v) => v.type))];

    if (issueTypes.includes('label-not-in-name')) {
      recommendations.push({
        priority: 'critical',
        issue: 'Button visible text not in accessible name',
        solution: 'Update aria-label or accessible name to include visible button text',
        implementation:
          'Use aria-label that starts with or contains the visible text, e.g., aria-label="Submit form" for button text "Submit"',
      });
    }

    if (issueTypes.includes('form-label-not-in-name')) {
      recommendations.push({
        priority: 'high',
        issue: 'Form control label not in accessible name',
        solution: 'Ensure form labels match or are contained in accessible names',
        implementation:
          'Associate labels properly using <label for="id"> or aria-labelledby, ensure aria-label includes label text',
      });
    }

    if (issueTypes.includes('link-text-not-in-name')) {
      recommendations.push({
        priority: 'medium',
        issue: 'Link text not in accessible name',
        solution: 'Make sure link accessible names include visible link text',
        implementation:
          "Avoid overriding link text with aria-label that doesn't include visible text",
      });
    }

    if (issueTypes.includes('image-button-alt-not-in-name')) {
      recommendations.push({
        priority: 'high',
        issue: 'Image button alt text not in accessible name',
        solution: 'Ensure image button accessible names include alt text',
        implementation: 'Use alt text that matches or is included in aria-label values',
      });
    }

    if (issueTypes.includes('custom-control-label-not-in-name')) {
      recommendations.push({
        priority: 'high',
        issue: 'Custom control visible text not in accessible name',
        solution: 'Update ARIA labels to include visible text content',
        implementation:
          'Set aria-label to include the visible text, e.g., aria-label="Show details" for text "Show"',
      });
    }

    return recommendations;
  }

  /**
   * Generate voice control test cases
   */
  generateVoiceControlTestCases(violations) {
    const testCases = [];

    violations.forEach((violation, index) => {
      const visibleText = violation.details?.visibleText || '';
      if (visibleText) {
        testCases.push({
          testId: `voice-test-${index + 1}`,
          element: violation.element,
          visibleText: visibleText,
          expectedCommand: `"Click ${visibleText}"`,
          currentBehavior: 'Command will fail - element not activated',
          expectedBehavior: 'Element should be activated by voice command',
          voiceControlSoftware: [
            'Dragon NaturallySpeaking',
            'Windows Voice Control',
            'macOS Voice Control',
          ],
          priority: violation.severity,
          fixRequired: `Update accessible name to include "${visibleText}"`,
        });
      }
    });

    return testCases;
  }
}

module.exports = LabelInNameScanner;
