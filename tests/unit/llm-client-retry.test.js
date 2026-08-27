import { describe, it, expect, vi } from 'vitest';
import { LLMClient } from '../../src/llm-client.js';

function clientWithStatuses(statuses) {
  const client = new LLMClient({ apiKey: 'test-key', maxRetries: 5 });
  client._sleep = vi.fn(async () => {});
  let calls = 0;
  client._sendRequest = vi.fn(async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls++;
    if (status === 200) return { success: true, content: 'ok', model: 'm', usage: {} };
    const e = new Error(`HTTP ${status}`);
    e.statusCode = status;
    e.type = status === 429 ? 'rate_limit' : status >= 500 ? 'server_error' : 'client_error';
    throw e;
  });
  return client;
}

describe('LLMClient retry policy', () => {
  it('treats 402 (insufficient credits) as terminal: exactly one attempt', async () => {
    const c = clientWithStatuses([402]);
    const res = await c._retryWithBackoff(() => c._sendRequest({}));
    expect(c._sendRequest).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.terminal).toBe(true);
    expect(res.statusCode).toBe(402);
    expect(c._sleep).not.toHaveBeenCalled();
  });

  it('treats 401 / 400 / 404 as terminal too', async () => {
    for (const status of [400, 401, 403, 404]) {
      const c = clientWithStatuses([status]);
      await c._retryWithBackoff(() => c._sendRequest({}));
      expect(c._sendRequest).toHaveBeenCalledTimes(1);
    }
  });

  it('still retries 500 and succeeds on a later attempt', async () => {
    const c = clientWithStatuses([500, 500, 200]);
    const res = await c._retryWithBackoff(() => c._sendRequest({}));
    expect(c._sendRequest).toHaveBeenCalledTimes(3);
    expect(res.success).toBe(true);
  });

  it('still retries 429 and 408', async () => {
    for (const status of [429, 408]) {
      const c = clientWithStatuses([status, 200]);
      const res = await c._retryWithBackoff(() => c._sendRequest({}));
      expect(c._sendRequest).toHaveBeenCalledTimes(2);
      expect(res.success).toBe(true);
    }
  });

  it('exhausts maxRetries on persistent 500', async () => {
    const c = clientWithStatuses([500]);
    const res = await c._retryWithBackoff(() => c._sendRequest({}));
    expect(c._sendRequest).toHaveBeenCalledTimes(5);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Retry attempts exceeded/);
  });
});
