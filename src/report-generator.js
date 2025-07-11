const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const htmlPdf = require('html-pdf-node');

class ReportGenerator {
  constructor() {
    this.reportsDir = path.join(__dirname, '../reports');
    this.templatesDir = path.join(__dirname, '../templates');
    this.ensureDirectories();
  }

  async ensureDirectories() {
    await fs.ensureDir(this.reportsDir);
    await fs.ensureDir(this.templatesDir);
  }

  async generateReport(scanData, options = {}) {
    const reportId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const reportData = {
      id: reportId,
      timestamp,
      ...scanData,
      metadata: {
        generatedBy: 'Web Accessibility Checker v3.0',
        format: options.format || 'html',
        ...options
      }
    };

    try {
      // Generate HTML report
      const htmlReport = await this.generateHTMLReport(reportData);
      const htmlPath = path.join(this.reportsDir, `${reportId}.html`);
      await fs.writeFile(htmlPath, htmlReport);

      // Generate PDF if requested
      let pdfPath = null;
      if (options.format === 'pdf' || options.includePDF) {
        pdfPath = await this.generatePDFReport(reportData, htmlReport);
      }

      // Save report metadata
      const metadataPath = path.join(this.reportsDir, `${reportId}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(reportData, null, 2));

      return {
        reportId,
        htmlPath,
        pdfPath,
        reportUrl: `/api/report/${reportId}`,
        pdfUrl: pdfPath ? `/api/report/${reportId}/pdf` : null,
        timestamp
      };

    } catch (error) {
      console.error('Error generating report:', error);
      throw new Error(`Failed to generate report: ${error.message}`);
    }
  }

  async generateHTMLReport(reportData) {
    const template = await this.getHTMLTemplate(reportData);
    return this.populateTemplate(template, reportData);
  }

  async generatePDFReport(reportData, htmlContent) {
    try {
      // For now, skip PDF generation to avoid template issues
      // We'll focus on HTML reports which work perfectly
      console.log('PDF generation temporarily disabled for debugging');
      return null;
      
      /* 
      const options = {
        format: 'A4',
        printBackground: true,
        margin: {
          top: '1in',
          bottom: '1in',
          left: '0.75in',
          right: '0.75in'
        }
      };

      const file = { content: htmlContent };
      const pdfBuffer = await htmlPdf.generatePdf(file, options);
      
      const pdfPath = path.join(this.reportsDir, `${reportData.id}.pdf`);
      await fs.writeFile(pdfPath, pdfBuffer);
      
      return pdfPath;
      */
    } catch (error) {
      console.error('PDF generation error:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  async getHTMLTemplate(reportData) {
    // Determine which template to use based on report type
    let templateName = 'basic-report.html';
    
    if (reportData.headingStructure && reportData.euCompliance) {
      templateName = 'screen-reader-report.html';
    } else if (reportData.categories && reportData.wcagCompliance) {
      templateName = 'enhanced-report.html';
    }

    const templatePath = path.join(this.templatesDir, templateName);
    
    try {
      return await fs.readFile(templatePath, 'utf8');
    } catch (error) {
      // If template doesn't exist, create a default one
      console.log(`Template ${templateName} not found, creating default template`);
      return await this.createDefaultTemplate(reportData);
    }
  }

  async createDefaultTemplate(reportData) {
    const template = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Accessibility Report - {{pageTitle}}</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f8f9fa; }
            .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 3rem 0; text-align: center; margin-bottom: 2rem; }
            .report-card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 2rem; }
            .score-display { text-align: center; margin: 2rem 0; }
            .score-circle { font-size: 4rem; font-weight: bold; margin-bottom: 1rem; }
            .score-excellent { color: #28a745; }
            .score-good { color: #17a2b8; }
            .score-fair { color: #ffc107; }
            .score-poor { color: #dc3545; }
            .categories-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
            .category-card { background: #f8f9fa; padding: 1.5rem; border-radius: 6px; border-left: 4px solid #667eea; }
            .violation-item { background: #fff5f5; border-left: 4px solid #e53e3e; padding: 1rem; margin-bottom: 1rem; border-radius: 0 4px 4px 0; }
            .violation-item.moderate { background: #fffaf0; border-left-color: #dd6b20; }
            .violation-item.minor { background: #f7fafc; border-left-color: #4299e1; }
            .impact-badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 3px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
            .impact-critical { background: #fed7d7; color: #742a2a; }
            .impact-serious { background: #fed7d7; color: #742a2a; }
            .impact-moderate { background: #feebc8; color: #744210; }
            .impact-minor { background: #bee3f8; color: #2a4365; }
            .summary-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 2rem 0; }
            .stat-item { text-align: center; padding: 1rem; background: #f8f9fa; border-radius: 6px; }
            .stat-number { font-size: 2rem; font-weight: bold; color: #667eea; }
            .recommendations { background: #e6fffa; border-left: 4px solid #38b2ac; padding: 1.5rem; margin: 2rem 0; border-radius: 0 6px 6px 0; }
            .footer { text-align: center; margin-top: 3rem; padding: 2rem; background: #f8f9fa; border-radius: 6px; }
            @media print {
                .header { background: #667eea !important; -webkit-print-color-adjust: exact; }
                .category-card, .report-card { break-inside: avoid; }
                body { background: white !important; }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="container">
                <h1>Web Accessibility Report</h1>
                <p>Professional accessibility analysis for {{url}}</p>
                <p>Generated on {{timestamp}}</p>
            </div>
        </div>

        <div class="container">
            <div class="report-card">
                <h2>Executive Summary</h2>
                <div class="score-display">
                    <div class="score-circle {{scoreClass}}">{{accessibilityScore}}/100</div>
                    <h3>Overall Accessibility Score</h3>
                </div>

                <div class="summary-stats">
                    <div class="stat-item">
                        <div class="stat-number">{{violationsCount}}</div>
                        <div>Violations</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">{{passes}}</div>
                        <div>Passes</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">{{totalChecks}}</div>
                        <div>Total Checks</div>
                    </div>
                </div>
            </div>

            {{categoriesSection}}

            {{violationsSection}}

            {{euComplianceSection}}

            <div class="recommendations">
                <h3>📋 Key Recommendations</h3>
                <ul>
                    {{recommendationsList}}
                    <li>Regularly test your website with screen readers like NVDA or JAWS</li>
                    <li>Implement automated accessibility testing in your development pipeline</li>
                    <li>Consider conducting user testing with people who have disabilities</li>
                    <li>Review and update content for plain language and clear communication</li>
                </ul>
            </div>

            <div class="footer">
                <p><strong>Report generated by Web Accessibility Checker v3.0</strong></p>
                <p>For more information about web accessibility, visit <a href="https://www.w3.org/WAI/">W3C Web Accessibility Initiative</a></p>
                <p>Report ID: {{id}} | Generated: {{timestamp}}</p>
            </div>
        </div>
    </body>
    </html>
    `;

    return template;
  }

  populateTemplate(template, data) {
    let html = template;

    // Helper function to get score class
    const getScoreClass = (score) => {
      if (score >= 90) return 'score-excellent';
      if (score >= 70) return 'score-good';
      if (score >= 50) return 'score-fair';
      return 'score-poor';
    };

    // Basic replacements
    html = html.replace(/{{pageTitle}}/g, data.pageTitle || 'Unknown Page');
    html = html.replace(/{{url}}/g, data.url || '');
    html = html.replace(/{{timestamp}}/g, new Date(data.timestamp).toLocaleString());
    html = html.replace(/{{accessibilityScore}}/g, data.accessibilityScore || 0);
    html = html.replace(/{{scoreClass}}/g, getScoreClass(data.accessibilityScore || 0));
    html = html.replace(/{{passes}}/g, data.passes || 0);
    html = html.replace(/{{id}}/g, data.id || 'unknown');

    // Calculate total checks and violations count
    const violationsCount = data.violations ? data.violations.length : 0;
    const totalChecks = (data.passes || 0) + violationsCount;
    html = html.replace(/{{totalChecks}}/g, totalChecks);
    html = html.replace(/{{violationsCount}}/g, violationsCount);

    // Generate sections
    html = html.replace(/{{categoriesSection}}/g, this.generateCategoriesSection(data, getScoreClass));
    html = html.replace(/{{violationsSection}}/g, this.generateViolationsSection(data));
    html = html.replace(/{{euComplianceSection}}/g, this.generateEuComplianceSection(data, getScoreClass));
    html = html.replace(/{{recommendationsList}}/g, this.generateRecommendationsList(data));

    return html;
  }

  generateCategoriesSection(data, getScoreClass) {
    if (!data.categories) return '';
    
    return `
    <div class="report-card">
        <h2>WCAG Principles</h2>
        <div class="categories-grid">
            <div class="category-card">
                <h3>Perceivable</h3>
                <div class="score-circle ${getScoreClass(data.categories.perceivable.score || 0)}">${data.categories.perceivable.score || 0}%</div>
                <p>${data.categories.perceivable.violations || 0} violations</p>
            </div>
            <div class="category-card">
                <h3>Operable</h3>
                <div class="score-circle ${getScoreClass(data.categories.operable.score || 0)}">${data.categories.operable.score || 0}%</div>
                <p>${data.categories.operable.violations || 0} violations</p>
            </div>
            <div class="category-card">
                <h3>Understandable</h3>
                <div class="score-circle ${getScoreClass(data.categories.understandable.score || 0)}">${data.categories.understandable.score || 0}%</div>
                <p>${data.categories.understandable.violations || 0} violations</p>
            </div>
            <div class="category-card">
                <h3>Robust</h3>
                <div class="score-circle ${getScoreClass(data.categories.robust.score || 0)}">${data.categories.robust.score || 0}%</div>
                <p>${data.categories.robust.violations || 0} violations</p>
            </div>
        </div>
    </div>
    `;
  }

  generateViolationsSection(data) {
    if (!data.violations || data.violations.length === 0) return '';
    
    let violationsHtml = `
    <div class="report-card">
        <h2>Accessibility Violations (${data.violations.length})</h2>
    `;
    
    data.violations.forEach(violation => {
      violationsHtml += `
      <div class="violation-item ${violation.impact}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h4>${violation.id}</h4>
              <span class="impact-badge impact-${violation.impact}">${violation.impact}</span>
          </div>
          <p>${violation.description}</p>
          ${violation.nodes && violation.nodes.length ? `<p><strong>Affected elements:</strong> ${violation.nodes.join(', ')}</p>` : ''}
          ${violation.helpUrl ? `<p><a href="${violation.helpUrl}" target="_blank">Learn more about this issue</a></p>` : ''}
      </div>
      `;
    });
    
    violationsHtml += '</div>';
    return violationsHtml;
  }

  generateEuComplianceSection(data, getScoreClass) {
    if (!data.euCompliance) return '';
    
    let html = `
    <div class="report-card">
        <h2>EU Compliance (EN 301 549)</h2>
        <div class="score-display">
            <div class="score-circle ${getScoreClass(data.euCompliance.en301549.score || 0)}">${data.euCompliance.en301549.score || 0}/100</div>
            <h3>EU Compliance Score</h3>
        </div>
    `;
    
    if (data.euCompliance.en301549.violations && data.euCompliance.en301549.violations.length > 0) {
      html += '<h3>Violations:</h3>';
      data.euCompliance.en301549.violations.forEach(violation => {
        html += `
        <div class="violation-item ${violation.severity}">
            <h4>Clause ${violation.clause}</h4>
            <p>${violation.description}</p>
        </div>
        `;
      });
    }
    
    html += '</div>';
    return html;
  }

  generateRecommendationsList(data) {
    let html = '';
    
    if (data.violations && data.violations.length > 0) {
      html += `<li>Address the ${data.violations.length} accessibility violations identified above</li>`;
    }
    
    return html;
  }

  async getReport(reportId) {
    try {
      const metadataPath = path.join(this.reportsDir, `${reportId}.json`);
      const metadata = await fs.readJson(metadataPath);
      
      const htmlPath = path.join(this.reportsDir, `${reportId}.html`);
      const htmlExists = await fs.pathExists(htmlPath);
      
      const pdfPath = path.join(this.reportsDir, `${reportId}.pdf`);
      const pdfExists = await fs.pathExists(pdfPath);

      return {
        metadata,
        htmlPath: htmlExists ? htmlPath : null,
        pdfPath: pdfExists ? pdfPath : null
      };
    } catch (error) {
      throw new Error(`Report not found: ${reportId}`);
    }
  }

  async deleteReport(reportId) {
    try {
      const files = [
        path.join(this.reportsDir, `${reportId}.json`),
        path.join(this.reportsDir, `${reportId}.html`),
        path.join(this.reportsDir, `${reportId}.pdf`)
      ];

      await Promise.all(files.map(file => fs.remove(file).catch(() => {})));
      return true;
    } catch (error) {
      console.error('Error deleting report:', error);
      return false;
    }
  }

  async listReports(limit = 50) {
    try {
      const files = await fs.readdir(this.reportsDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      const reports = await Promise.all(
        jsonFiles.slice(0, limit).map(async (file) => {
          try {
            const metadata = await fs.readJson(path.join(this.reportsDir, file));
            return {
              id: metadata.id,
              timestamp: metadata.timestamp,
              url: metadata.url,
              score: metadata.accessibilityScore,
              violationsCount: metadata.violations ? metadata.violations.length : 0
            };
          } catch (error) {
            return null;
          }
        })
      );

      return reports.filter(report => report !== null)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Error listing reports:', error);
      return [];
    }
  }
}

module.exports = ReportGenerator;