/**
 * Compatibility shim for the LLM analysis entry point.
 *
 * `LLMBaseScanner` is gaining `analyzePageChunked()` — a shared, compressed,
 * chunked page-context pack that replaces blind 12k-char truncation and gives
 * every LLM scanner an identical (therefore prompt-cacheable) context prefix.
 *
 * The scanners in this file's dependents are written against that API. This
 * shim keeps them working on a base class that does not have it yet, and keeps
 * their `summary` shape identical either way, so no scanner needs a code change
 * when the new path lands.
 *
 * @param {import('./llm-base-scanner')} scanner
 * @param {import('puppeteer').Page} page
 * @param {string} prompt — the scanner-specific instructions (and any
 *   pre-computed data). Always sent AFTER the shared page-context block.
 * @param {Object} [options] — forwarded to `analyzePageChunked` when available.
 * @returns {Promise<{ violations: Object[], ctx: Object }>}
 *   `violations` are RAW LLM violation objects; the caller still runs
 *   `convertViolations()` so the off-criterion-list filter applies.
 */
async function analyzeCompat(scanner, page, prompt, options = {}) {
  if (typeof scanner.analyzePageChunked === 'function') {
    const { violations, summary } = await scanner.analyzePageChunked(page, prompt, options);
    return { violations: violations || [], ctx: summary || {} };
  }

  const html = await scanner.extractRelevantHTML(page, options.fallbackSelector || 'body', 12000);
  const result = await scanner.analyzeWithLLM(html, prompt);
  return {
    violations: result.violations || [],
    ctx: {
      llmModel: result.model || 'unknown',
      analyzedFraction: null,
      chunkCount: 1,
      truncated: null,
      extraction: 'legacy-truncation',
    },
  };
}

module.exports = { analyzeCompat };
