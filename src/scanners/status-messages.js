const path = require('path');
const BaseScanner = require('../core/base-scanner');

/**
 * Status Messages Scanner for WCAG 4.1.3 compliance testing
 * Ensures status messages are programmatically determinable via ARIA live regions
 * Critical for screen reader users who need status change announcements
 */
class StatusMessagesScanner extends BaseScanner {
    constructor() {
        super('status-messages', {
            // 3.3.1 added alongside 4.1.3: the html5-validation-inaccessible
            // check (see analyzeFormValidationMessages) is re-tagged to 3.3.1
            // (Error Identification) below — it must be declared here or a
            // downstream consumer that filters violations against this list
            // would drop it as off-criteria.
            wcagCriteria: ['4.1.3', '3.3.1'],
            wcagPrinciple: 'robust'
        });
    }

    /**
     * This scanner clicks submit/action buttons to reveal JS-driven status
     * messages (see analyzeDynamicStatusMessages below) on the page it's
     * given. scan-pipeline.js runs every non-exclusive scanner concurrently
     * via Promise.allSettled against ONE shared page — so those clicks
     * mutate DOM that other, purely read-only scanners inspect at the same
     * time, and they end up independently reporting markup THIS scanner
     * injected. Confirmed case: html-validation's missing-status-attributes
     * flagging `div.good-status-success` in good-auto-submitting-form.html,
     * which only exists in the DOM after a click made here. Exclusive access
     * gives this scanner its own tab (with its own navigation) so its
     * side-effecting interactions can't leak into concurrent scanners.
     */
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

        // Fix A (missing-live-region false positives): install the
        // MutationObserver BEFORE any interaction happens, so it can witness
        // whatever the interaction step below actually changes. Real
        // dynamism evidence (source 2 of 3 — see installMutationObserver)
        // only exists if the observer is live before we start clicking.
        await this.installMutationObserver(page);

        // Dynamic analysis - simulate interactions to detect missing status
        // messages. This ALSO feeds mutation evidence to the evidence-gated
        // static analysis below, so it must run first.
        if (scanOptions.simulateInteractions) {
            const dynamicViolations = await this.analyzeDynamicStatusMessages(page, null, scanOptions);
            violations.push(...dynamicViolations);
        } else {
            // No simulated interactions — still honor a minimum observation
            // window in case content updates on its own (timers, etc.) before
            // the static pass reads the observer's evidence.
            await new Promise(resolve => setTimeout(resolve, this.getObservationWindow(scanOptions)));
        }

        // Static analysis of existing status message patterns — runs AFTER
        // interactions so it can use the mutation evidence gathered above.
        const staticViolations = await this.analyzeStaticStatusMessages(page, scanOptions);
        violations.push(...staticViolations);

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
     * Fix A helper: minimum practical MutationObserver window (ms). Even
     * under the "fast" scan profile (`observationTime: 0`), we still want a
     * brief settle window so a same-tick DOM mutation from a click has a
     * chance to be recorded before the static evidence pass reads it.
     */
    getObservationWindow(options = {}) {
        const MIN_WINDOW_MS = 400;
        if (typeof options.observationTime === 'number') {
            return Math.max(options.observationTime, MIN_WINDOW_MS);
        }
        return MIN_WINDOW_MS;
    }

    /**
     * Fix A: install a page-lifetime MutationObserver plus shared evidence
     * helpers, used by every subsequent page.evaluate() call this scanner
     * makes. This must run BEFORE any interaction (see scan()) so mutations
     * caused by clicking buttons/submitting forms are actually witnessed.
     *
     * Replaces the old approach (analyzeStaticStatusMessages flagging any
     * element whose className/id merely CONTAINED a keyword like "progress"
     * or "success") with real evidence that a live region is warranted:
     *   1. an ARIA role that implies dynamism (progressbar/timer, aria-busy)
     *      but lacks the live-region wiring to announce it;
     *   2. the element (or a descendant/ancestor) was actually mutated
     *      during the observation window below; or
     *   3. it's empty at load and targeted by a form control's
     *      aria-describedby/aria-errormessage (classic "error slot filled by
     *      JS" pattern) — unless the page already has a separate aria-live
     *      announcer as a compensating pattern.
     */
    async installMutationObserver(page) {
        await page.evaluate(() => {
            if (window.__a11yStatusObserverInstalled) return;
            window.__a11yStatusObserverInstalled = true;

            const MUTATED_ATTR = 'data-a11y-mutated';

            function markMutated(node) {
                const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
                if (el && el.setAttribute && !el.hasAttribute(MUTATED_ATTR)) {
                    try { el.setAttribute(MUTATED_ATTR, 'true'); } catch (e) { /* detached node, ignore */ }
                }
            }

            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    markMutated(mutation.target);
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                characterData: true,
                subtree: true
            });
            window.__a11yStatusObserver = observer;

            window.__a11yStatusHelpers = {
                // Already-compliant check (unchanged semantics from the
                // original code) plus: an element nested inside an existing
                // live-region ancestor doesn't need its own aria-live either.
                hasLiveRegionAttributes(element) {
                    if (!element) return false;
                    if (element.hasAttribute('aria-live')) return true;
                    const role = element.getAttribute('role');
                    if (role && ['status', 'alert', 'log'].includes(role)) return true;
                    if (element.hasAttribute('aria-atomic') || element.hasAttribute('aria-relevant')) return true;
                    return !!(element.closest && element.closest('[aria-live], [role="status"], [role="alert"], [role="log"]'));
                },

                // Evidence source 1: role/state signals a dynamic status
                // widget that still needs live-region wiring. role=status/
                // alert/log are already handled (and exempted) above.
                hasRoleEvidence(element) {
                    const role = element.getAttribute('role');
                    if (role === 'progressbar' || role === 'timer') return true;
                    if (element.tagName && element.tagName.toLowerCase() === 'progress') return true;
                    if (element.getAttribute('aria-busy') === 'true') return true;
                    return false;
                },

                // Evidence source 2: real runtime dynamism, observed. Checks
                // self-or-ancestor (an ancestor mutation, e.g. an innerHTML
                // replacement, can mean THIS element was just created) and
                // self-or-descendant (a nested node changed under a stable
                // container).
                hasMutationEvidence(element) {
                    if (!element) return false;
                    if (element.closest && element.closest(`[${MUTATED_ATTR}]`)) return true;
                    if (element.querySelector && element.querySelector(`[${MUTATED_ATTR}]`)) return true;
                    return false;
                },

                // Evidence source 3: classic "error slot filled by JS" —
                // empty at load, targeted by a control's aria-describedby/
                // aria-errormessage — unless a separate aria-live announcer
                // elsewhere on the page already covers announcements (an
                // accepted compensating pattern).
                isDescribedbyErrorSlot(element) {
                    if (!element || !element.id || element.textContent.trim()) return false;
                    const referrer = document.querySelector(
                        `[aria-describedby~="${element.id}"], [aria-errormessage="${element.id}"]`
                    );
                    if (!referrer) return false;
                    return !document.querySelector('[aria-live]');
                }
            };
        });
    }

    /**
     * Analyze static status message patterns
     */
    async analyzeStaticStatusMessages(page, options) {
        return await page.evaluate(() => {
            const violations = [];
            const helpers = window.__a11yStatusHelpers;

            // Helper function to generate element selector
            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Fix A: a candidate container is only a genuine missing-live-region
            // violation when there's real evidence it's a dynamic status region.
            // Bare className/id substring matching (the old sole trigger) no
            // longer flags on its own — e.g. `.progress-container`/`.progress-fill`
            // in good-accessibility.html and the static `.success` blurb in
            // good-skip-links.html are never touched by any script.
            function evaluateCandidate(container, meta) {
                if (helpers.hasLiveRegionAttributes(container)) return;

                const evidence = {
                    role: helpers.hasRoleEvidence(container),
                    mutated: helpers.hasMutationEvidence(container),
                    describedbyErrorSlot: helpers.isDescribedbyErrorSlot(container)
                };
                if (!evidence.role && !evidence.mutated && !evidence.describedbyErrorSlot) return;

                violations.push({
                    type: 'missing-live-region',
                    category: meta.category,
                    severity: meta.severity,
                    element: getElementSelector(container),
                    description: meta.description,
                    details: {
                        className: container.className,
                        id: container.id,
                        textContent: container.textContent.trim().substring(0, 100),
                        hasAriaLive: container.hasAttribute('aria-live'),
                        hasRole: container.hasAttribute('role'),
                        currentRole: container.getAttribute('role'),
                        evidence
                    },
                    wcagCriteria: '4.1.3',
                    impact: meta.impact,
                    recommendation: meta.recommendation
                });
            }

            // Look for error message containers
            const errorContainers = document.querySelectorAll([
                '.error', '.error-message', '.validation-error', '.field-error',
                '.alert-danger', '.alert-error', '.message-error',
                '[class*="error"]', '[id*="error"]', '[class*="invalid"]'
            ].join(', '));

            for (const container of errorContainers) {
                evaluateCandidate(container, {
                    category: 'error-message',
                    severity: 'serious',
                    description: 'Error message container lacks ARIA live region attributes',
                    impact: 'Error messages not announced to screen readers',
                    recommendation: 'Add aria-live="assertive" or role="alert" for error messages'
                });
            }

            // Look for success message containers
            const successContainers = document.querySelectorAll([
                '.success', '.success-message', '.alert-success', '.message-success',
                '.confirmation', '.saved', '.submitted', '[class*="success"]',
                '[id*="success"]', '[class*="confirm"]'
            ].join(', '));

            for (const container of successContainers) {
                evaluateCandidate(container, {
                    category: 'success-message',
                    severity: 'moderate',
                    description: 'Success message container lacks ARIA live region attributes',
                    impact: 'Success confirmations not announced to screen readers',
                    recommendation: 'Add aria-live="polite" or role="status" for success messages'
                });
            }

            // Look for loading indicators
            const loadingIndicators = document.querySelectorAll([
                '.loading', '.spinner', '.loader', '.progress', '.loading-message',
                '[class*="loading"]', '[id*="loading"]', '[class*="spinner"]',
                '[class*="progress"]'
            ].join(', '));

            for (const indicator of loadingIndicators) {
                evaluateCandidate(indicator, {
                    category: 'loading-state',
                    severity: 'moderate',
                    description: 'Loading indicator lacks ARIA live region attributes',
                    impact: 'Loading states not announced to screen readers',
                    recommendation: 'Add aria-live="polite" for loading state announcements'
                });
            }

            // Look for notification/toast containers
            const notificationContainers = document.querySelectorAll([
                '.notification', '.toast', '.alert', '.message', '.notice',
                '[class*="notification"]', '[class*="toast"]', '[class*="alert"]'
            ].join(', '));

            for (const container of notificationContainers) {
                evaluateCandidate(container, {
                    category: 'dynamic-content',
                    severity: 'moderate',
                    description: 'Notification container lacks ARIA live region attributes',
                    impact: 'Notifications not announced to screen readers',
                    recommendation: 'Add appropriate aria-live attributes based on urgency'
                });
            }

            // Look for shopping cart or counter updates. The "looks like a
            // live number" text check is kept as a pre-filter (a counter that
            // doesn't currently show a bare number isn't a useful candidate),
            // but real evidence is still required before flagging it.
            const counters = document.querySelectorAll([
                '.cart-count', '.badge', '.counter', '.count', '.quantity',
                '[class*="count"]', '[id*="count"]', '[class*="cart"]'
            ].join(', '));

            for (const counter of counters) {
                if (!counter.textContent.trim().match(/^\d+$/)) continue;
                evaluateCandidate(counter, {
                    category: 'dynamic-content',
                    severity: 'moderate',
                    description: 'Counter/badge lacks ARIA live region for updates',
                    impact: 'Count changes not announced to screen readers',
                    recommendation: 'Add aria-live="polite" for count updates'
                });
            }

            // Check progress bars — dedicated selector/compliance check kept
            // (aria-describedby or a nearby aria-live already satisfies it),
            // now also evidence-gated like every other category above.
            const progressBars = document.querySelectorAll('progress, [role="progressbar"], .progress-bar');
            for (const progress of progressBars) {
                const hasLiveAnnouncement = progress.hasAttribute('aria-live') ||
                                          progress.hasAttribute('aria-describedby') ||
                                          progress.parentElement.querySelector('[aria-live]');
                if (hasLiveAnnouncement) continue;

                const evidence = {
                    role: helpers.hasRoleEvidence(progress),
                    mutated: helpers.hasMutationEvidence(progress),
                    describedbyErrorSlot: false
                };
                if (!evidence.role && !evidence.mutated) continue;

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
                        hasAriaDescribedby: progress.hasAttribute('aria-describedby'),
                        evidence
                    },
                    wcagCriteria: '4.1.3',
                    impact: 'Progress updates not announced to screen readers',
                    recommendation: 'Add aria-live region or aria-describedby for progress announcements'
                });
            }

            return violations;
        });
    }

    /**
     * Block navigation caused by the clicks this scanner simulates.
     * A real submit/link navigation reloads the page under test: the validation
     * messages we want to observe disappear with it, and the execution context
     * of every other scanner sharing the page is destroyed mid-scan.
     * Capture phase so the page's own submit/click handlers still run.
     */
    async suppressNavigation(page) {
        await page.evaluate(() => {
            document.addEventListener('submit', (event) => event.preventDefault(), true);
            document.addEventListener('click', (event) => {
                const link = event.target.closest && event.target.closest('a[href]');
                if (link && !link.getAttribute('href').startsWith('#')) {
                    event.preventDefault();
                }
            }, true);
        });
    }

    /**
     * Analyze dynamic status messages through interaction simulation
     */
    async analyzeDynamicStatusMessages(page, scanDir, options) {
        const violations = [];

        // Fast-profile short-circuit: PROFILE_OPTIONS.fast sets
        // `heuristicOnly: true` (and `observationTime: 0`) specifically to
        // avoid this kind of expensive click-and-wait simulation. Skip the
        // form/button interaction loops entirely, but still hold open the
        // minimum observation window (see getObservationWindow) so the
        // MutationObserver installed in scan() has had a chance to run
        // before the static evidence pass reads it. In this mode,
        // missing-live-region evidence falls back to the static role/
        // aria-describedby checks only (Fix A sources 1 and 3) — fewer
        // findings, but still correct, never false.
        if (options.heuristicOnly) {
            await new Promise(resolve => setTimeout(resolve, this.getObservationWindow(options)));
            return violations;
        }

        // Test form submissions and interactions
        try {
            await this.suppressNavigation(page);

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
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for validation messages

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
                    await new Promise(resolve => setTimeout(resolve, 500));
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

        // Fix A: let the MutationObserver installed in scan() finish
        // observing (and let any late microtask-scheduled DOM updates
        // settle) before the static evidence pass reads its markers.
        await new Promise(resolve => setTimeout(resolve, this.getObservationWindow(options)));

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

                // Fix B: check for HTML5 validation without proper
                // accessibility — but only where there's real evidence of a
                // problem. Native constraint validation IS exposed to
                // assistive technology by evergreen browsers and is a
                // WCAG-sufficient technique for simple cases, and SC 4.1.3 is
                // specifically about messages presented WITHOUT a change of
                // focus — native validation moves focus to the invalid
                // field, so a plain `<input required>` in an otherwise
                // untouched form is not, by itself, a violation of anything.
                // Only flag when the page shows evidence it suppresses or
                // replaces that native behavior with JS that doesn't provide
                // accessible feedback: a `novalidate`/inline `onsubmit` on
                // the form (interactive constraint validation is skipped or
                // intercepted), or the field is already marked
                // aria-invalid="true" with no accessible error text reachable
                // via aria-describedby/aria-errormessage.
                if (field.hasAttribute('required') || field.hasAttribute('pattern') || field.type === 'email') {
                    const hasCustomValidation = field.hasAttribute('aria-describedby') ||
                                              field.hasAttribute('aria-invalid') ||
                                              errorContainer;

                    const form = field.form;
                    const formSuppressesNativeValidation = !!(form && (
                        form.hasAttribute('novalidate') || form.hasAttribute('onsubmit')
                    ));

                    function hasAccessibleErrorText(f) {
                        const ids = [f.getAttribute('aria-describedby'), f.getAttribute('aria-errormessage')]
                            .filter(Boolean)
                            .join(' ')
                            .split(/\s+/)
                            .filter(Boolean);
                        if (ids.length === 0) return false;
                        return ids.some((id) => {
                            const el = document.getElementById(id);
                            if (!el) return false;
                            if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
                            return !!el.textContent.trim();
                        });
                    }

                    const invalidWithNoAccessibleText = field.getAttribute('aria-invalid') === 'true' &&
                        !hasAccessibleErrorText(field);

                    const hasSuppressionEvidence = formSuppressesNativeValidation || invalidWithNoAccessibleText;

                    if (!hasCustomValidation && hasSuppressionEvidence) {
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
                                validationMessage: field.validationMessage || null,
                                formNovalidate: !!(form && form.hasAttribute('novalidate')),
                                formOnsubmit: !!(form && form.hasAttribute('onsubmit')),
                                ariaInvalid: field.getAttribute('aria-invalid')
                            },
                            wcagCriteria: '3.3.1',
                            impact: 'JS suppresses or intercepts native HTML5 validation without providing an accessible replacement',
                            recommendation: 'When suppressing native constraint validation (novalidate/onsubmit), provide equivalent accessible error messaging via aria-describedby and aria-invalid'
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
            const helpers = window.__a11yStatusHelpers;

            // Helper function to generate element selector
            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Check for AJAX loading patterns. Fix A: this selector shares the
            // exact same `[class*="loading"]`/`[class*="progress"]` substring-
            // match bug as analyzeStaticStatusMessages (e.g. it also matches
            // good-accessibility.html's static `.progress-container`/
            // `.progress-fill`) — so it needs the same evidence gate, or the
            // fix there would just resurface identical false positives here
            // under the sibling 'loading-state-no-announcement' type instead.
            const loadingPatterns = document.querySelectorAll([
                '[id*="loading"]', '[class*="loading"]', '[id*="spinner"]', '[class*="spinner"]',
                '.loader', '.progress', '[class*="progress"]'
            ].join(', '));

            for (const pattern of loadingPatterns) {
                if (!pattern.textContent.trim()) continue;
                if (helpers.hasLiveRegionAttributes(pattern)) continue;
                if (!helpers.hasRoleEvidence(pattern) && !helpers.hasMutationEvidence(pattern)) continue;

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
                        role: pattern.getAttribute('role'),
                        evidence: {
                            role: helpers.hasRoleEvidence(pattern),
                            mutated: helpers.hasMutationEvidence(pattern)
                        }
                    },
                    wcagCriteria: '4.1.3',
                    impact: 'Loading status changes not announced to screen readers',
                    recommendation: 'Add aria-live="polite" for loading state announcements'
                });
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
