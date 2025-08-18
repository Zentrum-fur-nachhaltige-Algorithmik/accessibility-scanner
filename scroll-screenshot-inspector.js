const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');

/**
 * Scroll-based Screenshot Inspector
 * Takes multiple screenshots while scrolling through long pages
 */
class ScrollScreenshotInspector {
  constructor() {
    this.screenshotsDir = path.join(__dirname, 'visual-inspection/scroll-screenshots');
    this.findings = [];
  }

  async initialize() {
    await fs.ensureDir(this.screenshotsDir);
    console.log('📁 Scroll screenshots directory ready');
  }

  async inspectReportWithScrolling(reportPath, reportName) {
    console.log(`🔍 Inspecting ${reportName} with scroll-based screenshots`);
    
    let browser;
    try {
      browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      
      await page.goto(`file://${reportPath}`, { waitUntil: 'networkidle0' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get page dimensions
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight
      }));
      
      console.log(`📊 Page: ${dimensions.width}x${dimensions.height}px (viewport: ${dimensions.viewportHeight}px)`);
      
      // Calculate scroll positions
      const scrollStep = Math.floor(dimensions.viewportHeight * 0.8); // 80% overlap
      const totalScrolls = Math.ceil(dimensions.height / scrollStep);
      
      console.log(`📸 Taking ${totalScrolls} screenshots with ${scrollStep}px scroll steps`);
      
      const screenshots = [];
      
      for (let i = 0; i < totalScrolls; i++) {
        const scrollY = i * scrollStep;
        
        // Scroll to position
        await page.evaluate((y) => {
          window.scrollTo(0, y);
        }, scrollY);
        
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll
        
        // Take screenshot
        const filename = `${reportName}-scroll-${String(i + 1).padStart(2, '0')}-y${scrollY}.png`;
        const filepath = path.join(this.screenshotsDir, filename);
        
        await page.screenshot({
          path: filepath,
          fullPage: false,
          type: 'png'
        });
        
        console.log(`  📸 ${filename} (y: ${scrollY}px)`);
        
        screenshots.push({
          filename,
          scrollY,
          section: this.identifySection(scrollY, dimensions.height)
        });
      }
      
      // Additional focused screenshots
      await this.takeFocusedScreenshots(page, reportName);
      
      await browser.close();
      
      return {
        reportName,
        dimensions,
        screenshots,
        totalScrolls
      };
      
    } catch (error) {
      if (browser) await browser.close();
      throw error;
    }
  }

  async takeFocusedScreenshots(page, reportName) {
    console.log('📸 Taking focused component screenshots...');
    
    const components = [
      { selector: '.report-header', name: 'header' },
      { selector: '.summary-section', name: 'summary' },
      { selector: '.controls-section', name: 'controls' },
      { selector: '.main-interface', name: 'main-interface' },
      { selector: '.screenshot-panel', name: 'screenshot-panel' },
      { selector: '.inspector-panel', name: 'inspector-panel' },
      { selector: '.violations-list', name: 'violations-list' }
    ];
    
    for (const component of components) {
      try {
        const element = await page.$(component.selector);
        if (element) {
          const filename = `${reportName}-component-${component.name}.png`;
          const filepath = path.join(this.screenshotsDir, filename);
          
          await element.screenshot({
            path: filepath,
            type: 'png'
          });
          
          console.log(`  🎯 ${filename}`);
        }
      } catch (error) {
        console.warn(`  ⚠️ Could not capture ${component.name}: ${error.message}`);
      }
    }
  }

  identifySection(scrollY, totalHeight) {
    const percentage = (scrollY / totalHeight) * 100;
    
    if (percentage < 10) return 'header-summary';
    if (percentage < 25) return 'controls';
    if (percentage < 60) return 'main-interface';
    if (percentage < 90) return 'violations-list-start';
    return 'violations-list-end';
  }

  async runSystematicScrollInspection() {
    console.log('🚀 Starting Systematic Scroll-based Visual Inspection');
    console.log('='.repeat(60));
    
    await this.initialize();
    
    const reportsToInspect = [
      {
        path: '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-289e5a1d-961c-441e-985b-9b5b18e0a92c/index.html',
        name: 'medium-violations'
      },
      {
        path: '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-d3d33b33-2a08-4472-acad-5118eeea4cd5/index.html',
        name: 'empty-state'
      },
      {
        path: '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-d2a2a2d2-e7f7-4f64-ad48-df80d93f13b8/index.html',
        name: 'complex-violations'
      }
    ];
    
    const results = [];
    
    for (const report of reportsToInspect) {
      console.log(`\n📄 Inspecting: ${report.name}`);
      const result = await this.inspectReportWithScrolling(report.path, report.name);
      results.push(result);
    }
    
    // Generate inspection summary
    await this.generateScrollInspectionSummary(results);
    
    console.log(`\n✅ Scroll-based inspection complete!`);
    console.log(`📁 Screenshots saved in: ${this.screenshotsDir}`);
    console.log(`📊 Total screenshots: ${results.reduce((sum, r) => sum + r.screenshots.length, 0)}`);
    
    return results;
  }

  async generateScrollInspectionSummary(results) {
    const summary = {
      timestamp: new Date().toISOString(),
      method: 'scroll-based-screenshot-inspection',
      reports: results.map(r => ({
        name: r.reportName,
        dimensions: r.dimensions,
        screenshotCount: r.screenshots.length,
        sections: r.screenshots.map(s => s.section)
      })),
      findings: [
        'Full page content now visible through scroll-based screenshots',
        'Can inspect header, summary, controls, main interface, and violations list separately',
        'Component-specific screenshots allow detailed analysis',
        'Method resolves fullPage screenshot corruption issue'
      ]
    };
    
    await fs.writeJson(
      path.join(this.screenshotsDir, 'scroll-inspection-summary.json'),
      summary,
      { spaces: 2 }
    );
    
    console.log(`📋 Inspection summary saved`);
  }
}

// Run if called directly
if (require.main === module) {
  const inspector = new ScrollScreenshotInspector();
  inspector.runSystematicScrollInspection()
    .then(() => {
      console.log('\n🎉 Ready for visual analysis!');
      console.log('Next steps:');
      console.log('1. Review scroll screenshots for layout issues');
      console.log('2. Check component screenshots for design quality');
      console.log('3. Identify violations overlay positioning');
      console.log('4. Test responsive behavior');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Scroll inspection failed:', error.message);
      process.exit(1);
    });
}

module.exports = ScrollScreenshotInspector;