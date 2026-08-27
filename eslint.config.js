const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const prettier = require('eslint-config-prettier');

module.exports = [
  { ignores: ['node_modules', 'frontend/.next', 'src/agent/vendor', 'reports', 'test-sites', 'tmp'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.js', 'src/agent/run.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['frontend/**/*.js'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: { ...reactHooks.configs.recommended.rules, 'react/prop-types': 'off' },
  },
  prettier,
];
