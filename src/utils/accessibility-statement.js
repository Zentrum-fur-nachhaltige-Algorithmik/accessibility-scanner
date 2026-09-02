/**
 * Accessibility statement detection shared by the EAA/EN 301 549 scanners.
 * Answers "does this site link an accessibility statement?" once, so a site
 * without one earns a single finding instead of one per scanner.
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
];

/**
 * The bare words `accessibility` and `a11y` are the title of countless
 * articles and part of many site names, so they only identify a statement as
 * the whole link text or a whole path segment: "Accessibility" -> /accessibility/
 * is a statement link, "The A11Y Project" -> / is a home page.
 */
const GENERIC_KEYWORDS = ['accessibility', 'accessibilité', 'a11y'];

/**
 * Wording that names a DECLARATION about this site rather than the subject of
 * accessibility. A candidate carrying it is preferred over every other one.
 */
const DECLARATION_KEYWORDS = [
  'accessibility statement',
  'accessibility-statement',
  'accessibility policy',
  'accessibility-policy',
  'barrierefreiheitserklärung',
  'barrierefreiheitserklaerung',
  'erklärung zur barrierefreiheit',
  'erklaerung zur barrierefreiheit',
  'declaration accessibilite',
  'declaration-accessibilite',
  "déclaration d'accessibilité",
  'toegankelijkheidsverklaring',
  'verklaring toegankelijkheid',
  'declaracion de accesibilidad',
  'declaración de accesibilidad',
];

/**
 * Path segments of a publication rather than of a site's own declaration:
 * a post named "Barrierefreiheit im Web" is an article about the subject.
 */
const PUBLICATION_PATH =
  /\/(blog|blogs|news|nachrichten|artikel|article|articles|post|posts|magazin|magazine|techniques|resources|ressourcen|wiki|kurs|course|guide|guides)\//i;

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

/**
 * Rank one candidate link. The first substring hit on "barrierefreiheit" is
 * not the statement: a blog post about accessibility carries the same word as
 * the footer link that leads to the declaration, and only the ranking tells
 * them apart. Pure, so the ordering is unit-testable without a browser.
 *
 * @param {{text: string, href: string, inFooterOrNav: boolean}} candidate
 * @returns {number} higher is more likely to be the statement
 */
function scoreStatementCandidate({ text, href, inFooterOrNav }) {
  const t = String(text || '')
    .toLowerCase()
    .trim();
  const h = String(href || '').toLowerCase();
  let score = 0;
  if (DECLARATION_KEYWORDS.some((k) => t.includes(k) || h.includes(k))) score += 6;
  if (inFooterOrNav) score += 2;
  if (matchesGenericKeyword(t, h)) score += 1;
  // An article is a page about the subject, not a declaration about the site.
  if (PUBLICATION_PATH.test(h)) score -= 5;
  return score;
}

/**
 * Look for a link to an accessibility statement on the current page.
 * Read-only: never navigates, so several scanners can call it on a shared tab.
 *
 * Every candidate is collected and ranked; the best one is returned. A page
 * that links both an article and the footer declaration resolves to the
 * declaration whatever their document order.
 *
 * @returns {Promise<{found: boolean, url?: string, text?: string, selector?: string,
 *   declares?: boolean, candidates?: {text: string, href: string, score: number}[]}>}
 */
async function findStatementLink(page) {
  return page.evaluate(
    (keywords, generic, declaration, publicationSource) => {
      const publication = new RegExp(publicationSource, 'i');
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

      const candidates = [];
      for (const link of Array.from(document.querySelectorAll('a[href]'))) {
        const rawHref = link.getAttribute('href') || '';
        const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
        if (!matches(text, rawHref)) continue;

        const t = text.toLowerCase();
        const h = rawHref.toLowerCase();
        const declares = declaration.some((k) => t.includes(k) || h.includes(k));
        const inFooterOrNav = Boolean(
          link.closest('footer, nav, [role="contentinfo"], [role="navigation"]')
        );
        let score = 0;
        if (declares) score += 6;
        if (inFooterOrNav) score += 2;
        if (matchesGeneric(t, h)) score += 1;
        if (publication.test(h)) score -= 5;

        const selector = link.id
          ? `a#${link.id}`
          : link.className && typeof link.className === 'string'
            ? `a.${link.className.trim().split(/\s+/).join('.')}`
            : `a[href="${rawHref}"]`;
        candidates.push({ node: link, text, href: rawHref, score, declares, selector });
      }

      if (candidates.length === 0) return { found: false, candidates: [] };

      // Highest score wins; document order decides a tie, so a page with two
      // equally good links still resolves the same way on every run.
      let best = candidates[0];
      for (const c of candidates) {
        if (c.score > best.score) best = c;
      }
      return {
        found: true,
        url: best.node.href,
        text: best.text,
        selector: best.selector,
        declares: best.declares,
        candidates: candidates.map((c) => ({ text: c.text, href: c.href, score: c.score })),
      };
    },
    STATEMENT_LINK_KEYWORDS,
    GENERIC_KEYWORDS,
    DECLARATION_KEYWORDS,
    PUBLICATION_PATH.source
  );
}

/**
 * The single canonical finding for "this site has no accessibility statement".
 *
 * Severity is `moderate` on purpose. The duty to publish a statement is a
 * documentation duty of Directive (EU) 2016/2102 Art. 7(1) and of the national
 * EAA transpositions (AT BaFG, DE BFSG): its absence bars nobody from using
 * the page, so it must not weigh as much as a barrier a user runs into
 * (severity `serious`, weight 5, in src/core/severity.js). It stays a
 * violation rather than a question because it is measurable: either a
 * statement is linked or it is not.
 */
function missingStatementViolation() {
  return {
    criterion: 'EAA-Statement (2016/2102 Art. 7)',
    element: 'website',
    issue: MISSING_STATEMENT_RULE,
    description:
      'No accessibility statement is linked from this page. Required by Directive (EU) 2016/2102 Art. 7(1) and its national transpositions (AT BaFG, DE BFSG).',
    suggestion:
      'Publish an accessibility statement (conformance status, known limitations, feedback contact, review date, enforcement procedure) and link it from the footer or main navigation.',
    severity: 'moderate',
  };
}

module.exports = {
  STATEMENT_LINK_KEYWORDS,
  GENERIC_KEYWORDS,
  DECLARATION_KEYWORDS,
  MISSING_STATEMENT_RULE,
  matchesStatementLink,
  scoreStatementCandidate,
  findStatementLink,
  missingStatementViolation,
};
