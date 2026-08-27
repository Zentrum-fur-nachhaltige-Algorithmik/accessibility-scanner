import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';

import ConformitySeal from '../components/ConformitySeal';
import ScanHistoryList from '../components/ScanHistoryList';
import ScanResults from '../components/ScanResults';
import { APP_NAME } from '../lib/branding';
import {
  ApiError,
  createReport,
  fetchHealth,
  fetchJob,
  fetchReportHtml,
  loadToken,
  saveToken,
  startScan,
} from '../lib/scanClient';
import { addHistoryEntry, clearHistory, loadHistory } from '../lib/scanHistory';
import { NOT_AVAILABLE, formatDate, formatElapsed } from '../lib/violations';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_FAILURES = 3;

const PROFILES = [
  {
    id: 'fast',
    label: 'Quick scan',
    description: 'WCAG 2.2 AA, core checks, about 30 seconds',
  },
  {
    id: 'standard',
    label: 'Standard scan',
    description: 'WCAG 2.2 AA, full check, 1 to 2 minutes',
  },
  {
    id: 'full',
    label: 'Full scan',
    description: 'WCAG 2.2 A, AA and AAA with semantic analysis, 2 to 4 minutes',
  },
];

const BUSY_PHASES = ['submitting', 'queued', 'running'];

function profileLabel(id) {
  return PROFILES.find((profile) => profile.id === id)?.label || id || '';
}

function validateUrl(value) {
  if (!value) return 'Please enter the address of the page to scan.';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'Please enter a valid address, for example https://example.com.';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'The address must start with http:// or https://.';
  }
  return null;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [profile, setProfile] = useState('standard');

  const [token, setToken] = useState('');
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const [fieldError, setFieldError] = useState(null);
  const [apiError, setApiError] = useState(null);

  const [phase, setPhase] = useState('idle');
  const [activeScan, setActiveScan] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [nowTs, setNowTs] = useState(0);

  const [result, setResult] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);
  const [reportPending, setReportPending] = useState(false);
  const [reportLink, setReportLink] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyNotice, setHistoryNotice] = useState('');

  // Number of registered scanners as reported by /api/health.
  const [registeredModules, setRegisteredModules] = useState(null);

  const [pendingFocus, setPendingFocus] = useState(null);
  // Set after mount: this page is prerendered, so "today" must not be baked in.
  const [todayIso, setTodayIso] = useState('');

  const urlRef = useRef(null);
  const tokenRef = useRef(null);
  const alertRef = useRef(null);
  const submitRef = useRef(null);
  const resultsHeadingRef = useRef(null);
  const historyHeadingRef = useRef(null);
  const reportLinkRef = useRef(null);
  const blobUrlRef = useRef(null);

  const isBusy = BUSY_PHASES.includes(phase);
  const elapsed = activeScan ? Math.max(0, Math.floor((nowTs - activeScan.startedAt) / 1000)) : 0;

  // Startup: restore token and history from this browser.
  useEffect(() => {
    setToken(loadToken());
    setHistory(loadHistory());
    setTodayIso(new Date().toISOString());
  }, []);

  // Module count from the server; purely informational, so failures are ignored.
  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then((health) => {
        if (!cancelled && Number.isFinite(health?.scanners)) {
          setRegisteredModules(health.scanners);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus management (runs after the DOM has been updated).
  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus === 'url') urlRef.current?.focus();
    else if (pendingFocus === 'token') tokenRef.current?.focus();
    else if (pendingFocus === 'alert') alertRef.current?.focus();
    else if (pendingFocus === 'submit') submitRef.current?.focus();
    else if (pendingFocus === 'results') resultsHeadingRef.current?.focus();
    else if (pendingFocus === 'history') historyHeadingRef.current?.focus();
    else if (pendingFocus === 'report') reportLinkRef.current?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  // Blob URLs for authenticated report downloads must be released again.
  const releaseReportBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => releaseReportBlob, [releaseReportBlob]);

  // Elapsed-time ticker (kept outside the live region).
  useEffect(() => {
    if (!isBusy || !activeScan) return undefined;
    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isBusy, activeScan]);

  const showError = useCallback((error, { clearScan = true } = {}) => {
    const isAuth = error instanceof ApiError && error.isAuthError;
    if (clearScan) {
      setPhase('error');
      setActiveScan(null);
      setQueuePosition(null);
    }
    setApiError({
      message: error?.message || 'An unexpected error occurred.',
      isAuth,
    });
    if (isAuth) setTokenOpen(true);
    setPendingFocus(isAuth ? 'token' : 'alert');
  }, []);

  const finishScan = useCallback((context, scanResult) => {
    const scannedAt = scanResult?.timestamp || new Date().toISOString();
    const score =
      typeof scanResult?.accessibilityScore === 'number' ? scanResult.accessibilityScore : null;
    const violationCount =
      typeof scanResult?.totalViolations === 'number'
        ? scanResult.totalViolations
        : Array.isArray(scanResult?.violations)
          ? scanResult.violations.length
          : null;

    setResult(scanResult);
    setResultMeta({
      url: context.url,
      profile: profileLabel(context.profile),
      jobId: context.jobId || null,
      scannedAt,
      restored: false,
    });
    setPhase('done');
    setActiveScan(null);
    setQueuePosition(null);
    setApiError(null);
    setHistory(
      addHistoryEntry({
        jobId: context.jobId || null,
        url: context.url,
        profile: context.profile,
        date: scannedAt,
        score,
        violationCount,
        result: scanResult,
      })
    );
  }, []);

  const applyJob = useCallback(
    (context, job) => {
      const status = String(job?.status || '').toLowerCase();

      if (status === 'done' || status === 'complete' || status === 'completed') {
        if (job?.result) finishScan(context, job.result);
        else
          showError(
            new ApiError(
              'The scan finished but the server returned no result. Please start the scan again.'
            )
          );
        return;
      }
      if (status === 'error' || status === 'failed') {
        showError(
          new ApiError(
            job?.error ||
              'The scan failed on the server. Please check the address and start the scan again.'
          )
        );
        return;
      }
      if (status === 'running') {
        setPhase('running');
        setQueuePosition(null);
        return;
      }
      if (status === 'queued' || status === 'pending' || status === 'waiting') {
        setPhase('queued');
        const position = Number(job?.queuePosition);
        setQueuePosition(Number.isFinite(position) ? position : null);
      }
      // Unknown status: keep polling rather than guessing.
    },
    [finishScan, showError]
  );

  // Job polling.
  // Depends on the scan context only: phase transitions (queued -> running)
  // must not restart the interval, otherwise every transition costs an extra
  // request. The effect stops when finishScan/showError/stop clears activeScan.
  useEffect(() => {
    const context = activeScan;
    if (!context?.jobId) return undefined;

    let cancelled = false;
    let failures = 0;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const job = await fetchJob(context.jobId, {
          token: context.token,
          signal: controller.signal,
        });
        if (cancelled) return;
        failures = 0;
        applyJob(context, job);
      } catch (error) {
        if (cancelled || error?.name === 'AbortError') return;
        const transient = !(error instanceof ApiError) || error.isTransient;
        failures += 1;
        if (!transient || failures >= MAX_POLL_FAILURES) {
          showError(
            error instanceof ApiError
              ? error
              : new ApiError(
                  'The connection to the scan server was lost. Please start the scan again.'
                )
          );
        }
      }
    };

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    poll();

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [activeScan, applyJob, showError]);

  // Handlers.
  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = url.trim();
    const validation = validateUrl(trimmed);

    setApiError(null);
    if (validation) {
      setFieldError(validation);
      setPendingFocus('url');
      return;
    }
    setFieldError(null);

    const context = {
      jobId: null,
      url: trimmed,
      profile,
      token,
      startedAt: Date.now(),
    };

    setResult(null);
    setResultMeta(null);
    setReportLink(null);
    releaseReportBlob();
    setQueuePosition(null);
    setPhase('submitting');
    setActiveScan(context);

    try {
      const { jobId, result: syncResult } = await startScan({
        url: trimmed,
        profile,
        token,
      });
      // A synchronous server answers with the finished result instead
      // of a job id: render it straight away.
      if (syncResult) {
        finishScan(context, syncResult);
        return;
      }
      setActiveScan({ ...context, jobId });
      setPhase('queued');
    } catch (error) {
      showError(error);
    }
  };

  // This button disappears afterwards, so hand focus to the submit button.
  const handleStopWatching = () => {
    setActiveScan(null);
    setQueuePosition(null);
    setPhase('stopped');
    setPendingFocus('submit');
  };

  const handleTokenChange = (event) => {
    const value = event.target.value;
    setToken(value);
    saveToken(value);
  };

  const handleRemoveToken = () => {
    setToken('');
    saveToken('');
    setPendingFocus('token');
  };

  /**
   * Generate the printable report and reveal a link to it.
   *
   * Without a token the report URL is a plain same-origin link. With a token
   * the report endpoints require an Authorization header that a link cannot
   * send, so the HTML is fetched here and served from a blob URL instead.
   * Either way the user gets a real link (keyboard operable, focus is moved to
   * it) rather than an automatic context change.
   */
  const handleGenerateReport = async () => {
    if (!result) return;
    setReportPending(true);
    setApiError(null);
    setReportLink(null);
    releaseReportBlob();
    try {
      const reportUrl = await createReport(result, { token });
      let href = reportUrl;
      if (token) {
        const html = await fetchReportHtml(reportUrl, { token });
        href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        blobUrlRef.current = href;
      }
      setReportLink({ href, authenticated: Boolean(token) });
      setReportPending(false);
      setPendingFocus('report');
    } catch (error) {
      setReportPending(false);
      showError(error, { clearScan: false });
    }
  };

  const handleOpenHistoryEntry = (entry) => {
    if (!entry?.result) return;
    setReportLink(null);
    releaseReportBlob();
    setResult(entry.result);
    setResultMeta({
      url: entry.url,
      profile: profileLabel(entry.profile),
      jobId: entry.jobId || null,
      scannedAt: entry.date,
      restored: true,
    });
    setPhase('done');
    setApiError(null);
    setHistoryNotice('');
    setPendingFocus('results');
  };

  // The list and this button disappear afterwards: keep focus in the section.
  const handleClearHistory = () => {
    setHistory(clearHistory());
    setHistoryNotice('Scan history cleared.');
    setPendingFocus('history');
  };

  // Status text for the polite live region.
  let statusMessage = '';
  if (phase === 'submitting') {
    statusMessage = 'Submitting the scan request to the server.';
  } else if (phase === 'queued') {
    statusMessage =
      queuePosition === null || queuePosition === undefined
        ? 'Scan in progress: waiting for a free scan slot.'
        : `Scan in progress: position ${queuePosition} in the queue.`;
  } else if (phase === 'running') {
    statusMessage = 'Scan in progress: a full scan usually takes 1 to 4 minutes.';
  } else if (phase === 'stopped') {
    statusMessage = 'Stopped watching. The scan may still be running on the server.';
  } else if (phase === 'done' && result) {
    const findings = result.totalViolations ?? (result.violations || []).length;
    const scoreText = Number.isFinite(Number(result.accessibilityScore))
      ? `Score ${result.accessibilityScore} of 100, `
      : '';
    statusMessage = resultMeta?.restored
      ? `Showing the stored result for ${resultMeta.url}. ${scoreText}${findings} findings.`
      : `Scan complete. ${scoreText}${findings} findings. The result is in section 2.`;
  }

  const reportNumber = resultMeta?.jobId || activeScan?.jobId || null;
  const documentDate = resultMeta?.scannedAt || todayIso;
  const moduleCount = result?.scanners ? Object.keys(result.scanners).length : registeredModules;

  return (
    <>
      <Head>
        <title>{`Accessibility Report | ${APP_NAME}`}</title>
        <meta
          name="description"
          content="Automated conformity assessment against WCAG 2.2 AA and EN 301 549."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="pb-shell">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        <div className="pb-sheet">
          <header className="pb-letterhead">
            <div className="pb-letterhead-body">
              <p className="pb-org">
                <a href="/" className="pb-org-link">
                  {APP_NAME}
                </a>
              </p>
              <p className="pb-office">Automated WCAG 2.2 conformity assessment</p>
              <nav aria-label="Main navigation" className="pb-nav">
                <ul>
                  <li>
                    <a href="/" aria-current="page">
                      Report
                    </a>
                  </li>
                  <li>
                    <a href="/accessibility">Accessibility statement</a>
                  </li>
                </ul>
              </nav>
            </div>
            <ConformitySeal size={56} />
          </header>

          <main className="pb-main" id="main-content" tabIndex={-1}>
            <h1 className="pb-h1">Accessibility Report</h1>

            <table className="pb-meta">
              <caption className="sr-only">Report details</caption>
              <tbody>
                <tr>
                  <th scope="row">Report no.</th>
                  <td className="pb-num">{reportNumber || NOT_AVAILABLE}</td>
                </tr>
                <tr>
                  <th scope="row">Date</th>
                  <td className="pb-num">
                    {documentDate ? (
                      <time dateTime={documentDate}>{formatDate(documentDate)}</time>
                    ) : (
                      NOT_AVAILABLE
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Standard</th>
                  <td>WCAG 2.2 AA · EN 301 549</td>
                </tr>
                <tr>
                  <th scope="row">Method</th>
                  <td>
                    Automated
                    {moduleCount ? ` (${moduleCount} scan modules)` : ''}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Status</th>
                  <td>{result ? 'Complete' : 'Draft'}</td>
                </tr>
              </tbody>
            </table>

            <section className="pb-section" aria-labelledby="subject-heading">
              <h2 className="pb-h2" id="subject-heading">
                <span className="pb-secnum" aria-hidden="true">
                  1
                </span>
                <span className="pb-eyebrow">Section 1</span>
                Subject of the scan
              </h2>

              <form className="pb-form" onSubmit={handleSubmit} noValidate>
                <div className="pb-field">
                  <label htmlFor="url">
                    Address of the page to scan <span aria-hidden="true">*</span>
                    <span className="sr-only">(required)</span>
                  </label>
                  <input
                    ref={urlRef}
                    type="url"
                    id="url"
                    name="url"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      if (fieldError) setFieldError(null);
                    }}
                    placeholder="https://example.com"
                    required
                    aria-required="true"
                    aria-invalid={fieldError ? 'true' : undefined}
                    aria-describedby="url-help"
                    autoComplete="url"
                    inputMode="url"
                  />
                  {/* One description target: hint and error together. */}
                  <div className="pb-field-help" id="url-help">
                    <p className="pb-hint">
                      Full address including https://. The page must be publicly reachable.
                    </p>
                    <p className="error error-text" id="url-error" aria-live="polite">
                      {fieldError}
                    </p>
                  </div>
                </div>

                <fieldset className="pb-fieldset">
                  <legend>Scan profile</legend>
                  <div className="pb-profiles">
                    {PROFILES.map((option) => (
                      // One explicit label per radio, holding the complete
                      // visible text: the accessible name then contains the
                      // visible label (WCAG 2.5.3) and there is exactly one
                      // label association per control.
                      <div
                        key={option.id}
                        className={`pb-profile${profile === option.id ? ' is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          id={`profile-${option.id}`}
                          name="profile"
                          value={option.id}
                          checked={profile === option.id}
                          onChange={() => setProfile(option.id)}
                        />
                        <label className="pb-profile-label" htmlFor={`profile-${option.id}`}>
                          <span className="pb-profile-name">{option.label}</span>
                          <span className="pb-profile-desc">{option.description}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                </fieldset>

                <details
                  className="pb-disclosure"
                  open={tokenOpen}
                  onToggle={(event) => setTokenOpen(event.currentTarget.open)}
                >
                  <summary>API access token (optional)</summary>
                  <div className="pb-disclosure-body">
                    <p className="pb-hint" id="token-hint">
                      Only needed when this server requires authentication. The token is stored in
                      this browser only and sent in the Authorization header with every request.
                    </p>
                    <div className="pb-field">
                      <label htmlFor="api-token">Access token</label>
                      <input
                        ref={tokenRef}
                        id="api-token"
                        name="api-token"
                        type={tokenVisible ? 'text' : 'password'}
                        value={token}
                        onChange={handleTokenChange}
                        aria-describedby="token-hint"
                        autoComplete="current-password"
                        spellCheck="false"
                      />
                    </div>
                    <div className="pb-actions">
                      <button
                        type="button"
                        className="pb-btn"
                        aria-pressed={tokenVisible}
                        onClick={() => setTokenVisible((value) => !value)}
                      >
                        Show token
                      </button>
                      {token && (
                        <button type="button" className="pb-btn" onClick={handleRemoveToken}>
                          Remove stored token
                        </button>
                      )}
                    </div>
                  </div>
                </details>

                <div className="pb-actions">
                  <button
                    type="submit"
                    className="pb-btn pb-btn-primary"
                    disabled={isBusy}
                    ref={submitRef}
                  >
                    Start scan
                  </button>
                  {isBusy && (
                    <button type="button" className="pb-btn" onClick={handleStopWatching}>
                      Stop watching this scan
                    </button>
                  )}
                </div>
              </form>

              {/* Single error surface. Always present so the alert role works. */}
              <div className="pb-alert" role="alert" tabIndex={-1} ref={alertRef}>
                {apiError && (
                  <>
                    <strong>The request failed.</strong> {apiError.message}
                    {apiError.isAuth
                      ? ' Please enter the token under "API access token" and start the scan again.'
                      : ''}
                  </>
                )}
              </div>

              {/* Scan status. The elapsed time sits outside the live region so
                  screen readers are not interrupted every second. */}
              <div className="pb-state">
                <p className="pb-state-line" role="status">
                  {statusMessage}
                </p>
                {isBusy && (
                  <p className="pb-elapsed">
                    <span className="pb-busy" aria-hidden="true" />
                    Elapsed time: <span className="pb-elapsed-value">{formatElapsed(elapsed)}</span>
                  </p>
                )}
              </div>
            </section>

            {phase === 'done' && result ? (
              <ScanResults
                result={result}
                meta={resultMeta}
                headingRef={resultsHeadingRef}
                onGenerateReport={handleGenerateReport}
                reportPending={reportPending}
                reportLink={reportLink}
                reportLinkRef={reportLinkRef}
              />
            ) : (
              <section className="pb-section" aria-labelledby="pending-heading">
                <h2 className="pb-h2" id="pending-heading">
                  <span className="pb-secnum" aria-hidden="true">
                    2
                  </span>
                  <span className="pb-eyebrow">Section 2</span>
                  Assessment result
                </h2>
                <p className="pb-body">No scan result yet. Start a scan in section 1.</p>
                <p className="pb-scope-note">
                  Automated check against WCAG 2.2 AA. It does not replace a full conformity
                  assessment with manual testing.
                </p>
              </section>
            )}

            <ScanHistoryList
              entries={history}
              activeJobId={resultMeta?.jobId || null}
              headingRef={historyHeadingRef}
              onOpen={handleOpenHistoryEntry}
              onClear={handleClearHistory}
            />
            <p className="sr-only" role="status">
              {historyNotice}
            </p>
          </main>

          <footer className="pb-footer">
            <p>{APP_NAME}: automated WCAG 2.2 conformity assessment</p>
            <p>
              <a href="/">Report</a> · <a href="/accessibility">Accessibility statement</a>
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
