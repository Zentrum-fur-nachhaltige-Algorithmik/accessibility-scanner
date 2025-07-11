const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

/**
 * Phase 6E: Dynamic Content & Single Page Application (SPA) Scanner
 * Implements testing for dynamic content updates, route changes, and SPA accessibility
 * Critical for modern web applications with dynamic content and client-side routing
 * CSP-independent implementation focusing on DOM observation and interaction testing
 */
class DynamicSpaScanner {
    constructor() {
        this.browser = null;
        this.screenshotDir = path.join(__dirname, '../tmp/dynamic-spa-screenshots');
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
     * Scan dynamic content and SPA accessibility
     * @param {string} url - URL to scan
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} DynamicSpaReport
     */
    async scanDynamicSpa(url, options = {}) {
        const defaultOptions = {
            testRouteChanges: true,
            testDynamicContent: true,
            testLoadingStates: true,
            testErrorStates: true,
            testFormSubmissions: true,
            testModalDialogs: true,
            testInfiniteScroll: true,
            testSearchFilters: true,
            monitorFocusManagement: true,
            checkLiveRegions: true,
            interactionTimeout: 5000,
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

            // Take initial screenshot
            const initialScreenshot = path.join(scanDir, 'initial-state.png');
            await page.screenshot({ 
                path: initialScreenshot, 
                fullPage: true 
            });

            const violations = [];
            const interactionResults = [];

            // Set up monitoring for dynamic changes
            await this.setupDynamicMonitoring(page);

            // Test route changes and navigation
            if (scanOptions.testRouteChanges) {
                const routeViolations = await this.testRouteChanges(page, scanDir, scanOptions);
                violations.push(...routeViolations);
            }

            // Test dynamic content updates
            if (scanOptions.testDynamicContent) {
                const dynamicViolations = await this.testDynamicContentUpdates(page, scanDir, scanOptions);
                violations.push(...dynamicViolations);
            }

            // Test loading states
            if (scanOptions.testLoadingStates) {
                const loadingViolations = await this.testLoadingStates(page, scanDir, scanOptions);
                violations.push(...loadingViolations);
            }

            // Test form submissions and validation
            if (scanOptions.testFormSubmissions) {
                const formViolations = await this.testFormSubmissions(page, scanDir, scanOptions);
                violations.push(...formViolations);
            }

            // Test modal dialogs and overlays
            if (scanOptions.testModalDialogs) {
                const modalViolations = await this.testModalDialogs(page, scanDir, scanOptions);
                violations.push(...modalViolations);
            }

            // Test infinite scroll and pagination
            if (scanOptions.testInfiniteScroll) {
                const scrollViolations = await this.testInfiniteScroll(page, scanDir, scanOptions);
                violations.push(...scrollViolations);
            }

            // Test search and filtering
            if (scanOptions.testSearchFilters) {
                const searchViolations = await this.testSearchFilters(page, scanDir, scanOptions);
                violations.push(...searchViolations);
            }

            // Monitor focus management throughout interactions
            if (scanOptions.monitorFocusManagement) {
                const focusViolations = await this.monitorFocusManagement(page, scanOptions);
                violations.push(...focusViolations);
            }

            await page.close();

            const report = {
                criteria: ["2.4.3", "3.2.1", "3.2.2", "4.1.3"],
                passed: violations.length === 0,
                violations: violations,
                summary: {
                    totalInteractionsTested: interactionResults.length,
                    routeChangeIssues: violations.filter(v => v.category === 'route-change').length,
                    dynamicContentIssues: violations.filter(v => v.category === 'dynamic-content').length,
                    loadingStateIssues: violations.filter(v => v.category === 'loading-state').length,
                    formSubmissionIssues: violations.filter(v => v.category === 'form-submission').length,
                    modalDialogIssues: violations.filter(v => v.category === 'modal-dialog').length,
                    infiniteScrollIssues: violations.filter(v => v.category === 'infinite-scroll').length,
                    searchFilterIssues: violations.filter(v => v.category === 'search-filter').length,
                    focusManagementIssues: violations.filter(v => v.category === 'focus-management').length,
                    liveRegionIssues: violations.filter(v => v.category === 'live-region').length
                },
                interactionResults: interactionResults,
                screenshotDir: scanDir,
                recommendations: this.generateDynamicSpaRecommendations(violations),
                spaTestingGuidance: this.generateSpaTestingGuidance(violations)
            };

            return report;

        } catch (error) {
            throw new Error(`Dynamic SPA scan failed: ${error.message}`);
        }
    }

    /**
     * Set up monitoring for dynamic content changes
     */
    async setupDynamicMonitoring(page) {
        await page.evaluateOnNewDocument(() => {
            window.accessibilityMonitor = {
                changes: [],
                focusChanges: [],
                announcements: []
            };

            // Monitor DOM mutations
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        window.accessibilityMonitor.changes.push({
                            type: 'dom-change',
                            timestamp: Date.now(),
                            addedNodes: mutation.addedNodes.length,
                            target: mutation.target.tagName || 'unknown'
                        });
                    }
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Monitor focus changes
            document.addEventListener('focusin', (e) => {
                window.accessibilityMonitor.focusChanges.push({
                    timestamp: Date.now(),
                    element: e.target.tagName + (e.target.id ? `#${e.target.id}` : ''),
                    role: e.target.getAttribute('role')
                });
            });

            // Monitor aria-live announcements
            const liveRegions = document.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
            liveRegions.forEach(region => {
                const regionObserver = new MutationObserver(() => {
                    window.accessibilityMonitor.announcements.push({
                        timestamp: Date.now(),
                        content: region.textContent.trim(),
                        ariaLive: region.getAttribute('aria-live'),
                        role: region.getAttribute('role')
                    });
                });
                
                regionObserver.observe(region, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            });
        });
    }

    /**
     * Test route changes and SPA navigation
     */
    async testRouteChanges(page, scanDir, options) {
        const violations = [];

        try {
            // Look for navigation links
            const navLinks = await page.$$('a[href*="#"], a[href^="/"], .nav-link, .route-link, [data-route]');
            
            if (navLinks.length === 0) {
                return violations; // No apparent SPA navigation
            }

            console.log(`🔄 Testing ${navLinks.length} navigation links...`);

            for (let i = 0; i < Math.min(navLinks.length, 5); i++) { // Limit to 5 links
                const link = navLinks[i];
                
                try {
                    // Get initial page state
                    const initialUrl = await page.url();
                    const initialTitle = await page.title();
                    
                    // Take screenshot before navigation
                    await page.screenshot({
                        path: path.join(scanDir, `route-before-${i}.png`)
                    });

                    // Click the navigation link
                    await link.click();
                    await page.waitForTimeout(options.interactionTimeout);

                    // Take screenshot after navigation
                    await page.screenshot({
                        path: path.join(scanDir, `route-after-${i}.png`)
                    });

                    // Check for route change violations
                    const routeViolations = await page.evaluate((linkIndex) => {
                        const violations = [];

                        // Check if page title changed appropriately
                        const currentTitle = document.title;
                        if (!currentTitle || currentTitle === 'Document' || currentTitle.length < 3) {
                            violations.push({
                                type: 'missing-page-title-update',
                                category: 'route-change',
                                severity: 'serious',
                                element: 'title',
                                description: 'Page title not updated after route change',
                                details: {
                                    linkIndex: linkIndex,
                                    currentTitle: currentTitle
                                },
                                wcagCriteria: '2.4.2',
                                impact: 'Screen readers cannot identify page context after navigation',
                                recommendation: 'Update document.title when routes change'
                            });
                        }

                        // Check for focus management after route change
                        const activeElement = document.activeElement;
                        if (!activeElement || activeElement === document.body) {
                            violations.push({
                                type: 'no-focus-management-route-change',
                                category: 'route-change',
                                severity: 'serious',
                                element: document.activeElement ? document.activeElement.tagName.toLowerCase() : 'none',
                                description: 'Focus not managed after route change',
                                details: {
                                    linkIndex: linkIndex,
                                    activeElement: activeElement ? activeElement.tagName : 'none'
                                },
                                wcagCriteria: '2.4.3',
                                impact: 'Keyboard users lose track of location after navigation',
                                recommendation: 'Set focus to main content area or page heading after route change'
                            });
                        }

                        // Check for proper heading structure on new page
                        const h1Elements = document.querySelectorAll('h1');
                        if (h1Elements.length === 0) {
                            violations.push({
                                type: 'missing-h1-after-route-change',
                                category: 'route-change',
                                severity: 'moderate',
                                element: 'h1',
                                description: 'No H1 heading found after route change',
                                details: {
                                    linkIndex: linkIndex,
                                    h1Count: h1Elements.length
                                },
                                wcagCriteria: '2.4.6',
                                impact: 'Users cannot identify main page content',
                                recommendation: 'Ensure each route has a descriptive H1 heading'
                            });
                        } else if (h1Elements.length > 1) {
                            violations.push({
                                type: 'multiple-h1-after-route-change',
                                category: 'route-change',
                                severity: 'moderate',
                                element: 'h1',
                                description: 'Multiple H1 headings found after route change',
                                details: {
                                    linkIndex: linkIndex,
                                    h1Count: h1Elements.length
                                },
                                wcagCriteria: '2.4.6',
                                impact: 'Confusing heading structure for screen readers',
                                recommendation: 'Use only one H1 heading per page/route'
                            });
                        }

                        // Check for loading indicators without proper accessibility
                        const loadingIndicators = document.querySelectorAll('.loading, .spinner, [class*="loading"]');
                        loadingIndicators.forEach((indicator, idx) => {
                            if (!indicator.hasAttribute('aria-label') && 
                                !indicator.hasAttribute('aria-live') &&
                                indicator.textContent.trim() === '') {
                                violations.push({
                                    type: 'loading-indicator-inaccessible',
                                    category: 'route-change',
                                    severity: 'moderate',
                                    element: indicator.tagName.toLowerCase() + (indicator.className ? `.${indicator.className.split(' ')[0]}` : ''),
                                    description: 'Loading indicator during route change lacks accessibility attributes',
                                    details: {
                                        linkIndex: linkIndex,
                                        indicatorIndex: idx,
                                        hasAriaLabel: indicator.hasAttribute('aria-label'),
                                        hasAriaLive: indicator.hasAttribute('aria-live')
                                    },
                                    wcagCriteria: '4.1.3',
                                    impact: 'Loading states not announced to screen readers',
                                    recommendation: 'Add aria-label and aria-live="polite" to loading indicators'
                                });
                            }
                        });

                        return violations;
                    }, i);

                    violations.push(...routeViolations);

                    // Return to initial state for next test
                    if (await page.url() !== initialUrl) {
                        await page.goBack();
                        await page.waitForTimeout(1000);
                    }

                } catch (error) {
                    console.warn(`Error testing navigation link ${i}:`, error.message);
                }
            }

        } catch (error) {
            console.warn('Error during route change testing:', error.message);
        }

        return violations;
    }

    /**
     * Test dynamic content updates
     */
    async testDynamicContentUpdates(page, scanDir, options) {
        return await page.evaluate(() => {
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string' 
                    ? `.${element.className.split(' ')[0]}` 
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Look for elements that appear to update dynamically
            const dynamicElements = document.querySelectorAll(
                '[data-bind], [data-update], .dynamic-content, .live-update, ' +
                '[ng-bind], [v-text], [x-text], .react-component'
            );

            dynamicElements.forEach((element, index) => {
                // Check if dynamic content has proper live region
                if (!element.hasAttribute('aria-live') && 
                    !element.closest('[aria-live]') &&
                    !element.hasAttribute('role') ||
                    !['status', 'alert', 'log'].includes(element.getAttribute('role'))) {
                    
                    violations.push({
                        type: 'dynamic-content-no-live-region',
                        category: 'dynamic-content',
                        severity: 'serious',
                        element: getElementSelector(element),
                        description: 'Dynamic content lacks ARIA live region for announcements',
                        details: {
                            elementIndex: index,
                            hasAriaLive: element.hasAttribute('aria-live'),
                            hasRole: element.hasAttribute('role'),
                            role: element.getAttribute('role'),
                            hasClosestLiveRegion: !!element.closest('[aria-live]')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Dynamic content changes not announced to screen readers',
                        recommendation: 'Add aria-live="polite" or role="status" to dynamic content containers'
                    });
                }
            });

            // Check for counters and badges that update
            const counters = document.querySelectorAll(
                '.counter, .badge, .notification-count, [class*="count"], ' +
                '[data-count], .cart-count, .unread-count'
            );

            counters.forEach((counter, index) => {
                if (!counter.hasAttribute('aria-live') && 
                    !counter.closest('[aria-live]')) {
                    
                    violations.push({
                        type: 'counter-no-live-region',
                        category: 'dynamic-content',
                        severity: 'moderate',
                        element: getElementSelector(counter),
                        description: 'Counter/badge lacks ARIA live region for value updates',
                        details: {
                            counterIndex: index,
                            currentValue: counter.textContent.trim(),
                            hasAriaLive: counter.hasAttribute('aria-live')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Count changes not announced to screen readers',
                        recommendation: 'Add aria-live="polite" to elements that display changing counts'
                    });
                }
            });

            // Check for search results containers
            const searchResults = document.querySelectorAll(
                '.search-results, .results-container, .filter-results, ' +
                '[data-results], .search-output'
            );

            searchResults.forEach((results, index) => {
                if (!results.hasAttribute('aria-live') && 
                    !results.closest('[aria-live]')) {
                    
                    violations.push({
                        type: 'search-results-no-live-region',
                        category: 'dynamic-content',
                        severity: 'serious',
                        element: getElementSelector(results),
                        description: 'Search results container lacks ARIA live region',
                        details: {
                            resultsIndex: index,
                            hasAriaLive: results.hasAttribute('aria-live'),
                            itemCount: results.querySelectorAll('li, .item, .result').length
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Search result updates not announced to screen readers',
                        recommendation: 'Add aria-live="polite" to search results containers'
                    });
                }
            });

            return violations;
        });
    }

    /**
     * Test loading states accessibility
     */
    async testLoadingStates(page, scanDir, options) {
        return await page.evaluate(() => {
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string' 
                    ? `.${element.className.split(' ')[0]}` 
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find loading indicators
            const loadingElements = document.querySelectorAll(
                '.loading, .spinner, .loader, .progress-bar, ' +
                '[class*="loading"], [class*="spinner"], [aria-busy="true"]'
            );

            loadingElements.forEach((loading, index) => {
                // Check for proper ARIA attributes
                if (!loading.hasAttribute('aria-label') && 
                    !loading.hasAttribute('aria-labelledby') &&
                    loading.textContent.trim() === '') {
                    
                    violations.push({
                        type: 'loading-state-no-label',
                        category: 'loading-state',
                        severity: 'serious',
                        element: getElementSelector(loading),
                        description: 'Loading indicator lacks accessible name',
                        details: {
                            loadingIndex: index,
                            hasAriaLabel: loading.hasAttribute('aria-label'),
                            hasAriaLabelledby: loading.hasAttribute('aria-labelledby'),
                            hasTextContent: loading.textContent.trim().length > 0
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify loading state',
                        recommendation: 'Add aria-label="Loading..." to loading indicators'
                    });
                }

                // Check for live region announcements
                if (!loading.hasAttribute('aria-live') && 
                    !loading.closest('[aria-live]')) {
                    
                    violations.push({
                        type: 'loading-state-no-live-region',
                        category: 'loading-state',
                        severity: 'moderate',
                        element: getElementSelector(loading),
                        description: 'Loading state changes not announced via live region',
                        details: {
                            loadingIndex: index,
                            hasAriaLive: loading.hasAttribute('aria-live')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'Loading state changes not announced to screen readers',
                        recommendation: 'Add aria-live="polite" for loading state announcements'
                    });
                }
            });

            // Check for progress bars
            const progressBars = document.querySelectorAll(
                'progress, [role="progressbar"], .progress-bar'
            );

            progressBars.forEach((progress, index) => {
                if (progress.tagName === 'PROGRESS') {
                    // HTML5 progress element - check for accessibility
                    if (!progress.hasAttribute('aria-label') && 
                        !progress.hasAttribute('aria-labelledby')) {
                        
                        violations.push({
                            type: 'progress-bar-no-label',
                            category: 'loading-state',
                            severity: 'moderate',
                            element: getElementSelector(progress),
                            description: 'Progress bar lacks accessible name',
                            details: {
                                progressIndex: index,
                                value: progress.value,
                                max: progress.max
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot identify progress bar purpose',
                            recommendation: 'Add aria-label describing progress purpose'
                        });
                    }
                } else if (progress.getAttribute('role') === 'progressbar') {
                    // ARIA progressbar - check required attributes
                    if (!progress.hasAttribute('aria-valuenow')) {
                        violations.push({
                            type: 'aria-progressbar-missing-valuenow',
                            category: 'loading-state',
                            severity: 'serious',
                            element: getElementSelector(progress),
                            description: 'ARIA progressbar lacks aria-valuenow attribute',
                            details: {
                                progressIndex: index,
                                hasAriaValuenow: progress.hasAttribute('aria-valuenow'),
                                hasAriaValuemax: progress.hasAttribute('aria-valuemax'),
                                hasAriaValuemin: progress.hasAttribute('aria-valuemin')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot determine progress value',
                            recommendation: 'Add aria-valuenow, aria-valuemin, and aria-valuemax attributes'
                        });
                    }
                }
            });

            return violations;
        });
    }

    /**
     * Test form submissions and validation
     */
    async testFormSubmissions(page, scanDir, options) {
        const violations = [];

        try {
            const forms = await page.$$('form');
            
            for (let i = 0; i < Math.min(forms.length, 3); i++) { // Limit to 3 forms
                const form = forms[i];
                
                try {
                    // Take screenshot before form interaction
                    await page.screenshot({
                        path: path.join(scanDir, `form-before-${i}.png`)
                    });

                    // Try to submit form to trigger validation
                    const submitButton = await form.$('button[type="submit"], input[type="submit"]');
                    if (submitButton) {
                        await submitButton.click();
                        await page.waitForTimeout(2000);

                        // Take screenshot after submission
                        await page.screenshot({
                            path: path.join(scanDir, `form-after-${i}.png`)
                        });

                        // Check for form validation accessibility
                        const formViolations = await page.evaluate((formIndex) => {
                            const violations = [];

                            // Check for error messages without live regions
                            const errorMessages = document.querySelectorAll(
                                '.error, .invalid, .validation-error, .field-error, ' +
                                '[class*="error"], [data-error], .error-message'
                            );

                            errorMessages.forEach((error, errorIndex) => {
                                if (!error.hasAttribute('aria-live') && 
                                    !error.closest('[aria-live]') &&
                                    error.textContent.trim()) {
                                    
                                    violations.push({
                                        type: 'form-validation-no-live-region',
                                        category: 'form-submission',
                                        severity: 'serious',
                                        element: error.tagName.toLowerCase() + (error.className ? `.${error.className.split(' ')[0]}` : ''),
                                        description: 'Form validation error not announced via live region',
                                        details: {
                                            formIndex: formIndex,
                                            errorIndex: errorIndex,
                                            errorText: error.textContent.trim(),
                                            hasAriaLive: error.hasAttribute('aria-live')
                                        },
                                        wcagCriteria: '4.1.3',
                                        impact: 'Form validation errors not announced to screen readers',
                                        recommendation: 'Add aria-live="assertive" to error message containers'
                                    });
                                }
                            });

                            // Check for success messages
                            const successMessages = document.querySelectorAll(
                                '.success, .valid, .success-message, .confirmation, ' +
                                '[class*="success"], [data-success]'
                            );

                            successMessages.forEach((success, successIndex) => {
                                if (!success.hasAttribute('aria-live') && 
                                    !success.closest('[aria-live]') &&
                                    success.textContent.trim()) {
                                    
                                    violations.push({
                                        type: 'form-success-no-live-region',
                                        category: 'form-submission',
                                        severity: 'moderate',
                                        element: success.tagName.toLowerCase() + (success.className ? `.${success.className.split(' ')[0]}` : ''),
                                        description: 'Form success message not announced via live region',
                                        details: {
                                            formIndex: formIndex,
                                            successIndex: successIndex,
                                            successText: success.textContent.trim(),
                                            hasAriaLive: success.hasAttribute('aria-live')
                                        },
                                        wcagCriteria: '4.1.3',
                                        impact: 'Form submission confirmation not announced to screen readers',
                                        recommendation: 'Add aria-live="polite" to success message containers'
                                    });
                                }
                            });

                            return violations;
                        }, i);

                        violations.push(...formViolations);
                    }

                } catch (error) {
                    console.warn(`Error testing form ${i}:`, error.message);
                }
            }

        } catch (error) {
            console.warn('Error during form submission testing:', error.message);
        }

        return violations;
    }

    /**
     * Test modal dialogs and overlays
     */
    async testModalDialogs(page, scanDir, options) {
        const violations = [];

        try {
            // Look for modal triggers
            const modalTriggers = await page.$$('button[data-modal], .modal-trigger, [data-toggle="modal"], .open-modal');
            
            for (let i = 0; i < Math.min(modalTriggers.length, 3); i++) { // Limit to 3 modals
                const trigger = modalTriggers[i];
                
                try {
                    await trigger.click();
                    await page.waitForTimeout(1000);

                    // Take screenshot with modal open
                    await page.screenshot({
                        path: path.join(scanDir, `modal-open-${i}.png`)
                    });

                    // Check modal accessibility
                    const modalViolations = await page.evaluate((modalIndex) => {
                        const violations = [];

                        // Find modal dialogs
                        const modals = document.querySelectorAll(
                            '[role="dialog"], .modal, .overlay, .popup, ' +
                            '[class*="modal"], [aria-modal="true"]'
                        );

                        modals.forEach((modal, index) => {
                            if (modal.offsetParent !== null) { // Modal is visible
                                // Check for proper role
                                if (!modal.hasAttribute('role') || 
                                    !['dialog', 'alertdialog'].includes(modal.getAttribute('role'))) {
                                    
                                    violations.push({
                                        type: 'modal-missing-dialog-role',
                                        category: 'modal-dialog',
                                        severity: 'serious',
                                        element: modal.tagName.toLowerCase() + (modal.className ? `.${modal.className.split(' ')[0]}` : ''),
                                        description: 'Modal lacks proper dialog role',
                                        details: {
                                            modalIndex: modalIndex,
                                            currentRole: modal.getAttribute('role')
                                        },
                                        wcagCriteria: '4.1.2',
                                        impact: 'Screen readers cannot identify modal as dialog',
                                        recommendation: 'Add role="dialog" or role="alertdialog" to modal'
                                    });
                                }

                                // Check for aria-modal
                                if (!modal.hasAttribute('aria-modal')) {
                                    violations.push({
                                        type: 'modal-missing-aria-modal',
                                        category: 'modal-dialog',
                                        severity: 'moderate',
                                        element: modal.tagName.toLowerCase() + (modal.className ? `.${modal.className.split(' ')[0]}` : ''),
                                        description: 'Modal lacks aria-modal attribute',
                                        details: {
                                            modalIndex: modalIndex,
                                            hasAriaModal: modal.hasAttribute('aria-modal')
                                        },
                                        wcagCriteria: '4.1.2',
                                        impact: 'Screen readers may not understand modal behavior',
                                        recommendation: 'Add aria-modal="true" to modal dialogs'
                                    });
                                }

                                // Check for accessible name
                                if (!modal.hasAttribute('aria-labelledby') && 
                                    !modal.hasAttribute('aria-label')) {
                                    
                                    violations.push({
                                        type: 'modal-missing-accessible-name',
                                        category: 'modal-dialog',
                                        severity: 'serious',
                                        element: modal.tagName.toLowerCase() + (modal.className ? `.${modal.className.split(' ')[0]}` : ''),
                                        description: 'Modal lacks accessible name',
                                        details: {
                                            modalIndex: modalIndex,
                                            hasAriaLabel: modal.hasAttribute('aria-label'),
                                            hasAriaLabelledby: modal.hasAttribute('aria-labelledby')
                                        },
                                        wcagCriteria: '4.1.2',
                                        impact: 'Screen readers cannot identify modal purpose',
                                        recommendation: 'Add aria-labelledby pointing to modal title or aria-label'
                                    });
                                }
                            }
                        });

                        return violations;
                    }, i);

                    violations.push(...modalViolations);

                    // Try to close modal
                    const closeButton = await page.$('.modal .close, .modal [aria-label*="close"], .modal .modal-close');
                    if (closeButton) {
                        await closeButton.click();
                        await page.waitForTimeout(500);
                    } else {
                        // Try pressing Escape
                        await page.keyboard.press('Escape');
                        await page.waitForTimeout(500);
                    }

                } catch (error) {
                    console.warn(`Error testing modal ${i}:`, error.message);
                }
            }

        } catch (error) {
            console.warn('Error during modal dialog testing:', error.message);
        }

        return violations;
    }

    /**
     * Test infinite scroll and pagination
     */
    async testInfiniteScroll(page, scanDir, options) {
        return await page.evaluate(() => {
            const violations = [];

            // Look for infinite scroll containers
            const scrollContainers = document.querySelectorAll(
                '.infinite-scroll, [data-infinite], .lazy-load, ' +
                '.scroll-container, [class*="infinite"]'
            );

            scrollContainers.forEach((container, index) => {
                // Check for proper loading announcements
                if (!container.querySelector('[aria-live]') && 
                    !container.hasAttribute('aria-live')) {
                    
                    violations.push({
                        type: 'infinite-scroll-no-live-region',
                        category: 'infinite-scroll',
                        severity: 'serious',
                        element: container.tagName.toLowerCase() + (container.className ? `.${container.className.split(' ')[0]}` : ''),
                        description: 'Infinite scroll container lacks live region for loading announcements',
                        details: {
                            containerIndex: index,
                            hasAriaLive: container.hasAttribute('aria-live'),
                            hasChildLiveRegion: !!container.querySelector('[aria-live]')
                        },
                        wcagCriteria: '4.1.3',
                        impact: 'New content loading not announced to screen readers',
                        recommendation: 'Add aria-live region to announce when new content loads'
                    });
                }

                // Check for keyboard accessibility
                const items = container.querySelectorAll('li, .item, .card, [data-item]');
                let focusableItems = 0;
                items.forEach(item => {
                    if (item.hasAttribute('tabindex') || 
                        item.querySelector('a, button, input, select, textarea, [tabindex]')) {
                        focusableItems++;
                    }
                });

                if (items.length > 0 && focusableItems === 0) {
                    violations.push({
                        type: 'infinite-scroll-not-keyboard-accessible',
                        category: 'infinite-scroll',
                        severity: 'serious',
                        element: container.tagName.toLowerCase() + (container.className ? `.${container.className.split(' ')[0]}` : ''),
                        description: 'Infinite scroll items not keyboard accessible',
                        details: {
                            containerIndex: index,
                            totalItems: items.length,
                            focusableItems: focusableItems
                        },
                        wcagCriteria: '2.1.1',
                        impact: 'Keyboard users cannot access infinite scroll content',
                        recommendation: 'Make items focusable or provide keyboard navigation controls'
                    });
                }
            });

            return violations;
        });
    }

    /**
     * Test search and filtering functionality
     */
    async testSearchFilters(page, scanDir, options) {
        const violations = [];

        try {
            const searchInputs = await page.$$('input[type="search"], .search-input, [placeholder*="search"]');
            
            for (let i = 0; i < Math.min(searchInputs.length, 2); i++) { // Limit to 2 search inputs
                const searchInput = searchInputs[i];
                
                try {
                    await searchInput.type('test search');
                    await page.waitForTimeout(1000);

                    // Take screenshot after search
                    await page.screenshot({
                        path: path.join(scanDir, `search-results-${i}.png`)
                    });

                    // Check search results accessibility
                    const searchViolations = await page.evaluate((searchIndex) => {
                        const violations = [];

                        // Look for search results containers
                        const resultsContainers = document.querySelectorAll(
                            '.search-results, .results, .filter-results, ' +
                            '[data-results], .search-output'
                        );

                        resultsContainers.forEach((results, index) => {
                            // Check for live region announcements
                            if (!results.hasAttribute('aria-live') && 
                                !results.closest('[aria-live]')) {
                                
                                violations.push({
                                    type: 'search-results-no-live-region',
                                    category: 'search-filter',
                                    severity: 'serious',
                                    element: results.tagName.toLowerCase() + (results.className ? `.${results.className.split(' ')[0]}` : ''),
                                    description: 'Search results not announced via live region',
                                    details: {
                                        searchIndex: searchIndex,
                                        resultsIndex: index,
                                        resultCount: results.querySelectorAll('li, .item, .result').length
                                    },
                                    wcagCriteria: '4.1.3',
                                    impact: 'Search result updates not announced to screen readers',
                                    recommendation: 'Add aria-live="polite" to search results container'
                                });
                            }

                            // Check for result count announcements
                            const countElement = results.querySelector('.count, .result-count, [data-count]');
                            if (!countElement && results.children.length > 0) {
                                violations.push({
                                    type: 'search-missing-result-count',
                                    category: 'search-filter',
                                    severity: 'moderate',
                                    element: results.tagName.toLowerCase() + (results.className ? `.${results.className.split(' ')[0]}` : ''),
                                    description: 'Search results lack count information',
                                    details: {
                                        searchIndex: searchIndex,
                                        resultsIndex: index,
                                        hasCountElement: !!countElement
                                    },
                                    wcagCriteria: '4.1.3',
                                    impact: 'Users cannot determine number of search results',
                                    recommendation: 'Include accessible result count information'
                                });
                            }
                        });

                        return violations;
                    }, i);

                    violations.push(...searchViolations);

                    // Clear search
                    await searchInput.click({ clickCount: 3 });
                    await searchInput.press('Backspace');
                    await page.waitForTimeout(500);

                } catch (error) {
                    console.warn(`Error testing search input ${i}:`, error.message);
                }
            }

        } catch (error) {
            console.warn('Error during search filter testing:', error.message);
        }

        return violations;
    }

    /**
     * Monitor focus management throughout interactions
     */
    async monitorFocusManagement(page, options) {
        return await page.evaluate(() => {
            const violations = [];

            // Check if focus monitoring was set up
            if (window.accessibilityMonitor && window.accessibilityMonitor.focusChanges) {
                const focusChanges = window.accessibilityMonitor.focusChanges;
                
                // Analyze focus patterns
                if (focusChanges.length === 0) {
                    violations.push({
                        type: 'no-focus-tracking',
                        category: 'focus-management',
                        severity: 'low',
                        element: 'document',
                        description: 'No focus changes detected during dynamic interactions',
                        details: {
                            focusChangeCount: focusChanges.length
                        },
                        wcagCriteria: '2.4.3',
                        impact: 'May indicate poor focus management in dynamic content',
                        recommendation: 'Ensure proper focus management during content updates'
                    });
                }

                // Check for focus traps in modals (simplified check)
                const modalElements = document.querySelectorAll('[role="dialog"], .modal');
                modalElements.forEach((modal, index) => {
                    if (modal.offsetParent !== null) { // Modal is visible
                        const focusableElements = modal.querySelectorAll(
                            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                        );
                        
                        if (focusableElements.length === 0) {
                            violations.push({
                                type: 'modal-no-focusable-elements',
                                category: 'focus-management',
                                severity: 'serious',
                                element: modal.tagName.toLowerCase() + (modal.className ? `.${modal.className.split(' ')[0]}` : ''),
                                description: 'Modal dialog contains no focusable elements',
                                details: {
                                    modalIndex: index,
                                    focusableCount: focusableElements.length
                                },
                                wcagCriteria: '2.1.2',
                                impact: 'Keyboard users may be trapped in modal',
                                recommendation: 'Ensure modals contain focusable elements and implement focus trap'
                            });
                        }
                    }
                });
            }

            return violations;
        });
    }

    /**
     * Generate dynamic SPA recommendations
     */
    generateDynamicSpaRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.some(type => type.includes('route-change'))) {
            recommendations.push({
                priority: 'critical',
                issue: 'Route changes not properly announced or managed',
                solution: 'Implement proper SPA accessibility patterns for navigation',
                implementation: 'Update page titles, manage focus, announce route changes via live regions'
            });
        }

        if (issueTypes.some(type => type.includes('live-region'))) {
            recommendations.push({
                priority: 'critical',
                issue: 'Dynamic content changes not announced to screen readers',
                solution: 'Implement ARIA live regions for all dynamic content updates',
                implementation: 'Add aria-live="polite" for updates, aria-live="assertive" for urgent alerts'
            });
        }

        if (issueTypes.some(type => type.includes('focus-management'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Poor focus management in dynamic interfaces',
                solution: 'Implement comprehensive focus management strategy',
                implementation: 'Manage focus on route changes, modal open/close, content updates'
            });
        }

        if (issueTypes.some(type => type.includes('form-submission'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Form validation and submission feedback not accessible',
                solution: 'Make form interactions fully accessible with proper announcements',
                implementation: 'Use aria-live for validation errors and success messages'
            });
        }

        if (issueTypes.some(type => type.includes('modal-dialog'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Modal dialogs not properly implemented for accessibility',
                solution: 'Follow ARIA modal dialog pattern correctly',
                implementation: 'Use role="dialog", aria-modal="true", proper labeling, and focus management'
            });
        }

        return recommendations;
    }

    /**
     * Generate SPA testing guidance
     */
    generateSpaTestingGuidance(violations) {
        return {
            overview: {
                purpose: 'Single Page Applications require special accessibility considerations',
                keyRequirements: ['Route change announcements', 'Focus management', 'Live regions', 'Loading states'],
                testingApproach: 'Test both automatic behavior and user interactions'
            },
            testingProcedures: {
                routeChanges: {
                    steps: [
                        '1. Navigate between SPA routes',
                        '2. Verify page title updates',
                        '3. Check focus management after navigation',
                        '4. Ensure route changes are announced',
                        '5. Test with screen reader and keyboard only'
                    ],
                    wcagCriteria: '2.4.2, 2.4.3, 3.2.1'
                },
                dynamicContent: {
                    steps: [
                        '1. Trigger dynamic content updates',
                        '2. Verify live region announcements',
                        '3. Test search and filter interactions',
                        '4. Check loading state announcements',
                        '5. Validate with screen reader'
                    ],
                    wcagCriteria: '4.1.3'
                },
                focusManagement: {
                    steps: [
                        '1. Test keyboard navigation throughout app',
                        '2. Verify focus indicators are visible',
                        '3. Check modal dialog focus trapping',
                        '4. Test focus return after modal close',
                        '5. Ensure logical focus order'
                    ],
                    wcagCriteria: '2.1.2, 2.4.3, 2.4.7'
                }
            },
            automatedFindings: violations.length,
            manualValidationRequired: 'Critical - SPA accessibility requires extensive manual testing'
        };
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = DynamicSpaScanner;