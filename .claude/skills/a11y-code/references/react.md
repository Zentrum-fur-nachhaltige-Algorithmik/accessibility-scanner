# React / Next.js Accessibility Patterns

React-specific accessibility guidance. Read this when working in a React or Next.js codebase.

## Table of Contents

1. [Focus Management](#focus-management)
2. [Route Change Announcements](#route-change-announcements)
3. [Forms in React](#forms-in-react)
4. [Component Libraries](#component-libraries)
5. [Common React Anti-Patterns](#common-react-anti-patterns)
6. [Testing](#testing)
7. [Next.js Specific](#nextjs-specific)

---

## Focus Management

### Moving Focus After Actions

```jsx
import { useRef, useEffect } from 'react';

function DeleteConfirmation({ itemName, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  // Focus the cancel button when dialog mounts
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">Delete {itemName}?</h2>
      <p>This action cannot be undone.</p>
      <button onClick={onCancel} ref={cancelRef}>Cancel</button>
      <button onClick={onConfirm}>Delete</button>
    </div>
  );
}
```

### Returning Focus After Modal Close

```jsx
function useModal() {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);

  const open = () => setIsOpen(true);
  const close = () => {
    setIsOpen(false);
    // Return focus to trigger element
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return { isOpen, open, close, triggerRef };
}

// Usage:
function Page() {
  const { isOpen, open, close, triggerRef } = useModal();
  return (
    <>
      <button ref={triggerRef} onClick={open}>Edit Profile</button>
      {isOpen && <EditProfileModal onClose={close} />}
    </>
  );
}
```

### Focus After Dynamic Content (List Deletion, etc.)

```jsx
function TaskList({ tasks, onDelete }) {
  const listRef = useRef(null);
  const [deletedIndex, setDeletedIndex] = useState(null);

  useEffect(() => {
    if (deletedIndex !== null) {
      // Focus next item, or previous if last was deleted, or the list itself
      const items = listRef.current?.querySelectorAll('[data-task]');
      const target = items?.[deletedIndex] || items?.[deletedIndex - 1] || listRef.current;
      target?.focus();
      setDeletedIndex(null);
    }
  }, [deletedIndex, tasks]);

  return (
    <ul ref={listRef} tabIndex={-1}>
      {tasks.map((task, i) => (
        <li key={task.id} data-task tabIndex={-1}>
          {task.name}
          <button
            aria-label={`Delete ${task.name}`}
            onClick={() => { onDelete(task.id); setDeletedIndex(i); }}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
```

---

## Route Change Announcements

SPAs don't trigger native page load announcements. You must announce route changes manually.

### Route Announcer Component

```jsx
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom'; // or Next.js usePathname

function RouteAnnouncer() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    // Update document title
    const pageTitle = document.title;
    setAnnouncement(`Navigated to ${pageTitle}`);
  }, [location.pathname]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}

// Mount once in your App/Layout:
function App() {
  return (
    <>
      <RouteAnnouncer />
      <Routes>...</Routes>
    </>
  );
}
```

### Focus Reset on Navigation

```jsx
function App() {
  const location = useLocation();
  const mainRef = useRef(null);

  useEffect(() => {
    // Move focus to main content on route change
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <>
      <nav>...</nav>
      <main ref={mainRef} tabIndex={-1} id="main-content">
        <Routes>...</Routes>
      </main>
    </>
  );
}
```

---

## Forms in React

### Accessible Form with Error Handling

```jsx
function ContactForm() {
  const [errors, setErrors] = useState({});
  const errorSummaryRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validate(formData);

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Focus error summary
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    // submit...
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {Object.keys(errors).length > 0 && (
        <div ref={errorSummaryRef} tabIndex={-1} role="alert">
          <h2>There were {Object.keys(errors).length} errors:</h2>
          <ul>
            {Object.entries(errors).map(([field, msg]) => (
              <li key={field}><a href={`#${field}`}>{msg}</a></li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="email">
          Email <span aria-hidden="true">*</span>
        </label>
        <input
          type="email"
          id="email"
          name="email"
          autoComplete="email"
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <p id="email-error" className="error" role="alert">
            {errors.email}
          </p>
        )}
      </div>

      <button type="submit">Send</button>
    </form>
  );
}
```

### Key Rules for React Forms
- Use `htmlFor` (not `for`) on `<label>` elements
- Error messages: render with `role="alert"` — React's re-render triggers announcement
- Focus error summary or first invalid field after failed validation
- Use `aria-describedby` to link inputs to their error messages
- `noValidate` on `<form>` to use custom validation instead of browser defaults

---

## Component Libraries

### Recommended: Accessibility-first Libraries

**Radix UI** (headless, unstyled)
```jsx
import * as Dialog from '@radix-ui/react-dialog';

function Modal({ trigger, title, children }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby={undefined}>
          <Dialog.Title>{title}</Dialog.Title>
          {children}
          <Dialog.Close asChild>
            <button aria-label="Close">×</button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**React Aria** (Adobe, hook-based)
```jsx
import { useButton } from 'react-aria';

function AccessibleButton(props) {
  const ref = useRef(null);
  const { buttonProps } = useButton(props, ref);
  return <button {...buttonProps} ref={ref}>{props.children}</button>;
}
```

**Headless UI** (Tailwind Labs, for Tailwind projects)
```jsx
import { Dialog, Transition } from '@headlessui/react';
// Full accessibility built in — focus trap, Escape handling, ARIA
```

### Libraries to Avoid (Without Accessibility Wrappers)
- Raw Material UI without their accessibility props
- Custom `<div>` based components without ARIA
- Any component that doesn't manage focus on open/close

---

## Common React Anti-Patterns

### ❌ onClick on non-interactive elements
```jsx
// BAD
<div onClick={handleClick} className="clickable">Click me</div>

// GOOD
<button onClick={handleClick}>Click me</button>
```

### ❌ Conditional ARIA attributes
```jsx
// BAD — aria-describedby points to nonexistent element
<input aria-describedby="error-msg" />
{hasError && <p id="error-msg">Error!</p>}

// GOOD — only set aria-describedby when error element exists
<input aria-describedby={hasError ? 'error-msg' : undefined} />
{hasError && <p id="error-msg">Error!</p>}
```

### ❌ Using index as key for reorderable lists
```jsx
// BAD — focus and screen reader state breaks on reorder
{items.map((item, i) => <ListItem key={i} />)}

// GOOD
{items.map((item) => <ListItem key={item.id} />)}
```

### ❌ forwardRef missing on custom components used as triggers
```jsx
// BAD — Radix/Headless UI can't set ref for focus management
const MyButton = (props) => <button {...props} />;
<Dialog.Trigger asChild><MyButton>Open</MyButton></Dialog.Trigger>

// GOOD
const MyButton = forwardRef((props, ref) => <button ref={ref} {...props} />);
```

### ❌ useEffect for live regions
```jsx
// BAD — setting textContent doesn't trigger aria-live announcement in React
useEffect(() => {
  liveRef.current.textContent = 'Updated!';
}, [status]);

// GOOD — use state so React re-renders the live region content
const [announcement, setAnnouncement] = useState('');
// ... setAnnouncement('Updated!');
return <div role="status" aria-live="polite">{announcement}</div>;
```

---

## Testing

### jest-axe
```jsx
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('form has no accessibility violations', async () => {
  const { container } = render(<ContactForm />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### Testing Library (queries by role)
```jsx
import { render, screen } from '@testing-library/react';

test('modal is accessible', () => {
  render(<SettingsModal isOpen />);

  // Query by role — if this fails, the ARIA is wrong
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

  // Buttons are found by accessible name
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

test('error is announced', async () => {
  render(<ContactForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  // role="alert" is queryable
  expect(await screen.findByRole('alert')).toHaveTextContent(/email/i);
});
```

---

## Next.js Specific

### Automatic Route Announcements (App Router)
Next.js 13+ with App Router includes a built-in route announcer. Verify it's working. If not, add the `RouteAnnouncer` component from above.

### Image Optimization
```jsx
import Image from 'next/image';

// Always provide alt text
<Image src="/hero.jpg" alt="Team meeting in progress" width={800} height={400} />

// Decorative images
<Image src="/decorative-bg.jpg" alt="" width={800} height={400} role="presentation" />
```

### Metadata
```jsx
// app/layout.js — always set lang
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

// app/page.js — descriptive page titles
export const metadata = {
  title: 'Contact Us — Acme Corp',
};
```

### Server Components & ARIA
ARIA attributes work in Server Components. Event handlers (`onClick`, `onKeyDown`) require `'use client'`. Split interactive parts into client components:

```jsx
// server component — static structure
export default function Page() {
  return (
    <main id="main-content">
      <h1>Dashboard</h1>
      <InteractiveWidget /> {/* client component */}
    </main>
  );
}
```
