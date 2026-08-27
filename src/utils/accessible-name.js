/**
 * Browser-injectable accessible-name utility.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several scanners used to compute an element's "name" ad hoc — almost always
 * `element.textContent.trim()`, sometimes plus `aria-label`/`title`. That model
 * of the accessibility API is incomplete, and it produced a whole family of
 * false positives on real pages: a logo link whose only child is
 * `<img alt="Logo">`, a heading named by a child image, a link named through
 * `aria-labelledby`, an `<svg role="img"><title>` icon button, an
 * `<input type="image" alt="Search">`. A screen reader announces all of those;
 * `textContent` returns "".
 *
 * This module implements a pragmatic subset of ACCNAME
 * (https://w3c.github.io/accname/) as a string of browser-context functions,
 * exactly like `src/utils/browser-contrast.js`: `require` it in Node, pass the
 * string into `page.evaluate`, `eval()` it there.
 *
 *     const { injectableCode: accnameUtils } = require('./utils/accessible-name');
 *     ...
 *     await page.evaluate((accnameCode) => {
 *       eval(accnameCode);
 *       const { name, source } = __accessibleNameInfo(el);
 *     }, accnameUtils);
 *
 * PRECEDENCE (highest first)
 *   1. aria-labelledby   — ID list, each reference resolved to its own name
 *   2. aria-label
 *   3. native labelling  — label[for] / wrapping <label>, <caption>, <legend>,
 *                          <figcaption>, alt on img|area|input[type=image],
 *                          <svg><title>, value on input[type=button|submit|reset]
 *   4. name from content — the subtree's text, which INCLUDES a child
 *                          `<img alt>`, a descendant's `aria-label`, and an
 *                          `<svg><title>`; only for roles that take their name
 *                          from content (link, button, heading, cell, …)
 *   5. title
 *
 * Every result carries the `source` it came from, so a scanner can report WHY
 * an element is unnamed instead of just that it is. When the name is empty,
 * `reason` names the mechanism that was present but produced nothing.
 *
 * DELIBERATE DEVIATIONS FROM THE SPEC (all documented, all conservative):
 *   - `placeholder` is NOT accepted as a name. The spec's HTML-AAM does allow
 *     it as a last resort for text inputs; treating a placeholder-only field as
 *     named would silence a check the corpus shows is a TRUE positive.
 *   - Hidden-subtree pruning only looks at `aria-hidden="true"` and the `hidden`
 *     attribute; it does NOT call `getComputedStyle` on every descendant. That
 *     would be O(nodes) per named element and this runs on 5000-node pages.
 *     The consequence — CSS-hidden text can still contribute — only ever makes
 *     an element look MORE named, i.e. it errs away from false positives.
 *   - Embedded form controls contribute nothing to a name computed from
 *     content (a `<select>`'s `<option>` text is a value, not label text).
 *
 * Exposed browser-context API:
 *   __accessibleNameInfo(el) -> { name, source, reason }
 *   __accessibleName(el)     -> string
 *   __hasAccessibleName(el)  -> boolean
 *   __accNameFromContent(el, visited, depth) -> string  (raw subtree text)
 */

const injectableCode = `
  var __ACCNAME_MAX_DEPTH = 24;

  // Tags whose accessible name may come from their own subtree text.
  var __ACC_CONTENT_TAGS = [
    'a', 'button', 'summary', 'label', 'legend', 'caption', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'td', 'option', 'dt', 'output'
  ];

  // ARIA roles whose accessible name may come from content, per the
  // "namefrom: author, contents" entries in the ARIA spec.
  var __ACC_CONTENT_ROLES = [
    'button', 'link', 'heading', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'checkbox', 'switch', 'tab', 'treeitem', 'cell',
    'columnheader', 'rowheader', 'gridcell', 'row', 'tooltip', 'term'
  ];

  function __accNormalize(s) {
    return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  }

  /**
   * Pruned from name computation. Cheap attribute checks only — see the
   * module header for why getComputedStyle is deliberately not used here.
   */
  function __accIsHiddenForName(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.hasAttribute('hidden')) return true;
    return false;
  }

  function __accTagOf(el) {
    var t = el && el.tagName;
    if (!t) return '';
    // SVG elements report a case-sensitive tagName; normalise it.
    return String(t).toLowerCase();
  }

  function __accRoleOf(el) {
    var role = el && el.getAttribute ? el.getAttribute('role') : null;
    if (!role) return '';
    return String(role).trim().split(/\\s+/)[0].toLowerCase();
  }

  /** Direct <title> child of an <svg> (the SVG naming mechanism). */
  function __accSvgTitle(svg) {
    var kids = svg.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (__accTagOf(kids[i]) === 'title') return kids[i].textContent || '';
    }
    return null;
  }

  /** First direct child matching \`tag\` (for <caption>/<legend>/<figcaption>). */
  function __accDirectChild(el, tag) {
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (__accTagOf(kids[i]) === tag) return kids[i];
    }
    return null;
  }

  /**
   * A descendant that supplies its OWN name (aria-labelledby / aria-label /
   * img alt / svg title) contributes that name to the ancestor's name-from-
   * content, exactly as a screen reader announces it. Returns null when the
   * descendant has no own name, so the caller keeps recursing into it.
   */
  function __accOwnNameOfDescendant(node, visited, depth) {
    var tag = __accTagOf(node);

    var labelledby = node.getAttribute ? node.getAttribute('aria-labelledby') : null;
    if (labelledby) {
      var fromRefs = __accFromLabelledBy(labelledby, visited, depth);
      if (fromRefs !== null && __accNormalize(fromRefs)) return fromRefs;
    }

    var ariaLabel = node.getAttribute ? node.getAttribute('aria-label') : null;
    if (ariaLabel && __accNormalize(ariaLabel)) return ariaLabel;

    if (tag === 'img' || tag === 'area') {
      // alt="" is an explicit "decorative": contributes nothing, and must not
      // fall through to the (empty) subtree.
      if (node.hasAttribute('alt')) return node.getAttribute('alt');
      return '';
    }

    if (tag === 'input') {
      var type = String(node.getAttribute('type') || 'text').toLowerCase();
      if (type === 'image' && node.hasAttribute('alt')) return node.getAttribute('alt');
      return '';
    }

    if (tag === 'svg') {
      var svgTitle = __accSvgTitle(node);
      if (svgTitle !== null) return svgTitle;
    }

    return null;
  }

  /**
   * Name from content: the element's subtree text, with descendant names
   * substituted in. This is the step that makes \`<a><img alt="Home"></a>\`
   * resolve to "Home" instead of "".
   */
  function __accNameFromContent(el, visited, depth) {
    if (!el || depth > __ACCNAME_MAX_DEPTH) return '';
    var parts = [];
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3) { parts.push(node.nodeValue); continue; }
      if (node.nodeType !== 1) continue;
      if (__accIsHiddenForName(node)) continue;

      var tag = __accTagOf(node);
      if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript') continue;
      // Embedded controls carry a value, not label text — their subtree
      // (e.g. a <select>'s <option> list) is not part of an ancestor's name.
      if (tag === 'select' || tag === 'textarea') continue;

      var own = __accOwnNameOfDescendant(node, visited, depth + 1);
      if (own !== null) { parts.push(own); continue; }

      parts.push(__accNameFromContent(node, visited, depth + 1));
    }
    return parts.join(' ');
  }

  /**
   * Resolve an aria-labelledby ID list.
   * Returns null when NOTHING referenced exists (a dangling reference is not a
   * name), otherwise the concatenated names of the resolved references.
   */
  function __accFromLabelledBy(value, visited, depth) {
    var ids = String(value).split(/\\s+/).filter(function (x) { return x.length > 0; });
    if (!ids.length) return null;
    var parts = [];
    var resolvedAny = false;
    for (var i = 0; i < ids.length; i++) {
      var ref = null;
      try { ref = document.getElementById(ids[i]); } catch (e) { ref = null; }
      if (!ref) continue;
      resolvedAny = true;
      if (visited.indexOf(ref) !== -1) continue;
      visited.push(ref);

      var refLabel = ref.getAttribute('aria-label');
      if (refLabel && __accNormalize(refLabel)) { parts.push(refLabel); continue; }

      var refTag = __accTagOf(ref);
      if (refTag === 'input' || refTag === 'select' || refTag === 'textarea') {
        // A referenced control contributes its value.
        parts.push(ref.value == null ? '' : String(ref.value));
        continue;
      }
      // aria-labelledby forces name-from-content on the reference, whatever
      // its role would normally allow.
      parts.push(__accNameFromContent(ref, visited, depth + 1));
    }
    if (!resolvedAny) return null;
    return parts.join(' ');
  }

  /**
   * Text of the <label> element(s) associated with a form control.
   *
   * Prefers the native \`control.labels\` NodeList — that is exactly how the
   * browser (and therefore assistive technology) resolves the association, and
   * a wrapping <label for="thisId"> appears in it ONCE. Falls back to
   * \`label[for]\` + \`closest('label')\` for hosts/elements without \`.labels\`.
   */
  function __accLabelText(control, visited) {
    var list = [];
    var native = null;
    try { native = control.labels; } catch (e) { native = null; }

    if (native && typeof native.length === 'number' && native.length > 0) {
      for (var i = 0; i < native.length; i++) list.push(native[i]);
    } else {
      var id = control.getAttribute('id');
      if (id) {
        var esc = (window.CSS && typeof window.CSS.escape === 'function')
          ? window.CSS.escape(id)
          : String(id).replace(/["\\\\]/g, '\\\\$&');
        try {
          var found = document.querySelectorAll('label[for="' + esc + '"]');
          for (var j = 0; j < found.length; j++) list.push(found[j]);
        } catch (e) { /* malformed id — no selector-based association */ }
      }
      var wrap = control.closest ? control.closest('label') : null;
      if (wrap && list.indexOf(wrap) === -1) list.push(wrap);
    }

    var parts = [];
    for (var k = 0; k < list.length; k++) {
      var lbl = list[k];
      if (!lbl || visited.indexOf(lbl) !== -1) continue;
      visited.push(lbl);
      var la = lbl.getAttribute('aria-label');
      if (la && __accNormalize(la)) { parts.push(la); continue; }
      // __accNameFromContent skips <select>/<textarea>; drop <input> too so a
      // wrapping label never counts the control it labels.
      parts.push(__accLabelOwnText(lbl, visited));
    }
    return __accNormalize(parts.join(' '));
  }

  /** A <label>'s own text, excluding any form control nested inside it. */
  function __accLabelOwnText(label, visited) {
    var parts = [];
    var kids = label.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3) { parts.push(node.nodeValue); continue; }
      if (node.nodeType !== 1) continue;
      if (__accIsHiddenForName(node)) continue;
      var tag = __accTagOf(node);
      if (tag === 'input' || tag === 'select' || tag === 'textarea') continue;
      var own = __accOwnNameOfDescendant(node, visited, 1);
      if (own !== null) { parts.push(own); continue; }
      parts.push(__accLabelOwnText(node, visited));
    }
    return parts.join(' ');
  }

  /** Native (HTML-AAM) naming mechanisms. Returns { name, source } or null. */
  function __accNativeName(el, tag, type, visited) {
    if (tag === 'img' || tag === 'area') {
      if (el.hasAttribute('alt')) {
        return { name: __accNormalize(el.getAttribute('alt')), source: 'alt' };
      }
    }

    if (tag === 'input' && type !== 'hidden') {
      if (type === 'image' && el.hasAttribute('alt')) {
        return { name: __accNormalize(el.getAttribute('alt')), source: 'alt' };
      }
      if (type === 'button' || type === 'submit' || type === 'reset') {
        var v = __accNormalize(el.getAttribute('value') || '');
        if (v) return { name: v, source: 'value' };
        // Browsers supply a default name for submit/reset with no value.
        if (type === 'submit') return { name: 'Submit', source: 'default' };
        if (type === 'reset') return { name: 'Reset', source: 'default' };
      }
    }

    if (tag === 'input' || tag === 'select' || tag === 'textarea' ||
        tag === 'meter' || tag === 'output' || tag === 'progress') {
      if (type !== 'hidden') {
        var labelText = __accLabelText(el, visited);
        if (labelText) return { name: labelText, source: 'label' };
      }
    }

    if (tag === 'svg') {
      var svgTitle = __accSvgTitle(el);
      if (svgTitle !== null) {
        return { name: __accNormalize(svgTitle), source: 'svg-title' };
      }
    }

    if (tag === 'table') {
      var caption = __accDirectChild(el, 'caption');
      if (caption) return { name: __accNormalize(caption.textContent), source: 'caption' };
    }

    if (tag === 'fieldset') {
      var legend = __accDirectChild(el, 'legend');
      if (legend) return { name: __accNormalize(legend.textContent), source: 'legend' };
    }

    if (tag === 'figure') {
      var figcaption = __accDirectChild(el, 'figcaption');
      if (figcaption) return { name: __accNormalize(figcaption.textContent), source: 'figcaption' };
    }

    return null;
  }

  /** Does this element take its accessible name from its own content? */
  function __accNameFromContentAllowed(el, tag) {
    var role = __accRoleOf(el);
    if (role) return __ACC_CONTENT_ROLES.indexOf(role) !== -1;
    if (tag === 'input' || tag === 'select' || tag === 'textarea' ||
        tag === 'img' || tag === 'area') {
      return false;
    }
    return __ACC_CONTENT_TAGS.indexOf(tag) !== -1;
  }

  /**
   * Compute an element's accessible name.
   * @returns {{name: string, source: string, reason: string|null}}
   *   source: 'aria-labelledby' | 'aria-label' | 'label' | 'alt' | 'value' |
   *           'default' | 'svg-title' | 'caption' | 'legend' | 'figcaption' |
   *           'contents' | 'title' | 'none' | 'error'
   *   reason: only when name is '' — which mechanism was present but empty.
   */
  function __accessibleNameInfo(el) {
    try {
      if (!el || el.nodeType !== 1) return { name: '', source: 'none', reason: 'not-an-element' };

      var visited = [el];
      var tag = __accTagOf(el);
      var type = tag === 'input'
        ? String(el.getAttribute('type') || 'text').toLowerCase()
        : null;
      var emptyReason = null;

      // 1. aria-labelledby
      var labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        var fromRefs = __accFromLabelledBy(labelledby, visited, 0);
        if (fromRefs === null) {
          emptyReason = emptyReason || 'aria-labelledby-dangling';
        } else {
          var normRefs = __accNormalize(fromRefs);
          if (normRefs) return { name: normRefs, source: 'aria-labelledby', reason: null };
          emptyReason = emptyReason || 'aria-labelledby-empty';
        }
      }

      // 2. aria-label
      var ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel !== null) {
        var normLabel = __accNormalize(ariaLabel);
        if (normLabel) return { name: normLabel, source: 'aria-label', reason: null };
        emptyReason = emptyReason || 'aria-label-empty';
      }

      // 3. native labelling
      var native = __accNativeName(el, tag, type, visited);
      if (native && native.name) return { name: native.name, source: native.source, reason: null };
      if (native && !native.name) {
        emptyReason = emptyReason ||
          (native.source === 'alt' ? 'alt-empty-decorative' : native.source + '-empty');
      }

      // 4. name from content
      if (__accNameFromContentAllowed(el, tag)) {
        var content = __accNormalize(__accNameFromContent(el, visited, 0));
        if (content) return { name: content, source: 'contents', reason: null };
      }

      // 5. title
      var title = el.getAttribute('title');
      if (title !== null) {
        var normTitle = __accNormalize(title);
        if (normTitle) return { name: normTitle, source: 'title', reason: null };
        emptyReason = emptyReason || 'title-empty';
      }

      return { name: '', source: 'none', reason: emptyReason || 'no-name-mechanism' };
    } catch (e) {
      // A scanner must never crash because a name could not be computed.
      return { name: '', source: 'error', reason: 'accname-threw: ' + (e && e.message) };
    }
  }

  function __accessibleName(el) {
    return __accessibleNameInfo(el).name;
  }

  function __hasAccessibleName(el) {
    return __accessibleNameInfo(el).name.length > 0;
  }

  // -------------------------------------------------------------------------
  // VISIBLE LABEL (SC 2.5.3 "Label in Name")
  // -------------------------------------------------------------------------
  //
  // 2.5.3 requires the accessible name to contain "the text that is presented
  // visually" — the LABEL of the control, not every glyph inside its box.
  // Concatenating textContent gets both parts of that wrong on real markup:
  //
  //   <a class="brand" aria-label="Dr. Elena Brandt — Startseite" href="#top">
  //     <span class="mark">Br</span>                      <!-- 19px monogram -->
  //     <span class="bname">Dr. Elena Brandt</span>       <!-- 20px wordmark -->
  //     <span class="brole">Kardiologie · Graz</span>     <!-- 11.5px tagline -->
  //   </a>
  //
  //   textContent -> "BrDr. Elena BrandtKardiologie · Graz"
  //
  // Two independent defects: block-level children are glued together without a
  // word boundary ("BrDr."), and the monogram + tagline are treated as part of
  // the label although neither identifies the control — the wordmark does.
  // Every branding link on the golden corpus failed 2.5.3 because of this.
  //
  // __visibleLabelSegments(el) returns the rendered text runs with the data
  // needed to tell label from decoration:
  //   { text, fontSize, isIconSubstitute }
  // dropping anything that is not in the accessibility tree (aria-hidden,
  // [hidden], display:none, visibility:hidden, sr-only clipping).
  //
  // __visibleLabelText(el) reduces those segments to
  //   { full, label, segments }
  //   - full  : every segment, space-separated  (the strict reading of 2.5.3)
  //   - label : the segments that actually label the control, dropping
  //       (a) ICON SUBSTITUTES — a run of <= 3 characters with no whitespace
  //           next to other runs: monograms ("Br"), icon-font glyphs, "»".
  //           These are pictures rendered as text; a speech user does not say
  //           them, and 2.5.3's own note excludes non-text content.
  //       (b) SUPPLEMENTARY runs — rendered below 80 % of the largest run's
  //           font-size when more than one run remains. Typographic hierarchy
  //           is how a design says "this line is the name, that line is a
  //           subtitle"; the subtitle is not the label.
  // A caller passes 2.5.3 if EITHER \`full\` or \`label\` is contained in the name,
  // so the reduction can only remove findings, never invent them. A control
  // with a single uniform text run — every \`bad-label-in-name.html\` case —
  // reduces to itself and is unaffected.
  function __visibleLabelSegments(el) {
    var segments = [];
    if (!el || el.nodeType !== 1) return segments;

    function hiddenFromTree(node) {
      if (node.nodeType !== 1) return false;
      if (node.hasAttribute('hidden')) return true;
      if (node.getAttribute('aria-hidden') === 'true') return true;
      var cs = null;
      try { cs = window.getComputedStyle(node); } catch (e) { return false; }
      if (!cs) return false;
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      if (parseFloat(cs.opacity) === 0) return true;
      if (typeof __isSrOnly === 'function' && __isSrOnly(node)) return true;
      return false;
    }

    // <input type=button|submit|reset> shows its \`value\`, not a text child.
    var tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      var v = (el.value || '').trim();
      if (v) {
        var ics = null;
        try { ics = window.getComputedStyle(el); } catch (e) { /* ignore */ }
        segments.push({ text: v, fontSize: ics ? parseFloat(ics.fontSize) || 16 : 16, isIconSubstitute: false });
      }
      return segments;
    }

    (function walk(node) {
      if (node.nodeType === 3) {
        var t = (node.nodeValue || '').replace(/\\s+/g, ' ').trim();
        if (!t) return;
        var parent = node.parentElement;
        var size = 16;
        if (parent) {
          try { size = parseFloat(window.getComputedStyle(parent).fontSize) || 16; } catch (e) { /* ignore */ }
        }
        segments.push({ text: t, fontSize: size, isIconSubstitute: false });
        return;
      }
      if (node.nodeType !== 1) return;
      if (node !== el && hiddenFromTree(node)) return;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    })(el);

    for (var s = 0; s < segments.length; s++) {
      var txt = segments[s].text;
      segments[s].isIconSubstitute = segments.length > 1 && txt.length <= 3 && !/\\s/.test(txt);
    }
    return segments;
  }

  // Normalisation shared by both sides of the 2.5.3 comparison: case folded,
  // punctuation and symbols (colon, hyphen, em dash, middle dot, pipe, emoji …)
  // reduced to a word break, whitespace collapsed. Both sides MUST go through
  // this one function: the visible text comes from text nodes and the name
  // from ACCNAME, and the two insert separators at different places.
  //
  // Punctuation becomes a SPACE rather than being deleted, so that
  // \`PDF-Dokument herunterladen\` reads as three words. Deleting it would
  // glue the compound into \`pdfdokument\` and hide the label \`PDF …
  // herunterladen\` from both tests below.
  function __visibleLabelNormalize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function __visibleLabelText(el) {
    var segments = __visibleLabelSegments(el);
    var full = __visibleLabelNormalize(segments.map(function (s) { return s.text; }).join(' '));

    var kept = segments.filter(function (s) { return !s.isIconSubstitute; });
    if (kept.length > 1) {
      var max = kept.reduce(function (m, s) { return Math.max(m, s.fontSize); }, 0);
      if (max > 0) {
        var primary = kept.filter(function (s) { return s.fontSize >= max * 0.8; });
        if (primary.length) kept = primary;
      }
    }
    var label = __visibleLabelNormalize(kept.map(function (s) { return s.text; }).join(' '));

    return { full: full, label: label || full, segments: segments };
  }

  // Does \`name\` contain \`visible\`? Two accepting tests, in this order:
  //
  //   1. SUBSTRING containment on the normalised strings — the test axe-core's
  //      \`label-content-name-mismatch\` applies, and the plain reading of
  //      Understanding 2.5.3 ("the name contains the text that is presented
  //      visually"). Crucially it does NOT require word boundaries to line up.
  //      A word-boundary-respecting test is systematically wrong on German
  //      compounds: \`Telefon\` is not a word of \`Telefonnummer für
  //      Rückfragen\` and \`Land auswählen\` is not a word sequence of
  //      \`Bundesland auswählen\`, yet a speech user reaches both controls
  //      and both conform. Real German pages produce that shape constantly.
  //
  //   2. The visible words appearing IN ORDER inside the name, which
  //      Understanding 2.5.3 allows explicitly: the name may carry extra words
  //      before, after and BETWEEN the label's words — visible
  //      \`PDF herunterladen\` against the name \`PDF-Dokument herunterladen\`
  //      is conformant, and no substring test can see that.
  //
  // Test 1 alone would fail case 2; test 2 alone would fail case 1. Together
  // they accept exactly the set the criterion accepts. The bounded cost is
  // that a name embedding the label inside an unrelated longer word also
  // passes — the same behaviour every other conformance tool has.
  function __nameContainsLabel(name, visible) {
    if (!visible) return true;
    if (!name) return false;
    if (name.indexOf(visible) !== -1) return true;
    var nameWords = name.split(' ');
    var visWords = visible.split(' ');
    var pos = 0;
    for (var i = 0; i < visWords.length; i++) {
      var idx = nameWords.indexOf(visWords[i], pos);
      if (idx === -1) return false;
      pos = idx + 1;
    }
    return true;
  }

  // The single 2.5.3 decision, used by every scanner that tests the criterion.
  function __labelInNameOk(el, accName) {
    var vis = __visibleLabelText(el);
    if (!vis.full) return true; // icon-only control: 2.5.3 does not apply
    var name = __visibleLabelNormalize(accName);
    if (!name) return true;     // unnamed control is 4.1.2, reported elsewhere
    return __nameContainsLabel(name, vis.full) || __nameContainsLabel(name, vis.label);
  }
`;

module.exports = { injectableCode };
