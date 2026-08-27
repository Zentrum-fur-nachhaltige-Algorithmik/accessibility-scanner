/**
 * Accessibility statement detection shared by the EAA/EN 301 549 scanners.
 * Answers "does this site link an accessibility statement?" once, so a site
 * without one earns a single `serious` finding instead of one per scanner.
 */

/**
 * Link text / href fragments that identify an accessibility statement.
 * Bare words like `statement` or `compliance` are excluded so that
 * "Impressum"/"Compliance" style footer links are not classified as one.
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
  const t = String(text || '')
    .toLowerCase()
    .trim();
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
      const t = String(text || '')
        .toLowerCase()
        .trim();
      const h = String(href || '').toLowerCase();
      if (h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:'))
        return false;
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
      'No accessibility statement is linked from this page. Required by the European Accessibility Act / EN 301 549 clause 12.2.2.',
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
