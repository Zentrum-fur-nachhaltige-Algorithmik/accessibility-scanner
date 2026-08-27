/**
 * Dynamic Content and SPA Scanner.
 * WCAG 2.4.2, 2.4.3 (EN 301 549 9.2.4.2, 9.2.4.3).
 * Activates the page's own navigation links and reports what happens after a
 * client-side route change: a document title that stays on the previous route,
 * and focus that is destroyed instead of moved.
 *
 * A route change is only ever inferred from an observed History API
 * transition (pushState, replaceState or popstate) that changed
 * location.pathname or location.search inside the same document. A fragment
 * link, a skip link and a full page load are all excluded by that test, and a
 * hash-only router is out of scope because a hash change cannot be told from
 * an in-page anchor without guessing.
 *
 * Live regions for dynamic content (4.1.3) are reported by the
 * status-messages scanner, naming and roles (4.1.2) by axe-core, and focus
 * order and focus visibility by focus-management. This scanner reports
 * neither.
 */
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const log = require('../utils/logger').createLogger('dynamic-spa');

/** Navigation links to activate, and how many of them. */
const LINK_SELECTOR = 'a[href], .nav-link, .route-link, [data-route]';
const MAX_LINKS = 5;

/**
 * Give up after this many document loads with no history transition: a site
 * that answers every link with a document load is not a client-side router,
 * and every further click costs a page load and a reload to recover from.
 */
const MAX_DOCUMENT_LOADS = 2;

class DynamicSpaScanner extends BaseScanner {
  constructor() {
    super('dynamic-spa', {
      wcagCriteria: ['2.4.2', '2.4.3'],
      wcagPrinciple: 'operable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * Navigates internally, so it needs exclusive access to the page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      interactionTimeout: 1500,
      timeout: TIMEOUTS.scanner,
      ...options,
    };

    const state = { navigations: 0, documentLoads: 0, routeChanges: 0, linksActivated: 0 };
    // framenavigated fires for a document load and for a same-document
    // navigation alike, so it counts navigations; which kind it was is decided
    // per click by whether the marker installed in the document survived.
    const onFrameNavigated = (frame) => {
      if (frame === page.mainFrame()) state.navigations += 1;
    };
    page.on('framenavigated', onFrameNavigated);

    let violations = [];
    try {
      violations = await this.testRouteChanges(page, scanOptions, state);
    } catch (error) {
      log.warn('Error during route change testing:', error.message);
    } finally {
      page.off('framenavigated', onFrameNavigated);
    }

    return {
      scannerId: this.id,
      criteria: ['2.4.2', '2.4.3'],
      passed: violations.length === 0,
      violations,
      summary: {
        linksActivated: state.linksActivated,
        routeChangesObserved: state.routeChanges,
        navigations: state.navigations,
        documentLoads: state.documentLoads,
        titleIssues: violations.filter((v) => v.type === 'missing-page-title-update').length,
        focusIssues: violations.filter((v) => v.type === 'no-focus-management-route-change').length,
      },
    };
  }

  /**
   * Record every History API transition the page performs, and mark the
   * document so a full page load can be told from a client-side one: the
   * marker survives a route change and is gone after a document load.
   * Runs against the current document, so it is reinstalled after every real
   * navigation.
   */
  async installRouteRecorder(page) {
    await page.evaluate(() => {
      if (window.__a11ySpaRoutes) return;
      window.__a11ySpaMarker = true;
      window.__a11ySpaRoutes = [];

      const record = (kind) => {
        window.__a11ySpaRoutes.push({ kind, route: location.pathname + location.search });
      };
      for (const name of ['pushState', 'replaceState']) {
        const original = history[name];
        history[name] = function (...args) {
          const result = original.apply(this, args);
          record(name);
          return result;
        };
      }
      window.addEventListener('popstate', () => record('popstate'));
    });
  }

  /**
   * Read the page state the two rules compare. `focusedIsBody` plus
   * `focusedStillConnected` is the measurement behind the focus rule: after a
   * route change a browser leaves focus on the activated link, so focus on the
   * body with the previously focused element gone means the application
   * removed the focused element and put focus nowhere.
   */
  async readState(page) {
    return await page.evaluate(() => {
      const previous = window.__a11ySpaFocused;
      const heading = document.querySelector('h1') || document.querySelector('h2, h3, h4, h5, h6');
      return {
        title: document.title,
        heading: heading ? heading.textContent.trim() : '',
        route: location.pathname + location.search,
        transitions: (window.__a11ySpaRoutes || []).length,
        focusedIsBody: !document.activeElement || document.activeElement === document.body,
        focusedStillConnected: !!(previous && previous.isConnected),
      };
    });
  }

  /**
   * The first MAX_LINKS links that could be a client-side route: same origin,
   * not a download, not opened in another context, and not a mailto, tel or
   * javascript URL. A link that leaves the document teaches this scanner
   * nothing and costs a page load plus a reload to recover from.
   */
  async collectLinks(page) {
    const usable = [];
    for (const link of await page.$$(LINK_SELECTOR)) {
      if (usable.length >= MAX_LINKS) break;
      const routable = await link
        .evaluate((el) => {
          if (el.hasAttribute('download')) return false;
          if (el.target && el.target !== '_self') return false;
          const href = el.getAttribute('href');
          if (href === null) return true;
          if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
          try {
            return new URL(el.href, location.href).origin === location.origin;
          } catch (e) {
            return false;
          }
        })
        .catch(() => false);
      if (routable) usable.push(link);
    }
    return usable;
  }

  /**
   * Activate up to MAX_LINKS navigation links and report what a client-side
   * route change did to the title and to focus.
   */
  async testRouteChanges(page, options, state) {
    const violations = [];
    // One router behaves one way, so each rule is reported once however many
    // of its links demonstrate it.
    const reported = new Set();
    await this.installRouteRecorder(page);

    const initialUrl = page.url();

    for (let index = 0; index < MAX_LINKS; index++) {
      if (state.documentLoads >= MAX_DOCUMENT_LOADS && state.routeChanges === 0) break;

      // The links are collected again for every activation: a router that
      // re-renders its own navigation replaces the elements, and a handle
      // taken before the first click would be detached for every click after
      // it.
      const links = await this.collectLinks(page);
      if (index >= links.length) break;
      const link = links[index];

      try {
        // Focus the link first: this is where a keyboard user's focus is when
        // the route change starts, and it is the element the focus rule asks
        // about afterwards.
        await link.focus().catch(() => {});
        await page.evaluate(() => {
          window.__a11ySpaFocused = document.activeElement;
        });

        const before = await this.readState(page);
        await link.click();
        state.linksActivated += 1;
        await new Promise((resolve) => setTimeout(resolve, options.interactionTimeout));

        const sameDocument = await page
          .evaluate(() => window.__a11ySpaMarker === true)
          .catch(() => false);
        if (!sameDocument) {
          state.documentLoads += 1;
          // A full page load: the browser sets the title and resets focus
          // itself, so nothing here is the application's responsibility.
          if (page.url() !== initialUrl) {
            await page.goto(initialUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          }
          await this.installRouteRecorder(page);
          continue;
        }

        const after = await this.readState(page);
        const routeChanged = after.transitions > before.transitions && after.route !== before.route;
        if (!routeChanged) continue;
        state.routeChanges += 1;

        // The heading has to have changed as well. A router that re-enters the
        // route it is already on changes the URL without presenting a
        // different page, and its title is right as it stands.
        if (
          after.title === before.title &&
          after.heading !== before.heading &&
          !reported.has('missing-page-title-update')
        ) {
          reported.add('missing-page-title-update');
          violations.push({
            type: 'missing-page-title-update',
            category: 'route-change',
            severity: 'serious',
            element: 'title',
            description: 'Document title unchanged after a client-side route change',
            details: {
              routeBefore: before.route,
              routeAfter: after.route,
              headingBefore: before.heading,
              headingAfter: after.heading,
              title: after.title,
            },
            wcagCriteria: '2.4.2',
            impact: 'The new route carries the previous route title, so it cannot be identified',
            recommendation: 'Set document.title to the new route title when the route changes',
          });
        }

        if (
          after.focusedIsBody &&
          !after.focusedStillConnected &&
          !reported.has('no-focus-management-route-change')
        ) {
          reported.add('no-focus-management-route-change');
          violations.push({
            type: 'no-focus-management-route-change',
            category: 'route-change',
            severity: 'serious',
            element: 'body',
            description: 'Focus was destroyed by a client-side route change and not moved',
            details: {
              routeBefore: before.route,
              routeAfter: after.route,
            },
            wcagCriteria: '2.4.3',
            impact: 'Keyboard and screen reader users are returned to the top of the document',
            recommendation:
              'Move focus to the heading or the main region of the new route when the route changes',
          });
        }

        // Return to the starting route so the next link starts from the same
        // state as this one did.
        if (page.url() !== initialUrl) {
          await page.goBack().catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (error) {
        log.warn('Error activating a navigation link:', error.message);
      }
    }

    return violations;
  }
}

module.exports = DynamicSpaScanner;
