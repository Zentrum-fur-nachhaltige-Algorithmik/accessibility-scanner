const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const htmlPdf = require('html-pdf-node');

const DEFAULT_ORG_NAME = 'Zentrum f\u00fcr nachhaltige Algorithmik und Intelligenzforschung e.V.';

function classifyWcagPrinciple(violation) {
  const criterion = violation.criterion || violation.wcagCriteria || violation.clause || '';
  const str = String(criterion);
  if (str.startsWith('EAA-')) return 'eaa';
  const match = str.match(/^(?:9\.)?([1-4])\./);
  if (match) {
    const p = parseInt(match[1], 10);
    if (p === 1) return 'perceivable';
    if (p === 2) return 'operable';
    if (p === 3) return 'understandable';
    if (p === 4) return 'robust';
  }
  return 'other';
}

function normalizeSeverity(violation) {
  const raw = (violation.severity || violation.impact || 'moderate').toLowerCase();
  if (raw === 'critical' || raw === 'error') return 'critical';
  if (raw === 'serious' || raw === 'major' || raw === 'high') return 'serious';
  if (raw === 'moderate' || raw === 'warning') return 'moderate';
  if (raw === 'minor') return 'minor';
  return 'moderate';
}

const SEVERITY_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const SEVERITY_LABELS = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

function formatDocNumber(id) {
  const short = id.split('-')[0].toUpperCase();
  const now = new Date();
  return `ACC-${now.getFullYear()}-${short}`;
}

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
      docNumber: formatDocNumber(reportId),
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

      return { reportId, htmlPath, pdfPath, reportUrl: `/api/report/${reportId}`, pdfUrl: pdfPath ? `/api/report/${reportId}/pdf` : null, timestamp };
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
      const options = { format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '25mm', left: '18mm', right: '18mm' } };
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
    if (reportData.headingStructure && reportData.euCompliance) templateName = 'screen-reader-report.html';
    else if (reportData.categories && reportData.wcagCompliance) templateName = 'enhanced-report.html';

    const templatePath = path.join(this.templatesDir, templateName);
    try {
      return await fs.readFile(templatePath, 'utf8');
    } catch (error) {
      return this.createDefaultTemplate();
    }
  }

  createDefaultTemplate() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{docNumber}} — Accessibility Audit Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Source Sans Pro', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.55;
    color: #2b2b2b;
    background: #fff;
    max-width: 210mm;
    margin: 0 auto;
    padding: 32px 40px 80px;
  }

  /* --- Skip link --- */
  .skip-link {
    position: absolute;
    top: -100%;
    left: 0;
    padding: 4px 12px;
    background: #1b2a4a;
    color: #fff;
    font-size: 9pt;
    text-decoration: none;
    z-index: 100;
  }
  .skip-link:focus { top: 0; outline: 2px solid #fff; outline-offset: -2px; }

  /* --- Typography hierarchy through weight and size only --- */
  h1, h2, h3, h4 {
    font-family: 'Source Sans Pro', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #1b2a4a;
    letter-spacing: -0.01em;
  }
  h1 { font-size: 15pt; font-weight: 700; margin: 0 0 2px; }
  h2 { font-size: 12pt; font-weight: 700; margin: 28px 0 10px; padding-bottom: 4px; border-bottom: 1.5px solid #1b2a4a; }
  h3 { font-size: 10.5pt; font-weight: 600; margin: 20px 0 6px; }
  h4 { font-size: 10pt; font-weight: 600; margin: 14px 0 4px; }

  p { margin: 0 0 8px; }
  a { color: #1b2a4a; text-decoration: underline; }
  a:focus-visible { outline: 2px solid #1b2a4a; outline-offset: 2px; }

  /* --- Document header (letterhead) --- */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1b2a4a;
    padding-bottom: 14px;
    margin-bottom: 6px;
  }
  .doc-header-left { flex: 1; padding-right: 24px; }
  .doc-header-right {
    text-align: left;
    font-size: 8pt;
    color: #555;
    line-height: 1.6;
    min-width: 170px;
    padding-left: 16px;
    border-left: 0.5px solid #ccc;
  }
  .org-name {
    font-size: 8.5pt;
    font-weight: 600;
    color: #1b2a4a;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 8px;
  }
  .org-logo {
    max-height: 32px;
    margin-bottom: 6px;
    display: block;
  }
  .doc-subtitle {
    font-size: 9pt;
    color: #555;
    margin-top: 3px;
  }
  .doc-meta-line {
    margin: 0 0 1px;
    font-size: 8pt;
    color: #555;
  }
  .doc-meta-line.doc-id {
    font-size: 8.5pt;
    color: #1b2a4a;
    font-weight: 600;
    margin-bottom: 4px;
  }

  /* --- Table of contents --- */
  .toc {
    border: 0.5px solid #999;
    padding: 12px 18px;
    margin: 16px 0 24px;
    background: none;
  }
  .toc-title {
    font-size: 9pt;
    font-weight: 700;
    color: #1b2a4a;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 6px;
  }
  .toc ol {
    margin: 0;
    padding-left: 1.4em;
    font-size: 9pt;
    line-height: 1.9;
  }
  .toc ol ol { margin-top: 0; line-height: 1.7; list-style: none; padding-left: 1.6em; }
  .toc a { text-decoration: none; color: #2b2b2b; }
  .toc a:hover { text-decoration: underline; }

  /* --- Table captions --- */
  caption {
    caption-side: top;
    text-align: left;
    font-size: 8.5pt;
    font-weight: 600;
    color: #1b2a4a;
    padding: 0 0 4px;
    font-style: italic;
  }

  /* --- Tables --- */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 14px;
    font-size: 9pt;
  }
  thead { display: table-header-group; }
  th, td {
    border: 0.5px solid #999;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #e8ecf2;
    font-weight: 600;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #1b2a4a;
  }
  tr:nth-child(even) td { background: #f6f7f9; }

  /* --- Severity: monochrome labels, row tint for emphasis --- */
  .sev { font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.03em; color: #2b2b2b; }
  tr.row-critical td { border-left: 3px solid #7a2e2e; }
  tr.row-serious td  { border-left: 3px solid #6b4a1a; }
  tr.row-moderate td { border-left: 3px solid #8a8a5a; }
  tr.row-minor td    { border-left: 3px solid #7a8a9a; }
  tr.row-critical td:first-child, tr.row-serious td:first-child,
  tr.row-moderate td:first-child, tr.row-minor td:first-child { border-left-width: 3px; }
  tr.row-critical td:not(:first-child), tr.row-serious td:not(:first-child),
  tr.row-moderate td:not(:first-child), tr.row-minor td:not(:first-child) { border-left: 0.5px solid #999; }

  /* --- Code elements --- */
  code {
    font-family: 'Consolas', 'SF Mono', 'Monaco', monospace;
    font-size: 8pt;
    background: #eef0f3;
    padding: 1px 4px;
    color: #2b2b2b;
    overflow-wrap: break-word;
    word-break: normal;
  }

  /* --- Section numbering --- */
  .sn {
    color: #595959;
    margin-right: 0.3em;
    font-weight: 400;
  }

  /* --- Table footnotes --- */
  .table-note {
    font-size: 7.5pt;
    color: #555;
    margin: -8px 0 14px;
    line-height: 1.5;
  }

  /* --- Scope disclaimer --- */
  .scope-note {
    font-size: 8pt;
    color: #555;
    border-left: 2px solid #ccc;
    padding: 6px 0 6px 12px;
    margin: 10px 0 14px;
    line-height: 1.5;
  }

  /* --- Running footer --- */
  .doc-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 8px 40px;
    font-size: 7pt;
    color: #595959;
    border-top: 0.5px solid #ccc;
    display: flex;
    justify-content: space-between;
    background: #fff;
  }

  /* --- Print --- */
  @page { margin: 20mm 18mm 25mm; @bottom-right { content: counter(page); font-size: 7pt; color: #595959; } }
  @media print {
    body { padding: 0; max-width: none; font-size: 9pt; }
    .skip-link { display: none; }
    .doc-footer { position: fixed; }
    .toc { break-after: page; }
    h2 { break-before: page; break-after: avoid; }
    h3, h4 { break-after: avoid; }
    table { break-inside: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th { background: #e8ecf2 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr:nth-child(even) td { background: #f6f7f9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr.row-critical td, tr.row-serious td, tr.row-moderate td, tr.row-minor td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    a { color: #2b2b2b; }
  }
</style>
</head>
<body>

<a href="#s-1" class="skip-link">Skip to content</a>

<header>
<div class="doc-header">
  <div class="doc-header-left">
    {{orgLogoHtml}}
    <div class="org-name" lang="de">{{orgName}}</div>
    <h1>Accessibility Audit Report</h1>
    <div class="doc-subtitle">Automated WCAG 2.1 Level AA Conformance Assessment</div>
  </div>
  <div class="doc-header-right">
    <p class="doc-meta-line doc-id">{{docNumber}}</p>
    <p class="doc-meta-line">Date: {{reportDate}}</p>
    <p class="doc-meta-line">Version 1.0</p>
    {{orgContactHtml}}
  </div>
</div>
</header>

{{tocSection}}

<main>

<h2 id="s-1"><span class="sn">1</span> Subject of Assessment</h2>

<table>
<caption>Table 1: Assessment scope</caption>
<tbody>
<tr><th scope="row" style="width:160px;text-align:left">Target URL</th><td>{{url}}</td></tr>
<tr><th scope="row" style="text-align:left">Assessment Date</th><td>{{reportDate}}</td></tr>
<tr><th scope="row" style="text-align:left">Conformance Target</th><td>WCAG 2.1 Level AA</td></tr>
<tr><th scope="row" style="text-align:left">Overall Score</th><td>{{accessibilityScore}} of 100</td></tr>
<tr><th scope="row" style="text-align:left">Violations Identified</th><td>{{violationsCount}}</td></tr>
{{passesRow}}
</tbody>
</table>

<h2 id="s-2"><span class="sn">2</span> Summary of Findings</h2>

{{severityDistribution}}

{{principleScoresTable}}

<h2 id="s-3"><span class="sn">3</span> Methodology</h2>

{{methodologySection}}

{{findingsSection}}

{{euComplianceSection}}

{{recommendationsSection}}

<h2 id="s-app"><span class="sn">A</span> Appendix: Technical Metadata</h2>

{{appendixSection}}

</main>

<footer class="doc-footer" lang="de">
  <span>{{orgName}} — {{docNumber}}</span>
  <span>{{reportDate}}</span>
</footer>

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

    const reportDate = new Date(data.timestamp).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const violationsCount = data.violations ? data.violations.length : 0;
    const passes = data.passes || 0;

    html = html.replace(/{{pageTitle}}/g, data.pageTitle || data.url || 'Unknown Page');
    html = html.replace(/{{url}}/g, this.esc(data.url || ''));
    html = html.replace(/{{reportDate}}/g, reportDate);
    html = html.replace(/{{accessibilityScore}}/g, data.accessibilityScore || 0);
    html = html.replace(/{{passes}}/g, passes);
    html = html.replace(/{{id}}/g, data.id || 'unknown');
    html = html.replace(/{{docNumber}}/g, this.esc(data.docNumber || ''));
    html = html.replace(/{{violationsCount}}/g, violationsCount);
    html = html.replace(/{{orgName}}/g, this.esc(data.orgName || DEFAULT_ORG_NAME));
    html = html.replace(/{{generatedBy}}/g, this.esc(data.metadata?.generatedBy || 'Web Accessibility Checker v3.0'));

    // Passes row (only if passes > 0)
    const passesRow = passes > 0
      ? `<tr><th scope="row" style="text-align:left">Checks Passed</th><td>${passes}</td></tr>`
      : '';
    html = html.replace(/{{passesRow}}/g, passesRow);

    // Org logo
    html = html.replace(/{{orgLogoHtml}}/g, data.orgLogo ? `<img class="org-logo" src="${this.esc(data.orgLogo)}" alt="${this.esc(data.orgName || 'Organization')} logo">` : '');

    // Org contact
    html = html.replace(/{{orgContactHtml}}/g, data.orgContact ? `<p class="doc-meta-line">${this.esc(data.orgContact)}</p>` : '');

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

  esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Section generators ---

  generateTocSection(data) {
    const groups = this.groupViolationsByPrinciple(data.violations || []);
    const hasEu = (groups.eaa || []).length > 0 || !!data.euCompliance;

    let sub = '';
    let i = 1;
    for (const [key, label] of [['perceivable', 'Perceivable'], ['operable', 'Operable'], ['understandable', 'Understandable'], ['robust', 'Robust']]) {
      sub += `<li><a href="#s-4-${i}">4.${i} ${label}</a></li>\n`;
      i++;
    }
    const meaningfulOther = (groups.other || []).filter(v => (v.description || v.type || v.issue || '').trim());
    if (meaningfulOther.length > 0) sub += `<li><a href="#s-4-5">4.5 Other Findings</a></li>\n`;

    return `
<nav class="toc" aria-label="Table of contents">
  <h2 class="toc-title" id="toc-heading">Contents</h2>
  <ol>
    <li><a href="#s-1">Subject of Assessment</a></li>
    <li><a href="#s-2">Summary of Findings</a></li>
    <li><a href="#s-3">Methodology</a></li>
    <li><a href="#s-4">Detailed Findings</a>
      <ol>${sub}</ol>
    </li>
    ${hasEu ? '<li><a href="#s-5">EU/EAA Compliance</a></li>' : ''}
    <li><a href="#s-6">Recommended Actions</a></li>
    <li><a href="#s-app">Appendix: Technical Metadata</a></li>
  </ol>
</nav>`;
  }

  generateSeverityDistribution(data) {
    if (!data.violations || data.violations.length === 0) return '';

    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    data.violations.forEach(v => { counts[normalizeSeverity(v)]++; });
    const total = data.violations.length;

    let html = `<table>
<caption>Table 2: Severity distribution</caption>
<thead><tr><th scope="col">Classification</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead>
<tbody>`;
    for (const sev of ['critical', 'serious', 'moderate', 'minor']) {
      if (counts[sev] > 0) {
        const pct = ((counts[sev] / total) * 100).toFixed(0);
        html += `<tr class="row-${sev}"><td><span class="sev">${SEVERITY_LABELS[sev]}</span></td><td>${counts[sev]}</td><td>${pct}%</td></tr>`;
      }
    }
    html += `<tr><td><strong>Total</strong></td><td><strong>${total}</strong></td><td></td></tr>`;
    html += '</tbody></table>';
    html += '<p class="table-note">Severity classification per WCAG 2.1 impact assessment. Critical: barriers preventing access. Serious: significant obstacles. Moderate: degraded experience. Minor: best-practice deviations.</p>';

    return html;
  }

  generatePrincipleScoresTable(data, getScoreClass) {
    const groups = this.groupViolationsByPrinciple(data.violations || []);
    const cats = data.categories || {};
    const principles = [['Perceivable', 'perceivable'], ['Operable', 'operable'], ['Understandable', 'understandable'], ['Robust', 'robust']];
    const hasScores = principles.some(([, key]) => cats[key]?.score != null);

    let html = '<table>\n<caption>Table 3: Findings by WCAG principle</caption>\n<thead><tr><th scope="col">WCAG Principle</th>';
    if (hasScores) html += '<th scope="col">Score</th>';
    html += '<th scope="col">Violations</th></tr></thead>\n<tbody>';

    for (const [name, key] of principles) {
      const cat = cats[key];
      const violations = (groups[key] || []).length;
      html += `<tr><td>${name}</td>`;
      if (hasScores) {
        const score = cat?.score != null ? cat.score : '\u2014';
        html += `<td>${score}${typeof score === 'number' ? '%' : ''}</td>`;
      }
      html += `<td>${violations}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  generateMethodologySection(data) {
    let html = '<p>Assessment conducted via automated scanning against WCAG 2.1 Level AA success criteria per EN 301 549.</p>';
    html += '<div class="scope-note">This report documents machine-detectable violations only. Automated testing covers approximately 30\u201340% of WCAG success criteria. A full conformance evaluation requires additional manual expert review, assistive technology testing, and user testing. Findings should be interpreted as a lower bound of existing barriers.</div>';

    if (data.scanners && Object.keys(data.scanners).length > 0) {
      const names = Object.keys(data.scanners);
      const passed = names.filter(s => data.scanners[s].passed).length;
      const failed = names.filter(s => !data.scanners[s].passed);

      html += `<p>${names.length} scanner modules executed. ${passed} passed without findings.</p>`;

      // Summarize where findings concentrated
      if (failed.length > 0) {
        const top = failed
          .map(n => ({ name: n, count: data.scanners[n].violationCount || 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
        html += `<p>Findings concentrated in: ${top.map(t => `${t.name} (${t.count})`).join(', ')}.</p>`;
      }
    }
    return html;
  }

  groupViolationsByPrinciple(violations) {
    const groups = { perceivable: [], operable: [], understandable: [], robust: [], eaa: [], other: [] };
    for (const v of violations) groups[classifyWcagPrinciple(v)].push(v);
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (SEVERITY_ORDER[normalizeSeverity(a)] || 2) - (SEVERITY_ORDER[normalizeSeverity(b)] || 2));
    }
    return groups;
  }

  generateFindingsSection(data) {
    if (!data.violations || data.violations.length === 0) {
      return '<h2 id="s-4"><span class="sn">4</span> Detailed Findings</h2>\n<p>No violations identified.</p>';
    }

    const groups = this.groupViolationsByPrinciple(data.violations);
    const totalViolations = data.violations.length;
    let html = '<h2 id="s-4"><span class="sn">4</span> Detailed Findings</h2>';
    html += `<p>The following ${totalViolations} findings are grouped by WCAG 2.1 principle. Each sub-section lists violations ordered by severity.</p>`;

    const sections = [
      ['perceivable', 'Perceivable', '4.1'],
      ['operable', 'Operable', '4.2'],
      ['understandable', 'Understandable', '4.3'],
      ['robust', 'Robust', '4.4'],
    ];

    let tableCounter = 4; // Tables 1-3 are in earlier sections
    let i = 1;
    for (const [key, label, num] of sections) {
      const v = groups[key] || [];
      html += `<h3 id="s-4-${i}"><span class="sn">${num}</span> ${label}</h3>`;
      if (v.length === 0) {
        html += '<p>No findings.</p>';
      } else {
        html += this.renderViolationTable(v, tableCounter, `${label} findings`);
        tableCounter++;
      }
      i++;
    }

    // Only show "Other" if there are violations with actual descriptions
    const meaningfulOther = groups.other.filter(v => (v.description || v.type || v.issue || '').trim());
    if (meaningfulOther.length > 0) {
      html += `<h3 id="s-4-5"><span class="sn">4.5</span> Other Findings</h3>`;
      html += this.renderViolationTable(meaningfulOther, tableCounter, 'Other findings');
      tableCounter++;
    }

    this._tableCounter = tableCounter;
    return html;
  }

  renderViolationTable(violations, tableNum, captionText) {
    let html = `<table>\n`;
    if (tableNum && captionText) html += `<caption>Table ${tableNum}: ${captionText}</caption>\n`;
    html += `<thead><tr><th scope="col" style="width:28px">#</th><th scope="col" style="width:62px">Severity</th><th scope="col" style="width:60px">Criterion</th><th scope="col">Finding</th><th scope="col">Element</th><th scope="col">Remediation</th></tr></thead>
<tbody>`;

    violations.forEach((v, i) => {
      const sev = normalizeSeverity(v);
      const criterion = v.criterion || v.wcagCriteria || v.clause || '';
      const desc = this.esc(v.description || v.type || v.issue || '');
      const el = v.element ? `<code>${this.esc(v.element)}</code>` : '\u2014';
      const rec = this.esc(v.recommendation || v.suggestion || '\u2014');
      html += `<tr class="row-${sev}"><td>${i + 1}</td><td><span class="sev">${SEVERITY_LABELS[sev]}</span></td><td>${this.esc(String(criterion)) || '\u2014'}</td><td>${desc}</td><td>${el}</td><td>${rec}</td></tr>`;
    });

    html += '</tbody></table>';
    return html;
  }

  generateEuComplianceSection(data) {
    const groups = this.groupViolationsByPrinciple(data.violations || []);
    const eaaViolations = groups.eaa || [];
    const hasLegacyEu = data.euCompliance?.en301549;
    if (!hasLegacyEu && eaaViolations.length === 0) return '';

    let html = '<h2 id="s-5"><span class="sn">5</span> EU/EAA Compliance</h2>';
    html += '<p>Assessment of compliance with the European Accessibility Act (EAA) and EN 301 549 procedural requirements.</p>';

    if (hasLegacyEu) {
      html += `<p>EN 301 549 compliance score: ${data.euCompliance.en301549.score || 0} of 100.</p>`;
    }

    if (eaaViolations.length > 0) {
      const tNum = this._tableCounter || 8;
      this._tableCounter = tNum + 1;
      html += this.renderViolationTable(eaaViolations, tNum, 'EU/EAA compliance findings');
    } else if (hasLegacyEu && data.euCompliance.en301549.violations?.length > 0) {
      const violations = data.euCompliance.en301549.violations;
      html += '<table>\n<caption>EU/EAA compliance findings</caption>\n<thead><tr><th scope="col">#</th><th scope="col">Severity</th><th scope="col">Clause</th><th scope="col">Finding</th></tr></thead>\n<tbody>';
      violations.forEach((v, i) => {
        const sev = normalizeSeverity(v);
        html += `<tr class="row-${sev}"><td>${i + 1}</td><td><span class="sev">${SEVERITY_LABELS[sev]}</span></td><td>${this.esc(v.clause || '')}</td><td>${this.esc(v.description || '')}</td></tr>`;
      });
      html += '</tbody></table>';
    }

    return html;
  }

  generateRecommendationsSection(data) {
    if (!data.violations || data.violations.length === 0) {
      return '<h2 id="s-6"><span class="sn">6</span> Recommended Actions</h2>\n<p>No actions required.</p>';
    }

    const groups = this.groupViolationsByPrinciple(data.violations);

    const collectCriteria = (violations) => {
      const c = new Set();
      violations.forEach(v => { const k = v.criterion || v.wcagCriteria || v.clause || ''; if (k) c.add(String(k)); });
      return [...c];
    };

    const recs = [];

    // Critical first (EAA gaps), then High (perceivable/operable), then Medium
    if (groups.eaa.length > 0) {
      const c = collectCriteria(groups.eaa);
      recs.push({ p: 'Critical', ref: c.join(', '), text: `${groups.eaa.length} EU EAA compliance gaps. Publish accessibility statement, establish feedback mechanism and monitoring procedures.` });
    }
    if (groups.perceivable.length > 0) {
      const c = collectCriteria(groups.perceivable);
      recs.push({ p: 'High', ref: c.join(', '), text: `${groups.perceivable.length} perceivable findings. Review non-text content alternatives and information structure.` });
    }
    if (groups.operable.length > 0) {
      const c = collectCriteria(groups.operable);
      recs.push({ p: 'High', ref: c.join(', '), text: `${groups.operable.length} operable findings. Verify keyboard access, focus indicators, link purpose.` });
    }
    if (groups.understandable.length > 0) {
      const c = collectCriteria(groups.understandable);
      recs.push({ p: 'Medium', ref: c.join(', '), text: `${groups.understandable.length} understandable findings. Set page language attribute, review navigation consistency.` });
    }
    if (groups.robust.length > 0) {
      const c = collectCriteria(groups.robust);
      recs.push({ p: 'Medium', ref: c.join(', '), text: `${groups.robust.length} robustness findings. Correct parsing errors and ARIA attribute usage.` });
    }

    const recTableNum = this._tableCounter || 9;
    this._tableCounter = recTableNum + 1;
    let html = '<h2 id="s-6"><span class="sn">6</span> Recommended Actions</h2>';
    html += `<table>\n<caption>Table ${recTableNum}: Prioritised remediation actions</caption>\n<thead><tr><th scope="col">#</th><th scope="col">Priority</th><th scope="col">Criteria</th><th scope="col">Action</th></tr></thead>\n<tbody>`;
    recs.forEach((r, i) => {
      html += `<tr><td>${i + 1}</td><td>${r.p}</td><td><span style="font-size:7.5pt">${this.esc(r.ref)}</span></td><td>${this.esc(r.text)}</td></tr>`;
    });
    html += '</tbody></table>';

    return html;
  }

  generateAppendixSection(data) {
    const tBase = this._tableCounter || 10;
    let tNum = tBase;

    let html = `<h3 id="s-app-1"><span class="sn">A.1</span> Report Parameters</h3>`;
    html += `<table>\n<caption>Table ${tNum}: Technical parameters</caption>\n<tbody>`;
    html += `<tr><th scope="row" style="text-align:left;width:160px">Report ID</th><td><code>${this.esc(data.id || '')}</code></td></tr>`;
    html += `<tr><th scope="row" style="text-align:left">Document Number</th><td>${this.esc(data.docNumber || '')}</td></tr>`;
    html += `<tr><th scope="row" style="text-align:left">Generated</th><td>${new Date(data.timestamp).toLocaleString('en-GB')}</td></tr>`;
    html += `<tr><th scope="row" style="text-align:left">Generator</th><td>${this.esc(data.metadata?.generatedBy || 'Web Accessibility Checker v3.0')}</td></tr>`;
    html += `<tr><th scope="row" style="text-align:left">Target</th><td>${this.esc(data.url || '')}</td></tr>`;
    html += `<tr><th scope="row" style="text-align:left">Standard</th><td>WCAG 2.1 Level AA / EN 301 549</td></tr>`;
    if (data.scanners) html += `<tr><th scope="row" style="text-align:left">Modules Executed</th><td>${Object.keys(data.scanners).length}</td></tr>`;
    html += '</tbody></table>';
    tNum++;

    if (data.scanners) {
      html += `<h3 id="s-app-2"><span class="sn">A.2</span> Scanner Module Results</h3>`;
      html += `<table>\n<caption>Table ${tNum}: Individual scanner outcomes</caption>\n<thead><tr><th scope="col">Module</th><th scope="col">Result</th><th scope="col">Findings</th></tr></thead>\n<tbody>`;
      for (const [name, s] of Object.entries(data.scanners)) {
        html += `<tr><td>${this.esc(name)}</td><td>${s.passed ? 'Pass' : 'Fail'}</td><td>${s.violationCount || 0}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    return html;
  }

  // --- Utility methods ---

  async getReport(reportId) {
    const metadataPath = path.join(this.reportsDir, `${reportId}.json`);
    try {
      const metadata = await fs.readJson(metadataPath);
      const htmlPath = path.join(this.reportsDir, `${reportId}.html`);
      const pdfPath = path.join(this.reportsDir, `${reportId}.pdf`);
      return {
        metadata,
        htmlPath: (await fs.pathExists(htmlPath)) ? htmlPath : null,
        pdfPath: (await fs.pathExists(pdfPath)) ? pdfPath : null,
      };
    } catch (error) {
      throw new Error(`Report not found: ${reportId}`);
    }
  }

  async deleteReport(reportId) {
    try {
      const files = [`${reportId}.json`, `${reportId}.html`, `${reportId}.pdf`].map(f => path.join(this.reportsDir, f));
      await Promise.all(files.map(f => fs.remove(f).catch(() => {})));
      return true;
    } catch (error) {
      console.error('Error deleting report:', error);
      return false;
    }
  }

  async listReports(limit = 50) {
    try {
      const files = await fs.readdir(this.reportsDir);
      const reports = await Promise.all(
        files.filter(f => f.endsWith('.json')).slice(0, limit).map(async (file) => {
          try {
            const m = await fs.readJson(path.join(this.reportsDir, file));
            return { id: m.id, timestamp: m.timestamp, url: m.url, score: m.accessibilityScore, violationsCount: m.violations ? m.violations.length : 0 };
          } catch (e) { return null; }
        })
      );
      return reports.filter(Boolean).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Error listing reports:', error);
      return [];
    }
  }
}

module.exports = ReportGenerator;
