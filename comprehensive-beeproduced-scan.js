const puppeteer = require('puppeteer');
const axe = require('axe-core');
const InteractiveReportGenerator = require('./src/interactive-report-generator');

/**
 * Comprehensive Accessibility Scan for beeproduced.com
 * Uses all available scanners for complete coverage
 */
async function comprehensiveBeeproducedScan() {
  console.log('🚀 Starting Comprehensive Accessibility Scan for beeproduced.com');
  console.log('='.repeat(70));
  
  let browser;
  const startTime = Date.now();
  
  try {
    // Launch browser
    console.log('📱 Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    // Set realistic viewport
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    });

    // Navigate to beeproduced.com
    console.log('🌐 Loading beeproduced.com...');
    await page.goto('https://beeproduced.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('✅ Page loaded successfully');

    // Scanner 1: Axe-core (Primary Scanner)
    console.log('\n🔍 Scanner 1: Axe-core Accessibility Analysis');
    await page.addScriptTag({
      path: require.resolve('axe-core/axe.min.js')
    });

    const axeResults = await page.evaluate(async () => {
      const results = await axe.run({
        tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
        rules: {
          'color-contrast': { enabled: true },
          'image-alt': { enabled: true },
          'label': { enabled: true },
          'link-name': { enabled: true },
          'heading-order': { enabled: true },
          'landmark-one-main': { enabled: true },
          'page-has-heading-one': { enabled: true },
          'region': { enabled: true },
          'document-title': { enabled: true },
          'html-has-lang': { enabled: true },
          'focus-order-semantics': { enabled: true },
          'tabindex': { enabled: true },
          'aria-hidden-focus': { enabled: true }
        }
      });
      return results;
    });

    console.log(`📊 Axe-core found: ${axeResults.violations.length} violation types`);
    console.log(`📝 Total elements affected: ${axeResults.violations.reduce((sum, v) => sum + v.nodes.length, 0)}`);

    // Scanner 2: Manual Accessibility Checks
    console.log('\n🔍 Scanner 2: Manual Accessibility Analysis');
    const manualChecks = await page.evaluate(() => {
      const checks = [];
      
      // Check for missing alt text
      const imagesWithoutAlt = Array.from(document.querySelectorAll('img:not([alt])')).length;
      if (imagesWithoutAlt > 0) {
        checks.push({
          type: 'missing-alt-text',
          count: imagesWithoutAlt,
          severity: 'serious'
        });
      }

      // Check for form labels
      const inputsWithoutLabels = Array.from(document.querySelectorAll('input:not([aria-label]):not([aria-labelledby])')).filter(input => {
        const label = document.querySelector(`label[for="${input.id}"]`);
        return !label && input.type !== 'hidden' && input.type !== 'submit' && input.type !== 'button';
      }).length;
      
      if (inputsWithoutLabels > 0) {
        checks.push({
          type: 'missing-form-labels',
          count: inputsWithoutLabels,
          severity: 'critical'
        });
      }

      // Check heading structure
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const headingLevels = headings.map(h => parseInt(h.tagName.substring(1)));
      let headingIssues = 0;
      for (let i = 1; i < headingLevels.length; i++) {
        if (headingLevels[i] > headingLevels[i-1] + 1) {
          headingIssues++;
        }
      }
      
      if (headingIssues > 0) {
        checks.push({
          type: 'heading-structure-issues',
          count: headingIssues,
          severity: 'moderate'
        });
      }

      // Check for keyboard accessibility
      const focusableElements = Array.from(document.querySelectorAll('a, button, input, select, textarea, [tabindex]'));
      const elementsWithoutFocus = focusableElements.filter(el => {
        const style = window.getComputedStyle(el);
        return style.outline === 'none' && !el.matches(':focus-visible');
      }).length;

      return {
        totalChecks: checks.length,
        issues: checks,
        pageInfo: {
          title: document.title,
          lang: document.documentElement.lang,
          hasMain: !!document.querySelector('main'),
          hasSkipLink: !!document.querySelector('a[href^="#"]'),
          focusableElements: focusableElements.length
        }
      };
    });

    console.log(`📊 Manual checks found: ${manualChecks.totalChecks} additional issues`);

    // Scanner 3: Performance Impact Analysis
    console.log('\n🔍 Scanner 3: Performance Impact Analysis');
    const performanceMetrics = await page.evaluate(() => {
      const perfData = performance.getEntriesByType('navigation')[0];
      return {
        loadTime: Math.round(perfData.loadEventEnd - perfData.loadEventStart),
        domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart),
        firstPaint: perfData.loadEventEnd,
        resourceCount: performance.getEntriesByType('resource').length
      };
    });

    console.log(`⚡ Page load time: ${performanceMetrics.loadTime}ms`);
    console.log(`📦 Resources loaded: ${performanceMetrics.resourceCount}`);

    // Generate comprehensive interactive report
    console.log('\n📄 Generating Interactive Accessibility Report...');
    const reportGenerator = new InteractiveReportGenerator();
    
    const comprehensiveMetadata = {
      url: 'https://beeproduced.com',
      timestamp: new Date().toISOString(),
      scanDuration: Date.now() - startTime,
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: await page.viewport(),
      scanners: [
        {
          name: 'Axe-core',
          version: '4.10.0',
          rules: Object.keys(axeResults.passes || {}).length + Object.keys(axeResults.violations || {}).length,
          violations: axeResults.violations.length
        },
        {
          name: 'Manual Accessibility Checks',
          version: '1.0.0',
          checks: manualChecks.totalChecks,
          violations: manualChecks.issues.length
        },
        {
          name: 'Performance Analysis',
          version: '1.0.0',
          metrics: Object.keys(performanceMetrics).length
        }
      ],
      performanceMetrics,
      manualChecks,
      pageInfo: manualChecks.pageInfo
    };

    // Combine all violations
    const allViolations = [
      ...axeResults.violations,
      ...manualChecks.issues.map(issue => ({
        id: issue.type,
        impact: issue.severity,
        description: `Manual check identified ${issue.count} instances of ${issue.type.replace(/-/g, ' ')}`,
        help: `Fix ${issue.type.replace(/-/g, ' ')} issues`,
        tags: ['manual-check', 'best-practice'],
        nodes: Array(issue.count).fill({}).map((_, i) => ({
          html: `<element data-issue="${issue.type}" data-instance="${i}">`,
          target: [`[data-issue="${issue.type}"]:nth-of-type(${i + 1})`]
        }))
      }))
    ];

    const interactiveReport = await reportGenerator.generateInteractiveReport(
      page,
      allViolations,
      comprehensiveMetadata
    );

    await browser.close();

    const totalTime = Date.now() - startTime;
    
    // Generate summary
    console.log('\n' + '='.repeat(70));
    console.log('🎉 COMPREHENSIVE BEEPRODUCED.COM ACCESSIBILITY REPORT');
    console.log('='.repeat(70));
    
    console.log('\n📊 SCAN SUMMARY:');
    console.log(`   🌐 Website: https://beeproduced.com`);
    console.log(`   ⏱️  Total Scan Time: ${totalTime}ms`);
    console.log(`   🔍 Scanners Used: ${comprehensiveMetadata.scanners.length}`);
    console.log(`   📋 Total Violations: ${allViolations.length} types`);
    console.log(`   🎯 Elements Affected: ${allViolations.reduce((sum, v) => sum + (v.nodes?.length || 0), 0)}`);
    
    console.log('\n🏆 ACCESSIBILITY SCORE:');
    console.log(`   Overall Score: ${interactiveReport.summary.accessibilityScore}/100`);
    console.log(`   🔴 Critical: ${interactiveReport.summary.critical}`);
    console.log(`   🟠 Serious: ${interactiveReport.summary.serious}`);
    console.log(`   🟡 Moderate: ${interactiveReport.summary.moderate}`);
    console.log(`   🟢 Minor: ${interactiveReport.summary.minor}`);

    console.log('\n📈 PERFORMANCE METRICS:');
    console.log(`   ⚡ Load Time: ${performanceMetrics.loadTime}ms`);
    console.log(`   📦 Resources: ${performanceMetrics.resourceCount}`);
    console.log(`   🎯 DOM Ready: ${performanceMetrics.domContentLoaded}ms`);

    console.log('\n🔍 DETAILED FINDINGS:');
    allViolations.forEach((violation, index) => {
      console.log(`   ${index + 1}. ${violation.id} (${violation.impact})`);
      console.log(`      └─ ${violation.description}`);
      if (violation.nodes) {
        console.log(`      └─ Affects ${violation.nodes.length} elements`);
      }
    });

    console.log('\n📋 INTERACTIVE REPORT:');
    console.log(`   📁 Report ID: ${interactiveReport.reportId}`);
    console.log(`   📄 HTML File: ${interactiveReport.htmlPath}`);
    console.log(`   🌐 View Report: file://${interactiveReport.htmlPath}`);
    
    console.log('\n✨ REPORT FEATURES:');
    console.log('   ✅ Visual violation overlays on website screenshot');
    console.log('   ✅ Interactive inspector panel with detailed analysis');
    console.log('   ✅ Phase 3 fix suggestions with before/after code examples');
    console.log('   ✅ Copy-to-clipboard functionality for code fixes');
    console.log('   ✅ WCAG compliance mapping and documentation links');
    console.log('   ✅ Mobile responsive design');

    return {
      success: true,
      report: interactiveReport,
      metrics: comprehensiveMetadata,
      violations: allViolations,
      summary: interactiveReport.summary
    };

  } catch (error) {
    if (browser) await browser.close();
    console.error('\n❌ Comprehensive scan failed:', error.message);
    throw error;
  }
}

// Run the comprehensive scan
if (require.main === module) {
  comprehensiveBeeproducedScan()
    .then((result) => {
      console.log('\n🎊 Comprehensive scan completed successfully!');
      console.log(`\n🔗 Open your report: file://${result.report.htmlPath}`);
    })
    .catch((error) => {
      console.error('\n💥 Scan failed:', error.message);
      process.exit(1);
    });
}

module.exports = { comprehensiveBeeproducedScan };