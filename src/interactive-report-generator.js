const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Interactive Report Generator - Phase 1: Screenshot + Basic Overlays
 * 
 * Generates interactive HTML reports with screenshot-based violation mapping
 */
class InteractiveReportGenerator {
  constructor() {
    this.reportsDir = path.join(__dirname, '../reports');
    this.templatesDir = path.join(__dirname, '../templates');
    this.screenshotDir = path.join(__dirname, '../tmp/interactive-screenshots');
    this.ensureDirectories();
  }

  async ensureDirectories() {
    await fs.ensureDir(this.reportsDir);
    await fs.ensureDir(this.templatesDir);
    await fs.ensureDir(this.screenshotDir);
  }

  /**
   * Main entry point for generating interactive reports
   */
  async generateInteractiveReport(page, violations, scanMetadata, options = {}) {
    const reportId = `interactive-${uuidv4()}`;
    const reportDir = path.join(this.reportsDir, reportId);
    await fs.ensureDir(reportDir);
    await fs.ensureDir(path.join(reportDir, 'data'));
    await fs.ensureDir(path.join(reportDir, 'assets'));

    console.log(`📸 Generating interactive report: ${reportId}`);

    try {
      // Phase 1: Capture screenshot and element positions
      const screenshotData = await this.captureScreenshotWithElements(page, reportDir);
      
      // Phase 1: Map violations to positions
      const violationOverlays = await this.mapViolationsToPositions(violations, screenshotData.elementMap);
      
      // Phase 1: Generate interactive HTML
      const reportData = {
        reportId,
        timestamp: new Date().toISOString(),
        url: scanMetadata.url,
        scanMetadata,
        screenshotData,
        violations,
        violationOverlays,
        summary: this.generateSummary(violations)
      };

      const htmlContent = await this.generateInteractiveHTML(reportData);
      const htmlPath = path.join(reportDir, 'index.html');
      await fs.writeFile(htmlPath, htmlContent);

      // Save data files
      await this.saveDataFiles(reportDir, reportData);

      // Copy assets
      await this.copyAssets(reportDir);

      console.log(`✅ Interactive report generated: ${reportId}`);
      
      return {
        reportId,
        reportDir,
        htmlPath,
        reportUrl: `/reports/${reportId}/index.html`,
        timestamp: reportData.timestamp,
        summary: reportData.summary
      };

    } catch (error) {
      console.error('Error generating interactive report:', error);
      throw new Error(`Failed to generate interactive report: ${error.message}`);
    }
  }

  /**
   * Capture full-page screenshot and map all element positions
   */
  async captureScreenshotWithElements(page, reportDir) {
    console.log('📸 Capturing screenshot and element positions...');

    // Capture full-page screenshot
    const screenshotPath = path.join(reportDir, 'data', 'screenshot.png');
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: 'png'
    });

    // Get viewport dimensions
    const viewport = await page.viewport();

    // Extract element positions and metadata
    const elementMap = await page.evaluate(() => {
      const elements = [];
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        
        // Only include elements that are visible and have dimensions
        if (rect.width > 0 && rect.height > 0) {
          const selector = generateSelector(element);
          
          elements.push({
            id: `element-${index}`,
            selector,
            tagName: element.tagName.toLowerCase(),
            bounds: {
              x: rect.left + window.scrollX,
              y: rect.top + window.scrollY,
              width: rect.width,
              height: rect.height,
              left: rect.left + window.scrollX,
              top: rect.top + window.scrollY,
              right: rect.right + window.scrollX,
              bottom: rect.bottom + window.scrollY
            },
            attributes: {
              id: element.id,
              class: element.className,
              'aria-label': element.getAttribute('aria-label'),
              'aria-labelledby': element.getAttribute('aria-labelledby'),
              'role': element.getAttribute('role'),
              'alt': element.getAttribute('alt'),
              'title': element.getAttribute('title')
            },
            text: element.textContent?.trim().substring(0, 100),
            isVisible: true,
            zIndex: window.getComputedStyle(element).zIndex
          });
        }
      });

      // Helper function to generate unique CSS selector
      function generateSelector(element) {
        if (element.id) {
          return `#${element.id}`;
        }
        
        let selector = element.tagName.toLowerCase();
        
        if (element.className) {
          const classes = element.className.split(' ').filter(c => c.trim());
          if (classes.length > 0) {
            selector += '.' + classes.slice(0, 2).join('.');
          }
        }
        
        // Add nth-child if needed for uniqueness
        const parent = element.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            sibling => sibling.tagName === element.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(element) + 1;
            selector += `:nth-child(${index})`;
          }
        }
        
        return selector;
      }

      return elements;
    });

    console.log(`📊 Mapped ${elementMap.length} elements`);

    return {
      screenshotPath: 'data/screenshot.png',
      elementMap,
      viewport,
      pageHeight: await page.evaluate(() => document.body.scrollHeight),
      pageWidth: await page.evaluate(() => document.body.scrollWidth)
    };
  }

  /**
   * Map violations to element positions for overlay rendering
   */
  async mapViolationsToPositions(violations, elementMap) {
    console.log(`🎯 Mapping ${violations.length} violations to positions...`);

    const violationOverlays = [];

    violations.forEach((violation, violationIndex) => {
      // Handle multiple nodes per violation
      if (violation.nodes && violation.nodes.length > 0) {
        violation.nodes.forEach((node, nodeIndex) => {
          const targetSelectors = node.target || [];
          let targetElement = null;

          // Try to find matching element using various strategies
          for (const selectorArray of targetSelectors) {
            const selector = Array.isArray(selectorArray) ? selectorArray.join(' ') : selectorArray;
            
            targetElement = elementMap.find(el => {
              return el.selector === selector ||
                     el.selector.includes(selector) ||
                     selector.includes(el.selector) ||
                     (el.attributes.id && selector.includes('#' + el.attributes.id)) ||
                     (el.attributes.class && selector.includes('.' + el.attributes.class.split(' ')[0]));
            });

            if (targetElement) break;
          }

          // Fallback: try to match by tag name and position
          if (!targetElement && targetSelectors.length > 0) {
            const firstSelector = Array.isArray(targetSelectors[0]) ? targetSelectors[0].join(' ') : targetSelectors[0];
            const tagMatch = firstSelector.match(/^([a-zA-Z]+)/);
            if (tagMatch) {
              const tagName = tagMatch[1].toLowerCase();
              const elementsOfType = elementMap.filter(el => el.tagName === tagName);
              if (elementsOfType.length > nodeIndex) {
                targetElement = elementsOfType[nodeIndex];
              }
            }
          }

          if (targetElement) {
            const impactLevel = violation.impact || 'moderate';
            const overlayStyle = this.getOverlayStyle(impactLevel);

            violationOverlays.push({
              id: `violation-${violationIndex}-${nodeIndex}`,
              violationId: violation.id,
              element: targetElement,
              position: targetElement.bounds,
              impact: impactLevel,
              message: violation.description || violation.help,
              wcagCriteria: violation.tags?.filter(tag => tag.startsWith('wcag')) || [],
              helpUrl: violation.helpUrl,
              style: overlayStyle,
              violationData: violation
            });
          } else {
            console.warn(`⚠️ Could not find position for violation: ${violation.id} (node ${nodeIndex})`);
          }
        });
      } else {
        // Handle violations without nodes array
        console.warn(`⚠️ Violation ${violation.id} has no nodes to map`);
      }
    });

    console.log(`✅ Successfully mapped ${violationOverlays.length} violations`);
    return violationOverlays;
  }

  /**
   * Generate CSS styling for violation overlays based on impact level
   */
  getOverlayStyle(impact) {
    const styles = {
      critical: {
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        borderWidth: '3px',
        animation: 'pulse 1s infinite',
        zIndex: 1000
      },
      serious: {
        borderColor: '#ea580c',
        backgroundColor: 'rgba(234, 88, 12, 0.1)',
        borderWidth: '2px',
        animation: 'none',
        zIndex: 999
      },
      moderate: {
        borderColor: '#ca8a04',
        backgroundColor: 'rgba(202, 138, 4, 0.1)',
        borderWidth: '1px',
        animation: 'none',
        zIndex: 998
      },
      minor: {
        borderColor: '#059669',
        backgroundColor: 'rgba(5, 150, 105, 0.1)',
        borderWidth: '1px',
        animation: 'none',
        zIndex: 997
      }
    };

    return styles[impact] || styles.moderate;
  }

  /**
   * Generate summary statistics
   */
  generateSummary(violations) {
    const summary = {
      total: violations.length,
      critical: violations.filter(v => v.impact === 'critical').length,
      serious: violations.filter(v => v.impact === 'serious').length,
      moderate: violations.filter(v => v.impact === 'moderate').length,
      minor: violations.filter(v => v.impact === 'minor').length
    };

    // Calculate accessibility score (100 - weighted penalties)
    const weightedScore = (summary.critical * 25) + (summary.serious * 15) + (summary.moderate * 10) + (summary.minor * 5);
    summary.accessibilityScore = Math.max(0, 100 - weightedScore);

    return summary;
  }

  /**
   * Generate interactive HTML report
   */
  async generateInteractiveHTML(reportData) {
    const template = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interactive Accessibility Report - ${reportData.url}</title>
    <style>
        ${await this.getCSS()}
    </style>
</head>
<body>
    <div class="report-container">
        <header class="report-header">
            <h1>🔍 Interactive Accessibility Report</h1>
            <div class="report-meta">
                <p><strong>URL:</strong> <a href="${reportData.url}" target="_blank">${reportData.url}</a></p>
                <p><strong>Scan Date:</strong> ${new Date(reportData.timestamp).toLocaleString()}</p>
                <p><strong>Report ID:</strong> ${reportData.reportId}</p>
            </div>
        </header>

        <section class="summary-section">
            <h2>📊 Summary</h2>
            <div class="summary-stats">
                <div class="stat-card">
                    <div class="stat-value">${reportData.summary.accessibilityScore}</div>
                    <div class="stat-label">Accessibility Score</div>
                </div>
                <div class="stat-card critical">
                    <div class="stat-value">${reportData.summary.critical}</div>
                    <div class="stat-label">Critical</div>
                </div>
                <div class="stat-card serious">
                    <div class="stat-value">${reportData.summary.serious}</div>
                    <div class="stat-label">Serious</div>
                </div>
                <div class="stat-card moderate">
                    <div class="stat-value">${reportData.summary.moderate}</div>
                    <div class="stat-label">Moderate</div>
                </div>
                <div class="stat-card minor">
                    <div class="stat-value">${reportData.summary.minor}</div>
                    <div class="stat-label">Minor</div>
                </div>
            </div>
        </section>

        <section class="controls-section">
            <h2>🎛️ Controls</h2>
            <div class="controls">
                <div class="filter-controls">
                    <label>
                        <input type="checkbox" id="show-critical" checked> Critical Issues
                    </label>
                    <label>
                        <input type="checkbox" id="show-serious" checked> Serious Issues
                    </label>
                    <label>
                        <input type="checkbox" id="show-moderate" checked> Moderate Issues
                    </label>
                    <label>
                        <input type="checkbox" id="show-minor" checked> Minor Issues
                    </label>
                </div>
                <div class="view-controls">
                    <button id="zoom-fit" class="control-btn">🔍 Fit to Screen</button>
                    <button id="zoom-100" class="control-btn">🎯 100%</button>
                    <button id="toggle-overlays" class="control-btn">👁️ Toggle Overlays</button>
                </div>
            </div>
        </section>

        <section class="screenshot-section">
            <h2>📸 Interactive Website View</h2>
            <div class="screenshot-container" id="screenshot-container">
                <img src="${reportData.screenshotData.screenshotPath}" 
                     alt="Website screenshot" 
                     class="website-screenshot" 
                     id="website-screenshot">
                
                <div class="violation-overlays" id="violation-overlays">
                    ${this.generateOverlayHTML(reportData.violationOverlays)}
                </div>
            </div>
        </section>

        <section class="violations-list">
            <h2>📋 Violations List</h2>
            <div class="violations-table">
                ${this.generateViolationsTableHTML(reportData.violations)}
            </div>
        </section>
    </div>

    <script>
        ${await this.getJavaScript(reportData)}
    </script>
</body>
</html>`;

    return template;
  }

  /**
   * Generate HTML for violation overlays
   */
  generateOverlayHTML(violationOverlays) {
    return violationOverlays.map(overlay => `
        <div class="violation-overlay ${overlay.impact}" 
             id="${overlay.id}"
             data-violation-id="${overlay.violationId}"
             data-impact="${overlay.impact}"
             style="
                position: absolute;
                left: ${overlay.position.left}px;
                top: ${overlay.position.top}px;
                width: ${overlay.position.width}px;
                height: ${overlay.position.height}px;
                border: ${overlay.style.borderWidth} solid ${overlay.style.borderColor};
                background: ${overlay.style.backgroundColor};
                cursor: pointer;
                z-index: ${overlay.style.zIndex};
                animation: ${overlay.style.animation};
             ">
            <div class="violation-tooltip">
                <div class="tooltip-header">
                    <span class="impact-badge ${overlay.impact}">${overlay.impact.toUpperCase()}</span>
                    <span class="violation-id">${overlay.violationData.id}</span>
                </div>
                <div class="tooltip-content">
                    <div class="tooltip-description">
                        <strong>Issue:</strong> ${overlay.message}
                    </div>
                    ${overlay.violationData.help ? `
                        <div class="tooltip-help">
                            <strong>Fix:</strong> ${overlay.violationData.help}
                        </div>
                    ` : ''}
                    <div class="tooltip-element">
                        <strong>Element:</strong> <code>${overlay.element.tagName}${overlay.element.attributes.id ? '#' + overlay.element.attributes.id : ''}${overlay.element.attributes.class ? '.' + overlay.element.attributes.class.split(' ')[0] : ''}</code>
                    </div>
                    ${overlay.wcagCriteria.length > 0 ? `
                        <div class="wcag-tags">
                            <strong>WCAG:</strong>
                            ${overlay.wcagCriteria.map(criteria => `<span class="wcag-tag">${criteria.replace('wcag', 'WCAG ')}</span>`).join('')}
                        </div>
                    ` : ''}
                    <div class="tooltip-actions">
                        <button class="tooltip-btn" onclick="window.open('${overlay.helpUrl}', '_blank')">📖 Learn More</button>
                        <button class="tooltip-btn" onclick="console.log('Element details:', window.reportData.screenshotData.elementMap.find(el => el.id === '${overlay.element.id}'))">🔍 Inspect</button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
  }

  /**
   * Generate violations table HTML
   */
  generateViolationsTableHTML(violations) {
    return `
        <table class="violations-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Impact</th>
                    <th>Description</th>
                    <th>WCAG</th>
                    <th>Elements</th>
                </tr>
            </thead>
            <tbody>
                ${violations.map(violation => `
                    <tr class="violation-row ${violation.impact}">
                        <td><code>${violation.id}</code></td>
                        <td><span class="impact-badge ${violation.impact}">${violation.impact}</span></td>
                        <td>${violation.description || violation.help}</td>
                        <td>${(violation.tags?.filter(tag => tag.startsWith('wcag')) || []).join(', ')}</td>
                        <td>${violation.nodes?.length || 0} elements</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
  }

  /**
   * Save data files for the report
   */
  async saveDataFiles(reportDir, reportData) {
    // Save violations data
    await fs.writeFile(
      path.join(reportDir, 'data', 'violations.json'),
      JSON.stringify(reportData.violations, null, 2)
    );

    // Save element map
    await fs.writeFile(
      path.join(reportDir, 'data', 'elements.json'),
      JSON.stringify(reportData.screenshotData.elementMap, null, 2)
    );

    // Save metadata
    await fs.writeFile(
      path.join(reportDir, 'data', 'metadata.json'),
      JSON.stringify({
        reportId: reportData.reportId,
        timestamp: reportData.timestamp,
        url: reportData.url,
        summary: reportData.summary,
        scanMetadata: reportData.scanMetadata
      }, null, 2)
    );
  }

  /**
   * Copy static assets (CSS, JS, images)
   */
  async copyAssets(reportDir) {
    const assetsDir = path.join(reportDir, 'assets');
    
    // CSS and JS will be inlined for Phase 1
    // In future phases, we'll have separate asset files
    
    await fs.writeFile(
      path.join(assetsDir, 'report-styles.css'),
      await this.getCSS()
    );
  }

  /**
   * Get CSS styles for the interactive report
   */
  async getCSS() {
    return `
        /* Interactive Accessibility Report Styles - Phase 1 */
        * {
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 0;
            background: #f8f9fa;
            color: #333;
        }

        .report-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .report-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 3rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            text-align: center;
            box-shadow: 0 8px 32px rgba(102, 126, 234, 0.3);
            position: relative;
            overflow: hidden;
        }

        .report-header::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
            animation: shimmer 3s ease-in-out infinite;
        }

        .report-header h1 {
            margin: 0 0 1rem 0;
            font-size: 3rem;
            font-weight: 700;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            position: relative;
            z-index: 1;
        }

        .report-meta {
            position: relative;
            z-index: 1;
        }

        .report-meta p {
            margin: 0.75rem 0;
            opacity: 0.95;
            font-size: 1.1rem;
            font-weight: 300;
        }

        .report-meta a {
            color: white;
        }

        .summary-section, .controls-section, .screenshot-section, .violations-list {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }

        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
        }

        .stat-card {
            text-align: center;
            padding: 1.5rem;
            border-radius: 6px;
            background: #f8f9fa;
            border-left: 4px solid #667eea;
        }

        .stat-card.critical { border-left-color: #dc2626; }
        .stat-card.serious { border-left-color: #ea580c; }
        .stat-card.moderate { border-left-color: #ca8a04; }
        .stat-card.minor { border-left-color: #059669; }

        .stat-value {
            font-size: 2.5rem;
            font-weight: bold;
            color: #333;
        }

        .stat-label {
            color: #666;
            margin-top: 0.5rem;
        }

        .controls {
            display: flex;
            flex-wrap: wrap;
            gap: 2rem;
            align-items: center;
        }

        .filter-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .filter-controls label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            cursor: pointer;
        }

        .view-controls {
            display: flex;
            gap: 0.5rem;
        }

        .control-btn {
            padding: 0.5rem 1rem;
            border: 1px solid #ddd;
            background: white;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .control-btn:hover {
            background: #f8f9fa;
            border-color: #667eea;
        }

        .screenshot-container {
            position: relative;
            border: 1px solid #ddd;
            border-radius: 4px;
            overflow: auto;
            max-height: 80vh;
            background: white;
        }

        .website-screenshot {
            display: block;
            max-width: 100%;
            height: auto;
        }

        .violation-overlays {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        }

        .violation-overlay {
            pointer-events: all;
            transition: all 0.2s;
            border-style: solid;
        }

        .violation-overlay:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }

        .violation-overlay.hidden {
            display: none;
        }

        .violation-tooltip {
            position: absolute;
            bottom: calc(100% + 10px);
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(145deg, #1a1a1a 0%, #2d2d2d 100%);
            color: white;
            padding: 1rem;
            border-radius: 8px;
            font-size: 0.875rem;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s ease;
            z-index: 10000;
            max-width: 350px;
            white-space: normal;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            animation: slideIn 0.3s ease forwards;
        }

        .violation-tooltip::before {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 8px solid transparent;
            border-top-color: #1a1a1a;
        }

        .violation-overlay:hover .violation-tooltip {
            opacity: 1;
        }

        .tooltip-header {
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.2);
            padding-bottom: 0.5rem;
        }

        .violation-id {
            font-family: 'Courier New', monospace;
            font-size: 0.8rem;
            opacity: 0.8;
            background: rgba(255,255,255,0.1);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
        }

        .tooltip-content > div {
            margin-bottom: 0.75rem;
        }

        .tooltip-content > div:last-child {
            margin-bottom: 0;
        }

        .tooltip-description, .tooltip-help, .tooltip-element {
            line-height: 1.4;
        }

        .tooltip-element code {
            background: rgba(255,255,255,0.1);
            padding: 0.125rem 0.25rem;
            border-radius: 3px;
            font-size: 0.8rem;
        }

        .tooltip-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.75rem;
            padding-top: 0.75rem;
            border-top: 1px solid rgba(255,255,255,0.2);
        }

        .tooltip-btn {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
        }

        .tooltip-btn:hover {
            background: rgba(255,255,255,0.2);
            border-color: rgba(255,255,255,0.4);
        }

        .impact-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 3px;
            font-size: 0.75rem;
            font-weight: bold;
            text-transform: uppercase;
        }

        .impact-badge.critical {
            background: #dc2626;
            color: white;
        }

        .impact-badge.serious {
            background: #ea580c;
            color: white;
        }

        .impact-badge.moderate {
            background: #ca8a04;
            color: white;
        }

        .impact-badge.minor {
            background: #059669;
            color: white;
        }

        .wcag-tags {
            margin-top: 0.5rem;
        }

        .wcag-tag {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 0.125rem 0.25rem;
            border-radius: 2px;
            font-size: 0.75rem;
            margin-right: 0.25rem;
        }

        .violations-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }

        .violations-table th,
        .violations-table td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }

        .violations-table th {
            background: #f8f9fa;
            font-weight: 600;
            color: #374151;
        }

        .violation-row:hover {
            background: #f8f9fa;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        @keyframes shimmer {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @keyframes slideIn {
            from { 
                opacity: 0; 
                transform: translateY(-10px); 
            }
            to { 
                opacity: 1; 
                transform: translateY(0); 
            }
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .report-container {
                padding: 10px;
            }

            .report-header {
                padding: 1rem;
            }

            .report-header h1 {
                font-size: 2rem;
            }

            .summary-stats {
                grid-template-columns: repeat(2, 1fr);
            }

            .controls {
                flex-direction: column;
                align-items: stretch;
            }

            .filter-controls {
                justify-content: center;
            }

            .view-controls {
                justify-content: center;
            }
        }
    `;
  }

  /**
   * Get JavaScript for interactive functionality
   */
  async getJavaScript(reportData) {
    return `
        // Interactive Accessibility Report JavaScript - Phase 1
        document.addEventListener('DOMContentLoaded', function() {
            console.log('🚀 Interactive Accessibility Report loaded');
            
            // Initialize filter controls
            initializeFilters();
            
            // Initialize view controls
            initializeViewControls();
            
            // Initialize overlay interactions
            initializeOverlayInteractions();
            
            // Log complete report data for debugging and inspection
            window.reportData = ${JSON.stringify(reportData, null, 2)};
            console.log('📊 Report data loaded:', {
                violations: ${reportData.violations.length},
                overlays: ${reportData.violationOverlays.length},
                elements: ${reportData.screenshotData.elementMap.length}
            });
        });

        function initializeFilters() {
            const filterCheckboxes = document.querySelectorAll('.filter-controls input[type="checkbox"]');
            
            filterCheckboxes.forEach(checkbox => {
                checkbox.addEventListener('change', function() {
                    const impactLevel = this.id.replace('show-', '');
                    const overlays = document.querySelectorAll('.violation-overlay.' + impactLevel);
                    const rows = document.querySelectorAll('.violation-row.' + impactLevel);
                    
                    overlays.forEach(overlay => {
                        overlay.classList.toggle('hidden', !this.checked);
                    });
                    
                    rows.forEach(row => {
                        row.style.display = this.checked ? '' : 'none';
                    });
                    
                    console.log((this.checked ? 'Showing' : 'Hiding') + ' ' + impactLevel + ' violations');
                });
            });
        }

        function initializeViewControls() {
            const zoomFitBtn = document.getElementById('zoom-fit');
            const zoom100Btn = document.getElementById('zoom-100');
            const toggleOverlaysBtn = document.getElementById('toggle-overlays');
            const screenshotContainer = document.getElementById('screenshot-container');
            const screenshot = document.getElementById('website-screenshot');
            const overlaysContainer = document.getElementById('violation-overlays');

            if (zoomFitBtn) {
                zoomFitBtn.addEventListener('click', function() {
                    screenshot.style.width = '100%';
                    screenshot.style.height = 'auto';
                    console.log('🔍 Zoomed to fit container');
                });
            }

            if (zoom100Btn) {
                zoom100Btn.addEventListener('click', function() {
                    screenshot.style.width = 'auto';
                    screenshot.style.height = 'auto';
                    console.log('🎯 Zoomed to 100%');
                });
            }

            if (toggleOverlaysBtn) {
                let overlaysVisible = true;
                toggleOverlaysBtn.addEventListener('click', function() {
                    overlaysVisible = !overlaysVisible;
                    overlaysContainer.style.display = overlaysVisible ? 'block' : 'none';
                    this.textContent = overlaysVisible ? '👁️ Toggle Overlays' : '👁️‍🗨️ Show Overlays';
                    console.log((overlaysVisible ? 'Showing' : 'Hiding') + ' overlays');
                });
            }
        }

        function initializeOverlayInteractions() {
            const overlays = document.querySelectorAll('.violation-overlay');
            
            overlays.forEach(overlay => {
                overlay.addEventListener('click', function() {
                    const violationId = this.dataset.violationId;
                    const impact = this.dataset.impact;
                    
                    console.log('🎯 Clicked violation: ' + violationId + ' (' + impact + ')');
                    
                    // Highlight corresponding table row
                    const codeElements = document.querySelectorAll('.violation-row code');
                    let tableRow = null;
                    for (let i = 0; i < codeElements.length; i++) {
                        if (codeElements[i].textContent.includes(violationId)) {
                            tableRow = codeElements[i].closest('tr');
                            break;
                        }
                    }
                    
                    if (tableRow) {
                        // Remove previous highlights
                        document.querySelectorAll('.violation-row.highlighted').forEach(row => {
                            row.classList.remove('highlighted');
                        });
                        
                        // Add highlight
                        tableRow.classList.add('highlighted');
                        tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        
                        // Add temporary highlight style
                        const originalBackground = tableRow.style.background;
                        tableRow.style.background = '#fff3cd';
                        setTimeout(() => {
                            tableRow.style.background = originalBackground;
                        }, 2000);
                    }
                    
                    // Future: Open inspector panel (Phase 2)
                });
                
                overlay.addEventListener('mouseenter', function() {
                    const violationId = this.dataset.violationId;
                    console.log('🔍 Hovering over violation: ' + violationId);
                });
            });
        }

        // Performance monitoring
        window.addEventListener('load', function() {
            const loadTime = performance.now();
            console.log('⚡ Report loaded in ' + Math.round(loadTime) + 'ms');
            
            // Check for JavaScript errors
            window.addEventListener('error', function(e) {
                console.error('❌ JavaScript error:', e.error);
            });
        });
    `;
  }
}

module.exports = InteractiveReportGenerator;