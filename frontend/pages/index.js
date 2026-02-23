import { useState, useRef, useEffect, useCallback } from 'react';
import Head from 'next/head';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    startTimer();

    try {
      const scanRes = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, profile: 'standard' }),
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
    }
  };

  return (
    <>
      <Head>
        <title>Barrierefreiheitsprüfung — Zentrum für Nachhaltige Algorithmik e.V.</title>
        <meta name="description" content="Automated WCAG 2.1 Level AA conformance assessment" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="page">
        <header className="letterhead">
          <div className="letterhead-inner">
            <div className="org-name">Zentrum für Nachhaltige Algorithmik e.V.</div>
            <div className="service-title">Web Accessibility Audit Service</div>
          </div>
        </header>

        <main className="main">
          <div className="content">
            {!loading ? (
              <form className="audit-form" onSubmit={handleSubmit}>
                <h2>Request Accessibility Audit</h2>
                <div className="field">
                  <label htmlFor="url">Target URL</label>
                  <input
                    type="url"
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    required
                    autoComplete="url"
                    disabled={loading}
                  />
                </div>
                <button type="submit" className="submit-btn" disabled={!url.trim()}>
                  Start Audit
                </button>

                {error && (
                  <p className="error-text">
                    <strong>Error:</strong> {error}
                  </p>
                )}
              </form>
            ) : (
              <div className="loading-state">
                <div className="spinner" role="status" aria-label="Scanning" />
                <span className="loading-text">Accessibility audit in progress</span>
                <span className="elapsed">{formatElapsed(elapsed)}</span>
              </div>
            )}
          </div>
        </main>

        <footer className="footer">
          <p>Zentrum für Nachhaltige Algorithmik e.V. — {new Date().getFullYear()}</p>
        </footer>
      </div>
    </>
  );
}
