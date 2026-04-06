#!/usr/bin/env node

/**
 * HTML File to Scanner Mapping Configuration
 * 
 * Defines which scanners should trigger on which HTML test files
 * This creates a structured approach for targeted testing instead of 
 * brute-force matrix testing of all scanner×file combinations
 */

/**
 * Test File to Scanner Mapping
 * 
 * Structure:
 * - fileName: { 
 *     expectedScanners: [list of scanners that SHOULD find violations],
 *     excludedScanners: [list of scanners that should NOT trigger],
 *     testType: 'bad' | 'good',
 *     wcagCriteria: [relevant WCAG criteria],
 *     description: 'human readable description'
 *   }
 */
const HTML_SCANNER_MAPPING = {
  // === PHASE 1 FOUNDATION PATTERNS ===
  
  // Image Alt Text Issues
  'bad-image-alt.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.1.1'],
    description: 'Images without alternative text - should trigger page structure scanner for ARIA/semantic issues'
  },
  
  'bad-image-alt-complex.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text', 'keyboard-navigation'],
    testType: 'bad', 
    wcagCriteria: ['1.1.1'],
    description: 'Complex images with inadequate alt text descriptions'
  },

  // Form Label Issues
  'bad-form-labels.html': {
    expectedScanners: ['page-structure', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['1.3.1', '3.3.2'],
    description: 'Form controls missing proper labels and associations'
  },

  'bad-form-grouping.html': {
    expectedScanners: ['page-structure', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.3.1', '3.3.2'],
    description: 'Form controls missing fieldset grouping and proper structure'
  },

  // Media Alternatives
  'bad-media-alternatives.html': {
    expectedScanners: ['page-structure', 'timing-controls'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.2.1', '1.2.2', '1.2.3'],
    description: 'Audio/video content missing captions, transcripts, or audio descriptions'
  },

  // Icon Accessibility
  'bad-icon-accessibility.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.1.1', '4.1.2'],
    description: 'Icons without proper accessible names or ARIA labels'
  },

  // === PHASE 2 KEYBOARD & NAVIGATION ===
  
  // Keyboard Access
  'bad-keyboard-access.html': {
    expectedScanners: ['keyboard-navigation', 'focus-management'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['2.1.1', '2.1.2'],
    description: 'Interactive elements not accessible via keyboard'
  },

  'bad-keyboard-native-override.html': {
    expectedScanners: ['keyboard-navigation', 'input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.1.1', '2.5.1'],
    description: 'Custom controls overriding native keyboard behavior'
  },

  // Keyboard Traps
  'bad-keyboard-trap.html': {
    expectedScanners: ['keyboard-navigation', 'focus-management'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['2.1.2'],
    description: 'Focus trapped in components without escape mechanism'
  },

  // Focus Management
  'bad-focus-management.html': {
    expectedScanners: ['focus-management', 'keyboard-navigation'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['2.4.3', '2.4.7'],
    description: 'Poor focus management in dynamic content and modals'
  },

  'bad-focus-order.html': {
    expectedScanners: ['focus-management', 'keyboard-navigation'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.4.3'],
    description: 'Illogical or non-sequential focus order'
  },

  'bad-focus-visible.html': {
    expectedScanners: ['focus-management', 'color-contrast'],
    excludedScanners: ['use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['2.4.7', '1.4.3'],
    description: 'Missing or insufficient focus indicators'
  },

  // Link Purpose
  'bad-link-purpose.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['2.4.4', '2.4.9'],
    description: 'Links with ambiguous or non-descriptive text'
  },

  // === PHASE 3 ADVANCED PATTERNS ===
  
  // Reflow and Responsive Design
  'bad-reflow.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.4.10'],
    description: 'Content breaks or becomes unusable when zoomed to 400%'
  },

  'bad-text-resize.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.4.4'],
    description: 'Text cannot be resized up to 200% without loss of functionality'
  },

  // Language Detection
  'bad-language.html': {
    expectedScanners: ['language-detection'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['3.1.1', '3.1.2'],
    description: 'Missing or incorrect language declarations'
  },

  'bad-language-override.html': {
    expectedScanners: ['language-detection'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['3.1.2'],
    description: 'Foreign language content without proper lang attribute overrides'
  },

  // Context Changes
  'bad-context-change.html': {
    expectedScanners: ['predictable-navigation', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['3.2.1', '3.2.2'],
    description: 'Unexpected context changes on focus or input'
  },

  // === ORIGINAL COMPREHENSIVE PATTERNS ===
  
  // Color and Contrast
  'bad-color-contrast.html': {
    expectedScanners: ['color-contrast'],
    excludedScanners: ['use-of-color', 'images-of-text', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.4.3', '1.4.6'],
    description: 'Insufficient color contrast ratios for text and backgrounds'
  },

  'bad-use-of-color.html': {
    expectedScanners: ['use-of-color'],
    excludedScanners: ['color-contrast', 'images-of-text', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.4.1'],
    description: 'Information conveyed by color alone without alternative indicators'
  },

  'bad-images-of-text.html': {
    expectedScanners: ['images-of-text'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.4.5', '1.4.9'],
    description: 'Text rendered as images instead of actual text'
  },

  'bad-nontext-contrast.html': {
    expectedScanners: ['color-contrast'],
    excludedScanners: ['use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['1.4.11'],
    description: 'Non-text UI components with insufficient contrast'
  },

  // Timing and Motion
  'bad-timing-controls.html': {
    expectedScanners: ['timing-controls'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['2.2.1', '2.2.2'],
    description: 'Auto-playing content without user controls or time limits'
  },

  'bad-seizure-risk.html': {
    expectedScanners: ['seizure-prevention'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['2.3.1', '2.3.2'],
    description: 'Flashing content that may trigger seizures'
  },

  'bad-motion-vestibular.html': {
    expectedScanners: ['seizure-prevention', 'input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.3.3', '2.5.4'],
    description: 'Motion-triggered functionality without static alternatives'
  },

  // Advanced Interactions
  'bad-input-modalities.html': {
    expectedScanners: ['input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.5.1', '2.5.2', '2.5.3', '2.5.4'],
    description: 'Pointer gestures without alternatives, missing pointer cancellation'
  },

  'bad-pointer-cancellation.html': {
    expectedScanners: ['input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['2.5.2'],
    description: 'Pointer interactions that cannot be cancelled or undone'
  },

  'bad-concurrent-input.html': {
    expectedScanners: ['input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.5.6'],
    description: 'Restrictions on concurrent input modalities'
  },

  'bad-target-size.html': {
    expectedScanners: ['input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.5.5'],
    description: 'Touch targets smaller than minimum size requirements'
  },

  // Error Handling and Forms
  'bad-form-errors.html': {
    expectedScanners: ['error-handling', 'page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['3.3.1', '3.3.3', '3.3.4'],
    description: 'Poor error identification, suggestions, and prevention'
  },

  'bad-error-prevention.html': {
    expectedScanners: ['error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['3.3.4', '3.3.6'],
    description: 'Missing safeguards for critical actions and data submission'
  },

  // Complex UI Patterns
  'bad-complex-aria.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['4.1.2', '1.3.1'],
    description: 'Incorrect ARIA implementation in complex widgets'
  },

  'bad-aria-state-updates.html': {
    expectedScanners: ['page-structure', 'focus-management'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['4.1.2', '4.1.3'],
    description: 'ARIA states not properly updated during interactions'
  },

  'bad-status-messages.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['4.1.3'],
    description: 'Status messages not announced to screen readers'
  },

  'bad-label-in-name.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.5.3'],
    description: 'Accessible names not matching visible labels for voice control'
  },

  // Hover and Focus Content
  'bad-hover-focus-content.html': {
    expectedScanners: ['focus-management', 'input-modalities'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['1.4.13'],
    description: 'Hover/focus content that cannot be dismissed or persisted'
  },

  // Technical Implementation
  'bad-html-validation.html': {
    expectedScanners: ['html-validation'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['4.1.1'],
    description: 'Invalid HTML markup affecting accessibility APIs'
  },

  'bad-css-background-info.html': {
    expectedScanners: ['page-structure', 'use-of-color'],
    excludedScanners: ['color-contrast', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.1.1', '1.4.1'],
    description: 'Essential information conveyed only through CSS backgrounds'
  },

  'bad-complex-data-tables.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.3.1'],
    description: 'Data tables missing proper header associations'
  },

  // Cognitive Accessibility
  'bad-cognitive-accessibility.html': {
    expectedScanners: ['page-structure', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['1.3.1', '3.3.2'],
    description: 'Complex interfaces without cognitive accessibility support'
  },

  'bad-reading-level.html': {
    expectedScanners: ['language-detection'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['3.1.5'],
    description: 'Content requiring advanced reading level without alternatives'
  },

  // NEW PHASE 6A TEST CASES
  
  // Autocomplete
  'bad-autocomplete.html': {
    expectedScanners: ['page-structure', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.3.5'],
    description: 'Form inputs missing autocomplete attributes for user data'
  },

  // Scrollable Content
  'bad-scrollable-content.html': {
    expectedScanners: ['keyboard-navigation', 'focus-management'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.1.1'],
    description: 'Scrollable content regions not keyboard accessible'
  },

  // Text Spacing
  'bad-text-spacing.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.4.12'],
    description: 'Content breaks when text spacing is increased'
  },

  // Skip Links
  'bad-skip-links.html': {
    expectedScanners: ['keyboard-navigation', 'page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color'],
    testType: 'bad',
    wcagCriteria: ['2.4.1'],
    description: 'Missing or non-functional skip navigation links'
  },

  // Landmarks
  'bad-landmarks.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['1.3.1', '2.4.1'],
    description: 'Missing ARIA landmarks for page structure navigation'
  },

  // Auto-submitting Forms
  'bad-auto-submitting-form.html': {
    expectedScanners: ['predictable-navigation', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['3.2.2'],
    description: 'Forms that auto-submit without user consent causing unexpected context changes'
  },

  // ARIA Role Overrides
  'bad-aria-role-override.html': {
    expectedScanners: ['page-structure'],
    excludedScanners: ['color-contrast', 'use-of-color', 'keyboard-navigation'],
    testType: 'bad',
    wcagCriteria: ['4.1.2'],
    description: 'Improper ARIA role overrides breaking semantic meaning'
  },

  // Real-world Beeproduced Issues Reproduction
  'bad-beeproduced-real-issues.html': {
    expectedScanners: ['page-structure', 'keyboard-navigation', 'focus-management', 'error-handling'],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text'],
    testType: 'bad',
    wcagCriteria: ['1.1.1', '2.1.1', '2.4.1', '4.1.2', '1.3.1', '3.3.2'],
    description: 'Real accessibility issues found on beeproduced.com: empty alt attributes, missing skip links, keyboard navigation problems, ARIA issues, landmark violations'
  },

  // === GOOD EXAMPLES (POSITIVE TEST DATA) ===
  
  'good-accessibility.html': {
    expectedScanners: [],
    excludedScanners: ['color-contrast', 'use-of-color', 'images-of-text', 'keyboard-navigation', 'page-structure'],
    testType: 'good',
    wcagCriteria: ['all'],
    description: 'Comprehensive accessibility best practices - should pass all scanners'
  },

  'good-css-background-accessible.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure', 'use-of-color', 'color-contrast'],
    testType: 'good',
    wcagCriteria: ['1.1.1', '1.4.1'],
    description: 'CSS background information made accessible'
  },

  'good-focus-management.html': {
    expectedScanners: [],
    excludedScanners: ['focus-management', 'keyboard-navigation'],
    testType: 'good',
    wcagCriteria: ['2.4.3', '2.4.7'],
    description: 'Proper focus management implementation'
  },

  'good-seizure-safe.html': {
    expectedScanners: [],
    excludedScanners: ['seizure-prevention'],
    testType: 'good',
    wcagCriteria: ['2.3.1', '2.3.2'],
    description: 'Safe animations with proper controls'
  },

  'good-label-in-name.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['2.5.3'],
    description: 'Voice control compatible interface'
  },

  'good-complex-data-tables.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['1.3.1'],
    description: 'Properly structured complex data tables'
  },

  'good-hover-focus-content.html': {
    expectedScanners: [],
    excludedScanners: ['focus-management', 'input-modalities'],
    testType: 'good',
    wcagCriteria: ['1.4.13'],
    description: 'Properly implemented hover/focus content'
  },

  'good-pointer-cancellation.html': {
    expectedScanners: [],
    excludedScanners: ['input-modalities'],
    testType: 'good',
    wcagCriteria: ['2.5.2'],
    description: 'Proper pointer interaction handling'
  },

  'good-aria-state-updates.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure', 'focus-management'],
    testType: 'good',
    wcagCriteria: ['4.1.2', '4.1.3'],
    description: 'Correct ARIA state management'
  },

  'good-error-prevention.html': {
    expectedScanners: [],
    excludedScanners: ['error-handling'],
    testType: 'good',
    wcagCriteria: ['3.3.4', '3.3.6'],
    description: 'Comprehensive error prevention implementation'
  },

  // NEW GOOD EXAMPLES
  
  'good-autocomplete.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure', 'error-handling'],
    testType: 'good',
    wcagCriteria: ['1.3.5'],
    description: 'Proper autocomplete implementation for user data'
  },

  'good-scrollable-content.html': {
    expectedScanners: [],
    excludedScanners: ['keyboard-navigation', 'focus-management'],
    testType: 'good',
    wcagCriteria: ['2.1.1'],
    description: 'Keyboard accessible scrollable content'
  },

  'good-text-spacing.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['1.4.12'],
    description: 'Content that adapts properly to increased text spacing'
  },

  'good-skip-links.html': {
    expectedScanners: [],
    excludedScanners: ['keyboard-navigation', 'page-structure'],
    testType: 'good',
    wcagCriteria: ['2.4.1'],
    description: 'Functional skip navigation implementation'
  },

  'good-landmarks.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['1.3.1', '2.4.1'],
    description: 'Proper ARIA landmarks implementation'
  },

  'good-cognitive-accessibility.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure', 'error-handling'],
    testType: 'good',
    wcagCriteria: ['1.3.1', '3.3.2'],
    description: 'Cognitive accessibility best practices'
  },

  'good-reading-level.html': {
    expectedScanners: [],
    excludedScanners: ['language-detection'],
    testType: 'good',
    wcagCriteria: ['3.1.5'],
    description: 'Appropriate reading level with alternatives'
  },

  'good-image-alt-complex.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['1.1.1'],
    description: 'Complex images with comprehensive alt text'
  },

  'good-keyboard-native-override.html': {
    expectedScanners: [],
    excludedScanners: ['keyboard-navigation', 'input-modalities'],
    testType: 'good',
    wcagCriteria: ['2.1.1', '2.5.1'],
    description: 'Custom controls preserving native keyboard behavior'
  },

  'good-motion-vestibular.html': {
    expectedScanners: [],
    excludedScanners: ['seizure-prevention', 'input-modalities'],
    testType: 'good',
    wcagCriteria: ['2.3.3', '2.5.4'],
    description: 'Motion features with static alternatives'
  },

  'good-target-size.html': {
    expectedScanners: [],
    excludedScanners: ['input-modalities'],
    testType: 'good',
    wcagCriteria: ['2.5.5'],
    description: 'Adequate touch target sizes'
  },

  'good-text-resize.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['1.4.4'],
    description: 'Content that scales properly with text resize'
  },

  'good-concurrent-input.html': {
    expectedScanners: [],
    excludedScanners: ['input-modalities'],
    testType: 'good',
    wcagCriteria: ['2.5.6'],
    description: 'Support for concurrent input modalities'
  },

  // Auto-submitting Forms (Good)
  'good-auto-submitting-form.html': {
    expectedScanners: [],
    excludedScanners: ['predictable-navigation', 'error-handling'],
    testType: 'good',
    wcagCriteria: ['3.2.2'],
    description: 'Proper auto-submitting form implementation with user consent'
  },

  // ARIA Role Overrides (Good)
  'good-aria-role-override.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['4.1.2'],
    description: 'Correct ARIA role override handling preserving semantics'
  },

  // Reflow (Good)
  'good-reflow.html': {
    expectedScanners: [],
    excludedScanners: ['page-structure'],
    testType: 'good',
    wcagCriteria: ['1.4.10'],
    description: 'Content that properly reflows at 400% zoom without loss of functionality'
  },

  // Language Declarations (Good)
  'good-language.html': {
    expectedScanners: [],
    excludedScanners: ['language-detection'],
    testType: 'good',
    wcagCriteria: ['3.1.1', '3.1.2'],
    description: 'Proper language declarations for page and content sections'
  },

  // Context Changes (Good)
  'good-context-change.html': {
    expectedScanners: [],
    excludedScanners: ['predictable-navigation', 'error-handling'],
    testType: 'good',
    wcagCriteria: ['3.2.1', '3.2.2'],
    description: 'Appropriate context change handling with user control'
  },

  // === "MESSY BUT VALID" PATTERNS (False Positive Prevention) ===

  'good-hidden-modal.html': {
    expectedScanners: [],
    excludedScanners: ['advanced-aria', 'page-structure', 'screen-reader'],
    testType: 'good',
    wcagCriteria: ['4.1.2', '1.3.1'],
    description: 'Hidden modals, off-canvas navs, pre-rendered tooltips with display:none — scanners must skip hidden widgets'
  },

  'good-js-validation.html': {
    expectedScanners: [],
    excludedScanners: ['advanced-aria', 'page-structure', 'error-handling', 'screen-reader'],
    testType: 'good',
    wcagCriteria: ['4.1.2', '3.3.1', '3.3.2'],
    description: 'JS-driven validation: aria-describedby to hidden errors, aria-invalid=false, hidden role=alert — all valid at initial load'
  },

  'good-redundant-aria.html': {
    expectedScanners: [],
    excludedScanners: ['advanced-aria', 'page-structure', 'html-validation'],
    testType: 'good',
    wcagCriteria: ['4.1.2', '1.3.1'],
    description: 'Redundant ARIA roles on semantic HTML5 elements and nav-without-list — valid patterns, not violations'
  },

  'good-bootstrap-patterns.html': {
    expectedScanners: [],
    excludedScanners: ['color-contrast', 'advanced-contrast', 'advanced-aria', 'page-structure'],
    testType: 'good',
    wcagCriteria: ['1.4.3', '1.4.6', '4.1.2'],
    description: 'Bootstrap-like CDN CSS patterns, collapsed components hidden by default — tests computed style contrast'
  }
};

/**
 * Available scanner names (from individual-scanner-api.js)
 */
const AVAILABLE_SCANNERS = [
  'color-contrast',
  'use-of-color', 
  'images-of-text',
  'language-detection',
  'html-validation',
  'keyboard-navigation',
  'input-modalities',
  'timing-controls',
  'seizure-prevention',
  'predictable-navigation',
  'error-handling',
  'eaa-procedure',
  'focus-management',
  'page-structure',
  'accessibility-statement',
  'contact-mechanism',
  'compliance-monitoring'
];

/**
 * Helper Functions
 */

/**
 * Get all test files of a specific type
 */
function getTestFilesByType(type) {
  return Object.keys(HTML_SCANNER_MAPPING).filter(
    fileName => HTML_SCANNER_MAPPING[fileName].testType === type
  );
}

/**
 * Get expected scanners for a test file
 */
function getExpectedScannersForFile(fileName) {
  return HTML_SCANNER_MAPPING[fileName]?.expectedScanners || [];
}

/**
 * Get excluded scanners for a test file
 */
function getExcludedScannersForFile(fileName) {
  return HTML_SCANNER_MAPPING[fileName]?.excludedScanners || [];
}

/**
 * Get files that should trigger a specific scanner
 */
function getFilesForScanner(scannerName) {
  return Object.keys(HTML_SCANNER_MAPPING).filter(fileName => 
    HTML_SCANNER_MAPPING[fileName].expectedScanners.includes(scannerName)
  );
}

/**
 * Get files that should NOT trigger a specific scanner
 */
function getFilesExcludingScanner(scannerName) {
  return Object.keys(HTML_SCANNER_MAPPING).filter(fileName => 
    HTML_SCANNER_MAPPING[fileName].excludedScanners.includes(scannerName)
  );
}

/**
 * Validate mapping configuration
 */
function validateMapping() {
  const issues = [];
  
  Object.entries(HTML_SCANNER_MAPPING).forEach(([fileName, config]) => {
    // Check for unknown scanners
    const unknownExpected = config.expectedScanners.filter(
      scanner => !AVAILABLE_SCANNERS.includes(scanner)
    );
    const unknownExcluded = config.excludedScanners.filter(
      scanner => !AVAILABLE_SCANNERS.includes(scanner)
    );
    
    if (unknownExpected.length > 0) {
      issues.push(`${fileName}: Unknown expected scanners: ${unknownExpected.join(', ')}`);
    }
    
    if (unknownExcluded.length > 0) {
      issues.push(`${fileName}: Unknown excluded scanners: ${unknownExcluded.join(', ')}`);
    }
    
    // Check for overlap between expected and excluded
    const overlap = config.expectedScanners.filter(
      scanner => config.excludedScanners.includes(scanner)
    );
    
    if (overlap.length > 0) {
      issues.push(`${fileName}: Scanner in both expected and excluded: ${overlap.join(', ')}`);
    }
    
    // Check required fields
    if (!config.testType || !['bad', 'good'].includes(config.testType)) {
      issues.push(`${fileName}: Invalid or missing testType`);
    }
    
    if (!config.description) {
      issues.push(`${fileName}: Missing description`);
    }
    
    if (!config.wcagCriteria || config.wcagCriteria.length === 0) {
      issues.push(`${fileName}: Missing WCAG criteria`);
    }
  });
  
  return issues;
}

/**
 * Generate test statistics
 */
function generateMappingStatistics() {
  const badFiles = getTestFilesByType('bad');
  const goodFiles = getTestFilesByType('good');
  
  const scannerUsage = {};
  AVAILABLE_SCANNERS.forEach(scanner => {
    scannerUsage[scanner] = {
      expectedFiles: getFilesForScanner(scanner),
      excludedFiles: getFilesExcludingScanner(scanner),
      totalExpected: getFilesForScanner(scanner).length,
      totalExcluded: getFilesExcludingScanner(scanner).length
    };
  });
  
  return {
    totalFiles: Object.keys(HTML_SCANNER_MAPPING).length,
    badFiles: badFiles.length,
    goodFiles: goodFiles.length,
    availableScanners: AVAILABLE_SCANNERS.length,
    scannerUsage,
    validationIssues: validateMapping()
  };
}

/**
 * Export configuration and helper functions
 */
module.exports = {
  HTML_SCANNER_MAPPING,
  AVAILABLE_SCANNERS,
  getTestFilesByType,
  getExpectedScannersForFile,
  getExcludedScannersForFile,
  getFilesForScanner,
  getFilesExcludingScanner,
  validateMapping,
  generateMappingStatistics
};

// CLI usage
if (require.main === module) {
  console.log('📋 HTML-to-Scanner Mapping Configuration\n');
  
  const stats = generateMappingStatistics();
  
  console.log(`📊 MAPPING STATISTICS:`);
  console.log(`   Total test files: ${stats.totalFiles}`);
  console.log(`   Bad examples: ${stats.badFiles}`);
  console.log(`   Good examples: ${stats.goodFiles}`);
  console.log(`   Available scanners: ${stats.availableScanners}\n`);
  
  console.log(`🔍 SCANNER USAGE:`);
  Object.entries(stats.scannerUsage).forEach(([scanner, usage]) => {
    console.log(`   ${scanner}:`);
    console.log(`     Expected to trigger: ${usage.totalExpected} files`);
    console.log(`     Excluded from: ${usage.totalExcluded} files`);
  });
  
  if (stats.validationIssues.length > 0) {
    console.log(`\n❌ VALIDATION ISSUES:`);
    stats.validationIssues.forEach(issue => {
      console.log(`   ${issue}`);
    });
  } else {
    console.log(`\n✅ Mapping configuration is valid`);
  }
  
  console.log(`\n📝 USAGE:`);
  console.log(`   const { HTML_SCANNER_MAPPING, getExpectedScannersForFile } = require('./html-scanner-mapping');`);
  console.log(`   const scanners = getExpectedScannersForFile('bad-color-contrast.html');`);
}