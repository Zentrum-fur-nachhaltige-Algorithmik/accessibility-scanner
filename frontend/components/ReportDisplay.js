import ScreenReaderReport from './ScreenReaderReport';

export default function ReportDisplay({ report }) {
  if (!report) return null;

  // Check if this is a screen reader report
  if (report.headingStructure && report.landmarks && report.euCompliance) {
    return <ScreenReaderReport report={report} />;
  }

  const getScoreClass = (score) => {
    if (score >= 90) return 'score-excellent';
    if (score >= 70) return 'score-good';
    if (score >= 50) return 'score-fair';
    return 'score-poor';
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getImpactClass = (impact) => {
    return `impact-${impact}`;
  };

  const getViolationClass = (impact) => {
    return `violation-item ${impact}`;
  };

  return (
    <div className="report">
      <div className="report-header">
        <div>
          <h2>Accessibility Report</h2>
          <p><strong>URL:</strong> {report.url}</p>
          <p><strong>Page Title:</strong> {report.pageTitle}</p>
          <p><strong>Scanned:</strong> {formatDate(report.timestamp)}</p>
          <p><strong>WCAG Level:</strong> {report.scanOptions?.wcagLevel || 'AA'}</p>
        </div>
        
        <div className="score-display">
          <div className={`score-circle ${getScoreClass(report.accessibilityScore)}`}>
            {report.accessibilityScore}/100
          </div>
          <div>Accessibility Score</div>
        </div>
      </div>

      {report.error && (
        <div className="error-message">
          <strong>Error:</strong> {report.error}
        </div>
      )}

      <div className="categories-grid">
        <div className="category-card">
          <h3>Perceivable</h3>
          <div className={`category-score ${getScoreClass(report.categories?.perceivable?.score || 0)}`}>
            {report.categories?.perceivable?.score || 0}%
          </div>
          <p>{report.categories?.perceivable?.violations || 0} violations</p>
        </div>
        
        <div className="category-card">
          <h3>Operable</h3>
          <div className={`category-score ${getScoreClass(report.categories?.operable?.score || 0)}`}>
            {report.categories?.operable?.score || 0}%
          </div>
          <p>{report.categories?.operable?.violations || 0} violations</p>
        </div>
        
        <div className="category-card">
          <h3>Understandable</h3>
          <div className={`category-score ${getScoreClass(report.categories?.understandable?.score || 0)}`}>
            {report.categories?.understandable?.score || 0}%
          </div>
          <p>{report.categories?.understandable?.violations || 0} violations</p>
        </div>
        
        <div className="category-card">
          <h3>Robust</h3>
          <div className={`category-score ${getScoreClass(report.categories?.robust?.score || 0)}`}>
            {report.categories?.robust?.score || 0}%
          </div>
          <p>{report.categories?.robust?.violations || 0} violations</p>
        </div>
      </div>

      {report.keyboardNavigation && (
        <div className="keyboard-nav-section">
          <h3>Keyboard Navigation</h3>
          <div className="options-grid">
            <div>
              <strong>Tabbable Elements:</strong> {report.keyboardNavigation.tabbableElements}
            </div>
            <div>
              <strong>Logical Tab Order:</strong> {report.keyboardNavigation.logicalTabOrder ? 'Yes' : 'No'}
            </div>
            {report.keyboardNavigation.keyboardTraps.length > 0 && (
              <div>
                <strong>Keyboard Traps:</strong> {report.keyboardNavigation.keyboardTraps.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {report.violations && report.violations.length > 0 && (
        <div className="violations-list">
          <h3>Accessibility Violations ({report.violations.length})</h3>
          {report.violations.map((violation, index) => (
            <div key={index} className={getViolationClass(violation.impact)}>
              <div className="violation-header">
                <h4>{violation.id}</h4>
                <span className={`impact-badge ${getImpactClass(violation.impact)}`}>
                  {violation.impact}
                </span>
              </div>
              <p>{violation.description}</p>
              {violation.nodes && violation.nodes.length > 0 && (
                <div>
                  <strong>Affected elements:</strong> {violation.nodes.join(', ')}
                </div>
              )}
              {violation.helpUrl && (
                <div>
                  <a href={violation.helpUrl} target="_blank" rel="noopener noreferrer">
                    Learn more about this issue
                  </a>
                </div>
              )}
              {violation.wcagCriteria && violation.wcagCriteria.length > 0 && (
                <div>
                  <strong>WCAG Criteria:</strong> {violation.wcagCriteria.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {report.wcagCompliance && report.wcagCompliance.criteria && report.wcagCompliance.criteria.length > 0 && (
        <div className="wcag-compliance">
          <h3>WCAG {report.wcagCompliance.level} Compliance Issues</h3>
          <ul>
            {report.wcagCompliance.criteria.map((criterion, index) => (
              <li key={index}>
                <strong>{criterion.criterion}</strong> (Level {criterion.level}) - 
                <span style={{color: criterion.passed ? 'green' : 'red'}}>
                  {criterion.passed ? ' Passed' : ' Failed'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: '2rem', textAlign: 'center' }}>
        <p><strong>Tests Passed:</strong> {report.passes} | <strong>Violations Found:</strong> {report.violations?.length || 0}</p>
      </div>
    </div>
  );
}