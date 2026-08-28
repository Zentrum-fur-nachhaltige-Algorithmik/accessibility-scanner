/**
 * Advanced ARIA Complex Widgets Scanner.
 * WCAG 4.1.2, 2.1.1 (EN 301 549 9.4.1.2, 9.2.1.1).
 * Reports the composite-widget defects no axe-core rule covers: a widget whose
 * name can only come from the author and has none, a tree that no keyboard can
 * enter, a tablist with no or several selected tabs, a combobox that opens a
 * popup it does not identify, and a live region whose role and aria-live
 * contradict each other. Attribute validity (`aria-valid-attr-value`),
 * required attributes (`aria-required-attr`), required children
 * (`aria-required-children`) and dialog naming (`aria-dialog-name`) are
 * axe-core rules running in the same profile and are not restated here.
 */
const BaseScanner = require('../core/base-scanner');
const { TIMEOUTS } = require('../core/constants');
const { injectableCode: accnameCode } = require('../utils/accessible-name');
const { injectableCode: renderedCode } = require('../utils/rendered');

class AdvancedAriaScanner extends BaseScanner {
  constructor() {
    super('advanced-aria', {
      wcagCriteria: ['4.1.2'],
      wcagPrinciple: 'robust',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated Puppeteer page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const defaultOptions = {
      checkCompositeWidgets: true,
      checkCarousels: true,
      checkLiveRegions: true,
      timeout: TIMEOUTS.scanner,
    };

    const scanOptions = { ...defaultOptions, ...options };

    if (scanOptions.jsInteraction) {
      await BaseScanner.triggerCommonInteractions(page);
    }

    const violations = [];

    if (scanOptions.checkCompositeWidgets) {
      violations.push(...(await this.analyzeCompositeWidgets(page)));
    }

    if (scanOptions.checkCarousels) {
      violations.push(...(await this.analyzeCarousels(page)));
    }

    if (scanOptions.checkLiveRegions) {
      violations.push(...(await this.analyzeLiveRegions(page)));
    }

    return {
      scannerId: this.id,
      criteria: ['4.1.2'],
      passed: violations.length === 0,
      violations: violations,
      summary: {
        treeViewIssues: violations.filter((v) => v.category === 'tree-view').length,
        dataGridIssues: violations.filter((v) => v.category === 'data-grid').length,
        comboboxIssues: violations.filter((v) => v.category === 'combobox').length,
        carouselIssues: violations.filter((v) => v.category === 'carousel').length,
        tabPanelIssues: violations.filter((v) => v.category === 'tab-panel').length,
        menubarIssues: violations.filter((v) => v.category === 'menubar').length,
        liveRegionIssues: violations.filter((v) => v.category === 'live-region').length,
      },
      recommendations: this.generateAdvancedAriaRecommendations(violations),
      widgetPatterns: this.generateWidgetPatternGuidance(violations),
    };
  }

  /**
   * Trees, grids, menubars, tablists and comboboxes: the defects that make the
   * widget unusable rather than merely different from the APG example.
   */
  async analyzeCompositeWidgets(page) {
    return await page.evaluate(
      (accScript, renderedScript) => {
        eval(accScript);
        eval(renderedScript);
        const violations = [];

        function getElementSelector(element) {
          const tagName = element.tagName.toLowerCase();
          const id = element.id ? `#${element.id}` : '';
          const className =
            element.className && typeof element.className === 'string'
              ? `.${element.className.split(' ')[0]}`
              : '';
          return `${tagName}${id}${className}`;
        }

        // A tree, grid and menubar take their name from the author only
        // (namefrom: author), so an unnamed one is announced as a bare
        // "tree"/"grid"/"menu bar". The name is computed with the shared
        // ACCNAME subset, which also reads title and aria-labelledby, instead
        // of asking for two attributes.
        const NAMED_WIDGET_ROLES = ['tree', 'grid', 'treegrid', 'menubar'];
        const WIDGET_CATEGORY = {
          tree: 'tree-view',
          grid: 'data-grid',
          treegrid: 'data-grid',
          menubar: 'menubar',
        };

        for (const role of NAMED_WIDGET_ROLES) {
          for (const widget of document.querySelectorAll(`[role="${role}"]`)) {
            if (!__isRendered(widget)) continue;
            if (__accessibleName(widget)) continue;

            violations.push({
              type: 'widget-missing-accessible-name',
              category: WIDGET_CATEGORY[role],
              severity: 'serious',
              element: getElementSelector(widget),
              description: `Composite widget with role="${role}" has no accessible name`,
              details: { role, id: widget.id },
              wcagCriteria: '4.1.2',
              impact: 'The widget is announced by its role alone',
              recommendation: 'Name the widget with aria-label or aria-labelledby',
            });
          }
        }

        // 2.1.1 for a tree: keyboard users enter it through a tabbable item,
        // through the tree itself, or through aria-activedescendant. A tree
        // that offers none of the three cannot be reached at all. Asking every
        // treeitem for a tabindex instead reports the roving tabindex pattern
        // the APG prescribes.
        for (const tree of document.querySelectorAll('[role="tree"]')) {
          if (!__isRendered(tree)) continue;
          const items = Array.from(tree.querySelectorAll('[role="treeitem"]'));
          if (items.length === 0) continue;

          const tabbable = (el) => {
            const ti = el.getAttribute('tabindex');
            return ti !== null && parseInt(ti, 10) >= 0;
          };
          const reachable =
            items.some(tabbable) ||
            tabbable(tree) ||
            tree.hasAttribute('aria-activedescendant') ||
            items.some((item) => item.querySelector('a[href], button'));

          if (!reachable) {
            violations.push({
              type: 'tree-not-keyboard-reachable',
              category: 'tree-view',
              severity: 'serious',
              element: getElementSelector(tree),
              description:
                'No item of this tree is in the tab order and the tree has neither a tabindex nor aria-activedescendant',
              details: { itemCount: items.length },
              wcagCriteria: '2.1.1',
              impact: 'Keyboard users cannot reach any node of the tree',
              recommendation:
                'Give the active item tabindex="0" (roving tabindex) or manage focus with aria-activedescendant on the tree',
            });
          }

          // A node that owns a group of child nodes carries its expanded
          // state; without it the node reads as a leaf.
          for (const item of items) {
            if (item.hasAttribute('aria-expanded')) continue;
            const ownedGroup = Array.from(item.querySelectorAll('[role="group"]')).find(
              (group) =>
                group.querySelector('[role="treeitem"]') &&
                group.closest('[role="treeitem"]') === item
            );
            if (!ownedGroup) continue;

            violations.push({
              type: 'missing-aria-expanded',
              category: 'tree-view',
              severity: 'serious',
              element: getElementSelector(item),
              description: 'Tree item that owns a group of child items has no aria-expanded',
              details: { itemText: item.textContent.trim().substring(0, 60) },
              wcagCriteria: '4.1.2',
              impact: 'The node is announced as a leaf, and its expanded state is never conveyed',
              recommendation: 'Set aria-expanded="true" or "false" on the parent node',
            });
          }
        }

        // An open combobox has to say which popup is open. While it is
        // collapsed there is nothing to point at, and aria-expanded itself is
        // axe's aria-required-attr.
        for (const combobox of document.querySelectorAll('[role="combobox"]')) {
          if (!__isRendered(combobox)) continue;
          if (combobox.getAttribute('aria-expanded') !== 'true') continue;
          if (combobox.hasAttribute('aria-controls') || combobox.hasAttribute('aria-owns'))
            continue;

          violations.push({
            type: 'missing-aria-controls',
            category: 'combobox',
            severity: 'serious',
            element: getElementSelector(combobox),
            description: 'Expanded combobox does not identify the popup it controls',
            details: { id: combobox.id },
            wcagCriteria: '4.1.2',
            impact: 'Screen readers cannot move to the open list of options',
            recommendation: 'Point aria-controls at the id of the open listbox, grid or tree',
          });
        }

        // Selected state of a tablist. An omitted aria-selected means "false",
        // so the failure is the tablist as a whole: no tab selected, or
        // several selected without aria-multiselectable.
        for (const tabList of document.querySelectorAll('[role="tablist"]')) {
          if (!__isRendered(tabList)) continue;
          const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
          if (tabs.length === 0) continue;

          const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
          // Navigation rendered as tabs marks the current page with
          // aria-current instead, which conveys the same state.
          const current = tabs.filter((tab) => {
            const value = tab.getAttribute('aria-current');
            return value !== null && value !== 'false';
          });

          if (selected.length === 0 && current.length === 0) {
            violations.push({
              type: 'no-selected-tab',
              category: 'tab-panel',
              severity: 'serious',
              element: getElementSelector(tabList),
              description: 'No tab of this tablist is selected',
              details: { totalTabs: tabs.length },
              wcagCriteria: '4.1.2',
              impact: 'Screen reader users cannot tell which panel is showing',
              recommendation: 'Set aria-selected="true" on the active tab',
            });
          } else if (
            selected.length > 1 &&
            tabList.getAttribute('aria-multiselectable') !== 'true'
          ) {
            violations.push({
              type: 'multiple-selected-tabs',
              category: 'tab-panel',
              severity: 'serious',
              element: getElementSelector(tabList),
              description: `${selected.length} tabs are selected in a single-select tablist`,
              details: { selectedTabCount: selected.length, totalTabs: tabs.length },
              wcagCriteria: '4.1.2',
              impact: 'Screen readers receive conflicting state information',
              recommendation:
                'Keep aria-selected="true" on one tab, or declare aria-multiselectable="true" on the tablist',
            });
          }
        }

        return violations;
      },
      accnameCode,
      renderedCode
    );
  }

  /**
   * Analyze carousel widgets
   */
  async analyzeCarousels(page) {
    return await page.evaluate((visScript) => {
      eval(visScript);
      const violations = [];

      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      // Candidate net
      // A className substring is NOT evidence of a carousel: one carousel's
      // container, track, slides and controls bar all match. Cast a wide net
      // (aria-roledescription is the APG marker) but treat every hit as a
      // candidate that must prove itself below.
      const candidates = Array.from(
        document.querySelectorAll(
          '[aria-roledescription], [role="region"][aria-label*="carousel"], ' +
            '[role="region"][aria-label*="slider"], ' +
            '.carousel, .slider, .swiper, [class*="carousel"], [class*="slider"], [class*="swiper"]'
        )
      )
        .filter(isElementVisible)
        // `[class*="slider"]` also matches range/volume sliders. Those
        // are a different widget with a different naming contract.
        .filter(
          (el) =>
            el.getAttribute('role') !== 'slider' &&
            !(el.tagName === 'INPUT' && el.getAttribute('type') === 'range')
        );

      const classTokens = (el) =>
        (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean);

      // "slide"/"item" as a whole word inside a hyphen/underscore class
      // name: `swiper-slide`, `carousel-item`, `good-carousel-slide`.
      // Does NOT match `slider`, `slider-handle`, `slideshow`.
      const SLIDE_TOKEN = /(^|[-_])(slides?|items?)([-_]|$)/i;

      // Evidence A: the author DECLARED a carousel (APG pattern).
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

      // Evidence B1: slide children, i.e. at least 2 elements sharing one parent
      // (the track) that are marked as slides/items.
      function countSlides(el) {
        const marked = Array.from(
          el.querySelectorAll('[data-slide], [data-slide-index], [class*="slide"], [class*="item"]')
        ).filter(
          (n) =>
            n !== el &&
            (n.hasAttribute('data-slide') ||
              n.hasAttribute('data-slide-index') ||
              classTokens(n).some((t) => SLIDE_TOKEN.test(t)))
        );
        const byParent = new Map();
        for (const n of marked) {
          if (!n.parentElement) continue;
          byParent.set(n.parentElement, (byParent.get(n.parentElement) || 0) + 1);
        }
        let best = 0;
        for (const count of byParent.values()) best = Math.max(best, count);
        return best;
      }

      // Evidence B2: something actually advances the slides: a prev/next
      // affordance (en/de/glyph), a strip of at least 2 slide indicators, or
      // declared/observable auto-rotation.
      const CONTROL_WORDS = /prev|previous|next|zur[üu]ck|weiter|vorheri|n[äa]chst|◀|▶|‹|›|←|→/i;
      function hasPrevNextControl(el) {
        const controls = Array.from(
          el.querySelectorAll(
            'button, a, [role="button"], input[type="button"], input[type="submit"]'
          )
        );
        return controls.some((c) =>
          CONTROL_WORDS.test(
            [
              c.getAttribute('aria-label') || '',
              c.id || '',
              typeof c.className === 'string' ? c.className : '',
              c.getAttribute('title') || '',
              c.textContent || '',
            ].join(' ')
          )
        );
      }
      function hasSlideIndicators(el) {
        return (
          el.querySelectorAll(
            '.indicator, .dot, [class*="indicator"], [class*="dot"], [data-slide-to]'
          ).length >= 2
        );
      }
      function hasAutoRotation(el) {
        if (el.querySelector('[data-autoplay], [data-auto], [data-interval]')) return true;
        if (el.hasAttribute('data-interval') || el.hasAttribute('data-autoplay')) return true;
        if (classTokens(el).some((t) => /auto/i.test(t))) return true;
        // A CSS animation running on the slides is concrete evidence of
        // an auto-rotating carousel (bad-motion-vestibular.html).
        const slides = Array.from(el.querySelectorAll('[class*="slide"]')).filter((n) =>
          classTokens(n).some((t) => SLIDE_TOKEN.test(t))
        );
        return slides.some((n) => {
          const anim = getComputedStyle(n).animationName;
          return anim && anim !== 'none';
        });
      }
      function hasCarouselControls(el) {
        return hasPrevNextControl(el) || hasSlideIndicators(el) || hasAutoRotation(el);
      }

      const confirmed = candidates.filter(
        (el) => hasDeclaredCarouselEvidence(el) || (countSlides(el) >= 2 && hasCarouselControls(el))
      );

      // Outermost wins: a track/viewport nested inside a confirmed
      // carousel is part of it, not a second carousel.
      const carousels = confirmed.filter(
        (el) => !confirmed.some((other) => other !== el && other.contains(el))
      );

      // Accessible-name resolution: a carousel named by a wrapping labelled
      // region, by title, or by a heading referenced through aria-labelledby
      // is identifiable.
      function textOfIds(idref) {
        if (!idref) return '';
        return idref
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => {
            const t = document.getElementById(id);
            return t ? t.textContent.trim() : '';
          })
          .join(' ')
          .trim();
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
          const wl =
            (wrapper.getAttribute('aria-label') || '').trim() ||
            textOfIds(wrapper.getAttribute('aria-labelledby'));
          if (wl) return wl;
          wrapper = wrapper.parentElement
            ? wrapper.parentElement.closest('section, aside, [role="region"], [role="group"]')
            : null;
        }
        return '';
      }

      for (const carousel of carousels) {
        if (accessibleName(carousel)) continue;

        violations.push({
          type: 'missing-carousel-label',
          category: 'carousel',
          severity: 'serious',
          element: getElementSelector(carousel),
          description: 'Carousel lacks accessible name',
          details: {
            carouselId: carousel.id,
            carouselClass: carousel.className,
            evidence: {
              declared: hasDeclaredCarouselEvidence(carousel),
              slideCount: countSlides(carousel),
              hasControls: hasCarouselControls(carousel),
            },
          },
          wcagCriteria: '4.1.2',
          impact: 'Screen reader users cannot identify carousel purpose',
          recommendation: 'Add aria-label describing carousel content',
        });
      }

      return violations;
    }, BaseScanner.visibilityFilterScript);
  }

  /**
   * Analyze live region implementation
   */
  async analyzeLiveRegions(page) {
    return await page.evaluate((visScript) => {
      eval(visScript);
      const violations = [];

      function getElementSelector(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className =
          element.className && typeof element.className === 'string'
            ? `.${element.className.split(' ')[0]}`
            : '';
        return `${tagName}${id}${className}`;
      }

      const liveRegions = Array.from(
        document.querySelectorAll('[role="status"], [role="alert"], [role="log"]')
      ).filter(isElementVisible);

      liveRegions.forEach((region) => {
        const role = region.getAttribute('role');
        // Contradictory politeness: role="alert"/"status"/"log" carry an implicit
        // politeness setting, and an explicit aria-live="off" overrides it. The
        // author asks for an announcement and suppresses it in the same element.
        if (region.getAttribute('aria-live') !== 'off') return;

        violations.push({
          type: 'contradictory-live-region-politeness',
          category: 'live-region',
          severity: 'moderate',
          element: getElementSelector(region),
          description: `Element has role="${role}" but aria-live="off", which suppresses the announcement the role asks for`,
          details: { role, ariaLive: 'off' },
          wcagCriteria: '4.1.2',
          impact: 'Updates to this region are never announced despite the live-region role',
          recommendation:
            'Remove aria-live="off", or drop the role if the region should stay silent',
        });
      });

      // An initially empty live region is correct SC 4.1.3 markup (the
      // container must exist before content arrives), and revealing and
      // populating a hidden region in the same task announces correctly, so
      // neither is reported.

      return violations;
    }, BaseScanner.visibilityFilterScript);
  }

  /**
   * Generate recommendations for advanced ARIA issues
   */
  generateAdvancedAriaRecommendations(violations) {
    const recommendations = [];
    const issueTypes = [...new Set(violations.map((v) => v.type))];

    if (issueTypes.includes('widget-missing-accessible-name')) {
      recommendations.push({
        priority: 'critical',
        issue: 'Composite widgets missing accessible names',
        solution: 'Add aria-label or aria-labelledby to the widget container',
        implementation: 'Use a label that explains what the widget contains',
      });
    }

    if (issueTypes.includes('tree-not-keyboard-reachable')) {
      recommendations.push({
        priority: 'critical',
        issue: 'Composite widget not reachable from the keyboard',
        solution: 'Implement the roving tabindex or aria-activedescendant pattern',
        implementation: 'Keep exactly one item at tabindex="0" and move it with the arrow keys',
      });
    }

    if (issueTypes.some((type) => type.includes('selected-tab'))) {
      recommendations.push({
        priority: 'high',
        issue: 'Tab selection state is missing or ambiguous',
        solution: 'Maintain aria-selected across the tabs of a tablist',
        implementation: 'Set aria-selected="true" on the active tab and "false" on the others',
      });
    }

    if (issueTypes.includes('missing-aria-controls')) {
      recommendations.push({
        priority: 'high',
        issue: 'Widget relationships not properly defined',
        solution: 'Use aria-controls to link the widget to the content it opens',
        implementation: 'Ensure aria-controls IDs match existing controlled elements',
      });
    }

    if (issueTypes.includes('contradictory-live-region-politeness')) {
      recommendations.push({
        priority: 'medium',
        issue: 'Live region silenced by its own aria-live value',
        solution: 'Let the role decide the politeness, or drop the role',
        implementation: 'Remove aria-live="off" from role="alert" / "status" / "log" containers',
      });
    }

    return recommendations;
  }

  /**
   * Generate widget pattern guidance
   */
  generateWidgetPatternGuidance(violations) {
    const patterns = {};
    const categories = [...new Set(violations.map((v) => v.category))];

    categories.forEach((category) => {
      const categoryViolations = violations.filter((v) => v.category === category);

      patterns[category] = {
        issuesFound: categoryViolations.length,
        commonProblems: [...new Set(categoryViolations.map((v) => v.type))],
        implementationGuide: this.getPatternGuide(category),
        ariaPatternReference: this.getAriaPatternReference(category),
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
        requiredAttributes: ['aria-expanded', 'tabindex', 'aria-label'],
        keyboardSupport: [
          'Arrow keys for navigation',
          'Enter/Space to activate',
          'Home/End for first/last',
        ],
        focusManagement: 'Only one treeitem should be tabbable at a time',
      },
      'data-grid': {
        requiredRoles: ['grid', 'row', 'columnheader', 'rowheader', 'gridcell'],
        requiredAttributes: ['aria-label', 'aria-rowindex', 'aria-colindex'],
        keyboardSupport: [
          'Arrow keys for cell navigation',
          'Tab to move between grids',
          'Home/End/Page keys',
        ],
        focusManagement: 'Focus should move to grid cells, not the grid container',
      },
      combobox: {
        requiredRoles: ['combobox', 'listbox', 'option'],
        requiredAttributes: ['aria-expanded', 'aria-controls', 'aria-activedescendant'],
        keyboardSupport: ['Arrow keys to navigate options', 'Enter to select', 'Escape to close'],
        focusManagement: 'Focus remains on combobox, use aria-activedescendant for option focus',
      },
      carousel: {
        requiredRoles: ['region', 'button', 'tab', 'tabpanel'],
        requiredAttributes: ['aria-label', 'aria-roledescription'],
        keyboardSupport: [
          'Arrow keys or Tab to navigate slides',
          'Enter/Space to activate controls',
        ],
        focusManagement: 'Provide keyboard access to all slides and controls',
      },
      'tab-panel': {
        requiredRoles: ['tablist', 'tab', 'tabpanel'],
        requiredAttributes: ['aria-selected', 'aria-controls', 'aria-labelledby'],
        keyboardSupport: [
          'Arrow keys to navigate tabs',
          'Enter/Space to activate',
          'Tab to move to panel',
        ],
        focusManagement: 'Only active tab should be tabbable',
      },
      menubar: {
        requiredRoles: ['menubar', 'menuitem', 'menu'],
        requiredAttributes: ['aria-label', 'aria-haspopup', 'aria-expanded'],
        keyboardSupport: [
          'Arrow keys for navigation',
          'Enter to activate',
          'Escape to close submenus',
        ],
        focusManagement: 'Focus stays in menubar until menu is closed',
      },
      'live-region': {
        requiredRoles: ['status', 'alert', 'log'],
        requiredAttributes: ['aria-live', 'aria-atomic'],
        keyboardSupport: ['No keyboard interaction'],
        focusManagement: 'Announce without moving focus',
      },
    };

    return (
      guides[category] || {
        requiredRoles: ['Check ARIA Authoring Practices Guide'],
        requiredAttributes: ['Depends on specific widget pattern'],
        keyboardSupport: ['Follow standard widget keyboard conventions'],
        focusManagement: 'Implement appropriate focus management for pattern',
      }
    );
  }

  /**
   * Get ARIA pattern reference URL
   */
  getAriaPatternReference(category) {
    const references = {
      'tree-view': 'https://www.w3.org/WAI/ARIA/apg/patterns/treeview/',
      'data-grid': 'https://www.w3.org/WAI/ARIA/apg/patterns/grid/',
      combobox: 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/',
      carousel: 'https://www.w3.org/WAI/ARIA/apg/patterns/carousel/',
      'tab-panel': 'https://www.w3.org/WAI/ARIA/apg/patterns/tabs/',
      menubar: 'https://www.w3.org/WAI/ARIA/apg/patterns/menubar/',
      'live-region': 'https://www.w3.org/WAI/ARIA/apg/practices/live-regions/',
    };

    return references[category] || 'https://www.w3.org/WAI/ARIA/apg/patterns/';
  }
}

module.exports = AdvancedAriaScanner;
