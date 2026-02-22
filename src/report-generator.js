const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const htmlPdf = require('html-pdf-node');

const DEFAULT_ORG_NAME = 'Zentrum f\u00fcr nachhaltige Algorithmik und Intelligenzforschung e.V.';

// Map WCAG criterion numbers to principles
function classifyWcagPrinciple(violation) {
  const criterion = violation.criterion || violation.wcagCriteria || violation.clause || '';
  const str = String(criterion);

  // EU/EAA-specific violations
  if (str.startsWith('EAA-')) return 'eaa';

  // EN 301 549 mapping: 9.1.x = Perceivable, 9.2.x = Operable, 9.3.x = Understandable, 9.4.x = Robust
  const match = str.match(/^(?:9\.)?([1-4])\./);
  if (match) {
    const principle = parseInt(match[1], 10);
    if (principle === 1) return 'perceivable';
    if (principle === 2) return 'operable';
    if (principle === 3) return 'understandable';
    if (principle === 4) return 'robust';
  }

  return 'other';
}

// Normalize severity values to a consistent set
function normalizeSeverity(violation) {
  const raw = (violation.severity || violation.impact || 'moderate').toLowerCase();
  if (raw === 'critical' || raw === 'error') return 'critical';
  if (raw === 'serious' || raw === 'major' || raw === 'high') return 'serious';
  if (raw === 'moderate' || raw === 'warning') return 'moderate';
  if (raw === 'minor') return 'minor';
  return 'moderate';
}

const SEVERITY_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

const SEVERITY_LABELS = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

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

  async generate(scanData, options = {}) {
    return this.generateReport(scanData, options);
  }

  async generateReport(scanData, options = {}) {
    const reportId = uuidv4();
    const timestamp = new Date().toISOString();

    const reportData = {
      id: reportId,
      timestamp,
      ...scanData,
      orgName: options.orgName || DEFAULT_ORG_NAME,
      orgLogo: options.orgLogo || null,
      orgContact: options.orgContact || null,
      metadata: {
        generatedBy: 'Web Accessibility Checker v3.0',
        format: options.format || 'html',
        ...options,
      },
    };

    try {
      const htmlReport = await this.generateHTMLReport(reportData);
      const htmlPath = path.join(this.reportsDir, `${reportId}.html`);
      await fs.writeFile(htmlPath, htmlReport);

      let pdfPath = null;
      if (options.format === 'pdf' || options.includePDF) {
        pdfPath = await this.generatePDFReport(reportData, htmlReport);
      }

      const metadataPath = path.join(this.reportsDir, `${reportId}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(reportData, null, 2));

      return {
        reportId,
        htmlPath,
        pdfPath,
        reportUrl: `/api/report/${reportId}`,
        pdfUrl: pdfPath ? `/api/report/${reportId}/pdf` : null,
        timestamp,
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
      const options = {
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
      };

      const file = { content: htmlContent };
      const pdfBuffer = await htmlPdf.generatePdf(file, options);

      const pdfPath = path.join(this.reportsDir, `${reportData.id}.pdf`);
      await fs.writeFile(pdfPath, pdfBuffer);
      return pdfPath;
    } catch (error) {
      console.error('PDF generation error:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  async getHTMLTemplate(reportData) {
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
      return this.createDefaultTemplate(reportData);
    }
  }

  createDefaultTemplate() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Accessibility Audit Report - {{pageTitle}}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 13.5px;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 48px;
  }

  h1, h2, h3, h4 {
    font-family: Georgia, 'Times New Roman', serif;
    font-weight: normal;
    color: #222;
  }

  h1 { font-size: 1.6rem; margin-bottom: 0.25em; }
  h2 { font-size: 1.25rem; margin: 2em 0 0.75em; padding-bottom: 0.3em; border-bottom: 2px solid #222; }
  h3 { font-size: 1.05rem; margin: 1.5em 0 0.5em; }
  h4 { font-size: 0.95rem; margin: 1em 0 0.4em; }

  p { margin-bottom: 0.6em; }
  a { color: #2a5db0; }

  /* Report header */
  .report-header {
    border-bottom: 3px solid #222;
    padding-bottom: 20px;
    margin-bottom: 24px;
  }
  .report-header .org-name {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 0.85rem;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 12px;
  }
  .report-header .org-logo {
    max-height: 48px;
    margin-bottom: 8px;
  }
  .report-header h1 {
    margin-bottom: 12px;
  }
  .report-meta {
    font-size: 0.85rem;
    color: #444;
    line-height: 1.9;
  }
  .report-meta dt {
    display: inline;
    font-weight: 600;
    color: #222;
  }
  .report-meta dt::after { content: ': '; }
  .report-meta dd {
    display: inline;
    margin: 0;
  }
  .report-meta dd::after {
    content: '';
    display: block;
  }

  /* Table of contents */
  .toc {
    background: #f7f7f7;
    border: 1px solid #ddd;
    padding: 16px 24px;
    margin: 24px 0 32px;
  }
  .toc h2 {
    font-size: 1rem;
    margin: 0 0 8px;
    padding: 0;
    border: none;
  }
  .toc ol {
    margin: 0;
    padding-left: 1.5em;
    font-size: 0.9rem;
    line-height: 2;
  }
  .toc ol ol {
    margin-top: 0;
    line-height: 1.8;
  }
  .toc a {
    text-decoration: none;
    color: #1a1a1a;
  }
  .toc a:hover { text-decoration: underline; }

  /* Score display */
  .score-display {
    display: inline-block;
    font-size: 2.4rem;
    font-weight: 700;
    font-family: Georgia, 'Times New Roman', serif;
    margin: 8px 0;
  }
  .score-label {
    font-size: 0.85rem;
    color: #555;
  }
  .score-excellent { color: #1a7a2e; }
  .score-good { color: #2a7a6e; }
  .score-fair { color: #8a6d00; }
  .score-poor { color: #b32d2d; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 20px;
    font-size: 0.88rem;
  }
  th {
    background: #f0f0f0;
    text-align: left;
    padding: 8px 10px;
    border-bottom: 2px solid #333;
    font-weight: 600;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #333;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid #ddd;
    vertical-align: top;
  }
  tr:nth-child(even) { background: #fafafa; }

  /* Severity indicators */
  .severity {
    font-weight: 600;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .severity-critical { color: #b32d2d; }
  .severity-serious { color: #c06a00; }
  .severity-moderate { color: #7a6a00; }
  .severity-minor { color: #2a6a9e; }

  /* Summary severity distribution */
  .severity-bar {
    display: flex;
    height: 8px;
    border-radius: 2px;
    overflow: hidden;
    margin: 8px 0 16px;
    background: #eee;
  }
  .severity-bar span {
    display: block;
    height: 100%;
  }
  .bar-critical { background: #b32d2d; }
  .bar-serious { background: #d4840a; }
  .bar-moderate { background: #c4a800; }
  .bar-minor { background: #4a90c4; }

  /* Element code */
  code {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.82rem;
    background: #f3f3f3;
    padding: 1px 5px;
    border-radius: 2px;
    color: #333;
    word-break: break-all;
  }

  /* Section numbering */
  .section-num {
    font-family: Georgia, 'Times New Roman', serif;
    color: #555;
    margin-right: 0.4em;
  }

  /* Footer */
  .report-footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid #ccc;
    font-size: 0.8rem;
    color: #666;
    line-height: 1.8;
  }

  /* Methodology scanner list */
  .scanner-list {
    column-count: 2;
    column-gap: 2em;
    font-size: 0.88rem;
    margin: 8px 0 16px;
    padding-left: 1.5em;
  }

  /* Print styles */
  @media print {
    body {
      padding: 0;
      font-size: 11pt;
      max-width: none;
    }
    .toc { break-after: page; }
    h2 { break-before: page; break-after: avoid; }
    h3, h4 { break-after: avoid; }
    table { break-inside: auto; }
    tr { break-inside: avoid; }
    .severity-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .severity-critical, .severity-serious, .severity-moderate, .severity-minor {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    a { color: #1a1a1a; text-decoration: none; }
    .report-footer { break-before: page; }
  }
</style>
</head>
<body>

<div class="report-header">
  {{orgLogoHtml}}
  <div class="org-name">{{orgName}}</div>
  <h1>Web Accessibility Audit Report</h1>
  <dl class="report-meta">
    <dt>Target URL</dt><dd>{{url}}</dd>
    <dt>Report Date</dt><dd>{{reportDate}}</dd>
    <dt>Reference</dt><dd>{{id}}</dd>
  </dl>
</div>

{{tocSection}}

<h2 id="section-2"><span class="section-num">2</span>Executive Summary</h2>

<p>
  Automated accessibility audit of <strong>{{url}}</strong>, conducted on {{reportDate}}.
</p>

<div>
  <span class="score-label">Overall Accessibility Score</span><br>
  <span class="score-display {{scoreClass}}">{{accessibilityScore}} / 100</span>
</div>

<p>Total violations identified: <strong>{{violationsCount}}</strong> across {{totalChecks}} checks ({{passes}} passed).</p>

{{severityDistribution}}

{{principleScoresTable}}

<h2 id="section-3"><span class="section-num">3</span>Methodology</h2>

{{methodologySection}}

{{findingsSection}}

{{euComplianceSection}}

{{recommendationsSection}}

<h2 id="section-7"><span class="section-num">7</span>Appendix</h2>

{{appendixSection}}

<div class="report-footer">
  <p>Report generated by {{generatedBy}}</p>
  <p>Reference: {{id}}</p>
  <p>For information on web accessibility standards, see <a href="https://www.w3.org/WAI/">W3C Web Accessibility Initiative</a>.</p>
</div>

</body>
</html>`;
  }

  populateTemplate(template, data) {
    let html = template;

    const getScoreClass = (score) => {
      if (score >= 90) return 'score-excellent';
      if (score >= 70) return 'score-good';
      if (score >= 50) return 'score-fair';
      return 'score-poor';
    };

    const reportDate = new Date(data.timestamp).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const violationsCount = data.violations ? data.violations.length : 0;
    const passes = data.passes || 0;
    const totalChecks = passes + violationsCount;

    html = html.replace(/{{pageTitle}}/g, data.pageTitle || data.url || 'Unknown Page');
    html = html.replace(/{{url}}/g, this.escapeHtml(data.url || ''));
    html = html.replace(/{{reportDate}}/g, reportDate);
    html = html.replace(/{{timestamp}}/g, reportDate);
    html = html.replace(/{{accessibilityScore}}/g, data.accessibilityScore || 0);
    html = html.replace(/{{scoreClass}}/g, getScoreClass(data.accessibilityScore || 0));
    html = html.replace(/{{passes}}/g, passes);
    html = html.replace(/{{id}}/g, data.id || 'unknown');
    html = html.replace(/{{totalChecks}}/g, totalChecks);
    html = html.replace(/{{violationsCount}}/g, violationsCount);
    html = html.replace(/{{orgName}}/g, this.escapeHtml(data.orgName || DEFAULT_ORG_NAME));
    html = html.replace(/{{generatedBy}}/g, this.escapeHtml(data.metadata?.generatedBy || 'Web Accessibility Checker v3.0'));

    // Org logo
    const logoHtml = data.orgLogo
      ? `<img class="org-logo" src="${this.escapeHtml(data.orgLogo)}" alt="">`
      : '';
    html = html.replace(/{{orgLogoHtml}}/g, logoHtml);

    // Sections
    html = html.replace(/{{tocSection}}/g, this.generateTocSection(data));
    html = html.replace(/{{severityDistribution}}/g, this.generateSeverityDistribution(data));
    html = html.replace(/{{principleScoresTable}}/g, this.generatePrincipleScoresTable(data, getScoreClass));
    html = html.replace(/{{methodologySection}}/g, this.generateMethodologySection(data));
    html = html.replace(/{{findingsSection}}/g, this.generateFindingsSection(data));
    html = html.replace(/{{euComplianceSection}}/g, this.generateEuComplianceSection(data));
    html = html.replace(/{{recommendationsSection}}/g, this.generateRecommendationsSection(data));
    html = html.replace(/{{appendixSection}}/g, this.generateAppendixSection(data));

    return html;
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Section generators ---

  generateTocSection(data) {
    const hasEu = !!data.euCompliance;
    const groups = this.groupViolationsByPrinciple(data.violations || []);

    let subSections = '';
    let subIdx = 1;
    for (const [key, label] of [['perceivable', 'Perceivable'], ['operable', 'Operable'], ['understandable', 'Understandable'], ['robust', 'Robust']]) {
      const count = (groups[key] || []).length;
      subSections += `<li><a href="#section-4-${subIdx}">4.${subIdx} ${label}</a> (${count})</li>\n`;
      subIdx++;
    }
    if ((groups.other || []).length > 0) {
      subSections += `<li><a href="#section-4-5">4.5 Other Findings</a> (${groups.other.length})</li>\n`;
    }

    return `
<nav class="toc">
  <h2>Table of Contents</h2>
  <ol>
    <li><a href="#section-2">Executive Summary</a></li>
    <li><a href="#section-3">Methodology</a></li>
    <li><a href="#section-4">Findings by WCAG Principle</a>
      <ol>${subSections}</ol>
    </li>
    ${hasEu ? '<li><a href="#section-5">EU/EAA Compliance</a></li>' : ''}
    <li><a href="#section-6">Recommendations</a></li>
    <li><a href="#section-7">Appendix</a></li>
  </ol>
</nav>`;
  }

  generateSeverityDistribution(data) {
    if (!data.violations || data.violations.length === 0) return '';

    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    data.violations.forEach(v => { counts[normalizeSeverity(v)]++; });
    const total = data.violations.length;

    let barHtml = '<div class="severity-bar">';
    for (const sev of ['critical', 'serious', 'moderate', 'minor']) {
      if (counts[sev] > 0) {
        const pct = ((counts[sev] / total) * 100).toFixed(1);
        barHtml += `<span class="bar-${sev}" style="width:${pct}%" title="${SEVERITY_LABELS[sev]}: ${counts[sev]}"></span>`;
      }
    }
    barHtml += '</div>';

    let tableHtml = `<table>
<thead><tr><th>Severity</th><th>Count</th><th>Percentage</th></tr></thead>
<tbody>`;
    for (const sev of ['critical', 'serious', 'moderate', 'minor']) {
      if (counts[sev] > 0) {
        const pct = ((counts[sev] / total) * 100).toFixed(0);
        tableHtml += `<tr><td><span class="severity severity-${sev}">${SEVERITY_LABELS[sev]}</span></td><td>${counts[sev]}</td><td>${pct}%</td></tr>`;
      }
    }
    tableHtml += '</tbody></table>';

    return `<h3>Severity Distribution</h3>\n${barHtml}\n${tableHtml}`;
  }

  generatePrincipleScoresTable(data, getScoreClass) {
    // Use actual violation grouping instead of potentially broken upstream categories
    const groups = this.groupViolationsByPrinciple(data.violations || []);
    const cats = data.categories || {};

    const principles = [
      ['Perceivable', 'perceivable'],
      ['Operable', 'operable'],
      ['Understandable', 'understandable'],
      ['Robust', 'robust'],
    ];

    let html = `<h3>WCAG Principle Overview</h3>
<table>
<thead><tr><th>Principle</th><th>Score</th><th>Violations</th></tr></thead>
<tbody>`;

    for (const [name, key] of principles) {
      const cat = cats[key];
      const score = cat?.score != null ? cat.score : '--';
      const violations = (groups[key] || []).length;
      const cls = cat?.score != null ? getScoreClass(cat.score) : '';
      html += `<tr><td>${name}</td><td class="${cls}">${score}${score !== '--' ? '%' : ''}</td><td>${violations}</td></tr>`;
    }

    html += '</tbody></table>';
    return html;
  }

  generateMethodologySection(data) {
    let html = '<p>This report was generated through automated accessibility scanning targeting <strong>WCAG 2.1 Level AA</strong> conformance.</p>';

    if (data.scanners && Object.keys(data.scanners).length > 0) {
      const scannerNames = Object.keys(data.scanners);
      const passed = scannerNames.filter(s => data.scanners[s].passed).length;
      const failed = scannerNames.length - passed;

      html += `<p>${scannerNames.length} scanners executed (${passed} passed, ${failed} with findings).</p>`;
      html += '<h4>Scanners</h4><ul class="scanner-list">';
      for (const name of scannerNames) {
        const s = data.scanners[name];
        const status = s.passed ? 'passed' : `${s.violationCount} violation${s.violationCount !== 1 ? 's' : ''}`;
        html += `<li><strong>${this.escapeHtml(name)}</strong> &mdash; ${status}</li>`;
      }
      html += '</ul>';
    }

    return html;
  }

  groupViolationsByPrinciple(violations) {
    const groups = { perceivable: [], operable: [], understandable: [], robust: [], eaa: [], other: [] };
    for (const v of violations) {
      const principle = classifyWcagPrinciple(v);
      groups[principle].push(v);
    }
    // Sort each group by severity
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (SEVERITY_ORDER[normalizeSeverity(a)] || 2) - (SEVERITY_ORDER[normalizeSeverity(b)] || 2));
    }
    return groups;
  }

  generateFindingsSection(data) {
    if (!data.violations || data.violations.length === 0) {
      return '<h2 id="section-4"><span class="section-num">4</span>Findings</h2>\n<p>No accessibility violations were identified.</p>';
    }

    const groups = this.groupViolationsByPrinciple(data.violations);

    let html = `<h2 id="section-4"><span class="section-num">4</span>Findings by WCAG Principle</h2>
<p>${data.violations.length} violations identified across ${Object.values(groups).filter(g => g.length > 0).length} categories.</p>`;

    const sections = [
      ['perceivable', 'Perceivable', '4.1', 'Information and user interface components must be presentable in ways users can perceive.'],
      ['operable', 'Operable', '4.2', 'User interface components and navigation must be operable.'],
      ['understandable', 'Understandable', '4.3', 'Information and operation of the user interface must be understandable.'],
      ['robust', 'Robust', '4.4', 'Content must be robust enough to be interpreted by a wide variety of user agents.'],
    ];

    let subIdx = 1;
    for (const [key, label, num, desc] of sections) {
      const violations = groups[key] || [];
      html += `<h3 id="section-4-${subIdx}"><span class="section-num">${num}</span>${label} (${violations.length} violation${violations.length !== 1 ? 's' : ''})</h3>`;
      html += `<p>${desc}</p>`;
      if (violations.length === 0) {
        html += '<p>No violations identified in this category.</p>';
      } else {
        html += this.renderViolationTable(violations);
      }
      subIdx++;
    }

    // Other/unclassified findings
    if (groups.other.length > 0) {
      html += `<h3 id="section-4-5"><span class="section-num">4.5</span>Other Findings (${groups.other.length})</h3>`;
      html += this.renderViolationTable(groups.other);
    }

    return html;
  }

  renderViolationTable(violations) {
    let html = `<table>
<thead><tr><th>#</th><th>Severity</th><th>WCAG</th><th>Description</th><th>Element</th><th>Recommendation</th></tr></thead>
<tbody>`;

    violations.forEach((v, i) => {
      const sev = normalizeSeverity(v);
      const criterion = v.criterion || v.wcagCriteria || v.clause || '';
      const desc = this.escapeHtml(v.description || v.type || v.issue || 'Unknown violation');
      const element = v.element ? `<code>${this.escapeHtml(v.element)}</code>` : '';
      const rec = this.escapeHtml(v.recommendation || v.suggestion || '');

      html += `<tr>
<td>${i + 1}</td>
<td><span class="severity severity-${sev}">${SEVERITY_LABELS[sev]}</span></td>
<td>${this.escapeHtml(String(criterion))}</td>
<td>${desc}</td>
<td>${element}</td>
<td>${rec}</td>
</tr>`;
    });

    html += '</tbody></table>';
    return html;
  }

  generateEuComplianceSection(data) {
    // Collect EAA violations from grouped findings
    const groups = this.groupViolationsByPrinciple(data.violations || []);
    const eaaViolations = groups.eaa || [];

    // Also check legacy euCompliance data
    const hasLegacyEu = data.euCompliance?.en301549;
    if (!hasLegacyEu && eaaViolations.length === 0) return '';

    let html = '<h2 id="section-5"><span class="section-num">5</span>EU/EAA Compliance</h2>';

    if (hasLegacyEu) {
      const score = data.euCompliance.en301549.score || 0;
      html += `<p>EN 301 549 Compliance Score: <strong>${score} / 100</strong></p>`;
    }

    if (eaaViolations.length > 0) {
      html += `<p>${eaaViolations.length} EU European Accessibility Act violation${eaaViolations.length !== 1 ? 's' : ''} identified.</p>`;
      html += this.renderViolationTable(eaaViolations);
    } else if (hasLegacyEu && data.euCompliance.en301549.violations?.length > 0) {
      const violations = data.euCompliance.en301549.violations;
      html += `<table>
<thead><tr><th>#</th><th>Severity</th><th>Clause</th><th>Description</th></tr></thead>
<tbody>`;
      violations.forEach((v, i) => {
        const sev = normalizeSeverity(v);
        html += `<tr><td>${i + 1}</td><td><span class="severity severity-${sev}">${SEVERITY_LABELS[sev]}</span></td><td>${this.escapeHtml(v.clause || '')}</td><td>${this.escapeHtml(v.description || '')}</td></tr>`;
      });
      html += '</tbody></table>';
    }

    return html;
  }

  generateRecommendationsSection(data) {
    if (!data.violations || data.violations.length === 0) {
      return '<h2 id="section-6"><span class="section-num">6</span>Recommendations</h2>\n<p>No specific recommendations at this time.</p>';
    }

    // Derive recommendations from actual findings
    const groups = this.groupViolationsByPrinciple(data.violations);
    const sevCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    data.violations.forEach(v => sevCounts[normalizeSeverity(v)]++);

    const recommendations = [];

    // Critical and serious issues first
    if (sevCounts.critical > 0) {
      recommendations.push({
        priority: 'Critical',
        text: `Address ${sevCounts.critical} critical violation${sevCounts.critical !== 1 ? 's' : ''} immediately. These represent significant barriers to accessibility.`,
      });
    }
    if (sevCounts.serious > 0) {
      recommendations.push({
        priority: 'High',
        text: `Resolve ${sevCounts.serious} serious violation${sevCounts.serious !== 1 ? 's' : ''} as a priority. These issues substantially affect user experience for people with disabilities.`,
      });
    }

    // Principle-specific recommendations
    if (groups.perceivable.length > 0) {
      const issues = groups.perceivable.map(v => v.issue || v.type || '').filter(Boolean);
      const hasImageIssues = issues.some(i => i.includes('image') || i.includes('alt'));
      if (hasImageIssues) {
        recommendations.push({ priority: 'High', text: 'Audit all images for proper alternative text. Ensure decorative images use empty alt attributes and informative images have descriptive alternatives.' });
      }
    }

    if (groups.operable.length > 0) {
      const issues = groups.operable.map(v => v.issue || v.type || '').filter(Boolean);
      const hasFocusIssues = issues.some(i => i.includes('focus') || i.includes('keyboard'));
      const hasNavIssues = issues.some(i => i.includes('navigation') || i.includes('link'));
      if (hasFocusIssues) {
        recommendations.push({ priority: 'High', text: 'Review keyboard navigation and focus management. Ensure all interactive elements have visible focus indicators and are keyboard accessible.' });
      }
      if (hasNavIssues) {
        recommendations.push({ priority: 'Medium', text: 'Improve link text and navigation structure. Ensure links have descriptive text and multiple navigation pathways exist.' });
      }
    }

    if (groups.understandable.length > 0) {
      const issues = groups.understandable.map(v => v.issue || v.type || v.description || '').filter(Boolean);
      const hasLangIssues = issues.some(i => i.includes('lang') || i.includes('language'));
      if (hasLangIssues) {
        recommendations.push({ priority: 'Medium', text: 'Set the document language attribute and mark language changes within content.' });
      }
    }

    if (groups.robust.length > 0) {
      recommendations.push({ priority: 'Medium', text: `Address ${groups.robust.length} robustness violation${groups.robust.length !== 1 ? 's' : ''} to ensure compatibility with assistive technologies.` });
    }

    if (groups.eaa.length > 0) {
      recommendations.push({ priority: 'Critical', text: 'Address EU European Accessibility Act compliance gaps, including accessibility statement, contact mechanisms, and monitoring procedures.' });
    }

    if (sevCounts.moderate > 0 || sevCounts.minor > 0) {
      recommendations.push({
        priority: 'Low',
        text: `Review remaining ${sevCounts.moderate + sevCounts.minor} moderate and minor violations to improve overall accessibility posture.`,
      });
    }

    let html = '<h2 id="section-6"><span class="section-num">6</span>Recommendations</h2>';
    html += `<p>${recommendations.length} prioritized recommendations based on findings.</p>`;

    html += `<table>
<thead><tr><th>#</th><th>Priority</th><th>Recommendation</th></tr></thead>
<tbody>`;
    recommendations.forEach((r, i) => {
      html += `<tr><td>${i + 1}</td><td><strong>${r.priority}</strong></td><td>${this.escapeHtml(r.text)}</td></tr>`;
    });
    html += '</tbody></table>';

    return html;
  }

  generateAppendixSection(data) {
    let html = '';

    html += '<h3>Technical Details</h3>';
    html += `<table>
<thead><tr><th>Parameter</th><th>Value</th></tr></thead>
<tbody>`;
    html += `<tr><td>Report ID</td><td><code>${this.escapeHtml(data.id || '')}</code></td></tr>`;
    html += `<tr><td>Generated</td><td>${new Date(data.timestamp).toLocaleString('en-GB')}</td></tr>`;
    html += `<tr><td>Generator</td><td>${this.escapeHtml(data.metadata?.generatedBy || 'Web Accessibility Checker v3.0')}</td></tr>`;
    html += `<tr><td>Target URL</td><td>${this.escapeHtml(data.url || '')}</td></tr>`;
    html += `<tr><td>Conformance Target</td><td>WCAG 2.1 Level AA</td></tr>`;

    if (data.scanners) {
      html += `<tr><td>Scanners Executed</td><td>${Object.keys(data.scanners).length}</td></tr>`;
    }

    html += '</tbody></table>';

    if (data.scanners) {
      html += '<h3>Scanner Results</h3>';
      html += `<table>
<thead><tr><th>Scanner</th><th>Status</th><th>Violations</th></tr></thead>
<tbody>`;
      for (const [name, s] of Object.entries(data.scanners)) {
        const status = s.passed ? 'Passed' : 'Failed';
        html += `<tr><td>${this.escapeHtml(name)}</td><td>${status}</td><td>${s.violationCount || 0}</td></tr>`;
      }
      html += '</tbody></table>';
    }

    return html;
  }

  // --- Unchanged utility methods ---

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
        pdfPath: pdfExists ? pdfPath : null,
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
        path.join(this.reportsDir, `${reportId}.pdf`),
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
              violationsCount: metadata.violations ? metadata.violations.length : 0,
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
