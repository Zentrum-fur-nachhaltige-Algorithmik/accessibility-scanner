# Accessibility Scanner Testing Guide

## 🚀 Correct Way to Run Tests

### ✅ Working Test Runner
```bash
# Run the main accessibility test suite
node test-sites/test-runner.js
```

### 📊 What This Tests
- **Phase 1**: Color contrast, use of color, images of text (✅ WORKING)
- **Phase 2-3**: New advanced scanners (⚠️ PARTIAL - needs scanner implementation)

### 🔧 Test Architecture
- **Test Files**: `test-sites/*.html` (good/bad examples)
- **Test Runner**: `test-sites/test-runner.js` (main validation script)
- **Scanner Config**: Test expectations defined in `TEST_SITES` and `EXPECTED_RESULTS`

### ❌ Do NOT Use These Files
- ~~`test-sites/test-improved-scanners.js`~~ (DELETED - was broken)
- ~~`src/comprehensive-test.js`~~ (has Puppeteer API bugs)

### 📈 Coverage Status
- **Original 3 scanners**: 100% working with test cases
- **New 9 scanners**: HTML test cases implemented, scanner integration pending

### 🎯 Next Steps for 100% Coverage
1. Implement the 9 missing scanners to match test expectations
2. Or adapt test expectations to existing scanner capabilities
3. Verify all 15 test cases pass validation

## 🧪 Test Case Files
### BAD Examples (should FAIL)
- `bad-seizure-risk.html` - Safety critical flashing content
- `bad-label-in-name.html` - Voice control incompatible
- `bad-status-messages.html` - Silent screen reader updates  
- `bad-nontext-contrast.html` - UI component contrast <3:1
- `bad-timing-controls.html` - Auto-play without controls
- `bad-form-errors.html` - Poor error handling
- `bad-complex-aria.html` - Broken ARIA widgets
- `bad-input-modalities.html` - Gesture-only interactions
- `bad-html-validation.html` - Invalid HTML structure

### GOOD Examples (should PASS)
- `good-seizure-safe.html` - Safe animations with controls
- `good-label-in-name.html` - Voice control compatible