const Phase6ComprehensiveIntegration = require('./src/phase6-comprehensive-integration');

/**
 * Test runner for Phase 6 Comprehensive Integration
 * Tests complete WCAG 2.1 AA coverage across all phases (6A-6E)
 * Validates EU Accessibility Act 2025 compliance readiness
 */
async function testPhase6Comprehensive() {
    console.log('🚀 Phase 6 Comprehensive Test Suite');
    console.log('=====================================');
    console.log('Testing Complete WCAG 2.1 AA Coverage:');
    console.log('• Phase 6A: Critical Missing WCAG Criteria');
    console.log('• Phase 6B: Advanced ARIA Complex Widgets');
    console.log('• Phase 6C: Media Accessibility');
    console.log('• Phase 6D: Mobile Specific Accessibility');
    console.log('• Phase 6E: Dynamic Content & SPA');
    console.log('🇪🇺 Target: EU Accessibility Act 2025 Compliance');

    const integration = new Phase6ComprehensiveIntegration();

    try {
        // Test 1: Run comprehensive test suite with all test HTML files
        console.log('\n📋 Test 1: Phase 6 Comprehensive Test Suite');
        console.log('---------------------------------------------');
        const testSuiteResults = await integration.runPhase6TestSuite();

        // Test 2: Full comprehensive scan on a real website
        console.log('\n📋 Test 2: Real Website Comprehensive Analysis');
        console.log('----------------------------------------------');
        const realSiteResults = await integration.runComprehensivePhase6Scan('https://beeproduced.com', {
            generateReport: true,
            timeout: 180000 // 3 minutes
        });

        console.log('\n📊 Comprehensive Results Summary:');
        console.log(`   Total Violations: ${realSiteResults.summary.totalViolations}`);
        console.log(`   Critical Issues: ${realSiteResults.summary.criticalViolations}`);
        console.log(`   Phases Tested: ${realSiteResults.summary.phasesRun}`);
        console.log(`   Phases Passed: ${realSiteResults.summary.phasesPassed}`);
        console.log(`   WCAG Coverage: ${realSiteResults.summary.wcagCoverage.improvement}`);
        console.log(`   EU Compliance: ${realSiteResults.summary.euComplianceReadiness}`);

        // Display phase-by-phase results
        console.log('\n📊 Phase-by-Phase Results:');
        Object.entries(realSiteResults.phaseResults).forEach(([phase, result]) => {
            const status = result.passed ? '✅ PASSED' : `❌ ${result.violations?.length || 0} violations`;
            console.log(`   Phase ${phase}: ${status} - ${realSiteResults.phases[phase].description}`);
        });

        // Display top violations by priority
        const allViolations = [];
        Object.entries(realSiteResults.phaseResults).forEach(([phase, result]) => {
            if (result.violations) {
                result.violations.forEach(violation => {
                    allViolations.push({ ...violation, phase });
                });
            }
        });

        if (allViolations.length > 0) {
            console.log('\n🚨 Top Priority Issues:');
            const topIssues = allViolations
                .sort((a, b) => {
                    const severityOrder = { critical: 0, serious: 1, moderate: 2, low: 3 };
                    return (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
                })
                .slice(0, 8);

            topIssues.forEach((issue, index) => {
                console.log(`   ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
                console.log(`      Phase: ${issue.phase} | Element: ${issue.element}`);
                console.log(`      WCAG: ${issue.wcagCriteria} | Impact: ${issue.impact?.substring(0, 80)}...`);
            });
        }

        // Test 3: Individual phase testing for verification
        console.log('\n📋 Test 3: Individual Phase Verification');
        console.log('----------------------------------------');
        
        const testUrl = 'https://example.com';
        console.log(`Testing individual phases with: ${testUrl}`);

        const phaseResults = {};

        // Test each phase individually for basic functionality
        const phases = [
            { name: '6A', scanner: integration.phase6A, method: 'runCompleteScan' },
            { name: '6B', scanner: integration.phase6B, method: 'scanAdvancedAria' },
            { name: '6C', scanner: integration.phase6C, method: 'scanMediaAccessibility' },
            { name: '6D', scanner: integration.phase6D, method: 'scanMobileAccessibility' },
            { name: '6E', scanner: integration.phase6E, method: 'scanDynamicSpa' }
        ];

        for (const phase of phases) {
            try {
                console.log(`\n${phase.name === '6A' ? '🔥' : phase.name === '6B' ? '🧩' : phase.name === '6C' ? '🎬' : phase.name === '6D' ? '📱' : '⚡'} Testing Phase ${phase.name}...`);
                
                const startTime = Date.now();
                const result = await phase.scanner[phase.method](testUrl, { 
                    timeout: 30000,
                    generateReport: false 
                });
                const duration = Math.round((Date.now() - startTime) / 1000);
                
                phaseResults[phase.name] = {
                    passed: result.passed,
                    violations: result.violations?.length || 0,
                    duration: duration,
                    criteria: result.criteria || []
                };
                
                console.log(`   Result: ${result.passed ? 'PASSED' : 'FAILED'} (${result.violations?.length || 0} violations) - ${duration}s`);
                
            } catch (error) {
                console.log(`   Error: ${error.message}`);
                phaseResults[phase.name] = { error: error.message };
            }
        }

        console.log('\n📊 Individual Phase Summary:');
        Object.entries(phaseResults).forEach(([phase, result]) => {
            if (result.error) {
                console.log(`   Phase ${phase}: ❌ ERROR - ${result.error}`);
            } else {
                console.log(`   Phase ${phase}: ${result.passed ? '✅ PASSED' : '❌ FAILED'} (${result.violations} violations, ${result.duration}s)`);
            }
        });

        // Calculate comprehensive coverage
        const allCriteria = Object.values(phaseResults)
            .filter(result => result.criteria)
            .flatMap(result => result.criteria);
        const uniqueCriteria = [...new Set(allCriteria)];
        
        console.log('\n📈 WCAG Coverage Analysis:');
        console.log(`   Base Coverage: 70% (35/50 criteria)`);
        console.log(`   New Criteria: ${uniqueCriteria.length} additional criteria`);
        console.log(`   Total Coverage: ${Math.min(70 + (uniqueCriteria.length * 2), 100)}% estimated`);
        console.log(`   Unique Criteria Tested: ${uniqueCriteria.join(', ')}`);

        console.log('\n✅ Phase 6 Comprehensive Test Suite Completed!');
        console.log('\n📄 Reports generated in: ./reports/phase6-comprehensive/');
        console.log('🇪🇺 EU Accessibility Act 2025 Assessment Complete');
        console.log('\n📋 Next steps:');
        console.log('   1. Review comprehensive report for detailed findings');
        console.log('   2. Implement systematic Phase 6 improvements (6A → 6D → 6B → 6E → 6C)');
        console.log('   3. Perform manual validation with assistive technology');
        console.log('   4. Test with real users and mobile devices');
        console.log('   5. Create accessibility conformance statement for EU compliance');

        return {
            testSuiteResults: testSuiteResults,
            realSiteResults: realSiteResults,
            individualPhaseResults: phaseResults,
            totalViolationsFound: allViolations.length,
            wcagCoverageImprovement: realSiteResults.summary.wcagCoverage.improvement,
            euComplianceStatus: realSiteResults.summary.euComplianceReadiness,
            reportsGenerated: realSiteResults.reportPaths
        };

    } catch (error) {
        console.error('❌ Phase 6 comprehensive test suite failed:', error.message);
        console.error(error.stack);
        throw error;
    } finally {
        await integration.closeAllScanners();
    }
}

// Run the test suite if called directly
if (require.main === module) {
    testPhase6Comprehensive()
        .then(results => {
            console.log('\n🎉 All Phase 6 tests completed successfully!');
            console.log(`\n📊 Final Summary:`);
            console.log(`   • WCAG Coverage: ${results.wcagCoverageImprovement}`);
            console.log(`   • EU Compliance: ${results.euComplianceStatus}`);
            console.log(`   • Total Issues: ${results.totalViolationsFound}`);
            console.log(`   • Test Files: ${results.testSuiteResults.length} validated`);
            console.log(`   • Reports: ${Object.keys(results.reportsGenerated).length} generated`);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test suite failed:', error.message);
            process.exit(1);
        });
}

module.exports = testPhase6Comprehensive;