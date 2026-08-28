/**
 * Use of Color Scanner.
 * WCAG 1.4.1 (EN 301 549 9.1.4.1).
 * Reports links inside a block of text whose only difference from the surrounding text is
 * their colour, in the range axe-core's `link-in-text-block` passes: that rule accepts a
 * link whose colour reaches 3:1 against the surrounding text without checking whether the
 * page also adds the non-colour cue on hover and on focus that technique G183 requires.
 */
const BaseScanner = require('../core/base-scanner');
const { injectableCode: contrastUtils } = require('../utils/browser-contrast');
const { injectableCode: renderedUtils } = require('../utils/rendered');

class UseOfColorScanner extends BaseScanner {
  constructor() {
    super('use-of-color', {
      wcagCriteria: ['1.4.1'],
      wcagPrinciple: 'perceivable',
    });
  }

  /**
   * Core scan method. Receives an already-navigated Puppeteer page.
   * @param {import('puppeteer').Page} page - Already-navigated page
   * @param {Object} options - Scanning options
   * @returns {Promise<Object>} ScanResult
   */
  async scan(page, options = {}) {
    const results = await page.evaluate(
      (contrastCode, renderedCode) => {
        eval(contrastCode);
        eval(renderedCode);

        // Distinctions a reader perceives without colour. Everything here is
        // read from computed style, so a class name never decides anything.
        const CUE_PROPERTIES = [
          'text-decoration',
          'text-decoration-line',
          'text-decoration-style',
          'text-decoration-thickness',
          'text-underline-offset',
          'border',
          'border-bottom',
          'border-bottom-width',
          'border-bottom-style',
          'border-width',
          'border-style',
          'outline',
          'outline-width',
          'outline-style',
          'box-shadow',
          'font-weight',
          'font-style',
          'font-family',
          'font-size',
          'background-image',
          'content',
        ];

        const BLOCK_DISPLAYS = [
          'block',
          'flow-root',
          'list-item',
          'flex',
          'grid',
          'table',
          'table-cell',
          'table-caption',
        ];

        function isBlock(element) {
          const display = window.getComputedStyle(element).display;
          return BLOCK_DISPLAYS.includes(display) || display.startsWith('table-');
        }

        function blockAncestor(element) {
          let current = element.parentElement;
          while (current && current.nodeType === 1 && !isBlock(current)) {
            current = current.parentElement;
          }
          return current;
        }

        function describe(element) {
          let selector = element.tagName.toLowerCase();
          if (element.id) return selector + '#' + element.id;
          const raw = typeof element.className === 'string' ? element.className : '';
          const classes = raw.trim().split(/\s+/).filter(Boolean).slice(0, 3);
          if (classes.length) selector += '.' + classes.join('.');
          return selector;
        }

        // Does the link render differently from the text around it in any way
        // other than its colour?
        function hasNonColourCue(link, linkStyles, blockStyles) {
          if (
            linkStyles.textDecorationLine !== 'none' &&
            linkStyles.textDecorationLine !== blockStyles.textDecorationLine
          ) {
            return 'text-decoration';
          }
          if (linkStyles.fontWeight !== blockStyles.fontWeight) return 'font-weight';
          if (linkStyles.fontStyle !== blockStyles.fontStyle) return 'font-style';
          if (linkStyles.fontFamily !== blockStyles.fontFamily) return 'font-family';
          if (linkStyles.fontSize !== blockStyles.fontSize) return 'font-size';
          if (__getRenderedBorder(linkStyles)) return 'border';
          if (
            linkStyles.outlineStyle &&
            linkStyles.outlineStyle !== 'none' &&
            parseFloat(linkStyles.outlineWidth) > 0
          ) {
            return 'outline';
          }
          if (linkStyles.boxShadow && linkStyles.boxShadow !== 'none') return 'box-shadow';
          if (linkStyles.backgroundImage && linkStyles.backgroundImage !== 'none') {
            return 'background-image';
          }
          const ownBg = __parseRgb(linkStyles.backgroundColor);
          if (ownBg && ownBg.a > 0) return 'background-color';
          for (const pseudo of ['::before', '::after']) {
            const ps = window.getComputedStyle(link, pseudo);
            const content = ps.content;
            if (content && content !== 'none' && content !== 'normal' && content !== '""') {
              return 'pseudo-content';
            }
          }
          if (link.querySelector('img, svg, picture, canvas')) return 'image';
          return null;
        }

        // Rules the page declares for the link's hover and focus state. G183
        // accepts a colour-only link when the difference to the surrounding
        // text reaches 3:1 AND a non-colour cue appears on hover and on focus.
        function stateCues(link) {
          const cues = { hover: false, focus: false };
          for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
              rules = Array.from(sheet.cssRules || []);
            } catch (e) {
              continue; // cross-origin sheet
            }
            // Chromium exposes an (empty) `cssRules` on every style rule since
            // CSS nesting, so a grouping rule is recognised by having nested
            // rules, not by having the property.
            const walk = (list) => {
              for (const rule of list) {
                if (rule.cssRules && rule.cssRules.length) walk(Array.from(rule.cssRules));
                if (!rule.selectorText || !rule.style) continue;
                const declaresCue = CUE_PROPERTIES.some((prop) =>
                  rule.style.getPropertyValue(prop)
                );
                if (!declaresCue) continue;
                for (const part of rule.selectorText.split(',')) {
                  const selector = part.trim();
                  const hover = /:hover\b/.test(selector);
                  const focus = /:focus(-visible|-within)?\b/.test(selector);
                  if (!hover && !focus) continue;
                  const base = selector
                    .replace(/:(hover|focus-visible|focus-within|focus|active)\b/g, '')
                    .replace(/::(before|after|marker|first-line|first-letter)\b/g, '')
                    .trim();
                  if (!base) continue;
                  let matches = false;
                  try {
                    matches = link.matches(base);
                  } catch (e) {
                    continue; // selector the engine cannot match against
                  }
                  if (!matches) continue;
                  if (hover) cues.hover = true;
                  if (focus) cues.focus = true;
                }
              }
            };
            walk(rules);
          }
          return cues;
        }

        const groups = new Map();
        let linksInTextBlocks = 0;

        for (const link of document.querySelectorAll('a[href]')) {
          if (!__isRendered(link)) continue;
          const linkStyles = window.getComputedStyle(link);
          if (!linkStyles.display.startsWith('inline')) continue;

          const block = blockAncestor(link);
          if (!block) continue;

          // "Inside a block of text": the block has to carry text of its own
          // beside its links, otherwise the link is the block (a navigation
          // item, a card, a menu entry) and there is no surrounding text it
          // could be confused with.
          let linkTextLength = 0;
          for (const other of block.querySelectorAll('a[href]')) {
            linkTextLength += other.textContent.trim().length;
          }
          if (block.textContent.trim().length - linkTextLength < 15) continue;

          const own = link.textContent.trim();
          if (own.length < 2) continue;

          linksInTextBlocks++;

          const blockStyles = window.getComputedStyle(block);
          if (hasNonColourCue(link, linkStyles, blockStyles)) continue;

          const background = __resolveBackground(block);
          const backdrop = { r: background.r, g: background.g, b: background.b, a: 1 };
          const linkRgb = __parseRgb(linkStyles.color);
          const textRgb = __parseRgb(blockStyles.color);
          if (!linkRgb || !textRgb) continue;
          const ratio = __getContrastRatio(
            __blendOver(linkRgb, backdrop),
            __blendOver(textRgb, backdrop)
          );

          // Below 3:1 the link is not distinguishable from the text at all,
          // which axe-core `link-in-text-block` reports in the same profile.
          if (ratio < 3) continue;

          const cues = stateCues(link);
          if (cues.hover && cues.focus) continue;

          const key = linkStyles.color + '|' + blockStyles.color;
          let group = groups.get(key);
          if (!group) {
            group = {
              linkColor: linkStyles.color,
              textColor: blockStyles.color,
              ratio: Math.round(ratio * 100) / 100,
              missing: [],
              elements: [],
            };
            if (!cues.hover) group.missing.push('hover');
            if (!cues.focus) group.missing.push('focus');
            groups.set(key, group);
          }
          group.elements.push({ selector: describe(link), text: own.slice(0, 60) });
        }

        const violations = [];
        for (const group of groups.values()) {
          const more = group.elements.length > 1 ? ` (and ${group.elements.length - 1} more)` : '';
          violations.push({
            criterion: '9.1.4.1',
            element: group.elements[0].selector,
            issue: 'link-color-only',
            severity: 'moderate',
            description:
              `Link "${group.elements[0].text}"${more} is distinguished from the surrounding text ` +
              `only by its colour (${group.ratio}:1 against the text), and the page declares no ` +
              `non-colour cue on ${group.missing.join(' or ')}.`,
            occurrences: group.elements.length,
            affectedElements: group.elements.slice(0, 25).map((e) => e.selector),
            linkColor: group.linkColor,
            surroundingTextColor: group.textColor,
            contrastWithText: group.ratio,
            suggestion:
              'Underline the link, or add the underline (or another non-colour difference) on hover and on focus.',
          });
        }

        // Second rule: swatches that carry information through their paint
        // alone. A set of same-sized, unnamed, non-interactive boxes that
        // paint different colours (or different background images) beside
        // one another is a colour key with no text equivalent. Everything
        // here is geometry and paint; no class name and no word list.
        const SWATCH_MAX = 32;
        const swatches = new Map();

        function isClipped(element) {
          const rect = element.getBoundingClientRect();
          return rect.width <= 1 || rect.height <= 1;
        }

        // A text equivalent the element itself carries, or the visually
        // hidden label beside it.
        function hasTextEquivalent(element) {
          if (element.textContent.trim()) return true;
          if (
            element.getAttribute('aria-label') ||
            element.getAttribute('aria-labelledby') ||
            element.getAttribute('title') ||
            element.getAttribute('alt')
          ) {
            return true;
          }
          const parent = element.parentElement;
          if (!parent) return false;
          for (const sibling of parent.children) {
            if (sibling === element) continue;
            if (sibling.textContent.trim() && isClipped(sibling)) return true;
          }
          return false;
        }

        for (const element of document.querySelectorAll('body *')) {
          if (!__isRendered(element)) continue;
          if (__isInteractiveTarget(element)) continue;
          if (element.closest('a[href], button, input, select, textarea, [role="button"]')) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;
          if (rect.width > SWATCH_MAX || rect.height > SWATCH_MAX) continue;
          if (element.children.length > 0) continue;
          if (hasTextEquivalent(element)) continue;

          const styles = window.getComputedStyle(element);
          const image = styles.backgroundImage;
          const fill = __parseRgb(styles.backgroundColor);
          const paints = (image && image !== 'none') || (fill && fill.a > 0);
          if (!paints) continue;

          const shape =
            element.tagName +
            '|' +
            Math.round(rect.width) +
            'x' +
            Math.round(rect.height) +
            '|' +
            styles.borderRadius;
          const paint = styles.backgroundColor + '|' + image;
          if (!swatches.has(shape)) swatches.set(shape, new Map());
          const byPaint = swatches.get(shape);
          if (!byPaint.has(paint)) byPaint.set(paint, []);
          byPaint.get(paint).push(element);
        }

        for (const [shape, byPaint] of swatches) {
          if (byPaint.size < 2) continue; // one appearance carries no distinction
          const members = [];
          for (const list of byPaint.values()) members.push(...list);
          if (members.length < 2) continue;
          violations.push({
            criterion: '9.1.4.1',
            element: describe(members[0]),
            issue: 'color-coded-indicator',
            severity: 'moderate',
            description:
              `${members.length} identically sized indicators (${shape.split('|')[1]}) carry no ` +
              `text, no accessible name and no hidden label, and differ from each other only in ` +
              `what they paint (${byPaint.size} appearances).`,
            occurrences: members.length,
            affectedElements: members.slice(0, 25).map((e) => describe(e)),
            appearances: [...byPaint.keys()].slice(0, 5),
            suggestion:
              'Add a text label, a visually hidden name or a distinct shape to each indicator.',
          });
        }

        return { violations, linksInTextBlocks };
      },
      contrastUtils,
      renderedUtils
    );

    return {
      scannerId: this.id,
      criterion: '9.1.4.1',
      passed: results.violations.length === 0,
      violations: results.violations,
      summary: {
        linksInTextBlocks: results.linksInTextBlocks,
        colorOnlyLinkGroups: results.violations.length,
      },
    };
  }
}

module.exports = UseOfColorScanner;
