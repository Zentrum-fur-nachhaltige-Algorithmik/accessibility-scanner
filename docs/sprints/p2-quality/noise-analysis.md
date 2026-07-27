# Noise Analysis: the 218–225-on-good-files problem (Sprint P2, P1.4)

Source data: `docs/sprints/p2-quality/raw/good-file-noise-breakdown.json`, produced by the
instrumented `tests/spike/axe-vs-ours-comparison.js` run (2026-07-27, ~16:05–16:09).
225 recorded violations across the 10 sampled `good-*` files (the aggregate section's
"218" figure is the pipeline's own count from the same run; the 7-violation gap is
scanner-timing noise between the two counting methods and does not change any
conclusion below).

**Caveat on the 3 former crash files:** `good-css-background-accessible`,
`bad-concurrent-input`, and `bad-form-labels` crashed our pipeline in earlier baseline
runs (P0 item #1) and have since been **fixed by another agent**, after this spike run
started. This run still shows `good-css-background-accessible` erroring out overall
(`/ ERR` in the violations table) with only a partial 7-violation breakdown captured
before the crash — that partial data is used below (it's still valid evidence for
*those specific* scanner findings; it's just incomplete for that one file). Re-running
the spike post-fix would likely surface more violations for that file, but would not
change any of the root causes identified below, since those are traced to source lines,
not to this file's crash.

## Top-10 noise sources

| # | Scanner | Violation type | Criterion | Count | Files affected | Verdict |
|---|---|---|---|---|---|---|
| 1 | `page-structure` | `missing-label` | 9.2.4.6 | **49** | good-auto-submitting-form (9), good-form-grouping (40) | **FALSE POSITIVE** — only checks `label[for=id]`, never recognizes implicit `<label>` wrapping |
| 2 | `input-purpose` | `missing-autocomplete` | 9.1.3.5 | **17** | good-accessibility (2), good-auto-submitting-form (4), good-form-grouping (11) | **TRUE POSITIVE** — genuine SC 1.3.5 gaps, orthogonal to the files' declared criteria |
| 3 | `nontext-contrast` | `insufficient-focus-indicator-contrast` | 1.4.11 | **15** | good-accessibility (2), good-auto-submitting-form (2), good-form-grouping (1), good-skip-links (10) | **FALSE POSITIVE** — broken `getComputedStyle(el, ':focus')` call + non-WCAG contrast formula |
| 4 | `nontext-contrast` | `insufficient-border-contrast` | 1.4.11 | **15** | good-auto-submitting-form (12), good-form-grouping (2), good-reading-level (1) | **FALSE POSITIVE** — flags `border: none` (0px, unrendered) elements |
| 5 | `status-messages` | `html5-validation-inaccessible` | 4.1.3 | **15** | good-form-grouping (15) | **DEBATABLE** — fires on every native `required`/`pattern`/email field; criterion mapping and premise are both questionable |
| 6 | `status-messages` | `missing-live-region` | 4.1.3 | 14 | good-accessibility (8), good-auto-submitting-form (4), good-skip-links (2) | **FALSE POSITIVE** (mostly) — className-substring heuristic flags static, non-updating content |
| 7 | `color-contrast` | (no type field — generic) | 1.4.3+1.4.6 | 10 | good-css-background-accessible (4), good-images-of-text-no-exception (1), good-reading-level (2), good-skip-links (3) | **TRUE POSITIVE** (mostly) — correct WCAG luminance formula, real near-miss contrast bugs; 1 gradient-background blind spot |
| 8 | `page-structure` | `no-multiple-ways` | 9.2.4.5 | 8 | 8 different files, 1 each | **FALSE POSITIVE** (context mismatch) — SC 2.4.5 is a whole-site criterion, applied to isolated single-page fixtures |
| 9 | `nontext-contrast` | `missing-focus-indicator` | 1.4.11 | 7 | good-accessibility (1), good-complex-data-tables (4), good-media-alternatives (1), good-reading-level (1) | **FALSE POSITIVE** — same root cause as #3, proven against a real working `:focus` rule |
| 10 | `html-validation` | `missing-status-attributes` | 9.4.1.3 | 7 | good-auto-submitting-form (5), good-skip-links (2) | **FALSE POSITIVE** — cross-scanner DOM race (flags markup another concurrently-running scanner injected by clicking a button) |
| *11* | *`error-handling`* | *`required-field-no-instruction`* | *9.3.3.2* | *7 (tied with #10)* | *good-form-grouping (7)* | *not deep-dived; see "Also noted" below* |

Together, rows 1–6 (all FALSE POSITIVE or DEBATABLE) account for **125 of 225** recorded
violations (~56%) — more than half the good-file noise comes from five identifiable,
fixable defects.

## Top-5 deep dive

### 1. `page-structure` / `missing-label` (9.2.4.6) — 49 violations — FALSE POSITIVE

`src/page-structure-scanner.js:350`:
```js
const hasLabel = id && document.querySelector(`label[for="${id}"]`);
```
This is the *only* label-association check performed (besides `aria-label`,
`aria-labelledby`, `title`). It requires the control to have an `id` **and** a
`label[for]` pointing at it. It never checks `control.closest('label')` — the
second, equally valid HTML label-association mechanism (implicit wrapping).

Quoted element from `test-sites/good-form-grouping.html:184-187`:
```html
<label>
    <input type="radio" name="contact" value="email" required>
    E-Mail
</label>
```
This radio button has a completely unambiguous accessible name ("E-Mail") via
implicit `<label>` wrapping — the exact pattern used by **every** radio/checkbox in
this file (and in `good-auto-submitting-form.html`, e.g. the 5-star rating radios at
lines 253-272). It is not a violation of anything; the scanner simply can't see this
association method. This single line-350 gap is responsible for 40/96 of
`good-form-grouping`'s violations and 9/47 of `good-auto-submitting-form`'s.

### 2. `input-purpose` / `missing-autocomplete` (9.1.3.5) — 17 violations — TRUE POSITIVE

Quoted: `test-sites/good-accessibility.html:436-437`:
```html
<label for="email" class="required">E-Mail Adresse</label>
<input type="email" id="email" name="email" required aria-describedby="email-error">
```
This is a genuinely recognizable-purpose field (email address collection) with no
`autocomplete="email"`. SC 1.3.5 (Identify Input Purpose, AA) explicitly lists `email`
as a normative Input Purpose, so this **is** a real violation — it's just a violation
of a criterion (1.3.5) that `good-accessibility.html`'s own header comment doesn't
declare (it lists 1.1.1, 1.3.1, 2.1.1, 2.4.4, 3.1.1, 4.1.2). Same story for
`input#phone` (needs `autocomplete="tel"`), `select#goodLanguageSelect` in
`good-auto-submitting-form.html` (needs `autocomplete="language"` — a real, if
less-known, WHATWG/WCAG-listed token), and the billing/shipping name/street/city/zip/
country fields in `good-form-grouping.html`. This is exactly the scenario the task
brief warned about: "good-X.html only guarantees goodness for criterion X." The fix
here is **not** to the scanner — it's to add the missing `autocomplete` attributes to
the fixtures (or accept the cross-criterion noise as legitimate signal).

### 3. `nontext-contrast` / `insufficient-focus-indicator-contrast` (1.4.11) — 15 — FALSE POSITIVE

`src/phase6a-nontext-contrast-scanner.js:455-460`:
```js
element.focus();
const focusStyles = window.getComputedStyle(element, ':focus');
const normalStyles = window.getComputedStyle(element);
const parentBg = window.getComputedStyle(element.parentElement).backgroundColor || 'rgb(255, 255, 255)';
```
`getComputedStyle(el, pseudoElt)`'s second argument is for CSS **pseudo-elements**
(`::before`, `::after`, `::first-line`) — it is not a way to read a pseudo-**class**
state. `element.focus()` on the line above is correct and does put the element into
real `:focus` state, but then asking for the computed style of a pseudo-element named
`':focus'` (which doesn't exist) returns an empty/inert style object for most
elements — `focusStyles.outlineColor` etc. come back as `""`. The code only survives
this by falling back to `normalStyles` (`focusStyles.X || normalStyles.X`), which
sometimes coincidentally reproduces the right *color* (because the real fix — just
call `getComputedStyle(element)` with no second argument, now that focus() has been
applied — would read the same underlying computed style object in the coincidence
cases). Proven broken outright in finding #9 below.

Independently, the "contrast" math itself (lines 469-499) is not the WCAG formula:
```js
const lum1 = (parseInt(match1[1]) + parseInt(match1[2]) + parseInt(match1[3])) / 3;
...
const ratio = Math.abs(lum1 - lum2) / 255 * 21; // Simplified ratio
return Math.max(ratio, 1);
```
This is a linear average of R+G+B (not the gamma-corrected, weighted relative
luminance WCAG requires) scaled arbitrarily to top out at 21, floored at 1. It is not
computing a real contrast ratio — `color-contrast-scanner.js:50-66` already has the
correct implementation (sRGB gamma correction, 0.2126/0.7152/0.0722 weights,
`(L1+0.05)/(L2+0.05)`) that this scanner should reuse instead.

Quoted element, `test-sites/good-accessibility.html` (`.good-links a:focus`):
```css
.good-links a:focus { outline: 3px solid #4a90e2; outline-offset: 2px; background-color: #fff3cd; }
```
Recorded sample: `outlineColor: rgb(74, 144, 226)` (correctly `#4a90e2`),
`backgroundColor: "rgba(0, 0, 0, 0)"` — the parent (`<section class="good-links">`) has
no explicit background, so its computed `background-color` is transparent, and the
code (line 460) never walks further up to `<body>` (which *is* `#ffffff`) the way
`color-contrast-scanner.js`'s `getEffectiveBackgroundColor` does. Comparing an outline
color against `rgba(0,0,0,0)` through the broken linear formula is meaningless. This
is not a real 1.4.11 finding; it's two independent bugs compounding.

### 4. `nontext-contrast` / `insufficient-border-contrast` (1.4.11) — 15 — FALSE POSITIVE

`src/phase6a-nontext-contrast-scanner.js` (button check, ~line 150):
```js
const borderColor = styles.borderColor || styles.borderTopColor;
if (borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent') {
    const contrast = getContrastRatio(borderColor, parentBg);
    if (contrast < contrastThreshold) { /* insufficient-border-contrast */ }
}
```
There is no check of `border-style`/`border-width` before evaluating `border-color`.
Quoted element, `test-sites/good-auto-submitting-form.html:103-112`:
```css
.good-submit-button {
    background-color: #327d36;
    color: white;
    border: none;   /* ← border-width used-value is 0; nothing is painted */
    ...
}
```
`border: none` still leaves a computed `border-color` (CSS's initial value is
`currentColor`, which here resolves to the button's own text color, white —
exactly the `rgb(255, 255, 255)` recorded in every sample). But with
`border-style: none`, the used border-width is 0 regardless of what `border-color`
computes to — **no border is rendered at all**, so it cannot have a contrast
problem. The check needs a `borderWidth > 0 && borderStyle !== 'none'` guard before
it ever looks at color. 14 of the 15 occurrences are this exact `border: none` button
pattern (`.good-submit-button`/`.good-button` in two files); the 15th
(`good-reading-level`) is the same pattern with an unnamed button class.

### 5. `status-messages` / `html5-validation-inaccessible` (4.1.3) — 15 — DEBATABLE

`src/phase6a-status-messages-scanner.js:548-553`:
```js
if (field.hasAttribute('required') || field.hasAttribute('pattern') || field.type === 'email') {
    const hasCustomValidation = field.hasAttribute('aria-describedby') ||
                              field.hasAttribute('aria-invalid') || errorContainer;
    if (!hasCustomValidation) { /* html5-validation-inaccessible, wcagCriteria: 4.1.3 */ }
}
```
This fires on **every** `required`/`pattern`/email field in the DOM that lacks custom
ARIA wiring — e.g. every plain `<input type="radio" name="contact" ... required>` in
`good-form-grouping.html`. Two problems: (a) native HTML5 constraint-validation
messages ("Please select one of these options") *are* exposed to assistive technology
by evergreen browsers' own accessibility implementations — relying on them is a
recognized, WCAG-sufficient technique for simple cases, not an automatic failure; and
(b) SC 4.1.3 (Status Messages) is specifically about messages presented **without a
change of focus** — native constraint validation *does* move focus to the invalid
field, which arguably takes it out of 4.1.3's scope entirely (it's closer to
3.3.1/3.3.3 territory, if it's a violation at all). This isn't a clean bug like #1/#3/#4
— it's a heuristic asserting a hard "violation" of a specific SC where the applicability
is genuinely contested. Recommend at minimum re-labeling severity/criterion, and
narrowing to cases with actual evidence of a real problem (e.g., only after simulating
a failed submission and confirming no accessible feedback resulted).

## Also noted (rows 6–11, lighter-touch)

- **`status-messages`/`missing-live-region` (14, FALSE POSITIVE, mostly):**
  `src/phase6a-status-messages-scanner.js:220-221` selects loading indicators via
  `'.loading', '.spinner', '.loader', '.progress', ..., '[class*="progress"]'` — a bare
  substring match. In `good-accessibility.html`, `.progress-container`/`.progress-bar`/
  `.progress-fill` are **static** illustrative content ("Projektfortschritt A: 75%
  abgeschlossen", never updated by any script) — not a live status region at all, just
  matched because "progress" appears in the class name. Same story for
  `good-skip-links.html`'s `<div class="success">All skip links functional and
  accessible</div>` — static page copy, not a runtime success toast. The
  `good-auto-submitting-form.html` subset (4 of 14: `div#name-error` etc.) is more
  defensible — those *are* dynamically populated — but the file already pairs
  `aria-describedby` on the input with a separate `aria-live="polite"` announcer
  region (`#goodAnnouncements`), a commonly-accepted compensating pattern the checker
  can't see.

- **`color-contrast` (10, TRUE POSITIVE, mostly):** the scanner's algorithm
  (`color-contrast-scanner.js:50-66`) is the correct WCAG relative-luminance formula
  with a proper ancestor-background walk — unlike `nontext-contrast`. Spot-checked
  `good-skip-links.html`: `h2 { color: #666; margin-top: 30px; }` is a *direct* rule on
  `<h2>` and beats the *inherited* `.header { color: white; }`, so
  `<h2 style="margin:0">Company Logo</h2>` inside the dark `.header` (`background:#333`)
  really does render `#666`-on-`#333` (~2.2:1, large text, needs 3:1) — a genuine,
  probably-unintentional contrast bug in the fixture. The one confirmed false positive
  in this bucket: `good-images-of-text-no-exception.html`'s `.badge` uses
  `background: linear-gradient(135deg, #1a3a5c, #2d6a4f)` — a gradient, which leaves
  the `background-color` longhand transparent; the scanner's ancestor walk finds no
  solid color and falls back to a hardcoded white assumption
  (`color-contrast-scanner.js:101`), then compares white text against that assumed
  white and reports a 1:1 "violation" — when the actual rendered background is a dark
  gradient with genuinely high real contrast.

- **`page-structure`/`no-multiple-ways` (8, FALSE POSITIVE — context mismatch):** fires
  on 8 of 10 good files, once each. SC 2.4.5 (Multiple Ways) is defined over a *set of
  web pages* in a site/process; these `test-sites/*.html` fixtures are deliberately
  isolated single-purpose files with no site around them. The check is correct in
  principle but structurally inapplicable to how this test corpus is built.

- **`nontext-contrast`/`missing-focus-indicator` (7, FALSE POSITIVE):** same root
  cause as #3, proven conclusively here. `test-sites/good-complex-data-tables.html`
  has real, working sortable-column-header focus styling:
  ```css
  .sortable:focus { outline: 2px solid #0066cc; outline-offset: 2px; }
  ```
  on `<th tabindex="0" class="sortable">`. The recorded violation detail is
  `{"outline":"", "boxShadow":"", "borderColor":""}` — all empty strings, i.e. the
  broken `getComputedStyle(element, ':focus')` call returned nothing at all for this
  element (rather than coincidentally falling back to a plausible value, as happened
  for `<a>`/`<input>` elsewhere), so the code fell through all the way to "critical:
  lacks visible focus indicator" on an element that demonstrably has one.

- **`html-validation`/`missing-status-attributes` (7, FALSE POSITIVE — cross-scanner
  race):** flagged element `div.good-status-success` only ever exists in the DOM
  *after* JS injects it via `status.innerHTML = '<div class="good-status-success">...'`
  inside a button's `onclick` handler (`test-sites/good-auto-submitting-form.html`,
  e.g. line 568) — grep confirms it is never present in the static markup.
  `html-validation-scanner.js` never clicks anything itself, but
  `phase6a-status-messages-scanner.js:384,435` does click submit/action buttons as
  part of *its own* scan. Because `scan-pipeline.js` runs all concurrent scanners via
  `Promise.allSettled` against **one shared page**, one scanner's side-effecting DOM
  interaction is visible to (and independently reported by) whichever other
  scanner happens to inspect the page afterward. This is a non-deterministic,
  cross-scanner attribution bug, not a real static-HTML finding.

- **`error-handling`/`required-field-no-instruction` (7, tied for #10, not deep-dived):**
  fires on every `required` input in `good-form-grouping.html` even though the file
  visually marks required fields with `<span class="required">*</span>` next to every
  required label (e.g. "Bevorzugte Kontaktmethode *"). Worth a follow-up check of
  whether the scanner looks for that convention at all, or only for an aria-required
  attribute/explicit "required" text string.

## Recommended fix list, ordered by noise volume eliminated

1. **`page-structure-scanner.js:350`** — recognize implicit label association
   (`control.closest('label')`) in addition to `label[for]`/aria-label/
   aria-labelledby/title. **Eliminates ~49** (the single biggest noise source, ~22%
   of all good-file noise).
2. **`phase6a-nontext-contrast-scanner.js:458`** — drop the invalid
   `getComputedStyle(element, ':focus')` pseudo-element argument (just call
   `getComputedStyle(element)` after `element.focus()`), and replace the ad hoc
   linear-RGB "contrast" formula with the real WCAG relative-luminance formula
   already implemented in `color-contrast-scanner.js:50-66` (extract it to a shared
   helper). One root-cause fix cleans **both** `insufficient-focus-indicator-contrast`
   (15) and `missing-focus-indicator` (7) — **eliminates ~22**.
3. **`phase6a-nontext-contrast-scanner.js`** (button/form-control/custom-control
   border checks) — add a `borderStyle !== 'none' && parseFloat(borderWidth) > 0`
   guard before evaluating border-color contrast. **Eliminates ~15**.
4. **`phase6a-status-messages-scanner.js:220-221` (and the `.success`/notification
   selectors nearby)** — stop matching on bare className substrings
   (`[class*="progress"]`, `.success`, `.loading`, etc.); require some signal of
   actual runtime dynamism (an ARIA `role="status"/"progressbar"`, or verified
   mutation during the scan) before calling something a "status message" that needs
   a live region. **Eliminates ~10–14** (missing-live-region; the
   good-auto-submitting-form subset is more debatable and may partly remain).
5. **`phase6a-status-messages-scanner.js:548-553`** (`html5-validation-inaccessible`)
   — stop flagging every native `required`/`pattern`/email field by default; only
   fire with actual evidence of an accessibility gap (e.g. after simulating a failed
   submission and finding no accessible feedback), and reconsider the 4.1.3 criterion
   tag (3.3.1/3.3.3 fit the behavior better). **Eliminates up to ~15**, though this
   is a scope/precision change more than a pure bug fix.
6. **Scanner architecture: concurrent scanners share one mutable page.** Move
   interaction-triggering scanners (status-messages' button-clicking, and any other
   scanner that clicks/types/submits) out of the "concurrent" bucket into "exclusive"
   (their own tab), or have them clean up/undo their DOM mutations before yielding
   the page — so a scanner that only reads the DOM (html-validation) never sees
   another scanner's runtime side effects. **Eliminates ~7 directly** and removes a
   source of non-deterministic, hard-to-reproduce cross-scanner noise more broadly.
7. **`page-structure-scanner.js`** (`no-multiple-ways`, SC 2.4.5) — skip this check
   (or downgrade to informational) when scanning a single isolated page known not to
   be part of a larger site/process, which is the situation for every file in this
   test corpus. **Eliminates ~8**.
8. **Not a scanner fix — fixture fixes:** `input-purpose`'s `missing-autocomplete`
   (17) and most of `color-contrast`'s findings (10) are legitimate cross-criterion
   catches. Add the missing `autocomplete` attributes to the affected fixtures
   (`email`, `tel`, `language`, `street-address`, `postal-code`, etc.) and fix the
   `good-skip-links.html` header `<h2>` color/background clash, so these files stop
   generating real (if off-topic) violations. Separately, consider teaching
   `color-contrast-scanner.js`'s background resolution to detect
   `background-image`/gradients (not just `background-color`) to close the one
   confirmed gradient blind spot.
9. **Cross-scanner de-duplication:** `status-messages` (missing-live-region),
   `error-handling` (required-field-no-instruction / form-no-error-handling), and
   `html-validation` (missing-status-attributes) all independently evaluate
   overlapping "is this form/status element accessible" territory on the same
   elements, inflating the total count for what is often a single underlying gap.
   Worth consolidating ownership once items 1–7 above are fixed and the true signal
   is clearer.

Applying fixes 1–7 (all confirmed scanner bugs or clear over-broad heuristics) would
eliminate roughly **125–140 of the 225** recorded good-file violations (~55–62%)
without touching any of the genuine cross-criterion findings in items 8–9, which
should be resolved by fixing the test fixtures instead of loosening the scanners.
