/**
 * Hover/Focus Content Scanner.
 * WCAG 1.4.13 (EN 301 549 9.1.4.13).
 * Hovers the elements that can reveal content and measures the three
 * requirements on what appears: hoverable, persistent, dismissable.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: renderedCode } = require('../utils/rendered');
const log = require('../utils/logger').createLogger('hover-focus-content');

/** Marks the trigger and the revealed content across page.evaluate calls. */
const MARK = 'data-hover-focus-probe';

class HoverFocusContentScanner extends BaseScanner {
  constructor() {
    super('hover-focus-content', {
      wcagCriteria: ['1.4.13'],
      wcagPrinciple: 'perceivable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  async scan(page, options = {}) {
    // 1.4.13 governs content that appears when the pointer or the keyboard
    // reaches a trigger. There is nothing to measure without driving them, so
    // a run that may not do that measures nothing.
    if (options.heuristicOnly) {
      return {
        scannerId: this.id,
        criteria: ['9.1.4.13'],
        passed: true,
        violations: [],
        summary: { heuristicOnly: true, violationCount: 0 },
      };
    }
    return this.fullScan(page, options);
  }

  /**
   * Interactive pass: hover every element that can reveal content and measure
   * what appears.
   */
  async fullScan(page, options = {}) {
    const violations = [];

    const triggers = await this.collectTriggers(page);
    log.debug(`Hovering ${triggers.length} candidate trigger(s)`);

    for (const trigger of triggers) {
      try {
        const finding = await this.probeTrigger(page, trigger);
        violations.push(...finding);
      } catch (error) {
        log.warn(`Error hovering ${trigger.selector}: ${error.message}`);
      } finally {
        await page
          .evaluate((mark) => {
            document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));
          }, MARK)
          .catch(() => {});
      }
    }

    return {
      scannerId: this.id,
      criteria: ['9.1.4.13'],
      passed: violations.length === 0,
      violations,
      summary: {
        triggersHovered: triggers.length,
        violationCount: violations.length,
      },
    };
  }

  /**
   * Elements that can reveal content under the pointer: the subject of a
   * `:hover` rule that changes what is painted, an element with a mouseenter
   * or mouseover handler attribute, and a control that describes itself
   * through an element which is not painted yet.
   */
  async collectTriggers(page) {
    return page.evaluate((injectedCode) => {
      eval(injectedCode);

      const REVEALING_PROPERTIES = [
        'display',
        'visibility',
        'opacity',
        'transform',
        'left',
        'right',
        'top',
        'bottom',
        'height',
        'max-height',
        'width',
        'max-width',
        'clip',
        'clip-path',
        'pointer-events',
      ];

      const subjects = new Set();
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
            try {
              walk(rule.cssRules);
            } catch (e) {
              /* unreadable nested sheet */
            }
            continue;
          }
          if (!(rule instanceof CSSStyleRule)) continue;
          const selector = rule.selectorText || '';
          if (!/:hover/i.test(selector)) continue;
          const changesPaint = REVEALING_PROPERTIES.some((p) => rule.style.getPropertyValue(p));
          if (!changesPaint) continue;
          for (const part of selector.split(',')) {
            const i = part.toLowerCase().indexOf(':hover');
            if (i < 0) continue;
            const subject = part.slice(0, i).trim();
            if (!subject) continue;
            try {
              document.querySelectorAll(subject).forEach((el) => subjects.add(el));
            } catch (e) {
              /* selector this document cannot parse */
            }
          }
        }
      };
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules || sheet.rules;
        } catch (e) {
          continue; // cross-origin stylesheet
        }
        if (rules) walk(rules);
      }

      document.querySelectorAll('[onmouseenter], [onmouseover]').forEach((el) => subjects.add(el));

      document.querySelectorAll('[aria-describedby]').forEach((el) => {
        const describedBy = (el.getAttribute('aria-describedby') || '')
          .split(/\s+/)
          .filter(Boolean);
        const hidden = describedBy
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .some((target) => !__isRendered(target));
        if (hidden) subjects.add(el);
      });

      const triggers = [];
      for (const el of subjects) {
        if (triggers.length >= 10) break;
        if (!__isRendered(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // outside the viewport
        triggers.push({
          selector:
            el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : '') +
            (el.className && typeof el.className === 'string'
              ? `.${el.className.split(' ')[0]}`
              : ''),
          point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        });
      }
      return triggers;
    }, renderedCode);
  }

  /**
   * One trigger: hover it, find what appears, then measure whether the content
   * survives the pointer moving onto it, whether it stays while the pointer
   * rests on the trigger, and whether Escape dismisses it.
   */
  async probeTrigger(page, trigger) {
    const violations = [];
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    await page.mouse.move(0, 0);
    await wait(250);
    const before = await page.evaluate(this.constructor.paintedSnapshotScript);

    await page.mouse.move(trigger.point.x, trigger.point.y);
    await wait(500);

    const content = await page.evaluate(
      (beforePainted, mark, injectedCode) => {
        eval(injectedCode);
        const elements = Array.from(document.querySelectorAll('body *')).filter(
          (el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'
        );
        const painted = (el) => __isRendered(el);

        for (let i = 0; i < elements.length && i < beforePainted.length; i++) {
          const el = elements[i];
          if (!painted(el) || beforePainted[i]) continue;
          // Report the outermost newly painted element only.
          const parentIndex = el.parentElement ? elements.indexOf(el.parentElement) : -1;
          if (
            parentIndex !== -1 &&
            parentIndex < beforePainted.length &&
            !beforePainted[parentIndex]
          )
            continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          // 1.4.13 asks for a dismiss mechanism only when the additional
          // content obscures or replaces other content.
          let obscures = false;
          const pad = 2;
          for (const other of elements) {
            if (other === el || el.contains(other) || other.contains(el)) continue;
            if (!painted(other)) continue;
            const hasOwnText = Array.from(other.childNodes).some(
              (n) => n.nodeType === 3 && n.textContent.trim()
            );
            const isGraphic = /^(img|svg|video|canvas|input|button|select|textarea)$/i.test(
              other.tagName
            );
            if (!hasOwnText && !isGraphic) continue;
            const o = other.getBoundingClientRect();
            if (o.width === 0 || o.height === 0) continue;
            if (
              o.left < rect.right - pad &&
              o.right > rect.left + pad &&
              o.top < rect.bottom - pad &&
              o.bottom > rect.top + pad
            ) {
              obscures = true;
              break;
            }
          }

          // A control that closes the content is itself a dismiss mechanism.
          const controls = [el, ...el.querySelectorAll('button, [role="button"], a[href]')];
          const hasCloseControl = controls.some((c) => {
            if (!c.matches || !c.matches('button, [role="button"], a[href]')) return false;
            const name = `${c.getAttribute('aria-label') || ''} ${c.textContent || ''} ${
              typeof c.className === 'string' ? c.className : ''
            }`.toLowerCase();
            return /close|schlie|dismiss|×|✕|✖/.test(name);
          });

          el.setAttribute(mark, 'content');
          return {
            found: true,
            obscures,
            hasCloseControl,
            point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
            selector:
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (el.className && typeof el.className === 'string'
                ? `.${el.className.split(' ')[0]}`
                : ''),
          };
        }
        return { found: false };
      },
      before,
      MARK,
      renderedCode
    );

    if (!content.found) return violations;

    const stillPainted = async () =>
      page.evaluate(
        (mark, injectedCode) => {
          eval(injectedCode);
          const el = document.querySelector(`[${mark}="content"]`);
          return !!el && __isRendered(el);
        },
        MARK,
        renderedCode
      );

    // Hoverable: the pointer moves from the trigger onto the content.
    await page.mouse.move(content.point.x, content.point.y);
    await wait(300);
    if (!(await stillPainted())) {
      violations.push({
        criterion: '9.1.4.13',
        element: content.selector,
        issue: 'hover-content-not-hoverable',
        description: `Content revealed by hovering ${trigger.selector} disappears as soon as the pointer moves onto it, so it cannot be read or used`,
        severity: 'serious',
        suggestion:
          'Keep the content visible while the pointer is over the trigger or over the content itself.',
      });
      return violations;
    }

    // Persistent: the content stays while the pointer rests on the trigger.
    await page.mouse.move(trigger.point.x, trigger.point.y);
    await wait(1500);
    if (!(await stillPainted())) {
      violations.push({
        criterion: '9.1.4.13',
        element: content.selector,
        issue: 'hover-content-not-persistent',
        description: `Content revealed by hovering ${trigger.selector} disappears on its own while the pointer is still on the trigger`,
        severity: 'serious',
        suggestion:
          'Keep the content visible until the pointer leaves, the user dismisses it, or the information becomes invalid.',
      });
      return violations;
    }

    // Dismissable: Escape, without moving the pointer.
    await page.keyboard.press('Escape');
    await wait(300);
    if ((await stillPainted()) && content.obscures && !content.hasCloseControl) {
      violations.push({
        criterion: '9.1.4.13',
        element: content.selector,
        issue: 'hover-content-not-dismissable',
        description: `Content revealed by hovering ${trigger.selector} covers other content, is not dismissed by Escape and offers no control to close it`,
        severity: 'serious',
        suggestion:
          'Dismiss the content on Escape, or give it a close control, while the pointer stays where it is.',
      });
    }

    return violations;
  }

  /** Painted state of every element under <body>, in document order. */
  static get paintedSnapshotScript() {
    return `
      (function () {
        ${renderedCode}
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
          out.push(__isRendered(el));
        }
        return out;
      })()
    `;
  }
}

module.exports = HoverFocusContentScanner;
