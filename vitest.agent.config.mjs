import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/agent/**/*.test.js'], testTimeout: 60000, hookTimeout: 120000 },
});
