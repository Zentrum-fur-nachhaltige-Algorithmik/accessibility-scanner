/**
 * LLM Consistent Help Scanner
 *
 * Covers:
 * - 3.2.6 Consistent Help (Level A, new in WCAG 2.2)
 *
 * "If a Web page contains [human contact details, a human contact mechanism, a
 * self-help option, or a fully automated contact mechanism], then access to at
 * least one of those is included in the same relative order on each page,
 * unless a change is initiated by the user."
 *
 * 3.2.6 is a criterion about a SET of pages, so this scanner navigates to up to
 * two same-origin sub-pages (the pattern the EAA scanners use) and compares the
 * help inventory of each. Where a page has no navigable sub-pages but does
 * contain repeated page-like sections — the shape our test fixtures use, and
 * also how many one-page practice sites are built — it compares those sections
 * instead, and says which mode it used in the summary.
 *
 * Position is measured deterministically in the browser (container landmark,
 * index within that container, ratio). The LLM decides only the two things
 * measurement cannot: whether two differently-worded items ("Hilfe", "Support",
 * "Häufige Fragen") are the SAME help mechanism, and whether an order
 * difference is a real inconsistency or an artefact of pages having different
 * numbers of navigation items.
 */

const LLMBaseScanner = require('./base');
const { analyzeCompat } = require('./analyze-compat');

const MAX_SUBPAGES = 2;

class LLMConsistentHelpScanner extends LLMBaseScanner {
  constructor(llmClient) {
    super('llm-consistent-help', {
      wcagCriteria: ['3.2.6'],
      wcagPrinciple: 'understandable',
    }, llmClient);
  }

  /** Navigates to sub-pages — must own its tab. */
  get needsExclusiveAccess() {
    return true;
  }

  async scan(page, options = {}) {
    const originalUrl = page.url();
    const timeout = options.timeout || 20000;

    const views = [];
    let mode = 'none';

    // ---- mode A: real sub-pages ---------------------------------------
    let candidates = [];
    try {
      candidates = await this._findSubPages(page);
    } catch { /* non-fatal */ }

    if (candidates.length > 0) {
      mode = 'multi-page';
      views.push({ view: originalUrl, help: await this._inventory(page) });
      for (const url of candidates.slice(0, MAX_SUBPAGES)) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
          views.push({ view: url, help: await this._inventory(page) });
        } catch (e) {
          console.warn(`${this.id}: could not load sub-page ${url}: ${e.message}`);
        }
      }
      try {
        await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout });
      } catch { /* the pipeline discards this tab anyway */ }
    }

    // ---- mode B: repeated page-like sections in one document ----------
    if (views.length < 2) {
      const sectioned = await this._inventoryBySection(page);
      if (sectioned.length >= 2) {
        mode = 'in-document-sections';
        views.length = 0;
        views.push(...sectioned);
      }
    }

    const withHelp = views.filter((v) => v.help.length > 0).length;
    if (views.length < 2 || withHelp === 0) {
      return this._empty(
        views.length < 2
          ? 'fewer than two comparable page views found'
          : 'no help mechanism present on any view (3.2.6 does not apply)',
        mode,
        views.length
      );
    }

    const prompt = `${PROMPT}

## Measured help inventory per page view

${JSON.stringify(views, null, 1)}

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
        criteriaChecked: ['3.2.6'],
        comparisonMode: mode,
        viewsCompared: views.length,
        viewsWithHelp: withHelp,
        analyzedFraction: ctx.analyzedFraction,
        chunkCount: ctx.chunkCount,
        truncated: ctx.truncated,
      },
    };
  }

  _empty(reason, mode, viewCount) {
    return {
      scannerId: this.id,
      passed: true,
      violations: [],
      summary: {
        totalIssues: 0,
        criteriaChecked: ['3.2.6'],
        skipped: reason,
        comparisonMode: mode,
        viewsCompared: viewCount,
      },
    };
  }

  /** Same-origin sub-pages, preferring primary navigation links. */
  async _findSubPages(page) {
    return page.evaluate(() => {
      const here = new URL(location.href);
      const seen = new Set([here.pathname]);
      const pick = [];

      const ordered = [
        ...document.querySelectorAll('nav a[href], header a[href], [role="navigation"] a[href]'),
        ...document.querySelectorAll('a[href]'),
      ];

      for (const a of ordered) {
        let u;
        try {
          u = new URL(a.getAttribute('href'), location.href);
        } catch {
          continue;
        }
        if (u.origin !== here.origin) continue;
        if (!/^https?:$/.test(u.protocol)) continue;
        if (u.pathname === here.pathname) continue;    // same page / pure fragment
        if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?)$/i.test(u.pathname)) continue;
        if (seen.has(u.pathname)) continue;
        seen.add(u.pathname);
        pick.push(u.origin + u.pathname);
        if (pick.length >= 4) break;
      }
      return pick;
    });
  }

  /**
   * Browser-side script shared by both comparison modes. Returns the help
   * mechanisms inside `root`, each with measured position metadata.
   */
  static get _inventoryScript() {
    return `
      function __helpInventory(root, doc) {
        const HELP_TEXT = /\\b(help|hilfe|support|unterst(ü|ue)tzung|faq|h(ä|ae)ufige fragen|kontakt|contact|chat|hotline|servicedesk|beratung|anleitung|tutorial|wegweiser)\\b/i;
        const CONTACT_HREF = /^(mailto:|tel:)/i;

        function nameOf(el) {
          const al = el.getAttribute('aria-label');
          if (al && al.trim()) return al.trim();
          const lb = el.getAttribute('aria-labelledby');
          if (lb) {
            const t = lb.split(/\\s+/).map(function (id) { return doc.getElementById(id); })
              .filter(Boolean).map(function (n) { return n.textContent.trim(); }).join(' ');
            if (t) return t;
          }
          const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
          if (txt) return txt;
          return el.getAttribute('title') || el.getAttribute('href') || '';
        }

        function containerOf(el) {
          const land = el.closest('nav, header, footer, main, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="main"], [role="complementary"]');
          if (!land) return { kind: 'body', node: root };
          const role = land.getAttribute('role');
          const kind = role
            ? ({ navigation: 'nav', banner: 'header', contentinfo: 'footer', main: 'main', complementary: 'aside' }[role] || role)
            : land.tagName.toLowerCase();
          return { kind: kind, node: land };
        }

        const candidates = Array.prototype.slice.call(
          root.querySelectorAll('a[href], button, [role="button"], [role="link"], address')
        );

        const out = [];
        for (var i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (el.getAttribute('aria-hidden') === 'true') continue;

          const href = el.getAttribute('href') || '';
          const name = nameOf(el).slice(0, 90);
          const isContactHref = CONTACT_HREF.test(href);
          const isHelpText = HELP_TEXT.test(name) || HELP_TEXT.test(href);
          const isAddress = el.tagName.toLowerCase() === 'address';
          if (!isContactHref && !isHelpText && !isAddress) continue;

          const c = containerOf(el);
          const siblings = Array.prototype.slice.call(
            c.node.querySelectorAll('a[href], button, [role="button"], [role="link"]')
          );
          const idx = siblings.indexOf(el);

          out.push({
            name: name,
            kind: isContactHref ? (href.toLowerCase().indexOf('mailto:') === 0 ? 'email' : 'phone')
                 : isAddress ? 'contact-details'
                 : 'help-link',
            href: href.slice(0, 120) || null,
            container: c.kind,
            indexInContainer: idx,
            itemsInContainer: siblings.length,
            positionRatio: siblings.length > 1 && idx >= 0
              ? Math.round((idx / (siblings.length - 1)) * 100) / 100
              : null,
          });
          if (out.length >= 12) break;
        }
        return out;
      }
    `;
  }

  async _inventory(page) {
    return page.evaluate((script) => {
      eval(script);
      // eslint-disable-next-line no-undef
      return __helpInventory(document.body, document);
    }, LLMConsistentHelpScanner._inventoryScript);
  }

  /**
   * Repeated page-like containers in a single document: a one-page site, or a
   * fixture that simulates several pages. Only used when real sub-page
   * navigation found nothing.
   */
  async _inventoryBySection(page) {
    return page.evaluate((script) => {
      eval(script);

      const all = [...document.querySelectorAll('*')].filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const cls = typeof el.className === 'string' ? el.className : '';
        if (!/\b(page|screen|view|slide|step)[-_]?(section|wrapper|container|panel)?\b/i.test(cls)) return false;
        // Must look like a page: its own header/nav/footer plus some content.
        return el.querySelector('nav, header, footer, [role="navigation"], [role="contentinfo"]') !== null;
      });
      const outermost = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
      if (outermost.length < 2) return [];

      return outermost.slice(0, 4).map((el, i) => {
        const heading = el.querySelector('h1,h2,h3,strong,header');
        return {
          view: (heading ? heading.textContent.trim().slice(0, 60) : '') || `section ${i + 1}`,
          // eslint-disable-next-line no-undef
          help: __helpInventory(el, document),
        };
      });
    }, LLMConsistentHelpScanner._inventoryScript);
  }
}

const PROMPT = `Check these page views for WCAG 2.2 criterion 3.2.6 (Consistent Help, Level A).

The criterion: if a set of pages offers a help mechanism — human contact details (phone, e-mail, postal address), a human contact mechanism (contact form, chat with a person), a self-help option (FAQ, help page, "Häufige Fragen"), or a fully automated contact mechanism (chatbot) — then at least one such mechanism must appear in the SAME RELATIVE ORDER on every page in the set.

"Same relative order" means the mechanism appears at the same point in the page's reading order relative to the other content around it — e.g. always the last item of the main navigation, or always in the footer. It does NOT require identical pixel position, identical wording, or identical styling.

Flag ONLY if ALL of the following are true:
1. At least two page views are given below AND at least one of them contains a help mechanism.
2. The SAME help mechanism (or an equivalent one — treat "Hilfe", "Help", "Support", "FAQ", "Häufige Fragen" as the same self-help mechanism; treat a phone number as the same mechanism wherever it appears) is present on more than one view.
3. Its measured position differs materially between views: a different "container" (e.g. \`nav\` on one view, \`footer\` on another), or a clearly different position within the same container (e.g. \`positionRatio\` 1.0 = last item on one view vs 0.0 = first item on another).
4. There is no indication the change was initiated by the user.

You may also flag the case where a help mechanism is present on some views and entirely ABSENT from another view in the same set — that is a failure of "included in the same relative order on each page".

Examples of violations:
- "Help" link is the LAST item of the nav on view 1 (positionRatio 1.0, container nav) and the FIRST item on view 2 (positionRatio 0.0, container nav).
- Contact details sit in the footer on views 1 and 2, but only inside main content on view 3 (container "main"), with nothing in that view's footer.
- A "Hilfe" link exists in the nav of views 1 and 2 and is missing entirely from view 3.

Examples that are NOT violations (do NOT flag these):
- Same container and near-identical positionRatio, with only the wording differing ("Hilfe" vs "Support") — same mechanism, same relative order.
- positionRatio differing slightly because the views have different numbers of navigation items (e.g. 0.75 vs 0.8, still the last-but-one item) — that is not a material change.
- A help mechanism appearing in ADDITION on some pages (nav on every page, plus an extra footer link on one page) — the required mechanism is still in the same relative order everywhere.
- Only ONE view contains any help mechanism at all and the others are a different kind of page from a different process.
- Contact details in an obviously page-specific context (a doctor's direct line on that doctor's own profile page) while the site-wide contact link stays put.
- Ordering differences among items that are not help mechanisms.

CRITICAL: reason only from the measured inventory below. Each violation must name the help mechanism, and quote the container and positionRatio it had on each view. If you cannot quote those measurements, do not report the violation. Err on the side of NOT flagging.

Use criterion "3.2.6". Set "selector" to something identifiable from the measurement (e.g. \`a[href="/hilfe"]\` or the link text).`;

module.exports = LLMConsistentHelpScanner;
