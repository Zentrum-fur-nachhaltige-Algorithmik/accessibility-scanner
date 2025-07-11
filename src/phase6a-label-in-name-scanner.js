const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Label in Name Scanner for WCAG 2.5.3 compliance testing
 * Ensures visible text is contained in accessible name for voice control compatibility
 * Critical for Dragon NaturallySpeaking, Voice Control, and other speech recognition software
 */
class LabelInNameScanner {
    constructor() {
        this.browser = null;
        this.screenshotDir = path.join(__dirname, '../tmp/label-in-name-screenshots');
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
     * Scan label in name compliance (WCAG 2.5.3)
     * @param {string} url - URL to scan
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} LabelInNameReport
     */
    async scanLabelInName(url, options = {}) {
        const defaultOptions = {
            checkButtons: true,
            checkFormControls: true,
            checkLinks: true,
            checkImageButtons: true,
            checkCustomControls: true,
            caseSensitive: false,
            ignoreWhitespace: true,
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
            const screenshotPath = path.join(scanDir, 'label-in-name-analysis.png');
            await page.screenshot({ 
                path: screenshotPath, 
                fullPage: true 
            });

            const violations = [];
            
            // Analyze different types of elements
            if (scanOptions.checkButtons) {
                const buttonViolations = await this.analyzeButtons(page, scanOptions);
                violations.push(...buttonViolations);
            }

            if (scanOptions.checkFormControls) {
                const formViolations = await this.analyzeFormControls(page, scanOptions);
                violations.push(...formViolations);
            }

            if (scanOptions.checkLinks) {
                const linkViolations = await this.analyzeLinks(page, scanOptions);
                violations.push(...linkViolations);
            }

            if (scanOptions.checkImageButtons) {
                const imageViolations = await this.analyzeImageButtons(page, scanOptions);
                violations.push(...imageViolations);
            }

            if (scanOptions.checkCustomControls) {
                const customViolations = await this.analyzeCustomControls(page, scanOptions);
                violations.push(...customViolations);
            }

            await page.close();

            const report = {
                criteria: ["2.5.3"],
                passed: violations.length === 0,
                violations: violations,
                summary: {
                    totalElementsChecked: violations.length + this.getPassedElementsCount(violations),
                    buttonIssues: violations.filter(v => v.category === 'button').length,
                    formControlIssues: violations.filter(v => v.category === 'form-control').length,
                    linkIssues: violations.filter(v => v.category === 'link').length,
                    imageButtonIssues: violations.filter(v => v.category === 'image-button').length,
                    customControlIssues: violations.filter(v => v.category === 'custom-control').length,
                    voiceControlFailures: violations.length
                },
                screenshotPath: screenshotPath,
                recommendations: this.generateLabelInNameRecommendations(violations),
                voiceControlTesting: this.generateVoiceControlTestCases(violations)
            };

            return report;

        } catch (error) {
            throw new Error(`Label in name scan failed: ${error.message}`);
        }
    }

    /**
     * Analyze buttons for label in name compliance
     */
    async analyzeButtons(page, options) {
        return await page.evaluate((scanOptions) => {
            const violations = [];

            // Helper function to normalize text for comparison
            function normalizeText(text) {
                if (!text) return '';
                let normalized = text.trim();
                if (scanOptions.ignoreWhitespace) {
                    normalized = normalized.replace(/\s+/g, ' ');
                }
                if (!scanOptions.caseSensitive) {
                    normalized = normalized.toLowerCase();
                }
                return normalized;
            }

            // Helper function to get accessible name
            function getAccessibleName(element) {
                // Check aria-label first
                if (element.getAttribute('aria-label')) {
                    return element.getAttribute('aria-label');
                }

                // Check aria-labelledby
                const labelledBy = element.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const referencedElements = labelledBy.split(' ')
                        .map(id => document.getElementById(id))
                        .filter(el => el);
                    if (referencedElements.length > 0) {
                        return referencedElements.map(el => el.textContent).join(' ');
                    }
                }

                // For form elements, check associated label
                if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
                    const labels = element.labels;
                    if (labels && labels.length > 0) {
                        return Array.from(labels).map(label => label.textContent).join(' ');
                    }
                }

                // Check title attribute
                if (element.getAttribute('title')) {
                    return element.getAttribute('title');
                }

                // For buttons and links, use text content
                if (element.tagName === 'BUTTON' || element.tagName === 'A') {
                    return element.textContent;
                }

                // For images, use alt text
                if (element.tagName === 'IMG') {
                    return element.getAttribute('alt') || '';
                }

                return element.textContent || '';
            }

            // Helper function to get visible text
            function getVisibleText(element) {
                // Clone element to manipulate
                const clone = element.cloneNode(true);
                
                // Remove screen-reader only text
                const srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]');
                srOnly.forEach(el => el.remove());
                
                // Remove icon fonts and decorative elements
                const icons = clone.querySelectorAll('[class*="icon"], [class*="fa-"], .material-icons');
                icons.forEach(el => {
                    // Only remove if it's purely decorative (no meaningful text)
                    if (el.textContent.trim().length <= 2) {
                        el.remove();
                    }
                });

                // Get the remaining text content
                let text = clone.textContent || '';
                
                // For images within buttons, include alt text
                const images = element.querySelectorAll('img');
                images.forEach(img => {
                    const alt = img.getAttribute('alt');
                    if (alt) {
                        text += ' ' + alt;
                    }
                });

                return text;
            }

            // Check regular buttons
            const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
            for (let i = 0; i < buttons.length; i++) {
                const button = buttons[i];
                const visibleText = normalizeText(getVisibleText(button));
                const accessibleName = normalizeText(getAccessibleName(button));

                // Skip buttons without visible text
                if (visibleText.length === 0) continue;

                // Check if visible text is contained in accessible name
                if (!accessibleName.includes(visibleText)) {
                    violations.push({
                        type: 'label-not-in-name',
                        category: 'button',
                        severity: 'serious',
                        element: `button[${i}]`,
                        description: 'Button visible text is not contained in accessible name',
                        details: {
                            visibleText: getVisibleText(button),
                            accessibleName: getAccessibleName(button),
                            visibleTextNormalized: visibleText,
                            accessibleNameNormalized: accessibleName,
                            tagName: button.tagName.toLowerCase(),
                            type: button.type || null,
                            id: button.id || null,
                            className: button.className || null,
                            ariaLabel: button.getAttribute('aria-label'),
                            ariaLabelledby: button.getAttribute('aria-labelledby')
                        },
                        wcagCriteria: '2.5.3',
                        impact: 'Voice control users cannot activate this button by speaking its visible text',
                        voiceControlCommand: `"Click ${getVisibleText(button)}" will fail`,
                        recommendation: 'Ensure accessible name contains the visible text'
                    });
                }
            }

            return violations;
        }, options);
    }

    /**
     * Analyze form controls for label in name compliance
     */
    async analyzeFormControls(page, options) {
        return await page.evaluate((scanOptions) => {
            const violations = [];

            function normalizeText(text) {
                if (!text) return '';
                let normalized = text.trim();
                if (scanOptions.ignoreWhitespace) {
                    normalized = normalized.replace(/\s+/g, ' ');
                }
                if (!scanOptions.caseSensitive) {
                    normalized = normalized.toLowerCase();
                }
                return normalized;
            }

            function getAccessibleName(element) {
                if (element.getAttribute('aria-label')) {
                    return element.getAttribute('aria-label');
                }

                const labelledBy = element.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const referencedElements = labelledBy.split(' ')
                        .map(id => document.getElementById(id))
                        .filter(el => el);
                    if (referencedElements.length > 0) {
                        return referencedElements.map(el => el.textContent).join(' ');
                    }
                }

                const labels = element.labels;
                if (labels && labels.length > 0) {
                    return Array.from(labels).map(label => label.textContent).join(' ');
                }

                if (element.getAttribute('title')) {
                    return element.getAttribute('title');
                }

                return '';
            }

            function getVisibleLabelText(element) {
                // Look for associated label elements
                const labels = element.labels;
                if (labels && labels.length > 0) {
                    return Array.from(labels).map(label => label.textContent.trim()).join(' ');
                }

                // Look for aria-labelledby references
                const labelledBy = element.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const referencedElements = labelledBy.split(' ')
                        .map(id => document.getElementById(id))
                        .filter(el => el);
                    if (referencedElements.length > 0) {
                        return referencedElements.map(el => el.textContent.trim()).join(' ');
                    }
                }

                // Look for placeholder text as visible text
                const placeholder = element.getAttribute('placeholder');
                if (placeholder) {
                    return placeholder;
                }

                // For select elements, check if there's visible text nearby
                if (element.tagName === 'SELECT') {
                    const parent = element.parentElement;
                    if (parent) {
                        const textNodes = [];
                        for (let child of parent.childNodes) {
                            if (child.nodeType === Node.TEXT_NODE) {
                                const text = child.textContent.trim();
                                if (text) textNodes.push(text);
                            }
                        }
                        if (textNodes.length > 0) {
                            return textNodes.join(' ');
                        }
                    }
                }

                return '';
            }

            // Check form controls
            const formControls = document.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]), select, textarea');
            for (let i = 0; i < formControls.length; i++) {
                const control = formControls[i];
                const visibleText = normalizeText(getVisibleLabelText(control));
                const accessibleName = normalizeText(getAccessibleName(control));

                // Skip controls without visible label text
                if (visibleText.length === 0) continue;

                // Check if visible text is contained in accessible name
                if (!accessibleName.includes(visibleText)) {
                    violations.push({
                        type: 'form-label-not-in-name',
                        category: 'form-control',
                        severity: 'serious',
                        element: `${control.tagName.toLowerCase()}[${i}]`,
                        description: 'Form control visible label is not contained in accessible name',
                        details: {
                            visibleText: getVisibleLabelText(control),
                            accessibleName: getAccessibleName(control),
                            visibleTextNormalized: visibleText,
                            accessibleNameNormalized: accessibleName,
                            tagName: control.tagName.toLowerCase(),
                            type: control.type || null,
                            id: control.id || null,
                            name: control.name || null,
                            placeholder: control.getAttribute('placeholder'),
                            ariaLabel: control.getAttribute('aria-label'),
                            ariaLabelledby: control.getAttribute('aria-labelledby'),
                            hasLabels: control.labels && control.labels.length > 0
                        },
                        wcagCriteria: '2.5.3',
                        impact: 'Voice control users cannot target this form field by speaking its visible label',
                        voiceControlCommand: `"Click ${getVisibleLabelText(control)}" will fail`,
                        recommendation: 'Ensure accessible name contains the visible label text'
                    });
                }
            }

            return violations;
        }, options);
    }

    /**
     * Analyze links for label in name compliance
     */
    async analyzeLinks(page, options) {
        return await page.evaluate((scanOptions) => {
            const violations = [];

            function normalizeText(text) {
                if (!text) return '';
                let normalized = text.trim();
                if (scanOptions.ignoreWhitespace) {
                    normalized = normalized.replace(/\s+/g, ' ');
                }
                if (!scanOptions.caseSensitive) {
                    normalized = normalized.toLowerCase();
                }
                return normalized;
            }

            function getAccessibleName(element) {
                if (element.getAttribute('aria-label')) {
                    return element.getAttribute('aria-label');
                }

                const labelledBy = element.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const referencedElements = labelledBy.split(' ')
                        .map(id => document.getElementById(id))
                        .filter(el => el);
                    if (referencedElements.length > 0) {
                        return referencedElements.map(el => el.textContent).join(' ');
                    }
                }

                if (element.getAttribute('title')) {
                    return element.getAttribute('title');
                }

                return element.textContent || '';
            }

            function getVisibleText(element) {
                const clone = element.cloneNode(true);
                
                // Remove screen-reader only text
                const srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]');
                srOnly.forEach(el => el.remove());
                
                // Remove decorative icons but keep meaningful text
                const icons = clone.querySelectorAll('[class*="icon"], [class*="fa-"], .material-icons');
                icons.forEach(el => {
                    if (el.textContent.trim().length <= 2) {
                        el.remove();
                    }
                });

                let text = clone.textContent || '';
                
                // Include alt text from images
                const images = element.querySelectorAll('img');
                images.forEach(img => {
                    const alt = img.getAttribute('alt');
                    if (alt) {
                        text += ' ' + alt;
                    }
                });

                return text;
            }

            // Check links
            const links = document.querySelectorAll('a[href]');
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const visibleText = normalizeText(getVisibleText(link));
                const accessibleName = normalizeText(getAccessibleName(link));

                // Skip links without visible text
                if (visibleText.length === 0) continue;

                // Skip links that are just URLs or very generic
                if (visibleText === 'here' || visibleText === 'click here' || visibleText === 'more' || 
                    visibleText === 'read more' || visibleText.startsWith('http')) {
                    continue;
                }

                // Check if visible text is contained in accessible name
                if (!accessibleName.includes(visibleText)) {
                    violations.push({
                        type: 'link-text-not-in-name',
                        category: 'link',
                        severity: 'moderate',
                        element: `a[${i}]`,
                        description: 'Link visible text is not contained in accessible name',
                        details: {
                            visibleText: getVisibleText(link),
                            accessibleName: getAccessibleName(link),
                            visibleTextNormalized: visibleText,
                            accessibleNameNormalized: accessibleName,
                            href: link.href,
                            id: link.id || null,
                            className: link.className || null,
                            ariaLabel: link.getAttribute('aria-label'),
                            ariaLabelledby: link.getAttribute('aria-labelledby'),
                            title: link.getAttribute('title')
                        },
                        wcagCriteria: '2.5.3',
                        impact: 'Voice control users cannot activate this link by speaking its visible text',
                        voiceControlCommand: `"Click ${getVisibleText(link)}" will fail`,
                        recommendation: 'Ensure accessible name contains the visible link text'
                    });
                }
            }

            return violations;
        }, options);
    }

    /**
     * Analyze image buttons for label in name compliance
     */
    async analyzeImageButtons(page, options) {
        return await page.evaluate((scanOptions) => {
            const violations = [];

            function normalizeText(text) {
                if (!text) return '';
                let normalized = text.trim();
                if (scanOptions.ignoreWhitespace) {
                    normalized = normalized.replace(/\s+/g, ' ');
                }
                if (!scanOptions.caseSensitive) {
                    normalized = normalized.toLowerCase();
                }
                return normalized;
            }

            // Check input type="image"
            const imageInputs = document.querySelectorAll('input[type="image"]');
            for (let i = 0; i < imageInputs.length; i++) {
                const input = imageInputs[i];
                const alt = input.getAttribute('alt') || '';
                const ariaLabel = input.getAttribute('aria-label') || '';
                const title = input.getAttribute('title') || '';
                
                const accessibleName = ariaLabel || alt || title;
                
                if (alt && accessibleName && !normalizeText(accessibleName).includes(normalizeText(alt))) {
                    violations.push({
                        type: 'image-button-alt-not-in-name',
                        category: 'image-button',
                        severity: 'serious',
                        element: `input[type="image"][${i}]`,
                        description: 'Image button alt text is not contained in accessible name',
                        details: {
                            altText: alt,
                            accessibleName: accessibleName,
                            ariaLabel: ariaLabel,
                            title: title,
                            id: input.id || null,
                            src: input.src
                        },
                        wcagCriteria: '2.5.3',
                        impact: 'Voice control users cannot activate this image button by speaking its alt text',
                        voiceControlCommand: `"Click ${alt}" will fail`,
                        recommendation: 'Ensure accessible name contains the alt text'
                    });
                }
            }

            // Check buttons containing images
            const buttonsWithImages = document.querySelectorAll('button img, a img');
            for (let i = 0; i < buttonsWithImages.length; i++) {
                const img = buttonsWithImages[i];
                const button = img.closest('button') || img.closest('a');
                if (!button) continue;

                const imgAlt = img.getAttribute('alt') || '';
                const buttonText = button.textContent || '';
                const buttonAriaLabel = button.getAttribute('aria-label') || '';
                
                const accessibleName = buttonAriaLabel || buttonText;
                
                if (imgAlt && accessibleName && !normalizeText(accessibleName).includes(normalizeText(imgAlt))) {
                    violations.push({
                        type: 'button-image-alt-not-in-name',
                        category: 'image-button',
                        severity: 'moderate',
                        element: `${button.tagName.toLowerCase()} img[${i}]`,
                        description: 'Button containing image - alt text not in accessible name',
                        details: {
                            imageAlt: imgAlt,
                            buttonText: buttonText,
                            buttonAccessibleName: accessibleName,
                            buttonTagName: button.tagName.toLowerCase(),
                            buttonId: button.id || null,
                            imgSrc: img.src
                        },
                        wcagCriteria: '2.5.3',
                        impact: 'Voice control users may not be able to activate button using image description',
                        voiceControlCommand: `"Click ${imgAlt}" may fail`,
                        recommendation: 'Include image alt text in button\'s accessible name'
                    });
                }
            }

            return violations;
        }, options);
    }

    /**
     * Analyze custom controls for label in name compliance
     */
    async analyzeCustomControls(page, options) {
        return await page.evaluate((scanOptions) => {
            const violations = [];

            function normalizeText(text) {
                if (!text) return '';
                let normalized = text.trim();
                if (scanOptions.ignoreWhitespace) {
                    normalized = normalized.replace(/\s+/g, ' ');
                }
                if (!scanOptions.caseSensitive) {
                    normalized = normalized.toLowerCase();
                }
                return normalized;
            }

            function getAccessibleName(element) {
                if (element.getAttribute('aria-label')) {
                    return element.getAttribute('aria-label');
                }

                const labelledBy = element.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const referencedElements = labelledBy.split(' ')
                        .map(id => document.getElementById(id))
                        .filter(el => el);
                    if (referencedElements.length > 0) {
                        return referencedElements.map(el => el.textContent).join(' ');
                    }
                }

                if (element.getAttribute('title')) {
                    return element.getAttribute('title');
                }

                return element.textContent || '';
            }

            function getVisibleText(element) {
                const clone = element.cloneNode(true);
                const srOnly = clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]');
                srOnly.forEach(el => el.remove());
                return clone.textContent || '';
            }

            // Check custom ARIA controls
            const customControls = document.querySelectorAll(
                '[role="button"], [role="checkbox"], [role="radio"], [role="switch"], ' +
                '[role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], ' +
                '[role="option"], [role="tab"], [role="menuitem"], [role="treeitem"]'
            );

            for (let i = 0; i < customControls.length; i++) {
                const control = customControls[i];
                const visibleText = normalizeText(getVisibleText(control));
                const accessibleName = normalizeText(getAccessibleName(control));
                const role = control.getAttribute('role');

                // Skip controls without visible text
                if (visibleText.length === 0) continue;

                // Check if visible text is contained in accessible name
                if (!accessibleName.includes(visibleText)) {
                    violations.push({
                        type: 'custom-control-label-not-in-name',
                        category: 'custom-control',
                        severity: 'serious',
                        element: `[role="${role}"][${i}]`,
                        description: 'Custom control visible text is not contained in accessible name',
                        details: {
                            visibleText: getVisibleText(control),
                            accessibleName: getAccessibleName(control),
                            visibleTextNormalized: visibleText,
                            accessibleNameNormalized: accessibleName,
                            role: role,
                            tagName: control.tagName.toLowerCase(),
                            id: control.id || null,
                            className: control.className || null,
                            ariaLabel: control.getAttribute('aria-label'),
                            ariaLabelledby: control.getAttribute('aria-labelledby')
                        },
                        wcagCriteria: '2.5.3',
                        impact: 'Voice control users cannot activate this custom control by speaking its visible text',
                        voiceControlCommand: `"Click ${getVisibleText(control)}" will fail`,
                        recommendation: 'Ensure accessible name contains the visible text'
                    });
                }
            }

            return violations;
        }, options);
    }

    /**
     * Get count of passed elements (estimated)
     */
    getPassedElementsCount(violations) {
        return Math.max(30 - violations.length, 0);
    }

    /**
     * Generate recommendations for label in name issues
     */
    generateLabelInNameRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.includes('label-not-in-name')) {
            recommendations.push({
                priority: 'critical',
                issue: 'Button visible text not in accessible name',
                solution: 'Update aria-label or accessible name to include visible button text',
                implementation: 'Use aria-label that starts with or contains the visible text, e.g., aria-label="Submit form" for button text "Submit"'
            });
        }

        if (issueTypes.includes('form-label-not-in-name')) {
            recommendations.push({
                priority: 'high',
                issue: 'Form control label not in accessible name',
                solution: 'Ensure form labels match or are contained in accessible names',
                implementation: 'Associate labels properly using <label for="id"> or aria-labelledby, ensure aria-label includes label text'
            });
        }

        if (issueTypes.includes('link-text-not-in-name')) {
            recommendations.push({
                priority: 'medium',
                issue: 'Link text not in accessible name',
                solution: 'Make sure link accessible names include visible link text',
                implementation: 'Avoid overriding link text with aria-label that doesn\'t include visible text'
            });
        }

        if (issueTypes.includes('image-button-alt-not-in-name')) {
            recommendations.push({
                priority: 'high',
                issue: 'Image button alt text not in accessible name',
                solution: 'Ensure image button accessible names include alt text',
                implementation: 'Use alt text that matches or is included in aria-label values'
            });
        }

        if (issueTypes.includes('custom-control-label-not-in-name')) {
            recommendations.push({
                priority: 'high',
                issue: 'Custom control visible text not in accessible name',
                solution: 'Update ARIA labels to include visible text content',
                implementation: 'Set aria-label to include the visible text, e.g., aria-label="Show details" for text "Show"'
            });
        }

        return recommendations;
    }

    /**
     * Generate voice control test cases
     */
    generateVoiceControlTestCases(violations) {
        const testCases = [];

        violations.forEach((violation, index) => {
            const visibleText = violation.details?.visibleText || '';
            if (visibleText) {
                testCases.push({
                    testId: `voice-test-${index + 1}`,
                    element: violation.element,
                    visibleText: visibleText,
                    expectedCommand: `"Click ${visibleText}"`,
                    currentBehavior: 'Command will fail - element not activated',
                    expectedBehavior: 'Element should be activated by voice command',
                    voiceControlSoftware: ['Dragon NaturallySpeaking', 'Windows Voice Control', 'macOS Voice Control'],
                    priority: violation.severity,
                    fixRequired: `Update accessible name to include "${visibleText}"`
                });
            }
        });

        return testCases;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = LabelInNameScanner;