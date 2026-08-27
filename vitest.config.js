import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['tests/unit/**/*.test.js'], testTimeout: 10000 },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.js'],
          testTimeout: 120000,
          hookTimeout: 180000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'self-scan',
          include: ['tests/self-scan/**/*.test.js'],
          testTimeout: 240000,
          hookTimeout: 240000,
        },
      },
    ],
  },
});
