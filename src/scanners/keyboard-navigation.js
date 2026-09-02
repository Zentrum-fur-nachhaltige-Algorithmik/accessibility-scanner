/**
 * Keyboard Navigation Scanner.
 * WCAG 2.1.1, 2.1.2, 2.1.4 (EN 301 549 9.2.1.1, 9.2.1.2, 9.2.1.4).
 * Drives real Tab presses through the page and analyses keyboard reachability,
 * traps and single character key shortcuts. Focus order (2.4.3) and focus
 * visibility (2.4.7) belong to the focus-management scanner.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const {
  tabWalk,
  cleanupTabWalk,
  EMBEDDED_CONTENT_TAGS,
  TAB_ATTR,
} = require('../utils/keyboard-focus');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: accnameUtils } = require('../utils/accessible-name');
const log = require('../utils/logger').createLogger('keyboard-navigation');

/**
 * Roving tabindex helper, injected into the page. Inside a composite widget
 * exactly one item is in the tab order and the others carry tabindex="-1";
 * arrow keys move between them, which is what the ARIA practices prescribe.
 */
const rovingTabindexCode = `
  var __COMPOSITE_ROLES = [
    'tablist', 'menu', 'menubar', 'radiogroup', 'toolbar', 'tree', 'treegrid',
    'grid', 'listbox', 'combobox', 'application'
  ];
  function isRovingTabindexItem(element) {
    var selector = __COMPOSITE_ROLES.map(function (r) { return '[role="' + r + '"]'; }).join(', ');
    var composite = element.closest(selector);
    if (!composite) return false;
    // The widget takes focus itself and moves it to its items from there
    // (a listbox or a grid with tabindex="0").
    if (composite !== element && composite.tabIndex >= 0) return true;
    // Some other item of the same widget is in the tab order, so the widget is
    // reachable and this item is reached with the arrow keys.
    var items = composite.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex]'
    );
    for (var i = 0; i < items.length; i++) {
      if (items[i] !== element && items[i].tabIndex >= 0) return true;
    }
    return false;
  }
`;

class KeyboardNavigationScanner extends BaseScanner {
  constructor() {
    super('keyboard-navigation', {
      wcagCriteria: ['2.1.1', '2.1.2', '2.1.4'],
      wcagPrinciple: 'operable',
    });
  }

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
      testAllInteractives: true,
      simulateTabbing: true,
      testCustomControls: true,
      ...options,
    };

    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const keyboardResults = await this.performKeyboardAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['9.2.1.1', '9.2.1.2', '9.2.1.4'],
      passed: keyboardResults.violations.length === 0,
      violations: keyboardResults.violations,
      needsReview: keyboardResults.needsReview,
      summary: {
        tabbableElements: keyboardResults.tabbableElements,
        keyboardInaccessible: keyboardResults.keyboardInaccessible,
        keyboardTraps: keyboardResults.keyboardTraps,
        customShortcuts: keyboardResults.customShortcuts,
      },
      tabOrder: keyboardResults.tabOrder,
      screenshotPath: scanDir,
      visualEvidence: keyboardResults.visualEvidence,
    };
  }

  /**
   * Perform comprehensive keyboard analysis with visual validation
   */
  async performKeyboardAnalysis(page, scanDir, options) {
    const violations = [];
    const needsReview = [];
    const tabOrder = [];
    const visualEvidence = [];
    let tabbableElements = 0;
    let keyboardInaccessible = 0;
    let keyboardTraps = 0;
    let customShortcuts = 0;

    // 1. Discover all potentially interactive elements
    const interactiveElements = await page.evaluate(() => {
      const elements = [];

      // Standard interactive elements
      const standardSelectors = [
        'a[href]',
        'button',
        'input',
        'textarea',
        'select',
        'details',
        '[tabindex]:not([tabindex="-1"])',
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="checkbox"]',
        '[role="radio"]',
      ];

      standardSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          if (!el.hasAttribute('disabled') && !el.hidden) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const className =
                el.className && typeof el.className === 'string'
                  ? el.className
                  : el.className && el.className.baseVal
                    ? el.className.baseVal
                    : '';
              elements.push({
                selector:
                  el.tagName.toLowerCase() +
                  (el.id ? `#${el.id}` : '') +
                  (className ? `.${className.split(' ').join('.')}` : ''),
                tagName: el.tagName,
                type: el.type || '',
                role: el.getAttribute('role') || '',
                tabIndex: el.tabIndex,
                ariaLabel: el.getAttribute('aria-label') || '',
                text: el.textContent.trim().substring(0, 50),
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              });
            }
          }
        });
      });

      return elements;
    });

    log.debug(`Found ${interactiveElements.length} potentially interactive elements`);

    // 2. Test keyboard navigation with visual analysis
    await this.testKeyboardNavigation(
      page,
      scanDir,
      interactiveElements,
      violations,
      tabOrder,
      visualEvidence
    );

    // 3. Test for keyboard traps
    const trapResults = await this.testKeyboardTraps(page, scanDir, violations);
    keyboardTraps = trapResults.traps;

    // 4. Test custom controls
    if (options.testCustomControls) {
      const customResults = await this.testCustomControls(page, violations);
      keyboardInaccessible += customResults.inaccessible;
    }

    // 5. Test single character key shortcuts
    const shortcutResults = await this.testKeyboardShortcuts(page, violations);
    customShortcuts = shortcutResults.conflicts;

    // 6. Controls the tab order cannot reach, and focus stops with nothing on them
    await this.validateFocusableElements(page, violations, needsReview);

    // Calculate summary
    tabbableElements = tabOrder.length;
    keyboardInaccessible = violations.filter((v) => v.issue === 'not-keyboard-accessible').length;

    return {
      violations,
      needsReview,
      tabOrder,
      visualEvidence,
      tabbableElements,
      keyboardInaccessible,
      keyboardTraps,
      customShortcuts,
    };
  }

  /**
   * Test keyboard navigation with visual focus verification
   */
  async testKeyboardNavigation(
    page,
    scanDir,
    interactiveElements,
    violations,
    tabOrder,
    visualEvidence
  ) {
    log.debug('Testing keyboard navigation with visual analysis...');

    // Real Tab presses via src/utils/keyboard-focus.js. Element identity is
    // the tab id stamped on each element, not its selector string, so two
    // sibling `a.nav-link`s are not mistaken for one element.
    const maxSteps = Math.min(80, Math.max(20, interactiveElements.length + 5));
    let stepIndex = 0;
    let stuckStep = null;

    try {
      for await (const step of tabWalk(page, { maxSteps, settleMs: 100 })) {
        if (step.stuck) {
          stuckStep = step;
          break;
        }
        if (!step.rendered) continue;

        const shot = `tab-${String(stepIndex).padStart(3, '0')}-after.png`;
        try {
          await page.screenshot({ path: path.join(scanDir, shot), fullPage: false });
        } catch (e) {
          /* best-effort */
        }

        const ind = step.indicator;
        tabOrder.push({
          element: step.selector,
          tabId: step.tabId,
          tabIndex: tabOrder.length,
          role: step.tag,
          // document coordinates, measured while the element was focused
          rect: {
            x: step.rect.x + step.scrollX,
            y: step.rect.y + step.scrollY,
            width: step.rect.width,
            height: step.rect.height,
          },
          isVisible: step.rect.width > 0 && step.rect.height > 0,
          hasVisibleFocus: ind.visible,
        });

        visualEvidence.push({
          tabIndex: stepIndex,
          element: step.selector,
          afterScreenshot: shot,
          focusVisible: ind.visible,
          focusIndicators: ind.reasons,
          focusStyles: {
            outline: ind.outline,
            boxShadow: step.after.boxShadow,
            backgroundColor: step.after.backgroundColor,
          },
        });

        stepIndex++;
      }
      if (stuckStep) await this.reportConfirmedTrap(page, stuckStep, violations);
    } finally {
      await cleanupTabWalk(page);
    }

    log.debug(`Completed keyboard navigation test: ${tabOrder.length} elements in tab order`);
  }

  /**
   * Second opinion on a Tab that did not move focus (SC 2.1.2).
   * One unchanged Tab is not a trap: inside an embedded document focus keeps
   * moving while `document.activeElement` stays on the host `<iframe>`, and a
   * widget can swallow a single key press. Three more Tab presses and a
   * Shift+Tab have to leave focus on the same element before this is reported.
   * @param {import('puppeteer').Page} page
   * @param {object} step the stuck tab-walk step
   * @param {object[]} violations collected violations, appended to
   */
  async reportConfirmedTrap(page, step, violations) {
    if (EMBEDDED_CONTENT_TAGS.has(step.tag)) return;

    const stillHere = async () =>
      page.evaluate(
        (ATTR, id) => {
          const el = document.querySelector('[' + ATTR + '="' + id + '"]');
          return !!el && el === document.activeElement;
        },
        TAB_ATTR,
        step.tabId
      );

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!(await stillHere())) return;
    }
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!(await stillHere())) return;

    // 2.1.2 asks for a way out, not for the Tab key. A component the user can
    // leave with Escape or an arrow key is not a trap, so every documented exit
    // a keyboard offers is tried before this is reported.
    const OTHER_EXITS = ['Escape', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    for (const key of OTHER_EXITS) {
      await page.keyboard.press(key);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!(await stillHere())) return;
    }

    violations.push({
      criterion: '9.2.1.2',
      element: step.selector,
      issue: 'keyboard-trap',
      description:
        'Focus stays on this element through four Tab presses, a Shift+Tab, Escape and the arrow keys, so no key leaves it',
      severity: 'serious',
      keySequence: ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', ...OTHER_EXITS],
      suggestion:
        'Ensure all interactive elements allow focus to move to next element with Tab key',
    });
  }

  /**
   * Test for keyboard traps
   */
  async testKeyboardTraps(page, scanDir, violations) {
    log.debug('Testing for keyboard traps...');

    let traps = 0;

    // Test modals and overlays
    // Only things that are dialogs right now: rendered, and either
    // semantically a dialog (role / <dialog open> / aria-modal) or a
    // class-named modal that is actually shown, with at least one
    // focusable child, because a container nothing can focus cannot trap
    // focus.
    const modalElements = await page.evaluate((renderedCode) => {
      eval(renderedCode);
      const modals = [];
      const seen = new Set();
      const selectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        'dialog[open]',
        '[aria-modal="true"]',
        '.modal',
        '.popup',
        '.dialog',
      ];
      let i = 0;
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          if (seen.has(el) || !__isRendered(el)) return;
          const focusable = [
            ...el.querySelectorAll(
              'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ),
          ].filter((f) => __isFocusableRendered(f));
          if (focusable.length === 0) return;
          seen.add(el);
          const marker = 'a11y-modal-' + i++;
          el.setAttribute('data-a11y-modal', marker);
          modals.push({
            selector: `[data-a11y-modal="${marker}"]`,
            label:
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (typeof el.className === 'string' && el.className.trim()
                ? `.${el.className.trim().split(/\s+/).join('.')}`
                : ''),
            focusableCount: focusable.length,
          });
        });
      });
      return modals;
    }, renderedCode);

    for (const modal of modalElements) {
      // Test if focus can escape modal
      await page.evaluate((selector) => {
        const modal = document.querySelector(selector);
        if (modal) {
          const focusable = modal.querySelectorAll(
            'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            focusable[focusable.length - 1].focus();
          }
        }
      }, modal.selector);

      // Take screenshot of modal state
      await page.screenshot({
        path: path.join(scanDir, `modal-trap-test-${traps}.png`),
      });

      // Try to tab out of modal
      await page.keyboard.press('Tab');
      await new Promise((resolve) => setTimeout(resolve, 100));

      const focusEscaped = await page.evaluate((selector) => {
        const modal = document.querySelector(selector);
        const focused = document.activeElement;
        return modal && !modal.contains(focused);
      }, modal.selector);

      if (!focusEscaped) {
        // Test Escape key
        await page.keyboard.press('Escape');
        await new Promise((resolve) => setTimeout(resolve, 200));

        const modalClosed = await page.evaluate(
          (selector, renderedCode) => {
            eval(renderedCode);
            const modal = document.querySelector(selector);
            return !modal || !__isRendered(modal);
          },
          modal.selector,
          renderedCode
        );

        if (!modalClosed) {
          // SC 2.1.2 asks for A way out, not for the Escape key. Activate the
          // dialog's own controls with the keyboard: if one of them closes the
          // dialog, the keyboard user is not trapped.
          const closedByControl = await this.closeDialogFromKeyboard(page, modal.selector);
          if (!closedByControl) {
            violations.push({
              criterion: '9.2.1.2',
              element: modal.label,
              issue: 'keyboard-trap',
              description:
                'Focus cannot leave this dialog: Tab stays inside, Escape does not close it, and neither Enter nor Space on any of its own controls closes it',
              severity: 'serious',
              keySequence: ['Tab', 'Escape', 'Enter and Space on each control'],
              suggestion:
                'Provide Escape key handler or visible close button accessible via keyboard',
            });
            traps++;
          }
        }
      }
    }

    await page
      .evaluate(() => {
        document
          .querySelectorAll('[data-a11y-modal]')
          .forEach((el) => el.removeAttribute('data-a11y-modal'));
      })
      .catch(() => {});

    return { traps };
  }

  /**
   * Activate each control inside a dialog from the keyboard and report whether
   * one of them closes it. The second escape route for SC 2.1.2, so that a
   * dialog with a close control is not reported as a trap just because it
   * ignores Escape.
   * Both Enter and Space are tried on every candidate, because a `role="button"`
   * is activated by either, and the candidate list includes `<a>` elements
   * without an href: a close control written that way is what many dialogs
   * ship, and missing it makes the dialog look inescapable.
   * @param {import('puppeteer').Page} page
   * @param {string} modalSelector marker selector of the dialog
   * @returns {Promise<boolean>} true when the dialog is gone afterwards
   */
  async closeDialogFromKeyboard(page, modalSelector) {
    const candidatesCode = `
      function __closeCandidates(modal) {
        var all = [].slice.call(modal.querySelectorAll('*'));
        var out = [];
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (!__isRendered(el)) continue;
          var isBareAnchor = el.tagName === 'A' && !el.hasAttribute('href');
          if (__isFocusableRendered(el) || isBareAnchor) out.push(el);
        }
        return out;
      }
    `;

    const controlCount = await page.evaluate(
      (renderedHelpers, candidates, sel) => {
        eval(renderedHelpers);
        eval(candidates);
        const modal = document.querySelector(sel);
        if (!modal) return 0;
        return __closeCandidates(modal).length;
      },
      renderedCode,
      candidatesCode,
      modalSelector
    );

    for (let i = 0; i < Math.min(controlCount, 8); i++) {
      // An <a> without href takes no focus of its own, so it is given a
      // programmatic focus stop for the duration of the probe.
      const focused = await page.evaluate(
        (renderedHelpers, candidates, sel, index) => {
          eval(renderedHelpers);
          eval(candidates);
          const modal = document.querySelector(sel);
          if (!modal) return false;
          const controls = __closeCandidates(modal);
          const el = controls[index];
          if (!el) return false;
          if (!el.hasAttribute('tabindex')) {
            el.setAttribute('tabindex', '-1');
            el.setAttribute('data-a11y-temp-tabindex', '1');
          }
          el.focus();
          return document.activeElement === el;
        },
        renderedCode,
        candidatesCode,
        modalSelector,
        i
      );
      if (!focused) continue;

      for (const key of ['Enter', ' ']) {
        await page.keyboard.press(key);
        await new Promise((resolve) => setTimeout(resolve, 200));

        const gone = await page
          .evaluate(
            (renderedHelpers, sel) => {
              eval(renderedHelpers);
              const modal = document.querySelector(sel);
              return !modal || !__isRendered(modal);
            },
            renderedCode,
            modalSelector
          )
          .catch(() => true);
        if (gone) {
          await this.clearTempTabindex(page);
          return true;
        }
      }
    }
    await this.clearTempTabindex(page);
    return false;
  }

  /** Removes the focus stops closeDialogFromKeyboard added to bare anchors. */
  async clearTempTabindex(page) {
    await page
      .evaluate(() => {
        document.querySelectorAll('[data-a11y-temp-tabindex]').forEach((el) => {
          el.removeAttribute('tabindex');
          el.removeAttribute('data-a11y-temp-tabindex');
        });
      })
      .catch(() => {});
  }

  /**
   * Click targets the keyboard cannot reach (SC 2.1.1).
   * A candidate has to carry a click handler of its own (an inline `onclick`
   * attribute or a function in the `onclick` property), be painted, and offer
   * no keyboard route at all: it is not an interactive target itself, nothing
   * focusable sits inside it, and no interactive ancestor already exposes the
   * same click. Class names and `cursor: pointer` decide nothing, because a
   * `<span class="btn">` inside a link and a `<td style="cursor:pointer">` in
   * a sortable table are both operable from the keyboard.
   */
  async testCustomControls(page, violations) {
    log.debug('Testing custom interactive controls...');

    const customControls = await page.evaluate((renderedHelpers) => {
      eval(renderedHelpers);
      const controls = [];

      function getSelector(element) {
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '') + className;
      }

      for (const el of document.querySelectorAll('*')) {
        const hasClickHandler = el.hasAttribute('onclick') || typeof el.onclick === 'function';
        if (!hasClickHandler) continue;
        if (!__isRendered(el)) continue;
        if (__isInteractiveTarget(el)) continue;
        // The keyboard reaches the same click through a control inside it
        // (a card wrapper around a link) or around it (a label for a radio).
        if ([...el.querySelectorAll('*')].some(__isFocusableRendered)) continue;
        if (el.parentElement && el.parentElement.closest('a[href], button, label, [tabindex]')) {
          continue;
        }

        controls.push({
          selector: getSelector(el),
          text: (el.textContent || '').trim().substring(0, 30),
        });
      }

      return controls;
    }, renderedCode);

    log.debug(`  Found ${customControls.length} click targets without a keyboard route`);

    for (const control of customControls) {
      violations.push({
        criterion: '9.2.1.1',
        element: control.selector,
        issue: 'not-keyboard-accessible',
        description: `Element "${control.text}" has a click handler but cannot be focused, holds nothing focusable and has no interactive ancestor, so its action is mouse only`,
        severity: 'serious',
        suggestion:
          "Use a button or link, or add tabindex='0', a role and keyboard event handlers (Enter/Space)",
      });
    }

    return { inaccessible: customControls.length };
  }

  /**
   * Single character key shortcuts (SC 2.1.4).
   * Presses printable keys with focus on the document body and reports the
   * ones the page acts on: it cancels the event, changes the DOM, logs, or
   * navigates. Modifier combinations are out of scope of 2.1.4, and a shortcut
   * that is only active while a component has focus is exempt, which is why
   * this probe runs with focus on the body and never inside a widget.
   * Pages that mutate on their own (carousels, clocks) are calibrated out with
   * an idle measurement taken first.
   */
  async testKeyboardShortcuts(page, violations) {
    log.debug('Testing single character key shortcuts...');

    // Keys that pages bind most often: feed and list navigation, mail actions,
    // view toggles, search.
    const PROBE_KEYS = ['j', 'k', 'n', 'p', 's', 'd', 'r', 'f', 'e', 'm', 't', 'g', 'c', '/', '?'];

    let consoleSeen = false;
    const onConsole = () => {
      consoleSeen = true;
    };
    page.on('console', onConsole);

    const installed = await page
      .evaluate(() => {
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
        if (window.__a11yKeyProbe) return true;
        const probe = { mutations: 0, prevented: false, href: location.href };
        window.__a11yKeyProbe = probe;
        const observer = new MutationObserver((records) => {
          probe.mutations += records.length;
        });
        // childList and characterData only: an attribute write is how a page
        // animates, lazy-loads and marks its own state, so counting it would
        // attribute ordinary page activity to the key press.
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        window.__a11yKeyProbeObserver = observer;
        window.addEventListener(
          'keydown',
          (e) => {
            if (e.defaultPrevented) probe.prevented = true;
          },
          false
        );
        return true;
      })
      .catch(() => false);

    if (!installed) {
      page.off('console', onConsole);
      return { conflicts: 0 };
    }

    const read = async () =>
      page.evaluate(() => {
        const probe = window.__a11yKeyProbe;
        const out = {
          mutations: probe.mutations,
          prevented: probe.prevented,
          navigated: probe.href !== location.href,
        };
        probe.mutations = 0;
        probe.prevented = false;
        return out;
      });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

    // Idle baseline: what does this page do when no key is pressed? Two
    // windows, because a carousel or a poller can sit still through one of
    // them. A single mutation in either window makes the page too noisy for
    // this probe to attribute anything to a key press, so it reports nothing.
    let noisy = false;
    for (let i = 0; i < 2; i++) {
      await read();
      consoleSeen = false;
      await settle();
      const idle = await read();
      if (idle.mutations > 0 || consoleSeen) noisy = true;
    }
    if (noisy) {
      log.debug('  Page mutates on its own; the shortcut probe cannot attribute a change');
      page.off('console', onConsole);
      await page
        .evaluate(() => {
          if (window.__a11yKeyProbeObserver) window.__a11yKeyProbeObserver.disconnect();
          delete window.__a11yKeyProbeObserver;
          delete window.__a11yKeyProbe;
        })
        .catch(() => {});
      return { conflicts: 0 };
    }

    const handledKeys = [];
    try {
      for (const key of PROBE_KEYS) {
        consoleSeen = false;
        await read();
        await page.keyboard.press(key);
        await settle();
        const after = await read();
        // A change the page would not have made without the key press. Both
        // idle windows were still, so a change now came from the key.
        const acted = after.prevented || after.navigated || after.mutations > 0 || consoleSeen;
        if (acted) handledKeys.push(key);
        if (after.navigated) break; // the page under test is gone
      }
    } catch (error) {
      log.warn('Error probing single character shortcuts:', error.message);
    } finally {
      page.off('console', onConsole);
      await page
        .evaluate(() => {
          if (window.__a11yKeyProbeObserver) window.__a11yKeyProbeObserver.disconnect();
          delete window.__a11yKeyProbeObserver;
          delete window.__a11yKeyProbe;
        })
        .catch(() => {});
    }

    if (handledKeys.length === 0) return { conflicts: 0 };

    // 2.1.4 is met when the shortcuts can be turned off or remapped. A control
    // that names the shortcuts is that mechanism.
    const hasMechanism = await page.evaluate(
      (accnameCode, renderedHelpers) => {
        eval(accnameCode);
        eval(renderedHelpers);
        const pattern = /shortcut|hotkey|tastenk|tastatur|keyboard key/i;
        for (const el of document.querySelectorAll(
          'input, select, textarea, button, [role="button"], [role="switch"], [role="checkbox"], a[href]'
        )) {
          if (!__isRendered(el)) continue;
          const name = __accessibleName(el) || '';
          const described = el.closest('label, fieldset, section, form');
          if (pattern.test(name) || (described && pattern.test(described.textContent || ''))) {
            return true;
          }
        }
        return false;
      },
      accnameUtils,
      renderedCode
    );

    if (hasMechanism) {
      log.debug('  Single character shortcuts found, but the page offers a control for them');
      return { conflicts: 0 };
    }

    violations.push({
      criterion: '9.2.1.4',
      element: 'document',
      issue: 'character-key-shortcut',
      description: `Pressing ${handledKeys.map((k) => `"${k}"`).join(', ')} with no modifier and focus on the page body triggers page behaviour, and the page offers no control to turn the shortcuts off or remap them`,
      severity: 'serious',
      keySequence: handledKeys,
      suggestion:
        'Require a modifier key, activate the shortcut only while its component has focus, or offer a setting to turn it off or remap it',
    });

    return { conflicts: handledKeys.length };
  }

  // CSP-independent keyboard checks (no script injection)

  /**
   * Focusable elements.
   * Two outcomes. An interactive control the keyboard cannot reach at all is a
   * 2.1.1 violation, but only when no other route reaches the same function:
   * items of a composite widget (menu items, options, tabs, tree items) are
   * exempt, because the ARIA authoring practices give them `tabindex="-1"` and
   * move focus with the arrow keys.
   * A `tabindex="0"` element with no role and no name removes no functionality
   * from a keyboard user, so it fails no 2.1.1 clause. Whether it is an unnamed
   * control (4.1.2) or an intentional focus target cannot be decided from the
   * page, so it becomes a needs-review question with the element's markup.
   * Positive tabindex is not reported here; focus-management measures whether
   * the tab order actually leaves the document order (SC 2.4.3).
   */
  async validateFocusableElements(page, violations, needsReview = []) {
    log.debug('Validating focusable elements...');

    const focusableIssues = await page.evaluate((injectedCode) => {
      eval(injectedCode);

      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const issues = [];
      const COMPOSITE_ITEM_ROLES = [
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'option',
        'tab',
        'treeitem',
        'gridcell',
        'row',
        'radio',
      ];

      const interactiveElements = document.querySelectorAll(
        [
          'button',
          'a[href]',
          'input',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="switch"]',
        ].join(', ')
      );

      interactiveElements.forEach((element) => {
        if (element.tabIndex >= 0) return;
        if (!__isRendered(element)) return;
        if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
          return;
        }
        // Arrow-key operated item of a composite widget.
        const role = (element.getAttribute('role') || '').trim();
        if (COMPOSITE_ITEM_ROLES.includes(role)) return;
        if (isRovingTabindexItem(element)) return;
        // A programmatic focus target inside a control that already carries
        // the same action (the chevron inside a card link).
        if (
          element.parentElement &&
          element.parentElement.closest('a[href], button, [role="button"]')
        ) {
          return;
        }
        // A second link to the same page, the pattern every teaser card uses:
        // the image link is taken out of the tab order and the headline link
        // beside it leads to the same place, so nothing is unreachable.
        if (element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) {
          const href = element.getAttribute('href');
          const twin = [...document.querySelectorAll('a[href]')].some(
            (other) =>
              other !== element &&
              other.getAttribute('href') === href &&
              other.tabIndex >= 0 &&
              __isRendered(other)
          );
          if (twin) return;
        }

        issues.push({
          kind: 'unreachable',
          type: 'focusable-element',
          element: getElementSelector(element),
          description:
            'Interactive element is removed from the tab order (tabindex="-1") and is not part of an arrow-key operated widget, so the keyboard cannot reach it',
          severity: 'serious',
          suggestion: 'Ensure interactive elements are keyboard accessible',
        });
      });

      // Plain elements put into the tab order with nothing to operate and
      // nothing to announce. A scroll container is exempt: the stop is what
      // makes it scrollable by keyboard.
      const nonInteractiveWithTabindex = document.querySelectorAll(
        '[tabindex="0"]:not(button):not(a):not(input):not(textarea):not(select):not(summary)'
      );

      nonInteractiveWithTabindex.forEach((element) => {
        if (!__isRendered(element)) return;
        if (__isInteractiveTarget(element) && element.hasAttribute('role')) return;
        if (element.isContentEditable) return;

        // An accessible name is what makes a focus stop meaningful: a named
        // region used as a route change target, a labelled tabpanel, a
        // figure a screen reader announces when focus lands on it.
        if (__accessibleName(element)) return;

        const style = window.getComputedStyle(element);
        const isScrollable =
          (style.overflowY === 'auto' ||
            style.overflowY === 'scroll' ||
            style.overflowX === 'auto' ||
            style.overflowX === 'scroll') &&
          (element.scrollHeight > element.clientHeight ||
            element.scrollWidth > element.clientWidth);
        if (isScrollable) return;

        issues.push({
          kind: 'unnamed-stop',
          type: 'focus-stop-without-name',
          element: getElementSelector(element),
          html: element.outerHTML.slice(0, 300),
          role: element.getAttribute('role') || '',
          name: '',
          hasClickHandler: element.hasAttribute('onclick') || typeof element.onclick === 'function',
          textLength: (element.textContent || '').trim().length,
          description:
            'Element is in the tab order with tabindex="0" but has no role and no accessible name, so it cannot be decided from the page whether it is an unnamed control',
        });
      });

      return issues;
    }, `${renderedCode}\n${accnameUtils}\n${rovingTabindexCode}`);

    for (const issue of focusableIssues) {
      if (issue.kind === 'unnamed-stop') {
        // 4.1.2, not the scanner's own 2.1.1: the question is whether this is a
        // control that lacks a name, not whether a function is unreachable.
        const question = this.formatViolation(
          'focus-stop-without-name',
          'minor',
          issue.description,
          [{ selector: issue.element, html: issue.html }],
          'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
          'info',
          {
            verdict: 'needs-review',
            dossier: {
              question: `Is ${issue.element} a control, and if so what is its name?`,
              element: {
                selector: issue.element,
                html: issue.html,
                role: issue.role || null,
                name: issue.name || null,
              },
              measurements: {
                tabindex: 0,
                hasRole: Boolean(issue.role),
                hasAccessibleName: Boolean(issue.name),
                hasClickHandler: issue.hasClickHandler,
                textLength: issue.textLength,
              },
              context: { criterion: '4.1.2' },
            },
          }
        );
        question.wcagCriteria = ['4.1.2'];
        needsReview.push(question);
        continue;
      }
      violations.push({
        criterion: '9.2.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    }
  }
}

module.exports = KeyboardNavigationScanner;
