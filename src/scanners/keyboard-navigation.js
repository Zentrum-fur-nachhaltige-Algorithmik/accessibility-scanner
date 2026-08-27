/**
 * Keyboard Navigation Scanner.
 * WCAG 2.1.1, 2.1.2, 2.1.4 (EN 301 549 9.2.1.1, 9.2.1.2, 9.2.1.4).
 * Drives real Tab presses through the page and analyses focus order, traps and shortcuts.
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

    // 1b. Scrollable containers that no keyboard can scroll (WCAG 2.1.1).
    // A container fails only when it is painted, when it really does hide
    // content (a rounding pixel is not hidden content), and when neither it
    // nor anything inside it can take focus, so no key press reaches the
    // scroller. Chrome scrolls a focused container with the arrow keys.
    const scrollableViolations = await page.evaluate((renderedHelpers) => {
      eval(renderedHelpers);
      const issues = [];
      const MIN_HIDDEN_PX = 24;

      function getSelector(el) {
        const className =
          el.className && typeof el.className === 'string'
            ? el.className
            : el.className && el.className.baseVal
              ? el.className.baseVal
              : '';
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (className ? `.${className.split(' ')[0]}` : '')
        );
      }

      for (const el of document.querySelectorAll('*')) {
        const style = window.getComputedStyle(el);

        const hiddenY =
          style.overflowY === 'auto' || style.overflowY === 'scroll'
            ? el.scrollHeight - el.clientHeight
            : 0;
        const hiddenX =
          style.overflowX === 'auto' || style.overflowX === 'scroll'
            ? el.scrollWidth - el.clientWidth
            : 0;
        if (hiddenY < MIN_HIDDEN_PX && hiddenX < MIN_HIDDEN_PX) continue;

        if (!__isRendered(el)) continue;
        // The container itself takes focus (tabindex, contenteditable, a
        // native control), so the arrow keys already scroll it.
        if (__isFocusable(el)) continue;
        // Focus can land inside it, and focusing a child scrolls it into view.
        if ([...el.querySelectorAll('*')].some(__isFocusableRendered)) continue;

        issues.push({
          element: getSelector(el),
          scrollableAxis:
            hiddenY >= MIN_HIDDEN_PX && hiddenX >= MIN_HIDDEN_PX
              ? 'both'
              : hiddenY >= MIN_HIDDEN_PX
                ? 'vertical'
                : 'horizontal',
          hiddenPx: Math.max(hiddenY, hiddenX),
        });
      }

      return issues;
    }, renderedCode);

    for (const sv of scrollableViolations) {
      violations.push({
        criterion: '9.2.1.1',
        element: sv.element,
        issue: 'scrollable-content-not-keyboard-accessible',
        description: `Scrollable container (${sv.scrollableAxis} overflow) hides ${Math.round(sv.hiddenPx)}px of content, cannot take focus and holds nothing focusable, so a keyboard cannot scroll it.`,
        severity: 'moderate',
        suggestion:
          'Add tabindex="0" and an accessible role/label to make the scrollable region keyboard-navigable.',
      });
      keyboardInaccessible++;
    }

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

    // Group 1: Skip Links and Bypass Mechanisms (replaces axe: skip-link, bypass)
    await this.validateSkipLinks(page, violations);

    // Group 2: Focusable Elements and Tab Order (replaces axe: focusable-element, focus-order-semantics)
    await this.validateFocusableElements(page, violations);

    // Group 4: Accesskey Management (replaces axe: accesskeys)
    await this.validateAccesskeys(page, violations);

    // Calculate summary
    tabbableElements = tabOrder.length;
    keyboardInaccessible = violations.filter((v) => v.issue === 'not-keyboard-accessible').length;

    return {
      violations,
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

    violations.push({
      criterion: '9.2.1.2',
      element: step.selector,
      issue: 'keyboard-trap',
      description:
        'Focus stays on this element through four Tab presses and a Shift+Tab, so the keyboard cannot leave it',
      severity: 'serious',
      keySequence: ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab'],
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
                'Focus cannot leave this dialog: Tab stays inside, Escape does not close it, and none of its own controls closes it from the keyboard',
              severity: 'serious',
              keySequence: ['Tab', 'Escape', 'Enter on each control'],
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
   * Press Enter on each keyboard reachable control inside a dialog and report
   * whether one of them closes it. Used as the second escape route for SC
   * 2.1.2, so that a dialog with a reachable close button is not reported as a
   * trap just because it ignores Escape.
   * @param {import('puppeteer').Page} page
   * @param {string} modalSelector marker selector of the dialog
   * @returns {Promise<boolean>} true when the dialog is gone afterwards
   */
  async closeDialogFromKeyboard(page, modalSelector) {
    const controlCount = await page.evaluate(
      (renderedHelpers, sel) => {
        eval(renderedHelpers);
        const modal = document.querySelector(sel);
        if (!modal) return 0;
        return [...modal.querySelectorAll('*')].filter(__isFocusableRendered).length;
      },
      renderedCode,
      modalSelector
    );

    for (let i = 0; i < Math.min(controlCount, 8); i++) {
      const focused = await page.evaluate(
        (renderedHelpers, sel, index) => {
          eval(renderedHelpers);
          const modal = document.querySelector(sel);
          if (!modal) return false;
          const controls = [...modal.querySelectorAll('*')].filter(__isFocusableRendered);
          if (!controls[index]) return false;
          controls[index].focus();
          return document.activeElement === controls[index];
        },
        renderedCode,
        modalSelector,
        i
      );
      if (!focused) continue;

      await page.keyboard.press('Enter');
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
      if (gone) return true;
    }
    return false;
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
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
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

    // Idle baseline: what does this page do when no key is pressed?
    await read();
    consoleSeen = false;
    await settle();
    const idle = await read();
    const noisy = idle.mutations > 0 || consoleSeen;

    const handledKeys = [];
    try {
      for (const key of PROBE_KEYS) {
        consoleSeen = false;
        await read();
        await page.keyboard.press(key);
        await settle();
        const after = await read();
        const acted =
          after.prevented || after.navigated || (!noisy && (after.mutations > 0 || consoleSeen));
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
   * Validate skip links (replaces axe: skip-link)
   */
  async validateSkipLinks(page, violations) {
    log.debug('Validating skip links...');

    const skipLinkIssues = await page.evaluate(() => {
      // Helper function for element selector generation (browser context)
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

      // A skip link moves focus within the same document, so only a fragment
      // link can be one. A link to another page whose path happens to contain
      // "skip" or "content" is ordinary navigation.
      const potentialSkipLinks = Array.from(document.querySelectorAll('a[href^="#"]')).filter(
        (link) => {
          const href = link.getAttribute('href') || '';
          const text = link.textContent.trim().toLowerCase();
          return (
            /skip|jump|bypass|springe|zum inhalt|direkt zum/.test(text) ||
            /^#(main|content|maincontent|main-content|inhalt)/i.test(href)
          );
        }
      );

      potentialSkipLinks.forEach((link) => {
        const href = link.getAttribute('href');
        const selector = getElementSelector(link);

        // Check if target exists. `#top` and an empty fragment are defined by
        // HTML as the top of the document, and a named anchor is a target too.
        const targetId = decodeURIComponent(href.slice(1));
        const target =
          targetId === '' ||
          targetId.toLowerCase() === 'top' ||
          document.getElementById(targetId) ||
          document.querySelector(`a[name="${CSS.escape(targetId)}"]`);

        if (!target) {
          issues.push({
            type: 'skip-link',
            element: selector,
            href: href,
            description: `Skip link points to non-existent target: ${href}`,
            severity: 'serious',
            suggestion: 'Ensure skip link target exists and is accessible',
          });
        }
      });

      return issues;
    });

    // Create violations for skip link issues
    skipLinkIssues.forEach((issue) => {
      violations.push({
        criterion: '9.2.4.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Focusable elements (SC 2.1.1).
   * Two findings: an interactive control the keyboard cannot reach at all, and
   * a plain element put into the tab order without anything to operate.
   * Items of a composite widget (menu items, options, tabs, tree items) are
   * exempt from the first: the ARIA authoring practices give them
   * `tabindex="-1"` and move focus with the arrow keys.
   * Positive tabindex is not reported here; focus-management measures whether
   * the tab order actually leaves the document order (SC 2.4.3).
   */
  async validateFocusableElements(page, violations) {
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

        issues.push({
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
          type: 'focusable-element',
          element: getElementSelector(element),
          description:
            'Element is in the tab order with tabindex="0" but has no role, no accessible name and nothing to operate, so focus stops on it for no reason',
          severity: 'minor',
          suggestion: 'Only make interactive elements focusable, or add a role and a name',
        });
      });

      return issues;
    }, `${renderedCode}\n${accnameUtils}\n${rovingTabindexCode}`);

    // Create violations for focusable element issues
    focusableIssues.forEach((issue) => {
      violations.push({
        criterion: '9.2.1.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }

  /**
   * Validate accesskeys (replaces axe: accesskeys)
   */
  async validateAccesskeys(page, violations) {
    log.debug('Validating accesskeys...');

    const accesskeyIssues = await page.evaluate((injectedCode) => {
      eval(injectedCode);
      // Helper function for element selector generation (browser context)
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
      const accesskeys = {};
      const duplicates = {};

      // Find all elements with accesskey
      const elementsWithAccesskey = document.querySelectorAll('[accesskey]');

      elementsWithAccesskey.forEach((element) => {
        const selector = getElementSelector(element);
        const accesskey = element.getAttribute('accesskey').toLowerCase();

        // One finding per key that more than one element claims: the browser
        // can only reach one of them, and naming both elements is enough.
        if (accesskeys[accesskey]) {
          duplicates[accesskey] = duplicates[accesskey] || {
            first: accesskeys[accesskey],
            others: [],
          };
          duplicates[accesskey].others.push(selector);
        } else {
          accesskeys[accesskey] = selector;
        }

        // An accesskey on something the keyboard cannot focus reaches nothing.
        // `label` and `legend` are the exception: the browser forwards their
        // accesskey to the control they belong to.
        const tag = element.tagName.toLowerCase();
        const forwards = tag === 'label' || tag === 'legend';
        if (__isRendered(element) && !forwards && !__isInteractiveTarget(element)) {
          issues.push({
            type: 'accesskeys',
            element: selector,
            accesskey: accesskey,
            description: 'Element with accesskey is not keyboard focusable',
            severity: 'moderate',
            suggestion: 'Ensure elements with accesskeys are also focusable via keyboard',
          });
        }
      });

      for (const [key, group] of Object.entries(duplicates)) {
        issues.push({
          type: 'accesskeys',
          element: group.first,
          accesskey: key,
          description: `Accesskey "${key}" is claimed by ${group.others.length + 1} elements (${[group.first, ...group.others].join(', ')}), so it reaches only one of them`,
          severity: 'serious',
          occurrences: group.others.length + 1,
          affectedElements: [group.first, ...group.others],
          suggestion: 'Ensure each accesskey is unique on the page',
        });
      }

      return issues;
    }, renderedCode);

    // Create violations for accesskey issues
    accesskeyIssues.forEach((issue) => {
      violations.push({
        criterion: '9.2.1.4',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    });
  }
}

module.exports = KeyboardNavigationScanner;
