import { useState, useRef, useEffect, useCallback } from 'react';
import Head from 'next/head';

export default function Home() {
  const [url, setUrl] = useState('');
  const [profile, setProfile] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  const startTimer = useCallback(() => {
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const formatElapsed = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const validateUrl = (value) => {
    if (!value.trim()) return 'Please enter a URL.';
    try {
      const parsed = new URL(value.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) return 'URL must start with http:// or https://';
    } catch {
      return 'Please enter a valid URL (e.g. https://example.com).';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    const validationError = validateUrl(url);
    if (validationError) {
      setError(validationError);
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);
    startTimer();

    try {
      const scanRes = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, profile }),
      });

      if (!scanRes.ok) {
        const body = await scanRes.json().catch(() => null);
        throw new Error(body?.error || `Scan failed (HTTP ${scanRes.status})`);
      }

      const scanResult = await scanRes.json();

      const reportRes = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanResult }),
      });

      if (!reportRes.ok) {
        const body = await reportRes.json().catch(() => null);
        throw new Error(body?.error || `Report generation failed (HTTP ${reportRes.status})`);
      }

      const { reportUrl } = await reportRes.json();
      if (!reportUrl) {
        throw new Error('No report URL returned from server');
      }

      window.location.href = reportUrl;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      stopTimer();
      // Focus back to input so screen reader users land on the relevant field
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <>
      <Head>
        <title>Web Accessibility Audit Service — Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.</title>
        <meta name="description" content="Automated WCAG 2.2 conformance assessment — A, AA, and AAA levels with LLM-powered semantic analysis" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="page" lang="en">
        <a href="#main-content" className="skip-link">Skip to main content</a>

        <header className="letterhead">
          <nav className="letterhead-inner" aria-label="Service">
            <h1 className="org-name">
              <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
                Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.
              </a>
            </h1>
            <div className="service-title">Web Accessibility Audit Service</div>
          </nav>
        </header>

        <main className="main" id="main-content">
          <div className="content">
            <form className="audit-form" onSubmit={handleSubmit} noValidate>
              <h2>Request Accessibility Audit</h2>
              <div className="field">
                <label htmlFor="url">
                  Target URL <span className="required-indicator" aria-hidden="true">*</span>
                  <span className="sr-only">(required)</span>
                </label>
                <input
                  ref={inputRef}
                  type="url"
                  id="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); if (error) setError(null); }}
                  placeholder="https://example.com"
                  aria-required="true"
                  aria-invalid={error ? 'true' : 'false'}
                  aria-describedby="url-error"
                  autoComplete="url"
                  disabled={loading}
                />
              </div>
              <div className="field">
                <label htmlFor="profile">Scan Profile</label>
                <div className="profile-options" role="radiogroup" aria-labelledby="profile-label">
                  <label className={`profile-option${profile === 'fast' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="profile"
                      value="fast"
                      checked={profile === 'fast'}
                      onChange={(e) => setProfile(e.target.value)}
                      disabled={loading}
                    />
                    <span className="profile-label">Fast</span>
                    <span className="profile-desc">WCAG 2.2 AA — core checks, ~30s</span>
                  </label>
                  <label className={`profile-option${profile === 'standard' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="profile"
                      value="standard"
                      checked={profile === 'standard'}
                      onChange={(e) => setProfile(e.target.value)}
                      disabled={loading}
                    />
                    <span className="profile-label">Standard</span>
                    <span className="profile-desc">WCAG 2.2 AA — full audit, ~1–2 min</span>
                  </label>
                  <label className={`profile-option${profile === 'full' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="profile"
                      value="full"
                      checked={profile === 'full'}
                      onChange={(e) => setProfile(e.target.value)}
                      disabled={loading}
                    />
                    <span className="profile-label">Full + AAA</span>
                    <span className="profile-desc">WCAG 2.2 A+AA+AAA — LLM-powered semantic analysis, ~2–4 min</span>
                  </label>
                </div>
              </div>
              <button type="submit" className="submit-btn" disabled={loading || !url.trim()}>
                Start Audit
              </button>

              <p className="error-text" id="url-error" role="alert" aria-live="assertive">
                {error ? <><strong>Error:</strong> {error}</> : ''}
              </p>
            </form>

            {/* Persistent live region for status announcements */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {loading ? `Accessibility audit in progress. ${formatElapsed(elapsed)} elapsed.` : ''}
            </div>

            {loading && (
              <div className="loading-state" aria-hidden="true">
                <div className="spinner" />
                <span className="loading-text">Accessibility audit in progress</span>
                <span className="elapsed">{formatElapsed(elapsed)}</span>
              </div>
            )}
          </div>
        </main>

        <footer className="footer">
          <p>Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V. — {new Date().getFullYear()}</p>
          <p><a href="/">Startseite</a> · <a href="/accessibility">Accessibility</a></p>
        </footer>
      </div>
    </>
  );
}
