const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Phase 6D: Mobile Specific Accessibility Scanner
 * Implements mobile-specific WCAG criteria: 400% zoom, orientation, touch targets
 * Critical for mobile accessibility compliance and responsive design testing
 * CSP-independent implementation using Puppeteer viewport simulation
 */
class MobileSpecificScanner extends BaseScanner {
    constructor() {
        super('mobile-specific', {
            wcagCriteria: ['1.4.10', '2.5.5'],
            wcagPrinciple: 'operable',
        });
        this.screenshotDir = path.join(__dirname, '../tmp/mobile-screenshots');
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
            testTouchTargets: true,
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

        const violations = [];
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

                // Test touch target sizes
                if (scanOptions.testTouchTargets) {
                    const touchViolations = await this.testTouchTargets(page, deviceName);
                    deviceViolations.push(...touchViolations);
                }

                // Test viewport meta tag
                if (scanOptions.testViewportMeta) {
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

        return {
            scannerId: this.id,
            criteria: ["1.4.4", "1.4.10", "2.5.5"],
            passed: violations.length === 0,
            violations: violations,
            summary: {
                totalDevicesTested: Object.keys(this.mobileViewports).length,
                zoom400PercentIssues: violations.filter(v => v.category === '400-percent-zoom').length,
                touchTargetIssues: violations.filter(v => v.category === 'touch-targets').length,
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

                // Check for elements with overflow hidden that might hide content at zoom
                if (computedStyle.overflow === 'hidden' && element.scrollWidth > element.clientWidth) {
                    violations.push({
                        type: 'mobile-overflow-hidden-400-zoom',
                        category: '400-percent-zoom',
                        severity: 'moderate',
                        element: getElementSelector(element),
                        description: 'Element with overflow:hidden may hide content at 400% zoom on mobile',
                        details: {
                            device: device,
                            scrollWidth: element.scrollWidth,
                            clientWidth: element.clientWidth,
                            overflow: computedStyle.overflow
                        },
                        wcagCriteria: '1.4.4',
                        impact: 'Content may be hidden at 400% zoom on mobile devices',
                        recommendation: 'Use overflow: auto or overflow: visible for scalable content'
                    });
                }

                // Check for small text that becomes unreadable at mobile zoom
                const fontSize = computedStyle.fontSize;
                if (fontSize && fontSize.endsWith('px')) {
                    const fontSizeValue = parseInt(fontSize);
                    if (fontSizeValue < 12) { // Very small text on mobile
                        violations.push({
                            type: 'mobile-small-text-400-zoom',
                            category: '400-percent-zoom',
                            severity: 'moderate',
                            element: getElementSelector(element),
                            description: 'Very small text may be unreadable at 400% zoom on mobile',
                            details: {
                                device: device,
                                fontSize: fontSize,
                                textContent: element.textContent.trim().substring(0, 50)
                            },
                            wcagCriteria: '1.4.4',
                            impact: 'Text may be too small to read comfortably at 400% zoom',
                            recommendation: 'Use minimum 14px font size for mobile or relative units'
                        });
                    }
                }
            }

            return violations;
        }, deviceName, viewport);
    }

    /**
     * Test touch target sizes for mobile accessibility
     */
    async testTouchTargets(page, deviceName) {
        return await page.evaluate((device) => {
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string' 
                    ? `.${element.className.split(' ')[0]}` 
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find all interactive elements
            const interactiveElements = document.querySelectorAll(
                'button, input, select, textarea, a, [role="button"], [role="link"], ' +
                '[tabindex], [onclick], [ontouch], .btn, .button, .link'
            );

            function isSrOnlyTouch(el) {
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

            for (let i = 0; i < interactiveElements.length; i++) {
                const element = interactiveElements[i];
                if (isSrOnlyTouch(element)) continue;
                const rect = element.getBoundingClientRect();

                // WCAG 2.5.8 (AA) requires minimum 24x24 CSS pixels for touch targets
                // WCAG 2.5.5 (AAA) recommends 44x44 CSS pixels
                const tag = element.tagName.toLowerCase();
                const isStandardControl = ['input', 'select', 'textarea', 'button'].includes(tag);
                // Standard form controls use 24px (WCAG 2.5.8 AA); custom elements use 44px (WCAG 2.5.5 AAA)
                const minSize = isStandardControl ? 24 : 44;

                if (rect.width > 0 && rect.height > 0) { // Element is visible
                    if (rect.width < minSize || rect.height < minSize) {
                        violations.push({
                            type: 'touch-target-too-small',
                            category: 'touch-targets',
                            severity: rect.width < 24 || rect.height < 24 ? 'serious' : 'moderate',
                            element: getElementSelector(element),
                            description: `Touch target smaller than minimum ${minSize}x${minSize} CSS pixels`,
                            details: {
                                device: device,
                                width: Math.round(rect.width),
                                height: Math.round(rect.height),
                                minRequiredSize: minSize,
                                elementType: tag,
                                elementText: element.textContent.trim().substring(0, 30),
                                role: element.getAttribute('role'),
                                isButton: element.tagName === 'BUTTON' || element.getAttribute('role') === 'button',
                                isLink: element.tagName === 'A' || element.getAttribute('role') === 'link'
                            },
                            wcagCriteria: isStandardControl ? '2.5.8' : '2.5.5',
                            impact: 'Touch target may be difficult to activate on mobile devices',
                            recommendation: `Increase touch target size to minimum ${minSize}x${minSize} CSS pixels`
                        });
                    }

                    // Check spacing between touch targets
                    const nearbyElements = Array.from(interactiveElements).filter(other => {
                        if (other === element) return false;
                        const otherRect = other.getBoundingClientRect();
                        
                        // Check if elements are close to each other
                        const horizontalOverlap = Math.max(0, Math.min(rect.right, otherRect.right) - Math.max(rect.left, otherRect.left));
                        const verticalOverlap = Math.max(0, Math.min(rect.bottom, otherRect.bottom) - Math.max(rect.top, otherRect.top));
                        
                        // Elements are close if they're within 8px of each other
                        const horizontalDistance = horizontalOverlap > 0 ? 0 : Math.min(
                            Math.abs(rect.right - otherRect.left),
                            Math.abs(otherRect.right - rect.left)
                        );
                        const verticalDistance = verticalOverlap > 0 ? 0 : Math.min(
                            Math.abs(rect.bottom - otherRect.top),
                            Math.abs(otherRect.bottom - rect.top)
                        );
                        
                        return horizontalDistance < 8 || verticalDistance < 8;
                    });

                    if (nearbyElements.length > 0) {
                        violations.push({
                            type: 'touch-targets-too-close',
                            category: 'touch-targets',
                            severity: 'moderate',
                            element: getElementSelector(element),
                            description: 'Touch targets are too close together (less than 8px spacing)',
                            details: {
                                device: device,
                                elementText: element.textContent.trim().substring(0, 30),
                                nearbyTargetsCount: nearbyElements.length,
                                recommendedSpacing: '8px minimum'
                            },
                            wcagCriteria: '2.5.5',
                            impact: 'Users may accidentally activate wrong touch targets',
                            recommendation: 'Add minimum 8px spacing between touch targets'
                        });
                    }
                }
            }

            return violations;
        }, deviceName);
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
            
            if (bodyScrollWidth > windowWidth) {
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

            // Find elements that cause horizontal overflow
            const allElements = document.querySelectorAll('*');
            for (let i = 0; i < allElements.length; i++) {
                const element = allElements[i];
                const rect = element.getBoundingClientRect();
                
                if (rect.right > windowWidth + 10) { // 10px tolerance
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
                
                if (rect.width > viewportInfo.width) {
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
                
                if (rect.width > viewportInfo.width) {
                    const hasResponsiveContainer = table.closest('.table-responsive, .overflow-auto, [style*="overflow"]');
                    
                    if (!hasResponsiveContainer) {
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

                if (bodyHeight > windowHeight * 3) { // Very tall content in landscape
                    violations.push({
                        type: 'landscape-excessive-height',
                        category: 'orientation',
                        severity: 'moderate',
                        element: 'body',
                        description: 'Content is excessively tall in landscape orientation',
                        details: {
                            orientation: 'landscape',
                            bodyHeight: bodyHeight,
                            windowHeight: windowHeight,
                            ratio: Math.round(bodyHeight / windowHeight * 10) / 10
                        },
                        wcagCriteria: '1.4.10',
                        impact: 'Poor user experience in landscape orientation',
                        recommendation: 'Optimize content layout for landscape viewing'
                    });
                }

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

        if (issueTypes.some(type => type.includes('touch-target'))) {
            recommendations.push({
                priority: 'critical',
                issue: 'Touch targets too small or too close together',
                solution: 'Ensure all touch targets are minimum 44x44 CSS pixels with 8px spacing',
                implementation: 'Use CSS to set min-width: 44px; min-height: 44px; and add margin between interactive elements'
            });
        }

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
                keyRequirements: ['44px touch targets', '400% zoom support', 'No horizontal scrolling', 'Orientation flexibility'],
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
                touchTargets: {
                    steps: [
                        '1. Identify all interactive elements',
                        '2. Measure touch target sizes',
                        '3. Test activation with finger touch',
                        '4. Verify 44x44px minimum size',
                        '5. Check spacing between targets'
                    ],
                    tools: ['Touch target measurement tools', 'Mobile device testing'],
                    wcagCriteria: '2.5.5 - Target Size'
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