/**
 * LLM Redundant Entry Scanner
 *
 * Covers:
 * - 3.3.7 Redundant Entry (Level A, new in WCAG 2.2)
 *
 * "Information previously entered by or provided to the user that is required
 * to be entered again in the same process is either auto-populated, or
 * available for the user to select."
 *
 * Single-page heuristic: a multi-step process rendered on one page (or a form
 * with repeated sections) that asks for the same datum twice without
 * pre-filling it and without offering a "same as above" selection.
 *
 * The LLM's job is only the SEMANTIC step — deciding that "Nachname" in step 1
 * and "Familienname" in step 3 are the same datum, which no attribute
 * comparison can do. Everything measurable (which fields exist, in which
 * section, whether they carry a value, whether a copy-from control exists) is
 * pre-computed in the browser and handed over as evidence, so the model never
 * has to guess at page structure.
 */

const LLMBaseScanner = require('./base');
const { analyzeCompat } = require('./analyze-compat');

class LLMRedundantEntryScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-redundant-entry', {
      wcagCriteria: ['3.3.7'],
      wcagPrinciple: 'understandable',
    }, llmClient);
  }

  async scan(page, options = {}) {
    const form = await this._collectFormStructure(page);

    // 3.3.7 only applies inside a multi-step process. One section, or fewer
    // than two fields, cannot contain a redundant re-entry — skip the call.
    if (form.sections.length < 2 || form.totalFields < 4) {
      return this._empty(form, 'not a multi-step process');
    }

    const prompt = `${PROMPT}

## Measured form structure for THIS page

${JSON.stringify(form, null, 1)}

Return violations as JSON.`;

    const { violations: raw, ctx } = await analyzeCompat(this, page, prompt);
    const violations = this.convertViolations(raw);

    return {
      scannerId: this.id,
      passed: violations.length === 0,
      violations,
      summary: {
        totalIssues: violations.length,
        llmModel: ctx.llmModel || 'unknown',
        criteriaChecked: ['3.3.7'],
        sections: form.sections.length,
        totalFields: form.totalFields,
        analyzedFraction: ctx.analyzedFraction,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }

  _empty(form, reason) {
    return {
      scannerId: this.id,
      passed: true,
      violations: [],
      summary: {
        totalIssues: 0,
        criteriaChecked: ['3.3.7'],
        skipped: reason,
        sections: form.sections.length,
        totalFields: form.totalFields,
      },
    };
  }

  /**
   * Pre-compute the page's step/section structure and per-field facts. Doing
   * this in the browser rather than in the prompt means the model reasons over
   * a small, exact table instead of re-deriving it from raw markup.
   */
  async _collectFormStructure(page) {
    return page.evaluate(() => {
      const FIELD_SEL =
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea';

      function labelFor(el) {
        if (el.id) {
          const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (l && l.textContent.trim()) return l.textContent.trim();
        }
        const wrap = el.closest('label');
        if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
        const al = el.getAttribute('aria-label');
        if (al) return al.trim();
        const lb = el.getAttribute('aria-labelledby');
        if (lb) {
          const t = lb.split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .map((n) => n.textContent.trim())
            .join(' ');
          if (t) return t;
        }
        return el.getAttribute('placeholder') || el.name || el.id || '(unlabelled)';
      }

      /**
       * Section = a fieldset, or a container whose heading/header names a step.
       * Falls back to "the whole form" when the page has no such grouping.
       */
      function sectionsOf(root) {
        const explicit = [...root.querySelectorAll('fieldset')];
        if (explicit.length >= 2) {
          return explicit.map((fs) => ({
            node: fs,
            name: (fs.querySelector('legend')?.textContent || '').trim() || '(unnamed fieldset)',
          }));
        }

        const stepish = [...root.querySelectorAll('*')].filter((el) => {
          if (!(el instanceof HTMLElement)) return false;
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!/\b(step|stage|section|wizard|page)\b/i.test(cls)) return false;
          return el.querySelector(FIELD_SEL) !== null;
        });
        // Keep only outermost matches so nested wrappers are not double-counted.
        const outermost = stepish.filter((el) => !stepish.some((o) => o !== el && o.contains(el)));
        if (outermost.length >= 2) {
          return outermost.map((el) => ({
            node: el,
            name:
              (el.querySelector('h1,h2,h3,h4,legend,.step-header,header')?.textContent || '')
                .trim()
                .slice(0, 80) || '(unnamed step)',
          }));
        }

        const forms = [...root.querySelectorAll('form')];
        if (forms.length >= 2) {
          return forms.map((f, i) => ({
            node: f,
            name: (f.getAttribute('name') || f.id || `form ${i + 1}`).slice(0, 80),
          }));
        }
        return forms.length === 1
          ? [{ node: forms[0], name: 'the form' }]
          : [{ node: root, name: 'the page' }];
      }

      const sections = sectionsOf(document.body);
      let totalFields = 0;

      const out = sections.map((s) => {
        const fields = [...s.node.querySelectorAll(FIELD_SEL)].map((el) => {
          totalFields++;
          const value = 'value' in el ? String(el.value || '') : '';
          return {
            label: labelFor(el).replace(/\s+/g, ' ').slice(0, 80),
            name: el.getAttribute('name') || null,
            type: (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase(),
            hasValue: value.trim().length > 0,
            autocomplete: el.getAttribute('autocomplete') || null,
            readonly: el.hasAttribute('readonly'),
            disabled: el.hasAttribute('disabled'),
            required: el.hasAttribute('required'),
          };
        });

        // Controls that let the user REUSE earlier data instead of retyping it
        // ("Same as billing address", "Copy from step 1", a select of saved
        // addresses). Their presence satisfies 3.3.7's "available to select".
        const reuseControls = [...s.node.querySelectorAll('input[type="checkbox"], button, select')]
          .map((c) => {
            const label = labelFor(c) + ' ' + (c.textContent || '');
            return label.replace(/\s+/g, ' ').trim();
          })
          .filter((t) =>
            /(same as|gleich wie|wie oben|übernehmen|copy from|use (my|the) (previous|saved|billing)|aus schritt|identisch)/i
              .test(t)
          )
          .slice(0, 5);

        return { section: s.name, fields, reuseControls };
      });

      return {
        sections: out,
        totalFields,
        pageHasAutofillTokens: document.querySelectorAll('[autocomplete]:not([autocomplete="off"])').length,
      };
    });
  }
}

const PROMPT = `Check this page for WCAG 2.2 criterion 3.3.7 (Redundant Entry, Level A).

The criterion: information the user already entered earlier IN THE SAME PROCESS must not have to be entered again — it must be auto-populated, or offered for selection. It applies to multi-step processes (checkout, registration, booking, application forms) presented as steps or sections.

Flag a field ONLY if ALL of the following are true:
1. The page presents a MULTI-STEP process — two or more sections/steps that are part of one continuous task (the measured structure below names them).
2. A field in a LATER section asks for the SAME piece of information as a field in an EARLIER section. Same information means the same real-world datum, even under a different wording ("Nachname" / "Familienname", "E-Mail" / "E-Mail-Adresse", "Telefon" / "Mobilnummer" when clearly the same contact number).
3. The later field is EMPTY: its measured "hasValue" is false.
4. That later section offers NO way to reuse the earlier answer: its "reuseControls" list is empty (no "same as above" checkbox, no "copy from step 1" button, no selection of saved values).

Examples of violations:
- Step 1 collects "First Name", "Last Name", "Email Address"; Step 2 "Shipping Information" asks for "First Name", "Last Name", "Email Address" again with hasValue false and no reuse control.
- Step 1 collects "Telefonnummer"; Step 4 "Bestätigung" asks for "Kontakt-Telefonnummer" again, empty, with no reuse control.

Examples that are NOT violations (do NOT flag these):
- A later field asking for the same datum that is already pre-filled (hasValue true) — that IS auto-population, which is exactly what the criterion asks for.
- A section that has a "Same as billing address" checkbox, a "Wie oben übernehmen" control, or a select of saved addresses in its reuseControls — the information is available for selection.
- Password confirmation ("Passwort" then "Passwort wiederholen") — explicitly excepted by the criterion; re-entry is essential here.
- A second, genuinely DIFFERENT datum that merely sounds similar: billing address vs. delivery address, patient name vs. insured person's name, contact person vs. account holder. These are different people or different addresses, not redundant entry.
- Fields with autocomplete tokens but no earlier counterpart on the page — browser autofill is not what this criterion is about, and a first-time question is never redundant.
- Any repetition across what are clearly SEPARATE processes (a newsletter signup box next to a contact form) — 3.3.7 only applies within one process.
- A single-section form, however long.

CRITICAL: base every judgement on the measured form structure below, not on impressions from the markup. Each violation you report must name the earlier field (section + label) and the later field (section + label) it duplicates, and state that the later field's hasValue was false and its reuseControls list was empty. If you cannot cite that evidence, do not report it. Err on the side of NOT flagging.

Use criterion "3.3.7" and set "selector" to a CSS selector for the redundant field where the measured data gives you one (e.g. an input's name attribute → \`[name="ship_first_name"]\`).`;

module.exports = LLMRedundantEntryScanner;
