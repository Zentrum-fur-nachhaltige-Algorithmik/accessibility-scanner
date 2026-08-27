/**
 * Real keyboard focus traversal for Puppeteer pages.
 *
 * Why: `element.focus()` from page.evaluate() does NOT put Chromium into the
 * `:focus-visible` state, so every site that (correctly) styles only
 * `:focus-visible { outline: … }` looks like it has no focus indicator at all.
 * Pressing Tab through the CDP keyboard does trigger it. This module is the
 * single place that knows how to do that; scanners consume its steps instead
 * of rolling their own focus loops.
 *
 * Identity is by a `data-a11y-tab-id` marker stamped on every
 * keyboard-reachable element before the walk — never by a selector string,
 * because two sibling `a.nav__link`s produce the same string and used to be
 * mis-detected as a keyboard trap.
 *
 *   const { tabWalk } = require('./utils/keyboard-focus');
 *   for await (const step of tabWalk(page, { maxSteps: 60 })) {
 *     step.tabId, step.selector, step.tag, step.rect,
 *     step.before / step.after   // computed-style snapshots (unfocused / focused)
 *     step.indicator             // { visible, reasons[], lowContrast, ratio,
 *                                //   backdrop, baselineKnown, confirmed }
 *     step.stuck                 // true if Tab did not move focus (trap)
 *   }
 *
 * The walk stops at the end of the document (focus returns to <body> or
 * leaves the page), on a cycle, on a stuck Tab, or at maxSteps.
 */

const { injectableCode: contrastCode } = require('./browser-contrast');
const { injectableCode: renderedCode } = require('./rendered');

const TAB_ATTR = 'data-a11y-tab-id';

/**
 * Pages whose focus is currently emulated, so cleanupTabWalk can switch it off
 * again. WeakMap so a closed page is not kept alive by this module.
 */
const focusEmulation = new WeakMap();

/**
 * Make the page render as if its tab were in front.
 *
 * Why this is not optional: Chromium only matches `:focus` (and therefore
 * `:focus-visible`) while the document HAS focus. CDP key events still move
 * `document.activeElement` in a background tab, so a focus walk keeps
 * stepping — but every element it measures reports the UNFOCUSED style and
 * looks like it has no focus ring. The scan pipeline runs scanners in parallel
 * tabs and `page.screenshot()` brings its own tab to the front, so the walking
 * tab loses focus at an unpredictable moment: that was the last source of
 * flaky `missing-focus-indicator` findings on pages whose ring is fine
 * (observed as hasFocus:false / activeElement set / matches(':focus') false).
 * `Emulation.setFocusEmulationEnabled` pins the page to "focused".
 */
async function enableFocusEmulation(page) {
  if (focusEmulation.has(page)) return;
  try {
    const session = await page.createCDPSession();
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    focusEmulation.set(page, session);
  } catch (e) {
    /* older Chrome / detached target: fall back to the hasFocus guard */
  }
}

async function disableFocusEmulation(page) {
  const session = focusEmulation.get(page);
  if (!session) return;
  focusEmulation.delete(page);
  try {
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await session.detach();
  } catch (e) {
    /* page already gone */
  }
}

const TRACKED_PROPS = [
  'outlineStyle',
  'outlineWidth',
  'outlineColor',
  'outlineOffset',
  'boxShadow',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopStyle',
  'backgroundColor',
  'backgroundImage',
  'color',
  'textDecorationLine',
  'filter',
  'transform',
];

/**
 * In-page code shared by prepare/step. Defines:
 *   __a11ySnapshot(el)                       -> plain object of TRACKED_PROPS
 *   __a11yIndicator(el, before, after)       -> { visible, reasons, lowContrast, ratio }
 */
const helperCode = `
  ${contrastCode}
  ${renderedCode}
  const __A11Y_PROPS = ${JSON.stringify(TRACKED_PROPS)};
  function __a11ySnapshot(el) {
    const cs = window.getComputedStyle(el);
    const o = {};
    for (const p of __A11Y_PROPS) o[p] = cs[p];
    // ::before/::after rings are common (e.g. Tailwind ring via pseudo)
    for (const pseudo of ['::before', '::after']) {
      const ps = window.getComputedStyle(el, pseudo);
      if (ps.content && ps.content !== 'none' && ps.content !== 'normal') {
        o['pseudo' + pseudo] = { boxShadow: ps.boxShadow, outlineStyle: ps.outlineStyle, outlineWidth: ps.outlineWidth, backgroundColor: ps.backgroundColor, borderTopWidth: ps.borderTopWidth, borderTopColor: ps.borderTopColor, opacity: ps.opacity };
      }
    }
    return o;
  }

  function __a11yIndicator(el, before, after, baselineKnown) {
    const reasons = [];
    let lowContrast = false;
    let ratio = null;
    const backdrop = __getEffectiveBackgroundColor(el.parentElement || el) || { r: 255, g: 255, b: 255, a: 1 };

    // 1. Outline (including the UA 'auto' ring, which is always visible)
    const outlineOn = after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0 && !__isColorTransparent(after.outlineColor);
    if (after.outlineStyle === 'auto') {
      reasons.push('outline-auto');
    } else if (outlineOn) {
      const oc = __parseRgb(after.outlineColor);
      if (oc) {
        // WCAG 1.4.11: 3:1 against ADJACENT colours. With a non-positive
        // outline-offset the ring touches the element's own background too,
        // so it passes if it is distinguishable from either side.
        const flat = __blendOver(oc, backdrop);
        ratio = __getContrastRatio(flat, backdrop);
        if (parseFloat(after.outlineOffset) <= 0) {
          const own = __parseRgb(after.backgroundColor);
          if (own && own.a > 0) {
            const ownFlat = __blendOver(own, backdrop);
            ratio = Math.max(ratio, __getContrastRatio(__blendOver(oc, ownFlat), ownFlat));
          }
        }
      }
      if (ratio === null || ratio >= 3) reasons.push('outline');
      else lowContrast = true;
    }

    // 2. Box-shadow appeared or changed
    if (after.boxShadow !== 'none' && after.boxShadow !== before.boxShadow) reasons.push('box-shadow');

    // 3. Border changed (colour or width)
    const borderKeys = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','borderTopStyle'];
    if (borderKeys.some(k => before[k] !== after[k])) reasons.push('border');

    // 4. Background / colour / decoration / filter / transform changed
    if (before.backgroundColor !== after.backgroundColor || before.backgroundImage !== after.backgroundImage) {
      const b = __parseRgb(before.backgroundColor), a = __parseRgb(after.backgroundColor);
      if (!(b && a && __getContrastRatio(b, a) < 1.5 && before.backgroundImage === after.backgroundImage)) reasons.push('background');
    }
    if (before.color !== after.color) reasons.push('color');
    if (before.textDecorationLine !== after.textDecorationLine) reasons.push('text-decoration');
    if (before.filter !== after.filter) reasons.push('filter');
    if (before.transform !== after.transform) reasons.push('transform');

    // 5. Pseudo-element ring
    for (const k of ['pseudo::before', 'pseudo::after']) {
      const b = before[k], a = after[k];
      if (a && JSON.stringify(a) !== JSON.stringify(b)) reasons.push(k);
    }

    // baselineKnown === false means the unfocused snapshot is a copy of the
    // focused one, so every DIFF-based reason above (box-shadow, border,
    // background, colour, pseudo ring) is structurally undetectable. Saying
    // "no indicator" from that is a guess, not a measurement — tabWalk turns
    // such a step into a confirmed second measurement instead.
    return {
      visible: reasons.length > 0,
      reasons,
      lowContrast: lowContrast && reasons.length === 0,
      ratio,
      backdrop: 'rgb(' + backdrop.r + ', ' + backdrop.g + ', ' + backdrop.b + ')',
      baselineKnown: baselineKnown !== false,
      confirmed: false,
      outline: after.outlineStyle + ' ' + after.outlineWidth + ' ' + after.outlineColor,
    };
  }

  function __a11ySelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body && parts.length < 4) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      const cls = [...n.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      if (cls) s += cls;
      const sibs = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(' > ');
  }
`;

/**
 * Stamp every keyboard-reachable element with a tab id and capture its
 * unfocused style snapshot. Returns the number of candidates.
 */
async function prepareTabWalk(page) {
  await enableFocusEmulation(page);
  return page.evaluate(
    (helpers, ATTR) => {
      eval(helpers);
      if (document.activeElement && document.activeElement !== document.body)
        document.activeElement.blur();
      // Focus-driven scrolling honours `scroll-behavior: smooth`; measurements
      // taken mid-animation would be wrong. Removed again by cleanupTabWalk().
      if (!document.getElementById('__a11y-no-smooth')) {
        const st = document.createElement('style');
        st.id = '__a11y-no-smooth';
        st.textContent = 'html, body { scroll-behavior: auto !important; }';
        document.head.appendChild(st);
      }
      window.__a11yTabSnapshots = {};
      const all = document.querySelectorAll(
        'a, area, button, input, select, textarea, summary, iframe, audio, video, [tabindex], [contenteditable]'
      );
      let i = 0;
      for (const el of all) {
        // Structural focusability, NOT __isFocusableRendered: a skip link parked
        // off-canvas (translateY(-100%)) or a reveal-on-scroll CTA is invisible
        // while unfocused but is still reached by Tab. Skipping them here left
        // them without an unfocused baseline, and a baseline-less step can only
        // ever be judged by its outline — the box-shadow ring that the common
        // "focus-visible:outline-none focus-visible:ring-2" skip link relies on
        // was invisible to the detector. Whether an element is painted is decided
        // per step (step.rendered), at the moment focus is actually on it.
        if (!__isFocusable(el)) {
          el.removeAttribute(ATTR);
          continue;
        }
        const id = String(i++);
        el.setAttribute(ATTR, id);
        window.__a11yTabSnapshots[id] = __a11ySnapshot(el);
      }
      return i;
    },
    helperCode,
    TAB_ATTR
  );
}

/** Remove the markers again (call when the page is shared with other scanners). */
async function cleanupTabWalk(page) {
  await disableFocusEmulation(page);
  await page
    .evaluate((ATTR) => {
      for (const el of document.querySelectorAll('[' + ATTR + ']')) el.removeAttribute(ATTR);
      const st = document.getElementById('__a11y-no-smooth');
      if (st) st.remove();
      delete window.__a11yTabSnapshots;
    }, TAB_ATTR)
    .catch(() => {});
}

/**
 * @param {import('puppeteer').Page} page
 * @param {{maxSteps?: number, settleMs?: number, confirmMs?: number, prepare?: boolean}} opts
 */
async function* tabWalk(page, opts = {}) {
  const maxSteps = opts.maxSteps || 60;
  const settleMs = opts.settleMs ?? 80;
  const confirmMs = opts.confirmMs ?? 150;
  if (opts.prepare !== false) await prepareTabWalk(page);

  await page.evaluate(() => {
    document.body.focus();
    window.scrollTo(0, 0);
  });
  const seen = new Set();
  let prevId = null;
  let yielded = 0;
  let entryRetries = 0;

  for (let step = 0; step < maxSteps; step++) {
    await page.keyboard.press('Tab');
    if (settleMs) await new Promise((r) => setTimeout(r, settleMs));

    const info = await page.evaluate(
      (helpers, ATTR) => {
        eval(helpers);
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;
        let id = el.getAttribute(ATTR);
        if (id === null) {
          // Reached something we did not stamp (revealed dynamically) — stamp it now.
          id = 'dyn-' + Object.keys(window.__a11yTabSnapshots || {}).length;
          el.setAttribute(ATTR, id);
          (window.__a11yTabSnapshots = window.__a11yTabSnapshots || {})[id] = null;
        }
        const before = window.__a11yTabSnapshots[id];
        const after = __a11ySnapshot(el);
        const r = el.getBoundingClientRect();
        return {
          tabId: id,
          tag: el.tagName.toLowerCase(),
          selector: __a11ySelector(el),
          text: (el.textContent || el.value || el.getAttribute('aria-label') || '')
            .trim()
            .slice(0, 60),
          rect: {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            top: r.top,
            left: r.left,
            right: r.right,
            bottom: r.bottom,
          },
          rendered: __isRendered(el),
          // A measurement taken while the document does not have focus is
          // worthless: activeElement is set but :focus does not match, so every
          // :focus-visible style is missing from the computed style.
          focusValid: document.hasFocus() && el.matches(':focus'),
          before: before || after,
          after,
          indicator: __a11yIndicator(el, before || after, after, !!before),
          scrollY: window.scrollY,
          scrollX: window.scrollX,
        };
      },
      helperCode,
      TAB_ATTR
    );

    if (!info) {
      // Focus on <body> AFTER at least one stop means the walk left the
      // document (end of tab order). At step 0 it means focus has not
      // ENTERED the document yet (`document.hasFocus() === false` on a
      // background tab / remote page): the first Tab landed on body and a
      // caller would conclude "0 elements in tab order" for a page with
      // dozens of focusable controls. Re-assert focus and try again.
      if (yielded === 0 && entryRetries < 3) {
        entryRetries++;
        await page.bringToFront().catch(() => {});
        await enableFocusEmulation(page).catch(() => {});
        await page
          .evaluate(() => {
            window.focus();
            document.body.focus();
          })
          .catch(() => {});
        step--;
        continue;
      }
      return;
    }
    yielded++;

    // "No focus indicator at all" is the one verdict that is made from the
    // ABSENCE of evidence, and it was the single remaining source of flaky
    // `missing-focus-indicator` findings on pages that do have a ring: one
    // sample, taken `settleMs` after the key event, decided it. Re-measure
    // such a candidate deliberately — read the focused style again a moment
    // later, blur the element to obtain a REAL unfocused baseline, then put
    // focus back so the walk continues where it was. Only a step whose
    // indicator says `confirmed` may be reported as missing.
    const isStuck = info.tabId === prevId; // Tab did not move focus
    if (!isStuck && info.rendered && info.focusValid === false) {
      // The tab lost document focus (another tab was brought to front). Take
      // it back and leave the verdict open rather than reporting the missing
      // :focus-visible styling as a defect of the page.
      await page.bringToFront().catch(() => {});
      await enableFocusEmulation(page);
      info.indicator = { ...info.indicator, confirmed: false, focusInvalid: true };
    } else if (
      !isStuck &&
      info.rendered &&
      !info.indicator.visible &&
      !info.indicator.lowContrast
    ) {
      await new Promise((r) => setTimeout(r, confirmMs));
      const confirmed = await page
        .evaluate(
          (helpers, ATTR, id) => {
            eval(helpers);
            const el = document.querySelector('[' + ATTR + '="' + id + '"]');
            if (!el || el !== document.activeElement) return null;
            const after = __a11ySnapshot(el);
            el.blur();
            const before = __a11ySnapshot(el);
            try {
              el.focus({ preventScroll: true });
            } catch (e) {
              try {
                el.focus();
              } catch (e2) {
                /* gone */
              }
            }
            return { before, after, indicator: __a11yIndicator(el, before, after, true) };
          },
          helperCode,
          TAB_ATTR,
          info.tabId
        )
        .catch(() => null);

      if (confirmed) {
        info.before = confirmed.before;
        info.after = confirmed.after;
        info.indicator = { ...confirmed.indicator, confirmed: true };
      } else {
        // Focus moved on its own (page script) or the element vanished — the
        // measurement cannot be repeated, so it stays an unknown, not a defect.
        info.indicator = { ...info.indicator, confirmed: false };
      }
    } else {
      info.indicator = { ...info.indicator, confirmed: true };
    }

    if (isStuck) {
      yield { ...info, step, stuck: true };
      return;
    }
    if (seen.has(info.tabId)) return; // cycled back to an earlier element
    seen.add(info.tabId);
    prevId = info.tabId;
    yield { ...info, step, stuck: false };
  }
}

/** Convenience: run the whole walk and return the steps as an array. */
async function collectTabWalk(page, opts) {
  const out = [];
  for await (const s of tabWalk(page, opts)) out.push(s);
  return out;
}

module.exports = {
  tabWalk,
  collectTabWalk,
  prepareTabWalk,
  cleanupTabWalk,
  enableFocusEmulation,
  disableFocusEmulation,
  helperCode,
  TAB_ATTR,
  TRACKED_PROPS,
};
