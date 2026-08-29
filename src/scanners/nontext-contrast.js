/**
 * Non-text Contrast Scanner.
 * WCAG 1.4.11 (EN 301 549 9.1.4.11), plus focus indicator visibility for 2.4.7.
 * Measures 3:1 contrast of UI component boundaries, graphical objects, focus indicators
 * and state changes against their resolved backdrop.
 */
const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { tabWalk, cleanupTabWalk } = require('../utils/keyboard-focus');
const { injectableCode: contrastUtils } = require('../utils/browser-contrast');
const { injectableCode: renderedUtils } = require('../utils/rendered');

class NonTextContrastScanner extends BaseScanner {
  constructor() {
    super('nontext-contrast', {
      wcagCriteria: ['1.4.11'],
      wcagPrinciple: 'perceivable',
    });
  }

  /**
   * Focus-indicator analysis drives real keyboard focus (Tab) and scrolls
   * the page; that must not happen on a tab shared with other scanners.
   */
  get needsExclusiveAccess() {
    return true;
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const scanOptions = {
      checkInteractiveElements: options.checkInteractiveElements !== false,
      checkGraphicalObjects: options.checkGraphicalObjects !== false,
      checkFocusIndicators: options.checkFocusIndicators !== false,
      checkStateChanges: options.checkStateChanges !== false,
      contrastThreshold: options.contrastThreshold || 3.0,
      timeout: options.timeout || 60000,
    };

    const timestamp = Date.now();
    const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
    await fs.ensureDir(scanDir);

    // Take screenshot for analysis
    const screenshotPath = path.join(scanDir, 'nontext-contrast-analysis.png');
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    const violations = [];
    // Elements whose rendered contrast could not be determined from CSS
    // (gradients, background images, canvas). Reported separately so an
    // unknown is never counted as a failure.
    const incomplete = [];

    const collect = (result) => {
      if (!result) return;
      violations.push(...(result.violations || []));
      incomplete.push(...(result.incomplete || []));
    };

    // Analyze UI components
    if (scanOptions.checkInteractiveElements) {
      collect(await this.analyzeUIComponents(page, scanOptions));
    }

    // Analyze graphical objects
    if (scanOptions.checkGraphicalObjects) {
      collect(await this.analyzeGraphicalObjects(page, scanOptions));
    }

    // Analyze focus indicators
    if (scanOptions.checkFocusIndicators) {
      collect(await this.analyzeFocusIndicators(page, scanOptions));
    }

    // Analyze interactive states
    if (scanOptions.checkStateChanges) {
      collect(await this.analyzeInteractiveStates(page, scanOptions));
    }

    return {
      scannerId: this.id,
      criteria: ['1.4.11'],
      passed: violations.length === 0,
      violations: violations,
      incomplete: incomplete,
      summary: {
        totalElementsChecked: await this.countCheckedElements(page),
        uiComponentIssues: violations.filter((v) => v.category === 'ui-component').length,
        graphicalObjectIssues: violations.filter((v) => v.category === 'graphical-object').length,
        focusIndicatorIssues: violations.filter((v) => v.category === 'focus-indicator').length,
        stateChangeIssues: violations.filter((v) => v.category === 'state-change').length,
        incompleteElements: incomplete.length,
        averageContrastRatio: this.calculateAverageContrast(violations),
      },
      screenshotPath: screenshotPath,
      recommendations: this.generateNonTextContrastRecommendations(violations),
    };
  }

  /**
   * Analyze UI components for contrast compliance
   */
  async analyzeUIComponents(page, options) {
    return await page.evaluate(
      (contrastThreshold, contrastCode, renderedCode) => {
        // Inject the shared WCAG contrast helpers (__parseRgb, __getLuminance,
        // __getContrastRatio, __blendOver, __resolveBackground, __isInactive,
        // __getRenderedBorder, __hasCompliantBorder, __isColorTransparent)
        // and the rendering test (__isRendered).
        eval(contrastCode);
        eval(renderedCode);

        const violations = [];
        const incomplete = [];

        function rgbString(c) {
          return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
        }

        // Name the reported element the way a reader can find it again. Only
        // ever used for reporting, never fed back into querySelector.
        function describe(element, index) {
          const tag = element.tagName.toLowerCase();
          if (element.id) return tag + '#' + element.id;
          const raw = typeof element.className === 'string' ? element.className : '';
          const classes = raw.trim().split(/\s+/).filter(Boolean).slice(0, 3);
          if (classes.length) return tag + '.' + classes.join('.');
          return tag + '[' + index + ']';
        }

        /**
         * Evaluate one UI component against SC 1.4.11.
         *
         * Three rules:
         *  - the backdrop is the first ancestor that actually paints
         *    (__resolveBackground), never `element.parentElement`'s own
         *    computed background, which may be transparent;
         *  - translucent fills and borders are alpha-composited onto that
         *    backdrop before any ratio is taken (rgba(0,0,0,0.7) does not
         *    render as black);
         *  - a component whose painted border already reaches the threshold
         *    is not additionally required to have a contrasting fill. SC
         *    1.4.11 governs "the visual information required to identify"
         *    the component, and a compliant border is that information. The
         *    standard accessible pattern (white input, white page, dark
         *    border) otherwise fails for no reason.
         */
        function evaluateComponent(element, index, config) {
          // SC 1.4.11 exception: inactive user interface components.
          if (__isInactive(element)) return;
          // Nothing that is not painted can fail a contrast criterion (e.g.
          // a `display:none` hamburger button in a desktop layout).
          if (!__isRendered(element)) return;

          const styles = window.getComputedStyle(element);
          const background = __resolveBackground(element.parentElement || element);

          if (background.indeterminate) {
            incomplete.push({
              type: 'indeterminate-component-background',
              category: 'ui-component',
              element: describe(element, index),
              description:
                'Component sits on an image or gradient background; its rendered contrast cannot be computed from CSS and needs manual review.',
              details: {
                backgroundImage: background.indeterminateSource,
                tagName: element.tagName.toLowerCase(),
                id: element.id || null,
              },
              wcagCriteria: '1.4.11',
            });
            return;
          }

          const backdrop = { r: background.r, g: background.g, b: background.b, a: 1 };
          const renderedBorder = __getRenderedBorder(styles);
          const compliantBorder = __hasCompliantBorder(styles, backdrop, contrastThreshold);
          // "Visual information required to identify" the component: a
          // label or an icon glyph with sufficient contrast IS that
          // information, so neither the border nor the fill has to carry
          // it. Computed once and applied to both branches, so a transparent
          // icon button with a high-contrast glyph passes.
          const alt = __hasAlternativeIdentifier(element, backdrop, contrastThreshold);

          // Border contrast (only for borders that are actually painted,
          // and only when nothing else (label text, icon glyph) already
          // identifies the component with sufficient contrast).
          if (renderedBorder && !compliantBorder) {
            const borderRgb = __parseRgb(renderedBorder.color);
            if (borderRgb && !alt.by) {
              const strongest = __strongestBoundary(styles, backdrop);
              const contrast = strongest.ratio;
              if (contrast < contrastThreshold) {
                violations.push({
                  type: config.borderType,
                  category: 'ui-component',
                  severity: 'serious',
                  element: describe(element, index),
                  description: config.borderDescription,
                  details: {
                    borderColor: renderedBorder.color,
                    borderSide: renderedBorder.side,
                    borderWidth: renderedBorder.width,
                    backgroundColor: rgbString(backdrop),
                    strongestBoundary: strongest.boundary,
                    contrastRatio: Math.round(contrast * 100) / 100,
                    required: contrastThreshold,
                    tagName: element.tagName.toLowerCase(),
                    role: element.getAttribute('role') || null,
                    type: element.type || null,
                    id: element.id || null,
                    className: (typeof element.className === 'string' && element.className) || null,
                  },
                  wcagCriteria: '1.4.11',
                  impact: config.borderImpact,
                });
              }
            }
          }

          // Fill contrast, only relevant when no compliant border already
          // identifies the component's boundary.
          if (config.checkFill && !compliantBorder && !alt.by) {
            const ownBg = __parseRgb(styles.backgroundColor);
            if (ownBg && ownBg.a > 0) {
              const flattened = __blendOver(ownBg, backdrop);
              const contrast = __getContrastRatio(flattened, backdrop);
              if (contrast < contrastThreshold) {
                violations.push({
                  type: 'insufficient-background-contrast',
                  category: 'ui-component',
                  severity: 'moderate',
                  element: describe(element, index),
                  description: 'Component background has insufficient contrast',
                  details: {
                    backgroundColor: styles.backgroundColor,
                    renderedBackgroundColor: rgbString(flattened),
                    parentBackground: rgbString(backdrop),
                    contrastRatio: Math.round(contrast * 100) / 100,
                    required: contrastThreshold,
                    tagName: element.tagName.toLowerCase(),
                    id: element.id || null,
                  },
                  wcagCriteria: '1.4.11',
                  impact: 'Component is not easily distinguishable from background',
                });
              }
            }
          }
        }

        // Buttons
        const buttons = document.querySelectorAll(
          'button, input[type="button"], input[type="submit"], input[type="reset"], ' +
            '[role="button"], [role="switch"]'
        );
        for (let i = 0; i < buttons.length; i++) {
          evaluateComponent(buttons[i], i, {
            borderType: 'insufficient-border-contrast',
            borderDescription:
              'No boundary of the button reaches the 3:1 contrast SC 1.4.11 asks for: not its border against the page, not its border against its own fill, and not its fill against the page',
            borderImpact: 'Button boundaries are not clearly visible',
            checkFill: true,
          });
        }

        // Form controls
        const formControls = document.querySelectorAll(
          'input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea'
        );
        for (let i = 0; i < formControls.length; i++) {
          evaluateComponent(formControls[i], i, {
            borderType: 'insufficient-form-border-contrast',
            borderDescription:
              'No boundary of the form control reaches the 3:1 contrast SC 1.4.11 asks for: not its border against the page, not its border against its own fill, and not its fill against the page',
            borderImpact: 'Form control boundaries are not clearly visible',
            checkFill: false,
          });
        }

        // Custom controls (checkboxes, radio buttons, sliders)
        const customControls = document.querySelectorAll(
          '[role="checkbox"], [role="radio"], [role="slider"], input[type="checkbox"], input[type="radio"], input[type="range"]'
        );
        for (let i = 0; i < customControls.length; i++) {
          evaluateComponent(customControls[i], i, {
            borderType: 'insufficient-custom-control-contrast',
            borderDescription: 'Custom control has insufficient border contrast',
            borderImpact: 'Custom control boundaries are not clearly visible',
            checkFill: false,
          });
        }

        return { violations: violations, incomplete: incomplete };
      },
      options.contrastThreshold,
      contrastUtils,
      renderedUtils
    );
  }

  /**
   * Analyze graphical objects for contrast compliance, using the injected
   * shared WCAG helpers inside page.evaluate.
   *
   * SC 1.4.11 covers "graphical objects ... required to understand the
   * content". Purely decorative graphics are out of scope, so an SVG that is
   * aria-hidden, role="presentation"/"none", or carries no accessible name
   * at all is skipped rather than reported.
   */
  async analyzeGraphicalObjects(page, options) {
    return await page.evaluate(
      (contrastThreshold, contrastCode) => {
        eval(contrastCode);

        const violations = [];
        const incomplete = [];

        function rgbString(c) {
          return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
        }

        // Decorative graphics convey nothing and are outside SC 1.4.11.
        function isMeaningfulGraphic(svg) {
          if (!svg) return false;
          if (svg.getAttribute('aria-hidden') === 'true') return false;
          const role = svg.getAttribute('role');
          if (role === 'presentation' || role === 'none') return false;
          const hasName = !!(
            svg.getAttribute('aria-label') ||
            svg.getAttribute('aria-labelledby') ||
            svg.querySelector('title')
          );
          return hasName || role === 'img' || role === 'graphics-document';
        }

        // Compare a colour against a backdrop, alpha-compositing first.
        // Returns null when either colour cannot be parsed (an unparseable
        // colour is not evidence of a violation).
        function ratioAgainst(colorStr, backdrop) {
          const parsed = __parseRgb(colorStr);
          if (!parsed) return null;
          if (parsed.a === 0) return null;
          return __getContrastRatio(__blendOver(parsed, backdrop), backdrop);
        }

        // SVG fills/strokes inside meaningful graphics
        const svgRoots = Array.from(document.querySelectorAll('svg')).filter(isMeaningfulGraphic);
        for (const svg of svgRoots) {
          const background = __resolveBackground(svg.parentElement || svg);
          if (background.indeterminate) {
            incomplete.push({
              type: 'indeterminate-graphic-background',
              category: 'graphical-object',
              element: 'svg',
              description:
                'Graphic sits on an image or gradient background; contrast needs manual review.',
              details: { backgroundImage: background.indeterminateSource, id: svg.id || null },
              wcagCriteria: '1.4.11',
            });
            continue;
          }
          const backdrop = { r: background.r, g: background.g, b: background.b, a: 1 };

          // One verdict per graphic. SC 1.4.11 asks that the graphical object
          // can be perceived, not that every path in it can, so every painted
          // part is measured and the graphic fails only when none of them
          // reaches the threshold. Colours are read from computed style, which
          // is where a CSS fill and an inherited `currentColor` are.
          // The root <svg> paints nothing itself; only its shapes do.
          const parts = svg.querySelectorAll(
            'path, rect, circle, ellipse, line, polyline, polygon, text'
          );
          let best = null;
          for (const part of parts) {
            const partStyles = window.getComputedStyle(part);
            for (const prop of ['fill', 'stroke']) {
              let value = partStyles[prop];
              if (!value || value === 'none') continue;
              if (prop === 'stroke' && !(parseFloat(partStyles.strokeWidth) > 0)) continue;
              if (/currentcolor/i.test(value)) value = partStyles.color;
              const ratio = ratioAgainst(value, backdrop);
              if (ratio === null) continue;
              if (best === null || ratio > best.ratio) {
                best = { ratio: ratio, property: prop, color: value };
              }
            }
          }

          if (best && best.ratio < contrastThreshold) {
            violations.push({
              type: 'insufficient-graphic-contrast',
              category: 'graphical-object',
              severity: 'moderate',
              element: 'svg' + (svg.id ? '#' + svg.id : ''),
              description: 'Graphic has insufficient contrast against its background',
              details: {
                property: best.property,
                color: best.color,
                backgroundColor: rgbString(backdrop),
                contrastRatio: Math.round(best.ratio * 100) / 100,
                required: contrastThreshold,
                name:
                  svg.getAttribute('aria-label') ||
                  (svg.querySelector('title') && svg.querySelector('title').textContent.trim()) ||
                  null,
                id: svg.id || null,
              },
              wcagCriteria: '1.4.11',
              impact: 'Graphical content is not clearly visible',
            });
          }
        }

        // Progress bars: the track boundary is the information that has to
        // be perceivable. Canvas contents cannot be read from the CSSOM at
        // all, so canvases are reported as needing review.
        const progressBars = document.querySelectorAll('progress, [role="progressbar"]');
        for (let i = 0; i < progressBars.length; i++) {
          const progress = progressBars[i];
          if (__isInactive(progress)) continue;
          const styles = window.getComputedStyle(progress);
          const background = __resolveBackground(progress.parentElement || progress);
          if (background.indeterminate) continue;
          const backdrop = { r: background.r, g: background.g, b: background.b, a: 1 };
          const renderedBorder = __getRenderedBorder(styles);
          if (!renderedBorder) continue;

          const contrast = ratioAgainst(renderedBorder.color, backdrop);
          if (contrast !== null && contrast < contrastThreshold) {
            violations.push({
              type: 'insufficient-progress-border-contrast',
              category: 'ui-component',
              severity: 'moderate',
              element: progress.id ? `progress#${progress.id}` : `progress[${i}]`,
              description: 'Progress bar border has insufficient contrast',
              details: {
                borderColor: renderedBorder.color,
                backgroundColor: rgbString(backdrop),
                contrastRatio: Math.round(contrast * 100) / 100,
                required: contrastThreshold,
                id: progress.id || null,
              },
              wcagCriteria: '1.4.11',
              impact: 'Progress bar boundaries are not clearly visible',
            });
          }
        }

        const canvases = document.querySelectorAll('canvas');
        for (let i = 0; i < canvases.length; i++) {
          incomplete.push({
            type: 'canvas-contrast-not-determinable',
            category: 'graphical-object',
            element: `canvas[${i}]`,
            description:
              'Canvas contents are painted programmatically and cannot be evaluated from CSS; contrast needs manual review.',
            details: { id: canvases[i].id || null },
            wcagCriteria: '1.4.11',
          });
        }

        return { violations: violations, incomplete: incomplete };
      },
      options.contrastThreshold,
      contrastUtils
    );
  }

  /**
   * Analyze focus indicators (SC 2.4.7 visibility, SC 1.4.11 contrast).
   *
   * Focus is moved with REAL keyboard Tab presses through
   * src/utils/keyboard-focus.js, never with element.focus(): programmatic
   * focus does not enter Chromium's `:focus-visible` state, so a page whose
   * only ring is `:focus-visible { outline: ... }` would look like it had no
   * indicator at all. Identity is by tab id, so two nav links with identical
   * class names are two elements, not a "trap".
   *
   * `getComputedStyle(el, ':focus')` is never used: the second argument is a
   * pseudo-element selector and returns the normal style.
   */
  async analyzeFocusIndicators(page, options) {
    const violations = [];
    const incomplete = [];
    const contrastThreshold = options.contrastThreshold;
    const maxSteps = options.maxFocusSteps || 120;
    let steps = 0;

    // One CSS rule, one defect: a `:focus-visible { outline: <colour> }` that
    // fails 3:1 fails identically on every element it matches (the eight
    // footer links of the med template are eight copies of ONE ring). They
    // are grouped by ring colour + backdrop + width and reported once with
    // the full element list, so the report shows the defect, not its
    // multiplicity.
    const lowContrastGroups = new Map();

    try {
      for await (const step of tabWalk(page, { maxSteps })) {
        steps++;
        if (step.stuck) break;
        if (!step.rendered) continue; // focus landed on something not painted (handled by 2.4.3/2.4.11 checks)
        const ind = step.indicator;
        const outlineStyle = step.after.outlineStyle;

        // Whether an indicator exists at all is SC 2.4.7 and is reported by
        // focus-management from its own walk. What is measured here is the
        // contrast of the ring that does exist: `lowContrast` means the walk
        // found an outline and nothing else, and that outline stays under 3:1
        // against the backdrop. `outline-style: auto` is the platform ring,
        // which the browser paints with its own contrast handling.
        if (ind.lowContrast && outlineStyle !== 'auto') {
          const key = `${step.after.outlineColor}|${ind.backdrop}|${step.after.outlineWidth}`;
          let group = lowContrastGroups.get(key);
          if (!group) {
            group = {
              outlineColor: step.after.outlineColor,
              outlineWidth: step.after.outlineWidth,
              backdrop: ind.backdrop,
              ratio: ind.ratio,
              element: step.selector,
              tagName: step.tag,
              elements: [],
            };
            lowContrastGroups.set(key, group);
          }
          group.elements.push({ selector: step.selector, text: step.text, tagName: step.tag });
        }
      }
    } finally {
      await cleanupTabWalk(page);
    }

    for (const group of lowContrastGroups.values()) {
      violations.push({
        type: 'insufficient-focus-indicator-contrast',
        category: 'focus-indicator',
        severity: 'serious',
        element: group.element,
        description:
          group.elements.length > 1
            ? `Focus indicator has insufficient contrast against background (${group.elements.length} elements share this ring)`
            : 'Focus indicator has insufficient contrast against background',
        details: {
          outlineColor: group.outlineColor,
          outlineWidth: group.outlineWidth,
          backgroundColor: group.backdrop,
          contrastRatio: Math.round(group.ratio * 100) / 100,
          required: contrastThreshold,
          tagName: group.tagName,
          text: group.elements[0].text,
          occurrences: group.elements.length,
          affectedElements: group.elements.slice(0, 25).map((e) => e.selector),
        },
        wcagCriteria: '1.4.11',
        impact: 'Focus indicator is not clearly visible to users',
      });
    }

    return { violations, incomplete, focusStepsWalked: steps };
  }

  /**
   * Analyze component STATE indication for contrast compliance (SC 1.4.11,
   * "visual information required to identify ... states of user interface
   * components").
   *
   * Resolves the style rules that actually match the element and carry a
   * semantic state pseudo-class/attribute (`:checked`, `aria-checked`,
   * `aria-selected`, `aria-pressed`, `aria-expanded`), then verifies the
   * declared state indication is perceivable: at least one declared property
   * must produce a visible change, and a state signalled by colour alone must
   * reach the 3:1 threshold against the colour it replaces.
   *
   * `:hover` and `:active` are not treated as states here.
   * SC 1.4.11's "states" are the ones that carry information (checked,
   * selected, expanded, pressed); a hover treatment is a transient
   * affordance, and WCAG does not require one to exist or to reach 3:1
   * against the resting style. `:focus` has its own dedicated check in
   * analyzeFocusIndicators.
   */
  async analyzeInteractiveStates(page, options) {
    return await page.evaluate(
      (contrastThreshold, contrastCode) => {
        eval(contrastCode);

        const violations = [];

        // Pseudo-classes / attribute selectors that signal a semantic state.
        const STATE_PATTERN =
          /:checked|:indeterminate|\[aria-checked|\[aria-selected|\[aria-pressed|\[aria-expanded|\[aria-current/;
        // Properties whose change can constitute a visible state indicator.
        const COLOUR_PROPS = [
          'background-color',
          'border-color',
          'border-top-color',
          'border-right-color',
          'border-bottom-color',
          'border-left-color',
          'outline-color',
          'color',
        ];
        const STRUCTURAL_PROPS = [
          'border-width',
          'border-style',
          'border-top-width',
          'border-top-style',
          'outline-width',
          'outline-style',
          'box-shadow',
          'background-image',
          'content',
          'text-decoration',
          'text-decoration-line',
          'font-weight',
          'transform',
          'opacity',
        ];

        // Strip state pseudo-classes/attributes so the remaining selector can
        // be matched against the live element.
        function baseSelector(selectorText) {
          return selectorText
            .replace(/:(checked|indeterminate)\b/g, '')
            .replace(/\[aria-(checked|selected|pressed|expanded|current)(=("|')?[^\]]*)?\]/g, '')
            .trim();
        }

        function collectStateRules() {
          const out = [];
          for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
              rules = Array.from(sheet.cssRules || []);
            } catch (e) {
              continue;
            }
            // Chromium exposes an (empty) `cssRules` on every style rule since
            // CSS nesting, so a grouping rule is recognised by having nested
            // rules, not by having the property.
            const walk = (list) => {
              for (const rule of list) {
                if (rule.cssRules && rule.cssRules.length) walk(Array.from(rule.cssRules));
                if (!rule.selectorText || !rule.style) continue;
                if (!STATE_PATTERN.test(rule.selectorText)) continue;
                for (const part of rule.selectorText.split(',')) {
                  const state = STATE_PATTERN.exec(part);
                  if (!state) continue;
                  const base = baseSelector(part);
                  if (!base) continue;
                  out.push({
                    base: base,
                    style: rule.style,
                    selectorText: part.trim(),
                    state: state[0].replace(/^[:[]/, ''),
                  });
                }
              }
            };
            walk(rules);
          }
          return out;
        }

        const stateRules = collectStateRules();
        if (stateRules.length === 0) return { violations: violations, incomplete: [] };

        const candidates = document.querySelectorAll(
          'a, button, input, select, textarea, [role="checkbox"], [role="radio"], ' +
            '[role="switch"], [role="tab"], [role="option"], [role="menuitemcheckbox"], ' +
            '[role="menuitemradio"], [aria-checked], [aria-selected], [aria-pressed], [aria-expanded]'
        );

        // Can the element be in the state the rule styles? A stylesheet that
        // ships `[aria-pressed="true"]` colours says nothing about a button
        // that never carries aria-pressed, and a `:checked` rule says nothing
        // about a text field.
        function exposesState(element, state) {
          if (state === 'checked' || state === 'indeterminate') {
            const type = (element.getAttribute('type') || '').toLowerCase();
            return (
              type === 'checkbox' ||
              type === 'radio' ||
              element.hasAttribute('aria-checked') ||
              element.tagName.toLowerCase() === 'option'
            );
          }
          return element.hasAttribute(state);
        }

        // The declaration that wins is the one the cascade applies last, so
        // every matching rule is merged in stylesheet order instead of
        // stopping at the first match.
        function declaredValue(rules, prop) {
          for (let r = rules.length - 1; r >= 0; r--) {
            const value = rules[r].style.getPropertyValue(prop);
            if (value) return value;
          }
          return '';
        }

        for (let i = 0; i < Math.min(candidates.length, 40); i++) {
          const element = candidates[i];
          if (__isInactive(element)) continue;

          const matchedRules = [];
          for (const rule of stateRules) {
            try {
              if (element.matches(rule.base) && exposesState(element, rule.state)) {
                matchedRules.push(rule);
              }
            } catch (e) {
              /* invalid/unsupported selector */
            }
          }
          if (matchedRules.length === 0) continue;
          const matched = matchedRules[matchedRules.length - 1];

          const normal = window.getComputedStyle(element);
          const background = __resolveBackground(element.parentElement || element);
          if (background.indeterminate) continue;
          const backdrop = { r: background.r, g: background.g, b: background.b, a: 1 };

          // Does the state rule declare anything that changes the rendering
          // in a way other than a plain colour swap? Then the state is
          // indicated structurally and there is nothing to measure.
          let structuralChange = false;
          for (const prop of STRUCTURAL_PROPS) {
            const declared = declaredValue(matchedRules, prop);
            if (declared && declared !== normal.getPropertyValue(prop)) {
              structuralChange = true;
              break;
            }
          }
          if (structuralChange) continue;

          // Otherwise the state is signalled by colour alone, and that colour
          // change has to be perceivable.
          let bestRatio = null;
          let evidence = null;
          for (const prop of COLOUR_PROPS) {
            const declared = declaredValue(matchedRules, prop);
            if (!declared) continue;
            const before = __parseRgb(normal.getPropertyValue(prop));
            const after = __parseRgb(declared);
            if (!before || !after) continue;
            const ratio = __getContrastRatio(
              __blendOver(before, backdrop),
              __blendOver(after, backdrop)
            );
            if (bestRatio === null || ratio > bestRatio) {
              bestRatio = ratio;
              evidence = { property: prop, from: normal.getPropertyValue(prop), to: declared };
            }
          }

          if (bestRatio !== null && bestRatio < contrastThreshold) {
            violations.push({
              type: 'insufficient-interactive-state-contrast',
              category: 'state-change',
              severity: 'moderate',
              element: element.id
                ? `${element.tagName.toLowerCase()}#${element.id}`
                : `${element.tagName.toLowerCase()}[${i}]`,
              description:
                'Component state is signalled by a colour change that is not distinguishable from the resting colour',
              details: {
                stateSelector: matched.selectorText,
                changedProperty: evidence.property,
                restingColor: evidence.from,
                stateColor: evidence.to,
                contrastRatio: Math.round(bestRatio * 100) / 100,
                required: contrastThreshold,
                tagName: element.tagName.toLowerCase(),
                role: element.getAttribute('role') || null,
                type: element.type || null,
                id: element.id || null,
              },
              wcagCriteria: '1.4.11',
              impact: 'Users cannot tell which state the component is in',
            });
          }
        }

        return { violations: violations, incomplete: [] };
      },
      options.contrastThreshold,
      contrastUtils
    );
  }

  /**
   * Calculate average contrast ratio from violations
   */
  calculateAverageContrast(violations) {
    const contrastViolations = violations.filter((v) => v.details && v.details.contrastRatio);
    if (contrastViolations.length === 0) return 'N/A';

    const average =
      contrastViolations.reduce((sum, v) => sum + v.details.contrastRatio, 0) /
      contrastViolations.length;
    return Math.round(average * 100) / 100;
  }

  /**
   * Count the elements this scanner actually looks at.
   */
  async countCheckedElements(page) {
    try {
      return await page.evaluate(
        () =>
          document.querySelectorAll(
            'button, input, select, textarea, [role="checkbox"], [role="radio"], ' +
              '[role="slider"], svg, canvas, progress, [role="progressbar"], ' +
              'a, [tabindex]:not([tabindex="-1"])'
          ).length
      );
    } catch (e) {
      return 0;
    }
  }

  /**
   * Generate recommendations for non-text contrast issues
   */
  generateNonTextContrastRecommendations(violations) {
    const recommendations = [];
    const issueTypes = [...new Set(violations.map((v) => v.type))];

    if (
      issueTypes.includes('insufficient-border-contrast') ||
      issueTypes.includes('insufficient-form-border-contrast')
    ) {
      recommendations.push({
        priority: 'high',
        issue: 'UI component border contrast',
        solution: 'Increase border contrast to 3:1 minimum against background',
        implementation: 'Use darker border colors or add additional visual indicators',
      });
    }

    if (
      issueTypes.includes('insufficient-focus-indicator-contrast') ||
      issueTypes.includes('missing-focus-indicator')
    ) {
      recommendations.push({
        priority: 'critical',
        issue: 'Focus indicator visibility',
        solution: 'Ensure focus indicators have 3:1 contrast and are clearly visible',
        implementation: 'Add visible outline or box-shadow with sufficient contrast',
      });
    }

    if (
      issueTypes.includes('insufficient-svg-fill-contrast') ||
      issueTypes.includes('insufficient-svg-stroke-contrast')
    ) {
      recommendations.push({
        priority: 'medium',
        issue: 'Graphical object contrast',
        solution: 'Ensure meaningful graphics have 3:1 contrast against background',
        implementation: 'Adjust fill and stroke colors for better visibility',
      });
    }

    if (issueTypes.includes('insufficient-custom-control-contrast')) {
      recommendations.push({
        priority: 'high',
        issue: 'Custom control visibility',
        solution: 'Make custom controls clearly distinguishable from background',
        implementation: 'Add borders, shadows, or background colors with sufficient contrast',
      });
    }

    return recommendations;
  }
}

module.exports = NonTextContrastScanner;
