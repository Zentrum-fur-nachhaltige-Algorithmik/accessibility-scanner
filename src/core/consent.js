/**
 * consent
 * Cookie/consent overlay pre-step. A scan run against a page that is covered
 * by a consent dialog measures the dialog, not the page: the overlay traps
 * focus, hides the content from the accessibility tree and paints its own
 * colours over everything. So the pipeline dismisses it once, before any
 * scanner looks at the page, and records what it saw.
 *
 * It only detects, records and dismisses. Scanning the overlay as a page state
 * of its own belongs to the state-scans work, not here.
 */

// Wording heuristics lifted from the screen-reader agent branch
// (src/agent/generic-tasks.js), English and German, matched case-insensitively.
const CONTAINER_PATTERN = 'cookie|consent|gdpr|dsgvo|datenschutz-?banner|cmp';
const ACCEPT_PATTERN =
  'akzeptieren|accept|zustimmen|alle .*(erlauben|akzeptieren)|agree|allow all|ok';

/**
 * Find the consent overlay and its accept control.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{containerSelector: string, buttonSelector: string, buttonLabel: string}|null>}
 */
async function detectConsent(page) {
  return page.evaluate(
    (containerPattern, acceptPattern) => {
      const containerRx = new RegExp(containerPattern, 'i');
      const acceptRx = new RegExp(acceptPattern, 'i');

      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      /** Stable-enough selector: an id when there is one, else an nth-child path. */
      function selectorFor(el) {
        if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
          return `#${CSS.escape(el.id)}`;
        }
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && node !== document.documentElement) {
          const parent = node.parentElement;
          if (!parent) break;
          const index = Array.prototype.indexOf.call(parent.children, node) + 1;
          parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
          node = parent;
        }
        return parts.length ? `html > ${parts.join(' > ')}` : 'html';
      }

      function label(el) {
        return (
          el.getAttribute('aria-label') ||
          (el.textContent || '').replace(/\s+/g, ' ').trim() ||
          el.value ||
          ''
        );
      }

      /** A consent overlay sits above the page: fixed/sticky, or a dialog. */
      function isOverlay(el) {
        const role = el.getAttribute('role');
        if (el.tagName === 'DIALOG' || role === 'dialog' || role === 'alertdialog') return true;
        const position = getComputedStyle(el).position;
        return position === 'fixed' || position === 'sticky';
      }

      const candidates = Array.from(
        document.querySelectorAll('[id], [class], [aria-label], [role], dialog')
      ).filter((el) => {
        if (!isVisible(el) || !isOverlay(el)) return false;
        const className = typeof el.className === 'string' ? el.className : '';
        const hay = `${el.id} ${className} ${el.getAttribute('aria-label') || ''}`;
        return containerRx.test(hay);
      });

      // Innermost first: the banner itself carries the accept button, its
      // wrapper only contains it.
      candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);

      for (const container of candidates) {
        const button = Array.from(
          container.querySelectorAll(
            'button, a, input[type="button"], input[type="submit"], [role="button"]'
          )
        )
          .filter(isVisible)
          .find((el) => acceptRx.test(label(el)));
        if (button) {
          return {
            containerSelector: selectorFor(container),
            buttonSelector: selectorFor(button),
            buttonLabel: label(button).slice(0, 120),
          };
        }
      }

      return null;
    },
    CONTAINER_PATTERN,
    ACCEPT_PATTERN
  );
}

/**
 * Detect a consent overlay, accept it, and wait for it to disappear.
 *
 * Never throws: a page that cannot be evaluated, or a banner that refuses to
 * close, is reported, not a scan failure.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{detected: boolean, dismissed: boolean, containerSelector?: string, buttonLabel?: string}>}
 */
async function dismissConsent(page) {
  let found = null;
  try {
    found = await detectConsent(page);
  } catch {
    return { detected: false, dismissed: false };
  }
  if (!found) return { detected: false, dismissed: false };

  const result = {
    detected: true,
    dismissed: false,
    containerSelector: found.containerSelector,
    buttonLabel: found.buttonLabel,
  };

  try {
    await page.click(found.buttonSelector);
    await page.waitForFunction(
      (selector) => {
        const el = document.querySelector(selector);
        if (!el) return true;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        const rect = el.getBoundingClientRect();
        return rect.width === 0 || rect.height === 0;
      },
      { timeout: 3000 },
      found.containerSelector
    );
    result.dismissed = true;
  } catch {
    // Clicked and the banner stayed, or the click never landed: recorded as
    // detected but not dismissed, and the scan goes ahead either way.
  }

  return result;
}

module.exports = { detectConsent, dismissConsent, CONTAINER_PATTERN, ACCEPT_PATTERN };
