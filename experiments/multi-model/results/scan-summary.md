# Multi-Model A11y Experiment — Scan Results

**Date:** 2026-04-06
**Scan Profile:** full (all scanners including LLM)
**EAA Scanners Excluded:** accessibility-statement, contact-mechanism, compliance-monitoring, eaa-procedure

## Model Comparison

| Model | Pages | Mean Score | Median | Min | Max | Mean Violations | Critical | Serious |
|-------|-------|-----------|--------|-----|-----|----------------|----------|--------|
| gemini-3.1-flash-lite | 5 | 56% | 56% | 53% | 60% | 359.6 | 27 | 1188 |
| gemma-4-31b-it | 5 | 53% | 53% | 47% | 56% | 447.6 | 72 | 1420 |
| glm-5-turbo | 3 | 50% | 49% | 46% | 55% | 535.3 | 43 | 1068 |
| kimi-k2.5 | 5 | 51% | 50% | 49% | 58% | 463.2 | 41 | 1587 |
| minimax-m2.7 | 5 | 45% | 45% | 40% | 48% | 743.6 | 83 | 2548 |
| qwen3.6-plus | 2 | 44% | 44% | 38% | 50% | 582.5 | 28 | 770 |

## By Technology (all models combined)

| Technology | Mean Score | Mean Violations |
|-----------|-----------|----------------|
| angular | 51% | 539.8 |
| html | 50% | 512.2 |
| react | 50% | 520.8 |
| svelte | 50% | 477.3 |
| vue | 51% | 511.2 |

## Score Heatmap (Model × Technology)

| Model | angular | html | react | svelte | vue |
|-------|------|------|------|------|------|
| gemini-3.1-flash-lite | 53% (392v) | 56% (350v) | 60% (340v) | 53% (318v) | 56% (398v) |
| gemma-4-31b-it | 56% (394v) | 53% (426v) | 51% (509v) | 47% (464v) | 56% (445v) |
| glm-5-turbo | — | 55% (579v) | 49% (478v) | — | 46% (549v) |
| kimi-k2.5 | 50% (519v) | 50% (497v) | 49% (443v) | 58% (437v) | 50% (420v) |
| minimax-m2.7 | 48% (780v) | 45% (670v) | 40% (834v) | 42% (690v) | 48% (744v) |
| qwen3.6-plus | 50% (614v) | 38% (551v) | — | — | — |

## Top 10 Failed WCAG Criteria (all models)

| Criterion | Count |
|-----------|-------|
| 1.4.4 | 8514 |
| 2.5.5 | 3138 |
| EAA-Monitoring | 151 |
| 1.4.11 | 132 |
| 4.1.3 | 109 |
| 9.4.1.1 | 95 |
| EAA-Statement | 57 |
| 9.2.3.3 | 52 |
| 1.4.7,1.4.8,1.4.9 | 49 |
| EAA-Contact | 48 |

## All Files

| Model | Tech | Score | Violations | Critical | Serious |
|-------|------|-------|-----------|----------|--------|
| gemini-3.1-flash-lite | angular-tailwind | 53% | 392 | 8 | 244 |
| gemini-3.1-flash-lite | svelte-tailwind | 53% | 318 | 4 | 217 |
| gemini-3.1-flash-lite | html-tailwind | 56% | 350 | 9 | 227 |
| gemini-3.1-flash-lite | vue-tailwind | 56% | 398 | 3 | 271 |
| gemini-3.1-flash-lite | react-tailwind | 60% | 340 | 3 | 229 |
| gemma-4-31b-it | svelte-tailwind | 47% | 464 | 23 | 300 |
| gemma-4-31b-it | react-tailwind | 51% | 509 | 15 | 314 |
| gemma-4-31b-it | html-tailwind | 53% | 426 | 12 | 263 |
| gemma-4-31b-it | angular-tailwind | 56% | 394 | 11 | 257 |
| gemma-4-31b-it | vue-tailwind | 56% | 445 | 11 | 286 |
| glm-5-turbo | vue-tailwind | 46% | 549 | 14 | 355 |
| glm-5-turbo | react-tailwind | 49% | 478 | 16 | 318 |
| glm-5-turbo | html-tailwind | 55% | 579 | 13 | 395 |
| kimi-k2.5 | react-tailwind | 49% | 443 | 7 | 284 |
| kimi-k2.5 | angular-tailwind | 50% | 519 | 13 | 353 |
| kimi-k2.5 | html-tailwind | 50% | 497 | 10 | 331 |
| kimi-k2.5 | vue-tailwind | 50% | 420 | 8 | 298 |
| kimi-k2.5 | svelte-tailwind | 58% | 437 | 3 | 321 |
| minimax-m2.7 | react-tailwind | 40% | 834 | 21 | 527 |
| minimax-m2.7 | svelte-tailwind | 42% | 690 | 13 | 479 |
| minimax-m2.7 | html-tailwind | 45% | 670 | 13 | 472 |
| minimax-m2.7 | angular-tailwind | 48% | 780 | 18 | 540 |
| minimax-m2.7 | vue-tailwind | 48% | 744 | 18 | 530 |
| qwen3.6-plus | html-tailwind | 38% | 551 | 15 | 358 |
| qwen3.6-plus | angular-tailwind | 50% | 614 | 13 | 412 |
