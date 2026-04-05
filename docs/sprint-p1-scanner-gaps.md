# Sprint P1: Scanner-Lücken schließen

Status: IN PROGRESS | Stand: 2026-04-05

## Deterministische Scanner (DOM/CSS-basiert)

| # | Criterion | Name | Status | Notes |
|---|-----------|------|--------|-------|
| D1 | 1.3.4 | Orientation | DONE | `orientation-scanner.js` — CSS/JS/inline lock detection |
| D2 | 1.3.5 | Identify Input Purpose | DONE | `input-purpose-scanner.js` — autocomplete attr validation |
| D3 | 1.4.12 | Text Spacing | DONE | Extended `responsive-design-scanner.js` — heuristic + interactive |
| D4 | 1.4.13 | Content on Hover/Focus | DONE | `hover-focus-content-scanner.js` — heuristic + interactive |
| D5 | 2.4.11 | Focus Not Obscured (Min) | DONE | Extended `focus-management-scanner.js` — fixed/sticky overlap check |
| D6 | 2.5.7 | Dragging Movements | DONE | Extended `input-modalities-scanner.js` — drag alternative detection |
| D7 | 2.5.8 | Target Size (Minimum) | DONE | Extended `input-modalities-scanner.js` — 24x24px check |
| D8 | 3.3.7 | Redundant Entry | DEFERRED | Too complex for deterministic automation — needs LLM/manual |

## LLM Scanner (semantische Analyse nötig)

| # | Criterion | Name | Status | Notes |
|---|-----------|------|--------|-------|
| L1 | 1.3.3 | Sensory Characteristics | DONE | LLM scanner: `llm-sensory-characteristics-scanner.js` |
| L2 | 2.4.5 | Multiple Ways | DONE | Deterministisch: `multiple-ways-scanner.js` (DOM-Analyse) |
| L3 | 3.1.5 | Reading Level | DONE | LLM scanner: `llm-reading-level-scanner.js` (multilingual) |

## Hybrid / Unklar

| # | Criterion | Name | Status | Notes |
|---|-----------|------|--------|-------|
| H1 | 1.1.1 | Non-text Content | TODO | Alt-text Existenz = deterministisch, Qualität = LLM? |
| H2 | 1.2.4 | Captions (Live) | TODO | Nur testbar mit echtem Live-Stream |
| H3 | 1.3.2 | Meaningful Sequence | TODO | DOM vs visual order — Layout-Analyse |
| H4 | 2.1.3 | Keyboard (No Exception) | TODO | Vollständige Keyboard-Coverage schwer automatisch |
| H5 | 2.3.3 | Animation from Interactions | TODO | `prefers-reduced-motion` check + JS-Analyse |
| H6 | 2.4.4 | Link Purpose (In Context) | TODO | Teils durch 2.4.9 (AAA/LLM) abgedeckt |
| H7 | 2.4.8 | Location | TODO | Breadcrumbs / "Where am I" |
| H8 | 3.2.6 | Consistent Help | TODO | Hilfe konsistent platziert — multi-page check |
| H9 | 3.3.6 | Error Prevention (All) | TODO | Reversible/checkable/confirmable für alle submissions |

## Test-Coverage

Alle Kriterien haben bereits good + bad HTML test files in `test-sites/`.
