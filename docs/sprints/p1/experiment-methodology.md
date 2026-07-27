# Haiku + a11y-code Skill Experiment — Methodology

## Goal

Measure how well Claude Haiku generates accessible websites when guided by the `a11y-code` skill, and identify both skill gaps and scanner false positive patterns.

## Experiment Matrix

**45 pages total** = 5 technologies × 3 page types × 3 CSS variants

### Technologies (5)
| Tech | Method |
|------|--------|
| Pure HTML | No framework |
| React 18 | CDN via unpkg (react + react-dom + babel standalone) |
| Vue 3 | CDN via unpkg |
| Svelte | Compiled output — vanilla JS with reactive patterns |
| Angular | Compiled output — vanilla JS with Angular-like patterns |

### Page Types (3)
1. **Form** — Contact form with inputs, dropdowns, validation, error states
2. **Dashboard** — Stat cards, sortable data table, pagination, detail modal
3. **Landing** — Navigation, hero, feature cards, sign-up modal, testimonials, footer

### CSS Variants (3)
1. **Vanilla CSS** — Custom styles in `<style>` tag
2. **Tailwind CSS** — CDN via `cdn.tailwindcss.com`
3. **Bootstrap 5** — CDN via `cdn.jsdelivr.net`

## Execution Pipeline

### Phase 1: Generate (parallel)

45 Haiku subagents launched in parallel via Claude Code Agent tool (`model: "haiku"`).

Each agent:
1. Reads the a11y-code skill files:
   - `.claude/skills/a11y-code/SKILL.md`
   - `.claude/skills/a11y-code/references/common-patterns.md`
   - Framework-specific reference (react.md / vue.md) where applicable
2. Generates a single self-contained HTML file
3. Writes it to `experiments/haiku-a11y/generated/{tech}-{css}/{page}.html`

**Output:** 45 HTML files, 15-35KB each, all self-contained with inline CSS/JS.

### Phase 2: Scan (sequential)

Script: `experiments/haiku-a11y/scan-experiment.js`

1. Validates all 45 HTML files (doctype, closing tag, minimum size)
2. Starts HTTP server serving `generated/` directory
3. Initializes `ScanPipeline` with all scanners (`registerAllScanners()`)
4. Scans each file with **full profile** (40+ scanners including LLM scanners)
5. Filters out EAA scanner violations (expected failures for standalone pages)
6. Recomputes scores without EAA scanners
7. Writes `results/experiment-report.json` + `results/experiment-summary.md`

**Runtime:** ~3 minutes per file, ~2.5 hours total for 45 files.

### Phase 3: Analyze (parallel, iterative)

As scans complete, Haiku analysis agents are launched in parallel to manually audit each generated file.

Each analysis agent:
1. Reads the full generated HTML file
2. Checks against a specific accessibility checklist:
   - Document: lang, heading hierarchy, landmarks, skip link, viewport
   - Forms: labels, aria-required/invalid/describedby, autocomplete, error handling
   - Tables: caption, th scope, aria-sort placement
   - Modals: role="dialog", aria-modal, focus trap, Escape, hidden state, focus return
   - Color: contrast ratios (computed from hex values), color-only info
   - Keyboard: focus styles, tab order, interactive element semantics
   - Motion: prefers-reduced-motion
3. Classifies each finding as TRUE POSITIVE or FALSE POSITIVE
4. Returns concise numbered list focusing on true positives

**Key principle:** Analysis agents run iteratively — as each batch of 2-3 scans completes, new analysis agents are immediately launched. This overlaps scan time with analysis time.

### Phase 4: Aggregate

True positives are collected across all files and grouped by:
- **Pattern** (contrast, ARIA misuse, modal focus, etc.)
- **Frequency** (% of files affected)
- **Technology** (React vs Vue vs HTML vs Svelte vs Angular)
- **CSS variant** (Tailwind vs Bootstrap vs Vanilla)
- **Page type** (Form vs Dashboard vs Landing)

False positives are documented in `scanner-false-positives.md` with specific scanner names, root causes, and fix priorities.

## Key Metrics

### Per File
- Scanner violation count (raw)
- True positive count (manual audit)
- False positive rate
- Accessibility score (scanner-computed, EAA-excluded)

### Aggregate
- Mean/median score by technology, CSS, page type
- Most common true positive patterns (skill gaps)
- Most common false positive patterns (scanner bugs)
- Best/worst performing combinations

## File Structure

```
experiments/haiku-a11y/
  generated/                          # 45 HTML files
    {tech}-{css}/
      form.html
      dashboard.html
      landing.html
  scan-experiment.js                  # Scan orchestrator
  generate-detailed-report.js         # Post-scan detailed report
  results/
    experiment-report.json            # Raw scan data
    experiment-summary.md             # Aggregated summary
    detailed-violations.md            # Per-file violation breakdown

docs/sprints/p1/
  experiment-methodology.md           # This file
  scanner-false-positives.md          # FP categories + scanner fix priorities
```

## Results Summary (30/45 files)

### By Technology
| Tech | Avg Score | Avg Violations | Files |
|------|-----------|---------------|-------|
| React | 54.1% | 469 | 9 |
| HTML | 50.4% | 702 | 9 |
| Svelte | 50.0% | 619 | 2 |
| Angular | 47.9% | 801 | 9 |

### By CSS Framework
| CSS | Avg Score | Avg Violations |
|-----|-----------|---------------|
| Tailwind | 52.7% | 598 |
| Vanilla | 50.1% | 682 |
| Bootstrap | 49.7% | 679 |

### By Page Type
| Page | Avg Score | Avg Violations |
|------|-----------|---------------|
| Dashboard | 53.6% | 773 |
| Form | 50.7% | 408 |
| Landing | 47.7% | 797 |

### Top Performers
- react-tailwind/dashboard: **69% / 136 violations**
- react-tailwind/landing: **67% / 57 violations**

### Scanner Reality Check
- Mean scanner violations per file: ~650
- Mean true positives per file: ~4
- **False positive rate: ~99.4%**

## Skill Gaps Identified (ordered by frequency)

| # | Pattern | Frequency | Severity |
|---|---------|-----------|----------|
| 1 | Color contrast near threshold (3.7-4.5:1) | ~60% | Medium |
| 2 | Modal focus trap incomplete | ~50% | Medium |
| 3 | Identical button labels in repeated contexts | ~40% | Medium |
| 4 | Color-only status indicators | ~25% | Medium |
| 5 | `aria-sort` on button not `<th>` | ~25% | Medium |
| 6 | Pagination `<a href="#">` instead of `<button>` | ~30% | Low |
| 7 | Duplicate skip links (React CDN) | ~20% | Low |
| 8 | `alert()` for form feedback | ~15% | Medium |
| 9 | Heading hierarchy skips | ~15% | Low |
