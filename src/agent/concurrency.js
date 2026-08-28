/**
 * A tiny order-preserving worker pool. The per-task pipelines of the generator
 * and the harness are independent (each runs in its own isolated browser
 * context), but they are dominated by network- and LLM-latency, so running a
 * few of them at once is what makes a real-site measurement bearable.
 * Concurrency is capped: OpenRouter rate-limits, and every slot costs a browser
 * context.
 */

'use strict';

const DEFAULT_CONCURRENCY = 3;

/** Clamp a user-supplied concurrency to a positive integer. */
function normaliseConcurrency(value, fallback = DEFAULT_CONCURRENCY) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight.
 * Results are returned in the order of `items`, never in completion order, so
 * the output is identical to the sequential loop it replaces.
 *
 * `fn` must not reject: a rejection aborts the whole batch (callers in this
 * package turn failures into result objects instead).
 *
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} fn
 * @returns {Promise<Array>}
 */
async function mapWithConcurrency(items, limit, fn) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  if (list.length === 0) return results;

  const slots = Math.min(normaliseConcurrency(limit), list.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      results[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: slots }, () => worker()));
  return results;
}

module.exports = { DEFAULT_CONCURRENCY, mapWithConcurrency, normaliseConcurrency };
