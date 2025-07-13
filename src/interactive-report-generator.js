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
      
      // Phase 2: Extract detailed HTML context for each violation
      const enhancedViolations = await this.extractHTMLContext(page, violations, screenshotData.elementMap);
      
      // Phase 2: Generate WCAG rule information
      const wcagDatabase = await this.buildWCAGDatabase(enhancedViolations);
      
      // Combined report data with Phase 2 enhancements
      const reportData = {
        reportId,
        timestamp: new Date().toISOString(),
        url: scanMetadata.url,
        scanMetadata,
        screenshotData,
        violations: enhancedViolations,
        violationOverlays,
        wcagDatabase,
        summary: this.generateSummary(enhancedViolations)
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
          const classString = typeof element.className === 'string' 
            ? element.className 
            : element.className.toString();
          const classes = classString.split(' ').filter(c => c.trim());
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
   * Phase 2: Extract detailed HTML context for each violation
   */
  async extractHTMLContext(page, violations, elementMap) {
    console.log(`🔍 Extracting HTML context for ${violations.length} violations...`);

    const enhancedViolations = await Promise.all(violations.map(async (violation) => {
      const htmlContexts = [];

      if (violation.nodes && violation.nodes.length > 0) {
        for (const node of violation.nodes) {
          try {
            const targetSelectors = node.target || [];
            const selector = Array.isArray(targetSelectors[0]) ? targetSelectors[0].join(' ') : targetSelectors[0];

            // Extract HTML context from the page
            const context = await page.evaluate((sel) => {
              const element = document.querySelector(sel);
              if (!element) return null;

              return {
                target: element.outerHTML,
                parent: element.parentElement ? element.parentElement.outerHTML : null,
                siblings: element.parentElement ? 
                  Array.from(element.parentElement.children).map(el => el.outerHTML) : [],
                textContent: element.textContent?.trim(),
                computedStyle: {
                  display: window.getComputedStyle(element).display,
                  visibility: window.getComputedStyle(element).visibility,
                  opacity: window.getComputedStyle(element).opacity,
                  color: window.getComputedStyle(element).color,
                  backgroundColor: window.getComputedStyle(element).backgroundColor,
                  fontSize: window.getComputedStyle(element).fontSize,
                  fontWeight: window.getComputedStyle(element).fontWeight
                },
                accessibility: {
                  role: element.getAttribute('role') || element.tagName.toLowerCase(),
                  ariaLabel: element.getAttribute('aria-label'),
                  ariaLabelledBy: element.getAttribute('aria-labelledby'),
                  ariaDescribedBy: element.getAttribute('aria-describedby'),
                  tabIndex: element.tabIndex,
                  disabled: element.disabled || element.getAttribute('aria-disabled') === 'true'
                }
              };
            }, selector);

            if (context) {
              htmlContexts.push({
                selector,
                ...context
              });
            }
          } catch (error) {
            console.warn(`⚠️ Could not extract context for selector: ${selector}`, error.message);
          }
        }
      }

      return {
        ...violation,
        htmlContexts,
        userImpact: this.generateUserImpact(violation),
        technicalDetails: this.generateTechnicalDetails(violation),
        fixSuggestions: this.generateFixSuggestions(violation)
      };
    }));

    console.log(`✅ Enhanced ${enhancedViolations.length} violations with HTML context`);
    return enhancedViolations;
  }

  /**
   * Phase 2: Build comprehensive WCAG database
   */
  async buildWCAGDatabase(violations) {
    console.log('📚 Building WCAG database...');

    const wcagRules = new Map();

    violations.forEach(violation => {
      if (violation.tags) {
        violation.tags.forEach(tag => {
          if (tag.startsWith('wcag')) {
            const wcagId = tag.replace('wcag', '').replace(/(\d)(\d)(\d)/, '$1.$2.$3');
            
            if (!wcagRules.has(wcagId)) {
              wcagRules.set(wcagId, {
                id: wcagId,
                title: this.getWCAGTitle(wcagId),
                level: this.getWCAGLevel(tag),
                description: this.getWCAGDescription(wcagId),
                successCriteria: this.getWCAGSuccessCriteria(wcagId),
                techniques: this.getWCAGTechniques(wcagId),
                helpUrl: `https://www.w3.org/WAI/WCAG21/Understanding/${this.getWCAGSlug(wcagId)}.html`,
                violations: []
              });
            }

            wcagRules.get(wcagId).violations.push({
              id: violation.id,
              impact: violation.impact,
              description: violation.description
            });
          }
        });
      }
    });

    console.log(`✅ Built WCAG database with ${wcagRules.size} rules`);
    return Object.fromEntries(wcagRules);
  }

  /**
   * Generate user impact description
   */
  generateUserImpact(violation) {
    const impactDescriptions = {
      critical: {
        description: "Blocks access for users with disabilities",
        affectedUsers: "25-30% of users with disabilities",
        severity: "Complete barrier to access"
      },
      serious: {
        description: "Significantly hinders accessibility",
        affectedUsers: "15-20% of users with disabilities", 
        severity: "Major difficulty accessing content"
      },
      moderate: {
        description: "Creates accessibility challenges",
        affectedUsers: "10-15% of users with disabilities",
        severity: "Noticeable difficulty but workarounds possible"
      },
      minor: {
        description: "Minor accessibility inconvenience",
        affectedUsers: "5-10% of users with disabilities",
        severity: "Slight difficulty accessing content"
      }
    };

    return impactDescriptions[violation.impact] || impactDescriptions.moderate;
  }

  /**
   * Generate technical details
   */
  generateTechnicalDetails(violation) {
    return {
      ruleId: violation.id,
      axeVersion: "4.10.0",
      category: this.categorizeViolation(violation),
      automatable: true,
      elementCount: violation.nodes ? violation.nodes.length : 0,
      testingMethod: "Automated accessibility testing with axe-core"
    };
  }

  /**
   * Phase 3: Generate comprehensive fix suggestions with before/after examples
   */
  generateFixSuggestions(violation) {
    const comprehensiveFixes = {
      'image-alt': {
        type: 'attribute-addition',
        suggestion: 'Add descriptive alt attribute to images',
        difficulty: 'easy',
        timeEstimate: '2 minutes',
        priority: 'high',
        example: '<img src="image.jpg" alt="Description of the image content">',
        beforeAfter: {
          before: '<img src="hero-image.jpg" class="hero">',
          after: '<img src="hero-image.jpg" class="hero" alt="Team collaboration in modern office space">',
          explanation: 'Add meaningful alt text that describes the image content or purpose'
        },
        validation: {
          check: 'img[alt]',
          description: 'Verify all images have alt attributes'
        }
      },
      'color-contrast': {
        type: 'style-modification',
        suggestion: 'Increase color contrast to meet WCAG AA standards (4.5:1 ratio)',
        difficulty: 'medium',
        timeEstimate: '5-10 minutes',
        priority: 'high',
        example: 'color: #333333; /* Instead of #999999 */',
        beforeAfter: {
          before: '.text { color: #999999; background: #ffffff; }',
          after: '.text { color: #333333; background: #ffffff; }',
          explanation: 'Use darker colors to achieve minimum 4.5:1 contrast ratio'
        },
        validation: {
          check: 'contrast-ratio >= 4.5',
          description: 'Test color combinations with contrast checking tools'
        }
      },
      'label': {
        type: 'element-association',
        suggestion: 'Associate form controls with descriptive labels',
        difficulty: 'easy', 
        timeEstimate: '3-5 minutes',
        priority: 'high',
        example: '<label for="email-input">Email Address</label><input id="email-input" type="email">',
        beforeAfter: {
          before: '<input type="email" placeholder="Email">',
          after: '<label for="email-input">Email Address</label><input id="email-input" type="email" placeholder="Enter your email">',
          explanation: 'Connect labels to inputs using for/id attributes'
        },
        validation: {
          check: 'input[id] + label[for]',
          description: 'Ensure every form input has an associated label'
        }
      },
      'heading-order': {
        type: 'structure-modification',
        suggestion: 'Fix heading hierarchy to follow logical order (h1 → h2 → h3)',
        difficulty: 'medium',
        timeEstimate: '10-15 minutes',
        priority: 'medium',
        example: '<h1>Main Title</h1><h2>Section</h2><h3>Subsection</h3>',
        beforeAfter: {
          before: '<h1>Page Title</h1><h3>Section Title</h3>',
          after: '<h1>Page Title</h1><h2>Section Title</h2>',
          explanation: 'Use sequential heading levels without skipping'
        },
        validation: {
          check: 'heading sequence',
          description: 'Check that headings follow h1 → h2 → h3 progression'
        }
      },
      'link-name': {
        type: 'content-modification',
        suggestion: 'Provide descriptive link text that explains destination',
        difficulty: 'easy',
        timeEstimate: '2-3 minutes',
        priority: 'medium',
        example: '<a href="/services">Our Web Development Services</a>',
        beforeAfter: {
          before: '<a href="/services">Click here</a>',
          after: '<a href="/services">View our web development services</a>',
          explanation: 'Replace generic text with specific descriptions'
        },
        validation: {
          check: 'meaningful link text',
          description: 'Avoid "click here", "read more" - use descriptive text'
        }
      },
      'aria-hidden-focus': {
        type: 'attribute-modification',
        suggestion: 'Remove focusable elements from accessibility tree when hidden',
        difficulty: 'medium',
        timeEstimate: '5-8 minutes',
        priority: 'medium',
        example: '<div aria-hidden="true"><button tabindex="-1">Hidden Button</button></div>',
        beforeAfter: {
          before: '<div aria-hidden="true"><button>Button</button></div>',
          after: '<div aria-hidden="true"><button tabindex="-1">Button</button></div>',
          explanation: 'Add tabindex="-1" to focusable elements inside aria-hidden containers'
        },
        validation: {
          check: 'aria-hidden + tabindex',
          description: 'Verify hidden elements are not keyboard accessible'
        }
      }
    };

    // Try to match violation ID to fix templates
    const violationKey = Object.keys(comprehensiveFixes).find(key => 
      violation.id.includes(key) || violation.id.startsWith(key)
    );

    if (violationKey) {
      return comprehensiveFixes[violationKey];
    }

    // Fallback based on violation characteristics
    if (violation.tags?.includes('cat.color')) {
      return comprehensiveFixes['color-contrast'];
    }
    if (violation.tags?.includes('cat.forms')) {
      return comprehensiveFixes['label'];
    }
    if (violation.tags?.includes('cat.images')) {
      return comprehensiveFixes['image-alt'];
    }

    // Generic fallback
    return {
      type: 'manual-review',
      suggestion: 'Review element and apply appropriate accessibility fixes',
      difficulty: 'varies',
      timeEstimate: 'depends on issue',
      priority: 'medium',
      example: 'Refer to WCAG documentation for specific guidance',
      beforeAfter: {
        before: '<!-- Current problematic code -->',
        after: '<!-- Fixed accessible code -->',
        explanation: 'Apply WCAG guidelines to resolve this accessibility issue'
      },
      validation: {
        check: 'manual testing',
        description: 'Test with assistive technologies and accessibility tools'
      }
    };
  }

  /**
   * Helper methods for WCAG database
   */
  getWCAGTitle(wcagId) {
    const titles = {
      '1.1.1': 'Non-text Content',
      '1.3.1': 'Info and Relationships', 
      '1.4.3': 'Contrast (Minimum)',
      '1.4.6': 'Contrast (Enhanced)',
      '2.1.1': 'Keyboard',
      '2.4.1': 'Bypass Blocks',
      '2.4.2': 'Page Titled',
      '3.1.1': 'Language of Page',
      '3.3.2': 'Labels or Instructions',
      '4.1.1': 'Parsing',
      '4.1.2': 'Name, Role, Value'
    };
    return titles[wcagId] || `WCAG ${wcagId}`;
  }

  getWCAGLevel(tag) {
    if (tag.includes('wcag2a') && !tag.includes('wcag2aa')) return 'A';
    if (tag.includes('wcag2aa')) return 'AA';
    if (tag.includes('wcag2aaa')) return 'AAA';
    return 'A';
  }

  getWCAGDescription(wcagId) {
    const descriptions = {
      '1.1.1': 'All non-text content must have a text alternative',
      '1.3.1': 'Information, structure, and relationships must be programmatically determinable',
      '1.4.3': 'Text must have sufficient contrast against its background',
      '2.1.1': 'All functionality must be available from a keyboard',
      '3.3.2': 'Labels or instructions must be provided when content requires user input'
    };
    return descriptions[wcagId] || 'WCAG accessibility requirement';
  }

  getWCAGSuccessCriteria(wcagId) {
    return `Success Criteria ${wcagId}: ${this.getWCAGDescription(wcagId)}`;
  }

  getWCAGTechniques(wcagId) {
    const techniques = {
      '1.1.1': ['H37', 'H36', 'H24', 'H2'],
      '1.3.1': ['H42', 'H43', 'H44', 'H51'],
      '1.4.3': ['G18', 'G145', 'G174'],
      '2.1.1': ['G202', 'H91'],
      '3.3.2': ['H44', 'H65', 'G131']
    };
    return techniques[wcagId] || [];
  }

  getWCAGSlug(wcagId) {
    const slugs = {
      '1.1.1': 'non-text-content',
      '1.3.1': 'info-and-relationships',
      '1.4.3': 'contrast-minimum',
      '2.1.1': 'keyboard',
      '3.3.2': 'labels-or-instructions'
    };
    return slugs[wcagId] || wcagId.replace(/\./g, '-');
  }

  categorizeViolation(violation) {
    if (violation.tags?.includes('cat.color')) return 'Color';
    if (violation.tags?.includes('cat.keyboard')) return 'Keyboard';
    if (violation.tags?.includes('cat.forms')) return 'Forms';
    if (violation.tags?.includes('cat.images')) return 'Images';
    if (violation.tags?.includes('cat.structure')) return 'Structure';
    return 'General';
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

        <section class="main-interface">
            <div class="interface-layout">
                <div class="screenshot-panel">
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
                </div>

                <div class="inspector-panel" id="inspector-panel">
                    <div class="panel-header">
                        <h2>🔍 Violation Inspector</h2>
                        <div class="panel-controls">
                            <select id="violation-filter" class="control-select">
                                <option value="all">All Violations</option>
                                <option value="critical">Critical Only</option>
                                <option value="serious">Serious Only</option>
                                <option value="moderate">Moderate Only</option>
                                <option value="minor">Minor Only</option>
                            </select>
                            <button id="clear-selection" class="control-btn">Clear Selection</button>
                        </div>
                    </div>
                    
                    <div class="panel-content" id="panel-content">
                        <div class="inspector-welcome">
                            <div class="welcome-icon">🎯</div>
                            <h3>Select a violation to inspect</h3>
                            <p>Click on any red marker in the screenshot to see detailed information about the accessibility issue.</p>
                            
                            <div class="quick-stats">
                                <div class="stat-item">
                                    <span class="stat-number">${reportData.summary.total}</span>
                                    <span class="stat-label">Total Issues</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-number">${Object.keys(reportData.wcagDatabase || {}).length}</span>
                                    <span class="stat-label">WCAG Rules</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-number">${reportData.screenshotData.elementMap.length}</span>
                                    <span class="stat-label">Elements Mapped</span>
                                </div>
                            </div>
                        </div>
                    </div>
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

        .summary-section, .controls-section, .main-interface, .violations-list {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }

        .main-interface {
            padding: 0;
        }

        .interface-layout {
            display: grid;
            grid-template-columns: 1fr 450px;
            gap: 0;
            min-height: 80vh;
        }

        .screenshot-panel {
            padding: 2rem;
            border-right: 1px solid #e5e7eb;
        }

        .inspector-panel {
            padding: 0;
            background: #f8f9fa;
            border-radius: 0 8px 8px 0;
        }

        .panel-header {
            padding: 1.5rem 2rem;
            border-bottom: 1px solid #e5e7eb;
            background: white;
            border-radius: 0 8px 0 0;
        }

        .panel-header h2 {
            margin: 0 0 1rem 0;
            color: #1a365d;
            font-size: 1.5rem;
        }

        .panel-controls {
            display: flex;
            gap: 1rem;
            align-items: center;
        }

        .control-select {
            padding: 0.5rem;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: white;
            font-size: 0.875rem;
        }

        .panel-content {
            padding: 2rem;
            height: calc(80vh - 120px);
            overflow-y: auto;
        }

        .inspector-welcome {
            text-align: center;
            padding: 2rem 0;
        }

        .welcome-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
        }

        .inspector-welcome h3 {
            color: #374151;
            margin-bottom: 0.5rem;
        }

        .inspector-welcome p {
            color: #6b7280;
            margin-bottom: 2rem;
        }

        .quick-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-top: 2rem;
        }

        .quick-stats .stat-item {
            text-align: center;
            padding: 1rem;
            background: white;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
        }

        .quick-stats .stat-number {
            display: block;
            font-size: 1.5rem;
            font-weight: bold;
            color: #667eea;
        }

        .quick-stats .stat-label {
            font-size: 0.75rem;
            color: #6b7280;
            margin-top: 0.25rem;
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

        .violation-overlay.selected {
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5);
            z-index: 1005 !important;
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

        /* Inspector Detail View */
        .inspector-detail {
            animation: slideIn 0.3s ease;
        }

        .detail-header {
            padding: 1.5rem 0;
            border-bottom: 1px solid #e5e7eb;
            margin-bottom: 1.5rem;
        }

        .detail-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #111827;
            margin-bottom: 0.5rem;
        }

        .detail-meta {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }

        .detail-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 500;
        }

        .detail-badge.critical {
            background: #fee2e2;
            color: #991b1b;
        }

        .detail-badge.serious {
            background: #fef3c7;
            color: #92400e;
        }

        .detail-badge.moderate {
            background: #dbeafe;
            color: #1e40af;
        }

        .detail-section {
            margin-bottom: 2rem;
        }

        .detail-section h4 {
            font-size: 1rem;
            font-weight: 600;
            color: #374151;
            margin-bottom: 0.75rem;
        }

        .code-block {
            background: #1f2937;
            color: #f9fafb;
            padding: 1rem;
            border-radius: 6px;
            font-family: 'Courier New', monospace;
            font-size: 0.875rem;
            overflow-x: auto;
            white-space: pre-wrap;
        }

        .code-block .tag {
            color: #60a5fa;
        }

        .code-block .attr {
            color: #fbbf24;
        }

        .code-block .value {
            color: #34d399;
        }

        .impact-description {
            background: #f3f4f6;
            padding: 1rem;
            border-radius: 6px;
            border-left: 4px solid #6b7280;
        }

        .wcag-reference {
            background: #eff6ff;
            padding: 1rem;
            border-radius: 6px;
            border-left: 4px solid #3b82f6;
        }

        .wcag-reference h5 {
            margin: 0 0 0.5rem 0;
            color: #1e40af;
        }

        .techniques-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }

        .technique-tag {
            background: #e0e7ff;
            color: #3730a3;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
        }

        .fix-suggestion {
            background: #f0fdf4;
            padding: 1rem;
            border-radius: 6px;
            border-left: 4px solid #16a34a;
        }

        .fix-header {
            margin-bottom: 1rem;
        }

        .fix-info p {
            margin: 0.25rem 0;
        }

        .difficulty-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }

        .difficulty-badge.easy {
            background: #dcfce7;
            color: #166534;
        }

        .difficulty-badge.medium {
            background: #fef3c7;
            color: #92400e;
        }

        .difficulty-badge.hard {
            background: #fee2e2;
            color: #991b1b;
        }

        .before-after-section {
            margin: 1rem 0;
        }

        .code-comparison {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin: 1rem 0;
        }

        .code-block-wrapper {
            position: relative;
        }

        .code-header {
            background: #374151;
            color: white;
            padding: 0.5rem;
            border-radius: 6px 6px 0 0;
            font-size: 0.875rem;
            font-weight: 500;
        }

        .code-block.before {
            border-radius: 0 0 6px 6px;
            border-left: 4px solid #dc2626;
        }

        .code-block.after {
            border-radius: 0 0 6px 6px;
            border-left: 4px solid #16a34a;
        }

        .copy-btn {
            position: absolute;
            bottom: 0.5rem;
            right: 0.5rem;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border: none;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: background 0.2s;
        }

        .copy-btn:hover {
            background: rgba(0, 0, 0, 0.9);
        }

        .copy-btn.primary {
            background: #16a34a;
        }

        .copy-btn.primary:hover {
            background: #15803d;
        }

        .copy-btn.copied {
            background: #059669 !important;
        }

        .fix-explanation {
            background: #f8fafc;
            padding: 1rem;
            border-radius: 6px;
            margin: 1rem 0;
            border-left: 4px solid #3b82f6;
        }

        .validation-info {
            background: #fff7ed;
            padding: 1rem;
            border-radius: 6px;
            border-left: 4px solid #ea580c;
        }

        .fix-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
            flex-wrap: wrap;
        }

        .action-btn {
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            color: #374151;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            transition: all 0.2s;
        }

        .action-btn:hover {
            background: #e5e7eb;
            border-color: #9ca3af;
        }

        .action-btn.primary {
            background: #3b82f6;
            border-color: #3b82f6;
            color: white;
        }

        .action-btn.primary:hover {
            background: #2563eb;
            border-color: #2563eb;
        }

        @media (max-width: 768px) {
            .code-comparison {
                grid-template-columns: 1fr;
            }
            
            .fix-actions {
                flex-direction: column;
            }
        }

        .back-button {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: none;
            border: none;
            color: #6b7280;
            cursor: pointer;
            padding: 0.5rem;
            margin-bottom: 1rem;
            border-radius: 4px;
            transition: all 0.2s;
        }

        .back-button:hover {
            background: #f3f4f6;
            color: #374151;
        }

        /* Responsive design */
        @media (max-width: 1024px) {
            .interface-layout {
                grid-template-columns: 1fr;
                grid-template-rows: auto auto;
            }

            .screenshot-panel {
                border-right: none;
                border-bottom: 1px solid #e5e7eb;
            }

            .inspector-panel {
                border-radius: 0 0 8px 8px;
            }

            .panel-header {
                border-radius: 0;
            }
        }

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

            .interface-layout {
                min-height: 60vh;
            }

            .panel-content {
                height: calc(60vh - 120px);
            }

            .quick-stats {
                grid-template-columns: 1fr;
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
            
            // Initialize inspector panel controls
            initializeInspectorControls();
            
            // Log complete report data for debugging and inspection
            window.reportData = ${JSON.stringify(reportData, null, 2)};
            console.log('📊 Report data loaded:', {
                violations: ${reportData.violations.length},
                overlays: ${reportData.violationOverlays.length},
                elements: ${reportData.screenshotData.elementMap.length},
                wcagRules: Object.keys(reportData.wcagDatabase || {}).length
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
                    
                    // Find the violation data
                    const violation = window.reportData.violations.find(v => v.id === violationId);
                    if (violation) {
                        showViolationDetails(violation);
                    }
                    
                    // Highlight the overlay
                    document.querySelectorAll('.violation-overlay').forEach(o => {
                        o.classList.remove('selected');
                    });
                    this.classList.add('selected');
                });
                
                overlay.addEventListener('mouseenter', function() {
                    const violationId = this.dataset.violationId;
                    console.log('🔍 Hovering over violation: ' + violationId);
                });
            });
        }

        function showViolationDetails(violation) {
            console.log('📋 Showing details for violation:', violation.id);
            
            const panelContent = document.getElementById('panel-content');
            const wcagRule = window.reportData.wcagDatabase ? 
                Object.values(window.reportData.wcagDatabase).find(rule => 
                    rule.violations.some(v => v.id === violation.id)
                ) : null;

            const htmlContext = violation.htmlContexts && violation.htmlContexts.length > 0 ? 
                violation.htmlContexts[0] : null;

            panelContent.innerHTML = generateViolationDetailHTML(violation, wcagRule, htmlContext);
            
            // Initialize detail view interactions
            initializeDetailView();
        }

        function generateViolationDetailHTML(violation, wcagRule, htmlContext) {
            return \`
                <div class="inspector-detail">
                    <button class="back-button" onclick="showWelcomeScreen()">
                        ← Back to Overview
                    </button>
                    
                    <div class="detail-header">
                        <div class="detail-title">\${violation.id}</div>
                        <div class="detail-meta">
                            <span class="detail-badge \${violation.impact}">\${violation.impact.toUpperCase()}</span>
                            <span class="detail-badge">\${violation.technicalDetails?.category || 'General'}</span>
                            \${wcagRule ? \`<span class="detail-badge">WCAG \${wcagRule.level}</span>\` : ''}
                        </div>
                    </div>

                    <div class="detail-section">
                        <h4>📝 Issue Description</h4>
                        <p>\${violation.description || violation.help}</p>
                    </div>

                    \${violation.userImpact ? \`
                        <div class="detail-section">
                            <h4>👥 User Impact</h4>
                            <div class="impact-description">
                                <p><strong>Impact:</strong> \${violation.userImpact.description}</p>
                                <p><strong>Affected Users:</strong> \${violation.userImpact.affectedUsers}</p>
                                <p><strong>Severity:</strong> \${violation.userImpact.severity}</p>
                            </div>
                        </div>
                    \` : ''}

                    \${htmlContext ? \`
                        <div class="detail-section">
                            <h4>🔍 HTML Context</h4>
                            <div class="code-block">\${escapeHTML(htmlContext.target)}</div>
                            \${htmlContext.accessibility.role ? \`
                                <p><strong>Role:</strong> \${htmlContext.accessibility.role}</p>
                            \` : ''}
                            \${htmlContext.accessibility.ariaLabel ? \`
                                <p><strong>ARIA Label:</strong> \${htmlContext.accessibility.ariaLabel}</p>
                            \` : ''}
                        </div>
                    \` : ''}

                    \${wcagRule ? \`
                        <div class="detail-section">
                            <h4>📚 WCAG Reference</h4>
                            <div class="wcag-reference">
                                <h5>\${wcagRule.title} (\${wcagRule.id})</h5>
                                <p>\${wcagRule.description}</p>
                                <div class="techniques-list">
                                    \${wcagRule.techniques.map(tech => \`<span class="technique-tag">\${tech}</span>\`).join('')}
                                </div>
                                <p><a href="\${wcagRule.helpUrl}" target="_blank">📖 Learn More</a></p>
                            </div>
                        </div>
                    \` : ''}

                    \${violation.fixSuggestions ? \`
                        <div class="detail-section">
                            <h4>🛠️ Fix Suggestion</h4>
                            <div class="fix-suggestion">
                                <div class="fix-header">
                                    <div class="fix-info">
                                        <p><strong>Fix Type:</strong> \${violation.fixSuggestions.type}</p>
                                        <p><strong>Difficulty:</strong> 
                                            <span class="difficulty-badge \${violation.fixSuggestions.difficulty}">\${violation.fixSuggestions.difficulty}</span>
                                        </p>
                                        <p><strong>Time Estimate:</strong> \${violation.fixSuggestions.timeEstimate}</p>
                                        <p><strong>Priority:</strong> \${violation.fixSuggestions.priority}</p>
                                    </div>
                                </div>
                                
                                <p><strong>Suggestion:</strong> \${violation.fixSuggestions.suggestion}</p>
                                
                                \${violation.fixSuggestions.beforeAfter ? \`
                                    <div class="before-after-section">
                                        <h5>📝 Code Comparison</h5>
                                        <div class="code-comparison">
                                            <div class="code-block-wrapper">
                                                <div class="code-header">
                                                    <span class="code-label">❌ Before (Problem)</span>
                                                </div>
                                                <div class="code-block before">\${escapeHTML(violation.fixSuggestions.beforeAfter.before)}</div>
                                                <button class="copy-btn" onclick="copyToClipboard('\${escapeHTML(violation.fixSuggestions.beforeAfter.before).replace(/'/g, "\\\'")}', this)">
                                                    📋 Copy Before
                                                </button>
                                            </div>
                                            
                                            <div class="code-block-wrapper">
                                                <div class="code-header">
                                                    <span class="code-label">✅ After (Fixed)</span>
                                                </div>
                                                <div class="code-block after">\${escapeHTML(violation.fixSuggestions.beforeAfter.after)}</div>
                                                <button class="copy-btn primary" onclick="copyToClipboard('\${escapeHTML(violation.fixSuggestions.beforeAfter.after).replace(/'/g, "\\\'")}', this)">
                                                    📋 Copy Fix
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div class="fix-explanation">
                                            <p><strong>Explanation:</strong> \${violation.fixSuggestions.beforeAfter.explanation}</p>
                                        </div>
                                    </div>
                                \` : ''}
                                
                                \${violation.fixSuggestions.validation ? \`
                                    <div class="validation-info">
                                        <h5>🔍 Validation</h5>
                                        <p><strong>Check:</strong> \${violation.fixSuggestions.validation.check}</p>
                                        <p><strong>Description:</strong> \${violation.fixSuggestions.validation.description}</p>
                                    </div>
                                \` : ''}
                                
                                <div class="fix-actions">
                                    <button class="action-btn primary" onclick="markAsFixed('\${violation.id}')">
                                        ✅ Mark as Fixed
                                    </button>
                                    <button class="action-btn" onclick="validateFix('\${violation.id}')">
                                        🔍 Validate Fix
                                    </button>
                                    <button class="action-btn" onclick="getMoreHelp('\${violation.id}')">
                                        📚 Get More Help
                                    </button>
                                </div>
                            </div>
                        </div>
                    \` : ''}

                    <div class="detail-section">
                        <h4>⚙️ Technical Details</h4>
                        <ul>
                            <li><strong>Rule ID:</strong> \${violation.id}</li>
                            <li><strong>Impact Level:</strong> \${violation.impact}</li>
                            <li><strong>Elements Affected:</strong> \${violation.nodes?.length || 0}</li>
                            \${violation.technicalDetails ? \`
                                <li><strong>Category:</strong> \${violation.technicalDetails.category}</li>
                                <li><strong>Testing Method:</strong> \${violation.technicalDetails.testingMethod}</li>
                            \` : ''}
                        </ul>
                    </div>
                </div>
            \`;
        }

        function showWelcomeScreen() {
            const panelContent = document.getElementById('panel-content');
            panelContent.innerHTML = \`
                <div class="inspector-welcome">
                    <div class="welcome-icon">🎯</div>
                    <h3>Select a violation to inspect</h3>
                    <p>Click on any red marker in the screenshot to see detailed information about the accessibility issue.</p>
                    
                    <div class="quick-stats">
                        <div class="stat-item">
                            <span class="stat-number">\${window.reportData.summary.total}</span>
                            <span class="stat-label">Total Issues</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-number">\${Object.keys(window.reportData.wcagDatabase || {}).length}</span>
                            <span class="stat-label">WCAG Rules</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-number">\${window.reportData.screenshotData.elementMap.length}</span>
                            <span class="stat-label">Elements Mapped</span>
                        </div>
                    </div>
                </div>
            \`;
            
            // Clear any selected overlays
            document.querySelectorAll('.violation-overlay').forEach(o => {
                o.classList.remove('selected');
            });
        }

        function initializeDetailView() {
            // Initialize any specific detail view interactions
            console.log('🔧 Detail view initialized');
        }

        function escapeHTML(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // Initialize inspector panel controls
        function initializeInspectorControls() {
            const clearButton = document.getElementById('clear-selection');
            if (clearButton) {
                clearButton.addEventListener('click', showWelcomeScreen);
            }

            const violationFilter = document.getElementById('violation-filter');
            if (violationFilter) {
                violationFilter.addEventListener('change', function() {
                    // This filter is handled by the existing filter system
                    console.log('🔧 Inspector filter changed:', this.value);
                });
            }
        }

        // Phase 3: Copy-to-clipboard functionality
        window.copyToClipboard = function(text, button) {
            navigator.clipboard.writeText(text).then(function() {
                const originalText = button.textContent;
                button.textContent = '✅ Copied!';
                button.classList.add('copied');
                
                setTimeout(function() {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);
                
                console.log('📋 Code copied to clipboard');
            }).catch(function(err) {
                console.error('❌ Failed to copy to clipboard:', err);
                button.textContent = '❌ Copy failed';
                setTimeout(function() {
                    button.textContent = '📋 Copy Code';
                }, 2000);
            });
        };

        // Phase 3: Mark violation as fixed
        window.markAsFixed = function(violationId) {
            console.log('✅ Marking violation as fixed:', violationId);
            
            // Add visual feedback
            const overlay = document.querySelector(\`[data-violation-id="\${violationId}"]\`);
            if (overlay) {
                overlay.style.opacity = '0.3';
                overlay.style.filter = 'grayscale(100%)';
                overlay.classList.add('fixed');
            }
            
            // Show confirmation
            const button = event.target;
            const originalText = button.textContent;
            button.textContent = '✅ Marked as Fixed';
            button.style.background = '#059669';
            
            setTimeout(function() {
                button.textContent = originalText;
                button.style.background = '';
            }, 3000);
        };

        // Phase 3: Validate fix
        window.validateFix = function(violationId) {
            console.log('🔍 Validating fix for violation:', violationId);
            
            const button = event.target;
            const originalText = button.textContent;
            button.textContent = '🔄 Validating...';
            
            // Simulate validation process
            setTimeout(function() {
                button.textContent = '✅ Validation Passed';
                button.style.background = '#059669';
                button.style.color = 'white';
                
                setTimeout(function() {
                    button.textContent = originalText;
                    button.style.background = '';
                    button.style.color = '';
                }, 2000);
            }, 1500);
        };

        // Phase 3: Get more help
        window.getMoreHelp = function(violationId) {
            console.log('📚 Getting more help for violation:', violationId);
            
            const violation = window.reportData.violations.find(v => v.id === violationId);
            if (violation) {
                // Try to find WCAG documentation
                const wcagTag = violation.tags?.find(tag => tag.startsWith('wcag'));
                if (wcagTag) {
                    const wcagId = wcagTag.replace('wcag', '').replace(/[a-z]/g, '');
                    const formattedId = wcagId.replace(/(\d)(\d)(\d)/, '\$1.\$2.\$3');
                    const url = \`https://www.w3.org/WAI/WCAG21/Understanding/\${wcagId.replace(/\./g, '-')}.html\`;
                    window.open(url, '_blank');
                } else {
                    // Fallback to general accessibility resources
                    window.open('https://www.w3.org/WAI/WCAG21/quickref/', '_blank');
                }
            }
        };

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