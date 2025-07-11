import { useState } from 'react';
import Head from 'next/head';
import ScanForm from '../components/ScanForm';
import ReportDisplay from '../components/ReportDisplay';

export default function Home() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleScan = async (url, options) => {
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const endpoint = options.scanType === 'screen-reader' 
        ? '/api/screen-reader-scan'
        : options.scanType === 'basic'
        ? '/api/scan'
        : '/api/enhanced-scan';

      const body = options.scanType === 'screen-reader' 
        ? { url }
        : { url, options };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setReport(data);
    } catch (err) {
      setError('Failed to scan the website. Please check the URL and try again.');
      console.error('Scan error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Web Accessibility Checker</title>
        <meta name="description" content="Professional web accessibility scanning tool with WCAG compliance checking" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header className="header">
        <div className="container">
          <h1>Web Accessibility Checker</h1>
          <p>Professional accessibility scanning with WCAG compliance and screen reader support</p>
        </div>
      </header>

      <main className="container">
        <ScanForm onScan={handleScan} loading={loading} />
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {loading && (
          <div className="loading">
            <div className="spinner"></div>
            <span>Scanning website for accessibility issues...</span>
          </div>
        )}

        {report && <ReportDisplay report={report} />}
      </main>
    </>
  );
}