import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLLMClient as LLMClient } from '../../src/agent/llm-chat.js';

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function chatBody({ content = null, toolCalls, usage } = {}) {
  return {
    model: 'google/gemini-3.7-flash',
    choices: [
      { message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } },
    ],
    usage: usage || { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

let client;

beforeEach(() => {
  global.fetch = vi.fn();
  client = new LLMClient({ apiKey: 'test-key', maxRetries: 2 });
  client._sleep = vi.fn(async () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LLMClient.chat', () => {
  it('sends OpenAI-compatible tool definitions and parses tool_calls', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(
        chatBody({
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'jumpTo', arguments: '{"index": 4}' },
            },
          ],
        })
      )
    );

    const tools = [
      {
        type: 'function',
        function: {
          name: 'jumpTo',
          description: 'jump',
          parameters: { type: 'object', properties: { index: { type: 'integer' } } },
        },
      },
    ];
    const res = await client.chat([{ role: 'user', content: 'go' }], {
      tools,
      toolChoice: 'required',
      systemPrompt: 'you are blind',
      maxTokens: 512,
    });

    expect(res.success).toBe(true);
    expect(res.toolCalls).toEqual([
      { id: 'call_1', name: 'jumpTo', arguments: { index: 4 }, argumentsRaw: '{"index": 4}' },
    ]);
    expect(res.usage.promptTokens).toBe(11);
    expect(res.usage.completionTokens).toBe(7);
    expect(res.model).toBe('google/gemini-3.7-flash');

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.tools).toEqual(tools);
    expect(sent.tool_choice).toBe('required');
    expect(sent.max_tokens).toBe(512);
    expect(sent.temperature).toBe(0);
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'you are blind' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'go' });
    // fallback chain preserved
    expect(sent.models[0]).toBe(client.model);
    // auth headers reused
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');
  });

  it('honours a per-call model override in both model and models', async () => {
    global.fetch.mockResolvedValue(jsonResponse(chatBody({ content: 'hi' })));
    const res = await client.chat([{ role: 'user', content: 'x' }], { model: 'anthropic/other' });
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe('anthropic/other');
    expect(sent.models[0]).toBe('anthropic/other');
    expect(res.success).toBe(true);
  });

  it('tolerates malformed JSON arguments: arguments null + argumentsRaw kept', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(
        chatBody({
          toolCalls: [
            { id: 'c', type: 'function', function: { name: 'type', arguments: '{"text": ' } },
          ],
        })
      )
    );
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(res.toolCalls[0].arguments).toBeNull();
    expect(res.toolCalls[0].argumentsRaw).toBe('{"text": ');
  });

  it('treats an empty argument string as no arguments', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(
        chatBody({
          toolCalls: [{ id: 'c', type: 'function', function: { name: 'next', arguments: '' } }],
        })
      )
    );
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(res.toolCalls[0].arguments).toEqual({});
  });

  it('returns multiple tool calls unfiltered', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(
        chatBody({
          toolCalls: [
            { id: 'a', function: { name: 'next', arguments: '{}' } },
            { id: 'b', function: { name: 'prev', arguments: '{}' } },
          ],
        })
      )
    );
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(res.toolCalls.map((t) => t.name)).toEqual(['next', 'prev']);
  });

  it('does NOT fail on a null content when there are tool calls', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(
        chatBody({
          content: null,
          toolCalls: [{ id: 'a', function: { name: 'next', arguments: '{}' } }],
        })
      )
    );
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(res.success).toBe(true);
    expect(res.message.content).toBeNull();
  });

  it('returns toolCalls: [] for a plain text answer', async () => {
    global.fetch.mockResolvedValue(jsonResponse(chatBody({ content: 'just talking' })));
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(res.toolCalls).toEqual([]);
    expect(res.message.content).toBe('just talking');
  });

  it('reuses the retry policy: retries 500 then succeeds', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse(chatBody({ content: 'ok' })));
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(res.success).toBe(true);
  });

  it('reuses the terminal-error policy: 402 is not retried', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ error: 'no credits' }, 402));
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.terminal).toBe(true);
  });

  it('fails with success:false when choices are empty', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ choices: [] }));
    const res = await client.chat([{ role: 'user', content: 'x' }], {});
    expect(res.success).toBe(false);
    expect(res.type).toBe('empty_response');
  });

  it('rejects a non-array messages argument without an HTTP call', async () => {
    const res = await client.chat('not an array', {});
    expect(res.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('leaves predict() untouched', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        model: 'm',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      })
    );
    const res = await client.predict('hi', { systemPrompt: 's' });
    expect(res).toEqual({
      success: true,
      content: 'hello',
      model: 'm',
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 0,
        cost: null,
        cachedPromptTokens: 0,
        reasoningTokens: 0,
      },
    });
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.max_tokens).toBe(8192);
    expect(sent.tools).toBeUndefined();
  });
});
