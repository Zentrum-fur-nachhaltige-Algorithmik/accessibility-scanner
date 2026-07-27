#!/usr/bin/env node

/**
 * test-realworld.js — regression harness for the frozen real-world corpus.
 *
 * WHY
 * ---
 * The synthetic `test-sites/bad-*.html` fixtures are hand-written, tidy, and
 * small. Every fundamental scanner bug found in the 2026-07 sprint came from
 * structures those fixtures cannot produce:
 *
 *   - SVG `className` is an `SVGAnimatedString` object, not a string
 *     (`.includes` / regex on it throws) — needs a page with real inline SVG
 *   - an open JS dialog blocks the renderer main thread, so every later
 *     `page.evaluate()` from ANY concurrent scanner hangs forever
 *   - a dead <iframe> pins `document.readyState` at 'interactive', which made
 *     axe-core injection throw "Page/Frame is not ready" and silently zero out
 *   - `language-detection` threw "Cannot read properties of undefined
 *     (reading 'map')" on Next.js pages
 *
 * So this harness runs the REAL pipeline (not scanners in isolation) against
 * five frozen snapshots of real pages. See `capture-realworld.js`.
 *
 * WHAT IT ASSERTS (three layers)
 *   (a) NO-CRASH INVARIANT — the core assertion. Every selected scanner must
 *       complete on every file with `error === null`, and must not be missing
 *       from the results. A per-file wall-clock ceiling turns a hang into a
 *       failure rather than something swallowed as a timeout.
 *   (b) SANITY BANDS — total ensemble violation count per file must sit inside
 *       a recorded band. Catches silent-crash zeroing AND noise explosions.
 *   (c) SPOT-TRUTHS — hand-verified per-file assertions. Each was checked by
 *       READING the snapshot markup; the evidence is in a comment above it.
 *       Never derived from what the scanners happen to report, which would
 *       just freeze current behaviour including its bugs.
 *
 * These fixtures deliberately carry NO `<!-- WCAG-TEST -->` metadata and live
 * in a SUBDIRECTORY, so the existing fixture harnesses do not pick them up —
 * `test-exclusive-scanners.js`, `test-concurrent-scanners.js` and
 * `tests/scanners/axe-core-e2e.test.js` all enumerate with
 * `readdirSync(testDir).filter(f => f.endsWith('.html'))`, which is
 * non-recursive and drops the `realworld` directory entry.
 *
 * Usage:
 *   node test-sites/test-realworld.js --no-llm
 *   node test-sites/test-realworld.js --json /tmp/realworld.json
 *   node test-sites/test-realworld.js --only med-theme.html
 *
 * LLM scanners run only when OPENROUTER_API_KEY is in the environment AND
 * --no-llm was not passed. They cost money — use --no-llm while iterating.
 * Their spot-truths are deliberately lenient: single-run LLM output is not a
 * reliable hard assertion, so we only demand "did not crash, returned an array".
 *
 * Exit code 1 on any failure (the JSON report is written first).
 */

const path = require('path');
const http = require('http');
const fs = require('fs');

const ScanPipeline = require('../src/scan-pipeline');
const { registerAllScanners, getProfile } = require('../src/scanner-registry');

const FIXTURE_DIR = path.join(__dirname, 'realworld');
const PROFILE = 'standard';

/**
 * A hang is a failure, not a timeout to be swallowed.
 *
 * Started at 240s. Raised to 600s on 2026-07-27 after measuring the cause:
 * `responsive-design` alone takes 348s on wiki-medical-de.html (800 KB, 5101
 * DOM nodes) — it COMPLETES, it is just pathologically slow. At 240s that one
 * file produced no violation count and ran no spot-truths at all, so the
 * corpus lost every other signal it carries just to re-report a slowness we
 * already know about. 600s still fails a genuine hang.
 *
 * The slowness is NOT swallowed: any file over SLOW_FILE_MS is reported as a
 * SLOW line in the summary and flagged in the JSON.
 */
const PER_FILE_TIMEOUT_MS = 600000;
const SLOW_FILE_MS = 240000;

// ---------------------------------------------------------------------------
// violation matching helpers
//
// Violation shape is NOT uniform across the ensemble:
//   axe-core-adapter   -> { ruleId, nodes: [{ selector }], description, ... }
//   heuristic scanners -> { criterion: '9.3.1.1', element: 'html', selector, issue }
// so every matcher searches the union of the plausible fields.
// ---------------------------------------------------------------------------

/** All identifier-ish fields of a violation, lowercased, joined. */
function idText(v) {
  return [v.ruleId, v.axeRuleId, v.criterion, v.type, v.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** All selector/element-ish fields of a violation, joined. */
function selectorText(v) {
  const parts = [v.element, v.selector, v.target, v.html];
  if (Array.isArray(v.nodes)) {
    for (const n of v.nodes) {
      if (!n) continue;
      if (typeof n === 'string') parts.push(n);
      else parts.push(n.selector, n.element, n.html, n.target);
    }
  }
  return parts.filter(Boolean).map(String).join(' | ');
}

/** Everything human-readable about a violation. */
function proseText(v) {
  return [v.description, v.issue, v.message, v.recommendation, v.axeHelp]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Find violations matching a spec.
 * @param {object[]} violations
 * @param {object} spec
 * @param {string|string[]} [spec.id]        — substring(s) matched against ruleId/criterion (ANY)
 * @param {string|string[]} [spec.selector]  — substring(s) matched against selector fields (ALL)
 * @param {string|string[]} [spec.prose]     — substring(s) matched against description/issue (ANY)
 * @param {string} [spec.scannerId]
 */
function findViolations(violations, spec = {}) {
  const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const ids = arr(spec.id).map((s) => s.toLowerCase());
  const sels = arr(spec.selector);
  const prose = arr(spec.prose).map((s) => s.toLowerCase());

  return violations.filter((v) => {
    if (spec.scannerId && v.scannerId !== spec.scannerId) return false;
    if (ids.length && !ids.some((i) => idText(v).includes(i))) return false;
    if (sels.length) {
      const st = selectorText(v);
      if (!sels.every((s) => st.includes(s))) return false;
    }
    if (prose.length && !prose.some((p) => proseText(v).includes(p))) return false;
    return true;
  });
}

/** Convenience: does ANY violation anywhere mention this string? */
function mentions(violations, needle) {
  const n = needle.toLowerCase();
  return violations.filter(
    (v) => selectorText(v).toLowerCase().includes(n) || proseText(v).includes(n)
  );
}

// ---------------------------------------------------------------------------
// FIXTURES — bands + spot-truths
//
// BANDS were recorded on the first clean run (2026-07-27) and are deliberately
// wide: [floor(actual*0.5), ceil(actual*2)]. They are a crash/explosion alarm,
// not a precision baseline. Re-running capture-realworld.js invalidates them.
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    file: 'own-audit-ui.html',
    source: 'http://localhost:3111/audit (this repo\'s own Next.js frontend)',
    // observed 2026-07-27: 28 total ensemble violations (profile=standard, --no-llm);
    // also observed 32 on an earlier run — run-to-run drift is normal.
    // Band is deliberately wide — a crash/explosion alarm, not a baseline.
    band: [14, 56],
    spotTruths: [
      {
        name: 'REGRESSION: language-detection completes without error',
        kind: 'must-pass',
        // verified 2026-07-27: this file is the live repro for
        // "Cannot read properties of undefined (reading 'map')". It is a real
        // Next.js document — <html lang="de"> plus a hydrated <div id="__next">
        // whose child carries its own lang="en", <!-- --> hydration comment
        // separators, and a <script id="__NEXT_DATA__" type="application/json">
        // payload. That combination is what the old code walked with .map().
        check: ({ scanners }) => {
          const s = scanners['language-detection'];
          if (!s) return 'language-detection missing from results entirely';
          if (s.error) return `language-detection returned error: ${s.error}`;
          return null;
        },
      },
      {
        name: 'REGRESSION: __next-route-announcer__ empty live region NOT flagged',
        kind: 'must-not-flag',
        // verified 2026-07-27: last element before </body> is
        //   <next-route-announcer><p aria-live="assertive"
        //     id="__next-route-announcer__" role="alert"
        //     style="border: 0px; clip: rect(0px, 0px, 0px, 0px); height: 1px;
        //            margin: -1px; overflow: hidden; padding: 0px;
        //            position: absolute; top: 0px; width: 1px; ..."></p>
        //   </next-route-announcer>
        // It is EMPTY BY DESIGN — Next.js injects the new page title into it on
        // client-side route change. An empty aria-live/role=alert region that a
        // framework fills at runtime is correct, not a violation.
        check: ({ violations }) => {
          const hits = mentions(violations, 'next-route-announcer');
          if (hits.length === 0) return null;
          return `${hits.length} violation(s) flag the Next.js route announcer: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: labelled url input not flagged as unlabelled',
        kind: 'must-not-flag',
        // verified 2026-07-27: the form field is properly labelled —
        //   <label for="url">Target address <span aria-hidden="true">*</span>
        //     <span class="sr-only">(required)</span></label>
        //   <input type="url" id="url" placeholder="https://example.com" required
        //     aria-required="true" aria-describedby="url-help" autocomplete="url"
        //     inputmode="url" name="url" value="">
        // label[for] matches input[id], so it has an accessible name.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['label', '3.3.2', '4.1.2'],
            selector: '#url',
            prose: ['label', 'accessible name', 'name'],
          }).filter((v) => !selectorText(v).includes('#url-'));
          if (hits.length === 0) return null;
          return `input#url (which HAS <label for="url">) flagged: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'REAL: <html lang="de"> contradicts English content / inner lang="en"',
        kind: 'must-detect',
        // verified 2026-07-27: document declares German —
        //   <html lang="de">
        // but every word of content is English ("Web accessibility audit",
        // "Enter the address of a publicly reachable page, choose a scan
        // profile and start the audit.") and the hydrated wrapper immediately
        // re-declares <div class="page" lang="en">. A page whose declared
        // language is not the language of its content is WCAG 3.1.1 (and the
        // nested contradiction is 3.1.2).
        //
        // KNOWN GAP as of 2026-07-27: the ensemble does NOT detect this, so
        // this assertion is currently RED. It is deliberately left failing —
        // the violation is real and hand-verified, and weakening the assertion
        // to make the suite green would hide a true false-negative. When
        // language-detection learns to compare declared vs. actual page
        // language (or to flag a child lang that contradicts <html lang>),
        // this turns green on its own.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['3.1.1', '3.1.2', 'html-lang', 'valid-lang', 'html-has-lang'] });
          if (hits.length > 0) return null;
          return 'no 3.1.1/3.1.2 language violation reported despite lang="de" on an all-English page';
        },
      },
    ],
  },

  {
    file: 'med-theme.html',
    source: 'https://dr-mauermann-urologe.vercel.app',
    // observed 2026-07-27: 44 total ensemble violations (profile=standard, --no-llm);
    // 44 on both recorded runs.
    // Band is deliberately wide — a crash/explosion alarm, not a baseline.
    band: [22, 88],
    spotTruths: [
      {
        name: 'REAL: heading level skips h2 -> h4',
        kind: 'must-detect',
        // verified 2026-07-27: in the #services section the document goes
        //   <h2 class="h1" style="margin-bottom:14px">Urologische
        //     Vorsorge&nbsp;&amp; Behandlung</h2>
        //   ... <div class="tile-grid"><div class="tile">
        //   <h4>Vorsorge &amp; Diagnostik</h4>
        // h3 is never used — the outline jumps 2 -> 4. Four <h4> tiles follow
        // that <h2>. WCAG 1.3.1 / axe rule `heading-order`.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['heading-order', '1.3.1', '2.4.6', '2.4.10'],
            prose: ['heading', 'überschrift'],
          });
          if (hits.length > 0) return null;
          return 'no heading-order/heading-structure violation reported despite the h2 -> h4 skip';
        },
      },
      {
        name: 'CLEAN: brand logo has a descriptive alt',
        kind: 'must-not-flag',
        // verified 2026-07-27: the only <img> in the document is
        //   <img class="brand__logo" src="/images/c1bee693c1e44f10.png"
        //     alt="Dr. Julian Mauermann – Facharzt für Urologie"
        //     width="44" height="44">
        // Non-empty, descriptive, not filename-ish. Must not be flagged as a
        // missing / inadequate text alternative — even though the src is dead
        // at test time (the image 404s, which is the point).
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['image-alt', 'alt', '1.1.1'],
            selector: 'brand__logo',
          });
          if (hits.length === 0) return null;
          return `logo img (alt="Dr. Julian Mauermann – Facharzt für Urologie") flagged: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: <html lang="de"> matches the German content',
        kind: 'must-not-flag',
        // verified 2026-07-27: <html lang="de"> and the content is German
        // throughout ("Herzlich willkommen in unserer barrierefreien Ordination
        // im Wohnpark Alt Erlaa."). No missing/invalid lang, no mismatch.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['html-has-lang', 'html-lang-valid', '3.1.1'],
          });
          if (hits.length === 0) return null;
          return `page-language flagged despite a correct <html lang="de">: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
    ],
  },

  {
    file: 'beeproduced.html',
    source: 'https://beeproduced.com',
    // observed 2026-07-27: 379 total ensemble violations (profile=standard, --no-llm);
    // also observed 436 on a run where keyboard-navigation did not time out.
    // Band is deliberately wide — a crash/explosion alarm, not a baseline.
    band: [189, 758],
    spotTruths: [
      {
        name: 'REGRESSION: axe-core survives the dead <iframe> and still reports',
        kind: 'must-pass',
        // verified 2026-07-27: this document contains
        //   <iframe id="__framer-editorbar" src="./_offline/edit"
        //     aria-hidden="true" allow="autoplay" tabindex="-1"
        //     class="status_hidden">
        // whose src 404s at test time, so the frame never fires `load` and the
        // parent document can sit at readyState 'interactive'. That is exactly
        // what made AxePuppeteer throw "Page/Frame is not ready" and silently
        // report zero violations for an otherwise scannable page. Assert both
        // that it did not error AND that it produced findings (a crash that
        // degrades to an empty array would otherwise pass unnoticed).
        check: ({ scanners }) => {
          const s = scanners['axe-core'];
          if (!s) return 'axe-core missing from results entirely';
          if (s.error) return `axe-core returned error: ${s.error}`;
          if (!s.violationCount) return 'axe-core reported 0 violations — suspicious silent-zero on a dead-iframe page';
          return null;
        },
      },
      {
        name: 'REAL: positive tabindex="1" on 5 elements',
        kind: 'must-detect',
        // verified 2026-07-27: the document contains exactly 5 occurrences of
        // tabindex="1", e.g. the header logo link
        //   <a as="a" class="framer-1jpi8d1 framer-ew8aek" data-framer-name="Logo"
        //     tabindex="1" href="./" data-framer-page-link-current="true">
        // A positive tabindex forces the element ahead of every tabindex="0"
        // element in the tab sequence, so DOM order and focus order diverge.
        // WCAG 2.4.3 / axe best-practice rule `tabindex`.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['tabindex', '2.4.3'],
            prose: ['tabindex', 'focus order', 'tab order', 'greater than zero'],
          });
          if (hits.length > 0) return null;
          return 'no positive-tabindex / focus-order violation reported despite 5 elements with tabindex="1"';
        },
      },
      {
        name: 'REAL: heading level skips h1 -> h5',
        kind: 'must-detect',
        // verified 2026-07-27: the document's heading sequence in DOM order is
        //   h1 > h5 > h5 > h2 > h3 > h3 > h3 > h2 > h2 > h4 > h5 > h5 > h2 >
        //   h2 > h5 > h5 > h5 > h2 > h4
        // The very first transition h1 -> h5 skips three levels
        //   <h1 class="framer-text framer-styles-preset-895mv0" ...>
        //   <h5 class="framer-text framer-styles-preset-b1chyh" ...>
        // WCAG 1.3.1 / axe `heading-order`.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['heading-order', '1.3.1', '2.4.6', '2.4.10'],
            prose: ['heading', 'überschrift'],
          });
          if (hits.length > 0) return null;
          return 'no heading-order violation reported despite the h1 -> h5 skip';
        },
      },
      {
        name: 'CLEAN: logo link has an accessible name via its inner img alt',
        kind: 'must-not-flag',
        // verified 2026-07-27: the header logo anchor has no text node of its
        // own, but its only child image supplies the name —
        //   <a ... data-framer-name="Logo" tabindex="1" href="./">
        //     <div data-framer-background-image-wrapper="true">
        //       <img decoding="auto" width="299" height="140"
        //         src="./_offline/L1q6sRo7cc7kr6S5uR31PWm4KD0.svg" alt="Logo" ...>
        //     </div></a>
        // So it is NOT an empty link. (Checked deliberately: a naive
        // text-content scan of this anchor returns "", which is the trap.)
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['link-name', 'empty-link', '2.4.4', '4.1.2'],
            selector: 'framer-1jpi8d1',
          });
          if (hits.length === 0) return null;
          return `logo link (named by <img alt="Logo">) flagged as unnamed: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
    ],
  },

  {
    file: 'wiki-medical-de.html',
    source: 'https://de.wikipedia.org/wiki/Prostatakarzinom',
    // observed 2026-07-27: 1620 total ensemble violations (profile=standard, --no-llm);
    // single recorded run, 415.9s wall clock.
    // Band is deliberately wide — a crash/explosion alarm, not a baseline.
    band: [810, 3240],
    spotTruths: [
      {
        name: 'REAL: images with no alt attribute at all',
        kind: 'must-detect',
        // verified 2026-07-27: 12 of the 30 <img> elements carry no alt
        // attribute whatsoever. 8 of them are in-article figure images — plainly
        // visible body content, not a hideable banner — e.g.
        //   <figure class="mw-default-size" typeof="mw:File/Thumb" id="mwNw">
        //     <a href="https://de.wikipedia.org/wiki/Datei:Prostatakarzinom_01.svg"
        //        class="mw-file-description" id="mwOA">
        //       <img resource="https://de.wikipedia.org/wiki/Datei:Prostatakarzinom_01.svg"
        //            src="./_offline/250px-Prostatakarzinom_01.svg.png"
        //            decoding="async" data-file-width="517" ...>
        // and likewise for Choline-PETCT-Prostate-Ca.jpg, Linacprostate.jpg,
        // Prostate_adenocarcinoma_whole_slide.jpg and four more.
        // No alt, no role="presentation", no aria-hidden. WCAG 1.1.1 /
        // axe `image-alt`.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['image-alt', '1.1.1'],
            prose: ['alt', 'alternative', 'text alternative'],
          });
          if (hits.length > 0) return null;
          return 'no missing-alt violation reported despite 12 <img> elements without an alt attribute';
        },
      },
      {
        name: 'CLEAN: <html lang="de"> itself is not flagged',
        kind: 'must-not-flag',
        // verified 2026-07-27: <html class="client-js vector-feature-..." lang="de">
        // on a German-language article ("Prostatakarzinom"). Valid BCP-47,
        // matches the content.
        // NOTE: scoped to the <html> element on purpose. An earlier version of
        // this check matched ANY 3.1.1 violation and so also caught the
        // interlanguage-link subtag findings below, which are a different bug.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['html-has-lang', 'html-lang-valid', '3.1.1'],
          }).filter((v) => /(^|[\s|>])html($|[\s|.:[])/i.test(selectorText(v)) || selectorText(v).trim() === 'html');
          if (hits.length === 0) return null;
          return `page-language flagged despite a correct <html lang="de">: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: valid ISO 639-3 subtags on interlanguage links',
        kind: 'must-not-flag',
        // verified 2026-07-27: the sidebar interlanguage links each declare the
        // target wiki's language, e.g.
        //   <a href="https://arz.wikipedia.org/wiki/..."
        //      title="سرطان بروستاتا – Ägyptisches Arabisch"
        //      lang="arz" hreflang="arz"
        //      data-language-local-name="Ägyptisches Arabisch"
        //      class="interlanguage-link-target"><span>مصرى</span></a>
        // and likewise lang="bcl" hreflang="bcl", "ckb", "gpe", "new", "rki",
        // "wuu", "yue". Every one of those is a registered ISO 639-3 primary
        // language subtag (Egyptian Arabic, Central Bikol, Central Kurdish,
        // Ghanaian Pidgin, Newari, Rakhine, Wu Chinese, Cantonese) and hence
        // valid BCP-47. Rejecting them is a false positive.
        //
        // This is the SAME underlying bug modern-commercial.html reproduces,
        // but it surfaces through a different code path: here it is reported
        // as 3.1.1 "Invalid lang attribute value", there as 3.1.2 "Element has
        // invalid language code". Both are asserted so a partial fix is visible.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /"(arz|bcl|ckb|gpe|new|rki|wuu|yue|ast|dsb|hsb)"/i.test(`${v.issue || ''} ${v.description || ''}`) &&
            /invalid/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length === 0) return null;
          return `${hits.length} valid ISO 639-3 subtag(s) reported as invalid: ` +
            hits.slice(0, 6).map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: inline <span lang="en"> correctly marks a language change',
        kind: 'must-not-flag',
        // verified 2026-07-27: the sister-projects box marks its English label
        //   <span lang="en">Commons</span>
        // (2 occurrences). A correctly declared inline language change must not
        // be reported as a WCAG 3.1.2 "language of parts" violation.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['3.1.2'] }).filter((v) =>
            /commons/i.test(selectorText(v)) || /commons/i.test(proseText(v))
          );
          if (hits.length === 0) return null;
          return `correctly-marked <span lang="en">Commons</span> flagged as a 3.1.2 violation: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'REAL: data table has a completely empty <th> corner cell',
        kind: 'must-detect',
        // verified 2026-07-27: the PSA-screening comparison table opens with an
        // empty corner header —
        //   <table class="wikitable" id="mwAU8">
        //     <caption id="mwAVA">Im Verlauf von 21 Jahren haben 1000 Männer
        //       im Alter von 55-69 Jahren ...</caption>
        //     <tbody id="mwAVE"><tr id="mwAVI">
        //       <th id="mwAVM"></th>
        //       <th id="mwAVQ">Diagnose PK</th>
        //       <th id="mwAVU">Diagnose Metastasen</th>
        //       <th id="mwAVY">Tod durch PK</th></tr>
        // <th id="mwAVM"> has no text, no aria-label, no title — the row-header
        // column is left unnamed. WCAG 1.3.1 / axe `empty-table-header`. This
        // is the table-structure signal the article was chosen for (6 tables,
        // ~330,000 characters of text — >20x the LLM extractors' old
        // 15,000-char cutoff).
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['empty-table-header', '1.3.1'],
            prose: ['table header', 'header text', 'empty'],
          });
          if (hits.length > 0) return null;
          return 'no empty-table-header violation reported despite <th id="mwAVM"></th>';
        },
      },
    ],
  },

  {
    file: 'modern-commercial.html',
    source: 'https://www.mozilla.org/de/',
    // observed 2026-07-27: 223 total ensemble violations (profile=standard, --no-llm);
    // 223 on both recorded runs.
    // Band is deliberately wide — a crash/explosion alarm, not a baseline.
    band: [111, 446],
    spotTruths: [
      {
        name: 'REAL: a literal <blink> element in the navigation',
        kind: 'must-detect',
        // verified 2026-07-27: exactly ONE occurrence in the document, used as
        // a layout shim at the end of the nav container —
        //   </div><!-- close .m24-c-navigation-items -->
        //   <blink class="spacer-gif"></blink>
        //   </div><!-- close .m24-c-navigation-container -->
        // <blink> is obsolete and, where a UA still honours it, produces
        // uncontrollable flashing text. WCAG 2.2.2 (pause, stop, hide) /
        // axe rule `blink`, impact serious.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['blink', '2.2.2'] });
          if (hits.length > 0) return null;
          return 'no <blink> violation reported despite <blink class="spacer-gif"> in the nav';
        },
      },
      {
        name: 'CLEAN: decorative images correctly use alt=""',
        kind: 'must-not-flag',
        // verified 2026-07-27: of 23 <img> elements, ZERO lack an alt attribute
        // and 19 use alt="" — correct for purely decorative product/menu icons
        // that sit next to a text label, e.g.
        //   <img ... class="m24-c-menu-item-icon" width="32" height="32" alt="">
        //   <h2 class="m24-c-menu-item-title">Tabstack</h2>
        // Must not be reported as a missing text alternative.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['image-alt', '1.1.1'],
            selector: 'm24-c-menu-item-icon',
          });
          if (hits.length === 0) return null;
          return `decorative alt="" menu icons flagged as missing alt: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: heading whose accessible name comes from an image alt',
        kind: 'must-not-flag',
        // verified 2026-07-27: of the 31 <h2> elements in this document exactly
        // ONE has empty textContent — the footer advertising heading, which is
        // named entirely by its child image:
        //   <h2>
        //     <img src="./_offline/Mozilla_Ads_Logo.6ed26d0eac2b.svg"
        //       alt="Mozilla Anzeigen" width="250" height="33"
        //       class="moz24-footer-advertising-logo">
        //   </h2>
        // textContent is whitespace, but the accessible name is "Mozilla
        // Anzeigen", so it is NOT an empty heading. Because it is the only
        // text-empty h2 in the document, ANY "empty heading" violation on an
        // h2 here necessarily refers to it. (The trap: a naive textContent
        // check reports this as empty — and two scanners currently do.)
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            prose: ['empty heading', 'heading element is empty', 'heading "[empty]"'],
          }).filter((v) => /(^|[^a-z])h2/i.test(selectorText(v)));
          if (hits.length === 0) return null;
          return `the only text-empty h2 (named by <img alt="Mozilla Anzeigen">) flagged as an empty heading: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${selectorText(v)} :: ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: nav logo link is named by its inner img alt',
        kind: 'must-not-flag',
        // verified 2026-07-27: the header logo link has no text node but its
        // only child image supplies the accessible name —
        //   <a class="m24-c-navigation-logo-link" href="/de/"
        //      data-link-text="mozilla home icon" data-link-position="nav">
        //     <img class="m24-c-navigation-logo-image"
        //       src="./_offline/lockup-black.f2ddba3f0724.svg" alt="Mozilla"
        //       width="101" height="24">
        //   </a>
        // Accessible name is "Mozilla". Not an empty link. This is the same
        // false-positive shape that beeproduced.html reproduces independently.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['link-name', 'empty-link', '2.4.4', '4.1.2'],
            selector: 'm24-c-navigation-logo-link',
          });
          if (hits.length === 0) return null;
          return `logo link (named by <img alt="Mozilla">) flagged as unnamed: ` +
            hits.map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
      {
        name: 'CLEAN: valid 3-letter BCP-47 subtags are not "invalid language codes"',
        kind: 'must-not-flag',
        // verified 2026-07-27: the language picker declares each option in its
        // own language, e.g.
        //   <option lang="ast" ...>   <option lang="cak" ...>
        //   <option lang="dsb" ...>   <option lang="hsb" ...>
        //   <option lang="lij" ...>   <option lang="skr" ...>
        // `ast` (Asturian), `cak` (Kaqchikel), `dsb` (Lower Sorbian), `hsb`
        // (Upper Sorbian), `lij` (Ligurian) and `skr` (Saraiki) are all
        // registered ISO 639-3 primary language subtags in the IANA registry,
        // therefore valid BCP-47 and valid values for `lang`. Rejecting them
        // (e.g. by only accepting 2-letter ISO 639-1 codes) is a false positive.
        check: ({ violations }) => {
          const hits = violations.filter(
            (v) => /invalid.*(language|lang).*(code|tag)|language code/i.test(
              `${v.issue || ''} ${v.description || ''} ${v.ruleId || ''}`
            ) && /"(ast|cak|dsb|hsb|lij|skr|trs|kab|sco|gpe)"/i.test(
              `${v.issue || ''} ${v.description || ''}`
            )
          );
          if (hits.length === 0) return null;
          return `${hits.length} valid ISO 639-3 subtag(s) reported as invalid language codes: ` +
            hits.slice(0, 5).map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`).join('; ');
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

/**
 * Static server over the fixture directory. 404s are EXPECTED and intentional:
 * every ./_offline/* path is a deliberately dead resource, and exercising the
 * scanners against missing images/fonts/scripts is part of the point.
 */
function startServer(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const filePath = path.join(dir, rel);
    // Refuse to escape the fixture directory.
    if (!filePath.startsWith(dir) || !rel || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { json: null, only: null, noLlm: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = argv[++i];
    else if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--no-llm') out.noLlm = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node test-sites/test-realworld.js [--no-llm] [--only <file>] [--json <path>]');
      process.exit(0);
    }
  }
  return out;
}

async function scanFile(url, scannerIds, scanOptions) {
  // Fresh pipeline (and therefore a fresh browser) per file: a hang in one
  // fixture must not poison the next, and it makes timeout recovery trivial.
  const pipeline = new ScanPipeline();
  const registered = registerAllScanners(pipeline);
  const registeredIds = registered.map((s) => s.id);

  const expectedIds = scannerIds
    ? scannerIds.filter((id) => registeredIds.includes(id))
    : registeredIds;

  let timer;
  const timeoutPromise = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`WALL-CLOCK TIMEOUT after ${PER_FILE_TIMEOUT_MS}ms — treated as a hang, not a soft skip`)),
      PER_FILE_TIMEOUT_MS
    );
  });

  try {
    const result = await Promise.race([
      pipeline.scan(url, { scannerIds: expectedIds, timeout: 45000, ...scanOptions }),
      timeoutPromise,
    ]);
    return { result, expectedIds, timedOut: false };
  } catch (err) {
    return { result: null, expectedIds, timedOut: true, error: err.message };
  } finally {
    clearTimeout(timer);
    await pipeline.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.noLlm) {
    // registerAllScanners() keys off the env var, so clearing it is what
    // actually keeps the paid scanners out of the run.
    delete process.env.OPENROUTER_API_KEY;
  }
  const llmEnabled = !args.noLlm && !!process.env.OPENROUTER_API_KEY;

  // `includeExperimental: true` is deliberate and load-bearing. The default
  // profiles quarantine unproven scanners, but the no-crash invariant below is
  // exactly the evidence a quarantined scanner needs to earn its way back —
  // and the crash it is quarantined for must stay visible until it is fixed.
  // Running only the proven set here would make this harness blind to the
  // failures it exists to catch.
  const { scannerIds: profileIds, options: profileOptions } =
    getProfile(PROFILE, { includeExperimental: true });
  const scannerIds = profileIds && args.noLlm ? profileIds.filter((id) => !id.startsWith('llm-')) : profileIds;

  let fixtures = FIXTURES.filter((f) => fs.existsSync(path.join(FIXTURE_DIR, f.file)));
  const missing = FIXTURES.filter((f) => !fs.existsSync(path.join(FIXTURE_DIR, f.file)));
  if (args.only) fixtures = fixtures.filter((f) => f.file === args.only || f.file === `${args.only}.html`);

  if (fixtures.length === 0) {
    console.error(`No fixtures to run. Did you run: node test-sites/capture-realworld.js ?`);
    process.exit(1);
  }

  const { server, port } = await startServer(FIXTURE_DIR);
  console.log(`Serving ${FIXTURE_DIR} on http://localhost:${port}`);
  console.log(`Profile: ${PROFILE} | LLM scanners: ${llmEnabled ? 'ENABLED' : 'disabled'} | fixtures: ${fixtures.length}\n`);

  const report = {
    startedAt: new Date().toISOString(),
    profile: PROFILE,
    llmEnabled,
    perFileTimeoutMs: PER_FILE_TIMEOUT_MS,
    files: [],
  };
  const failures = [];

  // Scanners are noisy; capture their chatter instead of drowning the report.
  const realLog = console.log;
  const realWarn = console.warn;
  const realErr = console.error;

  for (const fx of fixtures) {
    const url = `http://localhost:${port}/${fx.file}`;
    realLog(`--- ${fx.file}`);

    const noise = [];
    const sink = (...a) => noise.push(a.map(String).join(' '));
    console.log = sink;
    console.warn = sink;
    console.error = sink;

    const t0 = Date.now();
    let outcome;
    try {
      outcome = await scanFile(url, scannerIds, profileOptions);
    } finally {
      console.log = realLog;
      console.warn = realWarn;
      console.error = realErr;
    }
    const elapsedMs = Date.now() - t0;

    const entry = {
      file: fx.file,
      source: fx.source,
      elapsedMs,
      timedOut: !!outcome.timedOut,
      totalViolations: null,
      band: fx.band,
      scannerErrors: [],
      missingScanners: [],
      spotTruths: [],
    };

    // ---- (a) NO-CRASH INVARIANT ----
    if (outcome.timedOut) {
      const msg = `${fx.file}: ${outcome.error}`;
      failures.push({ layer: 'no-crash', file: fx.file, detail: outcome.error });
      entry.error = outcome.error;
      report.files.push(entry);
      realLog(`  HANG/TIMEOUT after ${elapsedMs}ms: ${outcome.error}`);
      continue;
    }

    const result = outcome.result;
    const scanners = result.scanners || {};
    const violations = result.violations || [];
    entry.totalViolations = violations.length;
    entry.scannerCount = Object.keys(scanners).length;
    entry.expectedScannerCount = outcome.expectedIds.length;

    for (const id of outcome.expectedIds) {
      const s = scanners[id];
      if (!s) {
        entry.missingScanners.push(id);
        failures.push({ layer: 'no-crash', file: fx.file, scanner: id, detail: 'scanner missing from results entirely' });
      } else if (s.error) {
        entry.scannerErrors.push({ scanner: id, error: s.error });
        failures.push({ layer: 'no-crash', file: fx.file, scanner: id, detail: s.error });
      }
    }
    // The pipeline records a scanner that threw before identifying itself under
    // the id 'unknown'. That is still a crash and must not slip through.
    if (scanners.unknown) {
      entry.scannerErrors.push({ scanner: 'unknown', error: scanners.unknown.error || 'unidentified scanner failure' });
      failures.push({ layer: 'no-crash', file: fx.file, scanner: 'unknown', detail: scanners.unknown.error || 'unidentified scanner failure' });
    }

    // LLM scanners: crash-only assertion, results must be an array.
    for (const [id, s] of Object.entries(scanners)) {
      if (!id.startsWith('llm-')) continue;
      if (typeof s.violationCount !== 'number') {
        failures.push({ layer: 'no-crash', file: fx.file, scanner: id, detail: 'LLM scanner did not return a violations array' });
      }
    }

    // ---- (b) SANITY BAND ----
    if (fx.band) {
      const [lo, hi] = fx.band;
      if (violations.length < lo || violations.length > hi) {
        failures.push({
          layer: 'band',
          file: fx.file,
          detail: `total violations ${violations.length} outside band [${lo}, ${hi}]`,
        });
        entry.bandOk = false;
      } else {
        entry.bandOk = true;
      }
    } else {
      entry.bandOk = null; // recording mode
    }

    // ---- (c) SPOT-TRUTHS ----
    for (const st of fx.spotTruths) {
      let problem = null;
      try {
        problem = st.check({ violations, scanners, result });
      } catch (err) {
        problem = `spot-truth check threw: ${err.message}`;
      }
      entry.spotTruths.push({ name: st.name, kind: st.kind, ok: !problem, detail: problem });
      if (problem) {
        failures.push({ layer: 'spot-truth', file: fx.file, detail: `${st.name} — ${problem}` });
      }
    }

    // Slowness is reported, never swallowed — see PER_FILE_TIMEOUT_MS.
    entry.slow = elapsedMs > SLOW_FILE_MS;

    entry.noise = noise.filter((l) => /error|fail|cannot|undefined|not ready/i.test(l)).slice(0, 40);
    report.files.push(entry);

    const stOk = entry.spotTruths.filter((s) => s.ok).length;
    realLog(
      `  ${violations.length} violations | ${entry.scannerCount}/${entry.expectedScannerCount} scanners | ` +
      `${entry.scannerErrors.length} errors | spot-truths ${stOk}/${entry.spotTruths.length} | ${(elapsedMs / 1000).toFixed(1)}s`
    );
    for (const e of entry.scannerErrors) realLog(`    SCANNER ERROR  ${e.scanner}: ${e.error}`);
    for (const m of entry.missingScanners) realLog(`    SCANNER MISSING ${m}`);
    for (const s of entry.spotTruths.filter((x) => !x.ok)) realLog(`    SPOT-TRUTH FAIL ${s.name}: ${s.detail}`);
  }

  // ---- summary ----
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  report.passed = failures.length === 0;

  console.log('\n=== SUMMARY ===');
  console.log(`profile=${PROFILE}  llm=${llmEnabled ? 'on' : 'off'}  fixtures=${fixtures.length}`);
  console.log('');
  console.log(
    'file'.padEnd(26) + 'viol'.padStart(6) + '  ' + 'band'.padEnd(14) +
    'scanners'.padStart(10) + 'errors'.padStart(8) + 'spot'.padStart(7) + 'time'.padStart(9)
  );
  console.log('-'.repeat(82));
  for (const f of report.files) {
    const band = f.band ? `[${f.band[0]}-${f.band[1]}]${f.bandOk === false ? ' X' : ''}` : '(recording)';
    const spot = f.spotTruths.length ? `${f.spotTruths.filter((s) => s.ok).length}/${f.spotTruths.length}` : '-';
    console.log(
      f.file.padEnd(26) +
      String(f.totalViolations == null ? 'HANG' : f.totalViolations).padStart(6) + '  ' +
      band.padEnd(14) +
      `${f.scannerCount ?? '-'}/${f.expectedScannerCount ?? '-'}`.padStart(10) +
      String(f.scannerErrors.length + f.missingScanners.length).padStart(8) +
      spot.padStart(7) +
      `${(f.elapsedMs / 1000).toFixed(1)}s`.padStart(9)
    );
  }
  console.log('-'.repeat(82));

  if (missing.length) {
    console.log(`\nMISSING FIXTURES (run capture-realworld.js): ${missing.map((m) => m.file).join(', ')}`);
  }

  const slow = report.files.filter((f) => f.slow);
  if (slow.length) {
    console.log(`\nSLOW FILES (> ${SLOW_FILE_MS / 1000}s — not a failure, but a real performance finding):`);
    for (const f of slow) console.log(`  ${f.file}: ${(f.elapsedMs / 1000).toFixed(1)}s`);
  }

  const crashFailures = failures.filter((f) => f.layer === 'no-crash');
  if (crashFailures.length) {
    console.log(`\nSCANNER CRASHES / HANGS (${crashFailures.length}) — these are REAL FINDINGS, not harness bugs:`);
    for (const f of crashFailures) {
      console.log(`  ${f.file} :: ${f.scanner || '(whole file)'}`);
      console.log(`      ${f.detail}`);
    }
  }

  const bandFailures = failures.filter((f) => f.layer === 'band');
  if (bandFailures.length) {
    console.log(`\nBAND FAILURES (${bandFailures.length}):`);
    for (const f of bandFailures) console.log(`  ${f.file}: ${f.detail}`);
  }

  const spotFailures = failures.filter((f) => f.layer === 'spot-truth');
  if (spotFailures.length) {
    console.log(`\nSPOT-TRUTH FAILURES (${spotFailures.length}):`);
    for (const f of spotFailures) console.log(`  ${f.file}: ${f.detail}`);
  }

  console.log(`\nRESULT: ${report.passed ? 'PASS' : `FAIL (${failures.length} failure${failures.length === 1 ? '' : 's'})`}`);
  console.log('=== END SUMMARY ===');

  server.close();

  if (args.json) {
    fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
    fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2));
    console.log(`\nJSON report: ${path.resolve(args.json)}`);
  }

  process.exit(report.passed ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { FIXTURES, findViolations, mentions };
