# Web Accessibility Guide

Concise reference for building WCAG 2.2 AA compliant websites. Derived from building and scanning the Abraham-Nemeth-Gesellschaft website with a 29-scanner accessibility suite.

## Document Structure

- Single `<h1>` per page. Strict hierarchy: h1 > h2 > h3. Never skip levels.
- Use semantic HTML elements: `<header>`, `<nav>`, `<main>`, `<footer>`, `<section>`, `<article>`, `<address>`.
- Every `<section>` should have `aria-labelledby` pointing to its heading's `id`.
- `<nav>` elements need `aria-label` distinguishing them (e.g. "Hauptnavigation", "Rechtliche Hinweise").
- Set `lang` attribute on `<html>`. Wrap content in other languages with `<span lang="en">` or `<div lang="en">`.
- Use `<time datetime="...">` for all dates.

## Skip Navigation

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
<!-- ... header/nav ... -->
<main id="main-content">
```

The skip link must be the first focusable element. Style it offscreen, visible on `:focus`.

## Color & Contrast

- **Normal text**: minimum 4.5:1 contrast ratio (AA), 7:1 for AAA.
- **Large text** (18pt+ or 14pt+ bold): minimum 3:1 (AA).
- **UI components** (borders, icons, form controls): minimum 3:1.
- Never convey information by color alone. Links must be underlined, not just colored. Required fields need text markers (`*` plus "(required)"/"(Pflichtfeld)"), not just color.
- Test with tools: Chrome DevTools contrast checker, or dedicated contrast ratio calculators.

## Typography

- Use relative units (`rem`, `em`) for all font sizes and spacing. Never `px` for text.
- Set `line-height` to at least 1.5 for body text.
- Ensure content is readable and functional at 200% browser zoom without horizontal scrolling.
- Avoid fixed heights on text containers.

## Forms

Every form input needs:
- A visible `<label>` element with matching `for`/`id`.
- `aria-required="true"` on required fields.
- `aria-invalid="true"` when validation fails.
- `aria-describedby` pointing to error message `id`.
- Error messages with `role="alert"` or inside an `aria-live` region.

Group related controls with `<fieldset>` and `<legend>`.

```html
<fieldset>
  <legend>Contact Form</legend>
  <div>
    <label for="email">
      Email <span aria-hidden="true">*</span>
      <span class="sr-only">(required)</span>
    </label>
    <input type="email" id="email"
      aria-required="true"
      aria-invalid="false"
      aria-describedby="email-error" />
    <p id="email-error" class="error" role="alert"></p>
  </div>
</fieldset>
```

## Keyboard Navigation

- All interactive elements must be operable via keyboard (Tab, Enter, Space, Escape).
- Use native HTML elements (`<a>`, `<button>`, `<input>`) — they are keyboard accessible by default.
- Never use `<div onclick>` for interactive elements. If you must, add `role="button"`, `tabindex="0"`, and keydown handlers.
- Tab order must follow visual/logical order (match DOM order to visual layout).
- No keyboard traps — users must be able to Tab away from any element.

## Focus Indicators

```css
:focus-visible {
  outline: 3px solid #1b2a4a;
  outline-offset: 2px;
}
```

- Never `outline: none` without providing an alternative visible indicator.
- Focus indicators must have sufficient contrast (3:1 against adjacent colors).
- Minimum touch target size: 44x44px.

## Images & Media

- Every `<img>` needs `alt` text. Decorative images: `alt=""`.
- SVG icons: `role="img"` and `aria-label="description"`.
- Background images that convey information need a text alternative.
- Video needs captions. Audio needs transcripts.
- No auto-playing media. If unavoidable, provide pause/stop controls.

## ARIA

Prefer semantic HTML over ARIA. Only use ARIA when HTML semantics are insufficient.

- `aria-live="polite"` for status updates (loading states, form submission results).
- `aria-current="page"` on the active navigation link.
- `aria-expanded` on toggles that show/hide content.
- `aria-labelledby` on sections to connect them to their headings.
- Never use `aria-label` to override visible text. The accessible name must match the visible label.

## Screen Reader Utility Class

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Use for content that should be announced by screen readers but not visible.

## Motion & Animation

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- No flashing content (3+ flashes per second = seizure risk).
- Respect `prefers-reduced-motion`.
- Decorative animations should be opt-in, not opt-out.

## Responsive Design / Reflow

- Content must reflow at 320px viewport width without horizontal scrolling.
- Use CSS Grid/Flexbox. Cards stack to single column on mobile.
- Test at: 320px, 480px, 768px, 1440px.
- No information loss when text spacing is adjusted (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em).

## Links

- Link text must describe the destination. Never "click here" or "read more" alone.
- If link text must be generic, use `aria-label` with the full description.
- Links must be visually distinguishable from surrounding text (underline, not just color).
- External links: consider indicating they open in new context.

## Tables

- Use `<caption>` for table titles.
- Use `<th scope="col">` and `<th scope="row">` for header cells.
- Never use tables for layout.

## Testing Checklist

1. **Keyboard**: Tab through entire page. Can you reach and operate everything?
2. **Zoom**: Set browser to 200%. Does content reflow without horizontal scroll?
3. **Headings**: Check heading hierarchy in dev tools. Any skipped levels?
4. **Contrast**: Run browser's built-in contrast checker on all text.
5. **Screen reader**: Test with NVDA (Windows) or VoiceOver (Mac). Are all elements announced correctly?
6. **Reduced motion**: Enable `prefers-reduced-motion` in OS settings. Do animations stop?
7. **Forms**: Submit empty forms. Are errors announced? Do focus states work?
8. **Automated scan**: Run axe-core, WAVE, or the project's own scanner against all pages.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing `lang` attribute on `<html>` | Add `<html lang="de">` (or appropriate language) |
| Multiple `<h1>` elements | Use single `<h1>`, rest are `<h2>`+ |
| Form inputs without labels | Add `<label for="id">` for every input |
| Color-only link distinction | Add underline to links |
| Fixed pixel font sizes | Use `rem` or `em` |
| `div` with click handler | Use `<button>` instead |
| Missing alt text on images | Add descriptive `alt` or `alt=""` for decorative |
| No skip navigation link | Add skip link as first focusable element |
| `outline: none` on focus | Provide `:focus-visible` styles instead |
| Auto-playing video/audio | Add controls, respect user preferences |
