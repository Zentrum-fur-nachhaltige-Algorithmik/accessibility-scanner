const MultiPageScanner = require('./src/multi-page-scanner');
const SiteAccessibilityReport = require('./src/site-accessibility-report');
const fs = require('fs-extra');
const path = require('path');

/**
 * End-to-End Multi-Page Scanner Test
 * Comprehensive testing of the multi-page scanning functionality
 */
async function testMultiPageScanning() {
  console.log('🧪 Starting End-to-End Multi-Page Scanner Test\n');
  
  const scanner = new MultiPageScanner({
    maxPages: 10,
    maxDepth: 2,
    timeout: 15000,
    includeScreenshots: false, // Disable for testing
    generateReport: true
  });
  
  const reportGenerator = new SiteAccessibilityReport();
  
  const testSites = [
    {
      name: 'Local Corporate Site',
      url: 'http://localhost:3000/test-html/multi-page-sites/corporate-site/index.html',
      expectedPages: 5
    },
    {
      name: 'Local E-commerce Site', 
      url: 'http://localhost:3000/test-html/multi-page-sites/ecommerce-site/index.html',
      expectedPages: 4
    },
    {
      name: 'BeeProduced.com (Real Website)',
      url: 'https://beeproduced.com',
      expectedPages: 8
    }
  ];
  
  let successfulTests = 0;
  const results = [];
  
  for (const site of testSites) {
    console.log(`\n🔍 Testing: ${site.name}`);
    console.log(`URL: ${site.url}`);
    console.log('='.repeat(80));
    
    try {
      const startTime = Date.now();
      
      // Perform multi-page scan
      console.log('🕷️ Starting multi-page scan...');
      const siteReport = await scanner.scanSite(site.url);
      
      const scanDuration = Date.now() - startTime;
      
      // Validate results
      const validation = validateScanResults(siteReport, site);
      
      if (validation.success) {
        console.log('✅ Scan completed successfully!');
        successfulTests++;
      } else {
        console.log('⚠️ Scan completed with issues:');
        validation.issues.forEach(issue => console.log(`   - ${issue}`));
      }
      
      // Generate comprehensive report
      try {
        console.log('📄 Generating comprehensive report...');
        const reportResult = await reportGenerator.generateSiteReport(siteReport, {
          format: 'both',
          includeScreenshots: false,
          includeDetailedViolations: true
        });
        
        console.log(`📁 Reports generated:`);
        if (reportResult.htmlPath) console.log(`   HTML: ${reportResult.htmlPath}`);
        if (reportResult.pdfPath) console.log(`   PDF: ${reportResult.pdfPath}`);
        
      } catch (reportError) {
        console.log(`⚠️ Report generation failed: ${reportError.message}`);
      }
      
      // Store results for summary
      results.push({
        site: site.name,
        url: site.url,
        success: validation.success,
        duration: scanDuration,
        pagesScanned: siteReport.overview?.scannedPages || 0,
        totalViolations: countTotalViolations(siteReport),
        averageScore: calculateAverageScore(siteReport),
        cspStrategies: Object.keys(siteReport.cspAnalysis?.strategyPerformance || {}),
        issues: validation.issues
      });
      
      // Print summary
      console.log('\n📊 Scan Summary:');
      console.log(`   Pages Discovered: ${siteReport.overview?.totalPages || 0}`);
      console.log(`   Pages Scanned: ${siteReport.overview?.scannedPages || 0}`);
      console.log(`   Success Rate: ${siteReport.overview?.successRate || 0}%`);
      console.log(`   Total Violations: ${countTotalViolations(siteReport)}`);
      console.log(`   Average Score: ${calculateAverageScore(siteReport)}`);
      console.log(`   Scan Duration: ${Math.round(scanDuration/1000)}s`);
      console.log(`   CSP Strategies: ${Object.keys(siteReport.cspAnalysis?.strategyPerformance || {}).join(', ')}`);
      
    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);
      console.log(`   Stack: ${error.stack}`);
      
      results.push({
        site: site.name,
        url: site.url,
        success: false,
        error: error.message,
        duration: 0,
        pagesScanned: 0
      });
    }
  }
  
  // Generate final test report
  await generateTestReport(results, successfulTests, testSites.length);
  
  console.log(`\n🎯 Test Summary:`);
  console.log(`   Successful Tests: ${successfulTests}/${testSites.length}`);
  console.log(`   Success Rate: ${Math.round(successfulTests/testSites.length*100)}%`);
  
  if (successfulTests === testSites.length) {
    console.log('🎉 All tests passed! Multi-page scanner is ready for production.');
  } else {
    console.log('⚠️ Some tests failed. Review the issues above.');
  }
  
  return {
    success: successfulTests === testSites.length,
    successfulTests,
    totalTests: testSites.length,
    results
  };
}

/**
 * Validate scan results against expectations
 * @param {Object} siteReport - Site scan report
 * @param {Object} siteConfig - Site configuration
 * @returns {Object} Validation result
 */
function validateScanResults(siteReport, siteConfig) {
  const issues = [];
  
  // Check if scan completed
  if (!siteReport || !siteReport.overview) {
    issues.push('No scan results or overview data');
    return { success: false, issues };
  }
  
  // Check pages scanned
  const pagesScanned = siteReport.overview.scannedPages || 0;
  if (pagesScanned === 0) {
    issues.push('No pages were successfully scanned');
  }
  
  // Check for reasonable page discovery
  const pagesDiscovered = siteReport.overview.totalPages || 0;
  if (pagesDiscovered < 1) {
    issues.push('No pages discovered via navigation');
  }
  
  // Check success rate
  const successRate = siteReport.overview.successRate || 0;
  if (successRate < 50) {
    issues.push(`Low success rate: ${successRate}%`);
  }
  
  // Check for CSP strategy usage
  const cspStrategies = Object.keys(siteReport.cspAnalysis?.strategyPerformance || {});
  if (cspStrategies.length === 0) {
    issues.push('No CSP strategies were used or recorded');
  }
  
  // Check for page results
  const pageResults = siteReport.pageResults || [];
  if (pageResults.length === 0) {
    issues.push('No individual page results available');
  }
  
  // Check for accessibility analysis
  const trends = siteReport.siteWideTrends;
  if (!trends || typeof trends.averageAccessibilityScore === 'undefined') {
    issues.push('Site-wide accessibility trends missing');
  }
  
  return {
    success: issues.length === 0,
    issues
  };
}

/**
 * Count total violations across all pages
 */
function countTotalViolations(siteReport) {
  const pageResults = siteReport.pageResults || [];
  return pageResults.reduce((total, result) => total + (result.violations?.length || 0), 0);
}

/**
 * Calculate average accessibility score
 */
function calculateAverageScore(siteReport) {
  const pageResults = siteReport.pageResults || [];
  if (pageResults.length === 0) return 0;
  
  const total = pageResults.reduce((sum, result) => sum + (result.accessibilityScore || 0), 0);
  return Math.round(total / pageResults.length);
}

/**
 * Generate comprehensive test report
 */
async function generateTestReport(results, successfulTests, totalTests) {
  try {
    const reportPath = path.join(__dirname, 'test-results', 'multi-page-test-report.json');
    await fs.ensureDir(path.dirname(reportPath));
    
    const report = {
      testDate: new Date().toISOString(),
      summary: {
        totalTests,
        successfulTests,
        successRate: Math.round(successfulTests/totalTests*100),
        overallSuccess: successfulTests === totalTests
      },
      results,
      performance: {
        averageScanTime: results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length,
        totalPagesScanned: results.reduce((sum, r) => sum + (r.pagesScanned || 0), 0),
        totalViolationsFound: results.reduce((sum, r) => sum + (r.totalViolations || 0), 0)
      },
      recommendations: generateTestRecommendations(results)
    };
    
    await fs.writeJson(reportPath, report, { spaces: 2 });
    console.log(`\n📋 Test report saved: ${reportPath}`);
    
  } catch (error) {
    console.error('Failed to generate test report:', error.message);
  }
}

/**
 * Generate recommendations based on test results
 */
function generateTestRecommendations(results) {
  const recommendations = [];
  
  const failedTests = results.filter(r => !r.success);
  if (failedTests.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'reliability',
      issue: `${failedTests.length} test(s) failed`,
      suggestion: 'Review error logs and improve error handling'
    });
  }
  
  const avgScanTime = results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length;
  if (avgScanTime > 30000) { // 30 seconds
    recommendations.push({
      priority: 'medium',
      category: 'performance',
      issue: 'Average scan time is high',
      suggestion: 'Consider performance optimizations or parallel scanning'
    });
  }
  
  const lowScoreTests = results.filter(r => r.averageScore && r.averageScore < 70);
  if (lowScoreTests.length > 0) {
    recommendations.push({
      priority: 'info',
      category: 'testing',
      issue: 'Some test sites have low accessibility scores',
      suggestion: 'This is expected for test sites with intentional issues'
    });
  }
  
  return recommendations;
}

// Run tests if called directly
if (require.main === module) {
  testMultiPageScanning()
    .then(result => {
      console.log('\n✅ End-to-end testing completed');
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Testing failed:', error);
      process.exit(1);
    });
}

module.exports = testMultiPageScanning;