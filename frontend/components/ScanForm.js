import { useState } from 'react';

export default function ScanForm({ onScan, loading }) {
  const [url, setUrl] = useState('');
  const [options, setOptions] = useState({
    wcagLevel: 'AA',
    includeWarnings: true,
    testKeyboardNav: false,
    timeout: 30000,
    scanType: 'enhanced'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (url.trim()) {
      onScan(url.trim(), options);
    }
  };

  const handleOptionChange = (key, value) => {
    setOptions(prev => ({
      ...prev,
      [key]: value
    }));
  };

  return (
    <form className="scan-form" onSubmit={handleSubmit}>
      <h2>Analyze Website Accessibility</h2>
      
      <div className="form-group">
        <label htmlFor="url">
          Website URL <span aria-label="required">*</span>
        </label>
        <input
          type="url"
          id="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          required
          aria-describedby="url-help"
        />
        <small id="url-help">Enter the full URL including https://</small>
      </div>

      <fieldset>
        <legend>Scan Options</legend>
        
        <div className="options-grid">
          <div className="form-group">
            <label htmlFor="scan-type">Analysis Type</label>
            <select
              id="scan-type"
              value={options.scanType}
              onChange={(e) => handleOptionChange('scanType', e.target.value)}
            >
              <option value="basic">Basic Scan</option>
              <option value="enhanced">Enhanced + WCAG</option>
              <option value="screen-reader">Screen Reader Focus</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="wcag-level">WCAG Compliance Level</label>
            <select
              id="wcag-level"
              value={options.wcagLevel}
              onChange={(e) => handleOptionChange('wcagLevel', e.target.value)}
              disabled={options.scanType === 'screen-reader'}
            >
              <option value="A">Level A</option>
              <option value="AA">Level AA</option>
              <option value="AAA">Level AAA</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="timeout">Timeout (seconds)</label>
            <select
              id="timeout"
              value={options.timeout}
              onChange={(e) => handleOptionChange('timeout', parseInt(e.target.value))}
            >
              <option value="15000">15 seconds</option>
              <option value="30000">30 seconds</option>
              <option value="60000">60 seconds</option>
            </select>
          </div>
        </div>

        <div className="options-grid">
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="include-warnings"
              checked={options.includeWarnings}
              onChange={(e) => handleOptionChange('includeWarnings', e.target.checked)}
              disabled={options.scanType === 'screen-reader'}
            />
            <label htmlFor="include-warnings">Include warnings and incomplete tests</label>
          </div>

          <div className="checkbox-group">
            <input
              type="checkbox"
              id="test-keyboard-nav"
              checked={options.testKeyboardNav}
              onChange={(e) => handleOptionChange('testKeyboardNav', e.target.checked)}
              disabled={options.scanType === 'screen-reader'}
            />
            <label htmlFor="test-keyboard-nav">Test keyboard navigation</label>
          </div>
        </div>
      </fieldset>

      <button type="submit" className="btn" disabled={loading || !url.trim()}>
        {loading ? 'Scanning...' : 'Analyze Accessibility'}
      </button>
    </form>
  );
}