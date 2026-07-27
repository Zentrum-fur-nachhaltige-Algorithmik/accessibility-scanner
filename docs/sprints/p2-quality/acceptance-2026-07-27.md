# Sprint P2 acceptance battery — before / after

Raw outputs in `raw/`. Baseline figures are from `baseline-2026-07-27.md`.

## Scoreboard

| Measurement | Baseline | After | Notes |
|---|---|---|---|
| vitest suite | 177 passed / 3 failed (183 tests) | **196 passed / 3 failed (199 tests)** | corpus grew by 17 fixtures; all 3 failures are `self-scan` (real frontend findings, see below) |
| Deterministic **exclusive** harness | 47/48 | **50/50** | Gap-2 fixture fixed, `concurrent-input` added, reflow timeout raised |
| Deterministic **concurrent** harness | _did not exist_ | **96/140** | new; 18 previously unharnessed scanners |
| Real-world harness | _did not exist_ | **32/32 scanners, 0 errors on all 5 fixtures** | new; the no-crash invariant |
| axe-vs-ours: crashes | 3 files `/ ERR` | **0** | |
| axe-vs-ours: bad-file detection | 8/10 | **10/10** | |
| axe-vs-ours: good-file noise | 218 (avg 21.8) | **45 (avg 4.5)** | axe: 15. Target was ≤30; not met — see below |
| axe-vs-ours: noise ratio | — | **0.12** (axe 0.44) | good-file violations ÷ bad-file violations |
| LLM smoke | 28/28 (28 tests) | **52/52 equivalent** (52 tests) | corpus nearly doubled; violation-level ground truth |
| Coverage matrix | _did not exist_ | **87/87 criteria mapped**, generator green | |

## The good-file noise target

The acceptance bar was "ours ≤ 2× axe" on the good-file corpus, i.e. ≤ 30. The
final figure is 45 — down from 218, but still 3× axe. The residual, per the
recorded breakdown:

| scanner | count | assessment |
|---|---:|---|
| `color-contrast` | 8 | mostly TRUE positives — real near-miss contrast in fixtures |
| `nontext-contrast` | 10 | `insufficient-interactive-state-contrast` (4) is a known over-broad check, documented in the scanner |
| `advanced-contrast` | 3 | overlaps `color-contrast`; consolidation candidate |
| `error-handling` | 5 | narrowed twice this sprint; remainder needs per-check review |
| `predictable-navigation` | 5 | new `inconsistent-*-identification` checks, unreviewed |
| `timing-controls` | 3 | `timeout-no-extend-option` fires without evidence of a real timeout |
| everything else | 11 | ≤1 per scanner |

Two caveats on the metric itself. First, a raw count comparison against axe is
not like-for-like: our scanners deliberately cover criteria axe does not test at
all (1.3.5, 2.2.1, 1.4.1 charts, 2.5.x), so some of the delta is coverage, not
noise. Second, several remaining findings are genuine defects in fixtures
labelled "good" — `good-language-override.html`'s placeholder-only search input
is flagged by six independent scanners and is a real WCAG failure that axe
misses because accname accepts `placeholder` as a name.

**Left open**: closing the contrast cluster (21 of the 45) is the single change
that would meet the bar.

## Trust tiers

Derived from the results above by `tests/derive-scanner-trust.js` →
`src/scanner-trust.json`: **34 proven, 12 experimental**. Experimental scanners
are quarantined out of the default profiles, still registered and runnable with
`includeExperimental: true`, and their findings are tagged `confidence: 'low'`.
Five criteria are consequently reported as `experimental-only` in the coverage
matrix and are NOT counted as covered.

## Known-failing, deliberately

- `tests/integration/self-scan.test.js` — the frontend has real findings
  (24×24 target size on radio inputs, EAA contact/feedback mechanisms absent).
  Scanner-side, the one false positive it exposed (`<next-route-announcer>`
  reported as an unreachable clickable) is fixed.
- Real-world spot-truths (6): a link/heading whose accessible name comes from a
  child `<img alt>` is reported as empty (2 scanners), and valid three-letter
  ISO 639-3 language subtags are reported as invalid (27 instances across two
  fixtures). Both are confirmed false positives with a precise reproduction;
  neither was in this sprint's fix scope.
- `own-audit-ui.html` takes 1865s in the full-ensemble real-world run — a
  performance finding, not a hang (the same page is 90s when the quarantined
  scanners are excluded).
