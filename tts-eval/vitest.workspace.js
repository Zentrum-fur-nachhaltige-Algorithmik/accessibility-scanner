import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.js'],
      testTimeout: 30000,
    },
  },
  {
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.js'],
      testTimeout: 30000,
    },
  },
  {
    test: {
      name: 'eval',
      include: ['tests/eval/**/*.test.js'],
      testTimeout: 30000,
    },
  },
]);
