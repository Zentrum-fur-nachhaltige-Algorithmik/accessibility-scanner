# Feature Request: CSP Independence for Accessibility Scanner

## Summary
Reduce CSP dependency from 73% to <10% while maintaining accuracy by enhancing existing CSP-immune scanners through a phased implementation plan.

## Problem
- **73% of axe rules** (76/104) fail on CSP-protected sites (gov.uk, banks, social media)
- **Current fallback coverage: 27%** (28/104 rules)
- **Production sites increasingly CSP-protected**

## Current State Analysis
```
✅ CSP-Immune (27%):     ScreenReader, ColorContrast, HTMLValidation, 
                         Keyboard, Language scanners
❌ CSP-Dependent (73%):  button-name, link-name, frame-title, meta-*, 
                         aria-*, skip-link + 70 more axe rules
```

---

# 🎯 PHASED IMPLEMENTATION PLAN

## Phase 1: HTMLValidationScanner Enhancement (4 weeks)
**Target: +40 rules coverage (27% → 65%)**

### Implementation
```javascript
HTMLValidationScanner.addRules([
  'button-name',           // DOM text content analysis
  'link-name',             // Anchor text + aria-label checking
  'frame-title',           // iframe title attribute validation
  'aria-prohibited-attr',  // Role-based ARIA validation
  'aria-allowed-attr',     // ARIA attribute validation
  'aria-required-attr',    // Required ARIA attributes
  'meta-viewport',         // Viewport meta validation
  'meta-refresh',          // Auto-refresh detection
  'duplicate-id-*',        // ID uniqueness validation
  'valid-lang'             // Language code validation
  // + 30 more ARIA/HTML rules
]);
```

### Validation Requirements
- [ ] **Accuracy Test**: 100% match with axe results on 20 CSP-free test sites
- [ ] **CSP Test**: Works on gov.uk, twitter.com, 5+ CSP-protected sites
- [ ] **Performance**: <2s additional overhead per scan
- [ ] **Regression**: No existing functionality broken
- [ ] **Coverage**: Achieve 65%+ rule coverage without CSP dependency

### Success Criteria
```
✅ Pass: 65%+ coverage achieved
✅ Pass: <5% accuracy deviation vs axe
✅ Pass: Works on all CSP-protected test sites
✅ Pass: Performance within tolerance
❌ Fail: Any existing tests break
```

---

## Phase 2: KeyboardNavigationScanner Enhancement (3 weeks)
**Target: +15 rules coverage (65% → 80%)**

### Implementation
```javascript
KeyboardNavigationScanner.addRules([
  'skip-link',             // Programmatic skip link detection
  'focusable-element',     // Tab order validation
  'focus-order-semantics', // Logical focus sequence
  'accesskeys',            // Accesskey uniqueness
  'tabindex',              // Tabindex validation
  'keyboard-navigation',   // Full keyboard access
  // + 9 more focus/keyboard rules
]);
```

### Validation Requirements
- [ ] **Integration Test**: Phase 1 + Phase 2 combined functionality
- [ ] **Interaction Test**: Real keyboard navigation simulation
- [ ] **Cross-browser**: Chrome, Firefox, Safari compatibility
- [ ] **Accessibility Tools**: Screen reader compatibility validation
- [ ] **Performance**: Total overhead <3s per comprehensive scan

### Success Criteria
```
✅ Pass: 80%+ total coverage achieved
✅ Pass: Real keyboard navigation works
✅ Pass: Screen reader tools validate results
✅ Pass: Cross-browser compatibility
❌ Fail: Keyboard simulation accuracy <95%
```

---

## Phase 3: MediaAccessibilityScanner Creation (2 weeks)
**Target: +10 rules coverage (80% → 90%)**

### Implementation
```javascript
new MediaAccessibilityScanner([
  'area-alt',              // Image map alternative text
  'object-alt',            // Object/embed accessibility
  'input-image-alt',       // Image input alternative text
  'svg-img-alt',           // SVG accessibility
  'audio-caption',         // Audio content captions
  'video-description',     // Video descriptions
  // + 4 more media rules
]);
```

### Validation Requirements
- [ ] **Media Test**: Test with real media content (images, videos, audio)
- [ ] **Alt-text Accuracy**: Compare with manual inspection on 50+ media elements
- [ ] **Format Support**: JPG, PNG, SVG, MP4, audio format coverage
- [ ] **Integration**: Seamless integration with existing scanner pipeline
- [ ] **Edge Cases**: Handle missing media, broken links, complex image maps

### Success Criteria
```
✅ Pass: 90%+ total coverage achieved
✅ Pass: Media alt-text accuracy >95%
✅ Pass: Supports all major media formats
✅ Pass: Handles edge cases gracefully
❌ Fail: Media detection accuracy <90%
```

---

## Phase 4: Integration & Optimization (2 weeks)
**Target: Final integration, performance optimization, documentation**

### Implementation
```javascript
// Unified CSP-immune scanner
ResilientAccessibilityScanner.optimize([
  'parallel-execution',    // Run scanners in parallel
  'smart-caching',         // Cache DOM analysis results
  'selective-testing',     // Skip redundant tests
  'result-aggregation',    // Intelligent result combination
  'performance-monitoring' // Real-time performance tracking
]);
```

### Validation Requirements
- [ ] **End-to-End Test**: Full pipeline test on 20+ diverse websites
- [ ] **Performance Benchmark**: <5s total scan time for complex sites
- [ ] **Accuracy Validation**: Side-by-side comparison with axe+bypass
- [ ] **Documentation**: Complete API docs and usage examples
- [ ] **Production Readiness**: Error handling, logging, monitoring

### Success Criteria
```
✅ Pass: 90%+ coverage without CSP dependency
✅ Pass: Performance target achieved (<5s)
✅ Pass: Accuracy within 5% of axe results
✅ Pass: Production-ready stability
✅ Pass: Complete documentation
```

---

# 📊 OVERALL SUCCESS METRICS

## Coverage Progression
```
Phase 0 (Current):  27% CSP-immune coverage
Phase 1 Target:     65% CSP-immune coverage  (+38%)
Phase 2 Target:     80% CSP-immune coverage  (+15%)
Phase 3 Target:     90% CSP-immune coverage  (+10%)
Phase 4 Target:     90%+ optimized coverage
```

## Final Validation Gates
- [ ] **CSP Independence**: <10% dependency on axe injection
- [ ] **Accuracy Maintenance**: <5% deviation from axe results
- [ ] **Production Sites**: Gov.uk, banks, social media fully scannable
- [ ] **Performance**: Total scan time <5s for complex sites
- [ ] **Regression**: Zero existing functionality broken
- [ ] **Documentation**: Complete migration guide provided

## Risk Mitigation
- **Phase gates**: Each phase must pass validation before next phase
- **Rollback plan**: Can revert to previous phase if validation fails
- **Parallel development**: Maintain existing axe-based scanners during transition
- **Gradual migration**: Allow users to opt-in to CSP-immune scanning

## Timeline
```
Week 1-4:   Phase 1 (HTMLValidationScanner)
Week 5-7:   Phase 2 (KeyboardNavigationScanner)  
Week 8-9:   Phase 3 (MediaAccessibilityScanner)
Week 10-11: Phase 4 (Integration & Optimization)
```

**Total Duration: 11 weeks to CSP independence**