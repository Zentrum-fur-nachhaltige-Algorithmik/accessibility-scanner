# Scanner Detection Gaps

**Status:** OPEN — 8 existing scanners fail to detect specific violation patterns  
**Date:** 2026-04-06  
**Source:** `test-exclusive-scanners.js` — all 8 failures are TRUE-POS (scanner misses bad file)

These are NOT missing scanners — the scanners exist and are marked DONE in `sprint-p1-scanner-gaps.md`. They have blind spots in their detection logic.

---

## Gap 1: Scrollable containers without keyboard access

**Test:** `bad-scrollable-content.html` (2.1.1)  
**Scanner:** `keyboard-navigation-scanner.js`

**Violation:** Scrollable `<div>` elements (`overflow: auto/scroll`) contain content that overflows their bounds but lack `tabindex`, making them unreachable by keyboard.

**Root cause:** Scanner discovers interactive elements by tag/role (`a[href]`, `button`, `input`, `[tabindex]`) but never checks non-interactive elements with CSS overflow. A `<div>` with `overflow: auto` and overflowing content is invisible to the scanner.

**Fix:** Add detection for elements with `overflow: auto|scroll` + `scrollHeight > clientHeight` (or `scrollWidth > clientWidth`) that lack `tabindex >= 0`.

---

## Gap 2: tabindex=-1 blocking gesture alternatives

**Test:** `bad-keyboard-native-override.html` (2.1.1, 2.5.1)  
**Scanner:** `input-modalities-scanner.js`

**Violation:** Controls have `tabindex="-1"` applied, removing them from keyboard tab order. Gesture-dependent elements have no keyboard-accessible alternative because the alternatives themselves are keyboard-blocked.

**Root cause:** `analyzePointerGestures()` checks whether gesture alternatives exist (buttons, links) but never verifies that those alternatives are keyboard-reachable. An element with `tabindex="-1"` passes the "alternative exists" check despite being unreachable.

**Fix:** When detecting gesture alternatives, verify `tabindex !== "-1"` and the element is not `aria-hidden` or `disabled`.

---

## Gap 3: Infinite CSS animations without pause controls

**Test:** `bad-motion-vestibular.html` (2.3.3, 2.5.4)  
**Scanner:** `input-modalities-scanner.js`

**Violation:** CSS `animation: infinite` on parallax, carousel, floating elements. No pause/disable UI. `prefers-reduced-motion` explicitly overridden in JS.

**Root cause:** The scanner's motion detection relies on text-content keyword matching (`pageText.includes('shake')`, `pageText.includes('tilt')`) to detect motion features. It never inspects CSS `@keyframes` or `animation` properties. Pages with pure CSS animations and no motion-related text content are invisible.

**Fix:** Scan stylesheets for `animation-iteration-count: infinite` and `animation-duration` > 0. Check for `@media (prefers-reduced-motion: reduce)` rules. Flag infinite animations without corresponding disable controls.

---

## Gap 4: Dynamic focus management after DOM changes

**Test:** `bad-focus-management.html` (2.4.3, 2.4.7)  
**Scanner:** `focus-management-scanner.js`

**Violation:** Modals don't trap/move focus on open. Deleting a list item doesn't move focus to sibling. "Load More" doesn't move focus to new content. Dropdown doesn't move focus to menu.

**Root cause:** Scanner tests static tab order and visual focus appearance (screenshots). It never interacts with the page to trigger DOM mutations (open modals, delete items, insert content) and verify focus moves correctly afterward.

**Fix:** Add Puppeteer interaction tests: click modal triggers → verify `document.activeElement` is inside modal. Click delete buttons → verify focus moves to sibling. This requires `needsExclusiveAccess: true` (already set).

---

## Gap 5: Invisible/removed focus indicators

**Test:** `bad-focus-visible.html` (2.4.7, 1.4.3)  
**Scanner:** `focus-management-scanner.js`

**Violation:** Global `*:focus { outline: none !important }` removes all focus indicators. Other elements have transparent outlines, outlines matching background color, or hover-only styling without `:focus`.

**Root cause:** Scanner checks computed styles on focused elements at runtime (`outlineWidth !== '0px'`), but:
- `outline: none` → `outlineWidth` is `0px` → correctly caught? Only if the element is actually focused during scanning.
- `outline: 1px solid transparent` → `outlineWidth` is `1px` → passes check despite being invisible.
- `outline: 1px solid #f0f0f0` on `#ffffff` background → passes check despite 1.1:1 contrast (needs 3:1).
- Global `*:focus` rules are never inspected in stylesheets.

**Fix:** (1) Scan CSS rules for `outline: none/0/transparent` on `:focus` selectors. (2) When validating focus styles, compare `outlineColor` against `backgroundColor` for 3:1 minimum contrast. (3) Flag `*:focus { outline: none }` as a global violation.

---

## Gap 6: Non-functional breadcrumb counted as navigation mechanism

**Test:** `bad-multiple-ways.html` (2.4.5)  
**Scanner:** `multiple-ways-scanner.js`

**Violation:** Page has only one real navigation path. Breadcrumb exists but links are `href="#"` — decorative, not functional.

**Root cause:** Scanner counts breadcrumbs as a navigation mechanism if `.breadcrumb` or `[class*="breadcrumb"]` exists. It never validates that breadcrumb links have real destinations (not `#`, `javascript:void(0)`, or empty).

**Fix:** Validate that detected mechanisms are functional: breadcrumb links have real `href` values, search forms have `action` attributes, sitemap links resolve to actual pages.

---

## Gap 7: Heuristic mode skips reflow testing (1.4.10)

**Test:** `bad-reflow.html` (1.4.10)  
**Scanner:** `responsive-design-scanner.js`

**Violation:** Fixed-width elements (sidebar 300px, main 600px, table 800px) cause horizontal scroll at 320px viewport.

**Root cause:** `heuristicOnly: true` mode hard-codes `criteria: ["9.1.4.12"]` and only runs `heuristicTextSpacingCheck()`. Criterion 1.4.10 (Reflow) requires full viewport cycling which is skipped in heuristic mode. The test runner uses `heuristicOnly: true` for speed, so 1.4.10 is structurally untested.

**Fix options:**
- (a) Add a lightweight CSS heuristic for 1.4.10: scan for `width: Npx` where N > 320 outside scrollable containers — no viewport cycling needed.
- (b) Run responsive-design in full mode in tests (slow but thorough). The full-matrix test already does this and passes.
- (c) Accept that heuristic mode only covers 1.4.12 and document this limitation.

---

## Gap 8: Heuristic mode skips text-resize testing (1.4.4)

**Test:** `bad-text-resize.html` (1.4.4)  
**Scanner:** `responsive-design-scanner.js`

**Violation:** All text uses fixed px `font-size` (12px, 14px, 16px). Fixed-height containers clip text when zoomed.

**Root cause:** Same as Gap 7 — heuristic mode skips 1.4.4. Testing text resize requires zoom level cycling (200% zoom).

**Fix options:**
- (a) Add a lightweight CSS heuristic for 1.4.4: scan for `font-size: Npx` without relative fallback, and `height: Npx` + `overflow: hidden` on text containers.
- (b) Same as Gap 7 options (b) and (c).

---

## Priority

| Gap | Complexity | Impact | Suggested Priority |
|-----|-----------|--------|-------------------|
| 5 — Focus indicator contrast/removal | Medium | High — affects every page | P0 |
| 7+8 — Heuristic CSS checks for 1.4.10/1.4.4 | Low | High — two criteria blind | P0 |
| 1 — Scrollable keyboard access | Low | Medium | P1 |
| 3 — CSS animation detection | Medium | Medium | P1 |
| 6 — Breadcrumb link validation | Low | Low | P1 |
| 4 — Dynamic focus interaction tests | High | Medium | P2 |
| 2 — tabindex=-1 in gesture check | Low | Low | P2 |
