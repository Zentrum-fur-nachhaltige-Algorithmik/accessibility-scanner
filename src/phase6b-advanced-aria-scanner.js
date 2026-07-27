const fs = require('fs-extra');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Phase 6B: Advanced ARIA Complex Widgets Scanner
 * Implements comprehensive testing for WCAG 4.1.2 (Name, Role, Value) complex widgets
 * Focuses on advanced ARIA patterns: trees, grids, combo boxes, carousels, tabs
 * Essential for single-page applications and modern web components
 */
class AdvancedAriaScanner extends BaseScanner {
    constructor() {
        super('advanced-aria', {
            wcagCriteria: ['4.1.2', '1.3.1'],
            wcagPrinciple: 'robust'
        });
        this.screenshotDir = path.join(__dirname, '../tmp/advanced-aria-screenshots');
    }

    /**
     * Core scan method. Receives an already-navigated Puppeteer page.
     * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} ScanResult
     */
    async scan(page, options = {}) {
        const defaultOptions = {
            checkTreeViews: true,
            checkDataGrids: true,
            checkComboboxes: true,
            checkCarousels: true,
            checkTabPanels: true,
            checkAccordions: true,
            checkMenubars: true,
            checkDialogs: true,
            checkLiveRegions: true,
            validateKeyboardInteraction: true,
            checkAriaStates: true,
            timeout: 60000
        };

        const scanOptions = { ...defaultOptions, ...options };

        // Optionally trigger JS interactions to reveal hidden ARIA state
        if (scanOptions.jsInteraction) {
            await BaseScanner.triggerCommonInteractions(page);
        }

        const violations = [];

        // Analyze different widget types
        if (scanOptions.checkTreeViews) {
            const treeViolations = await this.analyzeTreeViews(page, scanOptions);
            violations.push(...treeViolations);
        }

        if (scanOptions.checkDataGrids) {
            const gridViolations = await this.analyzeDataGrids(page, scanOptions);
            violations.push(...gridViolations);
        }

        if (scanOptions.checkComboboxes) {
            const comboViolations = await this.analyzeComboboxes(page, scanOptions);
            violations.push(...comboViolations);
        }

        if (scanOptions.checkCarousels) {
            const carouselViolations = await this.analyzeCarousels(page, scanOptions);
            violations.push(...carouselViolations);
        }

        if (scanOptions.checkTabPanels) {
            const tabViolations = await this.analyzeTabPanels(page, scanOptions);
            violations.push(...tabViolations);
        }

        if (scanOptions.checkAccordions) {
            const accordionViolations = await this.analyzeAccordions(page, scanOptions);
            violations.push(...accordionViolations);
        }

        if (scanOptions.checkMenubars) {
            const menuViolations = await this.analyzeMenubars(page, scanOptions);
            violations.push(...menuViolations);
        }

        if (scanOptions.checkDialogs) {
            const dialogViolations = await this.analyzeDialogs(page, scanOptions);
            violations.push(...dialogViolations);
        }

        if (scanOptions.checkLiveRegions) {
            const liveRegionViolations = await this.analyzeLiveRegions(page, scanOptions);
            violations.push(...liveRegionViolations);
        }

        return {
            scannerId: this.id,
            criteria: ["4.1.2"],
            passed: violations.length === 0,
            violations: violations,
            summary: {
                totalWidgetsChecked: violations.length + this.getPassedWidgetsCount(violations),
                treeViewIssues: violations.filter(v => v.category === 'tree-view').length,
                dataGridIssues: violations.filter(v => v.category === 'data-grid').length,
                comboboxIssues: violations.filter(v => v.category === 'combobox').length,
                carouselIssues: violations.filter(v => v.category === 'carousel').length,
                tabPanelIssues: violations.filter(v => v.category === 'tab-panel').length,
                accordionIssues: violations.filter(v => v.category === 'accordion').length,
                menubarIssues: violations.filter(v => v.category === 'menubar').length,
                dialogIssues: violations.filter(v => v.category === 'dialog').length,
                liveRegionIssues: violations.filter(v => v.category === 'live-region').length,
                ariaStateErrors: violations.filter(v => v.type === 'aria-state-error').length,
                keyboardAccessibilityIssues: violations.filter(v => v.type === 'keyboard-inaccessible').length
            },
            recommendations: this.generateAdvancedAriaRecommendations(violations),
            widgetPatterns: this.generateWidgetPatternGuidance(violations)
        };
    }

    /**
     * @deprecated Use scan(page, options) via ScanPipeline instead
     * Scan advanced ARIA widget compliance (WCAG 4.1.2)
     * @param {string} url - URL to scan
     * @param {Object} options - Scanning options
     * @returns {Promise<Object>} AdvancedAriaReport
     */
    async scanAdvancedAria(url, options = {}) {
        const defaultOptions = {
            checkTreeViews: true,
            checkDataGrids: true,
            checkComboboxes: true,
            checkCarousels: true,
            checkTabPanels: true,
            checkAccordions: true,
            checkMenubars: true,
            checkDialogs: true,
            checkLiveRegions: true,
            validateKeyboardInteraction: true,
            checkAriaStates: true,
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
            const screenshotPath = path.join(scanDir, 'advanced-aria-analysis.png');
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
            throw new Error(`Advanced ARIA scan failed: ${error.message}`);
        }
    }

    /**
     * Analyze tree view widgets
     */
    async analyzeTreeViews(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find tree widgets (skip hidden)
            const trees = Array.from(document.querySelectorAll('[role="tree"]')).filter(isElementVisible);

            for (let i = 0; i < trees.length; i++) {
                const tree = trees[i];
                const treeSelector = getElementSelector(tree);

                // Check tree has proper labeling
                if (!tree.hasAttribute('aria-label') && !tree.hasAttribute('aria-labelledby')) {
                    violations.push({
                        type: 'missing-tree-label',
                        category: 'tree-view',
                        severity: 'serious',
                        element: treeSelector,
                        description: 'Tree widget lacks accessible name',
                        details: {
                            treeId: tree.id,
                            treeClass: tree.className,
                            hasAriaLabel: tree.hasAttribute('aria-label'),
                            hasAriaLabelledby: tree.hasAttribute('aria-labelledby')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen reader users cannot identify tree purpose',
                        recommendation: 'Add aria-label or aria-labelledby to tree container'
                    });
                }

                // Check tree items
                const treeItems = tree.querySelectorAll('[role="treeitem"]');
                for (let j = 0; j < treeItems.length; j++) {
                    const item = treeItems[j];
                    const itemSelector = getElementSelector(item);

                    // Check if tree item is focusable
                    const tabIndex = item.getAttribute('tabindex');
                    if (tabIndex === null) {
                        violations.push({
                            type: 'treeitem-not-focusable',
                            category: 'tree-view',
                            severity: 'serious',
                            element: itemSelector,
                            description: 'Tree item lacks tabindex for keyboard navigation',
                            details: {
                                itemText: item.textContent.trim(),
                                tabIndex: tabIndex,
                                hasTabindex: item.hasAttribute('tabindex')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Tree item not keyboard accessible',
                            recommendation: 'Add tabindex="-1" to tree items (except currently selected)'
                        });
                    }

                    // Check expandable items have aria-expanded
                    const hasChildren = item.querySelectorAll('[role="treeitem"]').length > 0 ||
                                      item.querySelector('[role="group"]');
                    if (hasChildren && !item.hasAttribute('aria-expanded')) {
                        violations.push({
                            type: 'missing-aria-expanded',
                            category: 'tree-view',
                            severity: 'serious',
                            element: itemSelector,
                            description: 'Expandable tree item lacks aria-expanded attribute',
                            details: {
                                itemText: item.textContent.trim(),
                                hasChildren: hasChildren,
                                hasAriaExpanded: item.hasAttribute('aria-expanded'),
                                currentExpanded: item.getAttribute('aria-expanded')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot determine if item is expanded',
                            recommendation: 'Add aria-expanded="true" or "false" to expandable items'
                        });
                    }

                    // Check selected state
                    if (item.hasAttribute('aria-selected') &&
                        !['true', 'false'].includes(item.getAttribute('aria-selected'))) {
                        violations.push({
                            type: 'invalid-aria-selected',
                            category: 'tree-view',
                            severity: 'moderate',
                            element: itemSelector,
                            description: 'Tree item has invalid aria-selected value',
                            details: {
                                itemText: item.textContent.trim(),
                                ariaSelected: item.getAttribute('aria-selected')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers receive invalid state information',
                            recommendation: 'Use aria-selected="true" or "false" only'
                        });
                    }
                }

                // Check for proper group structure
                const groups = tree.querySelectorAll('[role="group"]');
                groups.forEach((group, k) => {
                    if (!group.getAttribute('aria-labelledby')) {
                        violations.push({
                            type: 'tree-group-unlabeled',
                            category: 'tree-view',
                            severity: 'moderate',
                            element: getElementSelector(group),
                            description: 'Tree group lacks aria-labelledby reference',
                            details: {
                                groupIndex: k,
                                hasAriaLabelledby: group.hasAttribute('aria-labelledby')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot identify group relationship',
                            recommendation: 'Add aria-labelledby pointing to parent tree item'
                        });
                    }
                });
            }

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze data grid widgets
     */
    async analyzeDataGrids(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find grid widgets (skip hidden)
            const grids = Array.from(document.querySelectorAll('[role="grid"]')).filter(isElementVisible);

            for (let i = 0; i < grids.length; i++) {
                const grid = grids[i];
                const gridSelector = getElementSelector(grid);

                // Check grid has proper labeling
                if (!grid.hasAttribute('aria-label') && !grid.hasAttribute('aria-labelledby')) {
                    violations.push({
                        type: 'missing-grid-label',
                        category: 'data-grid',
                        severity: 'serious',
                        element: gridSelector,
                        description: 'Data grid lacks accessible name',
                        details: {
                            gridId: grid.id,
                            gridClass: grid.className
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen reader users cannot identify grid purpose',
                        recommendation: 'Add aria-label or aria-labelledby to grid container'
                    });
                }

                // Check for row headers
                const rows = grid.querySelectorAll('[role="row"]');
                for (let j = 0; j < rows.length; j++) {
                    const row = rows[j];
                    const rowHeaders = row.querySelectorAll('[role="rowheader"]');
                    const gridCells = row.querySelectorAll('[role="gridcell"]');

                    if (gridCells.length > 0 && rowHeaders.length === 0 && j > 0) { // Skip header row
                        violations.push({
                            type: 'missing-row-headers',
                            category: 'data-grid',
                            severity: 'moderate',
                            element: getElementSelector(row),
                            description: 'Data grid row lacks row header cells',
                            details: {
                                rowIndex: j,
                                cellCount: gridCells.length,
                                rowHeaderCount: rowHeaders.length
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot identify row context',
                            recommendation: 'Use role="rowheader" for first cell in data rows'
                        });
                    }
                }

                // Check for column headers
                const columnHeaders = grid.querySelectorAll('[role="columnheader"]');
                const firstRow = grid.querySelector('[role="row"]');
                if (firstRow && columnHeaders.length === 0) {
                    violations.push({
                        type: 'missing-column-headers',
                        category: 'data-grid',
                        severity: 'serious',
                        element: gridSelector,
                        description: 'Data grid lacks column headers',
                        details: {
                            hasFirstRow: !!firstRow,
                            columnHeaderCount: columnHeaders.length
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify column purposes',
                        recommendation: 'Use role="columnheader" in first row for column headers'
                    });
                }

                // Check grid cells for proper structure
                const gridCells = grid.querySelectorAll('[role="gridcell"]');
                gridCells.forEach((cell, k) => {
                    // Check if interactive cells are focusable
                    const hasInteractiveContent = cell.querySelector('button, input, select, textarea, [tabindex]');
                    if (hasInteractiveContent && !cell.hasAttribute('tabindex')) {
                        violations.push({
                            type: 'gridcell-not-focusable',
                            category: 'data-grid',
                            severity: 'serious',
                            element: getElementSelector(cell),
                            description: 'Interactive grid cell lacks tabindex',
                            details: {
                                cellIndex: k,
                                cellText: cell.textContent.trim().substring(0, 50),
                                hasInteractiveContent: hasInteractiveContent,
                                hasTabindex: cell.hasAttribute('tabindex')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Grid cell not keyboard accessible',
                            recommendation: 'Add tabindex="-1" to grid cells with interactive content'
                        });
                    }
                });
            }

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze combobox widgets
     */
    async analyzeComboboxes(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find combobox widgets
            const comboboxes = Array.from(document.querySelectorAll('[role="combobox"]')).filter(isElementVisible);

            for (let i = 0; i < comboboxes.length; i++) {
                const combobox = comboboxes[i];
                const comboboxSelector = getElementSelector(combobox);

                // Check combobox has aria-expanded
                if (!combobox.hasAttribute('aria-expanded')) {
                    violations.push({
                        type: 'missing-aria-expanded',
                        category: 'combobox',
                        severity: 'serious',
                        element: comboboxSelector,
                        description: 'Combobox lacks aria-expanded attribute',
                        details: {
                            comboboxId: combobox.id,
                            hasAriaExpanded: combobox.hasAttribute('aria-expanded')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot determine if combobox is expanded',
                        recommendation: 'Add aria-expanded="true" or "false" to combobox'
                    });
                }

                // Check combobox has aria-controls
                if (!combobox.hasAttribute('aria-controls')) {
                    violations.push({
                        type: 'missing-aria-controls',
                        category: 'combobox',
                        severity: 'serious',
                        element: comboboxSelector,
                        description: 'Combobox lacks aria-controls reference to listbox',
                        details: {
                            comboboxId: combobox.id,
                            hasAriaControls: combobox.hasAttribute('aria-controls')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify associated popup',
                        recommendation: 'Add aria-controls pointing to listbox/popup ID'
                    });
                }

                // Check for associated listbox
                const controlsId = combobox.getAttribute('aria-controls');
                if (controlsId) {
                    const listbox = document.getElementById(controlsId);
                    if (!listbox) {
                        violations.push({
                            type: 'missing-controlled-listbox',
                            category: 'combobox',
                            severity: 'serious',
                            element: comboboxSelector,
                            description: 'Combobox aria-controls references non-existent listbox',
                            details: {
                                controlsId: controlsId,
                                listboxExists: !!listbox
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot find associated popup',
                            recommendation: 'Ensure aria-controls ID matches existing listbox element'
                        });
                    } else if (!listbox.hasAttribute('role') || listbox.getAttribute('role') !== 'listbox') {
                        violations.push({
                            type: 'invalid-controlled-element',
                            category: 'combobox',
                            severity: 'serious',
                            element: getElementSelector(listbox),
                            description: 'Combobox controls element that is not a listbox',
                            details: {
                                controlsId: controlsId,
                                controlledRole: listbox.getAttribute('role')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers receive incorrect semantic information',
                            recommendation: 'Add role="listbox" to controlled popup element'
                        });
                    }
                }

                // Check autocomplete behavior
                if (combobox.hasAttribute('aria-autocomplete')) {
                    const autoValue = combobox.getAttribute('aria-autocomplete');
                    if (!['none', 'list', 'inline', 'both'].includes(autoValue)) {
                        violations.push({
                            type: 'invalid-aria-autocomplete',
                            category: 'combobox',
                            severity: 'moderate',
                            element: comboboxSelector,
                            description: 'Combobox has invalid aria-autocomplete value',
                            details: {
                                autocompleteValue: autoValue
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers receive invalid autocomplete information',
                            recommendation: 'Use valid aria-autocomplete values: none, list, inline, both'
                        });
                    }
                }
            }

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze carousel widgets
     */
    async analyzeCarousels(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // ── Candidate net ────────────────────────────────────────────
            // A className substring is NOT evidence of a carousel. The old net
            // alone flagged 8 elements belonging to ONE carousel in
            // good-motion-vestibular.html: the container, its
            // `.good-carousel-track`, all five `.good-carousel-slide` children
            // and the `.carousel-controls` bar — seven of which are structural
            // parts, not carousels. Widen the net (aria-roledescription is the
            // APG marker) but treat every hit as a candidate that must prove
            // itself below.
            const candidates = Array.from(document.querySelectorAll(
                '[aria-roledescription], [role="region"][aria-label*="carousel"], ' +
                '[role="region"][aria-label*="slider"], ' +
                '.carousel, .slider, .swiper, [class*="carousel"], [class*="slider"], [class*="swiper"]'
            )).filter(isElementVisible)
              // `[class*="slider"]` also matches range/volume sliders. Those
              // are a different widget with a different naming contract.
              .filter(el => el.getAttribute('role') !== 'slider' &&
                            !(el.tagName === 'INPUT' && el.getAttribute('type') === 'range'));

            const classTokens = (el) => (typeof el.className === 'string' ? el.className : '')
                .split(/\s+/).filter(Boolean);

            // "slide"/"item" as a whole word inside a hyphen/underscore class
            // name — `swiper-slide`, `carousel-item`, `good-carousel-slide`.
            // Deliberately does NOT match `slider`, `slider-handle`, `slideshow`.
            const SLIDE_TOKEN = /(^|[-_])(slides?|items?)([-_]|$)/i;

            // Evidence A — the author DECLARED a carousel (APG pattern).
            function hasDeclaredCarouselEvidence(el) {
                const rd = (el.getAttribute('aria-roledescription') || '').toLowerCase();
                if (/carousel|karussell|slideshow|diashow/.test(rd)) return true;
                const role = el.getAttribute('role');
                if (role === 'region' || role === 'group') {
                    const label = (el.getAttribute('aria-label') || '').toLowerCase();
                    if (/carousel|karussell|slider|slideshow/.test(label)) return true;
                }
                return false;
            }

            // Evidence B1 — slide children: ≥2 elements sharing one parent
            // (the track) that are marked as slides/items.
            function countSlides(el) {
                const marked = Array.from(el.querySelectorAll(
                    '[data-slide], [data-slide-index], [class*="slide"], [class*="item"]'
                )).filter(n => n !== el && (
                    n.hasAttribute('data-slide') || n.hasAttribute('data-slide-index') ||
                    classTokens(n).some(t => SLIDE_TOKEN.test(t))
                ));
                const byParent = new Map();
                for (const n of marked) {
                    if (!n.parentElement) continue;
                    byParent.set(n.parentElement, (byParent.get(n.parentElement) || 0) + 1);
                }
                let best = 0;
                for (const count of byParent.values()) best = Math.max(best, count);
                return best;
            }

            // Evidence B2 — something actually advances the slides: a prev/next
            // affordance (en/de/glyph), a strip of ≥2 slide indicators, or
            // declared/observable auto-rotation.
            const CONTROL_WORDS = /prev|previous|next|zur[üu]ck|weiter|vorheri|n[äa]chst|◀|▶|‹|›|←|→/i;
            function hasPrevNextControl(el) {
                const controls = Array.from(el.querySelectorAll(
                    'button, a, [role="button"], input[type="button"], input[type="submit"]'
                ));
                return controls.some(c => CONTROL_WORDS.test(
                    [c.getAttribute('aria-label') || '', c.id || '',
                     typeof c.className === 'string' ? c.className : '',
                     c.getAttribute('title') || '', c.textContent || ''].join(' ')
                ));
            }
            function hasSlideIndicators(el) {
                return el.querySelectorAll(
                    '.indicator, .dot, [class*="indicator"], [class*="dot"], [data-slide-to]'
                ).length >= 2;
            }
            function hasAutoRotation(el) {
                if (el.querySelector('[data-autoplay], [data-auto], [data-interval]')) return true;
                if (el.hasAttribute('data-interval') || el.hasAttribute('data-autoplay')) return true;
                if (classTokens(el).some(t => /auto/i.test(t))) return true;
                // A CSS animation running on the slides is concrete evidence of
                // an auto-rotating carousel (bad-motion-vestibular.html).
                const slides = Array.from(el.querySelectorAll('[class*="slide"]'))
                    .filter(n => classTokens(n).some(t => SLIDE_TOKEN.test(t)));
                return slides.some(n => {
                    const anim = getComputedStyle(n).animationName;
                    return anim && anim !== 'none';
                });
            }
            function hasCarouselControls(el) {
                return hasPrevNextControl(el) || hasSlideIndicators(el) || hasAutoRotation(el);
            }

            const confirmed = candidates.filter(el =>
                hasDeclaredCarouselEvidence(el) ||
                (countSlides(el) >= 2 && hasCarouselControls(el))
            );

            // Outermost wins: a track/viewport nested inside a confirmed
            // carousel is part of it, not a second carousel.
            const carousels = confirmed.filter(el =>
                !confirmed.some(other => other !== el && other.contains(el))
            );

            // Accessible-name resolution. The old check only looked at
            // aria-label / aria-labelledby ON the element, so a carousel named
            // by a wrapping labelled region, by title, or by a heading
            // referenced through aria-labelledby was reported as nameless.
            function textOfIds(idref) {
                if (!idref) return '';
                return idref.split(/\s+/).filter(Boolean)
                    .map(id => { const t = document.getElementById(id); return t ? t.textContent.trim() : ''; })
                    .join(' ').trim();
            }
            function accessibleName(el) {
                const label = (el.getAttribute('aria-label') || '').trim();
                if (label) return label;
                const byIds = textOfIds(el.getAttribute('aria-labelledby'));
                if (byIds) return byIds;
                const title = (el.getAttribute('title') || '').trim();
                if (title) return title;
                const fig = el.closest('figure');
                if (fig) {
                    const cap = fig.querySelector('figcaption');
                    if (cap && cap.textContent.trim()) return cap.textContent.trim();
                }
                // A wrapping section/region/group that itself carries a name
                // makes the carousel identifiable in the region tree.
                let wrapper = el.parentElement
                    ? el.parentElement.closest('section, aside, [role="region"], [role="group"]')
                    : null;
                while (wrapper) {
                    const wl = (wrapper.getAttribute('aria-label') || '').trim() ||
                               textOfIds(wrapper.getAttribute('aria-labelledby'));
                    if (wl) return wl;
                    wrapper = wrapper.parentElement
                        ? wrapper.parentElement.closest('section, aside, [role="region"], [role="group"]')
                        : null;
                }
                return '';
            }

            for (let i = 0; i < carousels.length; i++) {
                const carousel = carousels[i];
                const carouselSelector = getElementSelector(carousel);

                // Check carousel has accessible name
                if (!accessibleName(carousel)) {
                    violations.push({
                        type: 'missing-carousel-label',
                        category: 'carousel',
                        severity: 'serious',
                        element: carouselSelector,
                        description: 'Carousel lacks accessible name',
                        details: {
                            carouselId: carousel.id,
                            carouselClass: carousel.className,
                            evidence: {
                                declared: hasDeclaredCarouselEvidence(carousel),
                                slideCount: countSlides(carousel),
                                hasControls: hasCarouselControls(carousel)
                            }
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen reader users cannot identify carousel purpose',
                        recommendation: 'Add aria-label describing carousel content'
                    });
                }

                // Check for live region for auto-rotating carousels.
                // `className` is an SVGAnimatedString on SVG/MathML elements —
                // guard before calling .includes() on it.
                const hasAutoRotate = !!carousel.querySelector('[data-autoplay], [data-auto]') ||
                                    classTokens(carousel).some(t => /auto/i.test(t)) ||
                                    carousel.hasAttribute('data-interval');

                if (hasAutoRotate && !carousel.hasAttribute('aria-live')) {
                    violations.push({
                        type: 'missing-carousel-live-region',
                        category: 'carousel',
                        severity: 'moderate',
                        element: carouselSelector,
                        description: 'Auto-rotating carousel lacks aria-live region',
                        details: {
                            hasAutoRotate: hasAutoRotate,
                            hasAriaLive: carousel.hasAttribute('aria-live')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers not notified of automatic slide changes',
                        recommendation: 'Add aria-live="polite" for auto-rotating carousels'
                    });
                }

                // Check carousel controls
                const prevButton = carousel.querySelector('[aria-label*="previous"], [aria-label*="prev"], .prev, .previous');
                const nextButton = carousel.querySelector('[aria-label*="next"], .next');

                if (prevButton && !prevButton.hasAttribute('aria-label')) {
                    violations.push({
                        type: 'carousel-control-unlabeled',
                        category: 'carousel',
                        severity: 'serious',
                        element: getElementSelector(prevButton),
                        description: 'Carousel previous button lacks accessible name',
                        details: {
                            buttonText: prevButton.textContent.trim(),
                            hasAriaLabel: prevButton.hasAttribute('aria-label')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify button purpose',
                        recommendation: 'Add aria-label="Previous slide" to previous button'
                    });
                }

                if (nextButton && !nextButton.hasAttribute('aria-label')) {
                    violations.push({
                        type: 'carousel-control-unlabeled',
                        category: 'carousel',
                        severity: 'serious',
                        element: getElementSelector(nextButton),
                        description: 'Carousel next button lacks accessible name',
                        details: {
                            buttonText: nextButton.textContent.trim(),
                            hasAriaLabel: nextButton.hasAttribute('aria-label')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify button purpose',
                        recommendation: 'Add aria-label="Next slide" to next button'
                    });
                }

                // Check slide indicators
                const indicators = carousel.querySelectorAll('.indicator, .dot, [role="button"][aria-label*="slide"]');
                indicators.forEach((indicator, k) => {
                    if (!indicator.hasAttribute('aria-label') &&
                        (!indicator.textContent || indicator.textContent.trim().length === 0)) {
                        violations.push({
                            type: 'carousel-indicator-unlabeled',
                            category: 'carousel',
                            severity: 'moderate',
                            element: getElementSelector(indicator),
                            description: 'Carousel slide indicator lacks accessible name',
                            details: {
                                indicatorIndex: k,
                                hasAriaLabel: indicator.hasAttribute('aria-label'),
                                textContent: indicator.textContent.trim()
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot identify slide indicators',
                            recommendation: `Add aria-label="Go to slide ${k + 1}" to indicator`
                        });
                    }
                });
            }

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze tab panel widgets
     */
    async analyzeTabPanels(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find tab lists (skip hidden)
            const tabLists = Array.from(document.querySelectorAll('[role="tablist"]')).filter(isElementVisible);

            for (let i = 0; i < tabLists.length; i++) {
                const tabList = tabLists[i];
                const tabListSelector = getElementSelector(tabList);

                // Check tabs within tablist
                const tabs = tabList.querySelectorAll('[role="tab"]');

                if (tabs.length === 0) {
                    violations.push({
                        type: 'tablist-without-tabs',
                        category: 'tab-panel',
                        severity: 'serious',
                        element: tabListSelector,
                        description: 'Tablist contains no tab elements',
                        details: {
                            tabCount: tabs.length
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot navigate tab interface',
                        recommendation: 'Add role="tab" to tab elements within tablist'
                    });
                }

                tabs.forEach((tab, j) => {
                    const tabSelector = getElementSelector(tab);

                    // Check tab has aria-controls
                    if (!tab.hasAttribute('aria-controls')) {
                        violations.push({
                            type: 'tab-missing-controls',
                            category: 'tab-panel',
                            severity: 'serious',
                            element: tabSelector,
                            description: 'Tab lacks aria-controls reference to tabpanel',
                            details: {
                                tabIndex: j,
                                tabText: tab.textContent.trim(),
                                hasAriaControls: tab.hasAttribute('aria-controls')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot identify associated panel',
                            recommendation: 'Add aria-controls pointing to tabpanel ID'
                        });
                    }

                    // Check tab has aria-selected
                    if (!tab.hasAttribute('aria-selected')) {
                        violations.push({
                            type: 'tab-missing-selected',
                            category: 'tab-panel',
                            severity: 'serious',
                            element: tabSelector,
                            description: 'Tab lacks aria-selected attribute',
                            details: {
                                tabIndex: j,
                                tabText: tab.textContent.trim(),
                                hasAriaSelected: tab.hasAttribute('aria-selected')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot determine selected tab',
                            recommendation: 'Add aria-selected="true" to active tab, "false" to others'
                        });
                    }

                    // Check associated tabpanel exists
                    const controlsId = tab.getAttribute('aria-controls');
                    if (controlsId) {
                        const tabPanel = document.getElementById(controlsId);
                        if (!tabPanel) {
                            violations.push({
                                type: 'missing-tabpanel',
                                category: 'tab-panel',
                                severity: 'serious',
                                element: tabSelector,
                                description: 'Tab aria-controls references non-existent tabpanel',
                                details: {
                                    controlsId: controlsId,
                                    tabpanelExists: !!tabPanel
                                },
                                wcagCriteria: '4.1.2',
                                impact: 'Screen readers cannot find associated content',
                                recommendation: 'Ensure aria-controls ID matches existing tabpanel'
                            });
                        } else if (tabPanel.getAttribute('role') !== 'tabpanel') {
                            violations.push({
                                type: 'invalid-tabpanel-role',
                                category: 'tab-panel',
                                severity: 'serious',
                                element: getElementSelector(tabPanel),
                                description: 'Tab controls element that is not a tabpanel',
                                details: {
                                    controlsId: controlsId,
                                    elementRole: tabPanel.getAttribute('role')
                                },
                                wcagCriteria: '4.1.2',
                                impact: 'Screen readers receive incorrect semantic information',
                                recommendation: 'Add role="tabpanel" to controlled element'
                            });
                        }
                    }
                });

                // Check only one tab is selected
                const selectedTabs = tabList.querySelectorAll('[role="tab"][aria-selected="true"]');
                if (selectedTabs.length === 0) {
                    violations.push({
                        type: 'no-selected-tab',
                        category: 'tab-panel',
                        severity: 'serious',
                        element: tabListSelector,
                        description: 'Tablist has no selected tab',
                        details: {
                            selectedTabCount: selectedTabs.length,
                            totalTabs: tabs.length
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify active tab',
                        recommendation: 'Set one tab to aria-selected="true"'
                    });
                } else if (selectedTabs.length > 1) {
                    violations.push({
                        type: 'multiple-selected-tabs',
                        category: 'tab-panel',
                        severity: 'serious',
                        element: tabListSelector,
                        description: 'Tablist has multiple selected tabs',
                        details: {
                            selectedTabCount: selectedTabs.length,
                            totalTabs: tabs.length
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers receive conflicting state information',
                        recommendation: 'Only one tab should have aria-selected="true"'
                    });
                }
            }

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze accordion widgets
     */
    async analyzeAccordions(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find accordion headers and buttons (skip hidden)
            const accordionButtons = Array.from(document.querySelectorAll(
                '[aria-expanded], .accordion-header button, .accordion-toggle, ' +
                '[class*="accordion"] button, [role="button"][aria-controls]'
            )).filter(isElementVisible);

            accordionButtons.forEach((button, i) => {
                const buttonSelector = getElementSelector(button);

                // Check button has aria-expanded
                if (!button.hasAttribute('aria-expanded')) {
                    violations.push({
                        type: 'accordion-missing-expanded',
                        category: 'accordion',
                        severity: 'serious',
                        element: buttonSelector,
                        description: 'Accordion button lacks aria-expanded attribute',
                        details: {
                            buttonIndex: i,
                            buttonText: button.textContent.trim(),
                            hasAriaExpanded: button.hasAttribute('aria-expanded')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot determine if accordion panel is expanded',
                        recommendation: 'Add aria-expanded="true" or "false" to accordion buttons'
                    });
                }

                // Check button has aria-controls
                if (!button.hasAttribute('aria-controls')) {
                    violations.push({
                        type: 'accordion-missing-controls',
                        category: 'accordion',
                        severity: 'serious',
                        element: buttonSelector,
                        description: 'Accordion button lacks aria-controls reference',
                        details: {
                            buttonIndex: i,
                            buttonText: button.textContent.trim(),
                            hasAriaControls: button.hasAttribute('aria-controls')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify controlled panel',
                        recommendation: 'Add aria-controls pointing to accordion panel ID'
                    });
                }

                // Check controlled panel exists and is properly marked
                const controlsId = button.getAttribute('aria-controls');
                if (controlsId) {
                    const panel = document.getElementById(controlsId);
                    if (!panel) {
                        violations.push({
                            type: 'missing-accordion-panel',
                            category: 'accordion',
                            severity: 'serious',
                            element: buttonSelector,
                            description: 'Accordion button controls non-existent panel',
                            details: {
                                controlsId: controlsId,
                                panelExists: !!panel
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot find associated content',
                            recommendation: 'Ensure aria-controls ID matches existing panel element'
                        });
                    } else {
                        // Check panel has proper labeling
                        if (!panel.hasAttribute('aria-labelledby')) {
                            violations.push({
                                type: 'accordion-panel-unlabeled',
                                category: 'accordion',
                                severity: 'moderate',
                                element: getElementSelector(panel),
                                description: 'Accordion panel lacks aria-labelledby reference',
                                details: {
                                    panelId: panel.id,
                                    hasAriaLabelledby: panel.hasAttribute('aria-labelledby')
                                },
                                wcagCriteria: '4.1.2',
                                impact: 'Screen readers cannot identify panel heading',
                                recommendation: 'Add aria-labelledby pointing to accordion button ID'
                            });
                        }
                    }
                }
            });

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze menubar widgets
     */
    async analyzeMenubars(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find menubar widgets (skip hidden)
            const menubars = Array.from(document.querySelectorAll('[role="menubar"]')).filter(isElementVisible);

            menubars.forEach((menubar, i) => {
                const menubarSelector = getElementSelector(menubar);

                // Check menubar has proper labeling
                if (!menubar.hasAttribute('aria-label') && !menubar.hasAttribute('aria-labelledby')) {
                    violations.push({
                        type: 'menubar-unlabeled',
                        category: 'menubar',
                        severity: 'moderate',
                        element: menubarSelector,
                        description: 'Menubar lacks accessible name',
                        details: {
                            menubarIndex: i,
                            hasAriaLabel: menubar.hasAttribute('aria-label'),
                            hasAriaLabelledby: menubar.hasAttribute('aria-labelledby')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify menubar purpose',
                        recommendation: 'Add aria-label describing menubar purpose'
                    });
                }

                // Check menu items
                const menuItems = menubar.querySelectorAll('[role="menuitem"]');
                menuItems.forEach((item, j) => {
                    const itemSelector = getElementSelector(item);

                    // Check if item has submenu
                    const hasSubMenu = item.hasAttribute('aria-haspopup') ||
                                     item.getAttribute('aria-expanded') !== null;

                    if (hasSubMenu && !item.hasAttribute('aria-expanded')) {
                        violations.push({
                            type: 'submenu-missing-expanded',
                            category: 'menubar',
                            severity: 'serious',
                            element: itemSelector,
                            description: 'Menu item with submenu lacks aria-expanded',
                            details: {
                                itemIndex: j,
                                itemText: item.textContent.trim(),
                                hasAriaHaspopup: item.hasAttribute('aria-haspopup'),
                                hasAriaExpanded: item.hasAttribute('aria-expanded')
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot determine submenu state',
                            recommendation: 'Add aria-expanded="true" or "false" to items with submenus'
                        });
                    }
                });
            });

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze dialog widgets
     */
    async analyzeDialogs(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find dialog widgets (skip hidden)
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog')).filter(isElementVisible);

            dialogs.forEach((dialog, i) => {
                const dialogSelector = getElementSelector(dialog);

                // Check dialog has accessible name
                if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
                    violations.push({
                        type: 'dialog-unlabeled',
                        category: 'dialog',
                        severity: 'serious',
                        element: dialogSelector,
                        description: 'Dialog lacks accessible name',
                        details: {
                            dialogIndex: i,
                            role: dialog.getAttribute('role') || dialog.tagName.toLowerCase(),
                            hasAriaLabel: dialog.hasAttribute('aria-label'),
                            hasAriaLabelledby: dialog.hasAttribute('aria-labelledby')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers cannot identify dialog purpose',
                        recommendation: 'Add aria-labelledby pointing to dialog title or aria-label'
                    });
                }

                // Check dialog is modal (has aria-modal or proper focus management)
                if (!dialog.hasAttribute('aria-modal')) {
                    violations.push({
                        type: 'dialog-missing-modal',
                        category: 'dialog',
                        severity: 'moderate',
                        element: dialogSelector,
                        description: 'Dialog lacks aria-modal attribute',
                        details: {
                            dialogIndex: i,
                            hasAriaModal: dialog.hasAttribute('aria-modal'),
                            ariaModal: dialog.getAttribute('aria-modal')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers may not understand modal behavior',
                        recommendation: 'Add aria-modal="true" for modal dialogs'
                    });
                }

                // Check for description if present
                const describedBy = dialog.getAttribute('aria-describedby');
                if (describedBy) {
                    const descElement = document.getElementById(describedBy);
                    if (!descElement) {
                        violations.push({
                            type: 'dialog-invalid-describedby',
                            category: 'dialog',
                            severity: 'moderate',
                            element: dialogSelector,
                            description: 'Dialog aria-describedby references non-existent element',
                            details: {
                                describedById: describedBy,
                                descElementExists: !!descElement
                            },
                            wcagCriteria: '4.1.2',
                            impact: 'Screen readers cannot find dialog description',
                            recommendation: 'Ensure aria-describedby ID matches existing element'
                        });
                    }
                }
            });

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Analyze live region implementation
     */
    async analyzeLiveRegions(page, options) {
        return await page.evaluate((visScript) => {
            eval(visScript);
            const violations = [];

            function getElementSelector(element) {
                const tagName = element.tagName.toLowerCase();
                const id = element.id ? `#${element.id}` : '';
                const className = element.className && typeof element.className === 'string'
                    ? `.${element.className.split(' ')[0]}`
                    : '';
                return `${tagName}${id}${className}`;
            }

            // Find live regions (skip hidden)
            const liveRegions = Array.from(document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')).filter(isElementVisible);

            liveRegions.forEach((region, i) => {
                const regionSelector = getElementSelector(region);

                // Check for proper aria-live values
                const ariaLive = region.getAttribute('aria-live');
                if (ariaLive && !['polite', 'assertive', 'off'].includes(ariaLive)) {
                    violations.push({
                        type: 'invalid-aria-live-value',
                        category: 'live-region',
                        severity: 'moderate',
                        element: regionSelector,
                        description: 'Live region has invalid aria-live value',
                        details: {
                            regionIndex: i,
                            ariaLive: ariaLive,
                            role: region.getAttribute('role')
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Screen readers receive invalid live region information',
                        recommendation: 'Use valid aria-live values: polite, assertive, off'
                    });
                }

                const role = region.getAttribute('role');

                // An INITIALLY EMPTY live region is not a violation — it is the correct
                // implementation of SC 4.1.3. The announcing container must already be in
                // the accessibility tree before the content arrives, otherwise assistive
                // technology has nothing to observe and the update is never announced.
                // Framework-generated, textbook-correct markup such as Next.js's route
                // announcer (<p id="__next-route-announcer__" role="alert"
                // aria-live="assertive"> rendered empty at load) was being flagged here.
                // The old 'empty-live-region' finding is therefore dropped entirely; only
                // the genuinely-broken cases below survive.

                // Contradictory politeness: role="alert"/"status"/"log" carry an implicit
                // politeness setting, and an explicit aria-live="off" overrides it — the
                // author asks for an announcement and suppresses it in the same element.
                if (ariaLive === 'off' && (role === 'alert' || role === 'status' || role === 'log')) {
                    violations.push({
                        type: 'contradictory-live-region-politeness',
                        category: 'live-region',
                        severity: 'moderate',
                        element: regionSelector,
                        description: `Element has role="${role}" but aria-live="off", which suppresses the announcement the role asks for`,
                        details: {
                            regionIndex: i,
                            role: role,
                            ariaLive: ariaLive
                        },
                        wcagCriteria: '4.1.2',
                        impact: 'Updates to this region are never announced despite the live-region role',
                        recommendation: 'Remove aria-live="off", or drop the role if the region should stay silent'
                    });
                }
            });

            // A display:none / visibility:hidden live region was considered as the other
            // "genuinely broken" case, but it does not survive contact with real markup:
            // `<p role="alert" hidden>` for an error message that is unhidden and filled
            // together, and error containers toggled with display:none, are the standard
            // working implementation of SC 4.1.3 — revealing and populating the region in
            // the same task announces correctly. Measured against the test corpus that
            // check produced 8 findings, all of them on good-* fixtures and all of them
            // false positives, so it is deliberately not implemented. (Such regions are
            // dropped by the isElementVisible() filter above anyway.)

            return violations;
        }, BaseScanner.visibilityFilterScript);
    }

    /**
     * Get count of passed widgets (estimated)
     */
    getPassedWidgetsCount(violations) {
        return Math.max(15 - violations.length, 0);
    }

    /**
     * Generate recommendations for advanced ARIA issues
     */
    generateAdvancedAriaRecommendations(violations) {
        const recommendations = [];
        const issueTypes = [...new Set(violations.map(v => v.type))];

        if (issueTypes.some(type => type.includes('missing') && type.includes('label'))) {
            recommendations.push({
                priority: 'critical',
                issue: 'Complex widgets missing accessible names',
                solution: 'Add proper aria-label or aria-labelledby to all widgets',
                implementation: 'Use descriptive labels that explain widget purpose and current state'
            });
        }

        if (issueTypes.some(type => type.includes('aria-expanded'))) {
            recommendations.push({
                priority: 'critical',
                issue: 'Expandable widgets missing state information',
                solution: 'Implement aria-expanded on all collapsible/expandable elements',
                implementation: 'Set aria-expanded="true" when expanded, "false" when collapsed'
            });
        }

        if (issueTypes.some(type => type.includes('aria-controls'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Widget relationships not properly defined',
                solution: 'Use aria-controls to link widgets to controlled content',
                implementation: 'Ensure aria-controls IDs match existing controlled elements'
            });
        }

        if (issueTypes.some(type => type.includes('tabindex') || type.includes('focusable'))) {
            recommendations.push({
                priority: 'high',
                issue: 'Complex widgets not keyboard accessible',
                solution: 'Implement proper focus management for all interactive widgets',
                implementation: 'Use tabindex="-1" for widget parts, manage focus programmatically'
            });
        }

        if (issueTypes.some(type => type.includes('live-region'))) {
            recommendations.push({
                priority: 'medium',
                issue: 'Dynamic content changes not announced',
                solution: 'Implement proper ARIA live regions for status updates',
                implementation: 'Use aria-live="polite" for updates, "assertive" for urgent alerts'
            });
        }

        return recommendations;
    }

    /**
     * Generate widget pattern guidance
     */
    generateWidgetPatternGuidance(violations) {
        const patterns = {};
        const categories = [...new Set(violations.map(v => v.category))];

        categories.forEach(category => {
            const categoryViolations = violations.filter(v => v.category === category);

            patterns[category] = {
                issuesFound: categoryViolations.length,
                commonProblems: [...new Set(categoryViolations.map(v => v.type))],
                implementationGuide: this.getPatternGuide(category),
                ariaPatternReference: this.getAriaPatternReference(category)
            };
        });

        return patterns;
    }

    /**
     * Get implementation guide for widget pattern
     */
    getPatternGuide(category) {
        const guides = {
            'tree-view': {
                requiredRoles: ['tree', 'treeitem', 'group'],
                requiredAttributes: ['aria-expanded', 'tabindex', 'aria-selected'],
                keyboardSupport: ['Arrow keys for navigation', 'Enter/Space to activate', 'Home/End for first/last'],
                focusManagement: 'Only one treeitem should be tabbable at a time'
            },
            'data-grid': {
                requiredRoles: ['grid', 'row', 'columnheader', 'rowheader', 'gridcell'],
                requiredAttributes: ['aria-rowcount', 'aria-colcount', 'aria-rowindex', 'aria-colindex'],
                keyboardSupport: ['Arrow keys for cell navigation', 'Tab to move between grids', 'Home/End/Page keys'],
                focusManagement: 'Focus should move to grid cells, not the grid container'
            },
            'combobox': {
                requiredRoles: ['combobox', 'listbox', 'option'],
                requiredAttributes: ['aria-expanded', 'aria-controls', 'aria-activedescendant'],
                keyboardSupport: ['Arrow keys to navigate options', 'Enter to select', 'Escape to close'],
                focusManagement: 'Focus remains on combobox, use aria-activedescendant for option focus'
            },
            'carousel': {
                requiredRoles: ['region', 'button', 'tab', 'tabpanel'],
                requiredAttributes: ['aria-label', 'aria-live', 'aria-controls'],
                keyboardSupport: ['Arrow keys or Tab to navigate slides', 'Enter/Space to activate controls'],
                focusManagement: 'Provide keyboard access to all slides and controls'
            },
            'tab-panel': {
                requiredRoles: ['tablist', 'tab', 'tabpanel'],
                requiredAttributes: ['aria-selected', 'aria-controls', 'aria-labelledby'],
                keyboardSupport: ['Arrow keys to navigate tabs', 'Enter/Space to activate', 'Tab to move to panel'],
                focusManagement: 'Only active tab should be tabbable'
            },
            'accordion': {
                requiredRoles: ['button', 'region'],
                requiredAttributes: ['aria-expanded', 'aria-controls', 'aria-labelledby'],
                keyboardSupport: ['Tab to navigate headers', 'Enter/Space to toggle', 'Arrow keys optional'],
                focusManagement: 'Focus moves to accordion headers, not panels'
            },
            'menubar': {
                requiredRoles: ['menubar', 'menuitem', 'menu'],
                requiredAttributes: ['aria-haspopup', 'aria-expanded'],
                keyboardSupport: ['Arrow keys for navigation', 'Enter to activate', 'Escape to close submenus'],
                focusManagement: 'Focus stays in menubar until menu is closed'
            },
            'dialog': {
                requiredRoles: ['dialog', 'alertdialog'],
                requiredAttributes: ['aria-modal', 'aria-labelledby', 'aria-describedby'],
                keyboardSupport: ['Tab cycles within dialog', 'Escape to close'],
                focusManagement: 'Focus moves to dialog on open, returns to trigger on close'
            }
        };

        return guides[category] || {
            requiredRoles: ['Check ARIA Authoring Practices Guide'],
            requiredAttributes: ['Depends on specific widget pattern'],
            keyboardSupport: ['Follow standard widget keyboard conventions'],
            focusManagement: 'Implement appropriate focus management for pattern'
        };
    }

    /**
     * Get ARIA pattern reference URL
     */
    getAriaPatternReference(category) {
        const references = {
            'tree-view': 'https://www.w3.org/WAI/ARIA/apg/patterns/treeview/',
            'data-grid': 'https://www.w3.org/WAI/ARIA/apg/patterns/grid/',
            'combobox': 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/',
            'carousel': 'https://www.w3.org/WAI/ARIA/apg/patterns/carousel/',
            'tab-panel': 'https://www.w3.org/WAI/ARIA/apg/patterns/tabs/',
            'accordion': 'https://www.w3.org/WAI/ARIA/apg/patterns/accordion/',
            'menubar': 'https://www.w3.org/WAI/ARIA/apg/patterns/menubar/',
            'dialog': 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/'
        };

        return references[category] || 'https://www.w3.org/WAI/ARIA/apg/patterns/';
    }

}

module.exports = AdvancedAriaScanner;
