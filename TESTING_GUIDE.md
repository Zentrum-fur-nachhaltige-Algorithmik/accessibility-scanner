# Accessibility Scanner Testing Guide

## Quick Start

```bash
# 1. Start Individual Scanner API
INDIVIDUAL_SCANNER_PORT=3002 node src/individual-scanner-api.js

# 2. Run targeted tests
node test-sites/targeted-test-runner.js expected

# 3. Isolate problematic elements
node element-isolator.js
```

## Architecture Overview

```
test-sites/
├── html-scanner-mapping.js     # Defines which scanners should trigger on which HTML files
├── targeted-test-runner.js     # Tests scanner×file combinations based on mapping
├── matrix-test-runner.js       # Full matrix testing (all combinations)
└── test-runner.js             # Mock infrastructure validation

src/
├── individual-scanner-api.js   # REST API for isolated scanner testing
└── *-scanner.js               # Individual scanner implementations

isolated-elements/
├── false-positives/           # Elements incorrectly flagged
└── false-negatives/           # Elements incorrectly passed
```

## Testing Workflow

### 1. Test Individual Scanner
```bash
# Direct API test
curl -X POST http://localhost:3002/api/scan/color-contrast \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:8080/test-sites/bad-color-contrast.html"}'

# List all scanners
curl http://localhost:3002/api/scanners
```

### 2. Debug False Positives/Negatives

**False Positive**: Scanner detects violations where none exist
```bash
# Example: color-contrast on good-accessibility.html
# Check: isolated-elements/false-positives/
```

**False Negative**: Scanner misses actual violations
```bash
# Example: page-structure on bad-image-alt.html  
# Check: isolated-elements/false-negatives/
```

### 3. Key Files

- **html-scanner-mapping.js**: Edit expected/excluded scanners per HTML file
- **test-sites/*.html**: 46 bad + 23 good test cases
- **reports/**: JSON test results with classifications

## Common Issues & Fixes

1. **Scanner Method Mismatch**
   - Check scanner class method name matches API call
   - Example: `scanKeyboardAccess` vs `scanKeyboardNavigation`

2. **Scanner Too Broad**
   - Creates false positives
   - Fix: Add exclusion rules, refine selectors

3. **Scanner Too Narrow**
   - Creates false negatives
   - Fix: Expand detection patterns

## Debugging Commands

```bash
# Test specific scanner×file combination
node test-sites/targeted-test-runner.js expected | grep "color-contrast"

# Generate element isolation for debugging
node element-isolator.js

# Run comprehensive matrix test (slow)
node test-sites/matrix-test-runner.js

# Check scanner implementation
grep -n "async scan" src/color-contrast-scanner.js
```

## Performance

- Expected combinations: ~65 tests
- Excluded combinations: ~150 tests  
- Full matrix: 1,173 tests (17 scanners × 69 files)

## Next Steps

1. Fix method name mismatches in individual-scanner-api.js
2. Debug high-priority scanners first (color-contrast, page-structure)
3. Use isolated element tests to fix specific issues
4. Validate fixes don't break working tests