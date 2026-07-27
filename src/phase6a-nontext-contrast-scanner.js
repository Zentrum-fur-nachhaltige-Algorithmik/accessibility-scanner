const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');
const { injectableCode: contrastUtils } = require('./utils/browser-contrast');

/**
 * Non-text Contrast Scanner for WCAG 1.4.11 compliance testing
 * Tests UI components and graphical objects for 3:1 contrast ratio
 * Critical for UI usability and legal compliance
 */
class NonTextContrastScanner extends BaseScanner {
    constructor() {
        super('nontext-contrast', {
            wcagCriteria: ['1.4.11'],
            wcagPrinciple: 'perceivable'
        });
        this.screenshotDir = path.join(__dirname, '../tmp/nontext-contrast-screenshots');
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
            timeout: options.timeout || 60000
        };

        const timestamp = Date.now();
        const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
        await fs.ensureDir(scanDir);

        // Take screenshot for analysis
        const screenshotPath = path.join(scanDir, 'nontext-contrast-analysis.png');
        await page.screenshot({
            path: screenshotPath,
            fullPage: true
        });

        const violations = [];

        // Analyze UI components
        if (scanOptions.checkInteractiveElements) {
            const uiViolations = await this.analyzeUIComponents(page, scanOptions);
            violations.push(...uiViolations);
        }

        // Analyze graphical objects
        if (scanOptions.checkGraphicalObjects) {
            const graphicsViolations = await this.analyzeGraphicalObjects(page, scanOptions);
            violations.push(...graphicsViolations);
        }

        // Analyze focus indicators
        if (scanOptions.checkFocusIndicators) {
            const focusViolations = await this.analyzeFocusIndicators(page, scanOptions);
            violations.push(...focusViolations);
        }

        // Analyze interactive states
        if (scanOptions.checkStateChanges) {
            const stateViolations = await this.analyzeInteractiveStates(page, scanOptions);
            violations.push(...stateViolations);
        }

        return {
            scannerId: this.id,
            criteria: ["1.4.11"],
            passed: violations.length === 0,
            violations: violations,
            summary: {
                totalElementsChecked: violations.length + this.getPassedElementsCount(violations),
                uiComponentIssues: violations.filter(v => v.category === 'ui-component').length,
                graphicalObjectIssues: violations.filter(v => v.category === 'graphical-object').length,
                focusIndicatorIssues: violations.filter(v => v.category === 'focus-indicator').length,
                stateChangeIssues: violations.filter(v => v.category === 'state-change').length,
                averageContrastRatio: this.calculateAverageContrast(violations)
            },
            screenshotPath: screenshotPath,
            recommendations: this.generateNonTextContrastRecommendations(violations)
        };
    }

    /**
     * Analyze UI components for contrast compliance
     */
    async analyzeUIComponents(page, options) {
        return await page.evaluate((contrastThreshold, contrastCode) => {
            // Inject the shared WCAG contrast helpers (__parseRgb, __getLuminance,
            // __getContrastRatio, __getEffectiveBackgroundColor, __isColorTransparent).
            eval(contrastCode);

            const violations = [];

            // WCAG contrast ratio between two computed CSS colours.
            // Unparseable colours return 21 (i.e. "no finding") rather than
            // silently degrading to black, which used to invent violations.
            function getContrastRatio(color1, color2) {
                const rgb1 = __parseRgb(color1);
                const rgb2 = __parseRgb(color2);
                if (!rgb1 || !rgb2) return 21;
                return __getContrastRatio(rgb1, rgb2);
            }

            // Effective background behind an element: walks ancestors until a
            // non-transparent background is found (a transparent immediate parent
            // must not be reported as the background — <body> may be the painter).
            function getBackgroundColor(element) {
                if (!element) return 'rgb(255, 255, 255)';
                const bg = __getEffectiveBackgroundColor(element);
                return 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')';
            }

            // A border is only painted when its style is not none/hidden AND its
            // used width is > 0. `border: none` still computes a border-color
            // (CSS initial value `currentColor`, i.e. the text colour), so
            // border-color alone is never evidence that a border exists.
            // Returns the first actually-painted, non-transparent side, or null.
            function getRenderedBorder(styles) {
                const sides = ['Top', 'Right', 'Bottom', 'Left'];
                for (const side of sides) {
                    const borderStyle = styles['border' + side + 'Style'];
                    const borderWidth = parseFloat(styles['border' + side + 'Width']);
                    const borderColor = styles['border' + side + 'Color'];
                    if (borderStyle && borderStyle !== 'none' && borderStyle !== 'hidden' &&
                        borderWidth > 0 && !__isColorTransparent(borderColor)) {
                        return {
                            color: borderColor,
                            side: side.toLowerCase(),
                            width: styles['border' + side + 'Width'],
                            style: borderStyle
                        };
                    }
                }
                return null;
            }

            // Check buttons
            const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
            for (let i = 0; i < buttons.length; i++) {
                const button = buttons[i];
                const styles = window.getComputedStyle(button);
                const renderedBorder = getRenderedBorder(styles);
                const backgroundColor = styles.backgroundColor;
                const parentBg = getBackgroundColor(button.parentElement);

                // Check border contrast (only for borders that are actually painted)
                if (renderedBorder) {
                    const contrast = getContrastRatio(renderedBorder.color, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-border-contrast',
                            category: 'ui-component',
                            severity: 'serious',
                            element: `button[${i}]`,
                            description: 'Button border has insufficient contrast against background',
                            details: {
                                borderColor: renderedBorder.color,
                                borderSide: renderedBorder.side,
                                borderWidth: renderedBorder.width,
                                backgroundColor: parentBg,
                                contrastRatio: Math.round(contrast * 100) / 100,
                                required: contrastThreshold,
                                tagName: button.tagName.toLowerCase(),
                                type: button.type || null,
                                id: button.id || null,
                                className: button.className || null
                            },
                            wcagCriteria: '1.4.11',
                            impact: 'Button boundaries are not clearly visible'
                        });
                    }
                }

                // Check background contrast for filled buttons
                if (backgroundColor && !__isColorTransparent(backgroundColor)) {
                    const contrast = getContrastRatio(backgroundColor, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-background-contrast',
                            category: 'ui-component',
                            severity: 'moderate',
                            element: `button[${i}]`,
                            description: 'Button background has insufficient contrast',
                            details: {
                                backgroundColor: backgroundColor,
                                parentBackground: parentBg,
                                contrastRatio: Math.round(contrast * 100) / 100,
                                required: contrastThreshold,
                                tagName: button.tagName.toLowerCase(),
                                id: button.id || null
                            },
                            wcagCriteria: '1.4.11',
                            impact: 'Button is not easily distinguishable from background'
                        });
                    }
                }
            }

            // Check form controls
            const formControls = document.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea');
            for (let i = 0; i < formControls.length; i++) {
                const control = formControls[i];
                const styles = window.getComputedStyle(control);
                const renderedBorder = getRenderedBorder(styles);
                const parentBg = getBackgroundColor(control.parentElement);

                if (renderedBorder) {
                    const contrast = getContrastRatio(renderedBorder.color, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-form-border-contrast',
                            category: 'ui-component',
                            severity: 'serious',
                            element: `${control.tagName.toLowerCase()}[${i}]`,
                            description: 'Form control border has insufficient contrast',
                            details: {
                                borderColor: renderedBorder.color,
                                borderSide: renderedBorder.side,
                                borderWidth: renderedBorder.width,
                                backgroundColor: parentBg,
                                contrastRatio: Math.round(contrast * 100) / 100,
                                required: contrastThreshold,
                                tagName: control.tagName.toLowerCase(),
                                type: control.type || null,
                                id: control.id || null
                            },
                            wcagCriteria: '1.4.11',
                            impact: 'Form control boundaries are not clearly visible'
                        });
                    }
                }
            }

            // Check custom controls (checkboxes, radio buttons, sliders)
            const customControls = document.querySelectorAll('[role="checkbox"], [role="radio"], [role="slider"], input[type="checkbox"], input[type="radio"], input[type="range"]');
            for (let i = 0; i < customControls.length; i++) {
                const control = customControls[i];
                const styles = window.getComputedStyle(control);
                const renderedBorder = getRenderedBorder(styles);
                const parentBg = getBackgroundColor(control.parentElement);

                // Check border contrast
                if (renderedBorder) {
                    const contrast = getContrastRatio(renderedBorder.color, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-custom-control-contrast',
                            category: 'ui-component',
                            severity: 'serious',
                            element: `${control.tagName.toLowerCase()}[${i}]`,
                            description: 'Custom control has insufficient border contrast',
                            details: {
                                borderColor: renderedBorder.color,
                                borderSide: renderedBorder.side,
                                borderWidth: renderedBorder.width,
                                backgroundColor: parentBg,
                                contrastRatio: Math.round(contrast * 100) / 100,
                                required: contrastThreshold,
                                role: control.getAttribute('role'),
                                type: control.type || null,
                                id: control.id || null
                            },
                            wcagCriteria: '1.4.11',
                            impact: 'Custom control boundaries are not clearly visible'
                        });
                    }
                }
            }

            return violations;
        }, options.contrastThreshold, contrastUtils);
    }

    /**
     * Analyze graphical objects for contrast compliance
     */
    async analyzeGraphicalObjects(page, options) {
        return await page.evaluate((contrastThreshold) => {
            const violations = [];

            // Check SVG elements
            const svgElements = document.querySelectorAll('svg *[fill], svg *[stroke]');
            for (let i = 0; i < svgElements.length; i++) {
                const element = svgElements[i];
                const fill = element.getAttribute('fill');
                const stroke = element.getAttribute('stroke');
                const svgParent = element.closest('svg');
                const svgStyles = window.getComputedStyle(svgParent);
                const parentBg = svgStyles.backgroundColor || 'rgb(255, 255, 255)';

                // Check fill contrast
                if (fill && fill !== 'none' && fill !== 'transparent') {
                    try {
                        const contrast = this.getContrastRatio(fill, parentBg);
                        if (contrast < contrastThreshold) {
                            violations.push({
                                type: 'insufficient-svg-fill-contrast',
                                category: 'graphical-object',
                                severity: 'moderate',
                                element: `svg ${element.tagName.toLowerCase()}[${i}]`,
                                description: 'SVG element fill has insufficient contrast',
                                details: {
                                    fillColor: fill,
                                    backgroundColor: parentBg,
                                    contrastRatio: Math.round(contrast * 100) / 100,
                                    required: contrastThreshold,
                                    tagName: element.tagName.toLowerCase()
                                },
                                wcagCriteria: '1.4.11',
                                impact: 'Graphical content may not be clearly visible'
                            });
                        }
                    } catch (e) {
                        // Skip invalid color values
                    }
                }

                // Check stroke contrast
                if (stroke && stroke !== 'none' && stroke !== 'transparent') {
                    try {
                        const contrast = this.getContrastRatio(stroke, parentBg);
                        if (contrast < contrastThreshold) {
                            violations.push({
                                type: 'insufficient-svg-stroke-contrast',
                                category: 'graphical-object',
                                severity: 'moderate',
                                element: `svg ${element.tagName.toLowerCase()}[${i}]`,
                                description: 'SVG element stroke has insufficient contrast',
                                details: {
                                    strokeColor: stroke,
                                    backgroundColor: parentBg,
                                    contrastRatio: Math.round(contrast * 100) / 100,
                                    required: contrastThreshold,
                                    tagName: element.tagName.toLowerCase()
                                },
                                wcagCriteria: '1.4.11',
                                impact: 'Graphical boundaries may not be clearly visible'
                            });
                        }
                    } catch (e) {
                        // Skip invalid color values
                    }
                }
            }

            // Check canvas elements (basic analysis)
            const canvasElements = document.querySelectorAll('canvas');
            for (let i = 0; i < canvasElements.length; i++) {
                const canvas = canvasElements[i];
                const parentBg = window.getComputedStyle(canvas.parentElement).backgroundColor || 'rgb(255, 255, 255)';

                // Check canvas background
                const canvasStyles = window.getComputedStyle(canvas);
                const canvasBg = canvasStyles.backgroundColor;

                if (canvasBg && canvasBg !== 'rgba(0, 0, 0, 0)' && canvasBg !== 'transparent') {
                    try {
                        const contrast = this.getContrastRatio(canvasBg, parentBg);
                        if (contrast < contrastThreshold) {
                            violations.push({
                                type: 'insufficient-canvas-contrast',
                                category: 'graphical-object',
                                severity: 'moderate',
                                element: `canvas[${i}]`,
                                description: 'Canvas element has insufficient background contrast',
                                details: {
                                    canvasBackground: canvasBg,
                                    parentBackground: parentBg,
                                    contrastRatio: Math.round(contrast * 100) / 100,
                                    required: contrastThreshold,
                                    id: canvas.id || null
                                },
                                wcagCriteria: '1.4.11',
                                impact: 'Canvas content may not be clearly distinguishable'
                            });
                        }
                    } catch (e) {
                        // Skip invalid color values
                    }
                }
            }

            // Check progress bars
            const progressBars = document.querySelectorAll('progress, [role="progressbar"]');
            for (let i = 0; i < progressBars.length; i++) {
                const progress = progressBars[i];
                const styles = window.getComputedStyle(progress);
                const backgroundColor = styles.backgroundColor;
                const borderColor = styles.borderColor || styles.borderTopColor;
                const borderStyle = styles.borderTopStyle;
                const borderWidth = parseFloat(styles.borderTopWidth);
                // `border: none` still computes a border-color; only a border that
                // is actually painted can have a contrast problem.
                const hasRenderedBorder = borderStyle && borderStyle !== 'none' &&
                    borderStyle !== 'hidden' && borderWidth > 0;
                const parentBg = window.getComputedStyle(progress.parentElement).backgroundColor || 'rgb(255, 255, 255)';

                // Check progress bar border
                if (hasRenderedBorder && borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
                    try {
                        const contrast = this.getContrastRatio(borderColor, parentBg);
                        if (contrast < contrastThreshold) {
                            violations.push({
                                type: 'insufficient-progress-border-contrast',
                                category: 'ui-component',
                                severity: 'moderate',
                                element: `progress[${i}]`,
                                description: 'Progress bar border has insufficient contrast',
                                details: {
                                    borderColor: borderColor,
                                    backgroundColor: parentBg,
                                    contrastRatio: Math.round(contrast * 100) / 100,
                                    required: contrastThreshold,
                                    id: progress.id || null
                                },
                                wcagCriteria: '1.4.11',
                                impact: 'Progress bar boundaries are not clearly visible'
                            });
                        }
                    } catch (e) {
                        // Skip invalid color values
                    }
                }
            }

            return violations;
        }, options.contrastThreshold);
    }

    /**
     * Analyze focus indicators for contrast compliance.
     *
     * The focus state is read by actually focusing the element and then reading its
     * (live) computed style. `getComputedStyle(el, ':focus')` does NOT work: the
     * second argument selects a pseudo-ELEMENT (`::before`), not a pseudo-CLASS, and
     * returns an inert style object whose properties come back as empty strings.
     *
     * Each element is snapshotted before and after focusing so that "focus changes
     * nothing at all" can be distinguished from "focus applies a visible indicator",
     * and focus is released again so the page is left in its prior state.
     */
    async analyzeFocusIndicators(page, options) {
        return await page.evaluate((contrastThreshold, contrastCode) => {
            // Inject the shared WCAG contrast helpers.
            eval(contrastCode);

            const violations = [];
            const FOCUSABLE_SELECTOR = 'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

            // Style properties that can carry a focus indication.
            const TRACKED_PROPS = [
                'outlineStyle', 'outlineColor', 'outlineWidth', 'outlineOffset',
                'boxShadow', 'backgroundColor', 'backgroundImage', 'color',
                'textDecorationLine', 'filter', 'transform',
                'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
                'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
                'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'
            ];

            // Computed style objects are LIVE, so the values must be copied out
            // before the element's state changes.
            function snapshot(el) {
                const computed = window.getComputedStyle(el);
                const snap = {};
                for (const prop of TRACKED_PROPS) snap[prop] = computed[prop];
                return snap;
            }

            function hasPaintedOutline(snap) {
                return !!snap.outlineStyle && snap.outlineStyle !== 'none' &&
                    parseFloat(snap.outlineWidth) > 0 &&
                    !__isColorTransparent(snap.outlineColor);
            }

            // A border side only paints when its style is not none/hidden and its
            // used width is > 0 (`border: none` still computes a border-color).
            function hasPaintedBorderSide(snap, side) {
                const borderStyle = snap['border' + side + 'Style'];
                return !!borderStyle && borderStyle !== 'none' && borderStyle !== 'hidden' &&
                    parseFloat(snap['border' + side + 'Width']) > 0 &&
                    !__isColorTransparent(snap['border' + side + 'Color']);
            }

            // Human-findable description, serialised only for reporting. The live
            // element reference is used for every measurement — the previous
            // implementation re-selected elements with a generated
            // `tagName:nth-of-type(n)` expression that did not match the element it
            // had enumerated, so it measured the wrong node (or none at all).
            function describeElement(el) {
                let out = el.tagName.toLowerCase();
                if (el.id) out += `#${el.id}`;
                const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
                if (cls.length) out += `.${cls.join('.')}`;
                return out;
            }

            const elements = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).slice(0, 20);

            for (let index = 0; index < elements.length; index++) {
              // One unanalysable element must not abort the whole check.
              try {
                const element = elements[index];
                const info = {
                    selector: `${element.tagName.toLowerCase()}[${index}]`,
                    cssSelector: describeElement(element),
                    tagName: element.tagName.toLowerCase(),
                    type: element.type || null,
                    id: element.id || null
                };

                let unfocused = null;
                let focused = null;
                let didFocus = false;
                const previouslyFocused = document.activeElement;

                try {
                    unfocused = snapshot(element);
                    // preventScroll keeps the viewport where it was, so focusing does
                    // not perturb layout/scroll-dependent checks elsewhere.
                    element.focus({ preventScroll: true });
                    didFocus = document.activeElement === element;
                    focused = snapshot(element);
                } catch (e) {
                    continue;
                } finally {
                    // Leave the page as we found it.
                    try {
                        if (typeof element.blur === 'function') element.blur();
                        if (previouslyFocused && previouslyFocused !== element &&
                            previouslyFocused !== document.body &&
                            typeof previouslyFocused.focus === 'function') {
                            previouslyFocused.focus({ preventScroll: true });
                        }
                    } catch (e) { /* restoring focus is best-effort */ }
                }

                // Element cannot take focus at all (disabled, hidden, <a> without
                // href, ...). It is not reachable, so focus indication does not apply.
                if (!didFocus || !focused) continue;

                // `outline-style: auto` is the user agent's own focus ring. The UA
                // paints a platform-specific, deliberately always-visible treatment
                // (Chrome draws a dual-tone ring), and the computed `outline-color`
                // is not what actually gets painted — running it through a contrast
                // check would be meaningless.
                if (focused.outlineStyle === 'auto') continue;

                if (hasPaintedOutline(focused)) {
                    const outlineRgb = __parseRgb(focused.outlineColor);
                    if (!outlineRgb) continue;

                    // The ring sits between the element and whatever is behind it.
                    // WCAG 1.4.11 requires 3:1 against *adjacent* colour, so it passes
                    // when it is distinguishable from either neighbour (e.g. a white
                    // ring around a black chip on a white page is clearly visible).
                    const surroundingBg = __getEffectiveBackgroundColor(element.parentElement || element);
                    const ownBg = __getEffectiveBackgroundColor(element);
                    const contrast = Math.max(
                        __getContrastRatio(outlineRgb, surroundingBg),
                        __getContrastRatio(outlineRgb, ownBg)
                    );

                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-focus-indicator-contrast',
                            category: 'focus-indicator',
                            severity: 'serious',
                            element: info.selector,
                            description: 'Focus indicator has insufficient contrast against background',
                            details: {
                                outlineColor: focused.outlineColor,
                                backgroundColor: `rgb(${surroundingBg.r}, ${surroundingBg.g}, ${surroundingBg.b})`,
                                elementBackground: `rgb(${ownBg.r}, ${ownBg.g}, ${ownBg.b})`,
                                outlineWidth: focused.outlineWidth,
                                contrastRatio: Math.round(contrast * 100) / 100,
                                required: contrastThreshold,
                                cssSelector: info.cssSelector,
                                tagName: info.tagName,
                                type: info.type,
                                id: info.id
                            },
                            wcagCriteria: '1.4.11',
                            impact: 'Focus indicator is not clearly visible to users'
                        });
                    }
                    continue;
                }

                // No painted outline — any other change caused by focusing that
                // results in something actually visible counts as an indicator.
                const boxShadowIndicator = focused.boxShadow !== unfocused.boxShadow &&
                    !!focused.boxShadow && focused.boxShadow !== 'none';

                const backgroundIndicator =
                    (focused.backgroundColor !== unfocused.backgroundColor &&
                        !__isColorTransparent(focused.backgroundColor)) ||
                    (focused.backgroundImage !== unfocused.backgroundImage &&
                        !!focused.backgroundImage && focused.backgroundImage !== 'none');

                const borderIndicator = ['Top', 'Right', 'Bottom', 'Left'].some(side =>
                    (focused['border' + side + 'Color'] !== unfocused['border' + side + 'Color'] ||
                        focused['border' + side + 'Width'] !== unfocused['border' + side + 'Width'] ||
                        focused['border' + side + 'Style'] !== unfocused['border' + side + 'Style']) &&
                    hasPaintedBorderSide(focused, side));

                const textIndicator = focused.color !== unfocused.color ||
                    focused.textDecorationLine !== unfocused.textDecorationLine;

                const effectIndicator = focused.filter !== unfocused.filter ||
                    focused.transform !== unfocused.transform;

                if (boxShadowIndicator || backgroundIndicator || borderIndicator ||
                    textIndicator || effectIndicator) {
                    continue;
                }

                violations.push({
                    type: 'missing-focus-indicator',
                    category: 'focus-indicator',
                    severity: 'critical',
                    element: info.selector,
                    description: 'Element lacks visible focus indicator',
                    details: {
                        cssSelector: info.cssSelector,
                        tagName: info.tagName,
                        type: info.type,
                        id: info.id,
                        outline: `${focused.outlineStyle} ${focused.outlineWidth} ${focused.outlineColor}`,
                        boxShadow: focused.boxShadow,
                        borderColor: focused.borderTopColor,
                        unfocusedOutline: `${unfocused.outlineStyle} ${unfocused.outlineWidth} ${unfocused.outlineColor}`
                    },
                    wcagCriteria: '1.4.11',
                    impact: 'Users cannot see which element has focus'
                });
              } catch (e) {
                // Skip elements that cannot be focused or inspected
              }
            }

            return violations;
        }, options.contrastThreshold, contrastUtils);
    }

    /**
     * Analyze interactive states for contrast compliance
     */
    async analyzeInteractiveStates(page, options) {
        return await page.evaluate((contrastThreshold) => {
            const violations = [];

            // Check hover states
            const interactiveElements = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');

            for (let i = 0; i < Math.min(interactiveElements.length, 15); i++) { // Limit for performance
                const element = interactiveElements[i];
                const normalStyles = window.getComputedStyle(element);

                // Simulate hover by checking CSS hover rules
                try {
                    // Create temporary element to test hover styles
                    const testEl = element.cloneNode(true);
                    testEl.style.cssText = normalStyles.cssText;

                    // Check if element has hover styles defined
                    const sheets = Array.from(document.styleSheets);
                    let hasHoverStyles = false;

                    for (const sheet of sheets) {
                        try {
                            const rules = Array.from(sheet.cssRules || []);
                            for (const rule of rules) {
                                if (rule.selectorText && rule.selectorText.includes(':hover')) {
                                    hasHoverStyles = true;
                                    break;
                                }
                            }
                        } catch (e) {
                            // Skip CORS-blocked stylesheets
                        }
                    }

                    if (hasHoverStyles) {
                        // Basic check for hover state visibility.
                        // NOTE: unlike the border-contrast checks above, this reads
                        // border-color with inverted polarity — an opaque colour is
                        // taken as evidence that the element HAS a boundary, and only
                        // the absence of one is reported. Adding the
                        // border-style/border-width "is it actually painted" guard
                        // here would therefore make the check fire MORE often (every
                        // `border: none` element would newly qualify), so it is
                        // deliberately not applied. This heuristic is over-broad for
                        // an unrelated reason — it flags plain text links, which SC
                        // 1.4.11 exempts as text — and wants narrowing, not a guard.
                        const backgroundColor = normalStyles.backgroundColor;
                        const borderColor = normalStyles.borderColor;
                        const parentBg = window.getComputedStyle(element.parentElement).backgroundColor || 'rgb(255, 255, 255)';

                        // Check if element has sufficient visual distinction
                        if (backgroundColor === 'rgba(0, 0, 0, 0)' || backgroundColor === 'transparent') {
                            if (!borderColor || borderColor === 'rgba(0, 0, 0, 0)' || borderColor === 'transparent') {
                                violations.push({
                                    type: 'insufficient-interactive-state-contrast',
                                    category: 'state-change',
                                    severity: 'moderate',
                                    element: `${element.tagName.toLowerCase()}[${i}]`,
                                    description: 'Interactive element may lack sufficient visual distinction in different states',
                                    details: {
                                        backgroundColor: backgroundColor,
                                        borderColor: borderColor,
                                        parentBackground: parentBg,
                                        tagName: element.tagName.toLowerCase(),
                                        type: element.type || null,
                                        id: element.id || null
                                    },
                                    wcagCriteria: '1.4.11',
                                    impact: 'Interactive states may not be clearly distinguishable'
                                });
                            }
                        }
                    }
                } catch (e) {
                    // Skip elements that can't be analyzed
                }
            }

            return violations;
        }, options.contrastThreshold);
    }

    /**
     * Calculate average contrast ratio from violations
     */
    calculateAverageContrast(violations) {
        const contrastViolations = violations.filter(v => v.details && v.details.contrastRatio);
        if (contrastViolations.length === 0) return 'N/A';

        const average = contrastViolations.reduce((sum, v) => sum + v.details.contrastRatio, 0) / contrastViolations.length;
        return Math.round(average * 100) / 100;
    }

    /**
     * Get count of passed elements (estimated)
     */
    getPassedElementsCount(violations) {
        // Estimate based on typical page composition
        return Math.max(50 - violations.length, 0);
    }

    /**
     * Generate recommendations for non-text contrast issues
     */
    generateNonTextContrastRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.includes('insufficient-border-contrast') ||
            issueTypes.includes('insufficient-form-border-contrast')) {
            recommendations.push({
                priority: 'high',
                issue: 'UI component border contrast',
                solution: 'Increase border contrast to 3:1 minimum against background',
                implementation: 'Use darker border colors or add additional visual indicators'
            });
        }

        if (issueTypes.includes('insufficient-focus-indicator-contrast') ||
            issueTypes.includes('missing-focus-indicator')) {
            recommendations.push({
                priority: 'critical',
                issue: 'Focus indicator visibility',
                solution: 'Ensure focus indicators have 3:1 contrast and are clearly visible',
                implementation: 'Add visible outline or box-shadow with sufficient contrast'
            });
        }

        if (issueTypes.includes('insufficient-svg-fill-contrast') ||
            issueTypes.includes('insufficient-svg-stroke-contrast')) {
            recommendations.push({
                priority: 'medium',
                issue: 'Graphical object contrast',
                solution: 'Ensure meaningful graphics have 3:1 contrast against background',
                implementation: 'Adjust fill and stroke colors for better visibility'
            });
        }

        if (issueTypes.includes('insufficient-custom-control-contrast')) {
            recommendations.push({
                priority: 'high',
                issue: 'Custom control visibility',
                solution: 'Make custom controls clearly distinguishable from background',
                implementation: 'Add borders, shadows, or background colors with sufficient contrast'
            });
        }

        return recommendations;
    }

}

module.exports = NonTextContrastScanner;
