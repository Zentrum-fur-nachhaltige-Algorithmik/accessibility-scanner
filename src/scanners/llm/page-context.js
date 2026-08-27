/**
 * llm-page-context — the shared, compressed, chunked "page context pack" that
 * replaces the blind `outerHTML.slice(0, 12000)` truncation the LLM scanners
 * used to do individually.
 *
 * Three things it buys us:
 *
 * 1. COVERAGE — the old path fed each scanner the first 12k characters of
 *    `document.body`, so anything past that (and everything in `<head>`, e.g.
 *    `<meta http-equiv="refresh">`) was simply invisible. The pack compresses
 *    the DOM ~5-20x by dropping CSS/boilerplate and off-whitelist attributes
 *    while keeping ALL visible text, then chunks whatever is left over.
 *
 * 2. CACHEABILITY — the pack is memoized per Puppeteer Page, so every LLM
 *    scanner running against the same page sends BYTE-IDENTICAL context. That
 *    identical prefix is what the provider's implicit prompt cache keys on.
 *
 * 3. DETERMINISM — no scanner-specific knobs. Scanner-specific data belongs in
 *    the instructions half of the message, which is appended AFTER the pack.
 */

'use strict';

const DEFAULT_OPTIONS = {
  maxCharsPerChunk: 45000,
  overlapChars: 1500,
  maxChunks: 4,
};

const OVERLAP_MARKER = '<!-- …overlap from previous part… -->';

/**
 * Memo: Page instance -> { key, pack }. WeakMap so closed pages are collectable.
 * `key` folds in the page's current URL, so a re-navigated page rebuilds.
 */
let pageCache = new WeakMap();

/**
 * Build the shared, compressed page context pack. MEMOIZED per Puppeteer Page
 * instance (module-level WeakMap keyed by the page object, plus the page's
 * current URL so a re-navigated page rebuilds) so that every LLM scanner
 * running against the same page sends BYTE-IDENTICAL context — that identical
 * prefix is what makes the provider's implicit prompt cache hit.
 *
 * @param {import('puppeteer').Page} page
 * @param {Object} [options]
 * @param {number} [options.maxCharsPerChunk=45000]
 * @param {number} [options.overlapChars=1500]
 * @param {number} [options.maxChunks=4]
 * @returns {Promise<PageContextPack>}
 */
async function getPageContextPack(page, options = {}) {
  const opts = {
    maxCharsPerChunk: options.maxCharsPerChunk ?? DEFAULT_OPTIONS.maxCharsPerChunk,
    overlapChars: options.overlapChars ?? DEFAULT_OPTIONS.overlapChars,
    maxChunks: options.maxChunks ?? DEFAULT_OPTIONS.maxChunks,
  };

  let url = '';
  try {
    url = typeof page.url === 'function' ? page.url() : '';
  } catch {
    url = '';
  }
  const key = `${url}|${opts.maxCharsPerChunk}|${opts.overlapChars}|${opts.maxChunks}`;

  const hit = pageCache.get(page);
  if (hit && hit.key === key) return hit.pack;

  const extracted = await page.evaluate(_extractInPage, {
    maxCharsPerChunk: opts.maxCharsPerChunk,
  });

  const pack = _assemblePack(extracted, opts);
  pageCache.set(page, { key, pack });
  return pack;
}

/** Test seam: clear the memo (used by unit tests). */
function _clearPageContextCache() {
  pageCache = new WeakMap();
}

// -- pack assembly (Node side) ------------------------------------------------

/**
 * Pack the per-top-level-element segments into chunks, add overlap, and wrap
 * each chunk in the exact shared block shape.
 *
 * @param {{headDigest: string, outline: string[], segments: string[], rawChars: number, skeletonChars: number}} extracted
 * @param {{maxCharsPerChunk: number, overlapChars: number, maxChunks: number}} opts
 * @returns {PageContextPack}
 */
function _assemblePack(extracted, opts) {
  const { headDigest, outline, segments, rawChars, skeletonChars } = extracted;

  // Greedy packing at segment boundaries — a segment is one top-level element
  // of the skeleton (or, for over-budget elements, a legal sub-slice of one).
  const groups = [];
  let current = [];
  let currentLen = 0;
  for (const seg of segments) {
    if (current.length > 0 && currentLen + seg.length > opts.maxCharsPerChunk) {
      groups.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(seg);
    currentLen += seg.length;
  }
  if (current.length > 0) groups.push(current);
  if (groups.length === 0) groups.push(['']);

  const truncated = groups.length > opts.maxChunks;
  const kept = truncated ? groups.slice(0, opts.maxChunks) : groups;

  // Payloads: chunk i > 0 is prefixed with the tail of chunk i-1 so a violation
  // straddling a boundary stays readable in at least one chunk.
  const payloads = [];
  let analyzedChars = 0;
  for (let i = 0; i < kept.length; i++) {
    const own = kept[i].join('');
    analyzedChars += own.length;
    if (i === 0) {
      payloads.push(own);
    } else {
      const prev = payloads[i - 1];
      const tail =
        opts.overlapChars > 0 ? prev.slice(Math.max(0, prev.length - opts.overlapChars)) : '';
      payloads.push(tail ? `${tail}\n${OVERLAP_MARKER}\n${own}` : own);
    }
  }

  const outlineText = outline.length > 0 ? outline.join('\n') : '(no headings or landmarks)';
  const n = payloads.length;
  const chunks = payloads.map(
    (payload, i) =>
      `=== PAGE CONTEXT (part ${i + 1} of ${n}) ===\n` +
      `${headDigest}\n` +
      `\n--- DOCUMENT OUTLINE ---\n` +
      `${outlineText}\n` +
      `\n--- PAGE CONTENT ---\n` +
      `${payload}\n` +
      `=== END PAGE CONTEXT ===`
  );

  const analyzedFraction = skeletonChars > 0 ? Math.min(1, analyzedChars / skeletonChars) : 0;

  return {
    chunks,
    chunkCount: chunks.length,
    rawChars,
    skeletonChars,
    analyzedChars,
    analyzedFraction,
    compressionRatio: rawChars > 0 ? skeletonChars / rawChars : 0,
    truncated,
  };
}

// -- DOM compression (runs inside page.evaluate) ------------------------------

/**
 * Serialized into the page by `page.evaluate`. MUST be self-contained (no
 * closures over module scope, no external libs).
 *
 * @param {{maxCharsPerChunk: number}} cfg
 * @returns {{headDigest: string, outline: string[], segments: string[], rawChars: number, skeletonChars: number}}
 */
/* istanbul ignore next — executed in the browser context */
function _extractInPage(cfg) {
  const BUDGET = cfg.maxCharsPerChunk;

  const VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  // Dropped entirely: they carry no accessibility-relevant text and are the
  // single biggest source of raw-HTML bloat.
  const DROP_TAGS = new Set(['style', 'link', 'noscript']);

  // Whitelist, emitted in this exact order for byte-stability across scanners.
  const ATTR_ORDER = [
    'id',
    'class',
    'role',
    'lang',
    'dir',
    'alt',
    'title',
    'href',
    'src',
    'srcset',
    'type',
    'name',
    'value',
    'placeholder',
    'for',
    'autocomplete',
    'required',
    'disabled',
    'readonly',
    'checked',
    'selected',
    'multiple',
    'pattern',
    'min',
    'max',
    'step',
    'minlength',
    'maxlength',
    'tabindex',
    'contenteditable',
    'hidden',
    'draggable',
    'target',
    'rel',
    'action',
    'method',
    'novalidate',
    'controls',
    'autoplay',
    'muted',
    'loop',
    'kind',
    'srclang',
    'label',
    'open',
    'datetime',
    'colspan',
    'rowspan',
    'headers',
    'scope',
    'width',
    'height',
  ];

  const STYLE_PROP_RE =
    /^(position|display|visibility|color|background|background-color|outline|outline-color|outline-width|text-align|font-size|line-height|width|height|overflow|animation|transition)/;

  const LANDMARK_TAGS = {
    header: true,
    nav: true,
    main: true,
    aside: true,
    footer: true,
    section: true,
    form: true,
    search: true,
  };
  const LANDMARK_ROLES = new Set([
    'banner',
    'navigation',
    'main',
    'complementary',
    'contentinfo',
    'region',
    'search',
    'form',
  ]);

  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function shortenValue(name, rawValue) {
    let v = String(rawValue);

    if (/^data:/i.test(v) && (name === 'src' || name === 'href' || name === 'srcset')) {
      const m = v.match(/^data:([^;,]*)/i);
      return 'data:' + (m && m[1] ? m[1] : '') + ',…(' + v.length + ' bytes)';
    }

    if (name === 'class') {
      const tokens = v.split(/\s+/).filter(Boolean);
      return tokens.slice(0, 4).join(' ') + (tokens.length > 4 ? '…' : '');
    }

    if (name.indexOf('on') === 0) {
      return v.length > 200 ? v.slice(0, 200) + '…' : v;
    }

    return v.length > 300 ? v.slice(0, 300) + '…' : v;
  }

  function filterStyle(rawValue) {
    const kept = [];
    for (const decl of String(rawValue).split(';')) {
      const idx = decl.indexOf(':');
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      if (!prop || !STYLE_PROP_RE.test(prop)) continue;
      kept.push(prop + ':' + decl.slice(idx + 1).trim());
    }
    return kept.join(';');
  }

  function keptAttrs(el) {
    const out = [];
    const seen = new Set();

    for (const name of ATTR_ORDER) {
      if (!el.hasAttribute(name)) continue;
      out.push([name, shortenValue(name, el.getAttribute(name))]);
      seen.add(name);
    }
    for (const a of el.attributes) {
      const n = a.name.toLowerCase();
      if (seen.has(n) || n.indexOf('aria-') !== 0) continue;
      out.push([n, shortenValue(n, a.value)]);
      seen.add(n);
    }
    if (el.hasAttribute('data-testid') && !seen.has('data-testid')) {
      out.push(['data-testid', shortenValue('data-testid', el.getAttribute('data-testid'))]);
      seen.add('data-testid');
    }
    if (el.hasAttribute('style')) {
      const filtered = filterStyle(el.getAttribute('style'));
      if (filtered) out.push(['style', filtered]);
      seen.add('style');
    }
    // Event handlers are primary evidence for the behavioral/timing criteria.
    for (const a of el.attributes) {
      const n = a.name.toLowerCase();
      if (seen.has(n) || n.indexOf('on') !== 0) continue;
      out.push([n, shortenValue(n, a.value)]);
      seen.add(n);
    }
    return out;
  }

  function openTag(el, selfClosing) {
    const tag = el.tagName.toLowerCase();
    let s = '<' + tag;
    for (const pair of keptAttrs(el)) {
      s += pair[1] === '' ? ' ' + pair[0] : ' ' + pair[0] + '="' + escAttr(pair[1]) + '"';
    }
    return s + (selfClosing ? '/>' : '>');
  }

  function hasOwnText(el) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && /\S/.test(child.data)) return true;
    }
    return false;
  }

  /**
   * A <div>/<span> carrying no kept attributes, wrapping exactly one element
   * child and no text of its own, is pure layout scaffolding — emit the child
   * directly. Applied repeatedly (wrapper chains are the norm in built output).
   */
  function unwrap(el) {
    let node = el;
    for (;;) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag !== 'div' && tag !== 'span') return node;
      if (node.children.length !== 1) return node;
      if (hasOwnText(node)) return node;
      if (keptAttrs(node).length > 0) return node;
      node = node.children[0];
    }
  }

  function serializeNode(node) {
    // Text
    if (node.nodeType === 3) {
      const collapsed = node.data.replace(/\s+/g, ' ');
      if (!/\S/.test(collapsed)) return '';
      return escText(collapsed);
    }
    // Comments / CDATA / anything non-element
    if (node.nodeType !== 1) return '';

    const el = unwrap(node);
    if (el !== node) return serializeNode(el);

    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) return '';

    if (tag === 'template') {
      // Contents live in a DocumentFragment and are inert — keep the marker only.
      return openTag(el) + '</template>';
    }

    if (tag === 'script') {
      if (el.hasAttribute('src')) return openTag(el, true);
      const body = el.textContent || '';
      const kept = body.slice(0, 800);
      return openTag(el) + kept + (body.length > 800 ? '/*…truncated…*/' : '') + '</script>';
    }

    if (tag === 'svg') {
      // Children are path data — worthless to an auditor — but <title>/<desc>
      // are the accessible name/description and must survive.
      let inner = '';
      for (const t of el.querySelectorAll('title, desc')) {
        const txt = (t.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt)
          inner +=
            '<' +
            t.tagName.toLowerCase() +
            '>' +
            escText(txt) +
            '</' +
            t.tagName.toLowerCase() +
            '>';
      }
      return openTag(el) + inner + '</svg>';
    }

    if (tag === 'canvas') return openTag(el) + '</canvas>';

    if (VOID_TAGS.has(tag)) return openTag(el);

    let out = openTag(el);
    for (const child of el.childNodes) out += serializeNode(child);
    return out + '</' + tag + '>';
  }

  /**
   * Serialize `node` into one or more segments, each <= budget where possible.
   * Concatenating the returned segments reproduces serializeNode(node) exactly,
   * so splitting never changes the skeleton — only where the chunker may cut.
   */
  function segmentize(node, budget) {
    const serialized = serializeNode(node);
    if (serialized === '') return [];
    if (serialized.length <= budget || node.nodeType !== 1) return [serialized];

    const el = unwrap(node);
    const tag = el.tagName.toLowerCase();
    const indivisible =
      VOID_TAGS.has(tag) ||
      tag === 'script' ||
      tag === 'svg' ||
      tag === 'canvas' ||
      tag === 'template' ||
      el.childNodes.length === 0;
    if (indivisible) return [serialized];

    const parts = [openTag(el)];
    for (const child of el.childNodes) {
      for (const part of segmentize(child, budget)) parts.push(part);
    }
    parts.push('</' + tag + '>');
    return parts;
  }

  // -- head digest ------------------------------------------------------------

  function cap(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  const headLines = ['--- HEAD ---'];
  const docEl = document.documentElement;
  const htmlAttrs = [];
  if (docEl.getAttribute('lang'))
    htmlAttrs.push('lang="' + escAttr(docEl.getAttribute('lang')) + '"');
  if (docEl.getAttribute('dir')) htmlAttrs.push('dir="' + escAttr(docEl.getAttribute('dir')) + '"');
  headLines.push('<html' + (htmlAttrs.length ? ' ' + htmlAttrs.join(' ') : '') + '>');

  const titleEl = document.querySelector('title');
  if (titleEl) {
    headLines.push(
      '<title>' + escText((titleEl.textContent || '').replace(/\s+/g, ' ').trim()) + '</title>'
    );
  }

  // VERBATIM — load-bearing evidence for 2.2.3 / 3.2.5, and invisible to the
  // old body-only extraction.
  for (const m of document.querySelectorAll('meta[http-equiv]')) {
    if ((m.getAttribute('http-equiv') || '').toLowerCase() === 'refresh') {
      headLines.push(m.outerHTML);
    }
  }

  for (const metaName of ['viewport', 'description']) {
    const m = document.querySelector('meta[name="' + metaName + '"]');
    if (m) headLines.push(cap(m.outerHTML, 300));
  }
  const charsetEl = document.querySelector('meta[charset]');
  if (charsetEl) headLines.push(charsetEl.outerHTML);

  const sheets = [];
  for (const l of document.querySelectorAll('link[rel]')) {
    if ((l.getAttribute('rel') || '').toLowerCase().split(/\s+/).indexOf('stylesheet') !== -1) {
      sheets.push(l.getAttribute('href') || '');
    }
  }
  if (sheets.length > 0) {
    headLines.push(
      'stylesheets: ' +
        sheets.length +
        ' [' +
        sheets
          .slice(0, 3)
          .map((h) => cap(h, 200))
          .join(', ') +
        ']'
    );
  }

  // -- outline ----------------------------------------------------------------

  const outline = [];
  const body = document.body;
  if (body) {
    const outlineNodes = body.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, header, nav, main, aside, footer, section, form, search, [role]'
    );
    for (const el of outlineNodes) {
      if (outline.length >= 200) break;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        outline.push(tag + ': ' + text.slice(0, 120));
        continue;
      }
      const explicitRole = (el.getAttribute('role') || '').trim().toLowerCase();
      if (explicitRole) {
        if (LANDMARK_ROLES.has(explicitRole)) outline.push('landmark: ' + explicitRole);
        continue;
      }
      if (LANDMARK_TAGS[tag]) outline.push('landmark: ' + tag);
    }
  }

  // -- skeleton ---------------------------------------------------------------

  const segments = [];
  if (body) {
    segments.push(openTag(body));
    for (const child of body.childNodes) {
      for (const part of segmentize(child, BUDGET)) segments.push(part);
    }
    segments.push('</body>');
  }

  let skeletonChars = 0;
  for (const s of segments) skeletonChars += s.length;

  return {
    headDigest: headLines.join('\n'),
    outline,
    segments,
    rawChars: document.documentElement.outerHTML.length,
    skeletonChars,
  };
}

module.exports = { getPageContextPack, _clearPageContextCache };
