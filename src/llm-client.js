/**
 * OpenRouter LLM client - ported from Python openrouter_client.py
 * Zero external dependencies, uses Node 18+ built-in fetch.
 */

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

class LLMClient {
  /**
   * @param {object} options
   * @param {string} [options.apiKey] - OpenRouter API key (falls back to OPENROUTER_API_KEY env)
   * @param {string} [options.model] - Primary model identifier
   * @param {string[]} [options.fallbackModels] - Fallback models for OpenRouter routing
   * @param {string} [options.siteUrl] - HTTP-Referer header for OpenRouter rankings
   * @param {string} [options.appName] - X-Title header for tracking
   * @param {number} [options.maxRetries] - Max retry attempts (default: 5)
   * @param {number} [options.timeoutMs] - Request timeout in ms (default: 30000)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required (pass apiKey option or set env var)');
    }

    this.model = options.model || 'google/gemini-3-flash-preview';
    this.fallbackModels = options.fallbackModels || [];
    this.siteUrl = options.siteUrl || null;
    this.appName = options.appName || 'AccessibilityScanner';
    this.maxRetries = options.maxRetries ?? 5;
    this.timeoutMs = options.timeoutMs ?? 30000;

    // Simple request counter (no complex rate limiter needed in single-threaded Node)
    this._requestCount = 0;
  }

  /**
   * Send a prompt to the LLM and return the result.
   *
   * @param {string} prompt - User prompt
   * @param {object} [options]
   * @param {string} [options.systemPrompt] - System instruction
   * @param {number} [options.temperature] - Sampling temperature (default: 0)
   * @param {boolean} [options.forceJson] - Request JSON response format
   * @returns {Promise<{success: true, content: string, model: string, usage: object} | {success: false, error: string, type: string}>}
   */
  async predict(prompt, options = {}) {
    const {
      systemPrompt = 'You are a helpful assistant.',
      temperature = 0,
      forceJson = false,
    } = options;

    const body = this._buildRequestBody(prompt, systemPrompt, temperature, forceJson);

    const result = await this._retryWithBackoff(() => this._sendRequest(body));
    return result;
  }

  // -- internal ---------------------------------------------------------------

  _buildHeaders() {
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.appName) headers['X-Title'] = this.appName;
    return headers;
  }

  _buildRequestBody(prompt, systemPrompt, temperature, forceJson) {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature,
    };

    if (forceJson) {
      body.response_format = { type: 'json_object' };
    }

    // OpenRouter fallback chain: primary + fallbacks in `models` array
    if (this.fallbackModels.length > 0) {
      body.models = [this.model, ...this.fallbackModels];
    }

    return body;
  }

  /**
   * Single HTTP request attempt. Throws typed errors for retry logic.
   * @returns {{success: true, content: string, model: string, usage: object}}
   */
  async _sendRequest(body) {
    this._requestCount++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error(`Request timed out after ${this.timeoutMs}ms`);
        e.type = 'timeout';
        throw e;
      }
      const e = new Error(`Network error: ${err.message}`);
      e.type = 'network';
      throw e;
    } finally {
      clearTimeout(timer);
    }

    // Rate limit
    if (response.status === 429) {
      const retryAfterMs = this._parseRetryAfter(response);
      const e = new Error(`Rate limit exceeded (429)`);
      e.type = 'rate_limit';
      e.retryAfterMs = retryAfterMs;
      throw e;
    }

    // Server errors (5xx)
    if (response.status >= 500) {
      const text = await response.text().catch(() => '');
      const e = new Error(`Server error ${response.status}: ${text.slice(0, 200)}`);
      e.type = 'server_error';
      e.statusCode = response.status;
      throw e;
    }

    // Client errors (4xx, not 429)
    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      const e = new Error(`Client error ${response.status}: ${text.slice(0, 200)}`);
      e.type = 'client_error';
      e.statusCode = response.status;
      throw e;
    }

    // Parse success response
    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      const e = new Error('Empty response: no choices returned');
      e.type = 'empty_response';
      throw e;
    }

    const content = data.choices[0].message?.content;
    if (content == null) {
      const e = new Error('Empty response: choice has no content');
      e.type = 'empty_response';
      throw e;
    }

    return {
      success: true,
      content,
      model: data.model || this.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        cost: data.usage?.cost ?? null,
      },
    };
  }

  /**
   * Retry with exponential backoff + jitter.
   * Different delay strategies per error type (mirrors Python base_client.py).
   */
  async _retryWithBackoff(operation) {
    let timeoutDelay = 1.0; // seconds, doubles on each timeout

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        const isLastAttempt = attempt === this.maxRetries - 1;
        if (isLastAttempt) {
          return {
            success: false,
            error: `Retry attempts exceeded (${this.maxRetries}): ${err.message}`,
            type: err.type || 'unknown',
          };
        }

        let delayMs;

        switch (err.type) {
          case 'rate_limit':
            // Use Retry-After header or random 50-200ms
            if (err.retryAfterMs) {
              const bufferMs = 100 + Math.floor(Math.random() * 200);
              delayMs = err.retryAfterMs + bufferMs;
            } else {
              delayMs = 50 + Math.floor(Math.random() * 150);
            }
            break;

          case 'timeout':
            delayMs = timeoutDelay * 1000;
            timeoutDelay *= 2; // exponential doubling
            break;

          case 'server_error':
            // 500-1000ms random
            delayMs = 500 + Math.floor(Math.random() * 500);
            break;

          case 'client_error':
            // 1000-2000ms random
            delayMs = 1000 + Math.floor(Math.random() * 1000);
            break;

          default:
            delayMs = 1000;
            break;
        }

        console.warn(
          `[LLMClient] Attempt ${attempt + 1}/${this.maxRetries} failed (${err.type}): ${err.message} | retry in ${delayMs}ms`
        );
        await this._sleep(delayMs);
      }
    }

    // Should not reach here, but defensive
    return { success: false, error: 'Retry loop exited unexpectedly', type: 'unknown' };
  }

  /**
   * Parse Retry-After header. Supports:
   * - Integer seconds: "60"
   * - Seconds with unit: "60s", "1.5s"
   * - OpenRouter X-RateLimit-Reset (ms timestamp)
   * @returns {number|null} wait time in milliseconds
   */
  _parseRetryAfter(response) {
    // Try OpenRouter X-RateLimit-Reset (ms timestamp)
    const resetMs = response.headers.get('x-ratelimit-reset');
    if (resetMs) {
      const resetTimestamp = parseInt(resetMs, 10);
      if (!isNaN(resetTimestamp)) {
        const waitMs = Math.max(0, resetTimestamp - Date.now());
        return waitMs;
      }
    }

    // Standard Retry-After header (seconds)
    const retryAfter = response.headers.get('retry-after');
    if (!retryAfter) return null;

    const match = retryAfter.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
    if (match) {
      return Math.round(parseFloat(match[1]) * 1000);
    }

    return null;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { LLMClient };
