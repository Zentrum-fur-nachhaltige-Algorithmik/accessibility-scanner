const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Status Messages Scanner for WCAG 4.1.3 compliance testing
 * Ensures status messages are programmatically determinable via ARIA live regions
 * Critical for screen reader users who need status change announcements
 */
class StatusMessagesScanner extends BaseScanner {
    constructor() {
        super('status-messages', {
            wcagCriteria: ['4.1.3'],
            wcagPrinciple: 'robust'
        });
        this.screenshotDir = path.join(__dirname, '../tmp/status-messages-screenshots');
    }

    /**
     * Core scan method. Receives an already-navigated Puppeteer page.
     * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} ScanResult
     */
    async scan(page, options = {}) {
        const defaultOptions = {
            checkFormValidation: true,
            checkLoadingStates: true,
            checkDynamicContent: true,
            checkErrorMessages: true,
            checkSuccessMessages: true,
            checkProgressIndicators: true,
            simulateInteractions: true,
            timeout: 60000
        };

        const scanOptions = { ...defaultOptions, ...options };

        const violations = [];

        // Static analysis of existing status message patterns
        const staticViolations = await this.analyzeStaticStatusMessages(page, scanOptions);
        violations.push(...staticViolations);

        // Dynamic analysis - simulate interactions to detect missing status messages
        if (scanOptions.simulateInteractions) {
            const dynamicViolations = await this.analyzeDynamicStatusMessages(page, null, scanOptions);
            violations.push(...dynamicViolations);
        }

        // Analyze form validation feedback
        if (scanOptions.checkFormValidation) {
            const formViolations = await this.analyzeFormValidationMessages(page, null, scanOptions);
            violations.push(...formViolations);
        }

        // Analyze loading states and progress indicators
        if (scanOptions.checkLoadingStates) {
            const loadingViolations = await this.analyzeLoadingStateMessages(page, scanOptions);
            violations.push(...loadingViolations);
        }

        return {
            scannerId: this.id,
            criteria: ["4.1.3"],
            passed: violations.length === 0,
            violations: violations,
            summary: {
                totalStatusElements: violations.length + this.getPassedElementsCount(violations),
                formValidationIssues: violations.filter(v => v.category === 'form-validation').length,
                loadingStateIssues: violations.filter(v => v.category === 'loading-state').length,
                dynamicContentIssues: violations.filter(v => v.category === 'dynamic-content').length,
                errorMessageIssues: violations.filter(v => v.category === 'error-message').length,
                successMessageIssues: violations.filter(v => v.category === 'success-message').length,
                progressIndicatorIssues: violations.filter(v => v.category === 'progress-indicator').length,
                missingLiveRegions: violations.filter(v => v.type === 'missing-live-region').length
            },
            recommendations: this.generateStatusMessagesRecommendations(violations),
            screenReaderTesting: this.generateScreenReaderTestCases(violations)
        };
    }

    /**
     * @deprecated Use scan(page, options) via ScanPipeline instead
     * Scan status messages compliance (WCAG 4.1.3)
     * @param {string} url - URL to scan
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} StatusMessagesReport
     */
    async scanStatusMessages(url, options = {}) {
        const defaultOptions = {
            checkFormValidation: true,
            checkLoadingStates: true,
            checkDynamicContent: true,
            checkErrorMessages: true,
            checkSuccessMessages: true,
            checkProgressIndicators: true,
            simulateInteractions: true,
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
            const screenshotPath = path.join(scanDir, 'status-messages-analysis.png');
            await page.screenshot({
                path: screenshotPath,
                fullPage: true
            });

            try {
                const result = await this.scan(page, options);
                result.screenshotPath = screenshotPath;
                return result;
            } finally {
                await page.close();
            }

        } catch (error) {
            throw new Error(`Status messages scan failed: ${error.message}`);
        }
    }

    /**
     * Analyze static status message patterns
     */
    async analyzeStaticStatusMessages(page, options) {
        return await page.evaluate(() => {
            const violations = [];

            // Helper function to generate element selector
            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Helper function to check if element has proper live region attributes
            function hasLiveRegionAttributes(element) {
                return element.hasAttribute('aria-live') ||
                       element.hasAttribute('role') && ['status', 'alert', 'log'].includes(element.getAttribute('role')) ||
                       element.hasAttribute('aria-atomic') ||
                       element.hasAttribute('aria-relevant');
            }

            // Look for error message containers
            const errorContainers = document.querySelectorAll([
                '.error', '.error-message', '.validation-error', '.field-error',
                '.alert-danger', '.alert-error', '.message-error',
                '[class*="error"]', '[id*="error"]', '[class*="invalid"]'
            ].join(', '));

            for (const container of errorContainers) {
                if (!hasLiveRegionAttributes(container)) {
                    violations.push({
                        type: 'missing-live-region',
                        category: 'error-message',
                        severity: 'serious',
                        element: getElementSelector(container),
                        description: 'Error message container lacks ARIA live region attributes',
                        details: {
                            className: container.className,
                            id: container.id,
                            textContent: container.textContent.trim().substring(0, 100),
                            hasAriaLive: container.hasAttribute('aria-live'),
                            hasRole: container.hasAttribute('role'),
                            currentRole: container.getAttribute('role')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Error messages not announced to screen readers',
                        recommendation: 'Add aria-live="assertive" or role="alert" for error messages'
                    });
                }
            }

            // Look for success message containers
            const successContainers = document.querySelectorAll([
                '.success', '.success-message', '.alert-success', '.message-success',
                '.confirmation', '.saved', '.submitted', '[class*="success"]',
                '[id*="success"]', '[class*="confirm"]'
            ].join(', '));

            for (const container of successContainers) {
                if (!hasLiveRegionAttributes(container)) {
                    violations.push({
                        type: 'missing-live-region',
                        category: 'success-message',
                        severity: 'moderate',
                        element: getElementSelector(container),
                        description: 'Success message container lacks ARIA live region attributes',
                        details: {
                            className: container.className,
                            id: container.id,
                            textContent: container.textContent.trim().substring(0, 100),
                            hasAriaLive: container.hasAttribute('aria-live'),
                            hasRole: container.hasAttribute('role'),
                            currentRole: container.getAttribute('role')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Success confirmations not announced to screen readers',
                        recommendation: 'Add aria-live="polite" or role="status" for success messages'
                    });
                }
            }

            // Look for loading indicators
            const loadingIndicators = document.querySelectorAll([
                '.loading', '.spinner', '.loader', '.progress', '.loading-message',
                '[class*="loading"]', '[id*="loading"]', '[class*="spinner"]',
                '[class*="progress"]'
            ].join(', '));

            for (const indicator of loadingIndicators) {
                if (!hasLiveRegionAttributes(indicator)) {
                    violations.push({
                        type: 'missing-live-region',
                        category: 'loading-state',
                        severity: 'moderate',
                        element: getElementSelector(indicator),
                        description: 'Loading indicator lacks ARIA live region attributes',
                        details: {
                            className: indicator.className,
                            id: indicator.id,
                            textContent: indicator.textContent.trim().substring(0, 100),
                            hasAriaLive: indicator.hasAttribute('aria-live'),
                            hasRole: indicator.hasAttribute('role'),
                            currentRole: indicator.getAttribute('role')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Loading states not announced to screen readers',
                        recommendation: 'Add aria-live="polite" for loading state announcements'
                    });
                }
            }

            // Look for notification/toast containers
            const notificationContainers = document.querySelectorAll([
                '.notification', '.toast', '.alert', '.message', '.notice',
                '[class*="notification"]', '[class*="toast"]', '[class*="alert"]'
            ].join(', '));

            for (const container of notificationContainers) {
                if (!hasLiveRegionAttributes(container)) {
                    violations.push({
                        type: 'missing-live-region',
                        category: 'dynamic-content',
                        severity: 'moderate',
                        element: getElementSelector(container),
                        description: 'Notification container lacks ARIA live region attributes',
                        details: {
                            className: container.className,
                            id: container.id,
                            textContent: container.textContent.trim().substring(0, 100),
                            hasAriaLive: container.hasAttribute('aria-live'),
                            hasRole: container.hasAttribute('role'),
                            currentRole: container.getAttribute('role')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Notifications not announced to screen readers',
                        recommendation: 'Add appropriate aria-live attributes based on urgency'
                    });
                }
            }

            // Look for shopping cart or counter updates
            const counters = document.querySelectorAll([
                '.cart-count', '.badge', '.counter', '.count', '.quantity',
                '[class*="count"]', '[id*="count"]', '[class*="cart"]'
            ].join(', '));

            for (const counter of counters) {
                if (!hasLiveRegionAttributes(counter) && counter.textContent.trim().match(/^\d+$/)) {
                    violations.push({
                        type: 'missing-live-region',
                        category: 'dynamic-content',
                        severity: 'moderate',
                        element: getElementSelector(counter),
                        description: 'Counter/badge lacks ARIA live region for updates',
                        details: {
                            className: counter.className,
                            id: counter.id,
                            currentValue: counter.textContent.trim(),
                            hasAriaLive: counter.hasAttribute('aria-live'),
                            hasRole: counter.hasAttribute('role')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Count changes not announced to screen readers',
                        recommendation: 'Add aria-live="polite" for count updates'
                    });
                }
            }

            // Check progress bars
            const progressBars = document.querySelectorAll('progress, [role="progressbar"], .progress-bar');
            for (const progress of progressBars) {
                const hasLiveAnnouncement = progress.hasAttribute('aria-live') ||
                                          progress.hasAttribute('aria-describedby') ||
                                          progress.parentElement.querySelector('[aria-live]');

                if (!hasLiveAnnouncement) {
                    violations.push({
                        type: 'missing-live-region',
                        category: 'progress-indicator',
                        severity: 'moderate',
                        element: getElementSelector(progress),
                        description: 'Progress indicator lacks live region for status updates',
                        details: {
                            tagName: progress.tagName.toLowerCase(),
                            role: progress.getAttribute('role'),
                            ariaValueNow: progress.getAttribute('aria-valuenow'),
                            ariaValueText: progress.getAttribute('aria-valuetext'),
                            hasAriaDescribedby: progress.hasAttribute('aria-describedby')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Progress updates not announced to screen readers',
                        recommendation: 'Add aria-live region or aria-describedby for progress announcements'
                    });
                }
            }

            return violations;
        });
    }

    /**
     * Analyze dynamic status messages through interaction simulation
     */
    async analyzeDynamicStatusMessages(page, scanDir, options) {
        const violations = [];

        // Test form submissions and interactions
        try {
            // Look for forms to test
            const forms = await page.$$('form');

            for (let i = 0; i < Math.min(forms.length, 3); i++) { // Limit to 3 forms
                const form = forms[i];

                // Take screenshot before interaction (only if scanDir provided)
                if (scanDir) {
                    await page.screenshot({
                        path: path.join(scanDir, `form-${i}-before.png`)
                    });
                }

                // Try to submit form to trigger validation
                try {
                    const submitButton = await form.$('button[type="submit"], input[type="submit"], button:not([type])');
                    if (submitButton) {
                        await submitButton.click();
                        await page.waitForTimeout(1000); // Wait for validation messages

                        // Take screenshot after interaction (only if scanDir provided)
                        if (scanDir) {
                            await page.screenshot({
                                path: path.join(scanDir, `form-${i}-after.png`)
                            });
                        }

                        // Check if any new content appeared without live regions
                        const newErrors = await page.evaluate(() => {
                            const errorElements = document.querySelectorAll('.error:not([aria-live]), .invalid:not([aria-live]), .validation-error:not([aria-live])');
                            return Array.from(errorElements).map(el => ({
                                selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.className ? `.${el.className.split(' ')[0]}` : ''),
                                text: el.textContent.trim(),
                                visible: el.offsetParent !== null
                            })).filter(err => err.visible && err.text);
                        });

                        for (const error of newErrors) {
                            violations.push({
                                type: 'dynamic-status-without-announcement',
                                category: 'form-validation',
                                severity: 'serious',
                                element: error.selector,
                                description: 'Form validation error appears without ARIA live region',
                                details: {
                                    errorText: error.text,
                                    triggeredBy: 'form submission',
                                    formIndex: i
                                },
                                wcagCriteria: '4.1.3',
                                impact: 'Form validation errors not announced to screen readers',
                                recommendation: 'Add aria-live="assertive" to dynamically shown error messages'
                            });
                        }
                    }
                } catch (e) {
                    // Form submission might fail, that's okay for testing
                }
            }

            // Test interactive buttons that might show status
            const interactiveButtons = await page.$$('button:not([type="submit"]), [role="button"], .btn:not([type="submit"])');

            for (let i = 0; i < Math.min(interactiveButtons.length, 5); i++) { // Limit to 5 buttons
                const button = interactiveButtons[i];

                try {
                    const beforeContent = await page.evaluate(() => document.body.innerHTML.length);
                    await button.click();
                    await page.waitForTimeout(500);
                    const afterContent = await page.evaluate(() => document.body.innerHTML.length);

                    // If content changed, check for new status messages
                    if (afterContent !== beforeContent) {
                        const newMessages = await page.evaluate(() => {
                            // Look for recently added content that looks like status messages
                            const statusLikeElements = document.querySelectorAll([
                                '*[style*="display: block"]:not([aria-live])',
                                '.show:not([aria-live])', '.visible:not([aria-live])',
                                '.message:not([aria-live])', '.alert:not([aria-live])'
                            ].join(', '));

                            return Array.from(statusLikeElements).map(el => {
                                const text = el.textContent.trim();
                                if (text && text.length > 5 && text.length < 200) {
                                    return {
                                        selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
                                        text: text,
                                        className: el.className
                                    };
                                }
                                return null;
                            }).filter(Boolean);
                        });

                        for (const message of newMessages) {
                            violations.push({
                                type: 'dynamic-status-without-announcement',
                                category: 'dynamic-content',
                                severity: 'moderate',
                                element: message.selector,
                                description: 'Dynamic content appears without ARIA live region',
                                details: {
                                    messageText: message.text,
                                    triggeredBy: 'button interaction',
                                    buttonIndex: i,
                                    className: message.className
                                },
                                wcagCriteria: '4.1.3',
                                impact: 'Dynamic status changes not announced to screen readers',
                                recommendation: 'Add aria-live attributes to dynamically updated content'
                            });
                        }
                    }
                } catch (e) {
                    // Button interaction might fail, continue testing
                }
            }

        } catch (error) {
            console.warn('Error during dynamic interaction testing:', error.message);
        }

        return violations;
    }

    /**
     * Analyze form validation message patterns
     */
    async analyzeFormValidationMessages(page, scanDir, options) {
        return await page.evaluate(() => {
            const violations = [];

            // Helper function to generate element selector
            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Check form fields with validation patterns
            const formFields = document.querySelectorAll('input, textarea, select');

            for (const field of formFields) {
                const fieldSelector = getElementSelector(field);

                // Check for associated error message containers
                const errorContainer = field.parentElement.querySelector('.error, .invalid, .validation-error') ||
                                     document.querySelector(`[id="${field.id}-error"]`) ||
                                     document.querySelector(`[for="${field.id}"].error`);

                if (errorContainer) {
                    const hasLiveRegion = errorContainer.hasAttribute('aria-live') ||
                                        errorContainer.hasAttribute('role') && ['alert', 'status'].includes(errorContainer.getAttribute('role'));

                    if (!hasLiveRegion) {
                        violations.push({
                            type: 'form-validation-no-live-region',
                            category: 'form-validation',
                            severity: 'serious',
                            element: getElementSelector(errorContainer),
                            description: 'Form field error container lacks ARIA live region',
                            details: {
                                fieldSelector: fieldSelector,
                                fieldType: field.type || field.tagName.toLowerCase(),
                                fieldRequired: field.hasAttribute('required'),
                                errorContainerText: errorContainer.textContent.trim(),
                                fieldAriaDescribedby: field.getAttribute('aria-describedby'),
                                errorContainerRole: errorContainer.getAttribute('role')
                            },
                            wcagCriteria: '4.1.3',
                            impact: 'Form validation errors not announced to screen readers',
                            recommendation: 'Add aria-live="assertive" or role="alert" to error containers'
                        });
                    }
                }

                // Check for HTML5 validation without proper accessibility
                if (field.hasAttribute('required') || field.hasAttribute('pattern') || field.type === 'email') {
                    const hasCustomValidation = field.hasAttribute('aria-describedby') ||
                                              field.hasAttribute('aria-invalid') ||
                                              errorContainer;

                    if (!hasCustomValidation) {
                        violations.push({
                            type: 'html5-validation-inaccessible',
                            category: 'form-validation',
                            severity: 'moderate',
                            element: fieldSelector,
                            description: 'HTML5 validation without accessible error handling',
                            details: {
                                fieldType: field.type,
                                hasRequired: field.hasAttribute('required'),
                                hasPattern: field.hasAttribute('pattern'),
                                pattern: field.getAttribute('pattern'),
                                validationMessage: field.validationMessage || null
                            },
                            wcagCriteria: '4.1.3',
                            impact: 'HTML5 validation messages may not be accessible to screen readers',
                            recommendation: 'Implement custom accessible validation with aria-describedby and live regions'
                        });
                    }
                }
            }

            return violations;
        });
    }

    /**
     * Analyze loading state message patterns
     */
    async analyzeLoadingStateMessages(page, options) {
        return await page.evaluate(() => {
            const violations = [];

            // Helper function to generate element selector
            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Check for AJAX loading patterns
            const loadingPatterns = document.querySelectorAll([
                '[id*="loading"]', '[class*="loading"]', '[id*="spinner"]', '[class*="spinner"]',
                '.loader', '.progress', '[class*="progress"]'
            ].join(', '));

            for (const pattern of loadingPatterns) {
                const hasLiveRegion = pattern.hasAttribute('aria-live') ||
                                    pattern.hasAttribute('role') && ['status', 'progressbar'].includes(pattern.getAttribute('role'));

                if (!hasLiveRegion && pattern.textContent.trim()) {
                    violations.push({
                        type: 'loading-state-no-announcement',
                        category: 'loading-state',
                        severity: 'moderate',
                        element: getElementSelector(pattern),
                        description: 'Loading indicator lacks ARIA live region for status updates',
                        details: {
                            textContent: pattern.textContent.trim(),
                            className: pattern.className,
                            id: pattern.id,
                            tagName: pattern.tagName.toLowerCase(),
                            role: pattern.getAttribute('role')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Loading status changes not announced to screen readers',
                        recommendation: 'Add aria-live="polite" for loading state announcements'
                    });
                }
            }

            // Check for buttons that might trigger loading states
            const asyncButtons = document.querySelectorAll('button[onclick*="ajax"], button[onclick*="fetch"], button[class*="async"], .submit-button, .save-button');

            for (const button of asyncButtons) {
                // Look for nearby status containers
                const nearbyStatusContainer = button.parentElement.querySelector('.status, .message, .result') ||
                                            button.nextElementSibling;

                if (nearbyStatusContainer &&
                    !nearbyStatusContainer.hasAttribute('aria-live') &&
                    !nearbyStatusContainer.hasAttribute('role')) {

                    violations.push({
                        type: 'async-action-no-status-announcement',
                        category: 'loading-state',
                        severity: 'moderate',
                        element: getElementSelector(nearbyStatusContainer),
                        description: 'Container near async button lacks ARIA live region for status updates',
                        details: {
                            buttonSelector: getElementSelector(button),
                            buttonText: button.textContent.trim(),
                            containerSelector: getElementSelector(nearbyStatusContainer),
                            containerText: nearbyStatusContainer.textContent.trim()
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Async operation results not announced to screen readers',
                        recommendation: 'Add aria-live region for async operation feedback'
                    });
                }
            }

            return violations;
        });
    }

    /**
     * Get count of passed elements (estimated)
     */
    getPassedElementsCount(violations) {
        return Math.max(25 - violations.length, 0);
    }

    /**
     * Generate recommendations for status message issues
     */
    generateStatusMessagesRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.includes('missing-live-region')) {
            recommendations.push({
                priority: 'critical',
                issue: 'Status containers missing ARIA live regions',
                solution: 'Add appropriate aria-live attributes to status message containers',
                implementation: 'Use aria-live="assertive" for urgent alerts, aria-live="polite" for status updates, or role="alert" and role="status"'
            });
        }

        if (issueTypes.includes('dynamic-status-without-announcement')) {
            recommendations.push({
                priority: 'high',
                issue: 'Dynamic status changes not announced',
                solution: 'Ensure dynamically shown content has ARIA live regions',
                implementation: 'Add aria-live attributes before showing dynamic content, or inject content into existing live regions'
            });
        }

        if (issueTypes.includes('form-validation-no-live-region')) {
            recommendations.push({
                priority: 'high',
                issue: 'Form validation errors not announced',
                solution: 'Implement accessible form validation with live regions',
                implementation: 'Use aria-live="assertive" on error containers and aria-describedby to associate errors with fields'
            });
        }

        if (issueTypes.includes('loading-state-no-announcement')) {
            recommendations.push({
                priority: 'medium',
                issue: 'Loading states not announced to screen readers',
                solution: 'Add live regions for loading and progress announcements',
                implementation: 'Use aria-live="polite" for loading states and provide text alternatives to visual indicators'
            });
        }

        if (issueTypes.includes('html5-validation-inaccessible')) {
            recommendations.push({
                priority: 'medium',
                issue: 'HTML5 validation may not be accessible',
                solution: 'Implement custom accessible validation',
                implementation: 'Use aria-invalid, aria-describedby, and custom error messages with live regions instead of relying on browser validation'
            });
        }

        return recommendations;
    }

    /**
     * Generate screen reader test cases
     */
    generateScreenReaderTestCases(violations) {
        const testCases = [];

        violations.forEach((violation, index) => {
            const testId = `screen-reader-test-${index + 1}`;

            switch (violation.category) {
                case 'form-validation':
                    testCases.push({
                        testId: testId,
                        element: violation.element,
                        category: violation.category,
                        testScenario: 'Submit form with invalid data',
                        expectedBehavior: 'Screen reader should announce validation errors',
                        currentBehavior: 'Validation errors shown visually but not announced',
                        screenReaderSoftware: ['NVDA', 'JAWS', 'VoiceOver'],
                        priority: violation.severity,
                        testSteps: [
                            '1. Navigate to form field',
                            '2. Enter invalid data or leave required field empty',
                            '3. Submit form or move to next field',
                            '4. Listen for error announcement'
                        ]
                    });
                    break;

                case 'loading-state':
                    testCases.push({
                        testId: testId,
                        element: violation.element,
                        category: violation.category,
                        testScenario: 'Trigger loading/progress state',
                        expectedBehavior: 'Screen reader should announce loading status and completion',
                        currentBehavior: 'Loading states shown visually but not announced',
                        screenReaderSoftware: ['NVDA', 'JAWS', 'VoiceOver'],
                        priority: violation.severity,
                        testSteps: [
                            '1. Activate button or trigger that causes loading',
                            '2. Listen for loading announcement',
                            '3. Wait for operation to complete',
                            '4. Listen for completion announcement'
                        ]
                    });
                    break;

                case 'dynamic-content':
                    testCases.push({
                        testId: testId,
                        element: violation.element,
                        category: violation.category,
                        testScenario: 'Trigger dynamic content change',
                        expectedBehavior: 'Screen reader should announce content updates',
                        currentBehavior: 'Content changes shown visually but not announced',
                        screenReaderSoftware: ['NVDA', 'JAWS', 'VoiceOver'],
                        priority: violation.severity,
                        testSteps: [
                            '1. Perform action that updates content',
                            '2. Listen for change announcement',
                            '3. Verify announced content matches visual update'
                        ]
                    });
                    break;

                default:
                    testCases.push({
                        testId: testId,
                        element: violation.element,
                        category: violation.category,
                        testScenario: 'Test status message announcement',
                        expectedBehavior: 'Screen reader should announce status changes',
                        currentBehavior: 'Status changes not announced',
                        screenReaderSoftware: ['NVDA', 'JAWS', 'VoiceOver'],
                        priority: violation.severity,
                        testSteps: [
                            '1. Trigger status change',
                            '2. Listen for announcement',
                            '3. Verify message content and timing'
                        ]
                    });
            }
        });

        return testCases;
    }

}

module.exports = StatusMessagesScanner;
