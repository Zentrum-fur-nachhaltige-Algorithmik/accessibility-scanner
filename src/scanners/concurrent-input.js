const BaseScanner = require('../core/base-scanner');
const log = require('../utils/logger').createLogger('concurrent-input');

/**
 * Concurrent Input Mechanisms Scanner — WCAG 2.5.6 (AAA),
 * EN 301 549 clause 9.2.5.6.
 *
 * "Web content does not restrict use of input modalities available on a
 * platform except where the restriction is essential, required to ensure the
 * security of the content, or required to respect user settings."
 *
 * The failure mode is a page that assumes ONE input modality. Every check below
 * is evidence-based: it fires only when a concrete restriction is observable in
 * the DOM, the computed styles, or the actually-registered event listeners.
 * There is deliberately no "this page feels touch-first" heuristic — 2.5.6 is
 * about demonstrable exclusion, not about style.
 *
 * Listener discovery
 * ------------------
 * Inline `on*` attributes are only half the picture; most real pages register
 * handlers with `addEventListener`. This scanner therefore instruments
 * `EventTarget.prototype.addEventListener` via `evaluateOnNewDocument` and
 * reloads the page, so it sees the real listener map. That mutation is why the
 * scanner declares `needsExclusiveAccess`. If the reload fails (CSP, offline
 * fixture, detached frame) it degrades gracefully to attribute-only analysis
 * and says so in the summary.
 */

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
          log.entries.push({
            type: t,
            isDocument: this === document || this === window || this === document.body,
            body: body,
            node: (this && this.nodeType === 1) ? this : null,
          });
          if (this && this.nodeType === 1) {
            var prev = this.getAttribute('data-a11y-listeners') || '';
            if (prev.split(' ').indexOf(t) === -1) {
              this.setAttribute('data-a11y-listeners', (prev + ' ' + t).trim());
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

  /** Reloads the page with instrumentation installed — must own its tab. */
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

      function keyboardOperable(el) {
        if (el.matches(NATIVE_INTERACTIVE)) return true;
        const ti = el.getAttribute('tabindex');
        const focusable = ti !== null && parseInt(ti, 10) >= 0;
        return focusable && modalities(el).key;
      }

      const candidates = [...document.querySelectorAll('*')].filter(
        (el) => isElementVisible(el) && el.attributes.length > 0
      );

      // ---- 1. touch-only interaction -----------------------------------
      // Handlers exist for touch, but nothing a mouse, pen or keyboard user
      // can trigger. This is the canonical 2.5.6 failure.
      for (const el of candidates) {
        const m = modalities(el);
        if (!m.touch) continue;
        if (m.mouse || m.click || m.pointer) continue;
        if (keyboardOperable(el)) continue;

        push({
          element: selectorFor(el),
          issue: 'touch-only-interaction',
          description:
            `<${el.tagName.toLowerCase()}> handles touch events but exposes no mouse, ` +
            'pointer, click or keyboard equivalent — mouse, pen, switch and keyboard ' +
            'users cannot operate it.',
          severity: 'error',
          suggestion:
            'Register pointer/click handlers alongside the touch handlers, or add ' +
            'tabindex="0" plus a keydown handler so the same action is reachable ' +
            'from every input modality.',
        });
      }

      // ---- 2. mouse-only interaction -----------------------------------
      // Low-level mouse events with no click, no touch and no pointer
      // fallback: touch and pen users get nothing. (`click` is deliberately
      // treated as modality-neutral — browsers synthesise it from taps.)
      for (const el of candidates) {
        const m = modalities(el);
        if (!m.mouse) continue;
        if (m.click || m.touch || m.pointer) continue;
        if (el.matches(NATIVE_INTERACTIVE)) continue;

        push({
          element: selectorFor(el),
          issue: 'mouse-only-interaction',
          description:
            `<${el.tagName.toLowerCase()}> reacts only to low-level mouse events ` +
            '(mousedown/mouseup/mousemove) with no click, touch or pointer equivalent — ' +
            'touch and pen users cannot operate it.',
          severity: 'error',
          suggestion:
            'Use Pointer Events (pointerdown/pointerup), or add matching touch handlers, ' +
            'or drive the behaviour from a click handler.',
        });
      }

      // ---- 3. pointer input blocked on an interactive element ----------
      for (const el of candidates) {
        const cs = getComputedStyle(el);
        if (cs.pointerEvents !== 'none') continue;

        const m = modalities(el);
        const interactive =
          el.matches(NATIVE_INTERACTIVE) || m.click || m.mouse || m.touch || m.pointer;
        if (!interactive) continue; // decorative overlay — correct use of the property

        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;

        push({
          element: selectorFor(el),
          issue: 'pointer-input-blocked',
          description:
            `Interactive <${el.tagName.toLowerCase()}> has computed ` +
            'pointer-events: none, so mouse, touch and pen input cannot reach it at all.',
          severity: 'error',
          suggestion:
            'Remove pointer-events: none from the interactive element (keep it only on ' +
            'purely decorative overlays).',
        });
      }

      // ---- 4. global touch suppression ---------------------------------
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

      // NOTE: `user-scalable=no` / `maximum-scale=1` is also a touch-modality
      // restriction, but it is already reported by html-validation-scanner and
      // phase6d-mobile-specific-scanner under 1.4.4/1.4.10. Emitting it a third
      // time here would inflate the ensemble count for one underlying defect,
      // so this scanner deliberately stays silent about it.

      return {
        violations,
        candidateCount: candidates.length,
        instrumentedElements: document.querySelectorAll('[data-a11y-listeners]').length,
      };
    }, BaseScanner.visibilityFilterScript);

    // ---- 5. document-level keyboard suppression (inline scripts) --------
    const scriptFindings = await page.evaluate(() => {
      const out = [];
      const scripts = [...document.querySelectorAll('script:not([src])')]
        .map((s) => s.textContent || '')
        .filter(Boolean);

      for (const src of scripts) {
        // A document/window-level key listener that unconditionally calls
        // preventDefault() swallows keyboard input for the whole page. Requiring
        // the ABSENCE of any key discrimination is what keeps this specific:
        // handlers that cancel a single named key (Escape, Tab traps, shortcut
        // keys) are normal and are not flagged.
        const listenerRe =
          /(document|window)\s*\.\s*addEventListener\s*\(\s*['"](keydown|keypress|keyup)['"]\s*,([\s\S]{0,900}?)\n\s*\}\s*\)/g;
        let m;
        while ((m = listenerRe.exec(src)) !== null) {
          const body = m[3];
          const cancels = /\.preventDefault\s*\(\s*\)|return\s+false\s*;/.test(body);
          const discriminates = /\.key\b|\.code\b|keyCode|charCode|\.which\b|isComposing/.test(
            body
          );
          if (cancels && !discriminates) {
            out.push({
              target: m[1],
              type: m[2],
              excerpt: m[0].slice(0, 220),
            });
          }
        }

        // Modality sniffing: choosing ONE event family based on a capability
        // probe is the classic 2.5.6 failure ("if touch device, only bind touch").
        const probes = /(['"]ontouchstart['"]\s+in\s+window)|navigator\.maxTouchPoints/.test(src);
        const bindsTouch = /addEventListener\s*\(\s*['"]touch/.test(src);
        const bindsMouse = /addEventListener\s*\(\s*['"](mouse|pointer|click)/.test(src);
        const branches = /\belse\b|\?\s*['"]/.test(src);
        if (probes && bindsTouch && bindsMouse && branches) {
          out.push({ target: 'inline-script', type: 'modality-sniffing', excerpt: null });
        }
      }
      return out;
    });

    for (const f of scriptFindings) {
      if (f.type === 'modality-sniffing') {
        result.violations.push({
          criterion: '9.2.5.6',
          element: 'script',
          issue: 'input-modality-sniffing',
          description:
            'An inline script probes for touch capability ("ontouchstart" in window / ' +
            'navigator.maxTouchPoints) and binds touch OR mouse handlers in opposite ' +
            'branches. Devices that support both modalities simultaneously (2-in-1 ' +
            'laptops, tablets with a keyboard and mouse) lose one of them.',
          severity: 'serious',
          suggestion: 'Bind Pointer Events once instead of branching on a capability probe.',
        });
      } else {
        result.violations.push({
          criterion: '9.2.5.6',
          element: `${f.target} (${f.type})`,
          issue: 'keyboard-input-suppressed',
          description:
            `A ${f.target}-level "${f.type}" listener calls preventDefault() without ` +
            'testing which key was pressed, suppressing keyboard input page-wide: ' +
            `${f.excerpt}`,
          severity: 'error',
          suggestion:
            'Only cancel the specific keys the feature handles; let every other key ' +
            'reach the browser and assistive technology.',
        });
      }
    }

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
