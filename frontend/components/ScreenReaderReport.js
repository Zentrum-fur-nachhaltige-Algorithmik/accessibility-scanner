export default function ScreenReaderReport({ report }) {
  if (!report) return null;

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getScoreClass = (score) => {
    if (score >= 90) return 'score-excellent';
    if (score >= 70) return 'score-good';
    if (score >= 50) return 'score-fair';
    return 'score-poor';
  };

  return (
    <div className="report">
      <div className="report-header">
        <div>
          <h2>Screen Reader Accessibility Analysis</h2>
          <p><strong>URL:</strong> {report.url}</p>
          <p><strong>Page Title:</strong> {report.pageTitle}</p>
          <p><strong>Analyzed:</strong> {formatDate(report.timestamp)}</p>
        </div>
        
        {report.euCompliance && (
          <div className="score-display">
            <div className={`score-circle ${getScoreClass(report.euCompliance.en301549.score)}`}>
              {report.euCompliance.en301549.score}/100
            </div>
            <div>EU Compliance Score</div>
          </div>
        )}
      </div>

      {report.error && (
        <div className="error-message">
          <strong>Error:</strong> {report.error}
        </div>
      )}

      <div className="categories-grid">
        <div className="category-card">
          <h3>Heading Structure</h3>
          <div className={`category-score ${report.headingStructure.valid ? 'score-excellent' : 'score-poor'}`}>
            {report.headingStructure.valid ? 'Valid' : 'Issues Found'}
          </div>
          <p>{report.headingStructure.totalHeadings} headings, {report.headingStructure.h1Count} H1s</p>
          {report.headingStructure.issues.length > 0 && (
            <ul>
              {report.headingStructure.issues.slice(0, 3).map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="category-card">
          <h3>Landmarks</h3>
          <div className={`category-score ${report.landmarks.main ? 'score-good' : 'score-poor'}`}>
            {report.landmarks.landmarkCount} Found
          </div>
          <div>
            <small>Main: {report.landmarks.main ? '✓' : '✗'}</small><br/>
            <small>Nav: {report.landmarks.navigation ? '✓' : '✗'}</small><br/>
            <small>Banner: {report.landmarks.banner ? '✓' : '✗'}</small>
          </div>
          {report.landmarks.issues.length > 0 && (
            <ul>
              {report.landmarks.issues.slice(0, 2).map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="category-card">
          <h3>Images</h3>
          <div className={`category-score ${report.images.problematic.length === 0 ? 'score-excellent' : 'score-poor'}`}>
            {report.images.withAlt}/{report.images.total}
          </div>
          <p>Alt text coverage</p>
          {report.images.problematic.length > 0 && (
            <p>{report.images.problematic.length} issues found</p>
          )}
        </div>
        
        <div className="category-card">
          <h3>Forms</h3>
          <div className={`category-score ${report.forms.labelsCorrect ? 'score-excellent' : 'score-poor'}`}>
            {report.forms.labelsCorrect ? 'Labeled' : 'Issues'}
          </div>
          <p>{report.forms.totalInputs} inputs in {report.forms.totalForms} forms</p>
          {report.forms.requiredFields.length > 0 && (
            <p>{report.forms.requiredFields.length} required fields</p>
          )}
        </div>
      </div>

      {report.headingStructure.hierarchy.length > 0 && (
        <div className="heading-hierarchy">
          <h3>Heading Hierarchy</h3>
          <div className="hierarchy-list">
            {report.headingStructure.hierarchy.map((heading, index) => (
              <div key={index} className="heading-item" style={{marginLeft: `${(heading.level - 1) * 20}px`}}>
                <strong>{heading.tagName}:</strong> {heading.text}
                {heading.isEmpty && <span className="error-text"> (Empty)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.images.problematic.length > 0 && (
        <div className="violations-list">
          <h3>Image Issues ({report.images.problematic.length})</h3>
          {report.images.problematic.map((issue, index) => (
            <div key={index} className={`violation-item ${issue.severity}`}>
              <div className="violation-header">
                <h4>Image #{issue.index}</h4>
                <span className={`impact-badge impact-${issue.severity}`}>
                  {issue.severity}
                </span>
              </div>
              <p>{issue.issue}</p>
              <p><strong>Source:</strong> {issue.src}</p>
            </div>
          ))}
        </div>
      )}

      {report.forms.requiredFields.length > 0 && (
        <div className="form-analysis">
          <h3>Form Field Analysis</h3>
          {report.forms.requiredFields.map((field, index) => (
            <div key={index} className="form-field-item">
              <strong>{field.type}</strong> 
              {field.id && ` (${field.id})`}
              {field.required && <span className="required-badge">Required</span>}
              {field.issue && <span className="error-text"> - {field.issue}</span>}
            </div>
          ))}
        </div>
      )}

      {report.ariaUsage && (
        <div className="aria-analysis">
          <h3>ARIA Usage</h3>
          <div className="aria-stats">
            <p><strong>Elements with ARIA:</strong> {report.ariaUsage.totalAriaElements}</p>
            <p><strong>Correct Usage:</strong> {report.ariaUsage.correctUsage}</p>
            {report.ariaUsage.misusedAttributes.length > 0 && (
              <>
                <p><strong>Issues Found:</strong></p>
                <ul>
                  {report.ariaUsage.misusedAttributes.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </>
            )}
            {report.ariaUsage.recommendations.length > 0 && (
              <>
                <p><strong>Recommendations:</strong></p>
                <ul>
                  {report.ariaUsage.recommendations.map((rec, index) => (
                    <li key={index}>{rec}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {report.euCompliance && (
        <div className="eu-compliance">
          <h3>EU Compliance (EN 301 549)</h3>
          <div className="compliance-summary">
            <p><strong>Overall Score:</strong> {report.euCompliance.en301549.score}/100</p>
            <p><strong>Compliant:</strong> {report.euCompliance.en301549.compliant ? 'Yes' : 'No'}</p>
            
            {report.euCompliance.en301549.violations.length > 0 && (
              <>
                <h4>Violations Found:</h4>
                {report.euCompliance.en301549.violations.map((violation, index) => (
                  <div key={index} className={`violation-item ${violation.severity}`}>
                    <div className="violation-header">
                      <h4>Clause {violation.clause}</h4>
                      <span className={`impact-badge impact-${violation.severity}`}>
                        {violation.severity}
                      </span>
                    </div>
                    <p>{violation.description}</p>
                    {violation.details && (
                      <ul>
                        {violation.details.map((detail, i) => (
                          <li key={i}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </>
            )}

            <h4>EAA Compliance Requirements:</h4>
            <p><strong>Ready:</strong> {report.euCompliance.eaaCompliance.ready ? 'Yes' : 'No'}</p>
            {report.euCompliance.eaaCompliance.missingRequirements.length > 0 && (
              <ul>
                {report.euCompliance.eaaCompliance.missingRequirements.map((req, index) => (
                  <li key={index}>{req}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}