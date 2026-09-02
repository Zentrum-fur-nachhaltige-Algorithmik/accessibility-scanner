/**
 * Browser-injectable stylesheet reader.
 * Exposes __readStyleSheets(), which returns every stylesheet of the document
 * as a readable CSSStyleSheet plus the hrefs of the ones that stayed opaque.
 *
 * `sheet.cssRules` throws a SecurityError on a stylesheet served from another
 * origin, and a rule that catches the throw and moves on sees a page with no
 * CSS at all: every hover cue, every orientation media query and every state
 * colour of a site whose CSS sits on a CDN becomes invisible. The text of such
 * a sheet is still fetchable when its server allows the read, so it is fetched
 * from the page and parsed into a constructed sheet. A sheet that cannot be
 * fetched either is named in `unreadable`, so the scanner can say what it
 * could not see instead of reporting a page it never measured.
 */

const injectableCode = `
  let __styleSheetCache = null;

  async function __readStyleSheets() {
    if (__styleSheetCache) return __styleSheetCache;
    const sheets = [];
    const unreadable = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        // Touching cssRules is what throws on an opaque sheet.
        if (sheet.cssRules) {
          sheets.push(sheet);
          continue;
        }
        sheets.push(sheet);
        continue;
      } catch (e) {
        /* cross-origin: fetch the source below */
      }
      const href = sheet.href;
      if (!href) {
        unreadable.push('inline stylesheet');
        continue;
      }
      let text = null;
      try {
        const response = await fetch(href, { credentials: 'omit' });
        if (response.ok) text = await response.text();
      } catch (e) {
        text = null;
      }
      if (text === null) {
        unreadable.push(href);
        continue;
      }
      try {
        const constructed = new CSSStyleSheet({ baseURL: href });
        constructed.replaceSync(text);
        sheets.push(constructed);
      } catch (e) {
        unreadable.push(href);
      }
    }
    __styleSheetCache = { sheets: sheets, unreadable: unreadable };
    return __styleSheetCache;
  }

`;

module.exports = { injectableCode };
