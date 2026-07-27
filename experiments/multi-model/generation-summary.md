# Multi-Model A11y Experiment — Generation Summary

**Date:** 2026-04-06
**Models:** 6
**Pages per model:** 5
**System prompt:** SKILL.md + common-patterns.md + framework-specific refs (no wcag2.2.md)

## Results

| Model | Pages OK | Errors | Prompt Tokens | Completion Tokens | Validation Issues |
|-------|----------|--------|---------------|-------------------|-------------------|
| gemini-3.1-flash-lite | 5/5 | 0 | 58,900 | 9,788 | 0 |
| gemma-4-31b-it | 5/5 | 0 | 63,525 | 18,820 | 1 |
| qwen3.6-plus | 3/5 | 2 | 36,978 | 19,782 | 0 |
| minimax-m2.7 | 4/5 | 1 | 44,194 | 35,565 | 0 |
| kimi-k2.5 | 5/5 | 0 | 53,770 | 49,305 | 0 |
| glm-5-turbo | 4/5 | 1 | 44,053 | 58,116 | 0 |

## Per-Model Details

### gemini-3.1-flash-lite

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 7.1KB | 10636+1945 | 8.1s | — |
| react-tailwind/form | 6.2KB | 13760+1815 | 8.3s | — |
| vue-tailwind/form | 7.4KB | 13223+2069 | 8.1s | — |
| svelte-tailwind/form | 5.5KB | 10640+1731 | 7.4s | — |
| angular-tailwind/form | 7.7KB | 10641+2228 | 9.8s | — |

### gemma-4-31b-it

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 10.1KB | 11870+3033 | 113.1s | — |
| react-tailwind/form | 18.7KB | 13061+4999 | 1585.5s | missing closing </html> |
| vue-tailwind/form | 15.7KB | 14845+3854 | 182.9s | — |
| svelte-tailwind/form | 11.5KB | 11874+3485 | 190.2s | — |
| angular-tailwind/form | 11.6KB | 11875+3449 | 995.2s | — |

### qwen3.6-plus

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | ERROR | — | — | HTTP 429: {"error":{"message":"Provider returned error","cod |
| react-tailwind/form | 25.8KB | 13501+7347 | 143.3s | — |
| vue-tailwind/form | 21.8KB | 12989+6596 | 121s | — |
| svelte-tailwind/form | ERROR | — | — | API error: Upstream error from Alibaba: Request rate increas |
| angular-tailwind/form | 20.8KB | 10488+5839 | 109.4s | — |

**Errors:**
- html-tailwind/form: HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"qwen/qwen3.6-plus:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumula
- svelte-tailwind/form: API error: Upstream error from Alibaba: Request rate increased too quickly. To ensure system stability, please adjust your client logic to scale requests more smoothly over time.

### minimax-m2.7

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 29.2KB | 9771+7964 | 90.2s | — |
| react-tailwind/form | 32.8KB | 12593+9450 | 93.2s | — |
| vue-tailwind/form | 25.5KB | 12053+7591 | 88.3s | — |
| svelte-tailwind/form | 28.1KB | 9777+10560 | 111.5s | — |
| angular-tailwind/form | ERROR | — | — | No content in response: 
         

         

         

   |

**Errors:**
- angular-tailwind/form: No content in response: 
         

         

         

         

         

         

         

         

         

         

         

         

         

         

         

         


### kimi-k2.5

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | 14.1KB | 9738+8699 | 550.6s | — |
| react-tailwind/form | 18.7KB | 12546+9833 | 179.4s | — |
| vue-tailwind/form | 12.8KB | 12001+9292 | 200.2s | — |
| svelte-tailwind/form | 13.7KB | 9742+9596 | 265.8s | — |
| angular-tailwind/form | 15.7KB | 9743+11885 | 466s | — |

### glm-5-turbo

| Tech-CSS/Page | Size | Tokens (in+out) | Time | Issues |
|---------------|------|-----------------|------|--------|
| html-tailwind/form | ERROR | — | — | No content in response: 
         

         

         

   |
| react-tailwind/form | 16.5KB | 12493+12921 | 193.2s | — |
| vue-tailwind/form | 16.0KB | 12024+15504 | 313.1s | — |
| svelte-tailwind/form | 19.1KB | 9768+15212 | 224.1s | — |
| angular-tailwind/form | 18.9KB | 9768+14479 | 269.3s | — |

**Errors:**
- html-tailwind/form: No content in response: 
         

         

         

         

         

         

         

         

         

         

         

         

         

         

         

         


## Next Steps

1. Review generated HTML files in `generated/`
2. Run scanner: adapt `scan-experiment.js` or create `scan.js` wrapper
3. Compare results against Haiku baseline in `../haiku-a11y/results/`