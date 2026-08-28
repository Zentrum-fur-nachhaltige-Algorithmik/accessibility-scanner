/**
 * Concurrent Input Mechanisms Scanner.
 * WCAG 2.5.6 (EN 301 549 9.2.5.6).
 * Reports a page that takes one input modality away: a touch handler that
 * cancels the events every other modality is synthesised from, an interactive
 * element the pointer cannot reach, and touch-action suppressed on the
 * document. The presence of a handler for one modality is not a restriction of
 * another, and no rule here reads a capability probe out of a script.
 */
const BaseScanner = require('../core/base-scanner');
const log = require('../utils/logger').createLogger('concurrent-input');

// Instruments EventTarget.prototype.addEventListener before the page reloads
// so the scanner sees the real listener map, not just inline on* attributes.
// This mutation is why the scanner declares needsExclusiveAccess. If the reload
// fails (CSP, offline fixture, detached frame) the scan degrades to
// attribute-only analysis and says so in the summary.

const INSTRUMENTATION = `
  (function () {
    if (window.__a11yInputLog) return;
    var log = { entries: [] };
    window.__a11yInputLog = log;
    var orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, opts) {
      try {
        var t = String(type || '').toLowerCase();
        if (/^(touch|mouse|pointer|key|click|dblclick|contextmenu|wheel|drag)/.test(t)) {
          var body = '';
          try { body = String(listener).slice(0, 1500); } catch (e) { body = ''; }
          // A passive listener cannot call preventDefault(), so it never
          // suppresses the events a browser synthesises from a touch.
          var passive = !!(opts && typeof opts === 'object' && opts.passive);
          var cancels = !passive && /preventDefault\\s*\\(|return\\s+false/.test(body);
          log.entries.push({
            type: t,
            isDocument: this === document || this === window || this === document.body,
            cancels: cancels,
            body: body,
            node: (this && this.nodeType === 1) ? this : null,
          });
          if (this && this.nodeType === 1) {
            var prev = this.getAttribute('data-a11y-listeners') || '';
            if (prev.split(' ').indexOf(t) === -1) {
              this.setAttribute('data-a11y-listeners', (prev + ' ' + t).trim());
            }
            if (cancels) {
              var prevCancel = this.getAttribute('data-a11y-cancels') || '';
              if (prevCancel.split(' ').indexOf(t) === -1) {
                this.setAttribute('data-a11y-cancels', (prevCancel + ' ' + t).trim());
              }
            }
          }
        }
      } catch (e) { /* never break the page */ }
      return orig.call(this, type, listener, opts);
    };
  })();
`;

class ConcurrentInputScanner extends BaseScanner {
  constructor() {
    super('concurrent-input', {
      wcagCriteria: ['2.5.6'],
      wcagPrinciple: 'operable',
    });
  }

  /** Reloads the page with instrumentation installed, so it must own its tab. */
  get needsExclusiveAccess() {
    return true;
  }

  async scan(page, options = {}) {
    let instrumented = false;
    try {
      const url = page.url();
      if (url && /^https?:/i.test(url)) {
        await page.evaluateOnNewDocument(INSTRUMENTATION);
        await page.reload({
          waitUntil: 'domcontentloaded',
          timeout: options.timeout || 30000,
        });
        // Give deferred/DOMContentLoaded registrations a moment to run.
        await new Promise((r) => setTimeout(r, 500));
        instrumented = await page.evaluate(() => Boolean(window.__a11yInputLog));
      }
    } catch (e) {
      log.warn(
        `concurrent-input: listener instrumentation unavailable (${e.message}); ` +
          'falling back to inline-attribute analysis'
      );
      instrumented = false;
    }

    const result = await page.evaluate((visibilityScript) => {
      eval(visibilityScript);

      const violations = [];
      const seen = new Set();

      // ---- helpers -----------------------------------------------------
      function selectorFor(el) {
        if (el.id) return `#${el.id}`;
        const parts = [el.tagName.toLowerCase()];
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
        if (cls[0]) parts.push(`.${cls[0]}`);
        const parent = el.parentElement;
        if (parent) {
          const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName);
          if (sameTag.length > 1) parts.push(`:nth-of-type(${sameTag.indexOf(el) + 1})`);
        }
        return parts.join('');
      }

      function push(v) {
        const key = `${v.issue}|${v.element}`;
        if (seen.has(key)) return;
        seen.add(key);
        violations.push({ criterion: '9.2.5.6', ...v });
      }

      const NATIVE_INTERACTIVE =
        'a[href], button, input, select, textarea, summary, details, [contenteditable="true"]';

      /** Event families present on an element, from attributes + instrumentation. */
      function modalities(el) {
        const attrs = [...el.attributes].map((a) => a.name.toLowerCase());
        const logged = (el.getAttribute('data-a11y-listeners') || '').split(/\s+/).filter(Boolean);

        const has = (re) =>
          attrs.some((a) => a.startsWith('on') && re.test(a.slice(2))) ||
          logged.some((t) => re.test(t));

        return {
          touch: has(/^touch/),
          mouse: has(/^(mousedown|mouseup|mousemove|mouseover|mouseout|mouseenter|mouseleave)$/),
          click: has(/^(click|dblclick)$/),
          pointer: has(/^pointer/),
          key: has(/^key/),
          drag: has(/^drag/),
        };
      }

      /**
       * Does a touch listener on this element call preventDefault()? Listeners
       * registered with addEventListener are marked by the instrumentation;
       * an inline ontouch* attribute is a function object whose source is read
       * here, following the one call it usually is into the named function.
       */
      function cancelsTouch(el) {
        const marked = (el.getAttribute('data-a11y-cancels') || '')
          .split(/\s+/)
          .some((t) => t.startsWith('touch'));
        if (marked) return true;

        for (const attr of el.attributes) {
          if (!/^ontouch/i.test(attr.name)) continue;
          // Desktop Chrome does not expose the ontouch* IDL attributes, so the
          // handler is read from the attribute value and the function it calls.
          let source = attr.value || '';
          for (const call of source.match(/([A-Za-z_$][\w$]*)\s*\(/g) || []) {
            const named = window[call.slice(0, -1).trim()];
            if (typeof named === 'function') source += '\n' + String(named);
          }
          if (/preventDefault\s*\(|return\s+false/.test(source)) return true;
        }
        return false;
      }

      function keyboardOperable(el) {
        if (el.matches(NATIVE_INTERACTIVE)) return true;
        const ti = el.getAttribute('tabindex');
        const focusable = ti !== null && parseInt(ti, 10) >= 0;
        return focusable && modalities(el).key;
      }

      const candidates = [...document.querySelectorAll('*')].filter(
        (el) => isElementVisible(el) && el.attributes.length > 0
      );

      // A page that listens for clicks on the document operates every element
      // through delegation, whatever each element carries itself.
      const logEntries = (window.__a11yInputLog && window.__a11yInputLog.entries) || [];
      const documentPointerDelegation = logEntries.some(
        (e) => e.isDocument && /^(click|pointer|mouse)/.test(e.type)
      );

      /** Can any modality other than touch operate this element or an ancestor? */
      function hasNonTouchPath(el) {
        if (documentPointerDelegation) return true;
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
          const m = modalities(node);
          if (m.mouse || m.click || m.pointer) return true;
          if (keyboardOperable(node)) return true;
        }
        return false;
      }

      // ---- 1. touch handling that cancels every other modality ----------
      // A touch listener alone restricts nothing: the browser synthesises
      // mouse events and a click from a tap, and a mouse produces those
      // events directly. The modality is only taken away when the touch
      // listener calls preventDefault(), which suppresses the synthesised
      // events, and nothing else on the element or above it responds to a
      // click, a pointer or the keyboard.
      for (const el of candidates) {
        if (!modalities(el).touch) continue;
        if (!cancelsTouch(el)) continue;
        if (hasNonTouchPath(el)) continue;

        push({
          element: selectorFor(el),
          issue: 'touch-only-interaction',
          description:
            `<${el.tagName.toLowerCase()}> handles touch events, cancels them so the ` +
            'browser synthesises no mouse or click event, and exposes no pointer, click ' +
            'or keyboard equivalent. Mouse, pen, switch and keyboard users cannot ' +
            'operate it.',
          severity: 'error',
          suggestion:
            'Register pointer/click handlers alongside the touch handlers, or add ' +
            'tabindex="0" plus a keydown handler so the same action is reachable ' +
            'from every input modality.',
        });
      }

      // ---- 2. pointer input blocked on an interactive element ----------
      // pointer-events: none is the standard way to let a click fall through
      // to the control underneath, so the finding needs the hit test: the
      // element is only unreachable when the point over its centre reaches
      // neither it nor an interactive ancestor of it.
      for (const el of candidates) {
        const cs = getComputedStyle(el);
        if (cs.pointerEvents !== 'none') continue;
        if (el.matches('[disabled], [aria-disabled="true"]')) continue;

        const m = modalities(el);
        const interactive =
          el.matches(NATIVE_INTERACTIVE) || m.click || m.mouse || m.touch || m.pointer;
        if (!interactive) continue; // decorative overlay: correct use of the property

        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;

        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;

        const hit = document.elementFromPoint(x, y);
        // The event lands on the element itself (a descendant re-enables
        // pointer events), or on an ancestor that carries the same handler
        // or is a control: the interaction still happens.
        if (hit && (el.contains(hit) || (hit.contains(el) && hasNonTouchPath(hit)))) continue;

        push({
          element: selectorFor(el),
          issue: 'pointer-input-blocked',
          description:
            `Interactive <${el.tagName.toLowerCase()}> has computed ` +
            'pointer-events: none, and a click over its centre reaches ' +
            `${hit ? `<${hit.tagName.toLowerCase()}>` : 'nothing'} instead, so mouse, ` +
            'touch and pen input cannot operate it.',
          severity: 'error',
          suggestion:
            'Remove pointer-events: none from the interactive element (keep it only on ' +
            'purely decorative overlays).',
        });
      }

      // ---- 3. global touch suppression ---------------------------------
      for (const el of [document.documentElement, document.body]) {
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.touchAction === 'none') {
          push({
            element: el.tagName.toLowerCase(),
            issue: 'global-touch-suppressed',
            description:
              `touch-action: none is applied to <${el.tagName.toLowerCase()}>, which ` +
              'disables touch panning and pinch-zoom for the entire document.',
            severity: 'error',
            suggestion:
              'Scope touch-action to the specific gesture surface that needs it instead ' +
              'of the whole document.',
          });
        }
      }

      // `user-scalable=no` / `maximum-scale=1` is also a touch-modality
      // restriction, but axe-core already reports it
      // under 1.4.4/1.4.10, so it is not emitted again here.

      return {
        violations,
        candidateCount: candidates.length,
        instrumentedElements: document.querySelectorAll('[data-a11y-listeners]').length,
      };
    }, BaseScanner.visibilityFilterScript);

    return {
      scannerId: this.id,
      criteria: ['9.2.5.6'],
      passed: result.violations.length === 0,
      violations: result.violations,
      summary: {
        totalIssues: result.violations.length,
        criteriaChecked: ['2.5.6'],
        listenerInstrumentation: instrumented ? 'active' : 'unavailable (attributes only)',
        elementsWithRegisteredListeners: result.instrumentedElements,
        elementsInspected: result.candidateCount,
      },
    };
  }
}

module.exports = ConcurrentInputScanner;
