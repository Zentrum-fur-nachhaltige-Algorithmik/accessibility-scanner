# Audit: med-websites template themes, 2026-09-28

Scan of the five themes produced by the generate.gsunde.website generator (old `template/`, not
`template-v2`), with the scanner at main `2633eb8`. Purpose: how accessible are the generated
sites, and how well does the scanner do on them.

## Scope

```
corpus     test-sites/realworld/med-templates/  (gitignored, local only)
source     ~/generate.gsunde.website/template/output/brandt-a11y-<theme>/out/, imported 2026-08-22
seed       dr-brandt-kardiologie (fictional practice)
themes     evergreen, clinic, lumen, warmth, spectrum
routes     index, leistungen, team, kontakt, preise, patienteninfo, impressum, datenschutz
profile    full, experimental scanners included, no LLM scanners
command    node scripts/harness/golden.js --theme <theme> --report --json <out>
```

The generator has since moved to `template-v2` (last change 2026-09-06). Nothing here says
whether `template-v2` still carries these defects.

## Result

No page has a critical finding. Every theme has real defects, so none of them is WCAG 2.2 AA
conformant as exported.

| Theme     | Score per page | Findings (8 pages) | 2026-08-24 | Main defects                                              |
|-----------|----------------|--------------------|------------|-----------------------------------------------------------|
| evergreen | 82-90          | 22                 | 36         | footer focus ring, footer links under fixed CTA           |
| spectrum  | 78-86          | 26                 | 40         | topbar focus ring, CTA covers links at 200% zoom          |
| clinic    | 77-85          | 50                 | 96         | footer text 4.42:1                                        |
| warmth    | 72-80          | 92                 | 167        | footer text 3.05:1, skip link under header, CTA at zoom   |
| lumen     | 68-76          | 104                | 169        | footer text 3.47:1, step numbers 1.28:1, skip link, CTA   |

Findings counts are hard violations as counted by the golden harness. The drop against
2026-08-24 is scanner work, not template changes (the corpus is unchanged): duplicate contrast
reports (`insufficient-text-contrast` next to axe `color-contrast`) and false `svg-img-alt`
reports are gone.

## Defects in every theme

| Defect                                | SC      | Where                                                         |
|---------------------------------------|---------|---------------------------------------------------------------|
| No accessibility statement linked     | EAA     | every page                                                    |
| Stat label clipped under text spacing | 1.4.12  | index, "Ausfuehrliche Gespraeche" in the stats grid, 22-24px  |
| Stats grid clips text at 320px        | 1.4.10  | index, `overflow: hidden` grid, 113 characters cut, 153px     |
| Heading jump in footer (h1 to h4/h5)  | best practice | footer column headings                                  |
| "Mehr erfahren" links without target  | 2.4.9 (AAA, needs review) | index, service cards and hero button          |

## Findings per theme

### evergreen

| Rule                                   | SC     | Selector                                                     | Measured                            | Routes       |
|----------------------------------------|--------|--------------------------------------------------------------|-------------------------------------|--------------|
| insufficient-focus-indicator-contrast  | 1.4.11 | `div:nth-of-type(2) > ul.footer__list > li:nth-of-type(1) > a` | ring 1.41:1, 8 links share it     | all          |
| focus-obscured-by-fixed-element        | 2.4.11 | footer list links                                            | fully hidden behind `a.sticky-cta`  | preise, patienteninfo, impressum |
| text-spacing-failure                   | 1.4.12 | `h3.h2.styles-module__FrnLcW__featuredHeading`               | "Echokardiographie" clipped 7px     | leistungen   |

### clinic

| Rule                                   | SC     | Selector                                     | Measured                         | Routes |
|----------------------------------------|--------|----------------------------------------------|----------------------------------|--------|
| color-contrast                         | 1.4.3  | `.footer-bottom > span:nth-child(1)`, impressum and datenschutz links | 4.42:1, #6f8099 on #0f1828, 13.5px | all |
| color-contrast                         | 1.4.3  | `.brole` ("Kardiologie · Graz")              | 4.45:1, #6b7890 on #ffffff, 11.5px | all  |
| insufficient-focus-indicator-contrast  | 1.4.11 | `div.topbar ... a.tb-item.hide-sm`           | ring below 3:1                   | all    |
| region (best practice)                 |        | `.topbar`                                    | content outside landmarks        | all    |

### lumen

| Rule                                   | SC     | Selector                                     | Measured                           | Routes |
|----------------------------------------|--------|----------------------------------------------|------------------------------------|--------|
| color-contrast                         | 1.4.3  | `.step__num` (01, 02, 03)                    | 1.28:1, #c4d8d8 on #e8f0f0, 32px   | index  |
| color-contrast                         | 1.4.3  | `.footer__tagline`, `.footer__bottom`, impressum, datenschutz | 3.47:1, #768d8d on #1c3a3a | all |
| color-contrast                         | 1.4.3  | footer column headings `h4`                  | 3.86:1, #7f9595 on #1c3a3a, 11px   | all    |
| color-contrast                         | 1.4.3  | `.section-head > .eyebrow`                   | 4.37:1, #567474 on #e8f0f0, 11px   | index  |
| color-contrast                         | 1.4.3  | `.imgph` image placeholders                  | 4.49:1                             | leistungen, team |
| focus-obscured-by-sticky-element       | 2.4.11 | skip link                                    | fully hidden behind `header.header` | 5-8 of 8 |
| interaction-blocked                    | 1.4.4  | `a.sticky-cta`                               | covers 2 controls at 200% zoom     | 6-8 of 8 |
| insufficient-focus-indicator-contrast  | 1.4.11 | footer list links                            | ring below 3:1                     | 6 of 8 |

The `.imgph` placeholders stand in for photos in the static export. On a site with real photos
they would not be there, so treat them as an export artefact.

### warmth

| Rule                                   | SC     | Selector                                     | Measured                           | Routes |
|----------------------------------------|--------|----------------------------------------------|------------------------------------|--------|
| color-contrast                         | 1.4.3  | `.footer__bottom`, impressum, datenschutz    | 3.05:1, #73675e on #2a1a0e, 12px   | all    |
| color-contrast                         | 1.4.3  | footer column headings `h4`                  | 3.57:1, #7d7269 on #2a1a0e, 11px   | all    |
| color-contrast                         | 1.4.3  | `.footer__tagline`                           | 4.18:1, #887d75 on #2a1a0e         | all    |
| color-contrast                         | 1.4.3  | service card links, `.spec`                  | 4.17:1, #b4552f on #f2ece4, 11-14px | index, team |
| color-contrast                         | 1.4.3  | `.eyebrow`, language tags                    | 3.87-3.88:1, #b4552f on #fbdfd4    | index, leistungen, kontakt, team |
| focus-obscured-by-sticky-element       | 2.4.11 | skip link                                    | fully hidden behind `header.header` | 6-8 of 8 |
| interaction-blocked                    | 1.4.4  | `a.sticky-cta`                               | covers 2 controls at 200% zoom     | 6-8 of 8 |

Five image placeholders are reported as color-contrast needs-review (axe could not evaluate
them); same artefact as in lumen.

### spectrum

| Rule                                   | SC     | Selector                                     | Measured                         | Routes |
|----------------------------------------|--------|----------------------------------------------|----------------------------------|--------|
| interaction-blocked                    | 1.4.4  | `a.btn` (call bar)                           | covers 2 controls at 200% zoom   | all    |
| insufficient-focus-indicator-contrast  | 1.4.11 | `div.topbar ... a.tb-item.hide-sm`           | ring below 3:1, 7 elements share it | all |
| region (best practice)                 |        | `.topbar`                                    | content outside landmarks        | all    |

## Fixes that remove most findings

```
1  footer colors (clinic, lumen, warmth)      darken text to >= 4.5:1 on the footer background
2  step numbers (lumen)                       #c4d8d8 is decoration-level; use a text color
3  skip link (lumen, warmth)                  z-index above header.header
4  sticky CTA / call bar                      no overlap at 200% zoom and <= 640px; reserve space
5  focus ring (evergreen, clinic, lumen, spectrum)  >= 3:1 against footer and topbar
6  stats grid                                 drop overflow: hidden, let the grid grow
7  accessibility statement page               linked from the footer on every page
```

## Verification

- Contrast values for clinic and lumen index were measured again by hand with axe-core in
  puppeteer at 1280x900; they match the table.
- warmth contrast, focus rings, zoom and text-spacing findings were not checked by hand.
- The golden harness passed: no forbidden rule fired, and every defect verified by hand in
  August (footer focus ring, heading jump, missing statement, clipped stat label, skip link
  under header, links under the CTA) was detected again.

## Run-to-run variance

Two runs on the same day disagree on some counts:

```
rule                               lumen  warmth
focus-obscured-by-sticky-element   8 / 5  8 / 6
interaction-blocked                8 / 6  8 / 6
missing-accessibility-statement    8 / 8  8 / 4
```

Timing-dependent scanners (focus, zoom, statement lookup) are not stable under load; the second
run scanned three themes in parallel. The defects are real either way; the per-page counts are
not reliable to one finding.

## Scanner quality

- Precision gate (`tests/data/harness/harness-precision.json`, 2026-08-30): 173 true, 1 false,
  37 needs-review labels over the real-world snapshots; 24 of 32 rules at precision 1.0.
- Real-world corpus: 465 findings on 16 snapshots.
- On this corpus: no false positives among the checked findings; the remaining noise is the
  image placeholder contrast, which is an export artefact rather than a scanner error.
- Open: the claims audit (does each rule measure what its criterion asks) has about 85 open
  items and three fix branches not merged; LLM scanners are experimental and not in this scan,
  so judgement criteria (alt text quality, link purpose, headings that describe) are not covered.

## Screen reader usability

From the screen reader agent measurements of 2026-08-29 (branch `feat/sr-agent`, k=3):
barrier score B (privileged steps / blind steps, 1.0 = no barrier) lumen 0.62, clinic 0.63,
against gov.uk 0.41 and urologiefischer 0.57. The generated sites are usable by screen reader
and better than both references.
