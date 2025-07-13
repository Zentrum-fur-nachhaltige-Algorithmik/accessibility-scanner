# Iterative Scanner Debugging Plan

## Overview
Systematic approach to fix all scanner issues in validated phases. Each phase includes implementation, testing, and validation before proceeding.

---

## Phase A: Infrastructure Fixes (CRITICAL)
**Goal**: Fix API infrastructure issues that prevent testing

### A.1: Method Name Mismatches
- **Issue**: API calling wrong scanner methods
- **Fix**: Update individual-scanner-api.js method calls
- **Priority**: CRITICAL - blocks testing

#### Tasks:
1. Fix keyboard-navigation: `scanKeyboardNavigation` → `scanKeyboardAccess`
2. Restart API server to apply changes
3. Verify all 17 scanner endpoints respond without method errors

#### Validation Test:
```bash
# Test all scanners respond without API errors
curl -X GET http://localhost:3002/api/scanners
# Should return 17 scanners without errors
```

#### Success Criteria:
- ✅ All 17 scanner endpoints return responses (not method errors)
- ✅ API health check shows all scanners available
- ✅ Ready to proceed to Phase B

---

## Phase B: High-Impact False Negatives (HIGH PRIORITY)
**Goal**: Fix scanners missing critical violations

### B.1: page-structure Scanner
- **Issue**: Only detecting 2/13+ image alt violations
- **Impact**: Major accessibility issues undetected
- **Priority**: HIGH

#### Tasks:
1. Analyze page-structure scanner logic for image alt checking
2. Add/fix image alt attribute validation
3. Ensure detection of: missing alt, empty alt, generic alt, keyword stuffing

#### Validation Test:
```bash
# Should find 10+ violations in bad-image-alt.html
curl -X POST http://localhost:3002/api/scan/page-structure \
  -d '{"url":"http://localhost:8081/bad-image-alt.html"}'
```

#### Success Criteria:
- ✅ Detects 10+ violations in bad-image-alt.html
- ✅ Still passes good-accessibility.html (no new false positives)
- ✅ Specifically identifies image alt text issues

### B.2: use-of-color Scanner  
- **Issue**: Missing violations in bad-use-of-color.html
- **Impact**: Color-only information issues undetected
- **Priority**: HIGH

#### Tasks:
1. Review bad-use-of-color.html content to understand expected violations
2. Fix scanner logic to detect color-only information patterns
3. Test against form errors, links, status indicators

#### Validation Test:
```bash
# Should find violations in bad-use-of-color.html
curl -X POST http://localhost:3002/api/scan/use-of-color \
  -d '{"url":"http://localhost:8081/bad-use-of-color.html"}'
```

#### Success Criteria:
- ✅ Detects violations in bad-use-of-color.html
- ✅ Still passes good-accessibility.html
- ✅ Correctly identifies color-dependency patterns

### B.3: images-of-text Scanner
- **Issue**: Missing text-in-images violations
- **Impact**: Text accessibility requirements undetected
- **Priority**: HIGH

#### Tasks:
1. Review bad-images-of-text.html content
2. Fix scanner logic to detect text content in images
3. Implement OCR or heuristic-based text detection

#### Validation Test:
```bash
# Should find violations in bad-images-of-text.html
curl -X POST http://localhost:3002/api/scan/images-of-text \
  -d '{"url":"http://localhost:8081/bad-images-of-text.html"}'
```

#### Success Criteria:
- ✅ Detects text-in-images violations
- ✅ Passes good examples
- ✅ Provides actionable violation details

---

## Phase C: False Positive Fixes (MEDIUM PRIORITY)
**Goal**: Reduce incorrect violation flagging in good examples

### C.1: color-contrast Scanner Sensitivity
- **Issue**: 8 false positives in good-accessibility.html
- **Impact**: Accessible designs flagged as non-compliant
- **Priority**: MEDIUM

#### Tasks:
1. Analyze flagged elements: ratios 3.13-4.45 vs required 4.5
2. Adjust thresholds or add exceptions for borderline cases
3. Review WCAG 2.1 AA requirements for edge cases

#### Validation Test:
```bash
# Should find 0-2 violations in good-accessibility.html
curl -X POST http://localhost:3002/api/scan/color-contrast \
  -d '{"url":"http://localhost:8081/good-accessibility.html"}'
```

#### Success Criteria:
- ✅ ≤2 violations in good-accessibility.html (down from 8)
- ✅ Still detects all 22 violations in bad-color-contrast.html
- ✅ Maintains compliance detection accuracy

---

## Phase D: Remaining Scanner Debugging (SYSTEMATIC)
**Goal**: Test and fix remaining 11 untested scanners

### D.1: Test Remaining Scanners (Batch)
- **Scanners**: html-validation, input-modalities, timing-controls, seizure-prevention, etc.
- **Priority**: MEDIUM

#### Tasks:
1. Test each scanner against its expected bad/good examples
2. Document false positives and false negatives
3. Categorize issues by impact and complexity

#### Validation Process:
```bash
# For each scanner:
curl -X POST http://localhost:3002/api/scan/{scanner} \
  -d '{"url":"http://localhost:8081/bad-{pattern}.html"}'
curl -X POST http://localhost:3002/api/scan/{scanner} \
  -d '{"url":"http://localhost:8081/good-accessibility.html"}'
```

#### Success Criteria:
- ✅ All 17 scanners tested
- ✅ Issues documented in SCANNER_DEBUGGING_REPORT.md
- ✅ Priority fixes identified

### D.2: Fix High-Impact Issues (Iterative)
- Fix scanners with critical false negatives first
- Then fix major false positive issues
- Test each fix before proceeding

---

## Phase E: Integration Testing (VALIDATION)
**Goal**: Ensure fixed scanners work together without cross-contamination

### E.1: Targeted Integration Tests
#### Tasks:
1. Run targeted-test-runner.js on all expected combinations
2. Check for new cross-contamination issues
3. Validate overall accuracy improvement

#### Validation Test:
```bash
node test-sites/targeted-test-runner.js expected
```

#### Success Criteria:
- ✅ >90% accuracy on expected combinations
- ✅ <10% false positive rate
- ✅ <5% false negative rate

### E.2: Comprehensive Validation
#### Tasks:
1. Run full matrix test on critical scanners
2. Validate isolated element tests still work
3. Performance regression testing

#### Validation Test:
```bash
node test-sites/matrix-test-runner.js
```

#### Success Criteria:
- ✅ No major performance degradation
- ✅ Isolated test cases still reproduce issues
- ✅ Ready for production use

---

## Progress Tracking

### Phase Status
- [ ] **Phase A**: Infrastructure Fixes
  - [ ] A.1: Method name fixes
- [ ] **Phase B**: False Negative Fixes  
  - [ ] B.1: page-structure scanner
  - [ ] B.2: use-of-color scanner
  - [ ] B.3: images-of-text scanner
- [ ] **Phase C**: False Positive Fixes
  - [ ] C.1: color-contrast sensitivity
- [ ] **Phase D**: Remaining Scanners
  - [ ] D.1: Test remaining 11 scanners
  - [ ] D.2: Fix high-impact issues
- [ ] **Phase E**: Integration Testing
  - [ ] E.1: Targeted integration tests
  - [ ] E.2: Comprehensive validation

### Success Metrics
- **Target**: 90% overall scanner accuracy
- **False Positive Rate**: <10%
- **False Negative Rate**: <5%
- **API Reliability**: 100% endpoints functional

---

## Next Action
🚀 **START WITH PHASE A.1**: Fix method name mismatches and restart API server

```bash
# Quick start command:
vim src/individual-scanner-api.js  # Fix remaining method names
pkill -f individual-scanner-api    # Stop current API
INDIVIDUAL_SCANNER_PORT=3002 node src/individual-scanner-api.js  # Restart
```