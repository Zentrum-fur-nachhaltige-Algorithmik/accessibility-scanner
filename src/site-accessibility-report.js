const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Site Accessibility Report Generator
 * Generates comprehensive HTML and PDF reports for multi-page accessibility scans
 */
class SiteAccessibilityReport {
  constructor() {
    this.templateDir = path.join(__dirname, '../templates');
  }

  /**
   * Generate comprehensive site accessibility report
   * @param {Object} siteData - Site scan results
   * @param {Object} options - Report generation options
   * @returns {Object} Report generation results
   */
  async generate(siteData, options = {}) {
    return this.generateSiteReport(siteData, options);
  }

  async generateSiteReport(siteData, options = {}) {
    const {
      format = 'html', // 'html', 'pdf', 'both'
      outputDir = path.join(__dirname, '../reports'),
      includeScreenshots = true,
      includeDetailedViolations = true
    } = options;

    console.log(`📄 Generating site accessibility report...`);
    
    try {
      await fs.ensureDir(outputDir);
      
      const reportId = siteData.reportId || `site-report-${Date.now()}`;
      const htmlPath = path.join(outputDir, `${reportId}.html`);
      const pdfPath = path.join(outputDir, `${reportId}.pdf`);
      
      // Generate HTML report
      const htmlContent = await this.generateHtmlReport(siteData, {
        includeScreenshots,
        includeDetailedViolations
      });
      
      await fs.writeFile(htmlPath, htmlContent, 'utf8');
      console.log(`✅ HTML report generated: ${htmlPath}`);
      
      let pdfGenerated = false;
      
      // Generate PDF if requested
      if (format === 'pdf' || format === 'both') {
        try {
          await this.generatePdfFromHtml(htmlPath, pdfPath);
          pdfGenerated = true;
          console.log(`✅ PDF report generated: ${pdfPath}`);
        } catch (error) {
          console.error('PDF generation failed:', error.message);
        }
      }
      
      return {
        success: true,
        reportId,
        htmlPath: format !== 'pdf' ? htmlPath : null,
        pdfPath: pdfGenerated ? pdfPath : null,
        pageCount: siteData.pageResults?.length || 0,
        totalViolations: this.countTotalViolations(siteData)
      };
      
    } catch (error) {
      console.error('Report generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate HTML report content
   * @param {Object} siteData - Site scan data
   * @param {Object} options - Generation options
   * @returns {string} HTML content
   */
  async generateHtmlReport(siteData, options = {}) {
    const template = await this.loadTemplate('site-report.html');
    const styles = await this.loadTemplate('report-styles.css');
    
    // Process data for template
    const processedData = this.processSiteData(siteData);
    
    // Replace template variables (use global replace)
    let html = template
      .replace(/\{\{REPORT_STYLES\}\}/g, styles)
      .replace(/\{\{SITE_URL\}\}/g, siteData.baseUrl)
      .replace(/\{\{SCAN_DATE\}\}/g, new Date(siteData.scanDate).toLocaleString())
      .replace(/\{\{REPORT_ID\}\}/g, siteData.reportId)
      .replace(/\{\{OVERVIEW_DATA\}\}/g, JSON.stringify(processedData.overview))
      .replace(/\{\{CSP_ANALYSIS\}\}/g, this.generateCspAnalysisHtml(siteData.cspAnalysis))
      .replace(/\{\{SITE_TRENDS\}\}/g, this.generateSiteTrendsHtml(siteData.siteWideTrends))
      .replace(/\{\{PAGE_RESULTS\}\}/g, this.generatePageResultsHtml(siteData.pageResults))
      .replace(/\{\{RECOMMENDATIONS\}\}/g, this.generateRecommendationsHtml(siteData.recommendations))
      .replace(/\{\{OPTIMIZATION_REPORT\}\}/g, this.generateOptimizationHtml(siteData.optimization))
      .replace(/\{\{TECHNICAL_METADATA\}\}/g, this.generateMetadataHtml(siteData.metadata));
    
    return html;
  }

  /**
   * Process site data for template consumption
   * @param {Object} siteData - Raw site data
   * @returns {Object} Processed data
   */
  processSiteData(siteData) {
    const overview = siteData.overview || {};
    const pageResults = siteData.pageResults || [];
    
    return {
      overview: {
        ...overview,
        averageAccessibilityScore: this.calculateAverageScore(pageResults),
        totalViolations: this.countTotalViolations(siteData),
        criticalViolations: this.countCriticalViolations(siteData)
      }
    };
  }

  /**
   * Generate CSP analysis HTML section
   * @param {Object} cspAnalysis - CSP analysis data
   * @returns {string} HTML content
   */
  generateCspAnalysisHtml(cspAnalysis) {
    if (!cspAnalysis) return '<p>No CSP analysis available</p>';
    
    const strategies = Object.entries(cspAnalysis.strategyPerformance || {})
      .map(([strategy, stats]) => `
        <div class="strategy-card">
          <h4>${strategy}</h4>
          <div class="strategy-stats">
            <div class="stat">
              <span class="stat-value">${stats.successRate}%</span>
              <span class="stat-label">Success Rate</span>
            </div>
            <div class="stat">
              <span class="stat-value">${stats.averageTime}ms</span>
              <span class="stat-label">Avg Time</span>
            </div>
            <div class="stat">
              <span class="stat-value">${stats.usageCount}</span>
              <span class="stat-label">Pages</span>
            </div>
          </div>
        </div>
      `).join('');
    
    return `
      <div class="csp-analysis">
        <h3>Most Effective Strategy: <span class="highlight">${cspAnalysis.mostEffectiveStrategy}</span></h3>
        <div class="strategies-grid">
          ${strategies}
        </div>
      </div>
    `;
  }

  /**
   * Generate site trends HTML section
   * @param {Object} trends - Site trends data
   * @returns {string} HTML content
   */
  generateSiteTrendsHtml(trends) {
    if (!trends) return '<p>No trend analysis available</p>';
    
    const commonViolations = (trends.commonViolations || [])
      .slice(0, 5)
      .map(violation => `
        <tr>
          <td>${violation.rule}</td>
          <td>
            <div class="frequency-bar">
              <div class="frequency-fill" style="width: ${violation.frequency}%"></div>
              <span class="frequency-text">${violation.frequency}%</span>
            </div>
          </td>
          <td>${violation.affectedPages}</td>
        </tr>
      `).join('');
    
    const pageTypeScores = Object.entries(trends.accessibilityByPageType || {})
      .map(([pageType, stats]) => `
        <div class="page-type-score">
          <h4>${pageType}</h4>
          <div class="score-circle ${this.getScoreClass(stats.avgScore)}">
            <span class="score-value">${stats.avgScore}</span>
          </div>
          <div class="page-count">${stats.count} pages</div>
        </div>
      `).join('');
    
    return `
      <div class="site-trends">
        <div class="average-score">
          <h3>Average Accessibility Score</h3>
          <div class="score-display ${this.getScoreClass(trends.averageAccessibilityScore)}">
            ${trends.averageAccessibilityScore || 0}
          </div>
        </div>
        
        <div class="common-violations">
          <h3>Most Common Violations</h3>
          <table class="violations-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Frequency</th>
                <th>Affected Pages</th>
              </tr>
            </thead>
            <tbody>
              ${commonViolations}
            </tbody>
          </table>
        </div>
        
        <div class="page-type-scores">
          <h3>Accessibility by Page Type</h3>
          <div class="page-types-grid">
            ${pageTypeScores}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generate page results HTML section
   * @param {Array} pageResults - Page scan results
   * @returns {string} HTML content
   */
  generatePageResultsHtml(pageResults) {
    if (!pageResults || pageResults.length === 0) {
      return '<p>No page results available</p>';
    }
    
    const sortedResults = pageResults.sort((a, b) => b.priority - a.priority);
    
    const pageRows = sortedResults.map(result => `
      <tr class="page-result-row">
        <td>
          <div class="page-info">
            <a href="${result.url}" target="_blank" class="page-url">${result.url}</a>
            <div class="page-meta">
              <span class="page-type">${result.pageType}</span>
              <span class="priority-score">Priority: ${result.priority}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="accessibility-score ${this.getScoreClass(result.accessibilityScore)}">
            ${result.accessibilityScore}
          </div>
        </td>
        <td>
          <div class="violations-summary">
            ${this.generateViolationsSummary(result.violations)}
          </div>
        </td>
        <td>
          <span class="csp-strategy">${result.cspStrategy}</span>
        </td>
        <td>
          <span class="scan-duration">${result.scanDuration}ms</span>
        </td>
      </tr>
    `).join('');
    
    return `
      <div class="page-results">
        <table class="results-table">
          <thead>
            <tr>
              <th>Page</th>
              <th>Score</th>
              <th>Violations</th>
              <th>CSP Strategy</th>
              <th>Scan Time</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Generate violations summary HTML
   * @param {Array} violations - Violations array
   * @returns {string} HTML content
   */
  generateViolationsSummary(violations) {
    if (!violations || violations.length === 0) {
      return '<span class="no-violations">No violations found</span>';
    }
    
    const critical = violations.filter(v => v.impact === 'critical').length;
    const serious = violations.filter(v => v.impact === 'serious').length;
    const moderate = violations.filter(v => v.impact === 'moderate').length;
    const minor = violations.filter(v => v.impact === 'minor').length;
    
    return `
      <div class="violations-breakdown">
        ${critical > 0 ? `<span class="violation-count critical">${critical} Critical</span>` : ''}
        ${serious > 0 ? `<span class="violation-count serious">${serious} Serious</span>` : ''}
        ${moderate > 0 ? `<span class="violation-count moderate">${moderate} Moderate</span>` : ''}
        ${minor > 0 ? `<span class="violation-count minor">${minor} Minor</span>` : ''}
      </div>
    `;
  }

  /**
   * Generate recommendations HTML section
   * @param {Array} recommendations - Recommendations array
   * @returns {string} HTML content
   */
  generateRecommendationsHtml(recommendations) {
    if (!recommendations || recommendations.length === 0) {
      return '<p>No specific recommendations available</p>';
    }
    
    const recommendationCards = recommendations.map(rec => `
      <div class="recommendation-card ${rec.priority}">
        <div class="rec-header">
          <h4>${rec.issue}</h4>
          <span class="priority-badge ${rec.priority}">${rec.priority}</span>
        </div>
        <div class="rec-body">
          <p><strong>Impact:</strong> ${rec.affectedPages} pages affected</p>
          <p><strong>Solution:</strong> ${rec.solution}</p>
        </div>
      </div>
    `).join('');
    
    return `
      <div class="recommendations">
        ${recommendationCards}
      </div>
    `;
  }

  /**
   * Generate optimization report HTML
   * @param {Object} optimization - Optimization data
   * @returns {string} HTML content
   */
  generateOptimizationHtml(optimization) {
    if (!optimization) return '<p>No optimization data available</p>';
    
    return `
      <div class="optimization-report">
        <div class="optimization-stats">
          <div class="stat-card">
            <h4>Pages Discovered</h4>
            <div class="stat-value">${optimization.originalCount || 0}</div>
          </div>
          <div class="stat-card">
            <h4>Pages Scanned</h4>
            <div class="stat-value">${optimization.optimizedCount || 0}</div>
          </div>
          <div class="stat-card">
            <h4>Efficiency Gain</h4>
            <div class="stat-value">${optimization.reductionPercentage || 0}%</div>
          </div>
        </div>
        
        <div class="optimization-details">
          <h4>Optimization Details</h4>
          <p>The multi-page scanner optimized the scanning process by reducing ${optimization.originalCount || 0} discovered pages to ${optimization.optimizedCount || 0} representative pages, achieving a ${optimization.reductionPercentage || 0}% reduction in scanning workload while maintaining comprehensive coverage.</p>
        </div>
      </div>
    `;
  }

  /**
   * Generate technical metadata HTML
   * @param {Object} metadata - Technical metadata
   * @returns {string} HTML content
   */
  generateMetadataHtml(metadata) {
    if (!metadata) return '<p>No metadata available</p>';
    
    const cspStrategies = Object.entries(metadata.cspStrategiesUsed || {})
      .map(([strategy, count]) => `<li>${strategy}: ${count} pages</li>`)
      .join('');
    
    const errors = (metadata.errors || [])
      .map(error => `<li class="error">${error}</li>`)
      .join('');
    
    return `
      <div class="technical-metadata">
        <div class="metadata-section">
          <h4>Scanner Information</h4>
          <ul>
            <li>Scanner Version: ${metadata.scannerVersion || 'Unknown'}</li>
            <li>Pages Discovered: ${metadata.pagesDiscovered || 0}</li>
          </ul>
        </div>
        
        <div class="metadata-section">
          <h4>CSP Strategies Used</h4>
          <ul>${cspStrategies || '<li>No CSP strategies used</li>'}</ul>
        </div>
        
        ${errors ? `
          <div class="metadata-section">
            <h4>Errors Encountered</h4>
            <ul class="errors-list">${errors}</ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Get CSS class for accessibility score
   * @param {number} score - Accessibility score
   * @returns {string} CSS class
   */
  getScoreClass(score) {
    if (score >= 90) return 'score-excellent';
    if (score >= 80) return 'score-good';
    if (score >= 70) return 'score-fair';
    if (score >= 60) return 'score-poor';
    return 'score-critical';
  }

  /**
   * Calculate average accessibility score
   * @param {Array} pageResults - Page results
   * @returns {number} Average score
   */
  calculateAverageScore(pageResults) {
    if (!pageResults || pageResults.length === 0) return 0;
    
    const total = pageResults.reduce((sum, result) => sum + (result.accessibilityScore || 0), 0);
    return Math.round(total / pageResults.length);
  }

  /**
   * Count total violations across all pages
   * @param {Object} siteData - Site data
   * @returns {number} Total violations
   */
  countTotalViolations(siteData) {
    const pageResults = siteData.pageResults || [];
    return pageResults.reduce((total, result) => total + (result.violations?.length || 0), 0);
  }

  /**
   * Count critical violations across all pages
   * @param {Object} siteData - Site data
   * @returns {number} Critical violations
   */
  countCriticalViolations(siteData) {
    const pageResults = siteData.pageResults || [];
    return pageResults.reduce((total, result) => {
      const critical = (result.violations || []).filter(v => v.impact === 'critical').length;
      return total + critical;
    }, 0);
  }

  /**
   * Generate PDF from HTML
   * @param {string} htmlPath - Path to HTML file
   * @param {string} pdfPath - Output PDF path
   */
  async generatePdfFromHtml(htmlPath, pdfPath) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
      
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          bottom: '20mm',
          left: '15mm',
          right: '15mm'
        }
      });
      
    } finally {
      await browser.close();
    }
  }

  /**
   * Load template file
   * @param {string} templateName - Template filename
   * @returns {string} Template content
   */
  async loadTemplate(templateName) {
    const templatePath = path.join(this.templateDir, templateName);
    
    if (await fs.pathExists(templatePath)) {
      return await fs.readFile(templatePath, 'utf8');
    }
    
    // Return basic template if file doesn't exist
    return this.getDefaultTemplate(templateName);
  }

  /**
   * Get default template if file doesn't exist
   * @param {string} templateName - Template name
   * @returns {string} Default template
   */
  getDefaultTemplate(templateName) {
    if (templateName === 'site-report.html') {
      return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Multi-Page Accessibility Report - {{SITE_URL}}</title>
    <style>{{REPORT_STYLES}}</style>
</head>
<body>
    <div class="report-container">
        <header class="report-header">
            <h1>Multi-Page Accessibility Report</h1>
            <div class="report-meta">
                <p><strong>Website:</strong> {{SITE_URL}}</p>
                <p><strong>Scan Date:</strong> {{SCAN_DATE}}</p>
                <p><strong>Report ID:</strong> {{REPORT_ID}}</p>
            </div>
        </header>
        
        <section class="overview-section">
            <h2>Overview</h2>
            <div id="overview-data">{{OVERVIEW_DATA}}</div>
        </section>
        
        <section class="csp-section">
            <h2>CSP Strategy Analysis</h2>
            {{CSP_ANALYSIS}}
        </section>
        
        <section class="trends-section">
            <h2>Site-Wide Accessibility Trends</h2>
            {{SITE_TRENDS}}
        </section>
        
        <section class="results-section">
            <h2>Page Results</h2>
            {{PAGE_RESULTS}}
        </section>
        
        <section class="recommendations-section">
            <h2>Recommendations</h2>
            {{RECOMMENDATIONS}}
        </section>
        
        <section class="optimization-section">
            <h2>Optimization Report</h2>
            {{OPTIMIZATION_REPORT}}
        </section>
        
        <section class="metadata-section">
            <h2>Technical Details</h2>
            {{TECHNICAL_METADATA}}
        </section>
    </div>
</body>
</html>
      `;
    }
    
    if (templateName === 'report-styles.css') {
      return `
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .report-container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .report-header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; }
        .report-header h1 { color: #1a365d; margin-bottom: 20px; }
        .report-meta p { margin: 5px 0; color: #666; }
        section { margin-bottom: 40px; }
        h2 { color: #1a365d; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
        .score-excellent { color: #22543d; background: #c6f6d5; }
        .score-good { color: #2d3748; background: #bee3f8; }
        .score-fair { color: #744210; background: #faf089; }
        .score-poor { color: #822727; background: #fed7d7; }
        .score-critical { color: #742a2a; background: #fed7d7; }
        .results-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .results-table th, .results-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        .results-table th { background: #f7fafc; font-weight: 600; }
        .page-url { color: #3182ce; text-decoration: none; }
        .page-url:hover { text-decoration: underline; }
        .accessibility-score { padding: 4px 8px; border-radius: 4px; font-weight: bold; text-align: center; }
        .violation-count { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; margin-right: 4px; }
        .violation-count.critical { background: #fed7d7; color: #742a2a; }
        .violation-count.serious { background: #faf089; color: #744210; }
        .violation-count.moderate { background: #bee3f8; color: #2d3748; }
        .violation-count.minor { background: #c6f6d5; color: #22543d; }
        .recommendation-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin-bottom: 20px; }
        .recommendation-card.critical { border-left: 4px solid #e53e3e; }
        .recommendation-card.high { border-left: 4px solid #ed8936; }
        .recommendation-card.medium { border-left: 4px solid #3182ce; }
        .priority-badge { padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; }
        .priority-badge.critical { background: #fed7d7; color: #742a2a; }
        .priority-badge.high { background: #faf089; color: #744210; }
        .priority-badge.medium { background: #bee3f8; color: #2d3748; }
      `;
    }
    
    return '';
  }
}

module.exports = SiteAccessibilityReport;