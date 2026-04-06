# Scanner False Positive Analysis

**Source:** Haiku experiment (45 pages) + Multi-model experiment (25 pages audited across 6 models)
**Date:** 2026-04-05 (Haiku), 2026-04-06 (Multi-model)
**Status:** 35 files manually audited across 7 models

## Summary

Running our full scanner suite (40+ scanners) against AI-generated pages consistently shows **~97-99% false positive rates** regardless of the generating model. The scanner inflates real issue counts by 50-100x.

### Haiku Experiment (45 pages, 10 audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| angular-bootstrap/dashboard.html | 861 | 9 | ~99.0% |
| angular-bootstrap/form.html | 455 | 5 | ~98.9% |
| angular-bootstrap/landing.html | 873 | 7 | ~99.2% |
| angular-tailwind/dashboard.html | 1043 | 5 | ~99.5% |
| angular-tailwind/form.html | 437 | 1 | ~99.8% |
| angular-tailwind/landing.html | 1093 | 2-3 | ~99.7% |
| angular-vanilla/dashboard.html | 872 | 6 | ~99.3% |
| angular-vanilla/form.html | 400 | 2-3 | ~99.4% |
| angular-vanilla/landing.html | 1172 | 0-1 | ~99.9% |
| html-bootstrap/dashboard.html | 709 | 5 | ~99.3% |

**Haiku averages:** 792 violations/page, 4.3 true positives, ~99.4% FP rate

### Multi-Model Experiment (Gemini Flash Lite — 5 pages audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| angular-tailwind/form.html | 392 | 9 | ~98% |
| html-tailwind/form.html | 350 | 7 | ~98% |
| react-tailwind/form.html | 340 | 6 | ~96% |
| svelte-tailwind/form.html | 318 | 6 | ~96% |
| vue-tailwind/form.html | 398 | 7 | ~96% |

**Gemini averages:** 360 violations/page, 7.0 true positives, ~97% FP rate

### Multi-Model Experiment (Gemma 4 31B — 5 pages audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| angular-tailwind/form.html | 394 | 4 | ~99% |
| html-tailwind/form.html | 426 | 5 | ~99% |
| react-tailwind/form.html | 509 | 6 | ~99% |
| svelte-tailwind/form.html | 464 | 5 | ~99% |
| vue-tailwind/form.html | 445 | 10 | ~98% |

**Gemma averages:** 448 violations/page, 6.0 true positives, ~99% FP rate

### Cross-Model Summary

| Model | Mean Violations | Mean True Positives | FP Rate |
|-------|----------------|--------------------:|---------|
| Haiku (via Claude Code) | 792 | 4.3 | ~99.4% |
| Gemini Flash Lite (via OpenRouter) | 360 | 7.0 | ~97% |
| Gemma 4 31B (via OpenRouter) | 448 | 6.0 | ~99% |

### Multi-Model Experiment (GLM-5-Turbo — 3 pages audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| html-tailwind/form.html | 579 | 6 | ~99% |
| react-tailwind/form.html | 478 | 5 | ~99% |
| vue-tailwind/form.html | 549 | 6 | ~99% |

**GLM averages:** 535 violations/page, 5.7 true positives, ~99% FP rate

### Multi-Model Experiment (Kimi-K2.5 — 5 pages audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| angular-tailwind/form.html | 519 | 10 | ~98% |
| html-tailwind/form.html | 497 | 6 | ~99% |
| react-tailwind/form.html | 443 | 11 | ~98% |
| svelte-tailwind/form.html | 437 | 3 | ~99% |
| vue-tailwind/form.html | 420 | 18 | ~96% |

**Kimi averages:** 463 violations/page, 9.6 true positives, ~98% FP rate

### Multi-Model Experiment (MiniMax-M2.7 — 5 pages audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| angular-tailwind/form.html | 780 | 3 | ~99.6% |
| html-tailwind/form.html | 670 | 1 | ~99.9% |
| react-tailwind/form.html | 834 | 4 | ~99.5% |
| svelte-tailwind/form.html | 690 | 2 | ~99.7% |
| vue-tailwind/form.html | 744 | 1 | ~99.9% |

**MiniMax averages:** 744 violations/page, 2.2 true positives, ~99.7% FP rate

### Multi-Model Experiment (Qwen3.6-Plus — 2 pages audited)

| File | Scanner Violations | True Positives | FP Rate |
|------|-------------------|----------------|---------|
| angular-tailwind/form.html | 614 | 5 | ~99.2% |
| html-tailwind/form.html | 551 | 6 | ~98.9% |

**Qwen averages:** 583 violations/page, 5.5 true positives, ~99% FP rate

### Cross-Model Summary

| Model | Mean Violations | Mean True Positives | FP Rate |
|-------|----------------|--------------------:|---------|
| Haiku (via Claude Code) | 792 | 4.3 | ~99.4% |
| Gemini Flash Lite (via OpenRouter) | 360 | 7.0 | ~97% |
| Gemma 4 31B (via OpenRouter) | 448 | 6.0 | ~99% |
| GLM-5-Turbo (via OpenRouter) | 535 | 5.7 | ~99% |
| Kimi-K2.5 (via OpenRouter) | 463 | 9.6 | ~98% |
| MiniMax-M2.7 (via OpenRouter) | 744 | 2.2 | ~99.7% |
| Qwen3.6-Plus (via OpenRouter) | 583 | 5.5 | ~99% |

The FP rate is **model-independent** (~97-99.7% across all 7 models). The scanner produces the same inflation regardless of which LLM generated the HTML. MiniMax has the highest violation count (744) but the fewest true positives (2.2) — the scanner score is **inversely correlated** with actual code quality because larger files generate more FP surface area.

---

## Category 1: Responsive-Design Scanner Inflation

**Impact:** Accounts for ~80% of all reported violations.
**Confirmed across:** All 7 models, all 35 audited files.

The responsive-design scanner tests 4 viewports × 4 zoom levels = 16 combinations:
- iPhone SE (375×667)
- iPhone 8 (375×667)
- iPad (768×1024)
- Desktop (1920×1080)
- Each at 100%, 200%, 320%, 400% zoom

A single CSS overflow issue (e.g., a table wider than viewport at 400% zoom) gets reported **16 times** as separate violations. A page with ~50 real responsive issues produces 800+ violations.

Additionally, the `fixed-size` and `mobile-fixed-width-400-zoom` rules misinterpret **computed pixel widths** as fixed CSS sizes. Elements using responsive Tailwind classes (`w-full`, `max-w-2xl`, percentage layouts) are flagged because their computed width at scan time equals the viewport width (e.g., "1280px"). This is not a fixed size — it is the result of responsive layout at that particular viewport.

**Typical per-file contribution:**
- `fixed-size`: ~50-60 violations (FP)
- `mobile-fixed-width-400-zoom`: ~120-140 violations (FP)
- `mobile-overflow-hidden-400-zoom`: ~25-30 violations (FP)
- Combined: **~200-230 FP violations per file** from this category alone

**Fix needed:** Deduplicate violations by element + issue type across viewport/zoom combinations. Report the unique issue once with a list of affected viewport/zoom combos. Do NOT flag elements with responsive CSS (`max-width`, `%`, `vw`, `flex`, `grid`) as "fixed-size."

---

## Category 1b: Screen-Reader-Only (`.sr-only`) Text Flagged as Overflow

**Impact:** ~30-36 violations per file (~5-10% of total).
**Confirmed across:** All 35 audited files.

The scanner flags `.sr-only` elements as having "text overflow" or "truncated text with overflow hidden." This is the entire point of the `sr-only` CSS pattern — visually hiding text while keeping it accessible to screen readers:

```css
.sr-only {
  position: absolute; width: 1px; height: 1px;
  overflow: hidden; clip: rect(0,0,0,0);
}
```

The `text-overflow` and `mobile-overflow-hidden` rules should **exclude elements matching the `.sr-only` pattern** (1x1px, absolute positioned, overflow hidden, clip rect).

**Fix needed:** Detect the sr-only pattern and skip these elements in overflow/text-truncation checks.

---

## Category 1c: Touch Target Over-Reporting

**Impact:** ~60-90 violations per file (~15-20% of total).
**Confirmed across:** All 35 audited files.

The `touch-target-too-small` and `touch-targets-too-close` rules flag standard HTML form inputs (`<input>`, `<select>`, `<textarea>`) that have adequate sizing via padding (`p-2`, `p-3`). The scanner appears to measure rendered dimensions at specific viewports and flag everything below 44x44px, but standard form controls with default browser sizing + padding are adequate.

**Legitimate TP within this category:** Checkboxes explicitly sized as `w-4 h-4` (16x16px) are genuinely too small. These should still be flagged.

**Fix needed:** Exclude standard form controls with default browser sizing. Only flag elements with explicit small dimensions (e.g., `width < 24px` AND `height < 24px` as per WCAG 2.5.8).

---

## Category 1d: `aria-invalid` Flagged as Invalid Attribute

**Impact:** 3-7 violations per file.
**Confirmed across:** All 35 audited files. This is a scanner bug.

The `invalid-attributes` rule flags `aria-invalid` as an "invalid HTML attribute" on `<input>`, `<select>`, and `<textarea>` elements. `aria-invalid` is a valid WAI-ARIA state attribute per the ARIA 1.2 specification, applicable to any element that accepts `aria-*` attributes.

**Fix needed:** Remove `aria-invalid` from the invalid-attributes blacklist. It is a valid ARIA attribute.

---

## Category 1e: AAA Criteria Flagged as AA Violations

**Impact:** 3-5 violations per file.
**Confirmed across:** All 25 multi-model files.

The LLM scanners (`llm-visual-presentation`, `llm-focus-appearance`, `llm-behavioral`) flag AAA-level criteria (1.4.8 Visual Presentation, 2.4.13 Focus Appearance Enhanced, 3.3.5 Context-Sensitive Help) as violations, even though the scan target is AA conformance. These should be filtered or downgraded when AA is the target level.

**Fix needed:** Add conformance level filter. When scanning for AA, exclude AAA-only criteria from violation counts.

---

## Category 1f: Redundant `role` + `aria-live` Flagged as Error

**Impact:** 1-3 violations per file.
**Confirmed across:** GLM, Kimi, MiniMax files.

The scanner flags patterns like `role="alert" aria-live="assertive"` or `role="status" aria-live="polite"` as errors. These are redundant (role implies the live region behavior) but NOT violations. The explicit `aria-live` is harmless and sometimes used for older AT compatibility.

**Fix needed:** Downgrade redundant `role`+`aria-live` combinations from violation to informational.

---

## Category 1g: `setTimeout` Flagged as Session Timeout

**Impact:** 1-2 violations per file.
**Confirmed across:** GLM, Gemma, Kimi files.

The scanner detects `setTimeout()` calls in JS (used for simulated API delays, e.g., `setTimeout(resolve, 800)`) and flags them as "timeout without user control to extend time limit" (WCAG 2.2.1). These are sub-second simulated delays, not session timeouts.

**Fix needed:** Only flag timeouts > 5 seconds or those tied to session/inactivity logic. Ignore short `setTimeout` calls in form handlers.

---

## Category 1h: SPA Route-Change Checks on Non-SPA Pages

**Impact:** 2-3 violations per file.
**Confirmed across:** Gemma, MiniMax files.

Scanners flag `missing-page-title-update`, `no-focus-management-route-change`, and `missing-h1-after-route-change` on standalone HTML pages that are NOT single-page applications. These checks are irrelevant for static HTML files.

**Fix needed:** Only run SPA-specific checks when the page is detected as an SPA (e.g., has client-side router, history.pushState usage).

---

## Category 2: Static HTML Analysis vs Runtime Behavior

The scanner analyzes the initial DOM state but many patterns are JS-driven and only correct at runtime.

### 2a. `aria-describedby` pointing to `hidden` elements

**Pattern:**
```html
<input aria-describedby="email-error" />
<p id="email-error" role="alert" hidden>Email is required</p>
```

Scanner flags: "aria-describedby references element that provides no accessible description"

**Reality:** This is the correct pattern. The error element starts `hidden` and JS removes `hidden` on validation failure. At that point, `aria-describedby` works correctly. The scanner doesn't execute JS.

**Affected scanners:** `advanced-aria`, `page-structure`, `label-in-name`

### 2b. `aria-invalid="false"` on initial load

**Pattern:**
```html
<input aria-invalid="false" aria-describedby="name-error" />
```

Scanner flags: "aria-invalid is set but no error message is visible"

**Reality:** `aria-invalid="false"` is semantically equivalent to the attribute being absent. However, some screen readers announce "invalid: false" verbatim which is confusing. This is a **gray area** — technically valid but bad practice.

**Recommendation:** Don't flag `aria-invalid="false"` as a violation. Consider a "best practice" warning instead.

### 2c. Modal elements in DOM but `display: none`

**Pattern:**
```html
<div role="dialog" aria-modal="true" style="display: none">
  <h2>Modal Title</h2>
  ...
</div>
```

Scanner flags: "dialog found but not visible", "heading found inside hidden content"

**Reality:** `display: none` correctly hides elements from the accessibility tree. The modal is invisible to AT until opened by JS. This is standard practice.

**Affected scanners:** `page-structure`, `advanced-aria`, `screen-reader`

---

## Category 3: Redundant ARIA Roles (Valid but Flagged)

### 3a. Explicit roles matching implicit HTML5 roles

**Pattern:**
```html
<header role="banner">
<footer role="contentinfo">
<nav role="navigation">
```

Scanner flags: "redundant role on semantic element"

**Reality:** These are valid. HTML5 spec defines implicit ARIA roles for these elements. Adding the explicit role is redundant but NOT a violation. Some older AT benefits from the explicit role.

**Recommendation:** Downgrade from violation to informational note.

### 3b. Navigation links without `<ul>/<li>` wrapper

**Pattern:**
```html
<nav aria-label="Main navigation">
  <a href="/">Home</a>
  <a href="/about">About</a>
</nav>
```

Scanner flags: "navigation should use list markup for screen reader enumeration"

**Reality:** This is a best practice recommendation, not a WCAG requirement. `<nav>` with direct `<a>` children is valid HTML.

---

## Category 4: Bootstrap CDN Contrast Miscalculation

The scanner sometimes computes contrast ratios against the wrong background when Bootstrap CSS is loaded from CDN.

**Example:** Bootstrap resets and overrides many default colors. The scanner may compute contrast against the raw HTML background-color without considering Bootstrap's cascade.

**Affected scanners:** `color-contrast`, `advanced-contrast`

**Recommendation:** Ensure contrast computation uses `getComputedStyle()` on the rendered element, not the raw HTML attribute.

---

## Category 5: Scanner Internal Errors

Some scanners throw runtime errors that inflate the violation count:

```
Error testing navigation link 0: Node is either not clickable or not an Element
Error testing navigation link 1: page.waitForTimeout is not a function
Error testing form 0: page.waitForTimeout is not a function
```

**Root cause:** `page.waitForTimeout` was removed in newer Puppeteer versions (replaced by `setTimeout` pattern). Several exclusive scanners still use the deprecated API.

**Affected scanners:** `dynamic-spa`, `hover-focus-content`, `input-modalities`

**Fix needed:** Replace all `page.waitForTimeout()` calls with `new Promise(r => setTimeout(r, ms))` or use `page.evaluate(() => new Promise(r => setTimeout(r, ms)))`.

---

## True Positive Patterns (Real Issues Found Across Models)

These are genuine accessibility bugs found across 20 manually audited files (10 Haiku, 5 Gemini, 5 Gemma). Grouped by recurrence.

### Contrast Failures (found in 6/10 files)
- Hint text `#666` on light gray `#f8f9fa` = 3.77:1 (needs 4.5:1)
- Footer text `#6b7280` on `#f3f4f6` = ~3.8:1
- Status badge `#92400e` on `#fed7aa` = ~3.7:1
- Error message `#dc2626` on `#fee2e2` = ~3.2:1 (angular-tailwind/form)
- Error status `#721c24` on `#f8d7da` = ~4.0:1 (angular-vanilla/form)

### ARIA Misuse (found in 5/10 files)
- `aria-sort` placed on `<button>` inside `<th>` instead of on `<th>` itself
- `aria-hidden` written in CSS (`aria-hidden: true`) instead of HTML attribute — completely ineffective
- Live regions reused for multiple unrelated announcements (sort status + modal state)
- Double-announce pattern: `role="alert"` + `aria-describedby` on same error elements
- Toast region uses `role="status"` (polite) for error toasts that should be `role="alert"` (assertive)
- Missing `aria-describedby` on select elements that have associated hint text

### Structural Issues (found in 4/10 files)
- Two `<h1>` elements on same page (logo + hero heading)
- ID mismatch: JS uses `company_size` (underscore) but HTML has `company-size` (hyphen) — `aria-invalid` never applied
- All "View Details" buttons share identical accessible name — no per-row disambiguation
- Stat card values lack semantic context — `<p>` elements with no heading/label association
- Pagination "Next" link hardcoded to page 3 instead of dynamic next page

### Focus Management (found in 4/10 files)
- Modal focus deliberately skips close button: `focusable[1]?.focus()`
- `outline: none` on form inputs replaces outline with border-only change (insufficient focus indicator)
- Sort status element has `sr-only` class — sighted users get no visual sort feedback
- Pagination current page `<span>` is not keyboard focusable
- Sort buttons invisible in Windows high contrast mode (no border/background)

### Color-Only Information (found in 3/10 Haiku files)
- Status badges (Shipped/Pending/Delivered) use color alone without icons or patterns
- Trend arrows (↑↓) lack text alternatives — rely on symbol recognition
- Feature card links use pseudo-element stretch without keyboard indication

### Multi-Model True Positives (All 6 Models, 25 audited pages)

| # | Pattern | Freq (25 files) | WCAG | In Skill? | Models Affected |
|---|---------|:-:|------|-----------|-----------------|
| 1 | Input border contrast <3:1 (Tailwind `border-gray-300`/`400`/`slate-300`) | 22 (88%) | 1.4.11 | Yes | All 6 |
| 2 | No `fieldset`/`legend` for related form fields | 20 (80%) | 1.3.1 | Yes | All 6 |
| 3 | Multiple `role="alert"` fire simultaneously on errors | 16 (64%) | 4.1.3 | Yes | All 6 |
| 4 | `aria-invalid="false"` rendered by default (React/Vue) | 14 (56%) | 4.1.2 | Yes | Gemini, Gemma, Kimi, GLM |
| 5 | `<a href="#">` placeholder links | 12 (48%) | 2.4.4 | Yes | Gemma, Kimi, MiniMax, Qwen |
| 6 | Missing `aria-describedby` linking errors to inputs | 10 (40%) | 3.3.1 | Yes | Gemini, Gemma, GLM |
| 7 | Nav links not underlined (color-only) | 8 (32%) | 1.4.1 | Yes | Gemma, Kimi, GLM |
| 8 | Focus ring with insufficient contrast (`blue-300` ~1.7:1) | 6 (24%) | 1.4.11 | **No** | Kimi, GLM |
| 9 | `outline-none`/`focus:outline-none` without replacement | 5 (20%) | 2.4.7 | Yes | Gemma, Kimi, MiniMax |
| 10 | Checkbox target size 16-20px (<24px) | 5 (20%) | 2.5.8 | Yes | GLM, Kimi |
| 11 | `target="_blank"` without new-window warning | 3 (12%) | 3.2.5 | **No** | Qwen, GLM |
| 12 | Empty `<nav>` landmark (no links) | 3 (12%) | 1.3.1 | **No** | Kimi |
| 13 | Wrong `aria-current="page"` placement | 1 (4%) | 4.1.2 | **No** | MiniMax |
| 14 | Broken HTML/JS (malformed attributes, undefined vars) | 2 (8%) | 4.1.1 | N/A | Qwen |
| 15 | Footer text contrast borderline on dark bg | 3 (12%) | 1.4.3 | Yes | MiniMax, GLM |

**Key observations:**
- 11 of 15 patterns are already documented in the skill — **models ignore the guidance**
- Input border contrast (Tailwind defaults) is #1 across ALL models — a Tailwind default problem, not model-specific
- 4 patterns are **missing from the skill**: focus ring colors (#8), `target="_blank"` warnings (#11), empty `<nav>` (#12), `aria-current` placement (#13)

---

## Recommended Scanner Improvements

| Priority | Fix | Impact | Confirmed By |
|----------|-----|--------|-------------|
| P0 | **Deduplicate responsive-design violations** by element+issue, report viewport list | Reduces violation count by ~80% | All 7 models |
| P0 | **Exclude `.sr-only` elements from overflow/text-truncation checks** | Reduces FP by ~5-10% | All 7 models |
| P0 | **Remove `aria-invalid` from invalid-attributes list** — it is a valid ARIA attribute | Eliminates 3-7 FP per file | All 7 models |
| P0 | **Fix `page.waitForTimeout` deprecation** in exclusive scanners | Eliminates scanner errors | Haiku |
| P0 | **Don't flag `fixed-size` on elements using responsive CSS** (`max-width`, `%`, `vw`, `flex`, `grid`) | Reduces `fixed-size` FPs by ~90% | All 7 models |
| P1 | **Reduce touch-target over-reporting** — exclude standard form controls with default sizing | Reduces FP by ~15% | All 7 models |
| P1 | **Don't flag `aria-describedby` to `hidden` elements** as violation — JS-driven patterns | Reduces FP by ~10% | Haiku, GLM |
| P1 | **Downgrade redundant ARIA roles** from violation to info | Reduces FP by ~5% | Haiku, MiniMax |
| P1 | **Filter AAA criteria** when scan target is AA | Removes 3-5 FP per file | All multi-model |
| P1 | **Ignore `setTimeout` < 5s** as session timeout | Removes 1-2 FP per file | GLM, Gemma, Kimi |
| P2 | **Ensure contrast uses `getComputedStyle()`** not raw HTML attributes | Fixes CDN-loaded CSS issues | Haiku |
| P2 | **Add "best practice" severity level** distinct from violation | Better signal-to-noise ratio | All 7 models |
| P2 | **Only run SPA checks on actual SPAs** | Removes 2-3 FP per file | Gemma, MiniMax |
| P2 | **Downgrade redundant `role`+`aria-live`** from violation to info | Removes 1-3 FP per file | GLM, Kimi, MiniMax |

---

## Generated Test Files

The multi-model experiment produced HTML files that can serve as real-world test fixtures for scanner validation (true/false positive calibration):

```
experiments/multi-model/generated/
├── gemini-3.1-flash-lite/    # 5 files, avg 6KB, 7.0 TPs/file
│   ├── angular-tailwind/form.html
│   ├── html-tailwind/form.html
│   ├── react-tailwind/form.html
│   ├── svelte-tailwind/form.html
│   └── vue-tailwind/form.html
├── gemma-4-31b-it/           # 5 files, avg 13KB, 6.0 TPs/file
│   └── (same 5 variants)
├── glm-5-turbo/              # 3 files, avg 21KB, 5.7 TPs/file
│   ├── html-tailwind/form.html
│   ├── react-tailwind/form.html
│   └── vue-tailwind/form.html
├── kimi-k2.5/                # 5 files, avg 17KB, 9.6 TPs/file
│   └── (same 5 variants)
├── minimax-m2.7/             # 5 files, avg 28KB, 2.2 TPs/file
│   └── (same 5 variants)
└── qwen3.6-plus/             # 2 files, avg 22KB, 5.5 TPs/file
    ├── angular-tailwind/form.html
    └── html-tailwind/form.html
```

**Scanner results:** `experiments/multi-model/results/` (per-model JSON + cross-model summary)
**Haiku baseline:** `experiments/haiku-a11y/generated/` (45 files) + `experiments/haiku-a11y/results/`

These files are useful as scanner test fixtures because each has been manually audited with known true positives documented above. A scanner that reports 400 violations on a file with 5 known TPs has a measurable FP rate.

---

## Open Questions

- [x] ~~How many of the 45 files have the responsive-inflation problem?~~ → **All of them.** Confirmed across 35 audited files from 7 models.
- [x] ~~Is the FP rate model-specific?~~ → **No.** FP rate is ~97-99.7% across all 7 models.
- [x] ~~Remaining multi-model scans (kimi, minimax, qwen, glm) — do they confirm the same FP patterns?~~ → **Yes.** Identical FP categories across all models.
- [ ] Is the `page.waitForTimeout` error causing scanners to silently skip checks (false negatives)?
- [ ] Should we add a "JS-aware" scan mode that waits for interactions before checking ARIA state?
- [ ] What's the baseline false positive rate on our existing `good-*.html` test files?
- [ ] Would fixing the 5 P0 issues (dedup responsive, exclude sr-only, fix aria-invalid, fix fixed-size, responsive CSS detection) bring the FP rate below 50%?
