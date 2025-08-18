const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');
const InteractiveReportGenerator = require('./src/interactive-report-generator');

/**
 * Comprehensive Visual Inspection & Testing Suite
 * Systematically tests all aspects of interactive reports
 */
class VisualInspectionSuite {
  constructor() {
    this.inspectionDir = path.join(__dirname, 'visual-inspection');
    this.screenshotsDir = path.join(this.inspectionDir, 'screenshots');
    this.reportsDir = path.join(this.inspectionDir, 'test-reports');
    this.analysisDir = path.join(this.inspectionDir, 'analysis');
    
    this.viewports = {
      desktop: { width: 1920, height: 1080, name: 'desktop' },
      tablet: { width: 1024, height: 768, name: 'tablet' },
      mobile: { width: 375, height: 667, name: 'mobile' }
    };
    
    this.testResults = {
      visual: {},
      functional: {},
      performance: {},
      issues: []
    };
  }

  async initialize() {
    await fs.ensureDir(this.inspectionDir);
    await fs.ensureDir(this.screenshotsDir);
    await fs.ensureDir(this.reportsDir);
    await fs.ensureDir(this.analysisDir);
    
    console.log('📁 Visual inspection directories created');
  }

  /**
   * Generate test reports with different violation scenarios
   */
  async generateTestReports() {
    console.log('📄 Generating test reports for visual inspection...');
    
    const testScenarios = [
      {
        name: 'empty-state',
        description: 'No violations (perfect accessibility)',
        html: this.generateCleanHTML()
      },
      {
        name: 'low-violations', 
        description: '1-5 violations (minor issues)',
        html: this.generateLowViolationsHTML()
      },
      {
        name: 'medium-violations',
        description: '10-20 violations (typical website)',
        html: this.generateMediumViolationsHTML()
      },
      {
        name: 'high-violations',
        description: '50+ violations (problematic website)',
        html: this.generateHighViolationsHTML()
      },
      {
        name: 'complex-violations',
        description: 'All violation types (comprehensive test)',
        html: this.generateComplexViolationsHTML()
      }
    ];

    const reports = [];
    let browser;

    try {
      browser = await puppeteer.launch({ headless: true });
      
      for (const scenario of testScenarios) {
        console.log(`  🔍 Generating: ${scenario.name} - ${scenario.description}`);
        
        const page = await browser.newPage();
        await page.setContent(scenario.html);
        
        // Add axe-core
        await page.addScriptTag({
          path: path.join(__dirname, 'node_modules/axe-core/axe.min.js')
        });

        const violations = await page.evaluate(async () => {
          const results = await axe.run();
          return results.violations;
        });

        // Generate interactive report
        const reportGenerator = new InteractiveReportGenerator();
        const report = await reportGenerator.generateInteractiveReport(
          page,
          violations,
          {
            url: `test-scenario-${scenario.name}`,
            timestamp: new Date().toISOString(),
            scenario: scenario.name,
            description: scenario.description
          }
        );

        reports.push({
          scenario: scenario.name,
          description: scenario.description,
          violations: violations.length,
          elementsAffected: violations.reduce((sum, v) => sum + v.nodes.length, 0),
          reportPath: report.htmlPath,
          reportId: report.reportId,
          accessibilityScore: report.summary.accessibilityScore
        });

        console.log(`    ✅ ${scenario.name}: ${violations.length} violations, Score: ${report.summary.accessibilityScore}/100`);
        await page.close();
      }

      await browser.close();
      
      // Save test reports manifest
      await fs.writeJson(path.join(this.inspectionDir, 'test-reports-manifest.json'), {
        generated: new Date().toISOString(),
        scenarios: reports,
        summary: {
          totalReports: reports.length,
          violationRange: {
            min: Math.min(...reports.map(r => r.violations)),
            max: Math.max(...reports.map(r => r.violations))
          }
        }
      }, { spaces: 2 });

      console.log(`✅ Generated ${reports.length} test reports for inspection`);
      return reports;

    } catch (error) {
      if (browser) await browser.close();
      throw error;
    }
  }

  /**
   * Take systematic screenshots of all reports in all viewports
   */
  async captureSystematicScreenshots(reports) {
    console.log('📸 Capturing systematic screenshots...');
    
    let browser;
    const screenshots = [];

    try {
      browser = await puppeteer.launch({ headless: true });

      for (const report of reports) {
        console.log(`  📷 Screenshot session: ${report.scenario}`);
        
        for (const [viewportName, viewport] of Object.entries(this.viewports)) {
          console.log(`    📱 ${viewportName} (${viewport.width}x${viewport.height})`);
          
          const page = await browser.newPage();
          await page.setViewport(viewport);
          
          // Load the report
          await page.goto(`file://${report.reportPath}`, { waitUntil: 'networkidle0' });
          await new Promise(resolve => setTimeout(resolve, 2000)); // Let animations settle

          const sessionScreenshots = await this.captureReportStates(page, report.scenario, viewportName);
          screenshots.push(...sessionScreenshots);

          await page.close();
        }
      }

      await browser.close();
      
      console.log(`✅ Captured ${screenshots.length} screenshots total`);
      return screenshots;

    } catch (error) {
      if (browser) await browser.close();
      throw error;
    }
  }

  /**
   * Capture different states of a single report
   */
  async captureReportStates(page, scenario, viewport) {
    const screenshots = [];
    const baseFilename = `${scenario}-${viewport}`;

    // 1. Initial Load State
    await this.takeScreenshot(page, `${baseFilename}-01-initial-load`, 'Initial page load');
    screenshots.push({ scenario, viewport, state: 'initial-load', filename: `${baseFilename}-01-initial-load.png` });

    // 2. All Violations Visible
    await this.takeScreenshot(page, `${baseFilename}-02-all-violations`, 'All violation overlays visible');
    screenshots.push({ scenario, viewport, state: 'all-violations', filename: `${baseFilename}-02-all-violations.png` });

    // 3. Inspector Panel Interaction
    if (await this.hasViolations(page)) {
      await this.clickFirstViolation(page);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.takeScreenshot(page, `${baseFilename}-03-inspector-open`, 'Inspector panel opened');
      screenshots.push({ scenario, viewport, state: 'inspector-open', filename: `${baseFilename}-03-inspector-open.png` });

      // 4. Fix Suggestions Visible
      await this.takeScreenshot(page, `${baseFilename}-04-fix-suggestions`, 'Fix suggestions visible');
      screenshots.push({ scenario, viewport, state: 'fix-suggestions', filename: `${baseFilename}-04-fix-suggestions.png` });
    }

    // 5. Filter States
    await this.testFilterStates(page, baseFilename, screenshots);

    // 6. Mobile-specific tests
    if (viewport === 'mobile') {
      await this.testMobileStates(page, baseFilename, screenshots);
    }

    return screenshots;
  }

  async testFilterStates(page, baseFilename, screenshots) {
    try {
      // Hide critical violations
      await page.click('#show-critical');
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.takeScreenshot(page, `${baseFilename}-05-filter-no-critical`, 'Critical violations hidden');
      screenshots.push({ scenario: baseFilename.split('-')[0], viewport: baseFilename.split('-')[1], state: 'filter-no-critical', filename: `${baseFilename}-05-filter-no-critical.png` });

      // Show only serious
      await page.click('#show-serious');
      await page.click('#show-moderate');
      await page.click('#show-minor');
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.takeScreenshot(page, `${baseFilename}-06-filter-serious-only`, 'Only serious violations');
      screenshots.push({ scenario: baseFilename.split('-')[0], viewport: baseFilename.split('-')[1], state: 'filter-serious-only', filename: `${baseFilename}-06-filter-serious-only.png` });

      // Reset filters
      await page.click('#show-critical');
      await page.click('#show-moderate');
      await page.click('#show-minor');
    } catch (error) {
      console.warn(`    ⚠️ Filter testing failed: ${error.message}`);
    }
  }

  async testMobileStates(page, baseFilename, screenshots) {
    try {
      // Test mobile layout
      await this.takeScreenshot(page, `${baseFilename}-07-mobile-layout`, 'Mobile responsive layout');
      screenshots.push({ scenario: baseFilename.split('-')[0], viewport: 'mobile', state: 'mobile-layout', filename: `${baseFilename}-07-mobile-layout.png` });
    } catch (error) {
      console.warn(`    ⚠️ Mobile testing failed: ${error.message}`);
    }
  }

  async takeScreenshot(page, filename, description) {
    const filepath = path.join(this.screenshotsDir, `${filename}.png`);
    await page.screenshot({ 
      path: filepath, 
      fullPage: true,
      type: 'png'
    });
    console.log(`    📸 ${description} → ${filename}.png`);
  }

  async hasViolations(page) {
    try {
      const violations = await page.$$('.violation-overlay');
      return violations.length > 0;
    } catch {
      return false;
    }
  }

  async clickFirstViolation(page) {
    try {
      await page.click('.violation-overlay:first-child');
    } catch (error) {
      console.warn('    ⚠️ Could not click first violation:', error.message);
    }
  }

  /**
   * HTML generators for different test scenarios
   */
  generateCleanHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Perfect Accessibility - Test Scenario</title>
</head>
<body>
    <header>
        <h1>Perfect Accessibility Example</h1>
        <nav aria-label="Main navigation">
            <ul>
                <li><a href="#main">Main Content</a></li>
                <li><a href="#about">About</a></li>
                <li><a href="#contact">Contact</a></li>
            </ul>
        </nav>
    </header>
    
    <main id="main">
        <section>
            <h2>Welcome Section</h2>
            <p>This page has perfect accessibility with no violations.</p>
            <img src="hero.jpg" alt="Team working together in bright office space">
            
            <form>
                <div>
                    <label for="email">Email Address</label>
                    <input type="email" id="email" required>
                </div>
                <div>
                    <label for="message">Message</label>
                    <textarea id="message" required></textarea>
                </div>
                <button type="submit">Send Message</button>
            </form>
        </section>
    </main>
</body>
</html>`;
  }

  generateLowViolationsHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Low Violations - Test Scenario</title>
</head>
<body>
    <h1>Low Violations Example</h1>
    <img src="image.jpg"> <!-- Missing alt -->
    <p>Some content here.</p>
    <input type="text" placeholder="Enter text"> <!-- Missing label -->
    <div style="color: #999; background: #fff;">Low contrast text</div>
</body>
</html>`;
  }

  generateMediumViolationsHTML() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Medium Violations - Test Scenario</title>
</head>
<body>
    <h1>Medium Violations Example</h1>
    <h3>Skipped h2</h3> <!-- Heading order -->
    
    <div>
        <img src="img1.jpg">
        <img src="img2.jpg">
        <img src="img3.jpg">
    </div>
    
    <form>
        <input type="text">
        <input type="email">
        <input type="password">
        <select>
            <option>Option 1</option>
        </select>
        <textarea></textarea>
    </form>
    
    <div style="color: #aaa; background: #fff;">
        <span style="color: #bbb;">Very low contrast</span>
        <span style="color: #ccc;">Even lower contrast</span>
    </div>
    
    <a href="#">Click here</a>
    <a href="#">Read more</a>
    <a href="#">Link</a>
</body>
</html>`;
  }

  generateHighViolationsHTML() {
    const violations = [];
    for (let i = 0; i < 20; i++) {
      violations.push(`<img src="img${i}.jpg">`);
      violations.push(`<input type="text" placeholder="Input ${i}">`);
      violations.push(`<div style="color: #${(i + 10).toString(16)}${(i + 10).toString(16)}${(i + 10).toString(16)}; background: #fff;">Text ${i}</div>`);
      violations.push(`<a href="#">Link ${i}</a>`);
    }
    
    return `<!DOCTYPE html>
<html>
<head><title>High Violations - Test Scenario</title></head>
<body>
    <h1>High Violations Example</h1>
    <h4>Bad heading order</h4>
    ${violations.join('\n    ')}
</body>
</html>`;
  }

  generateComplexViolationsHTML() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Complex Violations - Test Scenario</title>
    <style>
        .blink { animation: blink 1s infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .tiny { font-size: 8px; }
    </style>
</head>
<body>
    <h1>Complex Violations Example</h1>
    <h4>Bad heading hierarchy</h4>
    
    <!-- Images without alt -->
    <img src="decorative.jpg">
    <img src="important.jpg">
    
    <!-- Forms without labels -->
    <form>
        <input type="text" placeholder="Name">
        <input type="email" placeholder="Email">
        <select>
            <option>Choose option</option>
        </select>
        <textarea placeholder="Message"></textarea>
    </form>
    
    <!-- Color/Contrast issues -->
    <div style="color: #999; background: #fff;">Low contrast</div>
    <div style="color: #aaa; background: #fff;">Very low contrast</div>
    <span style="color: red;">Error indicated by color only</span>
    
    <!-- Links -->
    <a href="#">Click here</a>
    <a href="#">Read more</a>
    <a href="#">Link</a>
    
    <!-- Animation/Motion -->
    <div class="blink">Blinking content</div>
    
    <!-- Text size -->
    <p class="tiny">Very small text that's hard to read</p>
    
    <!-- ARIA issues -->
    <div role="button">Fake button without keyboard support</div>
    <div aria-hidden="true"><button>Hidden but focusable</button></div>
    
    <!-- Structure issues -->
    <table>
        <tr><td>Data 1</td><td>Data 2</td></tr>
        <tr><td>Data 3</td><td>Data 4</td></tr>
    </table>
</body>
</html>`;
  }

  /**
   * Run the complete visual inspection suite
   */
  async runCompleteInspection() {
    console.log('🚀 Starting Complete Visual Inspection Suite');
    console.log('='.repeat(60));
    
    try {
      await this.initialize();
      
      console.log('\n📄 Phase 1: Generate Test Reports');
      const reports = await this.generateTestReports();
      
      console.log('\n📸 Phase 2: Capture Screenshots');
      const screenshots = await this.captureSystematicScreenshots(reports);
      
      console.log('\n📊 Phase 3: Analysis Summary');
      await this.generateAnalysisSummary(reports, screenshots);
      
      console.log('\n✅ Visual Inspection Suite Complete!');
      console.log(`📁 Results in: ${this.inspectionDir}`);
      console.log(`📷 Screenshots: ${screenshots.length} images captured`);
      console.log(`📋 Reports: ${reports.length} scenarios tested`);
      
      return {
        reports,
        screenshots,
        inspectionDir: this.inspectionDir
      };
      
    } catch (error) {
      console.error('❌ Visual inspection failed:', error);
      throw error;
    }
  }

  async generateAnalysisSummary(reports, screenshots) {
    const summary = {
      timestamp: new Date().toISOString(),
      testSummary: {
        scenarios: reports.length,
        screenshots: screenshots.length,
        viewports: Object.keys(this.viewports).length
      },
      reports: reports.map(r => ({
        scenario: r.scenario,
        violations: r.violations,
        score: r.accessibilityScore,
        reportPath: r.reportPath
      })),
      screenshots: screenshots.map(s => ({
        scenario: s.scenario,
        viewport: s.viewport,
        state: s.state,
        filename: s.filename
      })),
      recommendations: [
        'Review all screenshots for visual consistency',
        'Test interactive elements manually',
        'Verify mobile responsiveness',
        'Check color contrast in different scenarios',
        'Validate fix suggestions accuracy'
      ]
    };

    await fs.writeJson(
      path.join(this.analysisDir, 'inspection-summary.json'), 
      summary, 
      { spaces: 2 }
    );

    console.log('  📊 Analysis summary generated');
  }
}

// Export for use as module
module.exports = VisualInspectionSuite;

// Run if called directly
if (require.main === module) {
  const suite = new VisualInspectionSuite();
  suite.runCompleteInspection()
    .then((results) => {
      console.log('\n🎉 Inspection complete! Next steps:');
      console.log(`1. Review screenshots in: ${results.inspectionDir}/screenshots/`);
      console.log(`2. Open test reports for manual testing`);
      console.log(`3. Check analysis summary for recommendations`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Inspection failed:', error.message);
      process.exit(1);
    });
}