# Multi-Model A11y Experiment — Generation Summary

**Date:** 2026-04-06
**Models:** 6
**Pages per model:** 5
**System prompt:** SKILL.md + common-patterns.md + framework-specific refs (no wcag2.2.md)

## Results

| Model | Pages OK | Errors | Prompt Tokens | Completion Tokens | Validation Issues |
|-------|----------|--------|---------------|-------------------|-------------------|
| gemini-3.1-flash-lite | 5/5 | 0 | 51,985 | 8,379 | 0 |
| gemma-4-31b-it | 5/5 | 0 | 58,650 | 16,988 | 0 |
| qwen3.6-plus | 2/5 | 3 | 18,238 | 14,671 | 0 |
| minimax-m2.7 | 5/5 | 0 | 47,696 | 37,005 | 0 |
| kimi-k2.5 | 5/5 | 0 | 47,455 | 47,677 | 0 |
| glm-5-turbo | 4/5 | 1 | 38,996 | 43,544 | 1 |

## Per-Model Details

### gemini-3.1-flash-lite

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 6.1KB | 9255+1792 | 7.6s | — |
| react-tailwind/form | 6.3KB | 12375+1662 | 5.3s | — |
| vue-tailwind/form | 6.3KB | 11840+1747 | 7s | — |
| svelte-tailwind/form | 5.7KB | 9257+1551 | 5.2s | — |
| angular-tailwind/form | 5.7KB | 9258+1627 | 5.7s | — |

### gemma-4-31b-it

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 10.0KB | 10422+3114 | 101.1s | — |
| react-tailwind/form | 18.5KB | 13978+3999 | 197s | — |
| vue-tailwind/form | 11.2KB | 13397+3337 | 148.1s | — |
| svelte-tailwind/form | 11.5KB | 10426+3459 | 121.1s | — |
| angular-tailwind/form | 12.1KB | 10427+3079 | 102s | — |

### qwen3.6-plus

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 21.1KB | 9117+7357 | 146.2s | — |
| react-tailwind/form | ERROR | — | — | HTTP 429: {"error":{"message":"Provider returned error","cod |
| vue-tailwind/form | ERROR | — | — | HTTP 429: {"error":{"message":"Provider returned error","cod |
| svelte-tailwind/form | ERROR | — | — | HTTP 429: {"error":{"message":"Provider returned error","cod |
| angular-tailwind/form | 22.1KB | 9121+7314 | 134.9s | — |

**Errors:**
- react-tailwind/form: HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"qwen/qwen3.6-plus:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumula
- vue-tailwind/form: HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"qwen/qwen3.6-plus:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumula
- svelte-tailwind/form: HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"qwen/qwen3.6-plus:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumula

### minimax-m2.7

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 25.9KB | 8516+7033 | 94.9s | — |
| react-tailwind/form | 37.7KB | 11338+10305 | 143.9s | — |
| vue-tailwind/form | 24.5KB | 10798+6333 | 87.4s | — |
| svelte-tailwind/form | 23.1KB | 8522+6730 | 93.6s | — |
| angular-tailwind/form | 25.0KB | 8522+6604 | 94s | — |

### kimi-k2.5

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 14.9KB | 8474+10590 | 311.3s | — |
| react-tailwind/form | 22.5KB | 11283+8599 | 32.4s | — |
| vue-tailwind/form | 16.1KB | 10738+9030 | 224.2s | — |
| svelte-tailwind/form | 13.7KB | 8480+10003 | 125.2s | — |
| angular-tailwind/form | 15.8KB | 8480+9455 | 350.9s | — |

### glm-5-turbo

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 23.4KB | 8500+6135 | 105.7s | — |
| react-tailwind/form | 21.2KB | 11230+16238 | 295.5s | — |
| vue-tailwind/form | 16.7KB | 10761+4787 | 81.7s | — |
| svelte-tailwind/form | ERROR | — | — | No content in response: 
         

         

         

   |
| angular-tailwind/form | 11.1KB | 8505+16384 | 252.2s | missing closing </html> |

**Errors:**
- svelte-tailwind/form: No content in response: 
         

         

         

         

         

         

         

         

         

         

         

         

         

         

         

         


## Next Steps

1. Review generated HTML files in `generated/`
2. Run scanner: adapt `scan-experiment.js` or create `scan.js` wrapper
3. Compare results against Haiku baseline in `../haiku-a11y/results/`