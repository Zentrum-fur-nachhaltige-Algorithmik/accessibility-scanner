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

/**
 * The bare word `accessibility` is the title of countless articles, so it only
 * identifies a statement when it is the whole link text or a whole path
 * segment: "Accessibility" -> /accessibility/ is a statement link,
 * "Introduction to Web Accessibility" -> /intro is an article.
 */
const GENERIC_KEYWORDS = ['accessibility', 'accessibilité'];

/** Does the bare word stand alone as the link text or as a path segment? */
function matchesGenericKeyword(text, href) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
  if (GENERIC_KEYWORDS.includes(t)) return true;

  const path = String(href || '')
    .toLowerCase()
    .split(/[?#]/)[0]
    .replace(/\.(html?|php|aspx?)$/, '');
  return path.split('/').some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escape: compare the raw segment instead.
    }
    return GENERIC_KEYWORDS.includes(decoded);
  });
}

/** Rule id for the one finding a site without a statement earns. */
const MISSING_STATEMENT_RULE = 'missing-accessibility-statement';

/** Pure predicate, so the keyword list is unit-testable without a browser. */
function matchesStatementLink(text, href) {
  const t = String(text || '')
    .toLowerCase()
    .trim();
  const h = String(href || '').toLowerCase();
  if (h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:')) return false;
  if (STATEMENT_LINK_KEYWORDS.some((k) => t.includes(k) || h.includes(k))) return true;
  return matchesGenericKeyword(t, h);
}

/**
 * Look for a link to an accessibility statement on the current page.
 * Read-only: never navigates, so several scanners can call it on a shared tab.
 * @returns {Promise<{found: boolean, url?: string, text?: string, selector?: string}>}
 */
async function findStatementLink(page) {
  return page.evaluate(
    (keywords, generic) => {
      const matchesGeneric = (t, h) => {
        if (generic.includes(t.replace(/[\s\u00a0]+/g, ' ').trim())) return true;
        const path = h.split(/[?#]/)[0].replace(/\.(html?|php|aspx?)$/, '');
        return path.split('/').some((segment) => {
          let decoded = segment;
          try {
            decoded = decodeURIComponent(segment);
          } catch {
            // Malformed escape: compare the raw segment instead.
          }
          return generic.includes(decoded);
        });
      };
      const matches = (text, href) => {
        const t = String(text || '')
          .toLowerCase()
          .trim();
        const h = String(href || '').toLowerCase();
        if (h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:'))
          return false;
        if (keywords.some((k) => t.includes(k) || h.includes(k))) return true;
        return matchesGeneric(t, h);
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
    },
    STATEMENT_LINK_KEYWORDS,
    GENERIC_KEYWORDS
  );
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
  GENERIC_KEYWORDS,
  MISSING_STATEMENT_RULE,
  matchesStatementLink,
  findStatementLink,
  missingStatementViolation,
};
