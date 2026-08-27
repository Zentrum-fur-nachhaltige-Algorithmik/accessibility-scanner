/**
 * One shared answer to "does this site publish an accessibility statement?".
 *
 * Four scanners need that answer — `accessibility-statement`, `eaa-procedure`,
 * `contact-mechanism` and `compliance-monitoring` — and each used to implement
 * its own keyword search AND emit its own follow-up findings when the answer
 * was NO. On a site without a statement that produced twelve findings for a
 * single defect with a single fix:
 *
 *   missing-statement (critical!), missing-accessibility-statement,
 *   no-response-time, no-monitoring-procedure, no-audit-schedule,
 *   no-issue-tracking, no-user-feedback, no-improvement-evidence,
 *   no-accessibility-specific-contact, no-feedback-process,
 *   no-compliance-monitoring, …
 *
 * Every one of those follow-ups is a statement about the STATEMENT: EN 301 549
 * clause 12.2.2 / the EAA require the published statement to name the feedback
 * mechanism, the accessibility contact point and the monitoring and review
 * process. They are only decidable once a statement exists and can be read; on
 * a site with no statement at all there is exactly one defect to report, and it
 * is the missing statement.
 *
 * Severity is `serious`, not `critical`: a missing statement is a breach of an
 * EAA/BFSG procedural duty, but it blocks no user from operating the page — the
 * `critical` tier is reserved for findings that do.
 */

/**
 * Link text / href fragments that identify an accessibility statement.
 *
 * Deliberately narrower than the old per-scanner lists, which matched the bare
 * words `statement`, `compliance` and `accessibility` and so classified any
 * "Impressum"/"Compliance" style footer link as a statement.
 */
const STATEMENT_LINK_KEYWORDS = [
  'accessibility statement',
  'accessibility-statement',
  'accessibility',
  'barrierefreiheit',
  'barrierefreiheitserklärung',
  'erklärung zur barrierefreiheit',
  'zugänglichkeit',
  'declaration accessibilite',
  "déclaration d'accessibilité",
  'accessibilite',
  'accesibilidad',
  'toegankelijkheid',
  'a11y',
];

/** Rule id for the one finding a site without a statement earns. */
const MISSING_STATEMENT_RULE = 'missing-accessibility-statement';

/** Pure predicate, so the keyword list is unit-testable without a browser. */
function matchesStatementLink(text, href) {
  const t = String(text || '').toLowerCase().trim();
  const h = String(href || '').toLowerCase();
  if (h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:')) return false;
  return STATEMENT_LINK_KEYWORDS.some((k) => t.includes(k) || h.includes(k));
}

/**
 * Look for a link to an accessibility statement on the current page.
 * Read-only: never navigates, so several scanners can call it on a shared tab.
 * @returns {Promise<{found: boolean, url?: string, text?: string, selector?: string}>}
 */
async function findStatementLink(page) {
  return page.evaluate((keywords) => {
    const matches = (text, href) => {
      const t = String(text || '').toLowerCase().trim();
      const h = String(href || '').toLowerCase();
      if (h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:')) return false;
      return keywords.some((k) => t.includes(k) || h.includes(k));
    };

    for (const link of Array.from(document.querySelectorAll('a[href]'))) {
      const rawHref = link.getAttribute('href') || '';
      if (!matches(link.textContent, rawHref)) continue;
      const selector = link.id
        ? `a#${link.id}`
        : link.className && typeof link.className === 'string'
          ? `a.${link.className.trim().split(/\s+/).join('.')}`
          : `a[href="${rawHref}"]`;
      return { found: true, url: link.href, text: link.textContent.trim(), selector };
    }
    return { found: false };
  }, STATEMENT_LINK_KEYWORDS);
}

/** The single canonical finding for "this site has no accessibility statement". */
function missingStatementViolation() {
  return {
    criterion: 'EAA-Statement',
    element: 'website',
    issue: MISSING_STATEMENT_RULE,
    description:
      'No accessibility statement is linked from this page — required by the European Accessibility Act / EN 301 549 clause 12.2.2.',
    suggestion:
      'Publish an accessibility statement (conformance level, known limitations, feedback contact, review date) and link it from the footer or main navigation.',
    severity: 'serious',
  };
}

module.exports = {
  STATEMENT_LINK_KEYWORDS,
  MISSING_STATEMENT_RULE,
  matchesStatementLink,
  findStatementLink,
  missingStatementViolation,
};
