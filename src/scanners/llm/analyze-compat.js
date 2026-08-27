/**
 * analyzeCompat
 * Analysis entry point for LLM scanners: uses the base class's chunked
 * page-context pack when available, otherwise a 12k-char HTML excerpt via
 * analyzeWithLLM. The returned summary shape is identical on both paths.
 */

/**
 * @param {import('./base')} scanner
 * @param {import('puppeteer').Page} page
 * @param {string} prompt - scanner-specific instructions (and any
 *   pre-computed data). Always sent AFTER the shared page-context block.
 * @param {Object} [options] - forwarded to `analyzePageChunked` when available.
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
