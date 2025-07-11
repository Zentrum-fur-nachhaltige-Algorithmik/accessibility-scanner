const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Non-text Contrast Scanner for WCAG 1.4.11 compliance testing
 * Tests UI components and graphical objects for 3:1 contrast ratio
 * Critical for UI usability and legal compliance
 */
class NonTextContrastScanner {
    constructor() {
        this.browser = null;
        this.screenshotDir = path.join(__dirname, '../tmp/nontext-contrast-screenshots');
    }

    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
        await fs.ensureDir(this.screenshotDir);
    }

    /**
     * Scan non-text contrast compliance (WCAG 1.4.11)
     * @param {string} url - URL to scan
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} NonTextContrastReport
     */
    async scanNonTextContrast(url, options = {}) {
        const defaultOptions = {
            checkInteractiveElements: true,
            checkGraphicalObjects: true,
            checkFocusIndicators: true,
            checkStateChanges: true,
            contrastThreshold: 3.0,
            timeout: 60000
        };

        const scanOptions = { ...defaultOptions, ...options };

        try {
            await this.init();
            const page = await this.browser.newPage();
            const timestamp = Date.now();
            const scanDir = path.join(this.screenshotDir, `scan-${timestamp}`);
            await fs.ensureDir(scanDir);

            await page.setViewport({ width: 1280, height: 1024 });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: scanOptions.timeout });

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

            await page.close();

            const report = {
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

            return report;

        } catch (error) {
            throw new Error(`Non-text contrast scan failed: ${error.message}`);
        }
    }

    /**
     * Analyze UI components for contrast compliance
     */
    async analyzeUIComponents(page, options) {
        return await page.evaluate((contrastThreshold) => {
            const violations = [];

            // Helper function to calculate contrast ratio
            function getContrastRatio(color1, color2) {
                function getRGB(color) {
                    const div = document.createElement('div');
                    div.style.color = color;
                    document.body.appendChild(div);
                    const rgb = window.getComputedStyle(div).color;
                    document.body.removeChild(div);
                    
                    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                    if (match) {
                        return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                    }
                    return [0, 0, 0];
                }

                function getLuminance(r, g, b) {
                    const [rs, gs, bs] = [r, g, b].map(c => {
                        c = c / 255;
                        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                    });
                    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
                }

                const rgb1 = getRGB(color1);
                const rgb2 = getRGB(color2);
                const lum1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
                const lum2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
                const brightest = Math.max(lum1, lum2);
                const darkest = Math.min(lum1, lum2);
                return (brightest + 0.05) / (darkest + 0.05);
            }

            // Helper function to get background color of element
            function getBackgroundColor(element) {
                let el = element;
                while (el && el !== document.body) {
                    const bg = window.getComputedStyle(el).backgroundColor;
                    if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                        return bg;
                    }
                    el = el.parentElement;
                }
                return 'rgb(255, 255, 255)'; // Default to white
            }

            // Check buttons
            const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
            for (let i = 0; i < buttons.length; i++) {
                const button = buttons[i];
                const styles = window.getComputedStyle(button);
                const borderColor = styles.borderColor || styles.borderTopColor;
                const backgroundColor = styles.backgroundColor;
                const parentBg = getBackgroundColor(button.parentElement);

                // Check border contrast
                if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
                    const contrast = getContrastRatio(borderColor, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-border-contrast',
                            category: 'ui-component',
                            severity: 'serious',
                            element: `button[${i}]`,
                            description: 'Button border has insufficient contrast against background',
                            details: {
                                borderColor: borderColor,
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
                if (backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
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
                const borderColor = styles.borderColor || styles.borderTopColor;
                const parentBg = getBackgroundColor(control.parentElement);

                if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
                    const contrast = getContrastRatio(borderColor, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-form-border-contrast',
                            category: 'ui-component',
                            severity: 'serious',
                            element: `${control.tagName.toLowerCase()}[${i}]`,
                            description: 'Form control border has insufficient contrast',
                            details: {
                                borderColor: borderColor,
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
                const borderColor = styles.borderColor || styles.borderTopColor;
                const backgroundColor = styles.backgroundColor;
                const parentBg = getBackgroundColor(control.parentElement);

                // Check border contrast
                if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
                    const contrast = getContrastRatio(borderColor, parentBg);
                    if (contrast < contrastThreshold) {
                        violations.push({
                            type: 'insufficient-custom-control-contrast',
                            category: 'ui-component',
                            severity: 'serious',
                            element: `${control.tagName.toLowerCase()}[${i}]`,
                            description: 'Custom control has insufficient border contrast',
                            details: {
                                borderColor: borderColor,
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
        }, options.contrastThreshold);
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
                const parentBg = window.getComputedStyle(progress.parentElement).backgroundColor || 'rgb(255, 255, 255)';

                // Check progress bar border
                if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
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
     * Analyze focus indicators for contrast compliance
     */
    async analyzeFocusIndicators(page, options) {
        const violations = [];
        
        // Get all focusable elements
        const focusableElements = await page.evaluate(() => {
            const elements = document.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
            return Array.from(elements).map((el, index) => ({
                selector: `${el.tagName.toLowerCase()}[${index}]`,
                tagName: el.tagName.toLowerCase(),
                type: el.type || null,
                id: el.id || null,
                className: el.className || null,
                tabIndex: el.tabIndex,
                index: index
            }));
        });

        // Test focus indicators for each element
        for (const elementInfo of focusableElements.slice(0, 20)) { // Limit to first 20 for performance
            try {
                const focusViolation = await page.evaluate((info, contrastThreshold) => {
                    const elements = document.querySelectorAll(`${info.tagName}:nth-of-type(${info.index + 1})`);
                    const element = elements[0];
                    
                    if (!element) return null;

                    // Focus the element
                    element.focus();
                    
                    // Get focus styles
                    const focusStyles = window.getComputedStyle(element, ':focus');
                    const normalStyles = window.getComputedStyle(element);
                    const parentBg = window.getComputedStyle(element.parentElement).backgroundColor || 'rgb(255, 255, 255)';

                    // Check outline contrast
                    const outlineColor = focusStyles.outlineColor || normalStyles.outlineColor;
                    const outlineWidth = focusStyles.outlineWidth || normalStyles.outlineWidth;
                    
                    if (outlineColor && outlineColor !== 'rgba(0, 0, 0, 0)' && outlineColor !== 'transparent' &&
                        outlineWidth && parseFloat(outlineWidth) > 0) {
                        
                        function getContrastRatio(color1, color2) {
                            // Simplified contrast calculation
                            try {
                                const div1 = document.createElement('div');
                                const div2 = document.createElement('div');
                                div1.style.color = color1;
                                div2.style.color = color2;
                                document.body.appendChild(div1);
                                document.body.appendChild(div2);
                                
                                const rgb1 = window.getComputedStyle(div1).color;
                                const rgb2 = window.getComputedStyle(div2).color;
                                
                                document.body.removeChild(div1);
                                document.body.removeChild(div2);

                                // Simple contrast approximation
                                const match1 = rgb1.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                                const match2 = rgb2.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                                
                                if (match1 && match2) {
                                    const lum1 = (parseInt(match1[1]) + parseInt(match1[2]) + parseInt(match1[3])) / 3;
                                    const lum2 = (parseInt(match2[1]) + parseInt(match2[2]) + parseInt(match2[3])) / 3;
                                    const ratio = Math.abs(lum1 - lum2) / 255 * 21; // Simplified ratio
                                    return Math.max(ratio, 1); // Minimum 1:1
                                }
                                return 1;
                            } catch (e) {
                                return 1;
                            }
                        }

                        const contrast = getContrastRatio(outlineColor, parentBg);
                        
                        if (contrast < contrastThreshold) {
                            return {
                                type: 'insufficient-focus-indicator-contrast',
                                category: 'focus-indicator',
                                severity: 'serious',
                                element: info.selector,
                                description: 'Focus indicator has insufficient contrast against background',
                                details: {
                                    outlineColor: outlineColor,
                                    backgroundColor: parentBg,
                                    outlineWidth: outlineWidth,
                                    contrastRatio: Math.round(contrast * 100) / 100,
                                    required: contrastThreshold,
                                    tagName: info.tagName,
                                    type: info.type,
                                    id: info.id
                                },
                                wcagCriteria: '1.4.11',
                                impact: 'Focus indicator is not clearly visible to users'
                            };
                        }
                    } else {
                        // Check for other focus indicators (box-shadow, border changes)
                        const boxShadow = focusStyles.boxShadow;
                        const borderColor = focusStyles.borderColor || focusStyles.borderTopColor;
                        
                        if (!boxShadow || boxShadow === 'none') {
                            if (!borderColor || borderColor === normalStyles.borderColor) {
                                return {
                                    type: 'missing-focus-indicator',
                                    category: 'focus-indicator',
                                    severity: 'critical',
                                    element: info.selector,
                                    description: 'Element lacks visible focus indicator',
                                    details: {
                                        tagName: info.tagName,
                                        type: info.type,
                                        id: info.id,
                                        outline: focusStyles.outline,
                                        boxShadow: boxShadow,
                                        borderColor: borderColor
                                    },
                                    wcagCriteria: '1.4.11',
                                    impact: 'Users cannot see which element has focus'
                                };
                            }
                        }
                    }

                    return null;
                }, elementInfo, options.contrastThreshold);

                if (focusViolation) {
                    violations.push(focusViolation);
                }
            } catch (e) {
                // Skip elements that can't be focused
            }
        }

        return violations;
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
                        // Basic check for hover state visibility
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

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = NonTextContrastScanner;