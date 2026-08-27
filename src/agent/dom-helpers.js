/**
 * dom-helpers: the single in-page DOM helper set (`window.__A11YH`).
 * Selector, visibility, text and accessible-name helpers shared by every module that
 * observes or replays a page, so recorded selectors replay verbatim. Installed via
 * `page.evaluate(<string>)`, which is exempt from the page's Content-Security-Policy.
 */

'use strict';

/** Source of the helper bundle. Runs in the page, installs `window.__A11YH`. */
const HELPERS_SRC = `(function () {
  if (window.__A11YH && window.__A11YH.version === 1) return 'present';

  function esc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\\w-]/g, '\\\\$&');
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return false;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    var style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity || '1') === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function text(el) {
    return ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
  }

  /**
   * True for ids generated per render and therefore useless as a selector on a
   * later page load: "search-main-0a5acb20", ":r3:", "ember1234", "radix-:r1:".
   * Such ids fall through to the structural path.
   */
  function isGeneratedId(id) {
    if (!id) return true;
    if (/^(:|r[0-9])/.test(id)) return true;
    if (/(^|[-_:])([0-9a-f]{8,}|[0-9]{5,})([-_:]|$)/i.test(id)) return true;
    return /^(ember|react|radix|mui|headlessui|downshift|aria)[-_:]?[0-9]/i.test(id);
  }

  /** Shortest reasonably stable unique selector: id, data-testid, nth-of-type path. */
  function selectorFor(node) {
    var el = node;
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (!el || el.nodeType !== 1) return null;
    if (el.id && !isGeneratedId(el.id) && document.querySelectorAll('#' + esc(el.id)).length === 1) {
      return '#' + esc(el.id);
    }
    var testid = el.getAttribute && el.getAttribute('data-testid');
    if (testid && document.querySelectorAll('[data-testid="' + testid + '"]').length === 1) {
      return '[data-testid="' + testid + '"]';
    }
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      if (
        cur.id &&
        !isGeneratedId(cur.id) &&
        document.querySelectorAll('#' + esc(cur.id)).length === 1
      ) {
        parts.unshift('#' + esc(cur.id));
        cur = null;
        break;
      }
      var parent = cur.parentElement;
      if (parent) {
        var sameTag = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === cur.tagName;
        });
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    var sel = parts.join(' > ');
    if (!sel) return null;
    try {
      return document.querySelectorAll(sel).length >= 1 ? sel : null;
    } catch (e) {
      return null;
    }
  }

  /** Cheap accessible name: aria-label, aria-labelledby, label, text, title/alt/value. */
  function accName(el) {
    if (!el || el.nodeType !== 1) return '';
    var aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.replace(/\\s+/g, ' ').trim();
    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var parts = labelledby.split(/\\s+/).map(function (id) {
        var t = document.getElementById(id);
        return t ? text(t) : '';
      });
      var joined = parts.filter(Boolean).join(' ').trim();
      if (joined) return joined;
    }
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (el.id) {
        var lab = document.querySelector('label[for="' + esc(el.id) + '"]');
        if (lab && text(lab)) return text(lab);
      }
      var wrap = el.closest && el.closest('label');
      if (wrap && text(wrap)) return text(wrap);
      if (el.placeholder) return el.placeholder.trim();
      if (el.type === 'submit' || el.type === 'button') return (el.value || '').trim();
    }
    if (tag === 'img') return (el.getAttribute('alt') || '').trim();
    var own = text(el);
    if (own) return own.slice(0, 120);
    var titled = el.getAttribute('title');
    if (titled) return titled.trim();
    var img = el.querySelector && el.querySelector('img[alt]');
    if (img) return (img.getAttribute('alt') || '').trim();
    return '';
  }

  var IMPLICIT = {
    a: 'link', button: 'button', select: 'combobox', textarea: 'textbox',
    summary: 'button', h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading', nav: 'navigation',
    main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
    form: 'form', dialog: 'dialog', table: 'table', img: 'img'
  };
  var INPUT_ROLES = {
    checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
    reset: 'button', search: 'searchbox', range: 'slider', number: 'spinbutton',
    file: 'button', email: 'textbox', tel: 'textbox', url: 'textbox',
    password: 'textbox', text: 'textbox'
  };

  function roleOf(el) {
    if (!el || el.nodeType !== 1) return null;
    var explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\\s+/)[0];
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'input') return INPUT_ROLES[(el.type || 'text').toLowerCase()] || 'textbox';
    return IMPLICIT[tag] || 'generic';
  }

  /** Landmark/region label of the nearest enclosing landmark, for orientation. */
  function regionOf(el) {
    var LM = 'header,footer,nav,main,aside,form,[role=banner],[role=contentinfo],' +
      '[role=navigation],[role=main],[role=complementary],[role=search],[role=form],[role=region]';
    var cur = el && el.parentElement;
    while (cur && cur.nodeType === 1) {
      if (cur.matches && cur.matches(LM)) {
        var label = cur.getAttribute('aria-label') || '';
        if (!label) {
          var lb = cur.getAttribute('aria-labelledby');
          if (lb) {
            var t = document.getElementById(lb.split(/\\s+/)[0]);
            label = t ? text(t) : '';
          }
        }
        var role = roleOf(cur);
        return label ? role + ' "' + label + '"' : role;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  window.__A11YH = {
    version: 1,
    esc: esc, isVisible: isVisible, text: text, selectorFor: selectorFor,
    accName: accName, roleOf: roleOf, regionOf: regionOf, isGeneratedId: isGeneratedId
  };
  return 'installed';
})()`;

/**
 * Make sure `window.__A11YH` exists in the page's current document. Idempotent
 * and cheap; call it before any `page.evaluate` that uses the helpers. Also
 * registers the bundle for every future document of that page, so it survives
 * navigations the agent triggers.
 *
 * @param {import('puppeteer').Page} page
 */
async function ensureHelpers(page) {
  if (!page.__a11yHelpersOnNewDocument && typeof page.evaluateOnNewDocument === 'function') {
    // Page.addScriptToEvaluateOnNewDocument is a DevTools injection and is not
    // subject to the page CSP either.
    await page.evaluateOnNewDocument(HELPERS_SRC).catch(() => {});
    try {
      Object.defineProperty(page, '__a11yHelpersOnNewDocument', {
        value: true,
        enumerable: false,
        configurable: true,
      });
    } catch (_) {
      /* frozen page object in a test double; the evaluate below still works */
    }
  }
  // String form goes through Runtime.evaluate, which is exempt from the page CSP.
  await page.evaluate(HELPERS_SRC);
}

module.exports = { HELPERS_SRC, ensureHelpers };
