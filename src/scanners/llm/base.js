/**
 * LLMBaseScanner — base class for scanners that use LLM analysis.
 *
 * Extends BaseScanner with LLM capabilities for semantic checks that
 * regex/DOM analysis cannot handle.
 */

const BaseScanner = require('../../core/base-scanner');
const { getPageContextPack } = require('./page-context');
const log = require('../../utils/logger').createLogger('llm-base');

/**
 * The system prompt shared by BOTH the legacy `analyzeWithLLM` path and the
 * chunked `analyzePageChunked` path. It lives at module scope on purpose: the
 * provider's implicit prompt cache keys on an identical byte prefix, so every
 * LLM scanner must send the *same* system string, not an equivalent copy.
 */
const DEFAULT_SYSTEM_PROMPT = `You are an accessibility auditor. Analyze HTML for WCAG 2.2 compliance issues.

CRITICAL RULES:
1. ONLY report violations for the SPECIFIC criteria mentioned in the user prompt. Do NOT report violations for any other WCAG criteria.
2. If the HTML is compliant for the requested criteria, return an EMPTY violations array.
3. Err on the side of NOT flagging. Only report clear, unambiguous violations.
4. Do NOT flag issues related to criteria not listed in the prompt (e.g., do not flag 1.3.1, 1.4.3, or 2.4.4 unless explicitly asked).

Respond ONLY with valid JSON. Do not include markdown code fences or explanations.
Format: { "violations": [{ "criterion": "X.Y.Z", "description": "...", "impact": "critical|serious|moderate|minor", "selector": "..." }], "summary": "..." }`;

class LLMBaseScanner extends BaseScanner {
  /**
   * @param {string} id       — unique scanner identifier
   * @param {Object} metadata — WCAG metadata
   * @param {import('../../llm/client')} llmClient — LLM client instance
   */
  constructor(id, metadata, llmClient) {
    super(id, metadata);
    if (!llmClient) {
      throw new Error(`${id}: LLMBaseScanner requires an llmClient instance`);
    }
    this.llmClient = llmClient;
    // Running count of LLM violations dropped for being off-criterion-list
    // (prompt drift monitor — see convertViolations()).
    this.droppedViolationCount = 0;
  }

  /**
   * Send HTML snippet to LLM for analysis.
   *
   * @param {string} htmlSnippet — HTML to analyze
   * @param {string} prompt — analysis prompt
   * @param {string} [systemPrompt] — system role prompt
   * @returns {Promise<Object>} Parsed JSON response
   */
  async analyzeWithLLM(htmlSnippet, prompt, systemPrompt) {
    const fullPrompt = `Analyze the following HTML for accessibility issues.\n\nHTML:\n\`\`\`html\n${htmlSnippet}\n\`\`\`\n\n${prompt}`;

    const result = await this.llmClient.predict(fullPrompt, {
      systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      temperature: 0,
      forceJson: true,
    });

    if (!result.success) {
      throw new Error(`${this.id}: LLM analysis failed: ${result.error}`);
    }

    return this._parseLLMContent(result.content);
  }

  /**
   * Parse an LLM response body into `{ violations, summary }`, applying the
   * two recovery strategies the pinned model needs (trailing-garbage salvage,
   * then bounded truncation repair). Shared by `analyzeWithLLM` and
   * `analyzePageChunked` — the recovery logic must not diverge between paths.
   *
   * Never throws: an unparseable response degrades to an empty violation list
   * rather than failing the whole scan.
   *
   * @param {string|Object} content — raw `result.content` from the LLM client
   * @returns {Object} parsed response object
   */
  _parseLLMContent(content) {
    let parsed;
    try {
      let text = content;
      if (typeof text === 'string') {
        // Strip markdown code fences if present
        text = text
          .replace(/^```(?:json)?\s*\n?/i, '')
          .replace(/\n?```\s*$/i, '')
          .trim();
        try {
          parsed = JSON.parse(text);
        } catch {
          // First recovery attempt: some responses are a complete, valid
          // JSON object followed by trailing garbage (an observed decoding
          // degeneration in the pinned model — a repeated-token loop after
          // an otherwise well-formed answer). Salvage the first balanced
          // top-level JSON value and discard everything after it.
          const balanced = this._extractBalancedJson(text);
          if (balanced) {
            try {
              parsed = JSON.parse(balanced);
              log.warn(
                `${this.id}: Recovered JSON by discarding trailing garbage after a complete response`
              );
            } catch {
              // fall through to truncation recovery below
            }
          }

          if (parsed === undefined) {
            // Second recovery attempt: the response was cut off mid-structure
            // (ran out of tokens) or has non-JSON garbage spliced in before
            // its true end (not just appended after it, which the first
            // attempt already covers) — e.g. a stray quote/char breaking the
            // syntax right before what would have been the closing brace.
            // Progressively drop trailing lines (bounded) and try to repair
            // each shorter candidate, so we back off past any such
            // corruption to the last point the model was still coherent.
            const lines = text.split('\n');
            const maxCut = Math.min(40, lines.length - 1);

            for (let cut = 0; cut <= maxCut && parsed === undefined; cut++) {
              const candidate = lines.slice(0, lines.length - cut).join('\n');
              if (!candidate.trim()) continue;
              try {
                const repaired = this._repairTruncatedJson(candidate);
                parsed = JSON.parse(repaired);
                log.warn(
                  cut === 0
                    ? `${this.id}: Recovered truncated JSON response`
                    : `${this.id}: Recovered JSON after trimming ${cut} trailing corrupted line(s)`
                );
              } catch {
                // keep trimming
              }
            }

            if (parsed === undefined) {
              throw new Error('no candidate prefix produced valid JSON');
            }
          }
        }
      } else {
        parsed = text;
      }
    } catch (e) {
      log.error(`${this.id}: Failed to parse LLM response: ${e.message}`);
      // Return empty violations rather than crashing the scan
      parsed = { violations: [], summary: 'LLM response could not be parsed' };
    }

    return parsed;
  }

  /**
   * Extract the shared page context pack, run one LLM call per chunk, and merge
   * the results. Scanner-specific data (measured styles, subtree dumps, flags)
   * belongs in `instructions`, i.e. AFTER the shared context block, so the
   * system prompt + context block form an identical cacheable prefix across all
   * LLM scanners scanning the same page.
   *
   * Chunks are sent SEQUENTIALLY on purpose: chunk 1 warms the provider's
   * implicit prompt cache for the prefix that chunks 2..n reuse.
   *
   * @param {import('puppeteer').Page} page
   * @param {string} instructions — the scanner's prompt (and any pre-computed data)
   * @param {Object} [options] — forwarded to getPageContextPack; plus { systemPrompt }
   * @returns {Promise<{ violations: Object[], summary: Object }>}
   *   violations — RAW LLM violation objects (caller still runs convertViolations)
   *   summary    — { analyzedFraction, rawChars, skeletonChars, compressionRatio,
   *                  chunkCount, truncated, failedChunks, llmModel,
   *                  promptTokens, cachedPromptTokens }
   */
  async analyzePageChunked(page, instructions, options = {}) {
    const { systemPrompt, ...packOptions } = options;
    const pack = await getPageContextPack(page, packOptions);

    const system = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const merged = [];
    const seen = new Set();
    let failedChunks = 0;
    let promptTokens = 0;
    let cachedPromptTokens = 0;
    let llmModel = 'unknown';
    let lastError = null;

    for (let i = 0; i < pack.chunks.length; i++) {
      // Context FIRST, instructions LAST — the shared prefix must be byte-
      // identical across scanners for the implicit prompt cache to hit.
      const userMessage = `${pack.chunks[i]}\n\n${instructions}`;

      let result;
      try {
        result = await this.llmClient.predict(userMessage, {
          systemPrompt: system,
          temperature: 0,
          forceJson: true,
        });
      } catch (err) {
        result = { success: false, error: err.message };
      }

      if (!result || !result.success) {
        failedChunks++;
        lastError = (result && result.error) || 'unknown error';
        log.warn(
          `${this.id}: LLM analysis failed for context part ${i + 1}/${pack.chunks.length}: ${lastError}`
        );
        continue;
      }

      llmModel = result.model || llmModel;
      promptTokens += result.usage?.promptTokens ?? 0;
      cachedPromptTokens += result.usage?.cachedPromptTokens ?? 0;

      const parsed = this._parseLLMContent(result.content);
      const chunkViolations = Array.isArray(parsed?.violations) ? parsed.violations : [];
      for (const v of chunkViolations) {
        if (!v || typeof v !== 'object') continue;
        const key = `${v.criterion}|${v.selector}|${String(v.description).slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(v);
      }
    }

    // A partial failure degrades coverage but still yields findings; only a
    // total failure is an error worth propagating.
    if (pack.chunks.length > 0 && failedChunks === pack.chunks.length) {
      throw new Error(
        `${this.id}: LLM analysis failed for all ${failedChunks} context part(s): ${lastError}`
      );
    }

    return {
      violations: merged,
      summary: {
        analyzedFraction: pack.analyzedFraction,
        rawChars: pack.rawChars,
        skeletonChars: pack.skeletonChars,
        compressionRatio: pack.compressionRatio,
        chunkCount: pack.chunkCount,
        truncated: pack.truncated,
        failedChunks,
        llmModel,
        promptTokens,
        cachedPromptTokens,
      },
    };
  }

  /**
   * Best-effort repair of a truncated/corrupted JSON candidate: closes an
   * unterminated string literal (if the content ends mid-string), strips a
   * trailing incomplete key/value fragment, then closes any still-open
   * arrays/objects. Does not itself guarantee valid JSON — the caller must
   * still JSON.parse() the result.
   *
   * @param {string} content
   * @returns {string}
   */
  _repairTruncatedJson(content) {
    let fixed = content;

    // Remove a trailing incomplete entry (e.g. dangling comma or an open key).
    fixed = fixed.replace(/,\s*(?:{\s*"[^"]*":\s*)?$/, '');

    // If we're left mid-string-literal (an odd number of unescaped quotes),
    // close the string before closing the surrounding structure.
    let quoteCount = 0;
    let escaped = false;
    for (const ch of fixed) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') quoteCount++;
    }
    if (quoteCount % 2 !== 0) fixed += '"';

    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';

    return fixed;
  }

  /**
   * Extract the first complete, well-formed top-level JSON value (object or
   * array) from a string that may have garbage appended after it — observed
   * from the pinned model as a repeated-token decoding loop that continues
   * past an otherwise valid response (e.g. `... } \n 3.3."\n3.3."\n}\n}`).
   *
   * Rather than hand-tracking string/escape state to find the matching
   * brace (fragile here, since the garbage itself contains stray quotes and
   * braces that desync any such counter), this tries JSON.parse at every
   * `}`/`]` position from the start and returns the first substring that
   * parses cleanly. JSON.parse's own strictness — it rejects anything
   * incomplete or with trailing content — does the validation, so a false
   * match is not possible; only the true end of the top-level value can
   * succeed.
   *
   * @param {string} str
   * @returns {string|null} the valid JSON substring, or null if no prefix
   *   ever parses (i.e. the content is genuinely truncated, not followed by
   *   trailing garbage)
   */
  _extractBalancedJson(str) {
    const start = str.search(/[{[]/);
    if (start === -1) return null;

    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (ch !== '}' && ch !== ']') continue;

      const candidate = str.slice(start, i + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Not yet a complete/valid value ending here — keep scanning.
      }
    }

    return null;
  }

  /**
   * Extract relevant HTML from a page, truncated to stay within token limits.
   *
   * @param {import('puppeteer').Page} page — Puppeteer page
   * @param {string} [selector='body'] — CSS selector for content to extract
   * @param {number} [maxLength=15000] — Max characters to extract
   * @returns {Promise<string>} Truncated HTML string
   */
  async extractRelevantHTML(page, selector = 'body', maxLength = 15000) {
    const html = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.outerHTML : document.documentElement.outerHTML;
    }, selector);

    if (html.length <= maxLength) return html;

    // Truncate intelligently at a tag boundary if possible
    const truncated = html.slice(0, maxLength);
    const lastTagClose = truncated.lastIndexOf('>');
    if (lastTagClose > maxLength * 0.8) {
      return truncated.slice(0, lastTagClose + 1) + '\n<!-- ... truncated -->';
    }
    return truncated + '\n<!-- ... truncated -->';
  }

  /**
   * Normalize a WCAG criterion string for comparison against the scanner's
   * own `wcagCriteria` list. Handles EN 301 549-style prefixed identifiers
   * (e.g. "9.1.4.10" clause-numbering maps to bare WCAG SC "1.4.10") in
   * addition to plain "X.Y.Z" SC numbers.
   *
   * @param {*} criterion — raw criterion value from the LLM response
   * @returns {string|null} normalized "X.Y.Z" criterion, or null if missing/unparseable
   */
  _normalizeCriterion(criterion) {
    if (typeof criterion !== 'string' || !criterion.trim()) return null;
    const parts = criterion.trim().split('.');
    // EN 301 549 nests WCAG success criteria under its own clause 9
    // (e.g. "9.1.4.10"). Strip that leading "9." so it lines up with the
    // bare WCAG SC number ("1.4.10") the scanner's wcagCriteria list uses.
    if (parts.length === 4 && parts[0] === '9') {
      return parts.slice(1).join('.');
    }
    return parts.join('.');
  }

  /**
   * Convert LLM violation objects to standard scanner violations.
   *
   * Filters out any violation whose `criterion` is not one this scanner is
   * responsible for (`this.wcagCriteria`). The system prompt already asks
   * the LLM to restrict itself to the requested criteria, but nothing
   * previously enforced it — off-list violations are dropped here (and
   * logged) rather than silently passed through, so prompt drift is
   * observable instead of just polluting reports.
   *
   * @param {Object[]} llmViolations — from LLM response
   * @returns {Object[]} Standard violation format, off-criterion entries removed
   */
  convertViolations(llmViolations) {
    if (!Array.isArray(llmViolations)) return [];

    const allowed = new Set(this.wcagCriteria || []);
    const converted = [];

    for (const v of llmViolations) {
      const normalized = this._normalizeCriterion(v.criterion);

      if (!normalized || !allowed.has(normalized)) {
        this.droppedViolationCount++;
        log.warn(
          `${this.id}: dropping off-list violation for criterion "${v.criterion ?? 'undefined'}" ` +
            `(scanner covers: ${this.wcagCriteria.join(', ') || 'none'})`
        );
        continue;
      }

      converted.push(
        this.formatViolation(
          normalized,
          v.impact || 'moderate',
          v.description || 'LLM-detected accessibility issue',
          v.selector ? [{ selector: v.selector }] : [],
          v.helpUrl || ''
        )
      );
    }

    return converted;
  }
}

module.exports = LLMBaseScanner;
