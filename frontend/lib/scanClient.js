/**
 * Client for the audit API.
 *
 * Async job contract (current backend):
 *   POST /api/scan             -> 202 { jobId }
 *   GET  /api/scan/job/:jobId  -> { status: queued|running|done|error, queuePosition?, result?, error? }
 *   GET  /api/health           -> { status, scanners, uptime }
 *
 * Authentication is optional: when the operator configures a token the requests
 * must carry `Authorization: Bearer <token>`.
 */

export const TOKEN_STORAGE_KEY = 'a11y-audit-api-token';

export class ApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }

  /** Network hiccups and 5xx are worth retrying while polling; 4xx are not. */
  get isTransient() {
    if (this.status === null) return true;
    if (this.status >= 500) return true;
    return this.status === 408 || this.status === 429;
  }
}

export function loadToken() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveToken(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode / disabled): token stays in memory */
  }
}

async function request(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new ApiError(
      'The scan server is not reachable. Please check your connection and start the scan again.',
      null
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('Access token required or invalid.', response.status);
    }
    const message =
      payload?.error ||
      payload?.message ||
      `The server rejected the request (HTTP ${response.status}). Please try again later.`;
    throw new ApiError(String(message), response.status);
  }

  return { status: response.status, payload };
}

/**
 * Queue a scan.
 * @returns {Promise<{ jobId: string|null, result: object|null }>}
 *   `result` is only set when talking to a legacy synchronous server, which
 *   answers 200 with the finished scan result instead of 202 + a job id.
 */
export async function startScan({ url, profile, token, signal } = {}) {
  const { status, payload } = await request('/api/scan', {
    method: 'POST',
    body: { url, profile },
    token,
    signal,
  });

  const jobId = payload?.jobId || payload?.id || null;
  if (jobId) return { jobId: String(jobId), result: null };

  if (payload && (payload.violations || payload.accessibilityScore !== undefined)) {
    return { jobId: null, result: payload };
  }

  throw new ApiError(
    `The server accepted the request (HTTP ${status}) but returned no job id. Please start the scan again.`,
    status
  );
}

/** @returns {Promise<{status: string, queuePosition?: number, result?: object, error?: string}>} */
export async function fetchJob(jobId, { token, signal } = {}) {
  const { payload } = await request(
    `/api/scan/job/${encodeURIComponent(jobId)}`,
    { token, signal }
  );
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(
      'The server status response was empty or malformed. Please start the scan again.',
      null
    );
  }
  return payload;
}

/**
 * Fetch the generated report as HTML.
 *
 * Needed when a token is configured: /reports/* and /api/report/:id are behind
 * the same bearer auth as the rest of the API, and a plain <a href> cannot send
 * an Authorization header. The caller turns the HTML into a blob URL.
 */
export async function fetchReportHtml(reportUrl, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(reportUrl, { headers });
  } catch {
    throw new ApiError(
      'The generated report could not be loaded. Please try again.',
      null
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      'Access token required or invalid. The report could not be loaded.',
      response.status
    );
  }
  if (!response.ok) {
    throw new ApiError(
      `The report could not be loaded (HTTP ${response.status}). Please generate it again.`,
      response.status
    );
  }
  return response.text();
}

/** Renders a scan result into the printable HTML report and returns its URL. */
export async function createReport(scanResult, { token } = {}) {
  const { payload } = await request('/api/report', {
    method: 'POST',
    body: { scanResult },
    token,
  });
  const reportUrl = payload?.reportUrl;
  if (!reportUrl) {
    throw new ApiError(
      'The server returned no address for the report. Please generate the report again.',
      null
    );
  }
  return String(reportUrl);
}

/**
 * Server health, including the number of registered scanners.
 * Unauthenticated: /api/health is exempt from the bearer guard.
 * @returns {Promise<{status: string, scanners?: number, uptime?: number}>}
 */
export async function fetchHealth({ signal } = {}) {
  const { payload } = await request('/api/health', { signal });
  return payload && typeof payload === 'object' ? payload : {};
}
