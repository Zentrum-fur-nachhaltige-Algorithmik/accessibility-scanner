const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const htmlPdf = require('html-pdf-node');

const DEFAULT_ORG_NAME = 'Abraham Nemeth Society for Accessible Algorithmics e.V.';

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
  if (raw === 'best-practice') return 'best-practice';
  if (raw === 'info') return 'info';
  return 'moderate';
}

/**
 * Returns true if the violation is a hard WCAG failure (not best-practice or info).
 */
function isHardViolation(violation) {
  const sev = normalizeSeverity(violation);
  return sev !== 'best-practice' && sev !== 'info';
}

const SEVERITY_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3, 'best-practice': 4, info: 5 };
const SEVERITY_LABELS = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor', 'best-practice': 'Best Practice', info: 'Info' };

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
    font-size: 0.875rem;
    line-height: 1.55;
    color: #2b2b2b;
    background: #fff;
    max-width: 60rem;
    margin: 0 auto;
    padding: 2rem clamp(0.5rem, 4vw, 2.5rem) 5rem;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }

  /* --- Screen-reader-only utility --- */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* --- Skip link --- */
  .skip-link {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
    background: #1b2a4a;
    color: #fff;
    font-size: 0.8125rem;
    text-decoration: none;
    z-index: 100;
  }
  .skip-link:focus,
  .skip-link:focus-visible {
    position: fixed;
    top: 0;
    left: 0;
    width: auto;
    height: auto;
    padding: 0.75rem 1.5rem;
    margin: 0;
    clip: auto;
    white-space: normal;
    outline: 3px solid #1b2a4a;
    outline-offset: 2px;
  }

  /* --- Typography hierarchy through weight and size only --- */
  h1, h2, h3, h4 {
    font-family: 'Source Sans Pro', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #1b2a4a;
    letter-spacing: -0.01em;
  }
  h1 { font-size: 1.375rem; font-weight: 700; margin: 0 0 0.125rem; }
  h2 { font-size: 1.125rem; font-weight: 700; margin: 1.75rem 0 0.625rem; padding-bottom: 0.25rem; border-bottom: 1.5px solid #1b2a4a; }
  h3 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.375rem; }
  h4 { font-size: 0.875rem; font-weight: 600; margin: 0.875rem 0 0.25rem; }

  p { margin: 0 0 0.5rem; }
  a { color: #1b2a4a; text-decoration: underline; }
  a:focus-visible,
  button:focus-visible,
  [tabindex]:focus-visible { outline: 3px solid #1b2a4a; outline-offset: 2px; }

  /* --- Document header (letterhead) --- */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1b2a4a;
    padding-bottom: 0.875rem;
    margin-bottom: 0.375rem;
  }
  .doc-header-left { flex: 1; padding-right: 1.5rem; }
  .doc-header-right {
    text-align: left;
    font-size: 0.75rem;
    color: #555;
    line-height: 1.6;
    min-width: 10.625rem;
    padding-left: 1rem;
    border-left: 0.5px solid #ccc;
  }
  .org-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #1b2a4a;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 0.5rem;
  }
  .org-logo {
    max-height: 2rem;
    margin-bottom: 0.375rem;
    display: block;
  }
  .doc-subtitle {
    font-size: 0.8125rem;
    color: #555;
    margin-top: 0.1875rem;
  }
  .doc-meta-line {
    margin: 0 0 0.0625rem;
    font-size: 0.75rem;
    color: #555;
  }
  .doc-meta-line.doc-id {
    font-size: 0.8125rem;
    color: #1b2a4a;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  /* --- Table of contents --- */
  .toc {
    border: 0.5px solid #999;
    padding: 0.75rem 1.125rem;
    margin: 1rem 0 1.5rem;
    background: none;
  }
  .toc-title {
    font-size: 0.8125rem;
    font-weight: 700;
    color: #1b2a4a;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 0.375rem;
  }
  .toc ol {
    margin: 0;
    padding-left: 1.4em;
    font-size: 0.8125rem;
    line-height: 1.9;
  }
  .toc ol ol { margin-top: 0; line-height: 1.7; list-style: none; padding-left: 1.6em; }
  .toc a { text-decoration: none; color: #2b2b2b; min-height: 2.75rem; display: inline-flex; align-items: center; }
  .toc a:hover,
  .toc a:focus-visible { text-decoration: underline; }

  /* --- Table captions --- */
  caption {
    caption-side: top;
    text-align: left;
    font-size: 0.8125rem;
    font-weight: 600;
    color: #1b2a4a;
    padding: 0 0 0.25rem;
    font-style: italic;
  }

  /* --- Responsive table wrapper --- */
  .table-responsive {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 0.5rem 0 0.875rem;
  }
  .table-responsive:focus-within { outline: 2px solid #1b2a4a; outline-offset: 2px; }

  /* --- Tables --- */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0 0.875rem;
    font-size: 0.8125rem;
  }
  .table-responsive table { margin: 0; }
  thead { display: table-header-group; }
  th, td {
    border: 0.5px solid #999;
    padding: 0.5rem 0.625rem;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #e8ecf2;
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #1b2a4a;
  }
  tr:nth-child(even) td { background: #f6f7f9; }

  /* --- Severity: monochrome labels, row tint for emphasis --- */
  .sev { font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; color: #2b2b2b; }
  .method-badge { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.125rem 0.3125rem; border: 1px solid #999; border-radius: 2px; }
  .method-llm { background: #f0f0f0; color: #444; }
  .method-auto { background: transparent; color: #666; border-color: #ccc; }
  tr.row-critical td { border-left: 3px solid #7a2e2e; }
  tr.row-serious td  { border-left: 3px solid #6b4a1a; }
  tr.row-moderate td { border-left: 3px solid #8a8a5a; }
  tr.row-minor td    { border-left: 3px solid #7a8a9a; }
  tr.row-critical td:first-child, tr.row-serious td:first-child,
  tr.row-moderate td:first-child, tr.row-minor td:first-child { border-left-width: 3px; }
  tr.row-critical td:not(:first-child), tr.row-serious td:not(:first-child),
  tr.row-moderate td:not(:first-child), tr.row-minor td:not(:first-child) { border-left: 0.5px solid #999; }

  /* --- Severity symbols (non-color indicator) --- */
  tr.row-critical td:first-child .sev::before,
  tr.row-critical th:first-child .sev::before { content: "\\26D4  "; }
  tr.row-serious td:first-child .sev::before,
  tr.row-serious th:first-child .sev::before  { content: "\\26A0  "; }
  tr.row-moderate td:first-child .sev::before,
  tr.row-moderate th:first-child .sev::before { content: "\\25CF  "; }
  tr.row-minor td:first-child .sev::before,
  tr.row-minor th:first-child .sev::before    { content: "\\25CB  "; }

  /* --- Table column widths (replaces inline styles) --- */
  .col-num { width: 1.75rem; }
  .col-sev { width: 3.875rem; }
  .col-criterion { width: 3.75rem; }
  .col-method { width: 3rem; }
  .col-label { text-align: left; width: 10rem; }
  .col-criteria-ref { font-size: 0.6875rem; }

  /* --- Code elements --- */
  code {
    font-family: 'Consolas', 'SF Mono', 'Monaco', monospace;
    font-size: 0.75rem;
    background: #eef0f3;
    padding: 0.0625rem 0.25rem;
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
    font-size: 0.6875rem;
    color: #555;
    margin: -0.5rem 0 0.875rem;
    line-height: 1.5;
  }

  /* --- Scope disclaimer --- */
  .scope-note {
    font-size: 0.75rem;
    color: #555;
    border-left: 2px solid #ccc;
    padding: 0.375rem 0 0.375rem 0.75rem;
    margin: 0.625rem 0 0.875rem;
    line-height: 1.5;
  }

  /* --- Running footer --- */
  .doc-footer {
    position: static;
    margin-top: 2.5rem;
    padding: 0.5rem clamp(0.5rem, 4vw, 2.5rem);
    font-size: 0.6875rem;
    color: #595959;
    border-top: 0.5px solid #ccc;
    display: flex;
    justify-content: space-between;
    background: #fff;
  }

  /* --- Mobile responsive --- */
  @media (max-width: 600px) {
    .doc-header {
      flex-direction: column;
    }
    .doc-header-left {
      padding-right: 0;
    }
    .doc-header-right {
      border-left: none;
      padding-left: 0;
      padding-top: 0.75rem;
      margin-top: 0.75rem;
      border-top: 0.5px solid #ccc;
      min-width: auto;
    }
    .doc-footer {
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.5rem 1rem;
    }
  }

  /* --- Reduced motion --- */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  /* --- Dark mode --- */
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a2e; color: #e0e0e0; }
    h1, h2, h3, h4 { color: #a8c0e0; }
    h2 { border-bottom-color: #a8c0e0; }
    a { color: #a8c0e0; }
    a:focus-visible, button:focus-visible, [tabindex]:focus-visible { outline-color: #a8c0e0; }
    .skip-link { background: #a8c0e0; color: #1a1a2e; }
    .skip-link:focus, .skip-link:focus-visible { outline-color: #a8c0e0; }
    .doc-header { border-bottom-color: #a8c0e0; }
    .org-name { color: #a8c0e0; }
    .doc-header-right { border-left-color: #555; color: #aaa; }
    .doc-meta-line { color: #aaa; }
    .doc-meta-line.doc-id { color: #a8c0e0; }
    .toc { border-color: #555; }
    .toc-title { color: #a8c0e0; }
    .toc a { color: #e0e0e0; }
    th { background: #2a2a4e; color: #a8c0e0; }
    th, td { border-color: #555; }
    tr:nth-child(even) td { background: #222240; }
    code { background: #2a2a4e; color: #e0e0e0; }
    .sev { color: #e0e0e0; }
    .method-badge { border-color: #666; }
    .method-llm { background: #2a2a4e; color: #ccc; }
    .method-auto { color: #aaa; border-color: #555; }
    .doc-footer { background: #1a1a2e; border-top-color: #555; color: #aaa; }
    .scope-note { border-left-color: #555; color: #aaa; }
    .table-note { color: #aaa; }
    caption { color: #a8c0e0; }
    .sn { color: #aaa; }
  }

  /* --- High contrast --- */
  @media (prefers-contrast: more) {
    body { color: #000; }
    th { background: #c0c8d8; }
    th, td { border-width: 1px; border-color: #000; }
    .sev { color: #000; }
    a { text-decoration-thickness: 2px; }
    .doc-header { border-bottom-width: 3px; }
    h2 { border-bottom-width: 3px; }
    tr.row-critical td { border-left-width: 5px; }
    tr.row-serious td { border-left-width: 5px; }
    tr.row-moderate td { border-left-width: 5px; }
    tr.row-minor td { border-left-width: 5px; }
  }

  /* --- Print --- */
  @page { margin: 20mm 18mm 25mm; @bottom-right { content: counter(page); font-size: 0.6875rem; color: #595959; } }
  @media print {
    body { padding: 0; max-width: none; font-size: 9pt; }
    .table-responsive { overflow: visible; }
    .skip-link { display: none; }
    .doc-footer { position: fixed; bottom: 0; left: 0; right: 0; }
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

<a href="#main-content" class="skip-link">Skip to main content</a>

<header>
<div class="doc-header">
  <div class="doc-header-left">
    {{orgLogoHtml}}
    <div class="org-name">{{orgName}}</div>
    <h1>Accessibility Audit Report</h1>
    <div class="doc-subtitle">Automated {{conformanceTarget}} Conformance Assessment</div>
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

<main id="main-content">

<h2 id="s-1"><span class="sn">1</span> Subject of Assessment</h2>

<table>
<caption>Table 1: Assessment scope</caption>
<tbody>
<tr><th scope="row" class="col-label">Target URL</th><td>{{url}}</td></tr>
<tr><th scope="row" class="col-label">Assessment Date</th><td>{{reportDate}}</td></tr>
<tr><th scope="row" class="col-label">Conformance Target</th><td>{{conformanceTarget}}</td></tr>
<tr><th scope="row" class="col-label">Overall Score</th><td>{{accessibilityScore}} of 100</td></tr>
<tr><th scope="row" class="col-label">Violations Identified</th><td>{{violationsCount}}</td></tr>
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

<footer class="doc-footer" aria-label="Document information">
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
    const allFindings = data.violations || [];
    const violationsCount = allFindings.filter(isHardViolation).length;
    const bestPracticeCount = allFindings.filter(v => !isHardViolation(v)).length;
    const passes = data.passes || 0;

    html = html.replace(/{{pageTitle}}/g, data.pageTitle || data.url || 'Unknown Page');
    html = html.replace(/{{url}}/g, this.esc(data.url || ''));
    html = html.replace(/{{reportDate}}/g, reportDate);
    html = html.replace(/{{accessibilityScore}}/g, data.accessibilityScore || 0);
    html = html.replace(/{{passes}}/g, passes);
    html = html.replace(/{{id}}/g, data.id || 'unknown');
    html = html.replace(/{{docNumber}}/g, this.esc(data.docNumber || ''));
    html = html.replace(/{{violationsCount}}/g, violationsCount);

    // Determine conformance target based on whether LLM scanners were used
    const hasLlmScanners = data.scanners && Object.keys(data.scanners).some(s => s.startsWith('llm-'));
    const conformanceTarget = hasLlmScanners ? 'WCAG 2.2 Level AAA' : 'WCAG 2.2 Level AA';
    html = html.replace(/{{conformanceTarget}}/g, conformanceTarget);
    html = html.replace(/{{orgName}}/g, this.esc(data.orgName || DEFAULT_ORG_NAME));
    html = html.replace(/{{generatedBy}}/g, this.esc(data.metadata?.generatedBy || 'Web Accessibility Checker v3.0'));

    // Passes row (only if passes > 0)
    const passesRow = passes > 0
      ? `<tr><th scope="row" class="col-label">Checks Passed</th><td>${passes}</td></tr>`
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
<nav class="toc" aria-labelledby="toc-heading">
  <p class="toc-title" id="toc-heading">Contents</p>
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
        html += `<tr class="row-${sev}"><th scope="row"><span class="sev">${SEVERITY_LABELS[sev]}</span></th><td>${counts[sev]}</td><td>${pct}%</td></tr>`;
      }
    }
    html += `<tr><th scope="row"><strong>Total</strong></th><td><strong>${total}</strong></td><td></td></tr>`;
    html += '</tbody></table>';
    html += '<p class="table-note">Severity classification per WCAG 2.2 impact assessment. Critical: barriers preventing access. Serious: significant obstacles. Moderate: degraded experience. Minor: best-practice deviations.</p>';

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
      html += `<tr><th scope="row">${name}</th>`;
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
    const hasLlm = data.scanners && Object.keys(data.scanners).some(s => s.startsWith('llm-'));
    const levelLabel = hasLlm ? 'Level AAA' : 'Level AA';
    let html = `<p>Assessment conducted via automated scanning against WCAG 2.2 ${levelLabel} success criteria per EN 301 549.</p>`;
    if (hasLlm) {
      html += '<p>This audit includes LLM-powered semantic analysis for AAA-level criteria. Findings marked <span class="method-badge method-llm" aria-label="Large Language Model analysis">LLM</span> were identified using large language model analysis and should be verified by manual review.</p>';
    }
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
    html += `<p>The following ${totalViolations} findings are grouped by WCAG 2.2 principle. Each sub-section lists violations ordered by severity.</p>`;

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
    let html = `<div class="table-responsive" tabindex="0" role="region" aria-label="${captionText || 'Data table'}">\n<table>\n`;
    if (tableNum && captionText) html += `<caption>Table ${tableNum}: ${captionText}</caption>\n`;
    const hasLlm = violations.some(v => (v.scannerId || '').startsWith('llm-'));
    html += `<thead><tr><th scope="col" class="col-num">#</th><th scope="col" class="col-sev">Severity</th><th scope="col" class="col-criterion">Criterion</th>${hasLlm ? '<th scope="col" class="col-method">Method</th>' : ''}<th scope="col">Finding</th><th scope="col">Element</th><th scope="col">Remediation</th></tr></thead>
<tbody>`;

    violations.forEach((v, i) => {
      const sev = normalizeSeverity(v);
      const criterion = v.criterion || v.wcagCriteria || v.clause || '';
      const desc = this.esc(v.description || v.type || v.issue || '');
      const el = v.element ? `<code>${this.esc(v.element)}</code>` : '\u2014';
      const rec = this.esc(v.recommendation || v.suggestion || '\u2014');
      const isLlm = (v.scannerId || '').startsWith('llm-');
      const methodCol = hasLlm ? `<td><span class="method-badge method-${isLlm ? 'llm' : 'auto'}">${isLlm ? 'LLM' : 'Auto'}</span></td>` : '';
      html += `<tr class="row-${sev}"><th scope="row">${i + 1}</th><td><span class="sev">${SEVERITY_LABELS[sev]}</span></td><td>${this.esc(String(criterion)) || '\u2014'}</td>${methodCol}<td>${desc}</td><td>${el}</td><td>${rec}</td></tr>`;
    });

    html += '</tbody></table></div>';
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
        html += `<tr class="row-${sev}"><th scope="row">${i + 1}</th><td><span class="sev">${SEVERITY_LABELS[sev]}</span></td><td>${this.esc(v.clause || '')}</td><td>${this.esc(v.description || '')}</td></tr>`;
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
      html += `<tr><th scope="row">${i + 1}</th><td>${r.p}</td><td><span class="col-criteria-ref">${this.esc(r.ref)}</span></td><td>${this.esc(r.text)}</td></tr>`;
    });
    html += '</tbody></table>';

    return html;
  }

  generateAppendixSection(data) {
    const tBase = this._tableCounter || 10;
    let tNum = tBase;

    let html = `<h3 id="s-app-1"><span class="sn">A.1</span> Report Parameters</h3>`;
    html += `<table>\n<caption>Table ${tNum}: Technical parameters</caption>\n<tbody>`;
    html += `<tr><th scope="row" class="col-label">Report ID</th><td><code>${this.esc(data.id || '')}</code></td></tr>`;
    html += `<tr><th scope="row" class="col-label">Document Number</th><td>${this.esc(data.docNumber || '')}</td></tr>`;
    html += `<tr><th scope="row" class="col-label">Generated</th><td>${new Date(data.timestamp).toLocaleString('en-GB')}</td></tr>`;
    html += `<tr><th scope="row" class="col-label">Generator</th><td>${this.esc(data.metadata?.generatedBy || 'Web Accessibility Checker v3.0')}</td></tr>`;
    html += `<tr><th scope="row" class="col-label">Target</th><td>${this.esc(data.url || '')}</td></tr>`;
    const appLlm = data.scanners && Object.keys(data.scanners).some(s => s.startsWith('llm-'));
    html += `<tr><th scope="row" class="col-label">Standard</th><td>WCAG 2.2 ${appLlm ? 'Level AAA' : 'Level AA'} / EN 301 549</td></tr>`;
    if (data.scanners) html += `<tr><th scope="row" class="col-label">Modules Executed</th><td>${Object.keys(data.scanners).length}</td></tr>`;
    html += '</tbody></table>';
    tNum++;

    if (data.scanners) {
      html += `<h3 id="s-app-2"><span class="sn">A.2</span> Scanner Module Results</h3>`;
      html += `<table>\n<caption>Table ${tNum}: Individual scanner outcomes</caption>\n<thead><tr><th scope="col">Module</th><th scope="col">Result</th><th scope="col">Findings</th></tr></thead>\n<tbody>`;
      for (const [name, s] of Object.entries(data.scanners)) {
        html += `<tr><th scope="row">${this.esc(name)}</th><td>${s.passed ? '\u2713 Pass' : '\u2717 Fail'}</td><td>${s.violationCount || 0}</td></tr>`;
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
