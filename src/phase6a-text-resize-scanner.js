const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Text Resize Scanner for WCAG 1.4.4 compliance testing
 * Tests 200% zoom and 400% mobile zoom without horizontal scrolling
 * Critical for 25% of users who need text magnification
 */
class TextResizeScanner {
    constructor() {
        this.browser = null;
        this.screenshotDir = path.join(__dirname, '../tmp/text-resize-screenshots');
        this.testViewports = [
            { width: 1280, height: 1024, name: 'desktop', scale: 1 },
            { width: 640, height: 512, name: 'desktop-200%', scale: 2 }, // 200% zoom simulation
            { width: 320, height: 256, name: 'desktop-400%', scale: 4 }, // 400% zoom simulation
            { width: 375, height: 667, name: 'mobile', scale: 1 },
            { width: 188, height: 334, name: 'mobile-200%', scale: 2 }, // Mobile 200% zoom
            { width: 94, height: 167, name: 'mobile-400%', scale: 4 }   // Mobile 400% zoom
        ];
    }

    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1']
            });
        }
        await fs.ensureDir(this.screenshotDir);
    }

    /**
     * Scan text resize compliance (WCAG 1.4.4)
     * @param {string} url - URL to scan
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} TextResizeReport
     */
    async scanTextResize(url, options = {}) {
        const defaultOptions = {
            testZoomLevels: [200, 400],
            checkMobile: true,
            detectFixedElements: true,
            analyzeTextFlow: true,
            timeout: 60000
        };

        const scanOptions = { ...defaultOptions, ...options };

        try {
            await this.init();
            const timestamp = Date.now();
            const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
            await fs.ensureDir(scanDir);

            const violations = [];
            const viewportResults = {};
            
            // Test each viewport for zoom compliance
            for (const viewport of this.testViewports) {
                const page = await this.browser.newPage();
                
                try {
                    await page.setViewport({
                        width: viewport.width,
                        height: viewport.height,
                        deviceScaleFactor: viewport.scale
                    });

                    await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });
                    
                    const result = await this.analyzeTextResizeCompliance(page, viewport, scanDir);
                    viewportResults[viewport.name] = result;
                    
                    if (result.violations.length > 0) {
                        violations.push(...result.violations.map(v => ({
                            ...v,
                            viewport: viewport.name,
                            zoomLevel: viewport.scale === 1 ? '100%' : `${viewport.scale * 100}%`
                        })));
                    }
                    
                } finally {
                    await page.close();
                }
            }

            // Additional CSS analysis for text resize issues
            const cssViolations = await this.analyzeCSSForTextResizeIssues(url, scanOptions);
            violations.push(...cssViolations);

            const report = {
                criteria: ["1.4.4"],
                passed: violations.length === 0,
                violations: violations,
                summary: {
                    totalViewportsTested: this.testViewports.length,
                    zoomLevelsSupported: this.calculateZoomSupport(viewportResults),
                    horizontalScrollIssues: violations.filter(v => v.type === 'horizontal-scroll').length,
                    fixedElementIssues: violations.filter(v => v.type === 'fixed-size').length,
                    textFlowIssues: violations.filter(v => v.type === 'text-overflow').length
                },
                viewportResults: viewportResults,
                screenshotPath: scanDir,
                recommendations: this.generateTextResizeRecommendations(violations)
            };

            return report;

        } catch (error) {
            throw new Error(`Text resize scan failed: ${error.message}`);
        }
    }

    /**
     * Analyze text resize compliance for a specific viewport
     */
    async analyzeTextResizeCompliance(page, viewport, scanDir) {
        const violations = [];
        
        // Take screenshot for visual analysis
        const screenshotPath = path.join(scanDir, `${viewport.name}.png`);
        await page.screenshot({ 
            path: screenshotPath, 
            fullPage: true 
        });

        // Check for horizontal scrolling
        const scrollInfo = await page.evaluate(() => {
            return {
                hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                bodyWidth: document.body ? document.body.scrollWidth : 0
            };
        });

        if (scrollInfo.hasHorizontalScroll && viewport.scale >= 2) {
            violations.push({
                type: 'horizontal-scroll',
                severity: 'critical',
                description: `Horizontal scrolling required at ${viewport.scale * 100}% zoom`,
                details: {
                    viewportWidth: scrollInfo.viewportWidth,
                    contentWidth: scrollInfo.scrollWidth,
                    overflow: scrollInfo.scrollWidth - scrollInfo.viewportWidth
                },
                wcagCriteria: '1.4.4',
                impact: 'Users cannot access content without horizontal scrolling'
            });
        }

        // Analyze fixed-size elements
        const fixedElements = await page.evaluate(() => {
            const elements = [];
            const allElements = document.querySelectorAll('*');
            
            for (const el of allElements) {
                const styles = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                
                // Check for problematic fixed sizes
                if ((styles.width && styles.width.endsWith('px') && parseInt(styles.width) > 400) ||
                    (styles.minWidth && styles.minWidth.endsWith('px') && parseInt(styles.minWidth) > 400) ||
                    (styles.maxWidth && styles.maxWidth.endsWith('px') && parseInt(styles.maxWidth) < 200)) {
                    
                    elements.push({
                        tagName: el.tagName.toLowerCase(),
                        id: el.id || null,
                        className: el.className || null,
                        width: styles.width,
                        minWidth: styles.minWidth,
                        maxWidth: styles.maxWidth,
                        rect: {
                            width: rect.width,
                            height: rect.height,
                            x: rect.x,
                            y: rect.y
                        },
                        overflowX: styles.overflowX,
                        position: styles.position
                    });
                }
            }
            
            return elements;
        });

        for (const el of fixedElements) {
            violations.push({
                type: 'fixed-size',
                severity: 'serious',
                description: `Element with fixed size that may not scale properly`,
                element: `${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ')[0] : ''}`,
                details: {
                    width: el.width,
                    minWidth: el.minWidth,
                    maxWidth: el.maxWidth,
                    computedWidth: el.rect.width,
                    overflowX: el.overflowX
                },
                wcagCriteria: '1.4.4',
                impact: 'Element may not resize properly at zoom levels'
            });
        }

        // Check for text overflow and truncation
        const textOverflowIssues = await page.evaluate(() => {
            const issues = [];
            const textElements = document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6, a, button, label');
            
            for (const el of textElements) {
                const styles = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                
                if (styles.overflow === 'hidden' && el.scrollWidth > el.clientWidth) {
                    issues.push({
                        tagName: el.tagName.toLowerCase(),
                        id: el.id || null,
                        className: el.className || null,
                        textContent: el.textContent.substring(0, 100),
                        scrollWidth: el.scrollWidth,
                        clientWidth: el.clientWidth,
                        overflow: styles.overflow,
                        whiteSpace: styles.whiteSpace
                    });
                }
            }
            
            return issues;
        });

        for (const issue of textOverflowIssues) {
            violations.push({
                type: 'text-overflow',
                severity: 'serious',
                description: 'Text content is truncated with overflow hidden',
                element: `${issue.tagName}${issue.id ? '#' + issue.id : ''}${issue.className ? '.' + issue.className.split(' ')[0] : ''}`,
                details: {
                    textPreview: issue.textContent,
                    scrollWidth: issue.scrollWidth,
                    clientWidth: issue.clientWidth,
                    hiddenWidth: issue.scrollWidth - issue.clientWidth,
                    overflow: issue.overflow,
                    whiteSpace: issue.whiteSpace
                },
                wcagCriteria: '1.4.4',
                impact: 'Text content is cut off and inaccessible at zoom levels'
            });
        }

        // Check navigation and form usability at zoom
        const interactionIssues = await page.evaluate(() => {
            const issues = [];
            const interactives = document.querySelectorAll('a, button, input, select, textarea');
            
            for (const el of interactives) {
                const rect = el.getBoundingClientRect();
                const styles = window.getComputedStyle(el);
                
                // Check if element is too small or positioned off-screen
                if (rect.width < 10 || rect.height < 10 || 
                    rect.right < 0 || rect.bottom < 0 ||
                    rect.left > window.innerWidth) {
                    
                    issues.push({
                        tagName: el.tagName.toLowerCase(),
                        type: el.type || null,
                        id: el.id || null,
                        className: el.className || null,
                        rect: {
                            width: rect.width,
                            height: rect.height,
                            x: rect.x,
                            y: rect.y
                        },
                        visible: rect.width > 0 && rect.height > 0,
                        inViewport: rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth
                    });
                }
            }
            
            return issues;
        });

        for (const issue of interactionIssues) {
            violations.push({
                type: 'interaction-blocked',
                severity: 'critical',
                description: 'Interactive element is not accessible at zoom level',
                element: `${issue.tagName}${issue.type ? `[type="${issue.type}"]` : ''}${issue.id ? '#' + issue.id : ''}`,
                details: {
                    elementSize: `${issue.rect.width}x${issue.rect.height}`,
                    position: `${issue.rect.x}, ${issue.rect.y}`,
                    visible: issue.visible,
                    inViewport: issue.inViewport
                },
                wcagCriteria: '1.4.4',
                impact: 'User cannot interact with this element at zoom level'
            });
        }

        return {
            viewport: viewport.name,
            zoomLevel: viewport.scale,
            violations: violations,
            screenshotPath: screenshotPath,
            scrollInfo: scrollInfo,
            summary: {
                horizontalScrollRequired: scrollInfo.hasHorizontalScroll,
                fixedElementsFound: fixedElements.length,
                textOverflowIssues: textOverflowIssues.length,
                interactionIssues: interactionIssues.length
            }
        };
    }

    /**
     * Analyze CSS for text resize compliance issues
     */
    async analyzeCSSForTextResizeIssues(url, options) {
        const violations = [];
        const page = await this.browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'networkidle0', timeout: options.timeout });

            // Extract and analyze CSS rules
            const cssAnalysis = await page.evaluate(() => {
                const issues = [];
                const sheets = Array.from(document.styleSheets);
                
                for (const sheet of sheets) {
                    try {
                        const rules = Array.from(sheet.cssRules || sheet.rules || []);
                        
                        for (const rule of rules) {
                            if (rule.style) {
                                const selector = rule.selectorText;
                                const styles = rule.style;
                                
                                // Check for problematic CSS properties
                                if (styles.fontSize && styles.fontSize.endsWith('px') && parseInt(styles.fontSize) < 12) {
                                    issues.push({
                                        type: 'small-fixed-font',
                                        selector: selector,
                                        property: 'font-size',
                                        value: styles.fontSize,
                                        severity: 'moderate'
                                    });
                                }
                                
                                if (styles.width && styles.width.endsWith('px')) {
                                    const width = parseInt(styles.width);
                                    if (width > 800) {
                                        issues.push({
                                            type: 'fixed-width',
                                            selector: selector,
                                            property: 'width',
                                            value: styles.width,
                                            severity: 'serious'
                                        });
                                    }
                                }
                                
                                if (styles.minWidth && styles.minWidth.endsWith('px')) {
                                    const minWidth = parseInt(styles.minWidth);
                                    if (minWidth > 600) {
                                        issues.push({
                                            type: 'fixed-min-width',
                                            selector: selector,
                                            property: 'min-width',
                                            value: styles.minWidth,
                                            severity: 'serious'
                                        });
                                    }
                                }
                                
                                if (styles.maxWidth && styles.maxWidth.endsWith('px')) {
                                    const maxWidth = parseInt(styles.maxWidth);
                                    if (maxWidth < 320) {
                                        issues.push({
                                            type: 'restrictive-max-width',
                                            selector: selector,
                                            property: 'max-width',
                                            value: styles.maxWidth,
                                            severity: 'moderate'
                                        });
                                    }
                                }
                                
                                if (styles.overflow === 'hidden' && 
                                    (styles.width?.endsWith('px') || styles.height?.endsWith('px'))) {
                                    issues.push({
                                        type: 'overflow-hidden-fixed',
                                        selector: selector,
                                        properties: {
                                            overflow: styles.overflow,
                                            width: styles.width,
                                            height: styles.height
                                        },
                                        severity: 'serious'
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        // Skip stylesheets that can't be accessed (CORS)
                    }
                }
                
                return issues;
            });

            for (const issue of cssAnalysis) {
                violations.push({
                    type: issue.type,
                    severity: issue.severity,
                    description: this.getCSSIssueDescription(issue.type),
                    selector: issue.selector,
                    details: issue.properties || { [issue.property]: issue.value },
                    wcagCriteria: '1.4.4',
                    impact: this.getCSSIssueImpact(issue.type),
                    recommendation: this.getCSSRecommendation(issue.type)
                });
            }

        } finally {
            await page.close();
        }

        return violations;
    }

    /**
     * Calculate zoom support across viewports
     */
    calculateZoomSupport(viewportResults) {
        const support = {
            '100%': true, // Baseline
            '200%': true,
            '400%': true
        };

        for (const [name, result] of Object.entries(viewportResults)) {
            if (name.includes('200%') && result.violations.length > 0) {
                support['200%'] = false;
            }
            if (name.includes('400%') && result.violations.length > 0) {
                support['400%'] = false;
            }
        }

        return support;
    }

    /**
     * Generate recommendations for text resize issues
     */
    generateTextResizeRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.includes('horizontal-scroll')) {
            recommendations.push({
                priority: 'critical',
                issue: 'Horizontal scrolling at zoom',
                solution: 'Use relative units (em, rem, %) instead of fixed pixel widths',
                implementation: 'Replace fixed widths with max-width: 100% and flexible layouts'
            });
        }

        if (issueTypes.includes('fixed-size')) {
            recommendations.push({
                priority: 'high',
                issue: 'Fixed-size elements',
                solution: 'Use responsive design with flexible containers',
                implementation: 'Convert px widths to %, em, or rem units with proper max-width constraints'
            });
        }

        if (issueTypes.includes('text-overflow')) {
            recommendations.push({
                priority: 'high',
                issue: 'Text content truncation',
                solution: 'Allow text to wrap and containers to expand',
                implementation: 'Remove overflow: hidden on text containers, use word-wrap: break-word'
            });
        }

        if (issueTypes.includes('interaction-blocked')) {
            recommendations.push({
                priority: 'critical',
                issue: 'Interactive elements inaccessible',
                solution: 'Ensure all interactive elements remain accessible at zoom',
                implementation: 'Use flexible positioning and adequate spacing between elements'
            });
        }

        return recommendations;
    }

    /**
     * Get description for CSS issue types
     */
    getCSSIssueDescription(type) {
        const descriptions = {
            'small-fixed-font': 'Font size below 12px may not scale properly',
            'fixed-width': 'Large fixed width may cause horizontal scrolling at zoom',
            'fixed-min-width': 'Large minimum width restricts responsive behavior',
            'restrictive-max-width': 'Very small maximum width may truncate content',
            'overflow-hidden-fixed': 'Overflow hidden on fixed-size container may hide content at zoom'
        };
        return descriptions[type] || 'CSS property may impact text resize compliance';
    }

    /**
     * Get impact description for CSS issues
     */
    getCSSIssueImpact(type) {
        const impacts = {
            'small-fixed-font': 'Text may remain too small at zoom levels',
            'fixed-width': 'Content may require horizontal scrolling',
            'fixed-min-width': 'Layout may not adapt to smaller viewports',
            'restrictive-max-width': 'Content may be unnecessarily constrained',
            'overflow-hidden-fixed': 'Content may be cut off and inaccessible'
        };
        return impacts[type] || 'May prevent proper scaling at zoom levels';
    }

    /**
     * Get recommendation for CSS issues
     */
    getCSSRecommendation(type) {
        const recommendations = {
            'small-fixed-font': 'Use relative units (em, rem) or minimum 14px font size',
            'fixed-width': 'Use percentage widths or max-width with 100% width',
            'fixed-min-width': 'Use relative min-width or remove restrictive minimums',
            'restrictive-max-width': 'Increase max-width or use flexible constraints',
            'overflow-hidden-fixed': 'Allow content to expand or use scrollable containers'
        };
        return recommendations[type] || 'Use relative units and flexible layouts';
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = TextResizeScanner;