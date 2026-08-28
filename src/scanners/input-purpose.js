/**
 * Input Purpose Scanner.
 * WCAG 1.3.5 (EN 301 549 9.1.3.5).
 * Checks form inputs for valid autocomplete tokens matching the purpose
 * detected from their name, id, type and label text.
 */
const BaseScanner = require('../core/base-scanner');

class InputPurposeScanner extends BaseScanner {
  constructor() {
    super('input-purpose', {
      wcagCriteria: ['1.3.5'],
      wcagPrinciple: 'perceivable',
    });
  }

  get needsExclusiveAccess() {
    return false;
  }

  async scan(page, options = {}) {
    const purposeResults = await page.evaluate(() => {
      // Full HTML spec autocomplete values
      const VALID_AUTOCOMPLETE_VALUES = new Set([
        'name',
        'honorific-prefix',
        'given-name',
        'additional-name',
        'family-name',
        'honorific-suffix',
        'nickname',
        'email',
        'username',
        'new-password',
        'current-password',
        'one-time-code',
        'organization-title',
        'organization',
        'street-address',
        'address-line1',
        'address-line2',
        'address-line3',
        'address-level4',
        'address-level3',
        'address-level2',
        'address-level1',
        'country',
        'country-name',
        'postal-code',
        'cc-name',
        'cc-given-name',
        'cc-additional-name',
        'cc-family-name',
        'cc-number',
        'cc-exp',
        'cc-exp-month',
        'cc-exp-year',
        'cc-csc',
        'cc-type',
        'transaction-currency',
        'transaction-amount',
        'language',
        'bday',
        'bday-day',
        'bday-month',
        'bday-year',
        'sex',
        'tel',
        'tel-country-code',
        'tel-national',
        'tel-area-code',
        'tel-local',
        'tel-extension',
        'impp',
        'url',
        'photo',
        'webauthn',
        // Section/billing/shipping prefixes are allowed before any of these
        'on',
        'off', // also valid but "off" on purpose fields is a violation
      ]);

      // Tokens that can appear as section prefixes (section-*)
      const SECTION_PREFIX_RE = /^section-\S+$/;

      // Map: pattern on name/id/type/label → expected autocomplete value(s)
      const INPUT_PURPOSE_MAP = [
        { pattern: /type=email/, expected: ['email'] },
        { pattern: /type=tel/, expected: ['tel'] },
        { pattern: /type=password/, expected: ['current-password', 'new-password'] },
        { pattern: /\b(email|e-mail)\b/i, expected: ['email'] },
        { pattern: /\b(phone|tel|telephone|mobile)\b/i, expected: ['tel', 'tel-national'] },
        { pattern: /\b(fname|first[_-]?name|given[_-]?name)\b/i, expected: ['given-name'] },
        {
          pattern: /\b(lname|last[_-]?name|family[_-]?name|surname)\b/i,
          expected: ['family-name'],
        },
        { pattern: /\b(fullname|full[_-]?name)\b/i, expected: ['name'] },
        { pattern: /\b(username|user[_-]?name|login)\b/i, expected: ['username'] },
        {
          pattern: /\b(street|address[_-]?1|address[_-]?line[_-]?1)\b/i,
          expected: ['street-address', 'address-line1'],
        },
        {
          pattern: /\b(address[_-]?2|address[_-]?line[_-]?2|apt|suite)\b/i,
          expected: ['address-line2'],
        },
        { pattern: /\b(zip|postal[_-]?code|postcode|plz)\b/i, expected: ['postal-code'] },
        { pattern: /\b(city|town|ort)\b/i, expected: ['address-level2'] },
        { pattern: /\b(state|province|region|bundesland)\b/i, expected: ['address-level1'] },
        { pattern: /\b(country|land)\b/i, expected: ['country', 'country-name'] },
        { pattern: /\b(card[_-]?number|cc[_-]?num|credit[_-]?card)\b/i, expected: ['cc-number'] },
        { pattern: /\b(card[_-]?name|cardholder)\b/i, expected: ['cc-name'] },
        { pattern: /\b(cvv|cvc|csc|security[_-]?code)\b/i, expected: ['cc-csc'] },
        { pattern: /\b(expir|cc[_-]?exp)\b/i, expected: ['cc-exp', 'cc-exp-month', 'cc-exp-year'] },
        {
          pattern: /\b(bday|birth|dob|date[_-]?of[_-]?birth|birthday|geburt)\b/i,
          expected: ['bday', 'bday-day', 'bday-month', 'bday-year'],
        },
        { pattern: /\b(url|website|homepage)\b/i, expected: ['url'] },
        { pattern: /\b(photo|avatar|picture|bild)\b/i, expected: ['photo'] },
        {
          pattern: /\b(otp|one[_-]?time|verification[_-]?code|2fa|totp)\b/i,
          expected: ['one-time-code'],
        },
        { pattern: /\b(org|organization|company|firma)\b/i, expected: ['organization'] },
        { pattern: /\b(title|job[_-]?title|position)\b/i, expected: ['organization-title'] },
        { pattern: /\b(gender|sex|geschlecht)\b/i, expected: ['sex'] },
        { pattern: /\b(nickname|nick|spitzname)\b/i, expected: ['nickname'] },
        { pattern: /\b(language|sprache)\b/i, expected: ['language'] },
      ];

      function getSelector(el) {
        let sel = el.tagName.toLowerCase();
        if (el.id) sel += `#${el.id}`;
        else if (el.name) sel += `[name="${el.name}"]`;
        else if (el.className && typeof el.className === 'string')
          sel += `.${el.className.split(' ')[0]}`;
        return sel;
      }

      function getLabelText(el) {
        // Check associated <label>
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label) return label.textContent.trim();
        }
        // Check wrapping <label>
        const parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();
        // Check aria-label
        return el.getAttribute('aria-label') || '';
      }

      function parseAutocompleteTokens(raw) {
        if (!raw) return null;
        const tokens = raw.trim().toLowerCase().split(/\s+/);
        // Strip section- prefix and shipping/billing prefix
        const filtered = tokens.filter(
          (t) => !SECTION_PREFIX_RE.test(t) && t !== 'shipping' && t !== 'billing'
        );
        return filtered;
      }

      function isValidAutocompleteValue(token) {
        if (VALID_AUTOCOMPLETE_VALUES.has(token)) return true;
        if (SECTION_PREFIX_RE.test(token)) return true;
        if (token === 'shipping' || token === 'billing') return true;
        return false;
      }

      // Purposes that only a form collecting the user's own data asks for.
      // Two of them in one form is the evidence that SC 1.3.5 applies at all:
      // the criterion covers "input fields that collect information about the
      // user", not every field whose name happens to read like a token.
      // City, region and country are deliberately absent: they are the fields
      // of every hotel, shop and job filter as well.
      const IDENTITY_PURPOSES = new Set([
        'name',
        'given-name',
        'family-name',
        'email',
        'tel',
        'tel-national',
        'username',
        'street-address',
        'address-line1',
        'address-line2',
        'postal-code',
        'cc-number',
        'cc-name',
        'cc-csc',
        'cc-exp',
        'bday',
        'current-password',
        'new-password',
        'one-time-code',
      ]);

      function detectPurpose(el) {
        const name = (el.name || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const type = el.type ? `type=${el.type.toLowerCase()}` : '';
        const label = getLabelText(el).toLowerCase();
        const placeholder = (el.placeholder || '').toLowerCase();
        const combined = `${name} ${id} ${type} ${label} ${placeholder}`;

        for (const mapping of INPUT_PURPOSE_MAP) {
          if (mapping.pattern.test(combined)) {
            return mapping.expected;
          }
        }
        return null;
      }

      // Does this field sit in a form that collects the user's own data? A
      // field of type email, tel or password is that evidence by itself; any
      // other field needs two identity fields in the same form. A lone address
      // field ("enter the URL to check"), a country filter or a language
      // switcher is somebody else's datum or none at all.
      function collectsUserData(el) {
        const ownType = (el.type || '').toLowerCase();
        if (ownType === 'email' || ownType === 'tel' || ownType === 'password') return true;
        const scope = el.form || document;
        let identityFields = 0;
        for (const field of scope.querySelectorAll('input, select, textarea')) {
          const fieldType = (field.type || '').toLowerCase();
          if (fieldType === 'email' || fieldType === 'tel' || fieldType === 'password') {
            identityFields += 2;
            continue;
          }
          const purposes = detectPurpose(field) || [];
          if (purposes.some((p) => IDENTITY_PURPOSES.has(p))) identityFields++;
        }
        return identityFields >= 2;
      }

      const violations = [];
      let totalFields = 0;
      let fieldsWithAutocomplete = 0;
      let fieldsWithPurpose = 0;

      const inputs = document.querySelectorAll('input, select, textarea');

      inputs.forEach((el) => {
        // Skip hidden, submit, button, reset, image, file, and non-form inputs
        const type = (el.type || '').toLowerCase();
        if (
          ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color'].includes(type)
        )
          return;
        // Skip inputs with role that changes semantics (e.g., search boxes)
        if (el.tagName.toLowerCase() === 'input' && type === 'search') return;

        totalFields++;

        const rawAutocomplete = el.getAttribute('autocomplete');
        const tokens = parseAutocompleteTokens(rawAutocomplete);
        const detectedPurpose = detectPurpose(el);

        if (detectedPurpose) fieldsWithPurpose++;

        if (tokens) {
          fieldsWithAutocomplete++;

          // Check for invalid autocomplete values
          const lastToken = tokens[tokens.length - 1];
          if (lastToken && !isValidAutocompleteValue(lastToken)) {
            violations.push({
              criterion: '9.1.3.5',
              element: getSelector(el),
              issue: 'invalid-autocomplete-value',
              description: `Invalid autocomplete value "${rawAutocomplete}" is not in the HTML spec`,
              severity: 'error',
              currentValue: rawAutocomplete,
              suggestion: detectedPurpose
                ? `Use autocomplete="${detectedPurpose[0]}"`
                : 'Use a valid autocomplete value from the HTML spec',
            });
            return;
          }

          // Check autocomplete="off" on a field with recognizable purpose
          if (lastToken === 'off' && detectedPurpose) {
            violations.push({
              criterion: '9.1.3.5',
              element: getSelector(el),
              issue: 'autocomplete-off-on-purpose-field',
              description: `autocomplete="off" on a field with recognizable purpose (expected: ${detectedPurpose[0]})`,
              severity: 'serious',
              currentValue: rawAutocomplete,
              expectedValues: detectedPurpose,
              suggestion: `Use autocomplete="${detectedPurpose[0]}" instead of "off"`,
            });
            return;
          }

          // Check if autocomplete value matches the detected purpose
          if (detectedPurpose && lastToken !== 'on' && lastToken !== 'off') {
            const matches = detectedPurpose.some((expected) => tokens.includes(expected));
            if (!matches) {
              // If the current value is a valid spec purpose, run detectPurpose
              // in reverse: check if any pattern expects this autocomplete value.
              // This prevents flagging e.g. autocomplete="photo" on type="url"
              // when "photo" is a valid, more-specific purpose for the field.
              const reverseMatch =
                VALID_AUTOCOMPLETE_VALUES.has(lastToken) &&
                INPUT_PURPOSE_MAP.some((m) => m.expected.includes(lastToken));
              if (reverseMatch) return; // valid specific purpose, skip
              violations.push({
                criterion: '9.1.3.5',
                element: getSelector(el),
                issue: 'wrong-autocomplete',
                description: `autocomplete="${rawAutocomplete}" does not match field purpose (expected: ${detectedPurpose.join(' or ')})`,
                severity: 'serious',
                currentValue: rawAutocomplete,
                expectedValues: detectedPurpose,
                suggestion: `Use autocomplete="${detectedPurpose[0]}"`,
              });
            }
          }
        } else {
          // No autocomplete attribute: flag if purpose is detectable and the
          // form around the field collects the user's own data.
          //
          // Radio buttons and checkboxes are excluded: SC 1.3.5's autocomplete
          // tokens describe fields that COLLECT the user's own data, not
          // preference selectors. A radio group "Bevorzugte Kontaktmethode:
          // E-Mail / Telefon" or a checkbox "E-Mail-Benachrichtigungen" has
          // label text that trips the purpose patterns while collecting no
          // personal datum at all; there is no meaningful token to autofill
          // into it. (Explicitly-authored WRONG tokens on these types are still
          // caught above, where the attribute is present.)
          const isPreferenceSelector = type === 'radio' || type === 'checkbox';
          if (detectedPurpose && !isPreferenceSelector && collectsUserData(el)) {
            violations.push({
              criterion: '9.1.3.5',
              element: getSelector(el),
              issue: 'missing-autocomplete',
              description: `Form field with recognizable purpose is missing autocomplete attribute (expected: ${detectedPurpose[0]})`,
              severity: 'serious',
              expectedValues: detectedPurpose,
              suggestion: `Add autocomplete="${detectedPurpose[0]}"`,
            });
          }
        }
      });

      return {
        violations,
        totalFields,
        fieldsWithAutocomplete,
        fieldsWithPurpose,
      };
    });

    return {
      scannerId: this.id,
      criteria: ['9.1.3.5'],
      passed: purposeResults.violations.length === 0,
      violations: purposeResults.violations,
      summary: {
        totalFields: purposeResults.totalFields,
        fieldsWithAutocomplete: purposeResults.fieldsWithAutocomplete,
        fieldsWithPurpose: purposeResults.fieldsWithPurpose,
        violationCount: purposeResults.violations.length,
      },
    };
  }
}

module.exports = InputPurposeScanner;
