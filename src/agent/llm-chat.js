/**
 * AgentLLMClient: LLMClient plus OpenAI-compatible tool calling over OpenRouter.
 * Kept in the agent package so the shared client stays untouched; `predict()` is inherited.
 * Every chat request asks OpenRouter for `usage.cost` so callers can attribute cost per call.
 */

const { LLMClient } = require('../llm/client');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

class AgentLLMClient extends LLMClient {
  /**
   * @param {Array<{role: string, content: any}>} messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools] - OpenAI-shape function tools
   * @param {string|object} [options.toolChoice] - 'auto' | 'required' | 'none' | {type:'function',...}
   * @param {number} [options.temperature] - default 0
   * @param {number} [options.maxTokens] - default 8192 (same as predict)
   * @param {string} [options.systemPrompt] - prepended as a system message
   * @param {string} [options.model] - per-call model override
   * @returns {Promise<{success: true, message: object, toolCalls: Array<{id: string, name: string, arguments: object|null, argumentsRaw: string}>, usage: object, model: string} | {success: false, error: string, type: string, terminal?: boolean}>}
   */
  async chat(messages, options = {}) {
    if (!Array.isArray(messages)) {
      return { success: false, error: 'messages must be an array', type: 'invalid_request' };
    }
    const { tools, toolChoice, temperature = 0, maxTokens = 8192, systemPrompt, model } = options;

    const useModel = model || this.model;
    const body = {
      model: useModel,
      messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
      temperature,
      max_tokens: maxTokens,
      usage: { include: true },
    };
    if (tools && tools.length) body.tools = tools;
    if (toolChoice !== undefined) body.tool_choice = toolChoice;
    if (this.fallbackModels && this.fallbackModels.length > 0) {
      body.models = [useModel, ...this.fallbackModels.filter((m) => m !== useModel)];
    }

    return this._retryWithBackoff(() => this._sendChatRequest(body));
  }

  /** Single HTTP attempt; mirrors LLMClient._sendRequest but allows content: null. */
  async _sendChatRequest(body) {
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

    if (response.status === 429) {
      const e = new Error('Rate limit exceeded (429)');
      e.type = 'rate_limit';
      e.retryAfterMs = this._parseRetryAfter(response);
      throw e;
    }
    if (response.status >= 500) {
      const text = await response.text().catch(() => '');
      const e = new Error(`Server error ${response.status}: ${text.slice(0, 200)}`);
      e.type = 'server_error';
      e.statusCode = response.status;
      throw e;
    }
    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      const e = new Error(`Client error ${response.status}: ${text.slice(0, 200)}`);
      e.type = 'client_error';
      e.statusCode = response.status;
      throw e;
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
      const e = new Error('Empty response: no choices returned');
      e.type = 'empty_response';
      throw e;
    }

    const message = data.choices[0].message || {};
    const toolCalls = (message.tool_calls || []).map((tc) => {
      const raw = (tc.function && tc.function.arguments) ?? '';
      return {
        id: tc.id,
        name: tc.function && tc.function.name,
        arguments: parseArguments(raw),
        argumentsRaw: raw,
      };
    });

    const u = data.usage || {};
    const usage = {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
      cost: typeof u.cost === 'number' ? u.cost : null, // USD, from OpenRouter
      cachedPromptTokens:
        u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? u.cache_read_input_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };

    return {
      success: true,
      message: {
        role: message.role || 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      },
      toolCalls,
      usage,
      model: data.model || body.model,
    };
  }
}

/** '' gives {}, a valid JSON object gives that object, anything else gives null. */
function parseArguments(raw) {
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? raw : null;
  if (raw.trim() === '') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

module.exports = { AgentLLMClient, parseArguments };
