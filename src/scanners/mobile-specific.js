const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');
const { injectableCode: clipCode } = require('../utils/text-clipping');

/**
 * Phase 6D: Mobile Specific Accessibility Scanner
 * Implements mobile-specific WCAG criteria: 400% zoom, orientation, viewport meta (touch targets live in input-modalities)
 * Critical for mobile accessibility compliance and responsive design testing
 * CSP-independent implementation using Puppeteer viewport simulation
 */
class MobileSpecificScanner extends BaseScanner {
    constructor() {
        super('mobile-specific', {
            wcagCriteria: ['1.4.10'],
            wcagPrinciple: 'operable',
        });
        this.mobileViewports = {
            'iPhone SE': { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true },
            'iPhone 12': { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
            'Samsung Galaxy S21': { width: 360, height: 800, deviceScaleFactor: 3, isMobile: true },
            'iPad': { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true },
            'Tablet Landscape': { width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true }
        };
    }

    get needsExclusiveAccess() { return true; }

    /**
     * Core scan method — receives an already-navigated Puppeteer page.
     * Note: This scanner re-navigates internally (per-device viewport testing) since it has exclusive access.
     * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} ScanResult
     */
    async scan(page, options = {}) {
        const scanOptions = {
            test400PercentZoom: true,
            testOrientation: true,
            testViewportMeta: true,
            testScrollHorizontal: true,
            testInteractionSize: true,
            testDeviceAdaptation: true,
            timeout: 60000,
            ...options,
        };

        const screenshotDir = options.screenshotDir || this.screenshotDir;
        await fs.ensureDir(screenshotDir);

        const timestamp = Date.now();
        const scanDir = path.join(screenshotDir, `scan-${timestamp}`);
        await fs.ensureDir(scanDir);

        // Get the current URL from the already-navigated page for internal re-navigation
        const url = page.url();

        let violations = [];
        const viewportResults = {};

        // Auto-dismiss JS dialogs (alert/confirm/prompt). A page that opens a native
        // dialog blocks its renderer main thread indefinitely, which makes every
        // subsequent page.evaluate() hang until Puppeteer's protocolTimeout (180s)
        // fires. Real sites and several test fixtures do this on a timer.
        const dialogHandler = (dialog) => {
            dialog.dismiss().catch(() => { /* dialog already gone */ });
        };
        page.on('dialog', dialogHandler);

        try {
            // Test on different mobile viewports
            const viewports = scanOptions.mobileViewports || this.mobileViewports;
            let viewportMetaChecked = false;
            for (const [deviceName, viewport] of Object.entries(viewports)) {
                console.log(`Testing on ${deviceName}...`);

                await page.setViewport(viewport);
                await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

                // Take screenshot for each device
                const screenshotPath = path.join(scanDir, `${deviceName.replace(/\s+/g, '-')}.png`);
                await page.screenshot({
                    path: screenshotPath,
                    fullPage: true
                });

                const deviceViolations = [];

                // Test 400% zoom compliance
                if (scanOptions.test400PercentZoom) {
                    const zoomViolations = await this.test400PercentZoom(page, deviceName, viewport);
                    deviceViolations.push(...zoomViolations);
                }

                // Test viewport meta tag
                if (scanOptions.testViewportMeta && !viewportMetaChecked) {
                    viewportMetaChecked = true;
                    const viewportViolations = await this.testViewportMeta(page, deviceName);
                    deviceViolations.push(...viewportViolations);
                }

                // Test horizontal scrolling
                if (scanOptions.testScrollHorizontal) {
                    const scrollViolations = await this.testHorizontalScrolling(page, deviceName, viewport);
                    deviceViolations.push(...scrollViolations);
                }

                // Test device adaptation
                if (scanOptions.testDeviceAdaptation) {
                    const adaptationViolations = await this.testDeviceAdaptation(page, deviceName, viewport);
                    deviceViolations.push(...adaptationViolations);
                }

                viewportResults[deviceName] = {
                    viewport: viewport,
                    violations: deviceViolations,
                    screenshotPath: screenshotPath
                };

                violations.push(...deviceViolations);
            }

            // Test orientation changes
            if (scanOptions.testOrientation) {
                const orientationViolations = await this.testOrientationChanges(page, scanDir);
                violations.push(...orientationViolations);
            }
        } finally {
            page.off('dialog', dialogHandler);
        }

        violations = this.deduplicateAcrossDevices(violations);

        return {
            scannerId: this.id,
            criteria: ["1.4.4", "1.4.10"],
            passed: violations.length === 0,
            violations: violations,
            summary: {
                totalDevicesTested: Object.keys(this.mobileViewports).length,
                zoom400PercentIssues: violations.filter(v => v.category === '400-percent-zoom').length,
                                orientationIssues: violations.filter(v => v.category === 'orientation').length,
                viewportIssues: violations.filter(v => v.category === 'viewport-meta').length,
                horizontalScrollIssues: violations.filter(v => v.category === 'horizontal-scroll').length,
                deviceAdaptationIssues: violations.filter(v => v.category === 'device-adaptation').length
            },
            viewportResults: viewportResults,
            screenshotDir: scanDir,
            recommendations: this.generateMobileRecommendations(violations),
            mobileTestingGuidance: this.generateMobileTestingGuidance(violations)
        };
    }

    /**
     * Test 400% zoom compliance on mobile devices
     */
    async test400PercentZoom(page, deviceName, viewport) {
        return await page.evaluate((device, viewportInfo, renderedSrc, clipSrc) => {
            eval(renderedSrc);
            eval(clipSrc);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string' 
                    ? `.${element.className.split(' ')[0]}` 
                    : '';
                return `${tagName}${id}${className}`;
            }

            function isSrOnly(el) {
                if (!el || el.nodeType !== 1) return false;
                const cls = el.className || '';
                if (typeof cls === 'string' && (/\bsr-only\b/.test(cls) || /\bvisually-hidden\b/.test(cls))) return true;
                const s = window.getComputedStyle(el);
                if (s.position !== 'absolute' && s.position !== 'fixed') return false;
                const w = parseFloat(s.width), h = parseFloat(s.height);
                if (w > 1 || h > 1) return false;
                if (s.overflow !== 'hidden') return false;
                return true;
            }

            // Collect elements whose width is *authored* as a fixed px value, either in an
            // applicable CSS rule or in an inline style. This is the key distinction ported
            // from responsive-design-scanner: a computed `width` is always resolved to px by
            // layout, so `getComputedStyle(el).width === '900px'` is NOT evidence that the
            // author set a fixed width — a fully responsive <li> reports px too. Only an
            // explicit px declaration in the cascade means the element cannot reflow.
            const authoredPxWidth = new Set();

            function collectAuthoredPxWidths(ruleList) {
                for (const rule of ruleList || []) {
                    // Style rules carry selectorText. Checked BEFORE the grouping branch
                    // because since CSS Nesting shipped, every CSSStyleRule in Chrome also
                    // exposes a (usually empty) .cssRules list — testing that first would
                    // silently skip every ordinary rule.
                    const sel = rule.selectorText;
                    if (typeof sel === 'string' && sel && !sel.includes('::')) {
                        const declaredWidth = rule.style && rule.style.width;
                        if (declaredWidth && declaredWidth.endsWith('px')) {
                            try {
                                const matched = document.querySelectorAll(sel);
                                for (let m = 0; m < matched.length; m++) authoredPxWidth.add(matched[m]);
                            } catch (e) { /* selector not supported by querySelectorAll */ }
                        }
                    }

                    // Grouping rules (@media, @supports) and CSS-nesting children:
                    // only descend into media queries that currently apply.
                    if (rule.cssRules && rule.cssRules.length) {
                        if (rule.media && typeof rule.conditionText === 'string') {
                            try {
                                if (!window.matchMedia(rule.conditionText).matches) continue;
                            } catch (e) { /* unparseable condition — descend anyway */ }
                        }
                        collectAuthoredPxWidths(rule.cssRules);
                    }
                }
            }

            try {
                for (const sheet of document.styleSheets) {
                    try {
                        collectAuthoredPxWidths(sheet.cssRules);
                    } catch (e) { /* cross-origin stylesheet */ }
                }
            } catch (e) { /* no stylesheets */ }

            // Simulate 400% zoom by checking if content scales properly
            // Check for fixed-size containers that would break at 400% zoom
            const fixedWidthElements = document.querySelectorAll('*');

            for (let i = 0; i < fixedWidthElements.length; i++) {
                const element = fixedWidthElements[i];
                if (isSrOnly(element)) continue;
                const computedStyle = window.getComputedStyle(element);

                // Check for problematic fixed widths on mobile
                const width = computedStyle.width;
                const maxWidth = computedStyle.maxWidth;

                const hasInlineWidth = element.style.width && element.style.width.endsWith('px');
                const hasFixedCssWidth = hasInlineWidth || authoredPxWidth.has(element);

                // Skip elements using responsive layout — computed px width is from layout, not fixed CSS
                const mw = maxWidth;
                const isResponsive = mw && (mw.endsWith('%') || mw.endsWith('vw') || mw === '100%');

                const parentEl = element.parentElement;
                const parentStyle = parentEl ? window.getComputedStyle(parentEl) : null;
                const isFlexGridChild = parentStyle && (parentStyle.display === 'flex' || parentStyle.display === 'grid' ||
                    parentStyle.display === 'inline-flex' || parentStyle.display === 'inline-grid');
                const isSelfFlexGrid = computedStyle.display === 'flex' || computedStyle.display === 'grid' ||
                    computedStyle.display === 'inline-flex' || computedStyle.display === 'inline-grid';
                const skipWidthCheck = !hasFixedCssWidth || isResponsive || isFlexGridChild || isSelfFlexGrid;

                if (!skipWidthCheck && width && width.endsWith('px')) {
                    const widthValue = parseInt(width);
                    // On mobile, fixed widths over 50% of viewport width are problematic at 400% zoom
                    if (widthValue > (viewportInfo.width * 0.5)) {
                        violations.push({
                            type: 'mobile-fixed-width-400-zoom',
                            category: '400-percent-zoom',
                            severity: 'serious',
                            element: getElementSelector(element),
                            description: 'Element has fixed width that may cause issues at 400% zoom on mobile',
                            details: {
                                device: device,
                                width: width,
                                viewportWidth: viewportInfo.width,
                                elementTag: element.tagName.toLowerCase(),
                                elementId: element.id,
                                elementClass: element.className
                            },
                            wcagCriteria: '1.4.4',
                            impact: '400% zoom may cause horizontal scrolling or content cutoff on mobile',
                            recommendation: 'Use relative units (%, em, rem) or max-width: 100% for mobile compatibility'
                        });
                    }
                }

                // `mobile-small-text-400-zoom` (font-size < 12px) was removed: browser
                // and pinch zoom scale px text, so a small px font is never by itself a
                // 1.4.4 failure — it produced 215 findings on a WCAG-AA-conformant
                // corpus. The readability hint still exists once, viewport-independently,
                // as `small-fixed-font` (severity info) in phase6a-text-resize-scanner.
            }

            // Content that is actually clipped away at this viewport. Measured on the
            // painted glyph boxes (src/utils/text-clipping.js) instead of
            // `scrollWidth > clientWidth`, which fires on any container whose child
            // box sticks out by a few rounded pixels while all text stays visible.
            for (const clip of window.__findClippedText({ minChars: 3 })) {
                violations.push({
                    type: 'mobile-overflow-hidden-400-zoom',
                    category: '400-percent-zoom',
                    // line-clamp/ellipsis is authored truncation, identical at every
                    // width, with the full text still in the accessibility tree.
                    severity: clip.truncationDeclared ? 'info' : 'moderate',
                    element: clip.selector,
                    description: clip.truncationDeclared
                        ? `Element truncates text on purpose (line-clamp/ellipsis) at ${viewportInfo.width}px viewport width`
                        : `Element with overflow:hidden clips text at ${viewportInfo.width}px viewport width`,
                    details: {
                        device: device,
                        truncationDeclared: clip.truncationDeclared,
                        lineClamp: clip.lineClamp,
                        viewportWidth: viewportInfo.width,
                        axis: clip.axis,
                        overshootX: clip.overshootX,
                        overshootY: clip.overshootY,
                        clippedCharacters: clip.clippedChars,
                        clippedTextSamples: clip.samples,
                        scrollWidth: clip.scrollWidth,
                        clientWidth: clip.clientWidth,
                        overflow: clip.overflow
                    },
                    wcagCriteria: '1.4.10',
                    impact: 'Text is cut off and cannot be revealed by scrolling on this device width',
                    recommendation: 'Use overflow: auto/visible or let the container reflow instead of clipping'
                });
            }

            return violations;
        }, deviceName, viewport, renderedCode, clipCode);
    }

    /**
     * Touch-target size (WCAG 2.5.8, 24x24 CSS px with the spacing exception) is
     * checked ONCE, viewport-independently, by input-modalities-scanner.js
     * (analyzeTargetSize). A per-device check here would multiply every hit
     * by the number of device profiles.
     */

    /**
     * One finding per (type, element) across all device profiles. The same
     * overflowing element measured on five devices is one defect, not five;
     * the devices it was seen on are kept in `affectedDevices`.
     */
    deduplicateAcrossDevices(violations) {
        const map = new Map();
        for (const v of violations) {
            const key = `${v.type}::${v.element || ''}`;
            const device = v.details && v.details.device;
            if (map.has(key)) {
                const existing = map.get(key);
                if (device && !existing.affectedDevices.includes(device)) existing.affectedDevices.push(device);
                continue;
            }
            const copy = { ...v, affectedDevices: device ? [device] : [] };
            map.set(key, copy);
        }
        return [...map.values()];
    }

    /**
     * Test viewport meta tag configuration
     */
    async testViewportMeta(page, deviceName) {
        return await page.evaluate((device) => {
            const violations = [];

            const viewportMeta = document.querySelector('meta[name="viewport"]');
            
            if (!viewportMeta) {
                violations.push({
                    type: 'missing-viewport-meta',
                    category: 'viewport-meta',
                    severity: 'serious',
                    element: 'head',
                    description: 'Missing viewport meta tag for mobile optimization',
                    details: {
                        device: device,
                        hasViewportMeta: false
                    },
                    wcagCriteria: '1.4.10',
                    impact: 'Page may not render properly on mobile devices',
                    recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">'
                });
            } else {
                const content = viewportMeta.getAttribute('content') || '';
                
                // Check for problematic viewport settings
                if (content.includes('user-scalable=no')) {
                    violations.push({
                        type: 'viewport-prevents-zoom',
                        category: 'viewport-meta',
                        severity: 'serious',
                        element: 'meta[name="viewport"]',
                        description: 'Viewport meta tag prevents user scaling/zooming',
                        details: {
                            device: device,
                            viewportContent: content
                        },
                        wcagCriteria: '1.4.4',
                        impact: 'Users cannot zoom to 400% as required by WCAG',
                        recommendation: 'Remove user-scalable=no or set user-scalable=yes'
                    });
                }

                if (content.includes('maximum-scale=1')) {
                    violations.push({
                        type: 'viewport-limits-zoom',
                        category: 'viewport-meta',
                        severity: 'serious',
                        element: 'meta[name="viewport"]',
                        description: 'Viewport meta tag limits maximum zoom to 100%',
                        details: {
                            device: device,
                            viewportContent: content
                        },
                        wcagCriteria: '1.4.4',
                        impact: 'Users cannot zoom to 400% as required by WCAG',
                        recommendation: 'Remove maximum-scale=1 or set maximum-scale=5.0 or higher'
                    });
                }

                if (!content.includes('width=device-width')) {
                    violations.push({
                        type: 'viewport-missing-device-width',
                        category: 'viewport-meta',
                        severity: 'moderate',
                        element: 'meta[name="viewport"]',
                        description: 'Viewport meta tag missing width=device-width',
                        details: {
                            device: device,
                            viewportContent: content
                        },
                        wcagCriteria: '1.4.10',
                        impact: 'Page may not adapt properly to device width',
                        recommendation: 'Include width=device-width in viewport meta tag'
                    });
                }
            }

            return violations;
        }, deviceName);
    }

    /**
     * Test for horizontal scrolling issues on mobile
     */
    async testHorizontalScrolling(page, deviceName, viewport) {
        return await page.evaluate((device, viewportInfo) => {
            const violations = [];

            // Check if page has horizontal scrolling
            const bodyScrollWidth = document.body.scrollWidth;
            const windowWidth = window.innerWidth;
            
            if (bodyScrollWidth > windowWidth + 1) {
                violations.push({
                    type: 'horizontal-scroll-mobile',
                    category: 'horizontal-scroll',
                    severity: 'serious',
                    element: 'body',
                    description: 'Page requires horizontal scrolling on mobile device',
                    details: {
                        device: device,
                        viewportWidth: viewportInfo.width,
                        windowWidth: windowWidth,
                        bodyScrollWidth: bodyScrollWidth,
                        excessWidth: bodyScrollWidth - windowWidth
                    },
                    wcagCriteria: '1.4.10',
                    impact: 'Users must scroll horizontally to view content',
                    recommendation: 'Ensure content fits within viewport width using responsive design'
                });
            }

            // Find elements that cause horizontal overflow. Only meaningful when the
            // document itself overflows: an element sticking out of an
            // overflow:hidden ancestor never produces a scrollbar (it is clipped,
            // which the 400%-zoom check reports separately), and a 0x0 or
            // display:none element has no box to overflow with.
            const allElements = bodyScrollWidth > windowWidth + 1 ? document.querySelectorAll('body *') : [];
            function clippedByAncestor(el) {
                let p = el.parentElement;
                while (p && p !== document.body) {
                    const ox = window.getComputedStyle(p).overflowX;
                    if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return true;
                    p = p.parentElement;
                }
                return false;
            }
            for (let i = 0; i < allElements.length; i++) {
                const element = allElements[i];
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                if (rect.right > windowWidth + 10 && !clippedByAncestor(element)) { // 10px tolerance
                    const computedStyle = window.getComputedStyle(element);
                    
                    violations.push({
                        type: 'element-overflow-mobile',
                        category: 'horizontal-scroll',
                        severity: 'moderate',
                        element: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '') + (element.className ? `.${element.className.split(' ')[0]}` : ''),
                        description: 'Element extends beyond viewport width on mobile',
                        details: {
                            device: device,
                            elementRight: Math.round(rect.right),
                            windowWidth: windowWidth,
                            overflow: Math.round(rect.right - windowWidth),
                            elementWidth: Math.round(rect.width),
                            computedWidth: computedStyle.width,
                            elementTag: element.tagName.toLowerCase()
                        },
                        wcagCriteria: '1.4.10',
                        impact: 'Element causes horizontal scrolling on mobile',
                        recommendation: 'Use responsive design to contain element within viewport'
                    });
                }
            }

            return violations;
        }, deviceName, viewport);
    }

    /**
     * Test device adaptation and responsive design
     */
    async testDeviceAdaptation(page, deviceName, viewport) {
        return await page.evaluate((device, viewportInfo) => {
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string' 
                    ? `.${element.className.split(' ')[0]}` 
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Check for elements that don't adapt to mobile
            const images = document.querySelectorAll('img');
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                const rect = img.getBoundingClientRect();
                
                if (rect.width > viewportInfo.width + 1) {
                    violations.push({
                        type: 'image-not-responsive',
                        category: 'device-adaptation',
                        severity: 'moderate',
                        element: getElementSelector(img),
                        description: 'Image does not scale responsively for mobile device',
                        details: {
                            device: device,
                            imageWidth: Math.round(rect.width),
                            viewportWidth: viewportInfo.width,
                            src: img.src,
                            hasMaxWidth: window.getComputedStyle(img).maxWidth !== 'none'
                        },
                        wcagCriteria: '1.4.10',
                        impact: 'Image may cause horizontal scrolling or poor user experience',
                        recommendation: 'Use max-width: 100% or responsive image techniques'
                    });
                }
            }

            // Check for tables that don't adapt to mobile
            const tables = document.querySelectorAll('table');
            for (let i = 0; i < tables.length; i++) {
                const table = tables[i];
                const rect = table.getBoundingClientRect();

                if (rect.width > viewportInfo.width + 1) {
                    // A table wider than the viewport is only a problem if the user
                    // cannot scroll to it: class-name matching missed every
                    // `overflow-x: auto` wrapper that was styled without one of the
                    // three hard-coded class names.
                    let scrollableAncestor = null;
                    for (let p = table.parentElement; p && p !== document.body; p = p.parentElement) {
                        const ox = window.getComputedStyle(p).overflowX;
                        if (ox === 'auto' || ox === 'scroll') { scrollableAncestor = p; break; }
                    }

                    if (!scrollableAncestor) {
                        violations.push({
                            type: 'table-not-responsive',
                            category: 'device-adaptation',
                            severity: 'moderate',
                            element: getElementSelector(table),
                            description: 'Table does not have responsive container for mobile viewing',
                            details: {
                                device: device,
                                tableWidth: Math.round(rect.width),
                                viewportWidth: viewportInfo.width,
                                columnCount: table.querySelectorAll('th, td').length / table.querySelectorAll('tr').length
                            },
                            wcagCriteria: '1.4.10',
                            impact: 'Table may be difficult to read on mobile devices',
                            recommendation: 'Wrap table in responsive container or use mobile-friendly table design'
                        });
                    }
                }
            }

            return violations;
        }, deviceName, viewport);
    }

    /**
     * Test orientation changes and landscape/portrait compatibility
     */
    async testOrientationChanges(page, scanDir) {
        const violations = [];

        try {
            // Test landscape orientation
            await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true });
            await page.screenshot({ 
                path: path.join(scanDir, 'landscape-orientation.png'),
                fullPage: true 
            });

            const landscapeViolations = await page.evaluate(() => {
                const violations = [];

                // Check if content is accessible in landscape
                const bodyHeight = document.body.scrollHeight;
                const windowHeight = window.innerHeight;

                // `landscape-excessive-height` was removed: no WCAG criterion limits
                // page length, and 1.3.4 (Orientation) is about *locking* an
                // orientation, not about vertical scrolling. Every long landing page
                // in the golden corpus tripped it (8/8 routes). What 1.3.4/1.4.10
                // actually require in landscape — no horizontal scrolling, no content
                // loss — is measured by the checks below and by test400PercentZoom.
                void bodyHeight; void windowHeight;

                return violations;
            });

            violations.push(...landscapeViolations);

            // Test portrait orientation
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });
            await page.screenshot({ 
                path: path.join(scanDir, 'portrait-orientation.png'),
                fullPage: true 
            });

            const portraitViolations = await page.evaluate(() => {
                const violations = [];

                // Check for content that doesn't work in portrait
                const bodyWidth = document.body.scrollWidth;
                const windowWidth = window.innerWidth;

                if (bodyWidth > windowWidth) {
                    violations.push({
                        type: 'portrait-horizontal-scroll',
                        category: 'orientation',
                        severity: 'serious',
                        element: 'body',
                        description: 'Content requires horizontal scrolling in portrait orientation',
                        details: {
                            orientation: 'portrait',
                            bodyWidth: bodyWidth,
                            windowWidth: windowWidth,
                            excessWidth: bodyWidth - windowWidth
                        },
                        wcagCriteria: '1.4.10',
                        impact: 'Users must scroll horizontally in portrait mode',
                        recommendation: 'Ensure content fits in portrait orientation'
                    });
                }

                return violations;
            });

            violations.push(...portraitViolations);

        } catch (error) {
            console.warn('Orientation testing error:', error.message);
        }

        return violations;
    }

    /**
     * Generate mobile-specific recommendations
     */
    generateMobileRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.some(type => type.includes('viewport'))) {
            recommendations.push({
                priority: 'critical',
                issue: 'Viewport configuration prevents proper mobile accessibility',
                solution: 'Fix viewport meta tag to allow proper scaling and zooming',
                implementation: 'Use <meta name="viewport" content="width=device-width, initial-scale=1.0"> without user-scalable=no'
            });
        }

        if (issueTypes.some(type => type.includes('400-percent-zoom'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Content not accessible at 400% zoom on mobile',
                solution: 'Ensure content reflows properly at high zoom levels',
                implementation: 'Use relative units, flexible layouts, and test at 400% zoom on mobile devices'
            });
        }

        if (issueTypes.some(type => type.includes('horizontal-scroll'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Content requires horizontal scrolling on mobile',
                solution: 'Implement responsive design to contain content within viewport',
                implementation: 'Use CSS media queries, flexible grids, and max-width: 100% for responsive design'
            });
        }

        if (issueTypes.some(type => type.includes('device-adaptation'))) {
            recommendations.push({
                priority: 'medium',
                issue: 'Content does not adapt properly to mobile devices',
                solution: 'Implement mobile-first responsive design',
                implementation: 'Use responsive images, flexible tables, and mobile-optimized layouts'
            });
        }

        return recommendations;
    }

    /**
     * Generate mobile testing guidance
     */
    generateMobileTestingGuidance(violations) {
        return {
            overview: {
                purpose: 'Mobile accessibility ensures content is usable on smartphones and tablets',
                keyRequirements: ['400% zoom support', 'No horizontal scrolling', 'Orientation flexibility'],
                testingDevices: ['iPhone', 'Android phones', 'Tablets in both orientations']
            },
            testingProcedures: {
                '400PercentZoom': {
                    steps: [
                        '1. Open page on mobile device',
                        '2. Zoom to 400% using pinch gesture',
                        '3. Verify no horizontal scrolling required',
                        '4. Test all functionality at 400% zoom',
                        '5. Ensure text remains readable'
                    ],
                    tools: ['Real mobile devices', 'Browser dev tools device simulation'],
                    wcagCriteria: '1.4.4 - Resize text'
                },
                orientation: {
                    steps: [
                        '1. Test page in portrait orientation',
                        '2. Rotate device to landscape',
                        '3. Verify content remains accessible',
                        '4. Test all functionality in both orientations',
                        '5. Ensure no content is lost or hidden'
                    ],
                    tools: ['Mobile devices', 'Browser responsive testing'],
                    wcagCriteria: '1.4.10 - Reflow'
                }
            },
            automaticFindings: violations.length,
            manualValidationRequired: true
        };
    }

}

module.exports = MobileSpecificScanner;