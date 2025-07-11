const Phase6AIntegration = require('./src/phase6a-integration');

/**
 * Test runner for Phase 6A scanners
 * Tests all 4 critical missing WCAG 2.1 AA criteria
 */
async function testPhase6AScanners() {
    console.log('🚀 Phase 6A Scanner Test Suite');
    console.log('==============================');
    console.log('Testing Critical Missing WCAG 2.1 AA Criteria:');
    console.log('• 1.4.4 - Text Resize (200% zoom compliance)');
    console.log('• 1.4.11 - Non-text Contrast (UI components)');
    console.log('• 2.5.3 - Label in Name (voice control)');
    console.log('• 4.1.3 - Status Messages (screen reader announcements)');

    const integration = new Phase6AIntegration();

    try {
        // Test 1: Run test suite with provided test HTML files
        console.log('\n📋 Test 1: Testing with Phase 6A Test HTML Files');
        console.log('--------------------------------------------------');
        await integration.runTestSuite();

        // Test 2: Test with a real website (beeproduced.com)
        console.log('\n📋 Test 2: Real Website Analysis - beeproduced.com');
        console.log('----------------------------------------------------');
        const realSiteResults = await integration.runCompleteScan('https://beeproduced.com', {
            generateReport: true,
            timeout: 45000
        });

        console.log('\n📊 Real Website Results Summary:');
        console.log(`   Total Violations: ${realSiteResults.summary.totalViolations}`);
        console.log(`   Critical Issues: ${realSiteResults.summary.criticalViolations}`);
        console.log(`   Scanners Passed: ${realSiteResults.summary.scannersPassed}/${realSiteResults.summary.scannersRun}`);
        console.log(`   WCAG Coverage: ${realSiteResults.summary.wcagCoverage.improvement}`);

        // Display top violations by severity
        const allViolations = [];
        Object.entries(realSiteResults.scanResults).forEach(([scanner, result]) => {
            if (result.violations) {
                result.violations.forEach(violation => {
                    allViolations.push({ ...violation, scanner });
                });
            }
        });

        if (allViolations.length > 0) {
            console.log('\n🚨 Top Issues Found:');
            const topIssues = allViolations
                .sort((a, b) => {
                    const severityOrder = { critical: 0, serious: 1, moderate: 2 };
                    return (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
                })
                .slice(0, 5);

            topIssues.forEach((issue, index) => {
                console.log(`   ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
                console.log(`      Scanner: ${issue.scanner} | Element: ${issue.element}`);
            });
        }

        // Test 3: Individual scanner testing
        console.log('\n📋 Test 3: Individual Scanner Validation');
        console.log('-----------------------------------------');
        
        const testUrl = 'https://example.com';
        console.log(`Testing individual scanners with: ${testUrl}`);

        const scannerResults = {};

        // Test Text Resize Scanner
        try {
            console.log('\n📏 Testing Text Resize Scanner...');
            const textResizeResults = await integration.scanners.textResize.scanTextResize(testUrl, { timeout: 30000 });
            scannerResults.textResize = {
                passed: textResizeResults.passed,
                violations: textResizeResults.violations.length,
                viewports: Object.keys(textResizeResults.viewportResults || {}).length
            };
            console.log(`   Result: ${textResizeResults.passed ? 'PASSED' : 'FAILED'} (${textResizeResults.violations.length} violations)`);
        } catch (error) {
            console.log(`   Error: ${error.message}`);
            scannerResults.textResize = { error: error.message };
        }

        // Test Non-text Contrast Scanner
        try {
            console.log('\n🎨 Testing Non-text Contrast Scanner...');
            const contrastResults = await integration.scanners.nonTextContrast.scanNonTextContrast(testUrl, { timeout: 30000 });
            scannerResults.nonTextContrast = {
                passed: contrastResults.passed,
                violations: contrastResults.violations.length,
                elementsChecked: contrastResults.summary.totalElementsChecked
            };
            console.log(`   Result: ${contrastResults.passed ? 'PASSED' : 'FAILED'} (${contrastResults.violations.length} violations)`);
        } catch (error) {
            console.log(`   Error: ${error.message}`);
            scannerResults.nonTextContrast = { error: error.message };
        }

        // Test Label in Name Scanner
        try {
            console.log('\n🎤 Testing Label in Name Scanner...');
            const labelResults = await integration.scanners.labelInName.scanLabelInName(testUrl, { timeout: 30000 });
            scannerResults.labelInName = {
                passed: labelResults.passed,
                violations: labelResults.violations.length,
                voiceControlFailures: labelResults.summary.voiceControlFailures
            };
            console.log(`   Result: ${labelResults.passed ? 'PASSED' : 'FAILED'} (${labelResults.violations.length} violations)`);
        } catch (error) {
            console.log(`   Error: ${error.message}`);
            scannerResults.labelInName = { error: error.message };
        }

        // Test Status Messages Scanner
        try {
            console.log('\n📢 Testing Status Messages Scanner...');
            const statusResults = await integration.scanners.statusMessages.scanStatusMessages(testUrl, { timeout: 30000 });
            scannerResults.statusMessages = {
                passed: statusResults.passed,
                violations: statusResults.violations.length,
                missingLiveRegions: statusResults.summary.missingLiveRegions
            };
            console.log(`   Result: ${statusResults.passed ? 'PASSED' : 'FAILED'} (${statusResults.violations.length} violations)`);
        } catch (error) {
            console.log(`   Error: ${error.message}`);
            scannerResults.statusMessages = { error: error.message };
        }

        console.log('\n📊 Individual Scanner Summary:');
        Object.entries(scannerResults).forEach(([scanner, result]) => {
            if (result.error) {
                console.log(`   ${scanner}: ❌ ERROR - ${result.error}`);
            } else {
                console.log(`   ${scanner}: ${result.passed ? '✅ PASSED' : '❌ FAILED'} (${result.violations} violations)`);
            }
        });

        console.log('\n✅ Phase 6A Test Suite Completed Successfully!');
        console.log('\n📄 Reports generated in: ./reports/phase6a/');
        console.log('📋 Next steps:');
        console.log('   1. Review generated reports for detailed findings');
        console.log('   2. Perform manual validation as guided in the reports');
        console.log('   3. Address critical violations first');
        console.log('   4. Test with actual assistive technology users');

        return {
            testSuiteResults: 'completed',
            realSiteResults: realSiteResults,
            individualScannerResults: scannerResults,
            totalViolationsFound: allViolations.length,
            reportsGenerated: realSiteResults.reportPaths
        };

    } catch (error) {
        console.error('❌ Phase 6A test suite failed:', error.message);
        console.error(error.stack);
        throw error;
    } finally {
        await integration.closeAllScanners();
    }
}

// Run the test suite if called directly
if (require.main === module) {
    testPhase6AScanners()
        .then(results => {
            console.log('\n🎉 All tests completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test suite failed:', error.message);
            process.exit(1);
        });
}

module.exports = testPhase6AScanners;