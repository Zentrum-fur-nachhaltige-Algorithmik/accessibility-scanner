# Testing Accessibility with the Scanner Suite

This project includes a comprehensive accessibility testing framework with 29+ scanners covering WCAG 2.2 at all conformance levels (A, AA, AAA). This document explains how to validate your code against it.

## Scanner Architecture

The test suite has two types of scanners:

### DOM/Rule-Based Scanners (instant, deterministic)
These parse HTML/CSS and check structural rules. They run fast and produce no false positives when calibrated. Key scanners:

| Scanner | Criteria Covered |
|---------|-----------------|
| `page-structure-scanner` | 1.3.1, 2.4.1, 2.4.2, 2.4.6, 2.4.10 |
| `keyboard-navigation-scanner` | 2.1.1, 2.1.2, 2.1.4, 2.4.3, 2.4.7 |
| `color-contrast-scanner` | 1.4.3, 1.4.6, 1.4.11 |
| `focus-management-scanner` | 2.4.7, 2.4.11, 2.4.3 |
| `error-handling-scanner` | 3.3.1, 3.3.2, 3.3.3, 3.3.4 |
| `language-detection-scanner` | 3.1.1, 3.1.2 |
| `media-accessibility-scanner` | 1.2.1–1.2.5 |
| `input-modalities-scanner` | 2.5.1–2.5.4, 2.5.7, 2.5.8 |
| `responsive-design-scanner` | 1.4.4, 1.4.10, 1.4.12 |
| `predictable-navigation-scanner` | 3.2.1–3.2.4, 3.2.6 |
| `images-of-text-scanner` | 1.4.5, 1.4.9 |
| `timing-controls-scanner` | 2.2.1, 2.2.2 |
| `seizure-prevention-scanner` | 2.3.1, 2.3.2 |
| `use-of-color-scanner` | 1.4.1 |
| `screen-reader-scanner` | 4.1.2, 4.1.3, 1.3.1 |

### LLM-Based Scanners (semantic, contextual)
These send HTML to an LLM for analysis of criteria that can't be checked with rules alone. They cover primarily AAA criteria:

| Scanner | Criteria Covered |
|---------|-----------------|
| `llm-auth-scanner` | 3.3.8, 3.3.9 |
| `llm-behavioral-scanner` | 2.2.3–2.2.6, 3.2.5, 3.3.5 |
| `llm-focus-appearance-scanner` | 2.4.12, 2.4.13 |
| `llm-media-alternatives-scanner` | 1.2.6–1.2.9 |
| `llm-semantic-text-scanner` | 3.1.3, 3.1.4, 3.1.6, 2.4.9, 2.4.10, 1.3.6 |
| `llm-visual-presentation-scanner` | 1.4.7, 1.4.8, 1.4.9 |

## Test HTML Structure

Test files are in the `test-html/` directory, named with convention:
- `good-*.html` — passes specific criteria
- `bad-*.html` — violates specific criteria

Each file has WCAG metadata in comments:
```html
<!-- wcag-criterion: 3.3.8 -->
<!-- wcag-level: AA -->
<!-- expected: pass -->
```

## Running Tests

### Full scan against a page
```bash
# Start the dev server
npm run dev

# Run all scanners against a URL
node src/scan-pipeline.js --url http://localhost:3000/page

# Run specific scanner
node src/scan-pipeline.js --url http://localhost:3000/page --scanner keyboard-navigation-scanner
```

### LLM scanner smoke tests
```bash
# Requires OPENROUTER_API_KEY in .env
node src/test-llm-scanners.js
```

This runs each LLM scanner against its paired good/bad test files and reports:
- **Detection rate** on bad files (target: >80%)
- **False positive rate** on good files (target: <20%)

### Quick validation of generated code
Save your generated HTML to `test-html/`, then:

```bash
# Scan a single file
node src/scan-pipeline.js --file test-html/my-component.html

# Or serve and scan
npx serve test-html -p 8080 &
node src/scan-pipeline.js --url http://localhost:8080/my-component.html
```

## Interpreting Results

Scanner output follows this format:
```json
{
  "scannerId": "keyboard-navigation-scanner",
  "passed": false,
  "violations": [
    {
      "ruleId": "2.1.1",
      "impact": "critical",
      "description": "Interactive element is not keyboard accessible",
      "nodes": [{ "selector": "div.btn-submit" }]
    }
  ],
  "summary": { "totalIssues": 1 }
}
```

### Impact Levels
- **critical**: Blocks users entirely (e.g., keyboard trap, no alt text on critical image)
- **serious**: Major barrier (e.g., insufficient contrast, missing form labels)
- **moderate**: Significant but workable (e.g., missing lang attribute on foreign text)
- **minor**: Best practice (e.g., missing abbreviation expansion)

### Most Common Violations (from real scans)

These are the violations that appear most frequently when code is generated without accessibility in mind:

1. **Missing form labels** (3.3.2, 1.3.1) — Every `<input>` needs a `<label>`
2. **Low contrast** (1.4.3) — Gray text on white, placeholder text
3. **Missing alt text** (1.1.1) — Images without `alt` attribute
4. **Non-keyboard-accessible controls** (2.1.1) — `<div onclick>` without keyboard handling
5. **Missing page language** (3.1.1) — No `lang` on `<html>`
6. **Missing skip link** (2.4.1) — No way to bypass navigation
7. **Heading hierarchy** (1.3.1) — Skipping h2, going from h1 to h3
8. **Missing focus indicators** (2.4.7) — `outline: none` with no replacement
9. **Color-only information** (1.4.1) — Errors shown only in red, links without underline
10. **Missing ARIA on custom widgets** (4.1.2) — Custom dropdowns, toggles without roles

## Creating Test Files for New Components

When building a new component, create both a good and bad version:

```bash
test-html/
├── good-my-component.html   # Accessible version
├── bad-my-component.html    # Version with deliberate violations
```

Bad file should include specific, documented violations:
```html
<!-- wcag-criterion: 2.1.1, 1.3.1, 3.3.2 -->
<!-- wcag-level: A -->
<!-- expected: fail -->
<!-- violations: no keyboard access, missing labels, no error messages -->
```

Good file should pass all targeted criteria:
```html
<!-- wcag-criterion: 2.1.1, 1.3.1, 3.3.2 -->
<!-- wcag-level: A -->
<!-- expected: pass -->
```

## Integration with CI/CD

```yaml
# Example GitHub Actions step
- name: Accessibility Scan
  run: |
    node src/scan-pipeline.js --url ${{ env.PREVIEW_URL }} --format json > a11y-report.json
    node -e "
      const r = require('./a11y-report.json');
      const critical = r.violations.filter(v => v.impact === 'critical');
      if (critical.length > 0) {
        console.error('Critical accessibility violations found:');
        critical.forEach(v => console.error('  -', v.ruleId, v.description));
        process.exit(1);
      }
    "
```
