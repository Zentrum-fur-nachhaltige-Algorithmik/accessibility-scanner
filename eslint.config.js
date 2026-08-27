const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const prettier = require('eslint-config-prettier');

// Helpers injected into the page before page.evaluate() runs (src/utils/*.js).
const pageGlobals = Object.fromEntries(
  [
    'axe',
    'isElementVisible',
    'getElementSelector',
    '__parseRgb',
    '__getContrastRatio',
    '__blendOver',
    '__isInactive',
    '__resolveBackground',
    '__hasCompliantBorder',
    '__getRenderedBorder',
    '__isLargeText',
    '__isRendered',
    '__accessibleNameInfo',
    '__visibleLabelNormalize',
    '__visibleLabelText',
    '__accessibleName',
    '__labelInNameOk',
    '__isInteractiveTarget',
    '__isFocusableRendered',
    '__nameContainsLabel',
    '__hasAlternativeIdentifier',
    '__isFocusable',
    '__a11ySnapshot',
    '__a11ySelector',
    '__a11yIndicator',
    '__isSrOnly',
  ].map((g) => [g, 'readonly'])
);

const unusedVars = ['error', { args: 'none', caughtErrors: 'none' }];

module.exports = [
  {
    ignores: [
      'node_modules',
      '.claude',
      'frontend/.next',
      'src/agent/vendor',
      'reports',
      'test-sites',
      'tmp',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser, ...pageGlobals },
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': unusedVars,
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: [
      'scripts/**/*.js',
      'eslint.config.js',
      'src/agent/run.js',
      'src/agent/generate-tasks.js',
      'src/agent/validate-nopt.js',
      'src/agent/blind-mode/server/recompute-nopt.js',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...pageGlobals },
    },
    rules: { 'no-console': 'off', 'no-unused-vars': unusedVars },
  },
  {
    files: ['frontend/**/*.js'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  prettier,
];
