#!/usr/bin/env node

/**
 * realworld.js: regression harness for the frozen real-world corpus (test-sites/realworld).
 * Runs the full pipeline against each snapshot and asserts (a) no scanner crash or hang,
 * (b) a total violation count inside a recorded band, (c) hand-verified spot-truths.
 *
 * Usage:
 *   node scripts/harness/realworld.js --no-llm
 *   node scripts/harness/realworld.js --json /tmp/realworld.json
 *   node scripts/harness/realworld.js --only med-theme.html
 *
 * LLM scanners run only when OPENROUTER_API_KEY is set and --no-llm was not
 * passed (they cost money); their only assertion is "did not crash, returned an
 * array". Exit code 1 on any failure; the JSON report is written first.
 */

const path = require('path');
const http = require('http');
const fs = require('fs');

const ScanPipeline = require('../../src/core/scan-pipeline');
const { registerAllScanners, getProfile } = require('../../src/core/scanner-registry');

// The snapshots carry no `<!-- WCAG-TEST -->` metadata and live in a
// subdirectory, so the fixture harnesses (which list test-sites non-recursively)
// do not pick them up.
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test-sites', 'realworld');
const PROFILE = 'standard';

/**
 * A hang is a failure, not a timeout to be swallowed. 600s because
 * `responsive-design` alone takes about 350s on wiki-medical-de.html (800 KB,
 * 5101 DOM nodes) and does complete; a genuine hang still fails. Any file over
 * SLOW_FILE_MS is reported as SLOW in the summary and flagged in the JSON.
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
 * @param {string|string[]} [spec.id] - substring(s) matched against ruleId/criterion (any)
 * @param {string|string[]} [spec.selector] - substring(s) matched against selector fields (all)
 * @param {string|string[]} [spec.prose] - substring(s) matched against description/issue (any)
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
// FIXTURES: bands + spot-truths
//
// Bands are [floor(recorded*0.5), ceil(recorded*2)] of the recorded total: a
// crash/explosion alarm, not a precision target. Re-running
// capture-realworld.js invalidates them. Each spot-truth was verified by reading
// the snapshot markup; the evidence is in the comment above it.
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    file: 'own-audit-ui.html',
    source: "http://localhost:3111/audit (this repo's own Next.js frontend)",
    // recorded: 28 total ensemble violations (profile=standard, --no-llm), 32 on
    // another run; run-to-run drift is normal.
    band: [14, 56],
    spotTruths: [
      {
        name: 'REGRESSION: __next-route-announcer__ empty live region NOT flagged',
        kind: 'must-not-flag',
        // Last element before </body> is
        //   <next-route-announcer><p aria-live="assertive"
        //     id="__next-route-announcer__" role="alert"
        //     style="border: 0px; clip: rect(0px, 0px, 0px, 0px); height: 1px;
        //            margin: -1px; overflow: hidden; padding: 0px;
        //            position: absolute; top: 0px; width: 1px; ..."></p>
        //   </next-route-announcer>
        // It is empty by design: Next.js injects the new page title into it on
        // client-side route change. An empty aria-live/role=alert region that a
        // framework fills at runtime is correct, not a violation.
        check: ({ violations }) => {
          const hits = mentions(violations, 'next-route-announcer');
          if (hits.length === 0) return null;
          return (
            `${hits.length} violation(s) flag the Next.js route announcer: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: labelled url input not flagged as unlabelled',
        kind: 'must-not-flag',
        // The form field is properly labelled:
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
          return (
            `input#url (which HAS <label for="url">) flagged: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'REAL: <html lang="de"> contradicts English content / inner lang="en"',
        kind: 'must-detect',
        // The document declares German:
        //   <html lang="de">
        // but every word of content is English ("Web accessibility audit",
        // "Enter the address of a publicly reachable page, choose a scan
        // profile and start the audit.") and the hydrated wrapper immediately
        // re-declares <div class="page" lang="en">. A page whose declared
        // language is not the language of its content is WCAG 3.1.1 (and the
        // nested contradiction is 3.1.2).
        //
        // Known gap: the ensemble does not detect this, so this assertion fails.
        // It stays because the violation is real and hand-verified. Deciding it
        // needs language identification of the running text, which no
        // deterministic check here does; axe validates the syntax of the tag
        // only.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['3.1.1', '3.1.2', 'html-lang', 'valid-lang', 'html-has-lang'],
          });
          if (hits.length > 0) return null;
          return 'no 3.1.1/3.1.2 language violation reported despite lang="de" on an all-English page';
        },
      },
    ],
  },

  {
    file: 'med-theme.html',
    source: 'https://dr-mauermann-urologe.vercel.app',
    // recorded: 44 total ensemble violations (profile=standard, --no-llm) on
    // both runs.
    band: [22, 88],
    spotTruths: [
      {
        name: 'REAL: heading level skips h2 -> h4',
        kind: 'must-detect',
        // In the #services section the document goes
        //   <h2 class="h1" style="margin-bottom:14px">Urologische
        //     Vorsorge&nbsp;&amp; Behandlung</h2>
        //   ... <div class="tile-grid"><div class="tile">
        //   <h4>Vorsorge &amp; Diagnostik</h4>
        // h3 is never used: the outline jumps 2 -> 4. Four <h4> tiles follow
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
        // The only <img> in the document is
        //   <img class="brand__logo" src="/images/c1bee693c1e44f10.png"
        //     alt="Dr. Julian Mauermann - Facharzt für Urologie"
        //     width="44" height="44">
        // Non-empty, descriptive, not filename-ish. Must not be flagged as a
        // missing or inadequate text alternative, even though the src is dead
        // at test time (the image 404s by design).
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['image-alt', 'alt', '1.1.1'],
            selector: 'brand__logo',
          });
          if (hits.length === 0) return null;
          return (
            `logo img (class brand__logo, descriptive alt) flagged: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: <html lang="de"> matches the German content',
        kind: 'must-not-flag',
        // <html lang="de"> and the content is German
        // throughout ("Herzlich willkommen in unserer barrierefreien Ordination
        // im Wohnpark Alt Erlaa."). No missing/invalid lang, no mismatch.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['html-has-lang', 'html-lang-valid', '3.1.1'],
          });
          if (hits.length === 0) return null;
          return (
            `page-language flagged despite a correct <html lang="de">: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
    ],
  },

  {
    file: 'beeproduced.html',
    source: 'https://beeproduced.com',
    // recorded: 379 total ensemble violations (profile=standard, --no-llm), 436
    // on a run where keyboard-navigation did not time out.
    band: [189, 758],
    spotTruths: [
      {
        name: 'REGRESSION: axe-core survives the dead <iframe> and still reports',
        kind: 'must-pass',
        // The document contains
        //   <iframe id="__framer-editorbar" src="./_offline/edit"
        //     aria-hidden="true" allow="autoplay" tabindex="-1"
        //     class="status_hidden">
        // whose src 404s at test time, so the frame never fires `load` and the
        // parent document can sit at readyState 'interactive'. Unhandled, that
        // makes AxePuppeteer throw "Page/Frame is not ready" and report zero
        // violations for an otherwise scannable page. Assert both that it did
        // not error and that it produced findings (a crash that degrades to an
        // empty array would otherwise pass unnoticed).
        check: ({ scanners }) => {
          const s = scanners['axe-core'];
          if (!s) return 'axe-core missing from results entirely';
          if (s.error) return `axe-core returned error: ${s.error}`;
          if (!s.violationCount)
            return 'axe-core reported 0 violations: suspicious silent zero on a dead-iframe page';
          return null;
        },
      },
      {
        name: 'REAL: positive tabindex="1" on 5 elements',
        kind: 'must-detect',
        // The document contains exactly 5 occurrences of
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
        // The document's heading sequence in DOM order is
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
        // The header logo anchor has no text node of its own, but its only
        // child image supplies the name:
        //   <a ... data-framer-name="Logo" tabindex="1" href="./">
        //     <div data-framer-background-image-wrapper="true">
        //       <img decoding="auto" width="299" height="140"
        //         src="./_offline/L1q6sRo7cc7kr6S5uR31PWm4KD0.svg" alt="Logo" ...>
        //     </div></a>
        // So it is not an empty link, although a naive text-content scan of
        // this anchor returns "".
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['link-name', 'empty-link', '2.4.4', '4.1.2'],
            selector: 'framer-1jpi8d1',
          });
          if (hits.length === 0) return null;
          return (
            `logo link (named by <img alt="Logo">) flagged as unnamed: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
    ],
  },

  {
    file: 'wiki-medical-de.html',
    source: 'https://de.wikipedia.org/wiki/Prostatakarzinom',
    // recorded: 1620 total ensemble violations (profile=standard, --no-llm),
    // single run, 415.9s wall clock.
    band: [810, 3240],
    spotTruths: [
      {
        name: 'REAL: images with no alt attribute at all',
        kind: 'must-detect',
        // 12 of the 30 <img> elements carry no alt attribute. 8 of them are
        // in-article figure images (visible body content, not a hideable
        // banner), e.g.
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
        // <html class="client-js vector-feature-..." lang="de"> on a
        // German-language article ("Prostatakarzinom"). Valid BCP-47, matches
        // the content. Scoped to the <html> element: an unscoped 3.1.1 match
        // would also catch the interlanguage-link subtag findings below, which
        // are a different bug.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['html-has-lang', 'html-lang-valid', '3.1.1'],
          }).filter(
            (v) =>
              /(^|[\s|>])html($|[\s|.:[])/i.test(selectorText(v)) ||
              selectorText(v).trim() === 'html'
          );
          if (hits.length === 0) return null;
          return (
            `page-language flagged despite a correct <html lang="de">: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: valid ISO 639-3 subtags on interlanguage links',
        kind: 'must-not-flag',
        // The sidebar interlanguage links each declare the
        // target wiki's language, e.g.
        //   <a href="https://arz.wikipedia.org/wiki/..."
        //      title="سرطان بروستاتا - Ägyptisches Arabisch"
        //      lang="arz" hreflang="arz"
        //      data-language-local-name="Ägyptisches Arabisch"
        //      class="interlanguage-link-target"><span>مصرى</span></a>
        // and likewise lang="bcl" hreflang="bcl", "ckb", "gpe", "new", "rki",
        // "wuu", "yue". Every one of those is a registered ISO 639-3 primary
        // language subtag (Egyptian Arabic, Central Bikol, Central Kurdish,
        // Ghanaian Pidgin, Newari, Rakhine, Wu Chinese, Cantonese) and hence
        // valid BCP-47. Rejecting them is a false positive.
        //
        // This is the same underlying bug modern-commercial.html reproduces,
        // but it surfaces through a different code path: here it is reported
        // as 3.1.1 "Invalid lang attribute value", there as 3.1.2 "Element has
        // invalid language code". Both are asserted so a partial fix is visible.
        check: ({ violations }) => {
          const hits = violations.filter(
            (v) =>
              /"(arz|bcl|ckb|gpe|new|rki|wuu|yue|ast|dsb|hsb)"/i.test(
                `${v.issue || ''} ${v.description || ''}`
              ) && /invalid/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length === 0) return null;
          return (
            `${hits.length} valid ISO 639-3 subtag(s) reported as invalid: ` +
            hits
              .slice(0, 6)
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: inline <span lang="en"> correctly marks a language change',
        kind: 'must-not-flag',
        // The sister-projects box marks its English label
        //   <span lang="en">Commons</span>
        // (2 occurrences). A correctly declared inline language change must not
        // be reported as a WCAG 3.1.2 "language of parts" violation.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['3.1.2'] }).filter(
            (v) => /commons/i.test(selectorText(v)) || /commons/i.test(proseText(v))
          );
          if (hits.length === 0) return null;
          return (
            `correctly-marked <span lang="en">Commons</span> flagged as a 3.1.2 violation: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'REAL: data table has a completely empty <th> corner cell',
        kind: 'must-detect',
        // The PSA-screening comparison table opens with an empty corner header:
        //   <table class="wikitable" id="mwAU8">
        //     <caption id="mwAVA">Im Verlauf von 21 Jahren haben 1000 Männer
        //       im Alter von 55-69 Jahren ...</caption>
        //     <tbody id="mwAVE"><tr id="mwAVI">
        //       <th id="mwAVM"></th>
        //       <th id="mwAVQ">Diagnose PK</th>
        //       <th id="mwAVU">Diagnose Metastasen</th>
        //       <th id="mwAVY">Tod durch PK</th></tr>
        // <th id="mwAVM"> has no text, no aria-label, no title, so the row-header
        // column is unnamed. WCAG 1.3.1 / axe `empty-table-header`. This is the
        // table-structure signal the article was chosen for (6 tables, ~330,000
        // characters of text).
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
    // recorded: 223 total ensemble violations (profile=standard, --no-llm) on
    // both runs.
    band: [111, 446],
    spotTruths: [
      {
        name: 'REAL: a literal <blink> element in the navigation',
        kind: 'must-detect',
        // Exactly one occurrence in the document, used as a layout shim at the
        // end of the nav container:
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
        // Of 23 <img> elements, none lacks an alt attribute and 19 use alt="",
        // correct for purely decorative product/menu icons
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
          return (
            `decorative alt="" menu icons flagged as missing alt: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: heading whose accessible name comes from an image alt',
        kind: 'must-not-flag',
        // Of the 31 <h2> elements in this document exactly one has empty
        // textContent: the footer advertising heading, which is named entirely
        // by its child image:
        //   <h2>
        //     <img src="./_offline/Mozilla_Ads_Logo.6ed26d0eac2b.svg"
        //       alt="Mozilla Anzeigen" width="250" height="33"
        //       class="moz24-footer-advertising-logo">
        //   </h2>
        // textContent is whitespace, but the accessible name is "Mozilla
        // Anzeigen", so it is not an empty heading. Because it is the only
        // text-empty h2 in the document, any "empty heading" violation on an
        // h2 here necessarily refers to it. (A naive textContent check reports
        // it as empty.)
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            prose: ['empty heading', 'heading element is empty', 'heading "[empty]"'],
          }).filter((v) => /(^|[^a-z])h2/i.test(selectorText(v)));
          if (hits.length === 0) return null;
          return (
            `the only text-empty h2 (named by <img alt="Mozilla Anzeigen">) flagged as an empty heading: ` +
            hits
              .map(
                (v) =>
                  `[${v.scannerId}/${v.ruleId || v.criterion}] ${selectorText(v)} :: ${v.description || v.issue}`
              )
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: nav logo link is named by its inner img alt',
        kind: 'must-not-flag',
        // The header logo link has no text node but its only child image
        // supplies the accessible name:
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
          return (
            `logo link (named by <img alt="Mozilla">) flagged as unnamed: ` +
            hits
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
      {
        name: 'CLEAN: valid 3-letter BCP-47 subtags are not "invalid language codes"',
        kind: 'must-not-flag',
        // The language picker declares each option in its
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
            (v) =>
              /invalid.*(language|lang).*(code|tag)|language code/i.test(
                `${v.issue || ''} ${v.description || ''} ${v.ruleId || ''}`
              ) &&
              /"(ast|cak|dsb|hsb|lij|skr|trs|kab|sco|gpe)"/i.test(
                `${v.issue || ''} ${v.description || ''}`
              )
          );
          if (hits.length === 0) return null;
          return (
            `${hits.length} valid ISO 639-3 subtag(s) reported as invalid language codes: ` +
            hits
              .slice(0, 5)
              .map((v) => `[${v.scannerId}/${v.ruleId || v.criterion}] ${v.description || v.issue}`)
              .join('; ')
          );
        },
      },
    ],
  },

  {
    file: 'gov-uk-guide.html',
    source: 'https://www.gov.uk/vehicle-tax',
    // recorded: 16 total ensemble violations (profile=standard, --no-llm).
    band: [8, 32],
    spotTruths: [
      {
        name: 'REGRESSION: static prose about timeouts is not auto-updating content',
        kind: 'must-not-flag',
        // Nothing on this page updates itself. The section "If you live in
        // Northern Ireland" used to make every ancestor of that sentence an
        // auto-updating region without a pause control, because the word
        // "live" appeared in the text.
        check: ({ violations }) => {
          const hits = findViolations(violations, {
            id: ['2.2.2'],
            prose: ['auto-updating', 'pause or stop'],
          });
          if (hits.length === 0) return null;
          return (
            `${hits.length} auto-update finding(s) on a page with no auto-updating content: ` +
            hits
              .slice(0, 5)
              .map((v) => `[${v.criterion}] ${v.element}`)
              .join('; ')
          );
        },
      },
      {
        name: 'REGRESSION: the spam honeypot field is not audited',
        kind: 'must-not-flag',
        // The feedback form carries
        //   <div class="govuk-visually-hidden" aria-hidden="true">
        //     <label for="giraffe">This field is for robots only. Please leave blank</label>
        //     <input id="giraffe" name="giraffe" type="text" pattern=".{0}"
        //       tabindex="-1" autocomplete="off">
        // It is hidden from everyone and deliberately out of the tab order, so
        // it needs no format hint and its tabindex is not a defect.
        check: ({ violations }) => {
          const hits = mentions(violations, '#giraffe');
          if (hits.length === 0) return null;
          return (
            `${hits.length} finding(s) about the hidden honeypot input: ` +
            hits.map((v) => `[${v.criterion || v.ruleId}] ${v.issue || v.description}`).join('; ')
          );
        },
      },
      {
        name: 'REGRESSION: aria-autocomplete is a valid ARIA attribute',
        kind: 'must-not-flag',
        // The site search field declares
        //   <input class="gem-c-search-with-autocomplete__input" role="combobox"
        //     aria-autocomplete="list" aria-expanded="false" ...>
        // aria-autocomplete has been part of WAI-ARIA since 1.0.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /aria-autocomplete/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length === 0) return null;
          return `aria-autocomplete reported as invalid ${hits.length} time(s)`;
        },
      },
      {
        name: 'REGRESSION: the icon search button is not a 2.5.3 failure',
        kind: 'must-not-flag',
        // <button id="super-search-menu-toggle" aria-label="Show search menu">
        //   <span class="govuk-visually-hidden">Search GOV.UK</span><svg .../>
        // The only text in the button is screen-reader-only, so there is no
        // visible label that the accessible name would have to contain.
        check: ({ violations }) => {
          const hits = mentions(violations, 'super-search-menu-toggle').filter((v) =>
            /label|name/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length === 0) return null;
          return `icon search button flagged: ${hits.map((v) => v.description || v.issue).join('; ')}`;
        },
      },
      {
        name: 'REAL: the accessibility statement link is dead in this snapshot',
        kind: 'must-detect',
        // The footer links /help/accessibility-statement, which is not part of
        // the capture, so it answers 404. The finding must be about the broken
        // link, not three claims about content nobody could read.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['EAA-Statement'] });
          if (hits.length === 0) return 'no accessibility-statement finding at all';
          const rules = new Set(hits.map((v) => v.issue));
          if (!rules.has('inaccessible-statement'))
            return `expected inaccessible-statement, got: ${[...rules].join(', ')}`;
          return null;
        },
      },
    ],
  },

  {
    file: 'webaim-article.html',
    source: 'https://webaim.org/techniques/skipnav/',
    // recorded: 44 total ensemble violations (profile=standard, --no-llm).
    band: [22, 88],
    spotTruths: [
      {
        name: 'REGRESSION: article links are not skip links',
        kind: 'must-not-flag',
        // The page is about skip links, so many of its links carry the word in
        // their text or path, e.g.
        //   <a href="/techniques/css/invisiblecontent/">Temporarily hidden skip links</a>
        // Only the real skip link, <a href="#maincontent">, moves focus inside
        // the page; a link to another page cannot point at a missing fragment.
        check: ({ violations }) => {
          const hits = violations.filter(
            (v) => v.issue === 'skip-link' && /non-existent target/i.test(v.description || '')
          );
          if (hits.length === 0) return null;
          return (
            `${hits.length} article link(s) treated as broken skip links: ` +
            hits.map((v) => v.description).join('; ')
          );
        },
      },
      {
        name: 'REGRESSION: an article about accessibility is not an accessibility statement',
        kind: 'must-not-flag',
        // "Introduction to Web Accessibility" (/intro) was resolved as the
        // site's accessibility statement and then audited for a review date, a
        // conformance level and a contact point.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['EAA-Statement'] }).filter((v) =>
            ['outdated-statement', 'incomplete-content', 'missing-contact'].includes(v.issue)
          );
          if (hits.length === 0) return null;
          return `statement content audited although no statement is linked: ${hits.map((v) => v.issue).join(', ')}`;
        },
      },
      {
        name: 'REGRESSION: timing-controls completes without error',
        kind: 'must-pass',
        // The scanner dereferenced parentElement on the html element while
        // walking every node of this page, and died with "Cannot read
        // properties of null (reading 'querySelector')".
        check: ({ scanners }) => {
          const s = scanners['timing-controls'];
          if (!s) return 'timing-controls missing from results entirely';
          if (s.error) return `timing-controls returned error: ${s.error}`;
          return null;
        },
      },
      {
        name: 'REAL: the WAVE url field has a low contrast boundary',
        kind: 'must-detect',
        // <input type="url" id="waveurl"> renders with a 1px #cccccc border
        // against a #e5e6eb page background (1.29:1) and a white fill against
        // that same background (1.25:1). Both are below the 3:1 that WCAG
        // 1.4.11 asks of the visual boundary of a control.
        check: ({ violations }) => {
          const hits = mentions(violations, 'waveurl').filter((v) =>
            /contrast/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length > 0) return null;
          return 'no 1.4.11 finding for the #cccccc border of input#waveurl on #e5e6eb';
        },
      },
    ],
  },

  {
    file: 'govuk-design-system.html',
    source: 'https://design-system.service.gov.uk/components/text-input/',
    // recorded: 124 total ensemble violations (profile=standard, --no-llm).
    band: [62, 248],
    spotTruths: [
      {
        name: 'REGRESSION: iframes are not reported as missing a focus indicator',
        kind: 'must-not-flag',
        // Every live example is an <iframe class="app-example__frame">. An
        // iframe takes focus, but the ring the browser draws is inside the
        // embedded document, where the host page's computed styles cannot see
        // it, so its absence cannot be asserted from here.
        check: ({ violations }) => {
          const hits = violations.filter(
            (v) =>
              v.issue === 'no-visible-focus' &&
              /iframe|iframeresizer/i.test(`${v.element || ''} ${v.selector || ''}`)
          );
          if (hits.length === 0) return null;
          return `${hits.length} iframe(s) reported as having no focus indicator`;
        },
      },
      {
        name: 'REGRESSION: a dropdown panel is not an unlabelled accordion panel',
        kind: 'must-not-flag',
        // The mobile navigation toggles
        //   <div id="app-mobile-navigation" ...>
        // through aria-controls. A disclosure panel is not a landmark and needs
        // no aria-labelledby of its own; only a panel with role="region" does.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /accordion panel/i.test(`${v.description || ''} ${v.issue || ''}`)
          );
          if (hits.length === 0) return null;
          return `${hits.length} disclosure panel(s) reported as unlabelled accordion panels`;
        },
      },
      {
        name: 'REAL: the example tabs never say which tab is selected',
        kind: 'must-detect',
        // Each example is
        //   <ul class="app-tabs" role="tablist">
        //     <li role="presentation"><a role="tab" aria-controls="..."
        //       aria-expanded="false">HTML</a></li>
        //     ... Nunjucks ...
        // The tabs use aria-expanded instead of aria-selected, so no tab in
        // any tablist on the page is marked selected. WCAG 4.1.2.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /aria-selected|selected tab/i.test(`${v.description || ''} ${v.issue || ''}`)
          );
          if (hits.length > 0) return null;
          return 'no finding about tabs without aria-selected';
        },
      },
    ],
  },

  {
    file: 'a11y-project-checklist.html',
    source: 'https://www.a11yproject.com/checklist/',
    // recorded: 22 total ensemble violations (profile=standard, --no-llm).
    band: [11, 44],
    spotTruths: [
      {
        name: 'REGRESSION: a checklist about timeouts does not have a timeout',
        kind: 'must-not-flag',
        // The checklist item
        //   <summary id="allow-extending-session-timeouts">
        // made the page look like it ran a session that expires without warning
        // and without a way to extend it. Nothing on the page counts down.
        check: ({ violations }) => {
          const hits = findViolations(violations, { id: ['2.2.1', '2.2.6'] });
          if (hits.length === 0) return null;
          return (
            `${hits.length} time-limit finding(s) on a page with no time limit: ` +
            hits.map((v) => `${v.issue}`).join(', ')
          );
        },
      },
      {
        name: 'REGRESSION: the site name is not its accessibility statement',
        kind: 'must-not-flag',
        // The masthead link <a class="c-logo__link" href="/">The A11Y Project</a>
        // matched the keyword "a11y" and was followed as the statement.
        check: ({ violations }) => {
          const hits = mentions(violations, 'c-logo__link');
          if (hits.length === 0) return null;
          return `the site logo link was audited as an accessibility statement: ${hits.map((v) => v.issue).join(', ')}`;
        },
      },
      {
        name: 'REAL: the skip link has no focus indicator of its own',
        kind: 'must-detect',
        // <a class="u-text-transform-uppercase c-skipnav" href="#main">Skip to
        // content.</a> comes into view on focus but draws no outline, box
        // shadow or background change (outline: none 0px, box-shadow: none,
        // confirmed by a blur comparison). WCAG 2.4.7.
        check: ({ violations }) => {
          const hits = mentions(violations, 'c-skipnav').filter((v) =>
            /focus/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length > 0) return null;
          return 'no 2.4.7 finding for the skip link that shows no focus indicator';
        },
      },
    ],
  },

  {
    file: 'broadcaster-news.html',
    source: 'https://www.bbc.com/news',
    // recorded: 182 total ensemble violations (profile=standard, --no-llm).
    band: [91, 364],
    spotTruths: [
      {
        name: 'REGRESSION: a described photograph is not a defect',
        kind: 'must-not-flag',
        // The front page carries around 20 <img class="Image-styles__ImageStyled...">
        // whose alt text runs to 130 to 160 characters because the picture is
        // worth describing. WCAG sets no length limit.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /alt text (is )?too long/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length === 0) return null;
          return `${hits.length} descriptive alt attribute(s) reported as too long`;
        },
      },
      {
        name: 'REGRESSION: a photograph is not a complex data visualisation',
        kind: 'must-not-flag',
        // "photograph" contains "graph", which made every news picture a chart
        // that needs a long description.
        check: ({ violations }) => {
          const hits = violations.filter((v) => v.issue === 'complex-img-alt');
          if (hits.length === 0) return null;
          return `${hits.length} photograph(s) reported as complex images`;
        },
      },
      {
        name: 'REGRESSION: a display:none iframe needs no title',
        kind: 'must-not-flag',
        // The snapshot holds four <iframe> elements. The two without a title
        // are the consent library's `__tcfapiLocator` and `__gppLocator`
        // frames, both `style="display: none"`, so they are not in the
        // accessibility tree and a name would never be announced. The two that
        // are exposed both carry a title. This spot-truth was recorded as
        // "three iframes have no title" from html-validation, whose frame-title
        // rule demanded a literal title attribute on every frame including the
        // hidden ones; axe-core frame-title exempts them, which is correct.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /frame-title|frame or iframe lacks a title/i.test(
              `${v.issue || ''} ${v.ruleId || ''} ${v.description || ''}`
            )
          );
          if (hits.length === 0) return null;
          return `${hits.length} hidden iframe(s) reported as lacking a title`;
        },
      },
    ],
  },

  {
    file: 'wiki-accessibility-en.html',
    source: 'https://en.wikipedia.org/wiki/Web_accessibility',
    // recorded: 500 total ensemble violations (profile=standard, --no-llm).
    band: [250, 1000],
    spotTruths: [
      {
        name: 'REGRESSION: a link title that summarises its target is not 1.4.13 content',
        kind: 'must-not-flag',
        // Every article link carries a title with a summary of the target
        // page, e.g. <a href="/wiki/Screen_reader" title="Screen reader">. The
        // tooltip a browser draws from title is user agent content, and the
        // links are named by their own text, so nothing here is content on
        // hover that the user must be able to dismiss.
        check: ({ violations }) => {
          const hits = violations.filter((v) => v.issue === 'title-attribute-as-content');
          if (hits.length <= 5) return null;
          return `${hits.length} title attributes reported as hover content on a page of wiki links`;
        },
      },
      {
        name: 'REAL: the navbox view/talk/edit links read as "v", "t", "e"',
        kind: 'must-detect',
        // The template navboxes end with three single letter links
        //   <a ...>v</a> <a ...>t</a> <a ...>e</a>
        // whose purpose cannot be determined from their text. WCAG 2.4.4.
        check: ({ violations }) => {
          const hits = violations.filter(
            (v) => v.issue === 'ambiguous-link' && /"[vte]"/.test(v.description || '')
          );
          if (hits.length > 0) return null;
          return 'no 2.4.4 finding for the single letter navbox links';
        },
      },
      {
        name: 'REAL: the search field is labelled only by its placeholder',
        kind: 'must-detect',
        // <input name="search" placeholder="Search Wikipedia"> has no label
        // element, no aria-label and no aria-labelledby, so its accessible
        // name is empty once the placeholder is replaced by typed text.
        check: ({ violations }) => {
          const hits = violations.filter((v) =>
            /placeholder/i.test(`${v.issue || ''} ${v.description || ''}`)
          );
          if (hits.length > 0) return null;
          return 'no finding for the search input whose only label is its placeholder';
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

/**
 * Static server over the fixture directory. 404s are expected: every
 * ./_offline/* path is a dead resource, and scanning against missing
 * images/fonts/scripts is part of the test.
 */
function startServer(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const filePath = path.join(dir, rel);
    // Refuse to escape the fixture directory.
    if (
      !filePath.startsWith(dir) ||
      !rel ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
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
      console.log(
        'Usage: node scripts/harness/realworld.js [--no-llm] [--only <file>] [--json <path>]'
      );
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
      () =>
        rej(
          new Error(
            `WALL-CLOCK TIMEOUT after ${PER_FILE_TIMEOUT_MS}ms: treated as a hang, not a soft skip`
          )
        ),
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

  // `includeExperimental: true`: the default profiles quarantine unproven
  // scanners, but the no-crash invariant below is the evidence a quarantined
  // scanner needs to be promoted, and the crash it is quarantined for must stay
  // visible until it is fixed.
  const { scannerIds: profileIds, options: profileOptions } = getProfile(PROFILE, {
    includeExperimental: true,
  });
  const scannerIds =
    profileIds && args.noLlm ? profileIds.filter((id) => !id.startsWith('llm-')) : profileIds;

  let fixtures = FIXTURES.filter((f) => fs.existsSync(path.join(FIXTURE_DIR, f.file)));
  const missing = FIXTURES.filter((f) => !fs.existsSync(path.join(FIXTURE_DIR, f.file)));
  if (args.only)
    fixtures = fixtures.filter((f) => f.file === args.only || f.file === `${args.only}.html`);

  if (fixtures.length === 0) {
    console.error(`No fixtures to run. Did you run: node scripts/capture-realworld.js ?`);
    process.exit(1);
  }

  const { server, port } = await startServer(FIXTURE_DIR);
  console.log(`Serving ${FIXTURE_DIR} on http://localhost:${port}`);
  console.log(
    `Profile: ${PROFILE} | LLM scanners: ${llmEnabled ? 'ENABLED' : 'disabled'} | fixtures: ${fixtures.length}\n`
  );

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
    // Per-scanner violation counts: the band is a total, so a scanner that
    // trades false positives for false negatives stays invisible in it. Read
    // from the per-scanner summaries, because only axe-core stamps its id onto
    // each violation.
    entry.perScanner = {};
    for (const [id, s] of Object.entries(scanners)) {
      if (s && typeof s.violationCount === 'number' && s.violationCount > 0) {
        entry.perScanner[id] = s.violationCount;
      }
    }
    entry.expectedScannerCount = outcome.expectedIds.length;

    for (const id of outcome.expectedIds) {
      const s = scanners[id];
      if (!s) {
        entry.missingScanners.push(id);
        failures.push({
          layer: 'no-crash',
          file: fx.file,
          scanner: id,
          detail: 'scanner missing from results entirely',
        });
      } else if (s.error) {
        entry.scannerErrors.push({ scanner: id, error: s.error });
        failures.push({ layer: 'no-crash', file: fx.file, scanner: id, detail: s.error });
      }
    }
    // The pipeline records a scanner that threw before identifying itself under
    // the id 'unknown'. That is still a crash and must not slip through.
    if (scanners.unknown) {
      entry.scannerErrors.push({
        scanner: 'unknown',
        error: scanners.unknown.error || 'unidentified scanner failure',
      });
      failures.push({
        layer: 'no-crash',
        file: fx.file,
        scanner: 'unknown',
        detail: scanners.unknown.error || 'unidentified scanner failure',
      });
    }

    // LLM scanners: crash-only assertion, results must be an array.
    for (const [id, s] of Object.entries(scanners)) {
      if (!id.startsWith('llm-')) continue;
      if (typeof s.violationCount !== 'number') {
        failures.push({
          layer: 'no-crash',
          file: fx.file,
          scanner: id,
          detail: 'LLM scanner did not return a violations array',
        });
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
        failures.push({ layer: 'spot-truth', file: fx.file, detail: `${st.name}: ${problem}` });
      }
    }

    // Slowness is reported, never swallowed (see PER_FILE_TIMEOUT_MS).
    entry.slow = elapsedMs > SLOW_FILE_MS;

    entry.noise = noise
      .filter((l) => /error|fail|cannot|undefined|not ready/i.test(l))
      .slice(0, 40);
    report.files.push(entry);

    const stOk = entry.spotTruths.filter((s) => s.ok).length;
    realLog(
      `  ${violations.length} violations | ${entry.scannerCount}/${entry.expectedScannerCount} scanners | ` +
        `${entry.scannerErrors.length} errors | spot-truths ${stOk}/${entry.spotTruths.length} | ${(elapsedMs / 1000).toFixed(1)}s`
    );
    for (const e of entry.scannerErrors) realLog(`    SCANNER ERROR  ${e.scanner}: ${e.error}`);
    for (const m of entry.missingScanners) realLog(`    SCANNER MISSING ${m}`);
    for (const s of entry.spotTruths.filter((x) => !x.ok))
      realLog(`    SPOT-TRUTH FAIL ${s.name}: ${s.detail}`);
  }

  // ---- summary ----
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  report.passed = failures.length === 0;

  console.log('\n=== SUMMARY ===');
  console.log(`profile=${PROFILE}  llm=${llmEnabled ? 'on' : 'off'}  fixtures=${fixtures.length}`);
  console.log('');
  console.log(
    'file'.padEnd(26) +
      'viol'.padStart(6) +
      '  ' +
      'band'.padEnd(14) +
      'scanners'.padStart(10) +
      'errors'.padStart(8) +
      'spot'.padStart(7) +
      'time'.padStart(9)
  );
  console.log('-'.repeat(82));
  for (const f of report.files) {
    const band = f.band
      ? `[${f.band[0]}-${f.band[1]}]${f.bandOk === false ? ' X' : ''}`
      : '(recording)';
    const spot = f.spotTruths.length
      ? `${f.spotTruths.filter((s) => s.ok).length}/${f.spotTruths.length}`
      : '-';
    console.log(
      f.file.padEnd(26) +
        String(f.totalViolations == null ? 'HANG' : f.totalViolations).padStart(6) +
        '  ' +
        band.padEnd(14) +
        `${f.scannerCount ?? '-'}/${f.expectedScannerCount ?? '-'}`.padStart(10) +
        String(f.scannerErrors.length + f.missingScanners.length).padStart(8) +
        spot.padStart(7) +
        `${(f.elapsedMs / 1000).toFixed(1)}s`.padStart(9)
    );
  }
  console.log('-'.repeat(82));

  if (missing.length) {
    console.log(
      `\nMISSING FIXTURES (run capture-realworld.js): ${missing.map((m) => m.file).join(', ')}`
    );
  }

  const slow = report.files.filter((f) => f.slow);
  if (slow.length) {
    console.log(
      `\nSLOW FILES (> ${SLOW_FILE_MS / 1000}s, not a failure but a performance finding):`
    );
    for (const f of slow) console.log(`  ${f.file}: ${(f.elapsedMs / 1000).toFixed(1)}s`);
  }

  const crashFailures = failures.filter((f) => f.layer === 'no-crash');
  if (crashFailures.length) {
    console.log(
      `\nSCANNER CRASHES / HANGS (${crashFailures.length}), real findings, not harness bugs:`
    );
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

  console.log(
    `\nRESULT: ${report.passed ? 'PASS' : `FAIL (${failures.length} failure${failures.length === 1 ? '' : 's'})`}`
  );
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
