# Common Accessible Component Patterns

Detailed implementation patterns for frequently built components. Each pattern includes the required HTML structure, ARIA attributes, keyboard interactions, and CSS considerations.

## Table of Contents

1. [Modal / Dialog](#modal--dialog)
2. [Accordion](#accordion)
3. [Tabs](#tabs)
4. [Dropdown Menu](#dropdown-menu)
5. [Toast / Notification](#toast--notification)
6. [Data Table (Sortable)](#data-table-sortable)
7. [Card (Clickable)](#card-clickable)
8. [Carousel / Slider](#carousel--slider)
9. [Autocomplete / Combobox](#autocomplete--combobox)
10. [Drag & Drop with Alternatives](#drag--drop-with-alternatives)
11. [Tooltip](#tooltip)
12. [Breadcrumb](#breadcrumb)
13. [Pagination](#pagination)
14. [Password Field](#password-field)

---

## Modal / Dialog

### HTML Structure
```html
<button id="open-modal" aria-haspopup="dialog">Open Settings</button>

<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" id="settings-dialog" hidden>
  <h2 id="dialog-title">Settings</h2>
  <div class="dialog-body">
    <!-- content -->
  </div>
  <div class="dialog-actions">
    <button type="button" id="cancel-btn">Cancel</button>
    <button type="button" id="save-btn">Save</button>
  </div>
</div>
```

Better: use native `<dialog>` element where browser support allows:
```html
<dialog id="settings-dialog" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Settings</h2>
  <!-- ... -->
</dialog>
```

### Keyboard
- **Escape**: Close dialog
- **Tab / Shift+Tab**: Cycle focus within dialog (focus trap)
- On open: focus first focusable element (or dialog itself if no focusable children)
- On close: return focus to the element that triggered the dialog

### JavaScript Pattern
```js
function openDialog(dialog, triggerElement) {
  dialog.hidden = false; // or dialog.showModal() for <dialog>
  dialog.dataset.trigger = triggerElement.id;

  const focusable = dialog.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length) focusable[0].focus();
  else dialog.focus();

  dialog.addEventListener('keydown', trapFocus);
}

function closeDialog(dialog) {
  dialog.hidden = true; // or dialog.close() for <dialog>
  const trigger = document.getElementById(dialog.dataset.trigger);
  if (trigger) trigger.focus();
  dialog.removeEventListener('keydown', trapFocus);
}

function trapFocus(e) {
  if (e.key === 'Escape') { closeDialog(e.currentTarget); return; }
  if (e.key !== 'Tab') return;

  const dialog = e.currentTarget;
  const focusable = [...dialog.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}
```

### CSS
```css
/* Backdrop must not be the only way to close — always provide a close button */
dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
```

---

## Accordion

### Preferred: Native HTML
```html
<details>
  <summary>Section Title</summary>
  <div class="accordion-content">
    <p>Content here...</p>
  </div>
</details>
```

No JavaScript or ARIA needed with `<details>`/`<summary>`.

### Custom (when native won't work)
```html
<div class="accordion">
  <h3>
    <button aria-expanded="false" aria-controls="section1-content" id="section1-btn">
      Section Title
    </button>
  </h3>
  <div id="section1-content" role="region" aria-labelledby="section1-btn" hidden>
    <p>Content here...</p>
  </div>
</div>
```

### Keyboard
- **Enter / Space**: Toggle expanded state
- **Arrow Down/Up** (optional): Move between accordion headers

---

## Tabs

### HTML Structure
```html
<div class="tabs">
  <div role="tablist" aria-label="Account settings">
    <button role="tab" id="tab-1" aria-selected="true" aria-controls="panel-1">
      Profile
    </button>
    <button role="tab" id="tab-2" aria-selected="false" aria-controls="panel-2" tabindex="-1">
      Security
    </button>
    <button role="tab" id="tab-3" aria-selected="false" aria-controls="panel-3" tabindex="-1">
      Notifications
    </button>
  </div>

  <div role="tabpanel" id="panel-1" aria-labelledby="tab-1">
    <!-- Profile content -->
  </div>
  <div role="tabpanel" id="panel-2" aria-labelledby="tab-2" hidden>
    <!-- Security content -->
  </div>
  <div role="tabpanel" id="panel-3" aria-labelledby="tab-3" hidden>
    <!-- Notifications content -->
  </div>
</div>
```

### Keyboard
- **Arrow Left/Right**: Move between tabs
- **Home**: First tab
- **End**: Last tab
- **Tab**: From active tab, move focus into tab panel
- Only the active tab has `tabindex="0"` — inactive tabs have `tabindex="-1"` (roving tabindex)

---

## Dropdown Menu

### HTML Structure
```html
<div class="dropdown">
  <button aria-expanded="false" aria-haspopup="true" aria-controls="menu-1">
    Actions
  </button>
  <ul role="menu" id="menu-1" hidden>
    <li role="menuitem"><button>Edit</button></li>
    <li role="menuitem"><button>Duplicate</button></li>
    <li role="separator"></li>
    <li role="menuitem"><button>Delete</button></li>
  </ul>
</div>
```

### Keyboard
- **Enter / Space / Arrow Down**: Open menu, focus first item
- **Arrow Down/Up**: Navigate items
- **Escape**: Close menu, return focus to trigger
- **Home/End**: First/last item
- Type-ahead: typing a letter focuses the next item starting with that letter

---

## Toast / Notification

### HTML Structure
```html
<!-- Container must exist in DOM BEFORE content is added -->
<div id="toast-region" role="status" aria-live="polite" class="toast-container">
  <!-- Toasts are injected here -->
</div>
```

```js
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  const container = document.getElementById('toast-region');
  container.appendChild(toast);

  // Auto-dismiss after reasonable time (not too short for screen readers)
  setTimeout(() => toast.remove(), 8000);
}
```

### Rules
- Use `role="status"` + `aria-live="polite"` for non-urgent messages
- Use `role="alert"` for urgent errors
- The live region container must exist in the DOM before content is injected (adding `aria-live` dynamically doesn't work reliably)
- Don't auto-dismiss errors — users need time to read and act
- Provide a way to review past notifications

---

## Data Table (Sortable)

### HTML Structure
```html
<table>
  <caption>Employee Directory — 42 results</caption>
  <thead>
    <tr>
      <th scope="col" aria-sort="ascending">
        <button>Name <span aria-hidden="true">▲</span></button>
      </th>
      <th scope="col" aria-sort="none">
        <button>Department <span aria-hidden="true">↕</span></button>
      </th>
      <th scope="col">Email</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Anna Schmidt</td>
      <td>Engineering</td>
      <td><a href="mailto:anna@example.com">anna@example.com</a></td>
    </tr>
  </tbody>
</table>

<!-- Announce sort changes -->
<div role="status" aria-live="polite" class="sr-only" id="sort-status"></div>
```

```js
function sortTable(column, direction) {
  // ... sorting logic ...
  document.getElementById('sort-status').textContent =
    `Table sorted by ${column}, ${direction}`;
}
```

### Rules
- Always use `<caption>` — it's the table's accessible name
- Use `<th scope="col">` and `<th scope="row">`
- `aria-sort="ascending|descending|none"` on sortable column headers
- Announce sort changes via live region
- Never use tables for layout

---

## Card (Clickable)

### Pattern: Pseudo-element stretch link
```html
<article class="card">
  <img src="product.jpg" alt="Running shoe model X200 in blue">
  <h3><a href="/products/x200" class="card-link">Running Shoe X200</a></h3>
  <p>Lightweight performance shoe for daily training.</p>
  <p class="price">$129.99</p>
</article>
```

```css
.card { position: relative; }
.card-link::after {
  content: "";
  position: absolute;
  inset: 0; /* Makes entire card clickable */
}
/* Ensure text selection still works for paragraph content */
.card p { position: relative; z-index: 1; }
```

### Rules
- One link per card in the accessibility tree (no duplicate "Read more" links)
- Don't wrap the entire card in `<a>` — it makes the entire card content the link text (too verbose for screen readers)
- Don't use `<div onclick>` for the card

---

## Carousel / Slider

```html
<section aria-label="Featured products" aria-roledescription="carousel">
  <div class="carousel-controls">
    <button aria-label="Previous slide">‹</button>
    <button aria-label="Next slide">›</button>
    <button aria-label="Pause auto-play" id="carousel-pause">⏸</button>
  </div>

  <div aria-live="polite" class="slides">
    <div role="group" aria-roledescription="slide" aria-label="1 of 5">
      <!-- slide content -->
    </div>
  </div>
</section>
```

### Rules
- If auto-playing: MUST have a visible pause button
- Respect `prefers-reduced-motion: reduce` — stop all auto-play
- Announce current slide via `aria-live="polite"` region
- Touch swipe must have button alternatives

---

## Autocomplete / Combobox

```html
<div class="combobox-wrapper">
  <label for="city-input">City</label>
  <input type="text" id="city-input"
    role="combobox"
    aria-expanded="false"
    aria-autocomplete="list"
    aria-controls="city-listbox"
    aria-activedescendant="">
  <ul role="listbox" id="city-listbox" hidden>
    <li role="option" id="city-1">Berlin</li>
    <li role="option" id="city-2">Vienna</li>
  </ul>
</div>
```

### Keyboard
- **Arrow Down**: Open list / move to next option
- **Arrow Up**: Move to previous option
- **Enter**: Select highlighted option
- **Escape**: Close list, clear highlight
- Update `aria-activedescendant` to the `id` of the highlighted option
- Update `aria-expanded` when list opens/closes

---

## Drag & Drop with Alternatives (WCAG 2.5.7)

```html
<ul id="task-list">
  <li>
    <span>Task A</span>
    <button aria-label="Move Task A up">↑</button>
    <button aria-label="Move Task A down">↓</button>
  </li>
  <li>
    <span>Task B</span>
    <button aria-label="Move Task B up">↑</button>
    <button aria-label="Move Task B down">↓</button>
  </li>
</ul>

<!-- Announce reorder -->
<div role="status" aria-live="polite" class="sr-only" id="reorder-status"></div>
```

Drag & drop is fine as an enhancement, but there MUST be a non-drag alternative (buttons, select dropdowns, keyboard arrows).

---

## Tooltip

```html
<button aria-describedby="tooltip-1" class="tooltip-trigger">
  Settings
</button>
<div role="tooltip" id="tooltip-1" class="tooltip">
  Configure your account preferences
</div>
```

```css
.tooltip { display: none; }
.tooltip-trigger:hover + .tooltip,
.tooltip-trigger:focus + .tooltip,
.tooltip:hover {
  display: block;
}
```

### Rules
- Visible on hover AND focus
- Stays visible when user hovers over the tooltip itself
- Dismissable with Escape key
- Does not obscure the trigger element
- Use `aria-describedby` (supplementary info) or `aria-labelledby` (name), not both for the same content

---

## Breadcrumb

```html
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li><a href="/products">Products</a></li>
    <li><a href="/products/shoes">Shoes</a></li>
    <li aria-current="page">Running Shoe X200</li>
  </ol>
</nav>
```

- Use `<nav>` with `aria-label="Breadcrumb"`
- Use `<ol>` (ordered list — the order matters)
- Last item: `aria-current="page"`, no link

---

## Pagination

```html
<nav aria-label="Pagination">
  <ul>
    <li><a href="?page=1" aria-label="Go to page 1">1</a></li>
    <li><a href="?page=2" aria-current="page" aria-label="Page 2, current page">2</a></li>
    <li><a href="?page=3" aria-label="Go to page 3">3</a></li>
    <li><a href="?page=4" aria-label="Go to page 4">4</a></li>
    <li><a href="?page=3" aria-label="Next page">Next →</a></li>
  </ul>
</nav>
```

---

## Password Field (WCAG 3.3.8)

```html
<div class="form-group">
  <label for="password">Password</label>
  <div class="password-wrapper">
    <input type="password" id="password"
      autocomplete="current-password"
      aria-describedby="pwd-requirements">
    <button type="button" aria-label="Show password" onclick="togglePasswordVisibility(this)">
      👁
    </button>
  </div>
  <p id="pwd-requirements">Minimum 8 characters, including a number and special character.</p>
</div>
```

### Critical Rules
- NEVER block paste: no `onpaste="return false"` or JS paste prevention
- NEVER set `autocomplete="off"` on password fields
- Use `autocomplete="current-password"` (login) or `autocomplete="new-password"` (registration)
- For OTP/2FA: `autocomplete="one-time-code"` + `inputmode="numeric"`
- Show/hide toggle must update its `aria-label` ("Show password" ↔ "Hide password")
