/**
 * Input Modalities Scanner.
 * WCAG 2.5.1, 2.5.2, 2.5.4, 2.5.7, 2.5.8 (EN 301 549 9.2.5.x).
 * Tests pointer gestures, pointer cancellation, motion actuation, dragging
 * alternatives and target size. SC 2.5.3 belongs to the label-in-name scanner.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');
const log = require('../utils/logger').createLogger('input-modalities');

class InputModalitiesScanner extends BaseScanner {
  constructor() {
    super('input-modalities', {
      wcagCriteria: ['2.5.1', '2.5.2', '2.5.4', '2.5.7', '2.5.8'],
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
      testPointerGestures: true,
      testMotionActuation: true,
      ...options,
    };

    const screenshotDir = options.screenshotDir || this.screenshotDir;
    await fs.ensureDir(screenshotDir);

    const timestamp = Date.now();
    const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    const inputResults = await this.performInputModalitiesAnalysis(page, scanDir, scanOptions);

    return {
      scannerId: this.id,
      criteria: ['9.2.5.1', '9.2.5.2', '9.2.5.4', '9.2.5.7', '9.2.5.8'],
      passed: inputResults.violations.length === 0,
      violations: inputResults.violations,
      summary: {
        pointerGesturesAccessible: inputResults.pointerGesturesAccessible,
        pointerCancellationAvailable: inputResults.pointerCancellationAvailable,
        motionAlternativesProvided: inputResults.motionAlternativesProvided,
        draggingAlternativesProvided: inputResults.draggingAlternativesProvided,
        targetSizingAdequate: inputResults.targetSizingAdequate,
      },
      screenshotPath: scanDir,
      visualEvidence: inputResults.visualEvidence,
    };
  }

  /**
   * Perform comprehensive input modalities analysis
   */
  async performInputModalitiesAnalysis(page, scanDir, options) {
    const violations = [];
    const visualEvidence = [];
    let pointerGesturesAccessible = true;
    let pointerCancellationAvailable = true;
    let motionAlternativesProvided = true;
    let draggingAlternativesProvided = true;
    let targetSizingAdequate = true;

    log.debug('Starting input modalities analysis...');

    // Take initial screenshot
    const initialScreenshot = path.join(scanDir, 'input-modalities-analysis.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });

    // 1. Test pointer gestures (WCAG 2.5.1)
    if (options.testPointerGestures) {
      const gestureResults = await this.analyzePointerGestures(page, violations);
      pointerGesturesAccessible = gestureResults.accessible;
    }

    // 2. Test target size minimum (WCAG 2.5.8)
    const targetSizeResults = await this.analyzeTargetSize(page, violations);
    targetSizingAdequate = targetSizeResults.adequate;

    // 3. Test dragging movements (WCAG 2.5.7)
    const draggingResults = await this.analyzeDraggingMovements(page, violations);
    draggingAlternativesProvided = draggingResults.alternativesProvided;

    // The two probes below dispatch events at the page and can leave it
    // changed, so every read-only measurement above runs first.

    // 4. Test motion actuation (WCAG 2.5.4)
    if (options.testMotionActuation) {
      const motionResults = await this.analyzeMotionActuation(page, violations);
      motionAlternativesProvided = motionResults.alternativesProvided;
    }

    // 5. Test pointer cancellation (WCAG 2.5.2)
    const cancellationResults = await this.analyzePointerCancellation(page, violations);
    pointerCancellationAvailable = cancellationResults.available;

    // Generate visual evidence
    visualEvidence.push({
      type: 'input-modalities',
      screenshot: path.basename(initialScreenshot),
      gesturesAccessible: pointerGesturesAccessible,
      cancellationAvailable: pointerCancellationAvailable,
      motionAlternatives: motionAlternativesProvided,
      draggingAlternatives: draggingAlternativesProvided,
      targetSizingAdequate,
    });

    log.debug(`Input modalities analysis complete: ${violations.length} violations found`);

    return {
      violations,
      visualEvidence,
      pointerGesturesAccessible,
      pointerCancellationAvailable,
      motionAlternativesProvided,
      draggingAlternativesProvided,
      targetSizingAdequate,
    };
  }

  /**
   * Analyze pointer gestures (WCAG 2.5.1).
   *
   * The gesture is taken from the platform API the element declares, never from
   * a caption: a WebKit `ongesture*` handler, a touchstart / touchmove /
   * touchend trio that tracks a path, or a touch handler whose body reads the
   * multipoint part of the Touch API (`touches[1]`, `touches.length` compared
   * with two or more). A lone `ontouchstart` is the ordinary way to make a tap
   * responsive, and `draggable` is 2.5.7, which is measured separately.
   *
   * The element passes when a control that does the same job with one pointer
   * is rendered and exposed to assistive technology: in the element, in the
   * container that holds it, or bound to it with `aria-controls`. A control
   * inside an `aria-hidden` subtree is not an alternative.
   */
  async analyzePointerGestures(page, violations) {
    log.debug('Analyzing pointer gestures...');

    const gestureAnalysis = await page.evaluate((renderedSrc) => {
      eval(renderedSrc);
      const issues = [];
      let accessible = true;

      // A second touch point, which is what separates a multipoint gesture from
      // the ordinary tap: touches[1] and up, or a length compared with a number
      // that only two or more touches satisfy.
      const MULTIPOINT =
        /(?:changedT|t)ouches\s*(?:\[\s*[1-9]|\.\s*length\s*(?:>\s*=?\s*[1-9]|===?\s*[2-9]))/;
      const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];

      const declares = (el, name) =>
        el.hasAttribute(`on${name}`) || typeof el[`on${name}`] === 'function';
      /**
       * The handler body. An `on...` attribute is a one-line call into a named
       * function, so that function is resolved and its source used instead.
       */
      const sourceOf = (el, name) => {
        const handler = el[`on${name}`];
        let source = typeof handler === 'function' ? handler.toString() : '';
        const called = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/.exec(
          el.getAttribute(`on${name}`) || ''
        );
        if (called && typeof window[called[1]] === 'function') {
          source += `\n${window[called[1]].toString()}`;
        }
        return source;
      };

      /** A rendered control exposed to assistive technology, in or around the element. */
      const exposed = (el) =>
        el && __isRendered(el) && __isInteractiveTarget(el) && !el.closest('[aria-hidden="true"]');
      const hasSinglePointerAlternative = (el) => {
        if (el.onclick || el.hasAttribute('onclick') || __isInteractiveTarget(el)) return true;
        if (Array.from(el.querySelectorAll('*')).some(exposed)) return true;
        if (el.id) {
          const bound = document.querySelector(`[aria-controls~="${CSS.escape(el.id)}"]`);
          if (exposed(bound)) return true;
        }
        const parent = el.parentElement;
        if (!parent) return false;
        return Array.from(parent.querySelectorAll('*')).some((c) => !el.contains(c) && exposed(c));
      };

      const candidates = new Set();
      document
        .querySelectorAll(
          '[ongesturestart], [ongesturechange], [ongestureend], [ontouchstart], [ontouchmove], [ontouchend]'
        )
        .forEach((el) => candidates.add(el));
      document.querySelectorAll('body *').forEach((el) => {
        if (TOUCH_EVENTS.some((name) => typeof el[`on${name}`] === 'function')) candidates.add(el);
        if (typeof el.ongesturestart === 'function') candidates.add(el);
      });

      for (const element of candidates) {
        if (!__isRendered(element)) continue;

        const webkitGesture =
          declares(element, 'gesturestart') ||
          declares(element, 'gesturechange') ||
          declares(element, 'gestureend');
        const path =
          declares(element, 'touchstart') &&
          declares(element, 'touchmove') &&
          (declares(element, 'touchend') || declares(element, 'touchcancel'));
        const multipoint = TOUCH_EVENTS.some((name) => MULTIPOINT.test(sourceOf(element, name)));

        if (!webkitGesture && !path && !multipoint) continue;
        if (hasSinglePointerAlternative(element)) continue;

        // SVG/MathML elements expose className as an SVGAnimatedString, not a string
        const className = typeof element.className === 'string' ? element.className : '';
        issues.push({
          type: 'complex-gesture-only',
          element:
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : '') +
            (className ? `.${className.trim().split(/\s+/)[0]}` : ''),
          description: multipoint
            ? 'Element handles a multipoint gesture and no control that is exposed to assistive technology does the same with a single pointer'
            : 'Element tracks a path-based gesture and no control that is exposed to assistive technology does the same with a single pointer',
          severity: 'error',
        });
        accessible = false;
      }

      return { issues, accessible };
    }, renderedCode);

    gestureAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.2.5.1',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getGestureSuggestion(issue.type),
      });
    });

    return { accessible: gestureAnalysis.accessible };
  }

  /**
   * Analyze pointer cancellation (WCAG 2.5.2) by pressing and aborting.
   *
   * Each rendered target receives a pointerdown; the press is then aborted
   * (pointercancel, mouseleave, and a pointerup outside the element), which is
   * what a user does when they change their mind. Two observations decide the
   * verdict: whether the down-event changed the page or opened a dialog at
   * all, and whether the abort changed it again. A page that reacts to the
   * abort has implemented the Abort or Undo clause, which is how the pressed
   * state and the "moving away cancels" hint of a correct control differ from
   * a function that ran on the down-event and stays.
   *
   * Pages that repaint on their own (clocks, carousels, tickers) are measured
   * once with no interaction first; when that idle baseline already changes
   * the DOM, the probe cannot attribute a change to the press and is skipped.
   */
  async analyzePointerCancellation(page, violations) {
    log.debug('Analyzing pointer cancellation...');

    const cancellationAnalysis = await page.evaluate(
      async (renderedSrc, maxTargets) => {
        eval(renderedSrc);
        const issues = [];
        let available = true;

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let dialogCalls = 0;
        // The page without the pressed control itself. 2.5.2 allows the
        // down-event to show that the control is pressed, so a change confined
        // to the target's own markup (a `pressed` or `dragging` class) is
        // feedback, not a function that ran.
        const fingerprint = (el) =>
          `${document.body.innerHTML.length - (el ? el.outerHTML.length : 0)}|${document.querySelectorAll('*').length}|${location.href}|${dialogCalls}`;

        // alert()/confirm()/prompt() block the renderer; recording the call is
        // the observation this probe needs and never stalls the page.
        const nativeDialogs = {
          alert: window.alert,
          confirm: window.confirm,
          prompt: window.prompt,
        };
        window.alert = () => {
          dialogCalls++;
        };
        window.confirm = () => {
          dialogCalls++;
          return false;
        };
        window.prompt = () => {
          dialogCalls++;
          return null;
        };

        try {
          // Idle calibration: a page that rewrites itself on a timer cannot be
          // measured this way.
          const idleBefore = fingerprint(null);
          await wait(150);
          if (fingerprint(null) !== idleBefore) {
            return { issues, available, skipped: 'page mutates on its own' };
          }

          const candidates = [];
          document
            .querySelectorAll(
              'button, [role="button"], a[href], input[type="button"], input[type="submit"], input[type="reset"], [onmousedown], [onpointerdown], [ontouchstart]'
            )
            .forEach((el) => {
              if (candidates.length >= maxTargets) return;
              if (!__isInteractiveTarget(el) || !__isRendered(el)) return;
              const tag = el.tagName.toLowerCase();
              // Typing and choosing controls are operated by their own UI, not
              // by a down-event activation.
              if (tag === 'textarea' || tag === 'select') return;
              if (tag === 'input' && !['button', 'submit', 'reset'].includes(el.type)) return;
              candidates.push(el);
            });

          for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const before = fingerprint(el);

            const pointerInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: x,
              clientY: y,
            };
            el.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
            el.dispatchEvent(new MouseEvent('mousedown', pointerInit));
            await wait(60);
            const afterDown = fingerprint(el);
            if (afterDown === before) continue; // the down-event did nothing

            // Abort the press: the pointer leaves the target and is released
            // somewhere else. A control that implements Abort or Undo reacts
            // to that; one that already ran its function does not.
            el.dispatchEvent(
              new PointerEvent('pointermove', { ...pointerInit, clientX: 0, clientY: 0 })
            );
            el.dispatchEvent(new PointerEvent('pointercancel', { ...pointerInit, buttons: 0 }));
            el.dispatchEvent(
              new MouseEvent('mouseleave', { ...pointerInit, clientX: 0, clientY: 0, buttons: 0 })
            );
            document.documentElement.dispatchEvent(
              new PointerEvent('pointerup', {
                ...pointerInit,
                clientX: 0,
                clientY: 0,
                buttons: 0,
              })
            );
            document.documentElement.dispatchEvent(
              new MouseEvent('mouseup', { ...pointerInit, clientX: 0, clientY: 0, buttons: 0 })
            );
            await wait(60);

            const after = fingerprint(el);
            if (after !== afterDown) continue; // the page reacted to the abort

            const className = typeof el.className === 'string' ? el.className : '';
            issues.push({
              type: 'down-event-activation',
              element:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (className ? `.${className.trim().split(/\s+/)[0]}` : ''),
              textContent: (el.textContent || '').trim().substring(0, 50),
              description:
                'The pointerdown changed the page and aborting the press before the pointer was released undid nothing',
              severity: 'serious',
            });
            available = false;
          }
        } finally {
          window.alert = nativeDialogs.alert;
          window.confirm = nativeDialogs.confirm;
          window.prompt = nativeDialogs.prompt;
        }

        return { issues, available };
      },
      renderedCode,
      25
    );

    cancellationAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.2.5.2',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        textContent: issue.textContent,
        severity: issue.severity,
        suggestion: this.getCancellationSuggestion(issue.type),
      });
    });

    return { available: cancellationAnalysis.available };
  }

  /**
   * Analyze motion actuation (WCAG 2.5.4) by firing device motion at the page.
   *
   * A synthetic `devicemotion` and `deviceorientation` event is dispatched at
   * the window; a page that acts on device motion changes its DOM in response,
   * and a page that does not is untouched. `window.DeviceMotionEvent` is a
   * constant in Chromium and says nothing about the page.
   */
  async analyzeMotionActuation(page, violations) {
    log.debug('Analyzing motion actuation...');

    const motionAnalysis = await page.evaluate(async () => {
      const issues = [];
      let alternativesProvided = true;

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fingerprint = () =>
        `${document.body.innerHTML.length}|${document.querySelectorAll('*').length}|${location.href}`;

      const idle = fingerprint();
      await wait(150);
      if (fingerprint() !== idle) {
        return { issues, alternativesProvided, skipped: 'page mutates on its own' };
      }

      const before = fingerprint();

      if (typeof DeviceMotionEvent === 'function') {
        try {
          window.dispatchEvent(
            new DeviceMotionEvent('devicemotion', {
              acceleration: { x: 30, y: 30, z: 30 },
              accelerationIncludingGravity: { x: 30, y: 30, z: 40 },
              rotationRate: { alpha: 90, beta: 90, gamma: 90 },
              interval: 16,
            })
          );
        } catch (e) {
          /* constructor unavailable */
        }
      }
      if (typeof DeviceOrientationEvent === 'function') {
        try {
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientation', {
              alpha: 180,
              beta: 60,
              gamma: 45,
              absolute: true,
            })
          );
        } catch (e) {
          /* constructor unavailable */
        }
      }
      await wait(120);

      if (fingerprint() !== before) {
        issues.push({
          type: 'motion-actuation-without-alternative',
          element: 'document',
          description:
            'The page changed in response to a synthetic device motion event, so a function is operated by moving the device',
          severity: 'moderate',
        });
        alternativesProvided = false;
      }

      return { issues, alternativesProvided };
    });

    motionAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.2.5.4',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getMotionSuggestion(issue.type),
      });
    });

    return { alternativesProvided: motionAnalysis.alternativesProvided };
  }

  /**
   * Analyze target size minimum (WCAG 2.5.8)
   * Flags interactive elements smaller than 24x24 CSS pixels
   */
  async analyzeTargetSize(page, violations) {
    log.debug('Analyzing target size minimum...');

    const targetAnalysis = await page.evaluate((renderedCode) => {
      eval(renderedCode);
      const issues = [];
      let adequate = true;

      const MIN_SIZE = 24; // WCAG 2.5.8 AA minimum
      const RADIUS = MIN_SIZE / 2; // spacing exception: 24px-diameter circle

      function selectorOf(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/)[0]}`
            : '')
        );
      }

      /**
       * 2.5.8 "Inline" exception, both of its clauses: the target is in a
       * sentence (it shares a line box with text that belongs to no target),
       * or its size is constrained by the line height of non-target text in
       * the same block. Both are measured from painted rectangles, so a
       * citation marker in `<sup><a>[1]</a></sup>` inside a paragraph is
       * exempt and a link alone in a navigation row is not.
       */
      function isInlineTextTarget(el, style) {
        if (!['inline', 'inline-block', 'inline-flex'].includes(style.display)) return false;

        // Nearest block-level ancestor: the box whose line boxes the target sits in.
        let block = el.parentElement;
        while (block && block !== document.documentElement) {
          const d = window.getComputedStyle(block).display;
          if (!d.startsWith('inline') && d !== 'contents') break;
          block = block.parentElement;
        }
        if (!block) return false;

        const rect = el.getBoundingClientRect();
        const blockStyle = window.getComputedStyle(block);
        const fontSize = parseFloat(blockStyle.fontSize) || 16;
        const lineHeight =
          blockStyle.lineHeight === 'normal'
            ? fontSize * 1.2
            : parseFloat(blockStyle.lineHeight) || fontSize * 1.2;
        // A target taller than the line box was sized by its author, so no
        // line height constrains it and the exception does not apply.
        if (rect.height > lineHeight * 1.5) return false;

        const range = document.createRange();
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node;
        let hasNonTargetText = false;
        while ((node = walker.nextNode())) {
          if (!node.nodeValue || !node.nodeValue.trim()) continue;
          if (el.contains(node)) continue;
          // Text inside another target is that target's label, not surrounding
          // text: a row of navigation links does not make its links inline.
          let owner = node.parentElement;
          let inTarget = false;
          while (owner && owner !== block) {
            if (__isInteractiveTarget(owner)) {
              inTarget = true;
              break;
            }
            owner = owner.parentElement;
          }
          if (inTarget) continue;

          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (r.width === 0 || r.height === 0) continue;
            hasNonTargetText = true;
            const overlap = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top);
            if (overlap > Math.min(rect.height, r.height) / 2) return true; // same line box
          }
        }
        // Painted text elsewhere in the same block: the line height that
        // formats that text formats the target's line too.
        return hasNonTargetText;
      }

      /** 2.5.8 "User agent control" exception: size set by the UA, not the author. */
      function isUaSizedControl(el, rect) {
        const tag = el.tagName.toLowerCase();
        if (tag !== 'input') return false;
        const t = (el.type || '').toLowerCase();
        if (t !== 'checkbox' && t !== 'radio') return false;
        // Chromium default is 13x13; anything near that has not been author-sized.
        return rect.width <= 16 && rect.height <= 16;
      }

      // Collect every rendered pointer target ONCE (each element, not each selector match)
      const candidates = new Set();
      document
        .querySelectorAll(
          'a, area, button, input, select, textarea, summary, [role], [tabindex], [contenteditable], audio[controls], video[controls]'
        )
        .forEach((el) => {
          if (__isInteractiveTarget(el) && __isRendered(el)) candidates.add(el);
        });

      const targets = [];
      for (const el of candidates) {
        // A target nested in another target (icon inside a button) is the same target.
        let p = el.parentElement,
          nested = false;
        while (p && p !== document.body) {
          if (candidates.has(p)) {
            nested = true;
            break;
          }
          p = p.parentElement;
        }
        if (nested) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        targets.push({ el, rect, selector: selectorOf(el), style: window.getComputedStyle(el) });
      }

      function center(r) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      function circleIntersectsRect(c, r) {
        const dx = Math.max(r.left - c.x, 0, c.x - r.right);
        const dy = Math.max(r.top - c.y, 0, c.y - r.bottom);
        return dx * dx + dy * dy < RADIUS * RADIUS;
      }

      for (const t of targets) {
        const { rect, el, style } = t;
        if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) continue;
        if (isInlineTextTarget(el, style)) continue;
        if (isUaSizedControl(el, rect)) continue;

        // Spacing exception: the 24px circle centred on this target must not
        // intersect any other target or any other undersized target's circle.
        const c = center(rect);
        let blocker = null;
        for (const o of targets) {
          if (o === t) continue;
          if (circleIntersectsRect(c, o.rect)) {
            blocker = o;
            break;
          }
          if (o.rect.width < MIN_SIZE || o.rect.height < MIN_SIZE) {
            const oc = center(o.rect);
            const d = Math.hypot(c.x - oc.x, c.y - oc.y);
            if (d < MIN_SIZE) {
              blocker = o;
              break;
            }
          }
        }
        if (!blocker) continue; // undersized but sufficiently spaced: passes 2.5.8

        adequate = false;
        issues.push({
          type: 'target-too-small',
          element: t.selector,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          nearbyElement: blocker.selector,
          description: `Interactive target is ${Math.round(rect.width)}x${Math.round(rect.height)}px (minimum ${MIN_SIZE}x${MIN_SIZE}px) and its 24px spacing circle overlaps ${blocker.selector}`,
          severity: 'serious',
        });
      }

      return { issues, adequate };
    }, renderedCode);

    targetAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.2.5.8',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        width: issue.width,
        height: issue.height,
        nearbyElement: issue.nearbyElement,
        gap: issue.gap,
        suggestion: this.getTargetSizeSuggestion(issue.type),
      });
    });

    return { adequate: targetAnalysis.adequate };
  }

  /**
   * Analyze dragging movements (WCAG 2.5.7).
   *
   * A drag interface is taken from the platform API the page actually uses
   * (`draggable="true"`, an `ondragstart` handler, a drop target), never from
   * a class name containing "sortable". The single-pointer alternative is
   * looked for structurally: a rendered control inside the draggable item, in
   * the container that holds it, or bound to it with `aria-controls`, so the
   * alternative is recognised in any language.
   */
  async analyzeDraggingMovements(page, violations) {
    log.debug('Analyzing dragging movements...');

    const dragAnalysis = await page.evaluate((renderedSrc) => {
      eval(renderedSrc);
      const issues = [];
      let alternativesProvided = true;

      const CONTROLS =
        'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, [role="option"], [role="gridcell"], [role="slider"], [contenteditable]';

      function getSelector(el) {
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '')
        );
      }

      /** A rendered control the element itself, its container or an aria-controls reference offers. */
      function hasPointerAlternative(el) {
        const own = Array.from(el.querySelectorAll(CONTROLS)).filter(__isRendered);
        if (own.length) return true;
        if (__isInteractiveTarget(el)) return true;
        if (el.id) {
          const bound = document.querySelector(`[aria-controls~="${CSS.escape(el.id)}"]`);
          if (bound && __isRendered(bound)) return true;
        }
        // The container the item is dragged within: a listbox or grid pattern,
        // or any sibling control that can move it without a drag.
        const parent = el.parentElement;
        if (!parent) return false;
        const parentRole = parent.getAttribute('role');
        if (parentRole === 'listbox' || parentRole === 'grid' || parentRole === 'tree') return true;
        for (const sibling of parent.children) {
          if (sibling === el) continue;
          if (Array.from(sibling.querySelectorAll(CONTROLS)).some(__isRendered)) return true;
          if (__isInteractiveTarget(sibling) && __isRendered(sibling)) return true;
        }
        return false;
      }

      const dragSources = new Set();
      document
        .querySelectorAll('[draggable="true"], [ondragstart], [ondrag], [ondragend]')
        .forEach((el) => {
          if (__isRendered(el)) dragSources.add(el);
        });

      for (const el of dragSources) {
        if (hasPointerAlternative(el)) continue;
        issues.push({
          type: 'drag-only-no-alternative',
          element: getSelector(el),
          description:
            'Element is moved by dragging and neither it, its container nor an aria-controls reference offers a control that does the same with a single pointer',
          severity: 'serious',
        });
        alternativesProvided = false;
      }

      document.querySelectorAll('[ondrop], [ondragover]').forEach((el) => {
        if (!__isRendered(el)) return;
        if (dragSources.has(el)) return;
        // A drop target passes when a file input or a control that opens one
        // is reachable from it or from the form it belongs to.
        const scope = el.closest('form, fieldset, [role="group"]') || el;
        const alternatives = Array.from(scope.querySelectorAll(CONTROLS)).filter(
          (c) => __isRendered(c) || (c.tagName.toLowerCase() === 'input' && c.type === 'file')
        );
        if (alternatives.length) return;
        issues.push({
          type: 'drop-zone-no-alternative',
          element: getSelector(el),
          description: 'Drop target offers no control that adds the same content without a drag',
          severity: 'serious',
        });
        alternativesProvided = false;
      });

      return { issues, alternativesProvided };
    }, renderedCode);

    dragAnalysis.issues.forEach((issue) => {
      violations.push({
        criterion: '9.2.5.7',
        element: issue.element,
        issue: issue.type,
        description: issue.description,
        severity: issue.severity,
        suggestion: this.getDraggingSuggestion(issue.type),
      });
    });

    return { alternativesProvided: dragAnalysis.alternativesProvided };
  }

  /**
   * Get suggestion for target size violations
   */
  getTargetSizeSuggestion(violationType) {
    const suggestions = {
      'target-too-small':
        'Increase target dimensions to at least 24x24 CSS pixels using min-width/min-height or padding',
      'target-underspaced':
        'Increase spacing between small targets to at least 24px, or increase target size to 24x24px minimum',
    };
    return (
      suggestions[violationType] ||
      'Ensure interactive targets meet the 24x24px minimum size requirement'
    );
  }

  /**
   * Get suggestion for dragging violations
   */
  getDraggingSuggestion(violationType) {
    const suggestions = {
      'drag-only-no-alternative':
        'Add move up/down buttons, click-to-select, or keyboard arrow key support as alternatives to drag',
      'drop-zone-no-alternative':
        'Add a click/tap mechanism (button, file input) to add content to the drop zone',
    };
    return (
      suggestions[violationType] ||
      'Provide single-pointer and keyboard alternatives for drag operations'
    );
  }

  /**
   * Get suggestion for gesture violations
   */
  getGestureSuggestion(violationType) {
    const suggestions = {
      'complex-gesture-only':
        'Provide simple click/tap alternatives for complex path-based gestures',
    };
    return (
      suggestions[violationType] || 'Provide accessible alternatives to complex pointer gestures'
    );
  }

  /**
   * Get suggestion for cancellation violations
   */
  getCancellationSuggestion(violationType) {
    const suggestions = {
      'down-event-activation':
        'Complete the action on the up-event, so that moving the pointer away before releasing it aborts the action',
    };
    return (
      suggestions[violationType] ||
      'Implement pointer cancellation mechanisms for better user control'
    );
  }

  /**
   * Get suggestion for motion violations
   */
  getMotionSuggestion(violationType) {
    const suggestions = {
      'motion-actuation-without-alternative':
        'Offer the same function from a user interface component and let the user switch device motion actuation off',
    };
    return (
      suggestions[violationType] ||
      'Ensure motion-based features can be disabled and have alternatives'
    );
  }
}

module.exports = InputModalitiesScanner;
