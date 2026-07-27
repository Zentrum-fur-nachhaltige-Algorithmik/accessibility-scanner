# LLM scanner to review axe-core incomplete results

## Context

axe-core produces three result types:
- `violations` — definitive WCAG failures (high confidence)
- `incomplete` — checks that axe-core could not fully evaluate and requires human review
- `passes` — confirmed compliance

Currently our `AxeCoreAdapter` (`src/axe-core-adapter.js`) ingests both `violations` and `incomplete`, mapping the latter to `severity: 'info'` with a "Manual review required" note in the report. This is a placeholder — the incomplete results provide no actionable signal without further analysis.

The most common cause of `incomplete` is axe-core being unable to compute a definitive contrast ratio when the element has complex backgrounds (gradients, images, overlays, transparent parents). Other causes include ambiguous ARIA parent/child relationships, iframes without scope, and dynamic DOM mutations.

## Goal

Build a new LLM-powered scanner (`src/llm-incomplete-reviewer-scanner.js`) that:

1. Receives the list of axe-core `incomplete` results from the current page scan
2. For each incomplete node, extracts a minimal context snippet (the element HTML + up to 2 parent levels + applicable computed styles)
3. Sends the snippet to an LLM with a targeted prompt asking: "Given this element and its computed context, does it comply with WCAG SC X.Y.Z? Respond: pass, fail, or still-uncertain."
4. Converts LLM judgments into definitive violations (when fail) or drops the finding (when pass)
5. Preserves `still-uncertain` results as lowered-severity `info` entries

## Architecture

- Extend `LLMBaseScanner` from `src/llm-base-scanner.js`
- Runs **after** `AxeCoreAdapter` in the pipeline (needs the incomplete results as input)
- One LLM call per incomplete result, with batching if count > N (avoid context explosion)
- Use the existing `LLMClient` configuration (`OPENROUTER_API_KEY`)
- Follow the existing LLM scanner pattern: conservative prompt, JSON response, auto-recovery on truncation

## Rule-specific prompts

Different axe-core rules need different context extraction:

| axe rule | Extract | Prompt focus |
|----------|---------|--------------|
| `color-contrast` | element + background chain + computed fg/bg colors + font size/weight | Compute effective contrast ratio against all parent backgrounds |
| `color-contrast-enhanced` | same as above | WCAG 1.4.6 7:1 threshold |
| `link-in-text-block` | link + surrounding text + computed styles | Is the link distinguishable by something other than color? |
| `aria-required-children` | element + all descendants | Does the ARIA role have its required children? |
| `scrollable-region-focusable` | element + tabindex + keyboard handlers | Can a keyboard user reach and scroll this region? |

## Open questions

- How to pipe axe-core results into the LLM scanner (pipeline dependency or shared context)?
- Rate limit / cost: bad pages may have hundreds of incomplete results
- Caching: identical DOM structures across pages should share a cached verdict

## References

- `src/axe-core-adapter.js` — source of incomplete results
- `src/llm-base-scanner.js` — base class pattern
- `src/llm-client.js` — OpenRouter client
- `src/llm-semantic-text-scanner.js` — example of a fully-implemented LLM scanner
