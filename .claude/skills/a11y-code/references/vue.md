# Vue / Nuxt Accessibility Patterns

Vue-specific accessibility guidance. Read this when working in a Vue 3 or Nuxt 3 codebase.

## Table of Contents

1. [Focus Management](#focus-management)
2. [Route Announcements](#route-announcements)
3. [Forms](#forms)
4. [Teleport and Focus Traps](#teleport-and-focus-traps)
5. [Component Libraries](#component-libraries)
6. [Common Vue Anti-Patterns](#common-vue-anti-patterns)
7. [Nuxt Specific](#nuxt-specific)
8. [Testing](#testing)

---

## Focus Management

### Template Refs for Focus

```vue
<script setup>
import { ref, nextTick } from 'vue';

const cancelBtn = ref(null);
const isModalOpen = ref(false);

async function openModal() {
  isModalOpen.value = true;
  await nextTick(); // Wait for DOM update
  cancelBtn.value?.focus();
}
</script>

<template>
  <button @click="openModal">Edit</button>
  <div v-if="isModalOpen" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">Edit Item</h2>
    <button ref="cancelBtn" @click="isModalOpen = false">Cancel</button>
    <button @click="save">Save</button>
  </div>
</template>
```

### Return Focus After Close

```vue
<script setup>
import { ref, nextTick } from 'vue';

const isOpen = ref(false);
const triggerBtn = ref(null);

async function close() {
  isOpen.value = false;
  await nextTick();
  triggerBtn.value?.focus();
}
</script>

<template>
  <button ref="triggerBtn" @click="isOpen = true">Settings</button>
  <SettingsModal v-if="isOpen" @close="close" />
</template>
```

---

## Route Announcements

### Vue Router Announcer

```vue
<!-- RouteAnnouncer.vue -->
<script setup>
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const announcement = ref('');

watch(
  () => route.path,
  () => {
    announcement.value = `Navigated to ${document.title}`;
  }
);
</script>

<template>
  <div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
    {{ announcement }}
  </div>
</template>
```

```vue
<!-- App.vue -->
<template>
  <RouteAnnouncer />
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <TheNavigation />
  <main id="main-content" tabindex="-1">
    <RouterView />
  </main>
</template>
```

### Focus Main on Route Change

```js
// router/index.js
router.afterEach(() => {
  nextTick(() => {
    const main = document.getElementById('main-content');
    main?.focus();
  });
});
```

---

## Forms

### Accessible Form Pattern

```vue
<script setup>
import { ref, nextTick } from 'vue';

const errors = ref({});
const errorSummary = ref(null);

async function handleSubmit() {
  errors.value = validate(formData);

  if (Object.keys(errors.value).length > 0) {
    await nextTick();
    errorSummary.value?.focus();
    return;
  }
  // submit...
}
</script>

<template>
  <form @submit.prevent="handleSubmit" novalidate>
    <div v-if="Object.keys(errors).length" ref="errorSummary" tabindex="-1" role="alert">
      <h2>{{ Object.keys(errors).length }} errors found:</h2>
      <ul>
        <li v-for="(msg, field) in errors" :key="field">
          <a :href="`#${field}`">{{ msg }}</a>
        </li>
      </ul>
    </div>

    <div class="form-group">
      <label for="email">Email <span aria-hidden="true">*</span></label>
      <input
        type="email"
        id="email"
        autocomplete="email"
        aria-required="true"
        :aria-invalid="!!errors.email"
        :aria-describedby="errors.email ? 'email-error' : undefined"
      />
      <p v-if="errors.email" id="email-error" class="error" role="alert">
        {{ errors.email }}
      </p>
    </div>

    <button type="submit">Send</button>
  </form>
</template>
```

### Key Rules
- Use `:aria-describedby` with conditional binding — don't point to nonexistent elements
- `role="alert"` on error messages triggers screen reader announcement on render
- Focus error summary after failed validation using `nextTick()` + `focus()`

---

## Teleport and Focus Traps

Vue's `<Teleport>` moves DOM nodes — focus management doesn't come for free.

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';

const props = defineProps(['open']);
const emit = defineEmits(['close']);
const dialog = ref(null);

function handleKeydown(e) {
  if (e.key === 'Escape') emit('close');
  if (e.key === 'Tab') trapFocus(e);
}

function trapFocus(e) {
  const focusable = dialog.value?.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable?.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

onMounted(async () => {
  await nextTick();
  const firstFocusable = dialog.value?.querySelector(
    'button, [href], input, select, textarea'
  );
  firstFocusable?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        @keydown="handleKeydown"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
```

---

## Component Libraries

### Recommended
- **Radix Vue** — Port of Radix UI for Vue, accessibility built-in
- **Headless UI** — `@headlessui/vue`, Tailwind Labs, full keyboard + ARIA
- **PrimeVue** — Has accessibility features, check individual components
- **Vuetify 3** — Improved a11y, but verify ARIA on custom components

### Pattern: Wrapping a Library Component

```vue
<!-- Even when using a library, verify the output -->
<script setup>
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/vue';
</script>

<template>
  <Dialog :open="isOpen" @close="close">
    <div class="overlay" aria-hidden="true" />
    <DialogPanel>
      <DialogTitle>Delete Account</DialogTitle>
      <p>Are you sure?</p>
      <button @click="close">Cancel</button>
      <button @click="confirmDelete">Delete</button>
    </DialogPanel>
  </Dialog>
</template>
```

---

## Common Vue Anti-Patterns

### ❌ v-html without ARIA context
```vue
<!-- BAD — dynamic HTML may lack accessibility -->
<div v-html="richContent" />

<!-- GOOD — wrap in landmark with label -->
<section aria-label="Article content" v-html="richContent" />
```

### ❌ @click on non-interactive elements
```vue
<!-- BAD -->
<div @click="handleAction" class="clickable">Do something</div>

<!-- GOOD -->
<button @click="handleAction">Do something</button>
```

### ❌ Transition without reduced motion
```vue
<!-- BAD — no motion preference check -->
<Transition name="slide"><div v-if="show">...</div></Transition>

<!-- GOOD — disable transition for reduced motion -->
<Transition :name="prefersReducedMotion ? '' : 'slide'">
  <div v-if="show">...</div>
</Transition>
```

```js
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

### ❌ v-for without proper keys
```vue
<!-- BAD — focus state lost on reorder -->
<li v-for="(item, index) in items" :key="index">

<!-- GOOD -->
<li v-for="item in items" :key="item.id">
```

---

## Nuxt Specific

### Layout with Landmarks
```vue
<!-- layouts/default.vue -->
<template>
  <div>
    <a href="#main-content" class="skip-link">Skip to main content</a>
    <TheHeader />
    <main id="main-content" tabindex="-1">
      <slot />
    </main>
    <TheFooter />
  </div>
</template>
```

### Page Titles
```vue
<!-- pages/contact.vue -->
<script setup>
useHead({
  title: 'Contact Us — Acme Corp',
  htmlAttrs: { lang: 'en' },
});
</script>
```

### Middleware for Route Announcements
```js
// middleware/announce-route.global.js
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.client) {
    nextTick(() => {
      const announcer = document.getElementById('route-announcer');
      if (announcer) announcer.textContent = `Navigated to ${document.title}`;
    });
  }
});
```

---

## Testing

### vitest + @testing-library/vue

```js
import { render, screen } from '@testing-library/vue';
import { axe, toHaveNoViolations } from 'jest-axe';
import ContactForm from './ContactForm.vue';

expect.extend(toHaveNoViolations);

test('form is accessible', async () => {
  const { container } = render(ContactForm);
  expect(await axe(container)).toHaveNoViolations();
});

test('errors are announced', async () => {
  render(ContactForm);
  await screen.getByRole('button', { name: 'Send' }).click();
  expect(await screen.findByRole('alert')).toBeTruthy();
});
```
