/**
 * Scan history in localStorage.
 *
 * Keeps the last MAX_ENTRIES scans (url, date, score, jobId) and stores the
 * full result alongside the newest MAX_STORED_RESULTS entries so a history
 * item can be re-opened without another scan. Payloads are trimmed and the
 * writer degrades gracefully when the storage quota is exceeded.
 */

export const HISTORY_STORAGE_KEY = 'a11y-audit-history-v1';
export const MAX_ENTRIES = 20;

const MAX_STORED_RESULTS = 8;
const MAX_STORED_VIOLATIONS = 250;

function readRaw() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadHistory() {
  return readRaw()
    .filter((entry) => entry && typeof entry.url === 'string')
    .slice(0, MAX_ENTRIES);
}

/** Drop oversized parts of a result so a single scan cannot fill the quota. */
export function trimResult(result) {
  if (!result || typeof result !== 'object') return null;
  const violations = Array.isArray(result.violations) ? result.violations : [];
  const kept = violations.slice(0, MAX_STORED_VIOLATIONS);
  return {
    ...result,
    violations: kept,
    omittedViolations: violations.length - kept.length,
  };
}

function persist(entries) {
  if (typeof window === 'undefined') return entries;

  // Progressive fallback: full payloads -> fewer payloads -> metadata only.
  const keepCounts = [MAX_STORED_RESULTS, 4, 2, 1, 0];

  for (const keep of keepCounts) {
    const candidate = entries.map((entry, index) =>
      index < keep ? entry : { ...entry, result: null }
    );
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(candidate));
      return candidate;
    } catch {
      /* try the next, smaller candidate */
    }
  }

  // Last resort: keep only the five most recent entries without results.
  const minimal = entries.slice(0, 5).map((entry) => ({ ...entry, result: null }));
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(minimal));
    return minimal;
  } catch {
    return entries;
  }
}

/**
 * Prepend an entry (de-duplicated by jobId) and persist.
 * @returns {Array} the history as it was actually stored
 */
export function addHistoryEntry(entry) {
  const normalized = {
    jobId: entry.jobId || null,
    url: entry.url,
    profile: entry.profile || '',
    date: entry.date || new Date().toISOString(),
    score: typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null,
    violationCount: typeof entry.violationCount === 'number' ? entry.violationCount : null,
    result: trimResult(entry.result),
  };

  const existing = loadHistory().filter(
    (item) => !(normalized.jobId && item.jobId === normalized.jobId)
  );
  return persist([normalized, ...existing].slice(0, MAX_ENTRIES));
}

export function clearHistory() {
  if (typeof window === 'undefined') return [];
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    /* nothing we can do */
  }
  return [];
}

/** Stable key for React lists; jobId is optional on legacy responses. */
export function entryKey(entry, index) {
  return entry.jobId || `${entry.url}-${entry.date}-${index}`;
}
