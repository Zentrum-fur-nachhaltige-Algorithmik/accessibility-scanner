---
name: a11y-code
description: >
  Write WCAG 2.2 AA compliant, accessible code by default. This skill ensures all generated
  HTML, CSS, JavaScript, and framework code (React, Vue, Angular, Svelte) meets accessibility
  standards. USE THIS SKILL whenever writing, reviewing, or modifying any UI code — including
  HTML templates, JSX/TSX, Vue SFCs, CSS, component libraries, forms, navigation, modals,
  interactive widgets, landing pages, dashboards, or any user-facing markup. Also trigger when
  the user mentions accessibility, a11y, WCAG, screen reader, keyboard navigation, ARIA,
  assistive technology, or inclusive design. This skill should be active for ALL frontend code
  generation, not just when accessibility is explicitly requested — accessible code is the default,
  not an add-on.
---

# Accessible Code by Default

You are writing code that will be used by people with disabilities — blind users with screen
readers, keyboard-only users, people with motor impairments, users with cognitive disabilities,
and people with low vision or color blindness. Every element, CSS rule, and interaction either
includes or excludes them.

## Core Principles

1. **Semantic HTML first.** `<button>` over `<div role="button">`. Native elements provide keyboard, focus, and SR support for free.
2. **ARIA is a repair tool.** Only when HTML cannot express the semantics. First rule of ARIA: don't use ARIA.
3. **If it's not keyboard accessible, it's broken.** Tab, Enter, Space, Escape, Arrow keys.
4. **Visual = programmatic.** If visible, it must be announced. If decorative, hide it.

---

## ⚠ VERIFIED FAILURE CHECKLIST — Read Before Generating Code

Testing across 7 LLMs (35 pages) shows these errors occur in >50% of AI-generated code **even when this skill is loaded**. After generating, verify each item:

- [ ] **Input borders:** NOT `border-gray-300`/`400`/`slate-300`. Use `border-gray-500` or darker (3:1 min). See Tailwind table below.
- [ ] **`<fieldset>` + `<legend>`** wrapping related form fields (name+email+phone = one group)
- [ ] **ONE `role="alert"`** for error summary. Individual field errors: NO `role="alert"` — use `aria-describedby` instead.
- [ ] **`aria-invalid`:** OMIT the attribute entirely until validation fails. Do NOT render `aria-invalid="false"` (React: use `undefined`, Vue: use `null`).
- [ ] **No `<a href="#">`** — use `<button>` for actions, real URLs for navigation
- [ ] **Error messages** linked to inputs via `aria-describedby`
- [ ] **Focus ring contrast:** NOT `ring-blue-300`. Use `ring-blue-600` or darker (3:1 min).
- [ ] **Nav links** underlined or otherwise distinguishable without color alone
- [ ] **`target="_blank"` links** must indicate new window: add `<span class="sr-only">(opens in new tab)</span>`

---

## 1. Perceivable

### 1a. Color & Contrast

**Ratios:** Normal text 4.5:1 · Large text (≥18pt/14pt bold) 3:1 · UI components 3:1

Always calculate against the **actual background**, not white. A color safe on `#fff` may fail on `#f5f5f5`.

**Verified-safe text colors on common backgrounds:**
```
On #ffffff: use #595959 or darker   (7:1 — passes AAA)
On #f8f9fa: use #525252 or darker
On #f3f4f6: use #4b5563 or darker
On #e5e7eb: use #374151 or darker
```

**Common failures — these look fine but fail:**
```
❌ #6c757d on #f8f9fa = 3.9:1   (Bootstrap text-muted on gray-100)
❌ #dc2626 on #fee2e2 = 3.2:1   (red error text on red background)
❌ #cccccc borders    = 1.6:1   (fails UI component 3:1 rule)
```

**Safe status colors:**
```css
.error   { color: #b91c1c; background: #fff; }       /* 6.6:1 ✅ */
.warning { color: #78350f; background: #fef3c7; }     /* 7.2:1 ✅ */
.success { color: #065f46; background: #d1fae5; }     /* 5.1:1 ✅ */
```

**Rules:**
- Placeholder text: `color: #595959` minimum on white — never default browser gray
- Input borders: `#767676` or darker (not `#ccc`)
- Links in body text: underlined, not just colored

### Tailwind Accessible Defaults

When using Tailwind CSS, many default utility classes **fail WCAG contrast requirements**. Use these replacements:

| Purpose | ❌ Fails (DO NOT USE) | ✅ Use Instead | Ratio |
|---------|----------------------|---------------|-------|
| Input border | `border-gray-300` (1.5:1) | `border-gray-500` or darker | 4.6:1 |
| Input border | `border-gray-400` (2.5:1) | `border-gray-500` or darker | 4.6:1 |
| Input border | `border-slate-300` (1.6:1) | `border-slate-500` or darker | 4.6:1 |
| Focus ring | `ring-blue-300` (1.7:1) | `ring-blue-600` or darker | 3.6:1 |
| Focus ring | `ring-indigo-300` (2.0:1) | `ring-indigo-600` or darker | 4.5:1 |
| Placeholder | `placeholder-gray-400` (3.0:1) | `placeholder-gray-600` or darker | 5.9:1 |
| Muted text | `text-gray-400` on white (3.0:1) | `text-gray-600` or darker | 5.9:1 |
| Muted text | `text-gray-500` on gray-50 (4.5:1) | `text-gray-600` or darker | 5.9:1 |
| Muted text on dark | `text-gray-500` on gray-900 (3.7:1) | `text-gray-300` or lighter | 10:1 |

**The 3:1 minimum applies to:** input borders, focus indicators, icons, and all UI components.
**The 4.5:1 minimum applies to:** all text (except large text ≥18pt which needs 3:1).

### 1b. Color-Only Information

Never convey meaning through color alone. Always add a secondary indicator:

```html
<!-- ❌ Status badges distinguished only by color -->
<span class="badge green">Shipped</span>
<span class="badge red">Cancelled</span>

<!-- ✅ Color + icon/text -->
<span class="badge-success">✓ Shipped</span>
<span class="badge-danger">✕ Cancelled</span>
```

```html
<!-- ❌ Trend arrows without text -->
<span class="green">↑</span> 12%

<!-- ✅ Arrows with screen reader context -->
<span aria-hidden="true">↑</span><span class="sr-only">Increased by</span> 12%
```

- Sort indicators need programmatic state (`aria-sort`), not just visual icons
- Required fields: text marker (`*` plus "required"), not just red color

### 1c. Images & Media

```html
<!-- Informative image -->
<img src="chart.png" alt="Revenue doubled from Q1 to Q4 2024" aria-describedby="chart-detail">
<figcaption id="chart-detail">Detailed breakdown: ...</figcaption>

<!-- Decorative image -->
<img src="divider.png" alt="">

<!-- SVG icon in button -->
<button aria-label="Close dialog">
  <svg aria-hidden="true" focusable="false">...</svg>
</button>
```

- Every `<img>` needs `alt`. Decorative: `alt=""`. Informative: describe the content.
- Video: `<track kind="captions">`. Audio: transcript link.
- No autoplay. If unavoidable: pause control + respect `prefers-reduced-motion`.

### 1d. Text Spacing & Reflow

Content must remain readable when users override text spacing (WCAG 1.4.12):

```css
/* ❌ Fixed height clips text when spacing increases */
.card { height: 200px; overflow: hidden; }

/* ✅ Grows with content */
.card { min-height: 200px; overflow: visible; }
```

- Content must reflow at 320px viewport width without horizontal scroll (1.4.10)
- Use `rem`/`em` for font sizes, never `px` for text
- `line-height: 1.5` minimum for body text
- `max-width: 80ch` for text blocks
- No `text-align: justify` — impairs readability for dyslexic users

### 1e. Orientation

Content must work in both portrait and landscape (WCAG 1.3.4):

```css
/* ❌ Blocking an orientation */
@media (orientation: portrait) { body { display: none; } }

/* ✅ Adapting layout */
@media (orientation: portrait)  { .layout { flex-direction: column; } }
@media (orientation: landscape) { .layout { flex-direction: row; } }
```

---

## 2. Operable

### 2a. Keyboard Access

All interactive elements must work with keyboard alone:

```html
<!-- ❌ Not keyboard accessible -->
<div onclick="doAction()" class="clickable">Click me</div>

<!-- ✅ Natively keyboard accessible -->
<button onclick="doAction()">Click me</button>
```

- **Buttons** for actions, **links** for navigation — never swap
- Never `<a href="#">` for actions — use `<button>`
- No keyboard traps — user must always be able to Tab away (except intentional modal focus traps with Escape exit)

### 2b. Focus Indicators

```css
/* ✅ Works everywhere including Windows High Contrast Mode */
:focus-visible {
  outline: 3px solid #1b2a4a;
  outline-offset: 2px;
}

/* ❌ Invisible in High Contrast Mode */
button:focus { outline: none; box-shadow: 0 0 0 3px blue; }

/* ❌ Removes focus indicator entirely */
input:focus { outline: none; border-color: blue; }
```

**Rules:**
- Never `outline: none` on any element without a visible `outline`-based replacement
- `box-shadow` and `border-color` alone fail in Windows High Contrast Mode
- Skip link needs `:focus` styles too
- Focus must not be obscured by sticky headers/footers — use `scroll-padding`

```css
html {
  scroll-padding-top: 60px;    /* height of fixed header */
  scroll-padding-bottom: 80px; /* height of fixed footer */
}
```

### 2c. Document Structure & Navigation

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
<header>
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="/" aria-current="page">Home</a></li>
      <li><a href="/products">Products</a></li>
    </ul>
  </nav>
</header>
<main id="main-content" tabindex="-1">
  <h1>Page Title</h1>
</main>
<footer>...</footer>
```

- **One `<h1>` per page.** Logo is not h1.
- Strict hierarchy: h1 > h2 > h3. Never skip levels.
- Landmarks: `<header>`, `<nav>`, `<main>`, `<footer>` — every page.
- One skip link, first focusable element. Target needs `tabindex="-1"` for Safari.
- `<nav>` elements need distinguishing `aria-label` when multiple exist.

### 2d. Touch Targets & Pointer Input

Minimum touch target size: 24×24 CSS pixels (AA), prefer 44×44 (AAA):

```css
/* ❌ Too small */
.icon-btn { width: 16px; height: 16px; }

/* ✅ Meets AA minimum */
.icon-btn { min-width: 24px; min-height: 24px; padding: 4px; }

/* ✅ Meets AAA / mobile best practice */
.icon-btn { min-width: 44px; min-height: 44px; padding: 10px; }
```

- Drag & drop must have a non-drag alternative (buttons, select, keyboard arrows) (WCAG 2.5.7)
- Actions on `click` (up-event), not `mousedown` — allows cancellation (WCAG 2.5.2)

### 2e. Motion & Animation

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- No flashing content (3+ flashes/sec = seizure risk)
- Autoplay videos: provide pause button, stop in reduced-motion
- Parallax: disable in `prefers-reduced-motion`
- Carousels: must have pause button. Stop auto-advance in reduced-motion.

### 2f. Timing

- Session timeouts: warn 60s before, offer extension
- No hard time limits on form completion
- Auto-refreshing content: provide pause/stop mechanism

---

## 3. Understandable

### 3a. Language

```html
<html lang="en">
<!-- Foreign text inline: -->
<p>The German word <span lang="de">Barrierefreiheit</span> means accessibility.</p>
```

### 3b. Forms

```html
<div class="form-group">
  <label for="email">
    Email <span aria-hidden="true">*</span>
    <span class="sr-only">(required)</span>
  </label>
  <input type="email" id="email" name="email"
    autocomplete="email"
    aria-required="true"
    aria-describedby="email-hint">
  <p id="email-hint" class="hint">We'll never share your email.</p>
</div>

<!-- After validation fails, add error: -->
<input type="email" id="email" aria-invalid="true" aria-describedby="email-hint email-error">
<p id="email-error" role="alert">Please enter a valid email address.</p>
```

**Rules:**
- Visible `<label>` with `for`/`id` on every input
- `aria-required="true"` + visible indicator on required fields
- Do NOT set `aria-invalid="false"` by default — only add `aria-invalid="true"` after validation fails. In React: `aria-invalid={hasError ? "true" : undefined}`. In Vue: `:aria-invalid="hasError ? 'true' : null"`.
- Error messages: link via `aria-describedby`
- Group related inputs: `<fieldset>` + `<legend>` — personal info fields (name, email, phone) are one group
- Only use `<nav>` when it contains actual navigation `<a>` links. A `<nav>` with only a logo/title is semantically misleading.

### Form Error Announcement Pattern

Use ONE error summary with `role="alert"`. Individual field errors should NOT have `role="alert"` — they are linked to inputs via `aria-describedby` and read when the user focuses the field.

```html
<!-- ❌ WRONG — Multiple simultaneous alerts overwhelm screen readers -->
<p role="alert" id="name-error">Name is required</p>
<p role="alert" id="email-error">Email is required</p>
<p role="alert" id="phone-error">Phone is required</p>

<!-- ✅ RIGHT — Single alert summary + static field errors linked via aria-describedby -->
<div role="alert" tabindex="-1" id="error-summary">
  <h2>3 errors found:</h2>
  <ul>
    <li><a href="#name">Name is required</a></li>
    <li><a href="#email">Email is required</a></li>
    <li><a href="#phone">Phone is required</a></li>
  </ul>
</div>
<!-- Individual errors: NO role="alert", just aria-describedby -->
<input id="name" aria-invalid="true" aria-describedby="name-error">
<p id="name-error">Name is required</p>
```

Focus the error summary after failed validation. This gives screen reader users a complete overview, then they can tab to individual fields to hear specific errors.

### 3c. Predictable Behavior

- No unexpected context changes on focus or input
- Navigation order consistent across pages
- Help mechanism in the same position on every page
- Don't auto-submit forms on select change — provide explicit submit button

### 3d. Authentication

```html
<!-- ✅ Allows password managers and paste -->
<input type="password" id="pw" autocomplete="current-password">

<!-- ✅ OTP with autofill support -->
<input type="text" id="otp" autocomplete="one-time-code" inputmode="numeric">

<!-- ✅ Alternative login methods -->
<button>Sign in with Passkey</button>
<button>Send login link via email</button>
```

- Never block paste on password fields
- Never `autocomplete="off"` on auth fields
- Provide alternatives to CAPTCHAs

---

## 4. Robust

### 4a. ARIA Rules

**Do:**
```html
<!-- Accordion — prefer native -->
<details><summary>FAQ Question</summary><p>Answer</p></details>

<!-- Custom accordion when native won't work -->
<h3><button aria-expanded="false" aria-controls="panel1">FAQ Question</button></h3>
<div id="panel1" hidden><p>Answer</p></div>

<!-- Toggle -->
<button aria-pressed="true">Dark Mode</button>

<!-- Sortable table header — aria-sort on <th>, not on <button> -->
<th aria-sort="ascending"><button>Name <span aria-hidden="true">▲</span></button></th>
```

**Don't:**
```html
<!-- ❌ aria-hidden on focusable element — SR can't see it but Tab reaches it -->
<button aria-hidden="true">Close</button>

<!-- ❌ aria-invalid="false" as default — SR announces "invalid: false" -->
<input aria-invalid="false">

<!-- ❌ aria-hidden set in CSS — CSS cannot set ARIA attributes -->
<!-- This does nothing for assistive technology -->

<!-- ❌ aria-sort on button instead of th -->
<th><button aria-sort="ascending">Name</button></th>

<!-- ❌ Nested role="alert" inside aria-live — double announcement -->
<div aria-live="polite"><p role="alert">Error!</p></div>

<!-- ❌ role="alert" + aria-describedby on same error — double announcement -->
<input aria-describedby="err"><p id="err" role="alert">Invalid</p>
```

### 4b. Live Regions & Status Messages

```html
<!-- Non-urgent status: polite -->
<div role="status" aria-live="polite">Item added to cart.</div>

<!-- Urgent error: assertive -->
<div role="alert" aria-live="assertive">Payment failed. Please try again.</div>
```

**Rules:**
- Use `role="alert"` for errors, `role="status"` for success/info
- One purpose per live region — don't reuse a single region for sort announcements, toasts, and modal messages
- Live region must exist in DOM *before* content is injected
- Don't nest `role="alert"` inside an `aria-live` container — pick one mechanism
- Don't put `role="alert"` on an element also referenced by `aria-describedby` — causes double announcement

### 4c. SPA Route Changes

SPAs must announce navigation to screen readers:

```html
<!-- Route announcer — mount once in app shell -->
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only" id="route-announcer"></div>
```

```js
// On every route change:
document.title = 'New Page — Site Name';
document.getElementById('route-announcer').textContent = 'Navigated to New Page';

// Optionally move focus to main content:
document.querySelector('main')?.focus();
```

---

## 5. Modals (High-Error Component)

Modals require exact implementation. Follow this complete pattern:

```html
<!-- MUST have hidden attribute on initial load -->
<div id="modal-1" role="dialog" aria-modal="true" aria-labelledby="modal-1-title" hidden>
  <h2 id="modal-1-title">Edit Profile</h2>
  <div class="modal-body"><!-- content --></div>
  <div class="modal-actions">
    <button type="button" class="btn-cancel">Cancel</button>
    <button type="button" class="btn-confirm">Save</button>
  </div>
</div>
```

```js
function openModal(modalEl, triggerEl) {
  modalEl.hidden = false;
  modalEl.dataset.triggerId = triggerEl.id;

  const focusable = modalEl.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length) focusable[0].focus();

  modalEl._keyHandler = function(e) {
    if (e.key === 'Escape') { closeModal(modalEl); return; }
    if (e.key !== 'Tab') return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  modalEl.addEventListener('keydown', modalEl._keyHandler);
}

function closeModal(modalEl) {
  modalEl.hidden = true;
  modalEl.removeEventListener('keydown', modalEl._keyHandler);
  const trigger = document.getElementById(modalEl.dataset.triggerId);
  if (trigger) trigger.focus();
}
```

**Checklist:**
- `hidden` on initial load (not just CSS `display: none`)
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- Focus first meaningful focusable element on open
- Escape closes, Tab/Shift+Tab trapped, focus returns to trigger on close

---

## 6. Repeated Elements — Unique Labels

When actions repeat across rows/cards/lists, each needs a unique accessible name:

```html
<!-- ❌ Identical labels — useless for screen readers -->
<tr><td>Order #101</td><td><button>View Details</button></td></tr>
<tr><td>Order #102</td><td><button>View Details</button></td></tr>

<!-- ✅ sr-only context -->
<button>View Details<span class="sr-only"> for Order #101</span></button>

<!-- ✅ aria-label -->
<button aria-label="View details for Order #101">View Details</button>

<!-- ✅ aria-describedby -->
<td id="order-101">Order #101</td>
<td><button aria-describedby="order-101">View Details</button></td>
```

Applies to: "View Details", "Edit", "Delete", "Learn More", "Download" — any repeated action.

---

## 7. Pagination

```html
<nav aria-label="Pagination">
  <ul>
    <li><a href="?page=1" aria-label="Go to page 1">1</a></li>
    <li><span aria-current="page" aria-label="Page 2, current page">2</span></li>
    <li><a href="?page=3" aria-label="Go to page 3">3</a></li>
    <li><a href="?page=3" aria-label="Next page">Next →</a></li>
  </ul>
</nav>
```

- "Next"/"Previous" must point to the correct dynamic page
- Use `<button>` or `<a>` — never `<a href="#">`
- `aria-current="page"` on current page

---

## 8. Windows High Contrast & Forced Colors

```css
@media (forced-colors: active) {
  /* Borders become visible in forced-colors — use them for focus */
  :focus-visible {
    outline: 3px solid LinkText;
  }
  /* Custom icons may disappear — provide fallback */
  .icon { forced-color-adjust: auto; }
}
```

Support `prefers-contrast: more` for users who need enhanced contrast:
```css
@media (prefers-contrast: more) {
  :root { --border-color: #000; --text-color: #000; }
}
```

---

## Critical Don'ts

- ❌ `<div onclick>` — use `<button>`
- ❌ `<a href="#">` for actions — use `<button>`
- ❌ `outline: none` — always provide `:focus-visible` outline
- ❌ `box-shadow` as sole focus indicator — fails in High Contrast Mode
- ❌ `tabindex` > 0 — only `0` or `-1`
- ❌ `aria-hidden="true"` on focusable elements
- ❌ `aria-invalid="false"` as default — only set `true` when invalid
- ❌ `aria-sort` on `<button>` — belongs on `<th>`
- ❌ Nested `role="alert"` inside `aria-live` — double announcement
- ❌ `role="status"` for error messages — use `role="alert"`
- ❌ Reusing one live region for multiple unrelated purposes
- ❌ `placeholder` as only label
- ❌ `maximum-scale=1` / `user-scalable=no`
- ❌ Multiple `<h1>` — one per page, logo is not h1
- ❌ Color-only status badges — add icon, text, or pattern
- ❌ Identical labels on repeated buttons
- ❌ `#ccc` for input borders — fails 3:1
- ❌ `text-align: justify`
- ❌ Fixed `height` + `overflow: hidden` — clips at 200% zoom
- ❌ `target="_blank"` without indicating new window — add `<span class="sr-only">(opens in new tab)</span>`
- ❌ `aria-current="page"` on wrong link — must be on the link matching the current page
- ❌ `<nav>` without any `<a>` links — only use `<nav>` for actual navigation
- ❌ Tailwind `border-gray-300`/`border-slate-300` for input borders — use `gray-500`+ (see Tailwind table)
- ❌ Tailwind `ring-blue-300` for focus — use `ring-blue-600`+ (see Tailwind table)
- ❌ Multiple `role="alert"` on individual field errors — use ONE summary alert

## .sr-only

```css
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0;
  margin: -1px; overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}
```

## Reference Files

Read from `references/` when building specific components or frameworks:

- **`common-patterns.md`** — Modals, tabs, accordions, carousels, data tables, cards, toasts, drag & drop, combobox, tooltips, breadcrumbs, password fields.
- **`react.md`** — React/Next.js: useRef focus, route announcements, Radix/React Aria, jest-axe.
- **`vue.md`** — Vue/Nuxt: Teleport focus traps, vue-router announcements, Headless UI.
- **`wcag2.2.md`** — Complete WCAG 2.2 reference, all 86 criteria with code examples.
- **`testing.md`** — Validating output against the project's 29+6 scanner suite.
