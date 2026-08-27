# WCAG 2.2 Coverage Matrix

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node tests/coverage-matrix.js
     Validate in CI with: node tests/coverage-matrix.js --check -->

Generated: 2026-08-22T13:21:36.802Z

Every WCAG 2.2 success criterion (A, AA and AAA) is mapped to exactly one **primary mechanism**. A criterion that a scanner merely *mentions* in its metadata, but that no harness asserts on, is reported as unverified — the generator fails the build rather than let the matrix drift from the code.

## Summary

| Mechanism | Criteria | A | AA | AAA | Removed |
|---|---:|---:|---:|---:|---:|
| `axe-core` | 12 | 10 | 1 | 1 | 0 |
| `hybrid` | 16 | 6 | 6 | 4 | 0 |
| `deterministic` | 24 | 10 | 11 | 3 | 0 |
| `llm` | 24 | 3 | 1 | 20 | 0 |
| `experimental-only` | 5 | 1 | 4 | 0 | 0 |
| `MANUAL` | 5 | 1 | 1 | 3 | 0 |
| `NOT-APPLICABLE-STATIC` | 1 | 0 | 0 | 0 | 1 |
| **total** | **87** | 31 | 24 | 31 | 1 |

**A + AA (the conformance target): 48 of 55 criteria are covered by proven mechanisms**, 2 require manual review, and 5 are covered only by quarantined (experimental) scanners and therefore do not count as covered.

## Matrix

`H` = harnesses asserting on the criterion: `x`=exclusive, `c`=concurrent, `l`=llm, `a`=axe-e2e, `g`=golden corpus (false-positive guard on healthy real pages).

`Detect` is the LAST RECORDED outcome from the harnesses whose results are checked in
at `docs/sprints/p2-quality/raw/harness-*.json` — an actual measurement, not merely the
existence of a test. `TP` = at least one bad fixture was detected; **`tp`** = bad
fixture(s) exist but none was detected; `FP-` = every good fixture stayed clean;
**`FP!`** = at least one good fixture produced a false positive; `—` = no recorded run.

**Scope caveat:** these recorded runs cover the CUSTOM scanners only. axe-core is not
part of them — its rules are exercised separately by `tests/scanners/axe-core-e2e.test.js`
over every fixture. So a **`tp`** on a criterion whose primary mechanism is `axe-core` or
`hybrid:axe-core+…` means "our custom scanner adds nothing here", not "the criterion is
undetected".

| SC | Lvl | Title | Primary mechanism | Supporting | Fixtures (bad/good) | H | Detect |
|---|---|---|---|---|---|---|---|
| 1.1.1 | A | Nicht-Text-Inhalt | `hybrid:axe-core+llm-alt-quality` | — | 5/3 | al | — |
| 1.2.1 | A | Reines Audio und reines Video (aufgezeichnet) | `hybrid:axe-core+media-accessibility` | — | 1/1 | ac | TP FP- |
| 1.2.2 | A | Untertitel (aufgezeichnet) | `hybrid:axe-core+media-accessibility` | — | 1/1 | ac | TP FP- |
| 1.2.3 | A | Audiodeskription oder Medienalternative (aufgezeichnet) | `deterministic:media-accessibility` | — | 1/1 | c | TP FP- |
| 1.2.4 | AA | Untertitel (Live) | `MANUAL` | — | 1/1 | — | — |
| 1.2.5 | AA | Audiodeskription (aufgezeichnet) | `deterministic:media-accessibility` | — | 1/1 | c | TP FP- |
| 1.2.6 | AAA | Gebärdensprache (aufgezeichnet) | `llm:llm-media-alternatives` | — | 2/2 | l | — |
| 1.2.7 | AAA | Erweiterte Audiodeskription (aufgezeichnet) | `llm:llm-media-alternatives` | — | 1/1 | l | — |
| 1.2.8 | AAA | Medienalternative (aufgezeichnet) | `llm:llm-media-alternatives` | — | 2/2 | l | — |
| 1.2.9 | AAA | Reines Audio (Live) | `llm:llm-media-alternatives` | — | 1/1 | l | — |
| 1.3.1 | A | Info und Beziehungen | `axe-core` | `screen-reader (experimental)`, `page-structure (experimental)`, `advanced-aria (experimental)` | 7/7 | ac | TP **FP!** |
| 1.3.2 | A | Bedeutungstragende Reihenfolge | `MANUAL` | — | 1/1 | — | — |
| 1.3.3 | A | Sensorische Eigenschaften | `llm:llm-sensory-characteristics` | — | 4/2 | l | — |
| 1.3.4 | AA | Ausrichtung | `hybrid:axe-core+orientation` | — | 1/1 | ac | TP FP- |
| 1.3.5 | AA | Eingabezweck bestimmen | `hybrid:axe-core+input-purpose` | — | 1/1 | ac | TP FP- |
| 1.3.6 | AAA | Zweck identifizieren | `llm:llm-semantic-text` | — | 1/1 | l | — |
| 1.4.1 | A | Benutzung von Farbe | `axe-core` | `use-of-color (experimental)` | 2/1 | ac | TP **FP!** |
| 1.4.2 | A | Audio-Steuerung | `axe-core` | — | 1/1 | a | — |
| 1.4.3 | AA | Kontrast (Minimum) | `hybrid:axe-core+color-contrast` | — | 2/2 | ac | TP FP- |
| 1.4.4 | AA | Textgröße ändern | `hybrid:axe-core+text-resize` | `responsive-design` | 1/1 | axg | TP FP- |
| 1.4.5 | AA | Bilder eines Textes | `experimental:images-of-text` | — | 1/1 | c | **tp** FP- |
| 1.4.6 | AAA | Kontrast (Erweitert) | `hybrid:axe-core+color-contrast` | — | 1/2 | ac | TP FP- |
| 1.4.7 | AAA | Leiser oder kein Hintergrund-Audio | `llm:llm-visual-presentation` | — | 1/1 | l | — |
| 1.4.8 | AAA | Visuelle Präsentation | `llm:llm-visual-presentation` | — | 2/2 | l | — |
| 1.4.9 | AAA | Bilder eines Textes (keine Ausnahme) | `llm:llm-visual-presentation` | `images-of-text (experimental)` | 2/1 | cl | TP FP- |
| 1.4.10 | AA | Umbruch (Reflow) | `deterministic:responsive-design` | `mobile-specific` | 1/1 | xg | TP FP- |
| 1.4.11 | AA | Nicht-Text-Kontrast | `deterministic:nontext-contrast` | `advanced-contrast (experimental)` | 1/1 | cxg | TP FP- |
| 1.4.12 | AA | Textabstand | `hybrid:axe-core+responsive-design` | — | 1/1 | axg | TP FP- |
| 1.4.13 | AA | Eingeblendete Inhalte | `deterministic:hover-focus-content` | `advanced-contrast (experimental)` | 1/1 | cxg | TP FP- |
| 2.1.1 | A | Tastatur | `hybrid:axe-core+keyboard-navigation` | — | 4/3 | ax | TP FP- |
| 2.1.2 | A | Keine Tastaturfalle | `deterministic:keyboard-navigation` | — | 2/1 | xg | TP FP- |
| 2.1.3 | AAA | Tastatur (keine Ausnahme) | `axe-core` | — | 1/1 | a | — |
| 2.1.4 | A | Zeichentastenkürzel | `deterministic:keyboard-navigation` | — | 1/1 | x | TP FP- |
| 2.2.1 | A | Zeitbegrenzung anpassbar | `axe-core` | `timing-controls (experimental)` | 1/1 | ac | TP **FP!** |
| 2.2.2 | A | Pausieren, Beenden, Ausblenden | `axe-core` | `timing-controls (experimental)` | 1/1 | ac | TP **FP!** |
| 2.2.3 | AAA | Keine Zeitbegrenzung | `llm:llm-behavioral` | — | 2/2 | l | — |
| 2.2.4 | AAA | Unterbrechungen | `hybrid:axe-core+llm-behavioral` | — | 1/1 | al | — |
| 2.2.5 | AAA | Erneute Authentisierung | `llm:llm-behavioral` | — | 1/1 | l | — |
| 2.2.6 | AAA | Timeouts | `llm:llm-behavioral` | — | 1/1 | l | — |
| 2.3.1 | A | Drei Blitze oder unterhalb Schwellenwert | `deterministic:seizure-prevention` | — | 1/1 | x | TP FP- |
| 2.3.2 | AAA | Drei Blitze | `deterministic:seizure-prevention` | — | 1/1 | — | — |
| 2.3.3 | AAA | Animation durch Interaktion | `deterministic:seizure-prevention` | — | 1/1 | — | — |
| 2.4.1 | A | Blöcke umgehen | `axe-core` | `page-structure (experimental)` | 3/2 | ac | **tp** FP- |
| 2.4.2 | A | Seite betitelt | `axe-core` | `page-structure (experimental)` | 1/1 | ac | TP FP- |
| 2.4.3 | A | Fokusreihenfolge | `deterministic:focus-management` | — | 2/1 | x | TP FP- |
| 2.4.4 | A | Linkzweck (im Kontext) | `axe-core` | — | 1/1 | a | — |
| 2.4.5 | AA | Verschiedene Methoden | `deterministic:multiple-ways` | — | 1/1 | x | TP FP- |
| 2.4.6 | AA | Überschriften und Beschriftungen | `experimental:page-structure` | — | 1/1 | c | TP FP- |
| 2.4.7 | AA | Fokus sichtbar | `deterministic:focus-management` | — | 2/1 | xg | TP FP- |
| 2.4.8 | AAA | Position | `MANUAL` | — | 1/1 | — | — |
| 2.4.9 | AAA | Linkzweck (nur Link) | `hybrid:axe-core+llm-semantic-text` | — | 3/3 | al | — |
| 2.4.10 | AAA | Abschnittsüberschriften | `llm:llm-semantic-text` | — | 1/1 | l | — |
| 2.4.11 | AA | Fokus nicht verdeckt (Minimum) | `deterministic:focus-management` | — | 1/1 | xg | TP FP- |
| 2.4.12 | AAA | Fokus nicht verdeckt (Erweitert) | `llm:llm-focus-appearance` | — | 1/1 | l | — |
| 2.4.13 | AAA | Fokusdarstellung | `llm:llm-focus-appearance` | — | 2/2 | l | — |
| 2.5.1 | A | Zeigergesten | `deterministic:input-modalities` | — | 2/1 | x | TP FP- |
| 2.5.2 | A | Zeigereingabe abbrechen | `deterministic:input-modalities` | — | 2/1 | x | TP FP- |
| 2.5.3 | A | Beschriftung im zugänglichen Namen | `hybrid:axe-core+input-modalities` | `label-in-name (experimental)` | 2/1 | acxg | TP **FP!** |
| 2.5.4 | A | Betätigung durch Bewegung | `deterministic:input-modalities` | — | 2/1 | x | TP FP- |
| 2.5.5 | AAA | Zielgröße (Erweitert) | `MANUAL` | — | 1/1 | — | — |
| 2.5.6 | AAA | Gleichzeitige Eingabemechanismen | `deterministic:concurrent-input` | — | 1/1 | x | TP FP- |
| 2.5.7 | AA | Ziehbewegungen | `deterministic:input-modalities` | — | 1/1 | x | TP FP- |
| 2.5.8 | AA | Zielgröße (Minimum) | `hybrid:axe-core+input-modalities` | — | 1/1 | axg | TP FP- |
| 3.1.1 | A | Sprache der Seite | `axe-core` | `language-detection (experimental)` | 1/2 | ac | TP FP- |
| 3.1.2 | AA | Sprache von Teilen | `axe-core` | `language-detection (experimental)` | 2/2 | ac | TP FP- |
| 3.1.3 | AAA | Ungebräuchliche Wörter | `llm:llm-semantic-text` | — | 2/2 | l | — |
| 3.1.4 | AAA | Abkürzungen | `llm:llm-semantic-text` | — | 2/2 | l | — |
| 3.1.5 | AAA | Leseniveau | `llm:llm-reading-level` | — | 1/1 | l | — |
| 3.1.6 | AAA | Aussprache | `llm:llm-semantic-text` | — | 1/1 | l | — |
| 3.2.1 | A | Bei Fokus | `deterministic:predictable-navigation` | — | 1/1 | c | TP FP- |
| 3.2.2 | A | Bei Eingabe | `deterministic:predictable-navigation` | — | 2/2 | c | TP FP- |
| 3.2.3 | AA | Konsistente Navigation | `deterministic:predictable-navigation` | — | 1/1 | c | TP FP- |
| 3.2.4 | AA | Konsistente Erkennung | `deterministic:predictable-navigation` | — | 1/1 | c | TP FP- |
| 3.2.5 | AAA | Änderung auf Anfrage | `hybrid:axe-core+llm-behavioral` | — | 2/2 | al | — |
| 3.2.6 | A | Konsistente Hilfe | `llm:llm-consistent-help` | — | 1/1 | l | — |
| 3.3.1 | A | Fehlererkennung | `experimental:error-handling+status-messages` | — | 1/2 | c | TP FP- |
| 3.3.2 | A | Beschriftungen oder Anweisungen | `axe-core` | `error-handling (experimental)` | 4/3 | ac | TP **FP!** |
| 3.3.3 | AA | Fehlerempfehlung | `experimental:error-handling` | — | 1/1 | c | TP FP- |
| 3.3.4 | AA | Fehlervermeidung (rechtlich, finanziell, Daten) | `experimental:error-handling` | — | 2/1 | c | TP FP- |
| 3.3.5 | AAA | Hilfe | `llm:llm-behavioral` | — | 2/2 | l | — |
| 3.3.6 | AAA | Fehlervermeidung (alle) | `MANUAL` | — | 1/1 | — | — |
| 3.3.7 | A | Redundante Eingabe | `llm:llm-redundant-entry` | — | 1/1 | l | — |
| 3.3.8 | AA | Barrierefreie Authentifizierung (Minimum) | `llm:llm-auth` | — | 2/2 | l | — |
| 3.3.9 | AAA | Barrierefreie Authentifizierung (Erweitert) | `llm:llm-auth` | — | 1/1 | l | — |
| 4.1.1 | REMOVED | Parsen | `NOT-APPLICABLE-STATIC` | — | 1/0 | c | TP |
| 4.1.2 | A | Name, Rolle, Wert | `hybrid:axe-core+dynamic-spa` | `screen-reader (experimental)`, `html-validation (experimental)`, `advanced-aria (experimental)` | 5/7 | ac | TP **FP!** |
| 4.1.3 | AA | Statusmeldungen | `deterministic:dynamic-spa` | `screen-reader (experimental)`, `status-messages (experimental)` | 2/1 | c | TP FP- |

### Recorded detection gaps

50 criteria have recorded runs (harnesses: concurrent, exclusive). 2 have a bad fixture that the custom scanners do not detect; 7 produce a false positive on a good fixture.

**Not detected by the custom scanners** (axe-core may still cover them — check the
Primary mechanism column):

- 1.4.5 (AA) — primary `experimental:images-of-text`
- 2.4.1 (A) — primary `axe-core`

**False positives on good fixtures:**

- 1.3.1 (A) — primary `axe-core`
- 1.4.1 (A) — primary `axe-core`
- 2.2.1 (A) — primary `axe-core`
- 2.2.2 (A) — primary `axe-core`
- 2.5.3 (A) — primary `hybrid:axe-core+input-modalities`
- 3.3.2 (A) — primary `axe-core`
- 4.1.2 (A) — primary `hybrid:axe-core+dynamic-spa`

## MANUAL / NOT-APPLICABLE-STATIC / experimental-only justifications

| SC | Lvl | Mechanism | Justification |
|---|---|---|---|
| 1.2.4 | AA | `MANUAL` | Captions (Live) — requires an actually-running live stream; a static page exposes no signal about whether a future broadcast will be captioned. |
| 1.3.2 | A | `MANUAL` | Meaningful Sequence — "correct" reading order is defined by authorial meaning; DOM-vs-visual order mismatches are routinely intentional, so any static heuristic is a noise generator. axe-core likewise ships no 1.3.2 rule. |
| 1.4.5 | AA | `experimental:images-of-text` | Only experimental scanners cover this criterion — images-of-text: concurrent harness: FAIL — missed bad-images-of-text.html (1.4.5,1.4.9) |
| 2.4.6 | AA | `experimental:page-structure` | Only experimental scanners cover this criterion — page-structure: concurrent harness: FAIL — missed bad-beeproduced-real-issues.html (2.4.1,1.3.1) | concurrent harness: FAIL — missed bad-cognitive-accessibility.html (1.3.1) | concurrent harness: FAIL — missed bad-complex-aria.html (1.3.1) | concurrent harness: FAIL — missed bad-complex-data-tables.html (1.3.1) | concurrent harness: FAIL — missed bad-form-grouping.html (1.3.1) | concurrent harness: FAIL — missed bad-form-labels.html (1.3.1) | (+2 more) |
| 2.4.8 | AAA | `MANUAL` | Location (AAA) — whether a user can determine their position requires the surrounding set of pages and its information architecture, not one page. |
| 2.5.5 | AAA | `MANUAL` | Target Size (Enhanced) (AAA) — the 44x44 check was removed from mobile-specific because it was reported as an AA failure on every healthy page (false-positive-reports/2026-08-09, FP-1). The AA minimum (2.5.8, 24x24 with the spacing exception) is automated in input-modalities; the AAA size is a design review item. |
| 3.3.1 | A | `experimental:error-handling+status-messages` | Only experimental scanners cover this criterion — error-handling: concurrent harness: FAIL — false positive on good-cognitive-accessibility.html (3.3.2) ;; status-messages: concurrent harness: FAIL — missed bad-form-errors.html (3.3.1) | concurrent harness: FAIL — missed bad-status-messages.html (4.1.3) |
| 3.3.3 | AA | `experimental:error-handling` | Only experimental scanners cover this criterion — error-handling: concurrent harness: FAIL — false positive on good-cognitive-accessibility.html (3.3.2) |
| 3.3.4 | AA | `experimental:error-handling` | Only experimental scanners cover this criterion — error-handling: concurrent harness: FAIL — false positive on good-cognitive-accessibility.html (3.3.2) |
| 3.3.6 | AAA | `MANUAL` | Error Prevention (All) (AAA) — reversibility/checkability/confirmation of a submission is server-side behaviour that is not observable from the page. |
| 4.1.1 | REMOVED | `NOT-APPLICABLE-STATIC` | Parsing — removed from WCAG 2.2 (obsolete); retained in the list only so the numbering stays complete. Not a conformance requirement any more. |

## axe-core rule coverage

| SC | axe-core rules |
|---|---|
| 1.1.1 | `aria-meter-name`, `aria-progressbar-name`, `image-alt`, `input-image-alt`, `object-alt`, `role-img-alt`, `svg-img-alt` |
| 1.2.1 | `audio-caption` |
| 1.2.2 | `video-caption` |
| 1.3.1 | `aria-hidden-body`, `aria-required-children`, `aria-required-parent`, `definition-list`, `dlitem`, `list`, `listitem`, `p-as-heading`, `table-fake-caption`, `td-has-header`, `td-headers-attr`, `th-has-data-cells` |
| 1.3.4 | `css-orientation-lock` |
| 1.3.5 | `autocomplete-valid` |
| 1.4.1 | `link-in-text-block` |
| 1.4.2 | `no-autoplay-audio` |
| 1.4.3 | `color-contrast` |
| 1.4.4 | `meta-viewport` |
| 1.4.6 | `color-contrast-enhanced` |
| 1.4.12 | `avoid-inline-spacing` |
| 2.1.1 | `frame-focusable-content`, `scrollable-region-focusable`, `server-side-image-map` |
| 2.1.3 | `scrollable-region-focusable` |
| 2.2.1 | `meta-refresh` |
| 2.2.2 | `blink`, `marquee` |
| 2.2.4 | `meta-refresh-no-exceptions` |
| 2.4.1 | `bypass` |
| 2.4.2 | `document-title` |
| 2.4.4 | `area-alt`, `link-name` |
| 2.4.9 | `identical-links-same-purpose` |
| 2.5.3 | `label-content-name-mismatch` |
| 2.5.8 | `target-size` |
| 3.1.1 | `html-has-lang`, `html-lang-valid`, `html-xml-lang-mismatch` |
| 3.1.2 | `valid-lang` |
| 3.2.5 | `meta-refresh-no-exceptions` |
| 3.3.2 | `form-field-multiple-labels` |
| 4.1.2 | `area-alt`, `aria-allowed-attr`, `aria-braille-equivalent`, `aria-command-name`, `aria-conditional-attr`, `aria-deprecated-role`, `aria-hidden-body`, `aria-hidden-focus`, `aria-input-field-name`, `aria-prohibited-attr`, `aria-required-attr`, `aria-roledescription`, `aria-roles`, `aria-toggle-field-name`, `aria-tooltip-name`, `aria-valid-attr-value`, `aria-valid-attr`, `button-name`, `duplicate-id-aria`, `frame-title-unique`, `frame-title`, `input-button-name`, `input-image-alt`, `label`, `link-name`, `nested-interactive`, `select-name`, `summary-name` |

## Scanner inventory

46 registered scanners; 172 fixtures with `WCAG-TEST` metadata.

Trust tiers (derived from the recorded battery results by `tests/derive-scanner-trust.js`): **34 proven**, **12 experimental**. Only proven scanners are in the default profiles; experimental ones are quarantined (never deleted), runnable with `includeExperimental: true`, and their findings are tagged `confidence: "low"`.

| Scanner | Kind | Exclusive | Trust | Declared criteria | Quarantine evidence |
|---|---|---|---|---|---|
| `axe-core` | axe | no | proven | _dynamic / non-WCAG_ | — |
| `color-contrast` | deterministic | no | proven | 1.4.3, 1.4.6 | — |
| `use-of-color` | deterministic | no | **experimental** | 1.4.1 | concurrent harness: FAIL — missed bad-use-of-color.html (1.4.1) / concurrent harness: FAIL — false positive on good-css-background-accessible.html (1.4.1) |
| `images-of-text` | deterministic | no | **experimental** | 1.4.5, 1.4.9 | concurrent harness: FAIL — missed bad-images-of-text.html (1.4.5,1.4.9) |
| `advanced-contrast` | deterministic | no | **experimental** | 1.4.11, 1.4.13 | concurrent harness: FAIL — missed bad-color-contrast.html (1.4.3,1.4.6) / concurrent harness: FAIL — missed bad-focus-visible.html (1.4.3) |
| `nontext-contrast` | deterministic | yes | proven | 1.4.11 | — |
| `text-resize` | deterministic | yes | proven | 1.4.4 | — |
| `screen-reader` | deterministic | no | **experimental** | 1.3.1, 4.1.2, 4.1.3 | concurrent harness: FAIL — missed bad-aria-state-updates.html (4.1.2,4.1.3) / concurrent harness: FAIL — missed bad-beeproduced-real-issues.html (4.1.2,1.3.1) / concurrent harness: FAIL — missed bad-cognitive-accessibili |
| `media-accessibility` | deterministic | no | proven | 1.2.1, 1.2.2, 1.2.3, 1.2.5 | — |
| `orientation` | deterministic | no | proven | 1.3.4 | — |
| `input-purpose` | deterministic | no | proven | 1.3.5 | — |
| `language-detection` | deterministic | no | **experimental** | 3.1.1, 3.1.2 | concurrent harness: FAIL — missed bad-language-override.html (3.1.2) |
| `predictable-navigation` | deterministic | no | proven | 3.2.1, 3.2.2, 3.2.3, 3.2.4 | — |
| `error-handling` | deterministic | no | **experimental** | 3.3.1, 3.3.2, 3.3.3, 3.3.4 | concurrent harness: FAIL — false positive on good-cognitive-accessibility.html (3.3.2) |
| `html-validation` | deterministic | no | **experimental** | 4.1.1, 4.1.2 | concurrent harness: FAIL — missed bad-aria-state-updates.html (4.1.2) / concurrent harness: FAIL — missed bad-complex-aria.html (4.1.2) / concurrent harness: FAIL — false positive on good-aria-role-override.html (4.1.2)  |
| `page-structure` | deterministic | no | **experimental** | 1.3.1, 2.4.1, 2.4.2, 2.4.6 | concurrent harness: FAIL — missed bad-beeproduced-real-issues.html (2.4.1,1.3.1) / concurrent harness: FAIL — missed bad-cognitive-accessibility.html (1.3.1) / concurrent harness: FAIL — missed bad-complex-aria.html (1.3 |
| `label-in-name` | deterministic | no | **experimental** | 2.5.3 | concurrent harness: FAIL — missed bad-input-modalities.html (2.5.3) / concurrent harness: FAIL — false positive on good-label-in-name.html (2.5.3) |
| `status-messages` | deterministic | yes | **experimental** | 4.1.3, 3.3.1 | concurrent harness: FAIL — missed bad-form-errors.html (3.3.1) / concurrent harness: FAIL — missed bad-status-messages.html (4.1.3) |
| `advanced-aria` | deterministic | no | **experimental** | 4.1.2, 1.3.1 | concurrent harness: FAIL — missed bad-aria-state-updates.html (4.1.2) / concurrent harness: FAIL — missed bad-cognitive-accessibility.html (1.3.1) / concurrent harness: FAIL — missed bad-complex-data-tables.html (1.3.1)  |
| `seizure-prevention` | deterministic | no | proven | 2.3.1, 2.3.2, 2.3.3 | — |
| `timing-controls` | deterministic | no | **experimental** | 2.2.1, 2.2.2 | concurrent harness: FAIL — false positive on good-timing-controls.html (2.2.1,2.2.2) |
| `multiple-ways` | deterministic | no | proven | 2.4.5 | — |
| `keyboard-navigation` | deterministic | yes | proven | 2.1.1, 2.1.2, 2.1.4 | — |
| `focus-management` | deterministic | yes | proven | 2.4.3, 2.4.7, 2.4.11 | — |
| `input-modalities` | deterministic | yes | proven | 2.5.1, 2.5.2, 2.5.3, 2.5.4, 2.5.7, 2.5.8 | — |
| `responsive-design` | deterministic | yes | proven | 1.4.4, 1.4.10, 1.4.12 | — |
| `mobile-specific` | deterministic | yes | proven | 1.4.10 | — |
| `hover-focus-content` | deterministic | yes | proven | 1.4.13 | — |
| `concurrent-input` | deterministic | yes | proven | 2.5.6 | — |
| `dynamic-spa` | deterministic | yes | proven | 4.1.2, 4.1.3 | — |
| `accessibility-statement` | deterministic | yes | proven | _dynamic / non-WCAG_ | — |
| `contact-mechanism` | deterministic | yes | proven | _dynamic / non-WCAG_ | — |
| `compliance-monitoring` | deterministic | yes | proven | _dynamic / non-WCAG_ | — |
| `eaa-procedure` | deterministic | yes | proven | _dynamic / non-WCAG_ | — |
| `llm-semantic-text` | llm | no | proven | 3.1.3, 3.1.4, 3.1.6, 2.4.9, 2.4.10, 1.3.6 | — |
| `llm-auth` | llm | no | proven | 3.3.8, 3.3.9 | — |
| `llm-media-alternatives` | llm | no | proven | 1.2.6, 1.2.7, 1.2.8, 1.2.9 | — |
| `llm-visual-presentation` | llm | no | proven | 1.4.7, 1.4.8, 1.4.9 | — |
| `llm-behavioral` | llm | no | proven | 2.2.3, 2.2.4, 2.2.5, 2.2.6, 3.2.5, 3.3.5 | — |
| `llm-focus-appearance` | llm | no | proven | 2.4.12, 2.4.13 | — |
| `llm-sensory-characteristics` | llm | no | proven | 1.3.3 | — |
| `llm-reading-level` | llm | no | proven | 3.1.5 | — |
| `llm-incomplete-reviewer` | llm | no | proven | _dynamic / non-WCAG_ | — |
| `llm-redundant-entry` | llm | no | proven | 3.3.7 | — |
| `llm-consistent-help` | llm | yes | proven | 3.2.6 | — |
| `llm-alt-quality` | llm | no | proven | 1.1.1 | — |

EN 301 549 clause 12 (accessibility statement, contact mechanism, monitoring,
enforcement procedure) is covered by the four EAA scanners and is outside the
WCAG success-criterion numbering, so it does not appear in the matrix above.
