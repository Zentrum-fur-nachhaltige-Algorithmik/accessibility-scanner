# Takeover: Verifiably complete WCAG 2.2 / EN 301 549 coverage

You are taking over the accessibility-scanner quality sprint. Work in
`/home/xyz/accessability` on branch `feat/scanner-quality`. Read
`docs/sprints/p2-quality/baseline-2026-07-27.md` and (if present)
`docs/sprints/p2-quality/noise-analysis.md` before writing any code.

## Mission

Make the scanner suite's coverage of WCAG 2.2 **verifiably complete**: at the
end, "which criteria do we detect, how, and how well?" must be answerable from
a checked-in matrix backed by passing tests — not from memory or vibes. The
production use case is auditing German-language medical practice websites
(med-websites themes) against WCAG 2.2 AA + EAA/EN 301 549.

## Definition of complete (all five, no exceptions)

1. **Coverage matrix** at `docs/sprints/p2-quality/coverage-matrix.md`, generated
   by a script (`tests/coverage-matrix.js`), mapping EVERY WCAG 2.2 success
   criterion (all of A, AA, AAA) to exactly one primary mechanism:
   `axe-core` | `deterministic:<scanner-id>` | `llm:<scanner-id>` |
   `hybrid:<ids>` | `MANUAL` | `NOT-APPLICABLE-STATIC`. Every `MANUAL` /
   `NOT-APPLICABLE-STATIC` entry needs a one-line justification (e.g. 1.2.4
   Captions Live — requires a live stream). An unmapped criterion is a build
   failure of the matrix script.
2. **Every automatable A+AA criterion** has: a scanner, a good+bad test-file
   pair in `test-sites/` with `WCAG-TEST` metadata, and an entry in the
   harnesses (`test-sites/test-exclusive-scanners.js` or
   `test-sites/test-llm-scanners.js`).
3. **Known gaps closed** (test files already exist for the first three):
   - 3.3.7 Redundant Entry (AA) — new LLM scanner, single-page heuristic
     (multi-step forms re-asking known data)
   - 3.2.6 Consistent Help (A) — new LLM scanner with multi-page comparison
     (reuse the EAA scanners' sub-page navigation pattern)
   - 2.5.6 Concurrent Input Mechanisms — new DETERMINISTIC scanner
     (touchstart-only handlers, suppressed keyboard events, pointer-events
     blocking); no LLM needed
   - 1.1.1 alt-text QUALITY — new LLM scanner (img + alt + surrounding context
     → is the alt meaningful?); axe only checks existence
   - axe-`incomplete` LLM reviewer per the design in
     `docs/issues/llm-incomplete-result-reviewer.md` — highest leverage for
     real-page precision, build this FIRST
4. **Harness upgrades — single-run only** (explicit user decision: no
   repetition/majority-voting frameworks):
   - Violation-level ground truth: bad files' expected criteria (from their
     WCAG-TEST metadata) must actually be among the found violations — ">0
     violations of any kind" no longer counts as detection
   - One German-language good+bad pair per LLM scanner (production content is
     German; today's corpus is nearly all English)
   - Exactly one prompt-injection robustness file (page content containing
     "ignore previous instructions…" — scanners feed page HTML into prompts)
     and one long-page file exceeding the extraction cutoff
5. **Acceptance battery green**: full vitest; deterministic harness 48/48
   (fix the Gap-2 test file `bad-keyboard-native-override.html` by adding real
   gesture elements, per `docs/sprints/p1/scanner-detection-gaps.md`);
   `tests/spike/axe-vs-ours-comparison.js` with zero `/ ERR` files, 10/10
   bad-file detection, good-file noise ≤ 2× axe-core; LLM smoke green
   including the new scanners; one end-to-end scan of a med-websites theme
   (static export served locally) whose report a human would judge as
   dominated by true positives.

## Method

- **Phase 0 — reconcile**: several background agents worked on this tree.
  Check what landed: `git status`, the frontend rebuild (`frontend/`),
  `docs/sprints/p2-quality/noise-analysis.md`, prompt rewrites in
  `src/llm-behavioral-scanner.js` / `src/llm-visual-presentation-scanner.js`.
  The pristine pre-sprint state for diffing is the Windows copy at
  `/mnt/c/Users/T14/Desktop/accessability` (read-only reference).
- **Phase 1 — matrix**: build the generator from `wcag2.2.md` (criterion list)
  × `src/scanner-registry.js` (scanner→criteria) × `test-sites/` metadata.
  Truth over optimism: a criterion a scanner *mentions* but has no passing
  harness entry for is NOT covered.
- **Phase 2 — close gaps** in the order listed in §3. Scanner implementation
  can be delegated to agents (Sonnet: mechanical/well-specified, Opus: hard
  debugging), but LLM PROMPTS are authored by the strongest available model
  (session main model), reviewed against the style of
  `src/llm-sensory-characteristics-scanner.js` (evidence-only rules, explicit
  do-NOT-flag examples, "err on the side of NOT flagging", cite-your-evidence
  requirement).
- **Phase 3 — measure**: run the full acceptance battery; iterate until green.
- **Phase 4 — persist**: `git add` the ENTIRE project on this branch — the
  upstream repo tracks only 104 files; most of the project (test corpus,
  frontend, half of src/) was never committed. NEVER add `.env` (contains the
  OpenRouter key), `node_modules/`, `reports/`, `test-results/`,
  `frontend/.next/`, `.cache/`. Then push the branch and open an MR. NEVER
  push or merge to main directly.

## Constraints

- OpenRouter key is in `.env`; LLM scanners and smoke tests cost real money
  (cents per run) — that is authorized, but don't loop them needlessly.
- LLM client is pinned to `google/gemini-3.5-flash` with `max_tokens` set —
  keep unless measurements say otherwise.
- Single-run tests only (see §4). No new AAA scanners — AAA coverage is
  already above par; completeness pressure is on A/AA.
- Sprint P0 fixes (crash guards, dialog auto-dismiss, SVG className guards,
  authored-width detection, SSRF/auth/XSS server hardening) are reviewed and
  accepted — do not refactor them; build on top.

## Report

Finish with: the coverage matrix summary (counts per mechanism, remaining
MANUAL entries + justifications), the acceptance battery scoreboard
(before/after), cost spent, and anything deliberately left open.
