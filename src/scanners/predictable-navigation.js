/**
 * Predictable Navigation Scanner.
 * WCAG 3.2.1, 3.2.2 (EN 301 549 9.3.2.1, 9.3.2.2), measured: the scanner
 * focuses every control and changes every setting to see whether the page
 * changes the user's context on its own.
 *
 * SC 3.2.3 and 3.2.4 are scoped to "a set of web pages". This scanner sees one
 * document, so it cannot decide either. 3.2.3 is gone; what 3.2.4 can see
 * inside one page (a repeated block naming a component differently, links to
 * one kind of destination marked inconsistently) is asked as a needs-review
 * question with the inventory a reviewer needs, never counted as a failure.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: accnameCode } = require('../utils/accessible-name');
const log = require('../utils/logger').createLogger('predictable-navigation');

/**
 * Controls probed per page, and the time each one gets to act. Handlers
 * routinely defer the context change into a timer, so the window has to
 * outlast a short setTimeout.
 */
const MAX_PROBED_ELEMENTS = 40;
const SETTLE_MS = 120;

class PredictableNavigationScanner extends BaseScanner {
  constructor() {
    super('predictable-navigation', {
      wcagCriteria: ['3.2.1', '3.2.2'],
      wcagPrinciple: 'understandable',
    });
  }

  /**
   * Focuses controls, changes their settings and answers navigation requests
   * with 204, so it must not share a page with another scanner.
   */
  get needsExclusiveAccess() {
    return true;
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      testOnFocus: true,
      testOnInput: true,
      testConsistentIdentification: true,
      timeout: TIMEOUTS.scanner,
      ...options,
    };

    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const navigationResults = await this.performPredictableNavigationAnalysis(
      page,
      scanDir,
      scanOptions
    );

    return {
      scannerId: this.id,
      criteria: ['9.3.2.1', '9.3.2.2'],
      passed: navigationResults.violations.length === 0,
      violations: navigationResults.violations,
      needsReview: navigationResults.needsReview,
      summary: {
        onFocusPredictable: navigationResults.onFocusPredictable,
        onInputPredictable: navigationResults.onInputPredictable,
        identificationQuestions: navigationResults.needsReview.length,
      },
      screenshotPath: scanDir,
      visualEvidence: navigationResults.visualEvidence,
    };
  }

  /**
   * The consistency inventory only reads the DOM, so it runs before the
   * probes, which operate the page's own controls.
   */
  async performPredictableNavigationAnalysis(page, scanDir, options) {
    const violations = [];
    const needsReview = [];

    log.debug('Starting predictable navigation analysis...');

    const initialScreenshot = path.join(scanDir, 'predictable-navigation-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    if (options.testConsistentIdentification) {
      await this.analyzeConsistentIdentification(page, needsReview);
    }

    let probeFindings = { onFocus: [], onInput: [] };
    if (options.testOnFocus || options.testOnInput) {
      probeFindings = await this.probeContextChanges(page, options);
    }

    for (const issue of probeFindings.onFocus) {
      violations.push({
        criterion: '9.3.2.1',
        element: issue.element,
        issue: 'focus-causes-context-change',
        description: `Focusing this element ${issue.what} without the user asking for it`,
        severity: 'error',
        evidence: issue.what,
        suggestion:
          'Trigger the change from an explicit user action such as a button press, not from focus',
      });
    }
    for (const issue of probeFindings.onInput) {
      violations.push({
        criterion: '9.3.2.2',
        element: issue.element,
        issue: 'input-causes-context-change',
        description: `Changing this control ${issue.what} without the user asking for it`,
        severity: 'error',
        evidence: issue.what,
        suggestion:
          'Add a submit or apply button, or state the behaviour on the control before it is used',
      });
    }

    log.debug(`Predictable navigation analysis complete: ${violations.length} violations found`);

    const has = (criterion) => violations.some((v) => v.criterion === criterion);

    return {
      violations,
      needsReview,
      visualEvidence: [
        {
          type: 'predictable-navigation',
          screenshot: path.basename(initialScreenshot),
          onFocusPredictable: !has('9.3.2.1'),
          onInputPredictable: !has('9.3.2.2'),
          identificationQuestions: needsReview.length,
        },
      ],
      onFocusPredictable: !has('9.3.2.1'),
      onInputPredictable: !has('9.3.2.2'),
    };
  }

  /**
   * Focus every control, then change the setting of every control, and record
   * what the page did about it (SC 3.2.1 and 3.2.2).
   *
   * Navigation requests are answered with 204 for the duration of the probe.
   * A 204 leaves the current document in place, so a control that navigates is
   * measured without losing the page; aborting the request instead would
   * replace the document with a network error page.
   */
  async probeContextChanges(page, options) {
    const onRequest = (request) => {
      const isMainNavigation =
        request.isNavigationRequest() && request.frame() === page.mainFrame();
      const settle = isMainNavigation
        ? request.respond({ status: 204, body: '' })
        : request.continue();
      settle.catch(() => {});
    };

    let intercepting = false;
    try {
      await page.setRequestInterception(true);
      intercepting = true;
      page.on('request', onRequest);

      return await page.evaluate(
        async (renderedHelpers, accnameHelpers, config) => {
          eval(renderedHelpers);
          eval(accnameHelpers);

          const probe = {
            navigated: false,
            opened: false,
            submitted: false,
            dialog: false,
          };
          const reset = () => {
            probe.navigated = false;
            probe.opened = false;
            probe.submitted = false;
            probe.dialog = false;
          };

          // Every construct that changes the user's context is redirected into
          // the probe, so the page reports what it would have done instead of
          // doing it.
          const native = {
            open: window.open,
            submit: HTMLFormElement.prototype.submit,
            requestSubmit: HTMLFormElement.prototype.requestSubmit,
            alert: window.alert,
            confirm: window.confirm,
            prompt: window.prompt,
            pushState: history.pushState,
            replaceState: history.replaceState,
          };
          const onUnload = () => {
            probe.navigated = true;
          };
          const onSubmit = (event) => {
            probe.submitted = true;
            event.preventDefault();
          };
          window.addEventListener('beforeunload', onUnload, true);
          document.addEventListener('submit', onSubmit, true);
          window.open = () => {
            probe.opened = true;
            return null;
          };
          HTMLFormElement.prototype.submit = function () {
            probe.submitted = true;
          };
          HTMLFormElement.prototype.requestSubmit = function () {
            probe.submitted = true;
          };
          window.alert = () => {
            probe.dialog = true;
          };
          window.confirm = () => {
            probe.dialog = true;
            return false;
          };
          window.prompt = () => {
            probe.dialog = true;
            return null;
          };
          // A change of context is a change of user agent, viewport, focus, or
          // content that changes the meaning of the page. A URL rewritten with
          // history.pushState / replaceState is none of them: a faceted filter
          // that mirrors its state in the address bar changes nothing the user
          // has to re-orient in. The calls are still swallowed so the probe
          // cannot leave the page on another URL.
          history.pushState = () => {};
          history.replaceState = () => {};

          function selectorFor(el) {
            const className = typeof el.className === 'string' ? el.className : '';
            return (
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (className ? `.${className.split(' ')[0]}` : '')
            );
          }

          const settle = () => new Promise((resolve) => setTimeout(resolve, config.settleMs));

          const openDialogs = () =>
            Array.from(
              document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')
            ).filter(__isRendered);

          /**
           * A dialog that appeared and changed the user's context: it is modal
           * (it takes the viewport) or it took the focus. A date picker or an
           * autocomplete popover that opens under the field and leaves focus
           * where it was changes neither viewport nor focus nor meaning, so it
           * is not a change of context.
           */
          function tookOver(before) {
            const seen = new Set(before);
            for (const dialog of openDialogs()) {
              if (seen.has(dialog)) continue;
              const modal =
                dialog.getAttribute('aria-modal') === 'true' ||
                (typeof dialog.matches === 'function' && dialog.matches('dialog:modal'));
              if (modal) return true;
              if (document.activeElement && dialog.contains(document.activeElement)) return true;
            }
            return false;
          }

          /** What the page did since the last reset, in the user's terms. */
          function whatHappened(dialogsBefore) {
            if (probe.navigated) return 'navigates to another page';
            if (probe.opened) return 'opens a new window';
            if (probe.submitted) return 'submits the form';
            if (probe.dialog) return 'opens a browser dialog';
            if (tookOver(dialogsBefore)) return 'opens a modal dialog which takes focus';
            return null;
          }

          /**
           * 3.2.2 is met when the user was advised of the behaviour before
           * using the component, so a control whose own name or description
           * announces it is exempt.
           */
          const announcesChange =
            /\b(automatic\w*|immediately|reloads?|submits?)\b|automatisch|sofort|wird gesendet|neu geladen/i;
          function isAnnounced(el) {
            const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            const described = ids
              .map((id) => {
                const target = document.getElementById(id);
                return target ? target.textContent : '';
              })
              .join(' ');
            return (
              announcesChange.test(__accessibleName(el) || '') ||
              announcesChange.test(described) ||
              announcesChange.test(el.getAttribute('title') || '')
            );
          }

          const onFocus = [];
          const onInput = [];

          try {
            if (config.testOnFocus) {
              const focusable = Array.from(
                document.querySelectorAll(
                  'a[href], button, input, select, textarea, [tabindex], [contenteditable]'
                )
              )
                .filter(__isFocusableRendered)
                .slice(0, config.maxElements);

              for (const el of focusable) {
                reset();
                const dialogsBefore = openDialogs();
                try {
                  el.focus();
                } catch (e) {
                  continue;
                }
                await settle();
                const what = whatHappened(dialogsBefore);
                if (what) onFocus.push({ element: selectorFor(el), what });
              }
              if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
              }
            }

            if (config.testOnInput) {
              const controls = Array.from(
                document.querySelectorAll('input, select, textarea')
              ).filter((el) => {
                const type = (el.type || '').toLowerCase();
                if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) {
                  return false;
                }
                return !el.disabled && __isRendered(el);
              });

              for (const el of controls.slice(0, config.maxElements)) {
                const before = {
                  value: el.value,
                  checked: el.checked,
                  selectedIndex: el.selectedIndex,
                };
                const type = (el.type || '').toLowerCase();

                // Set the control to a different setting than the one it has.
                if (el.tagName === 'SELECT') {
                  if (el.options.length < 2) continue;
                  el.selectedIndex = el.selectedIndex === 0 ? 1 : 0;
                } else if (type === 'checkbox' || type === 'radio') {
                  el.checked = !el.checked;
                } else {
                  el.value = `${el.value || ''}a11y`;
                }

                reset();
                const dialogsBefore = openDialogs();
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                await settle();
                const what = whatHappened(dialogsBefore);

                if (el.tagName === 'SELECT') el.selectedIndex = before.selectedIndex;
                else if (type === 'checkbox' || type === 'radio') el.checked = before.checked;
                else el.value = before.value;

                if (what && !isAnnounced(el)) {
                  onInput.push({ element: selectorFor(el), what });
                }
              }
            }
          } finally {
            window.removeEventListener('beforeunload', onUnload, true);
            document.removeEventListener('submit', onSubmit, true);
            window.open = native.open;
            HTMLFormElement.prototype.submit = native.submit;
            HTMLFormElement.prototype.requestSubmit = native.requestSubmit;
            window.alert = native.alert;
            window.confirm = native.confirm;
            window.prompt = native.prompt;
            history.pushState = native.pushState;
            history.replaceState = native.replaceState;
          }

          return { onFocus, onInput };
        },
        renderedCode,
        accnameCode,
        {
          settleMs: SETTLE_MS,
          maxElements: MAX_PROBED_ELEMENTS,
          testOnFocus: Boolean(options.testOnFocus),
          testOnInput: Boolean(options.testOnInput),
        }
      );
    } catch (error) {
      log.warn('Context change probe failed:', error.message);
      return { onFocus: [], onInput: [] };
    } finally {
      page.off('request', onRequest);
      if (intercepting) await page.setRequestInterception(false).catch(() => {});
    }
  }

  /**
   * Consistent identification (SC 3.2.4).
   *
   * "Components that have the same functionality WITHIN A SET OF WEB PAGES are
   * identified consistently", and Understanding 3.2.4 says that consistency
   * inside one page is best practice only. This scanner sees one page, so it
   * inventories what a reviewer would compare (a repeated block that names a
   * component differently, one kind of destination marked on some links and
   * not on others) and asks the question instead of answering it.
   */
  async analyzeConsistentIdentification(page, needsReview) {
    log.debug('Analyzing consistent identification...');

    const issues = await page.evaluate(
      (renderedHelpers, accnameHelpers) => {
        eval(renderedHelpers);
        eval(accnameHelpers);
        const found = [];

        function selectorFor(el) {
          const className = typeof el.className === 'string' ? el.className : '';
          return (
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (className ? `.${className.split(' ')[0]}` : '')
          );
        }

        // ---- repeated blocks of controls -------------------------------
        // A toolbar that appears once per section is the same mechanism each
        // time. Blocks count as the same mechanism when they hold the same
        // sequence of control types and still share at least MIN_SHARED names,
        // which is what separates a repeated toolbar from a grid of cards
        // whose links are all named differently on purpose.
        const MIN_CONTROLS = 3;
        const MIN_SHARED_NAMES = 3;
        const MAX_REPORTED_BLOCKS = 5;

        const CONTROL_SELECTOR = 'a[href], button, input, select, textarea, [role="button"]';
        const blocks = new Map();

        for (const block of document.querySelectorAll(
          'div, ul, ol, section, header, footer, nav'
        )) {
          const controls = Array.from(block.querySelectorAll(CONTROL_SELECTOR)).filter(
            __isRendered
          );
          if (controls.length < MIN_CONTROLS) continue;
          // The same mechanism is rendered from the same component, so the
          // block itself has to match too: two menus that happen to list the
          // same links each carry their own toggle and are not one mechanism.
          const blockClass =
            typeof block.className === 'string' ? block.className.split(' ')[0] : '';
          const signature = [
            block.tagName.toLowerCase(),
            blockClass,
            ...controls.map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute('role') || ''}`),
          ].join(',');
          if (!blocks.has(signature)) blocks.set(signature, []);
          blocks.get(signature).push({
            node: block,
            selector: selectorFor(block),
            names: controls.map((el) => (__accessibleName(el) || '').trim().toLowerCase()),
          });
        }

        // A wrapper around a block holds the same controls in the same order,
        // so it carries the same signature; comparing the two compares the
        // same markup against itself.
        for (const [signature, copies] of blocks) {
          blocks.set(
            signature,
            copies.filter((copy) => !copies.some((o) => o !== copy && o.node.contains(copy.node)))
          );
        }

        // A block and the wrapper around it report the same divergence, so the
        // evidence is reported once.
        const reportedDivergences = new Set();

        for (const copies of blocks.values()) {
          if (copies.length < 2 || found.length >= MAX_REPORTED_BLOCKS) continue;
          const [first] = copies;
          for (const other of copies.slice(1)) {
            const same = first.names.filter((name, i) => name && name === other.names[i]);
            if (same.length < MIN_SHARED_NAMES) continue;
            const differing = first.names
              .map((name, i) => ({ name, otherName: other.names[i], i }))
              .filter((pair) => pair.name !== pair.otherName);
            if (!differing.length) continue;
            const divergence = differing.map((pair) => `${pair.name}|${pair.otherName}`).join(',');
            if (reportedDivergences.has(divergence)) continue;
            reportedDivergences.add(divergence);
            found.push({
              type: 'inconsistent-component-identification',
              element: `${first.selector} vs ${other.selector}`,
              description:
                'A repeated block of controls names the same component differently in one copy',
              evidence: differing
                .map((pair) => `"${pair.name}" vs "${pair.otherName}"`)
                .slice(0, 5)
                .join(', '),
              itemCount: differing.length,
              items: differing
                .slice(0, 8)
                .map((pair) => ({ position: pair.i, here: pair.name, there: pair.otherName })),
            });
            if (found.length >= MAX_REPORTED_BLOCKS) break;
          }
        }

        // ---- links to the same kind of destination ----------------------
        // 3.2.4 asks for consistency, not for a convention: a page where no
        // external link is marked identifies them consistently. Only a split,
        // where some carry an indicator and others do not, fails.
        // Phrases a page adds to say where a link goes or what it opens.
        const INDICATOR =
          /\b(?:pdf|docx?|xlsx?|pptx?|word document|excel|powerpoint|external(?:\s+link)?|extern(?:er link)?|opens?\s+in\s+(?:a\s+)?new\s+(?:window|tab)|neues\s+fenster|neuer\s+tab|nouvelle\s+fen[ea]tre)\b/i;
        // The same phrase standing on its own, so a title or a bracket that
        // holds nothing but the marker counts and an article named
        // "Wikipedia:External links" does not. A file size may follow the type
        // word: "(PDF, 2 MB)" tells the reader the same thing "(PDF)" does.
        const SIZE = String.raw`(?:[\s,;/|-]*\d+(?:[.,]\d+)?\s*(?:bytes?|[kmg]b|[kmg]ib))?`;
        const INDICATOR_ONLY = new RegExp(`^[([\\s]*${INDICATOR.source}${SIZE}[^\\w]*$`, 'i');

        /**
         * Does the reader perceive where this link goes? Only from what is
         * rendered: a marker in brackets in the link text, a title that is
         * nothing but the marker, a graphic whose name is the marker, a file
         * extension in the link text, or a marker CSS paints beside the link.
         * A `target` attribute and an unnamed icon show the reader nothing.
         */
        function isMarked(link) {
          const text = (link.textContent || '').trim();
          if (/\.(pdf|docx?|xlsx?|pptx?)\s*$/i.test(text)) return true;
          for (const m of text.matchAll(/[([]([^)\]]{1,40})[)\]]/g)) {
            if (INDICATOR_ONLY.test(m[1].trim())) return true;
          }
          const title = (link.getAttribute('title') || '').trim();
          if (title && INDICATOR_ONLY.test(title)) return true;
          const label = (link.getAttribute('aria-label') || '').trim();
          if (label && label !== text && INDICATOR.test(label)) return true;

          for (const graphic of link.querySelectorAll('img, svg, [role="img"]')) {
            if (!__isRendered(graphic)) continue;
            const titleEl = graphic.querySelector(':scope > title');
            const name = [
              graphic.getAttribute('alt') || '',
              graphic.getAttribute('aria-label') || '',
              titleEl ? titleEl.textContent : '',
            ]
              .join(' ')
              .trim();
            if (name && INDICATOR.test(name)) return true;
          }

          for (const pseudo of ['::after', '::before']) {
            const style = window.getComputedStyle(link, pseudo);
            const content = (style.content || '').trim();
            if (!content || content === 'none' || content === 'normal') continue;
            // A marker the reader sees: generated text, or an image standing in
            // for it. `content: ""` paints nothing on its own.
            const text = content.replace(/^["']|["']$/g, '').trim();
            if (text) return true;
            if (style.backgroundImage && style.backgroundImage !== 'none') return true;
          }
          return false;
        }

        const groups = { external: [], document: [] };
        for (const link of document.querySelectorAll('a[href]')) {
          if (!__isRendered(link)) continue;
          const href = link.getAttribute('href') || '';
          let url;
          try {
            url = new URL(href, location.href);
          } catch (e) {
            continue;
          }
          if (/\.(pdf|docx?|xlsx?|pptx?)$/i.test(url.pathname)) groups.document.push(link);
          else if (/^https?:$/.test(url.protocol) && url.host !== location.host) {
            groups.external.push(link);
          }
        }

        for (const [kind, links] of Object.entries(groups)) {
          if (links.length < 2) continue;
          const marked = links.filter(isMarked);
          if (marked.length === 0 || marked.length === links.length) continue;
          const unmarked = links.filter((link) => !marked.includes(link));
          found.push({
            type: `${kind}-links-no-identification`,
            element: `${kind} links`,
            description: `Links to the same kind of destination are identified inconsistently: ${marked.length} of ${links.length} carry an indicator`,
            evidence: unmarked
              .slice(0, 5)
              .map((link) => `"${(__accessibleName(link) || '').trim()}"`)
              .join(', '),
            itemCount: links.length,
            items: links.slice(0, 12).map((link) => ({
              name: (__accessibleName(link) || '').trim().slice(0, 80),
              href: (link.getAttribute('href') || '').slice(0, 120),
              marked: marked.includes(link),
            })),
          });
        }

        return found;
      },
      renderedCode,
      accnameCode
    );

    for (const issue of issues) {
      needsReview.push({
        ...this.formatViolation(
          issue.type,
          'minor',
          issue.description,
          [{ selector: issue.element }],
          'https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html',
          'info',
          {
            verdict: 'needs-review',
            dossier: {
              question: 'Are these identified consistently across the site?',
              element: { selector: issue.element, html: null, role: null, name: null },
              measurements: { itemsCompared: issue.itemCount },
              context: {
                found: issue.items,
                suggestion: this.getIdentificationSuggestion(issue.type),
              },
            },
          }
        ),
        criterion: '9.3.2.4',
        wcagCriteria: ['3.2.4'],
        issue: issue.type,
        element: issue.element,
        evidence: issue.evidence,
      });
    }
  }

  getIdentificationSuggestion(violationType) {
    const suggestions = {
      'inconsistent-component-identification':
        'Give a component that does the same thing the same accessible name everywhere it is repeated',
      'external-links-no-identification':
        'Mark every link that leaves the site, or none of them, in the same way',
      'document-links-no-identification':
        'Name the file type on every link to a document, or on none of them',
    };
    return (
      suggestions[violationType] ||
      'Maintain consistent identification patterns for similar interface components'
    );
  }
}

module.exports = PredictableNavigationScanner;
