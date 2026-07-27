# Haiku + a11y-code Skill Experiment Results

**Date:** 2026-04-05
**Model:** Claude Haiku 4.5
**Scan Profile:** full (all 40+ scanners including LLM)
**Total Files:** 45 | **Valid:** 45 | **Invalid:** 0 | **Scanned:** 45

## Overall Summary

| Metric | Value |
|--------|-------|
| Mean Score | 51% |
| Median Score | 51% |
| Min / Max Score | 36% / 69% |
| Total Violations | 28779 |
| Mean Violations/Page | 639.5 |
| Critical | 1748 |
| Serious | 16150 |
| Moderate | 9706 |
| Minor | 264 |

## By Technology

| Technology | Mean Score | Mean Violations | Critical | Serious |
|-----------|-----------|----------------|----------|--------|
| react | 54% | 468.7 | 208 | 2171 |
| vue | 54% | 553.6 | 252 | 2855 |
| html | 50% | 702 | 458 | 3624 |
| svelte | 49% | 672.8 | 400 | 3411 |
| angular | 48% | 800.7 | 430 | 4089 |

## By CSS Framework

| CSS | Mean Score | Mean Violations | Critical | Serious |
|-----|-----------|----------------|----------|--------|
| tailwind | 52% | 658.9 | 621 | 5606 |
| bootstrap | 51% | 610.2 | 581 | 5239 |
| vanilla | 50% | 649.5 | 546 | 5305 |

## By Page Type

| Page | Mean Score | Mean Violations | Critical | Serious |
|------|-----------|----------------|----------|--------|
| dashboard | 53% | 789.2 | 850 | 5402 |
| form | 51% | 409.9 | 74 | 3887 |
| landing | 49% | 719.5 | 824 | 6861 |

## Score Heatmap (Tech-CSS x Page)

| Tech-CSS | dashboard | form | landing |
|----------|------|------|------|
| angular-bootstrap | 56% (861v) | 50% (455v) | 47% (873v) |
| angular-tailwind | 50% (1043v) | 47% (437v) | 48% (1093v) |
| angular-vanilla | 44% (872v) | 53% (400v) | 36% (1172v) |
| html-bootstrap | 58% (709v) | 50% (411v) | 42% (1196v) |
| html-tailwind | 53% (845v) | 47% (420v) | 42% (923v) |
| html-vanilla | 53% (726v) | 56% (372v) | 53% (716v) |
| react-bootstrap | 53% (794v) | 47% (387v) | 44% (540v) |
| react-tailwind | 69% (136v) | 51% (427v) | 67% (57v) |
| react-vanilla | 53% (908v) | 53% (368v) | 50% (601v) |
| svelte-bootstrap | 47% (832v) | 53% (406v) | 47% (601v) |
| svelte-tailwind | 56% (1098v) | 45% (402v) | 53% (849v) |
| svelte-vanilla | 53% (612v) | 50% (392v) | 36% (863v) |
| vue-bootstrap | 53% (621v) | 56% (417v) | 67% (50v) |
| vue-tailwind | 50% (971v) | 50% (392v) | 53% (791v) |
| vue-vanilla | 53% (810v) | 53% (463v) | 47% (467v) |

## Top 10 Failed WCAG Criteria

| Criterion | Count |
|-----------|-------|
| 1.4.4 | 16710 |
| 2.5.5 | 6318 |
| 1.4.10 | 1845 |
| 9.1.4.10 | 658 |
| 9.1.4.4 | 656 |
| 1.4.11 | 435 |
| EAA-Monitoring | 267 |
| unknown | 211 |
| 9.2.5.8 | 171 |
| 4.1.2 | 126 |

## Top 10 Scanners with Most Violations

| Scanner | Violations |
|---------|------------|
| unknown | 28479 |
| llm-visual-presentation | 103 |
| llm-focus-appearance | 74 |
| llm-behavioral | 58 |
| multiple-ways | 31 |
| llm-semantic-text | 31 |
| llm-sensory-characteristics | 3 |

## Per-File Results

| File | Score | Violations | Critical | Serious | Moderate | Minor |
|------|-------|-----------|----------|---------|----------|-------|
| angular-vanilla/landing.html | 36% | 1172 | 70 | 764 | 302 | 6 |
| svelte-vanilla/landing.html | 36% | 863 | 65 | 562 | 203 | 9 |
| html-bootstrap/landing.html | 42% | 1196 | 118 | 799 | 231 | 7 |
| html-tailwind/landing.html | 42% | 923 | 112 | 605 | 183 | 5 |
| angular-vanilla/dashboard.html | 44% | 872 | 62 | 390 | 393 | 9 |
| react-bootstrap/landing.html | 44% | 540 | 58 | 308 | 142 | 6 |
| svelte-tailwind/form.html | 45% | 402 | 3 | 272 | 115 | 4 |
| angular-bootstrap/landing.html | 47% | 873 | 71 | 555 | 213 | 6 |
| angular-tailwind/form.html | 47% | 437 | 5 | 294 | 106 | 4 |
| html-tailwind/form.html | 47% | 420 | 3 | 270 | 120 | 4 |
| react-bootstrap/form.html | 47% | 387 | 5 | 221 | 133 | 5 |
| svelte-bootstrap/dashboard.html | 47% | 832 | 53 | 395 | 361 | 8 |
| svelte-bootstrap/landing.html | 47% | 601 | 54 | 374 | 146 | 8 |
| vue-vanilla/landing.html | 47% | 467 | 25 | 264 | 151 | 7 |
| angular-tailwind/landing.html | 48% | 1093 | 69 | 737 | 256 | 7 |
| angular-bootstrap/form.html | 50% | 455 | 5 | 268 | 151 | 5 |
| angular-tailwind/dashboard.html | 50% | 1043 | 78 | 399 | 546 | 4 |
| html-bootstrap/form.html | 50% | 411 | 4 | 261 | 118 | 4 |
| react-vanilla/landing.html | 50% | 601 | 9 | 343 | 219 | 8 |
| svelte-vanilla/form.html | 50% | 392 | 3 | 239 | 121 | 4 |
| vue-tailwind/dashboard.html | 50% | 971 | 79 | 473 | 393 | 11 |
| vue-tailwind/form.html | 50% | 392 | 3 | 252 | 112 | 3 |
| react-tailwind/form.html | 51% | 427 | 10 | 267 | 123 | 4 |
| angular-vanilla/form.html | 53% | 400 | 10 | 249 | 108 | 3 |
| html-tailwind/dashboard.html | 53% | 845 | 57 | 366 | 402 | 6 |
| html-vanilla/dashboard.html | 53% | 726 | 47 | 339 | 312 | 14 |
| html-vanilla/landing.html | 53% | 716 | 51 | 379 | 269 | 5 |
| react-bootstrap/dashboard.html | 53% | 794 | 60 | 330 | 381 | 6 |
| react-vanilla/dashboard.html | 53% | 908 | 52 | 387 | 452 | 4 |
| react-vanilla/form.html | 53% | 368 | 5 | 225 | 109 | 4 |
| svelte-bootstrap/form.html | 53% | 406 | 3 | 265 | 111 | 3 |
| svelte-tailwind/landing.html | 53% | 849 | 60 | 551 | 205 | 5 |
| svelte-vanilla/dashboard.html | 53% | 612 | 86 | 289 | 215 | 6 |
| vue-bootstrap/dashboard.html | 53% | 621 | 18 | 344 | 241 | 5 |
| vue-tailwind/landing.html | 53% | 791 | 60 | 566 | 135 | 7 |
| vue-vanilla/dashboard.html | 53% | 810 | 55 | 357 | 369 | 15 |
| vue-vanilla/form.html | 53% | 463 | 2 | 289 | 148 | 3 |
| angular-bootstrap/dashboard.html | 56% | 861 | 60 | 433 | 348 | 7 |
| html-vanilla/form.html | 56% | 372 | 4 | 229 | 110 | 1 |
| svelte-tailwind/dashboard.html | 56% | 1098 | 73 | 464 | 540 | 6 |
| vue-bootstrap/form.html | 56% | 417 | 9 | 286 | 97 | 5 |
| html-bootstrap/dashboard.html | 58% | 709 | 62 | 376 | 250 | 6 |
| react-tailwind/landing.html | 67% | 57 | 1 | 30 | 9 | 3 |
| vue-bootstrap/landing.html | 67% | 50 | 1 | 24 | 5 | 6 |
| react-tailwind/dashboard.html | 69% | 136 | 8 | 60 | 52 | 6 |
