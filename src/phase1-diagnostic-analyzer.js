/**
 * Phase 1: Diagnostic & Baseline Analysis
 * Comprehensive baseline testing and accuracy measurement system
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

// Import all existing scanners
const colorContrastScanner = require('./color-contrast-scanner');
const useOfColorScanner = require('./use-of-color-scanner');
const imagesOfTextScanner = require('./images-of-text-scanner');
const screenReaderScanner = require('./screen-reader-scanner');
const enhancedScanner = require('./enhanced-scanner');

class DiagnosticAnalyzer {
    constructor() {
        this.browser = null;
        this.testSites = [
            {
                name: 'good-accessibility',
                url: 'file://' + path.resolve(__dirname, '../test-sites/good-accessibility.html'),
                expectation: 'high_accessibility',
                expectedViolations: 0,
                maxExpectedViolations: 2
            },
            {
                name: 'bad-color-contrast',
                url: 'file://' + path.resolve(__dirname, '../test-sites/bad-color-contrast.html'),
                expectation: 'contrast_violations',
                expectedViolations: 3,
                minExpectedViolations: 2
            },
            {
                name: 'bad-use-of-color',
                url: 'file://' + path.resolve(__dirname, '../test-sites/bad-use-of-color.html'),
                expectation: 'color_dependency_violations',
                expectedViolations: 2,
                minExpectedViolations: 1
            },
            {
                name: 'bad-images-of-text',
                url: 'file://' + path.resolve(__dirname, '../test-sites/bad-images-of-text.html'),
                expectation: 'text_in_images_violations',
                expectedViolations: 2,
                minExpectedViolations: 1
            }
        ];
        
        this.realWorldSites = [
            {
                name: 'webaim',
                url: 'https://webaim.org/',
                expectation: 'high_accessibility',
                timeout: 30000
            },
            {
                name: 'w3c',
                url: 'https://www.w3.org/',
                expectation: 'high_accessibility',
                timeout: 30000
            },
            {
                name: 'deque-university',
                url: 'https://dequeuniversity.com/',
                expectation: 'medium_accessibility',
                timeout: 30000
            }
        ];
        
        this.scanners = {
            'color-contrast': {
                scanner: colorContrastScanner,
                method: 'scanColorContrast',
                expectedCriteria: ['1.4.3', '1.4.6']
            },
            'use-of-color': {
                scanner: useOfColorScanner,
                method: 'scanUseOfColor',
                expectedCriteria: ['1.4.1']
            },
            'images-of-text': {
                scanner: imagesOfTextScanner,
                method: 'scanImagesOfText',
                expectedCriteria: ['1.4.5', '1.4.9']
            },
            'screen-reader': {
                scanner: screenReaderScanner,
                method: 'scanScreenReader',
                expectedCriteria: ['1.1.1', '1.3.1', '2.4.1', '2.4.6']
            },
            'enhanced': {
                scanner: enhancedScanner,
                method: 'scanWebsite',
                expectedCriteria: 'comprehensive'
            }
        };
        
        this.results = {
            baseline: {},
            accuracy: {},
            performance: {},
            consistency: {},
            falsePositives: {}
        };
    }

    async initialize() {
        console.log('🔍 Phase 1: Initializing Diagnostic Analysis...');
        this.browser = await puppeteer.launch({
            headless: false,
            devtools: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('✅ Browser initialized');
    }

    async runDiagnosticAnalysis() {
        try {
            await this.initialize();
            
            console.log('\n📊 Running comprehensive diagnostic analysis...');
            
            // Step 1: Baseline Testing
            await this.runBaselineTesting();
            
            // Step 2: Accuracy Assessment
            await this.runAccuracyAssessment();
            
            // Step 3: Performance Baseline
            await this.runPerformanceBaseline();
            
            // Step 4: Consistency Testing
            await this.runConsistencyTesting();
            
            // Step 5: False Positive Analysis
            await this.runFalsePositiveAnalysis();
            
            // Step 6: Generate Comprehensive Report
            await this.generateDiagnosticReport();
            
            console.log('\n✅ Phase 1 Diagnostic Analysis Complete!');
            
        } catch (error) {
            console.error('❌ Phase 1 Analysis Failed:', error);
            throw error;
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }

    async runBaselineTesting() {
        console.log('\n🎯 Step 1: Baseline Testing');
        
        for (const site of this.testSites) {
            console.log(`\n  Testing: ${site.name}`);
            
            for (const [scannerName, scannerConfig] of Object.entries(this.scanners)) {
                try {
                    const startTime = performance.now();
                    
                    let result;
                    if (scannerName === 'enhanced') {
                        result = await scannerConfig.scanner.scanWebsite(site.url, {
                            includeScreenshots: true,
                            timeout: 30000
                        });
                    } else {
                        const page = await this.browser.newPage();
                        await page.goto(site.url, { waitUntil: 'networkidle0', timeout: 30000 });
                        result = await scannerConfig.scanner[scannerConfig.method](page);
                        await page.close();
                    }
                    
                    const endTime = performance.now();
                    const scanTime = endTime - startTime;
                    
                    if (!this.results.baseline[site.name]) {
                        this.results.baseline[site.name] = {};
                    }
                    
                    this.results.baseline[site.name][scannerName] = {
                        result,
                        scanTime,
                        violationCount: result.violations ? result.violations.length : 0,
                        timestamp: new Date().toISOString()
                    };
                    
                    console.log(`    ✓ ${scannerName}: ${result.violations?.length || 0} violations (${Math.round(scanTime)}ms)`);
                    
                } catch (error) {
                    console.error(`    ❌ ${scannerName} failed:`, error.message);
                    if (!this.results.baseline[site.name]) {
                        this.results.baseline[site.name] = {};
                    }
                    this.results.baseline[site.name][scannerName] = {
                        error: error.message,
                        timestamp: new Date().toISOString()
                    };
                }
            }
        }
    }

    async runAccuracyAssessment() {
        console.log('\n🎯 Step 2: Accuracy Assessment');
        
        for (const site of this.testSites) {
            console.log(`\n  Assessing accuracy for: ${site.name}`);
            
            const siteResults = this.results.baseline[site.name];
            if (!siteResults) continue;
            
            for (const [scannerName, scannerResult] of Object.entries(siteResults)) {
                if (scannerResult.error) continue;
                
                const violationCount = scannerResult.violationCount;
                let accuracy = 'unknown';
                let accuracyScore = 0;
                
                // Calculate accuracy based on expectations
                if (site.expectation === 'high_accessibility') {
                    // Good sites should have few violations
                    if (violationCount <= site.maxExpectedViolations) {
                        accuracy = 'correct';
                        accuracyScore = 1.0;
                    } else {
                        accuracy = 'false_positive';
                        accuracyScore = Math.max(0, 1 - (violationCount - site.maxExpectedViolations) / 10);
                    }
                } else {
                    // Bad sites should have violations
                    if (violationCount >= site.minExpectedViolations) {
                        accuracy = 'correct';
                        accuracyScore = Math.min(1.0, violationCount / site.expectedViolations);
                    } else {
                        accuracy = 'false_negative';
                        accuracyScore = violationCount / site.expectedViolations;
                    }
                }
                
                if (!this.results.accuracy[scannerName]) {
                    this.results.accuracy[scannerName] = [];
                }
                
                this.results.accuracy[scannerName].push({
                    site: site.name,
                    violationCount,
                    accuracy,
                    accuracyScore,
                    expected: site.expectedViolations,
                    expectation: site.expectation
                });
                
                console.log(`    ${scannerName}: ${accuracy} (score: ${accuracyScore.toFixed(2)})`);
            }
        }
    }

    async runPerformanceBaseline() {
        console.log('\n🎯 Step 3: Performance Baseline');
        
        const performanceTests = [
            { name: 'small-page', url: this.testSites[0].url },
            { name: 'complex-page', url: this.testSites[1].url }
        ];
        
        for (const test of performanceTests) {
            console.log(`\n  Performance testing: ${test.name}`);
            
            for (const [scannerName, scannerConfig] of Object.entries(this.scanners)) {
                if (scannerName === 'enhanced') continue; // Skip enhanced for performance baseline
                
                const times = [];
                const memoryUsages = [];
                
                // Run 5 times for average
                for (let i = 0; i < 5; i++) {
                    try {
                        const initialMemory = process.memoryUsage();
                        const startTime = performance.now();
                        
                        const page = await this.browser.newPage();
                        await page.goto(test.url, { waitUntil: 'networkidle0', timeout: 30000 });
                        await scannerConfig.scanner[scannerConfig.method](page);
                        await page.close();
                        
                        const endTime = performance.now();
                        const finalMemory = process.memoryUsage();
                        
                        times.push(endTime - startTime);
                        memoryUsages.push(finalMemory.heapUsed - initialMemory.heapUsed);
                        
                    } catch (error) {
                        console.error(`    ❌ Performance test ${i + 1} failed for ${scannerName}`);
                    }
                }
                
                if (times.length > 0) {
                    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
                    const avgMemory = memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
                    
                    if (!this.results.performance[scannerName]) {
                        this.results.performance[scannerName] = {};
                    }
                    
                    this.results.performance[scannerName][test.name] = {
                        averageTime: avgTime,
                        averageMemory: avgMemory,
                        samples: times.length,
                        rawTimes: times
                    };
                    
                    console.log(`    ${scannerName}: ${Math.round(avgTime)}ms avg (${times.length} samples)`);
                }
            }
        }
    }

    async runConsistencyTesting() {
        console.log('\n🎯 Step 4: Consistency Testing');
        
        // Test same site multiple times to check for consistency
        const consistencyTestSite = this.testSites[0]; // Use good accessibility site
        console.log(`\n  Testing consistency with: ${consistencyTestSite.name}`);
        
        for (const [scannerName, scannerConfig] of Object.entries(this.scanners)) {
            if (scannerName === 'enhanced') continue; // Skip enhanced for consistency
            
            const results = [];
            
            // Run same scan 10 times
            for (let i = 0; i < 10; i++) {
                try {
                    const page = await this.browser.newPage();
                    await page.goto(consistencyTestSite.url, { waitUntil: 'networkidle0', timeout: 30000 });
                    const result = await scannerConfig.scanner[scannerConfig.method](page);
                    await page.close();
                    
                    results.push({
                        run: i + 1,
                        violationCount: result.violations ? result.violations.length : 0,
                        violations: result.violations || []
                    });
                    
                } catch (error) {
                    console.error(`    ❌ Consistency test ${i + 1} failed for ${scannerName}`);
                }
            }
            
            if (results.length > 0) {
                // Calculate consistency metrics
                const violationCounts = results.map(r => r.violationCount);
                const uniqueCounts = [...new Set(violationCounts)];
                const consistencyRate = 1 - (uniqueCounts.length - 1) / violationCounts.length;
                
                const avgViolations = violationCounts.reduce((a, b) => a + b, 0) / violationCounts.length;
                const stdDev = Math.sqrt(
                    violationCounts.reduce((sum, count) => sum + Math.pow(count - avgViolations, 2), 0) / violationCounts.length
                );
                
                this.results.consistency[scannerName] = {
                    runs: results.length,
                    violationCounts,
                    uniqueCounts: uniqueCounts.length,
                    consistencyRate,
                    averageViolations: avgViolations,
                    standardDeviation: stdDev,
                    results
                };
                
                console.log(`    ${scannerName}: ${(consistencyRate * 100).toFixed(1)}% consistent (${uniqueCounts.length} unique results)`);
            }
        }
    }

    async runFalsePositiveAnalysis() {
        console.log('\n🎯 Step 5: False Positive Analysis');
        
        // Test known good accessibility sites
        for (const site of this.realWorldSites.slice(0, 2)) { // Test first 2 real-world sites
            if (site.expectation === 'high_accessibility') {
                console.log(`\n  Analyzing false positives for: ${site.name}`);
                
                for (const [scannerName, scannerConfig] of Object.entries(this.scanners)) {
                    if (scannerName === 'enhanced') continue;
                    
                    try {
                        const page = await this.browser.newPage();
                        await page.goto(site.url, { 
                            waitUntil: 'networkidle0', 
                            timeout: site.timeout || 30000 
                        });
                        
                        const result = await scannerConfig.scanner[scannerConfig.method](page);
                        await page.close();
                        
                        const violationCount = result.violations ? result.violations.length : 0;
                        
                        // For high accessibility sites, any violations are potential false positives
                        const falsePositiveRate = violationCount > 5 ? 'high' : 
                                                violationCount > 2 ? 'medium' : 'low';
                        
                        if (!this.results.falsePositives[scannerName]) {
                            this.results.falsePositives[scannerName] = [];
                        }
                        
                        this.results.falsePositives[scannerName].push({
                            site: site.name,
                            violationCount,
                            falsePositiveRate,
                            violations: result.violations || []
                        });
                        
                        console.log(`    ${scannerName}: ${violationCount} violations (${falsePositiveRate} false positive rate)`);
                        
                    } catch (error) {
                        console.error(`    ❌ False positive analysis failed for ${scannerName} on ${site.name}:`, error.message);
                    }
                }
            }
        }
    }

    async generateDiagnosticReport() {
        console.log('\n📋 Step 6: Generating Diagnostic Report');
        
        // Calculate overall metrics
        const overallMetrics = this.calculateOverallMetrics();
        
        const report = {
            metadata: {
                phase: '1 - Diagnostic & Baseline Analysis',
                timestamp: new Date().toISOString(),
                testSitesCount: this.testSites.length,
                scannersCount: Object.keys(this.scanners).length,
                realWorldSitesCount: this.realWorldSites.length
            },
            
            executiveSummary: {
                overallAccuracy: overallMetrics.overallAccuracy,
                consistencyIssues: overallMetrics.consistencyIssues,
                performanceIssues: overallMetrics.performanceIssues,
                falsePositiveIssues: overallMetrics.falsePositiveIssues,
                criticalFindings: overallMetrics.criticalFindings
            },
            
            detailedResults: {
                baseline: this.results.baseline,
                accuracy: this.results.accuracy,
                performance: this.results.performance,
                consistency: this.results.consistency,
                falsePositives: this.results.falsePositives
            },
            
            recommendations: this.generateRecommendations(overallMetrics)
        };
        
        // Save detailed report
        const reportPath = path.join(__dirname, '../reports/phase1-diagnostic-report.json');
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        
        // Generate HTML summary
        const htmlReport = this.generateHTMLReport(report);
        const htmlPath = path.join(__dirname, '../reports/phase1-diagnostic-report.html');
        await fs.writeFile(htmlPath, htmlReport);
        
        console.log(`✅ Detailed report saved: ${reportPath}`);
        console.log(`✅ HTML summary saved: ${htmlPath}`);
        
        // Print executive summary
        console.log('\n📊 Executive Summary:');
        console.log(`   Overall Accuracy: ${(overallMetrics.overallAccuracy * 100).toFixed(1)}%`);
        console.log(`   Consistency Issues: ${overallMetrics.consistencyIssues.length}`);
        console.log(`   Performance Issues: ${overallMetrics.performanceIssues.length}`);
        console.log(`   False Positive Issues: ${overallMetrics.falsePositiveIssues.length}`);
        console.log(`   Critical Findings: ${overallMetrics.criticalFindings.length}`);
        
        return report;
    }

    calculateOverallMetrics() {
        const metrics = {
            overallAccuracy: 0,
            consistencyIssues: [],
            performanceIssues: [],
            falsePositiveIssues: [],
            criticalFindings: []
        };
        
        // Calculate overall accuracy
        let totalAccuracyScore = 0;
        let totalTests = 0;
        
        for (const [scannerName, tests] of Object.entries(this.results.accuracy)) {
            for (const test of tests) {
                totalAccuracyScore += test.accuracyScore;
                totalTests++;
            }
        }
        
        metrics.overallAccuracy = totalTests > 0 ? totalAccuracyScore / totalTests : 0;
        
        // Identify consistency issues
        for (const [scannerName, consistency] of Object.entries(this.results.consistency)) {
            if (consistency.consistencyRate < 0.8) {
                metrics.consistencyIssues.push({
                    scanner: scannerName,
                    consistencyRate: consistency.consistencyRate,
                    issue: 'Low consistency rate'
                });
            }
            
            if (consistency.standardDeviation > 2) {
                metrics.consistencyIssues.push({
                    scanner: scannerName,
                    standardDeviation: consistency.standardDeviation,
                    issue: 'High variance in results'
                });
            }
        }
        
        // Identify performance issues
        for (const [scannerName, performance] of Object.entries(this.results.performance)) {
            for (const [testName, perf] of Object.entries(performance)) {
                if (perf.averageTime > 10000) { // > 10 seconds
                    metrics.performanceIssues.push({
                        scanner: scannerName,
                        test: testName,
                        averageTime: perf.averageTime,
                        issue: 'Slow scan time'
                    });
                }
            }
        }
        
        // Identify false positive issues
        for (const [scannerName, falsePositives] of Object.entries(this.results.falsePositives)) {
            for (const fp of falsePositives) {
                if (fp.falsePositiveRate === 'high' || fp.violationCount > 10) {
                    metrics.falsePositiveIssues.push({
                        scanner: scannerName,
                        site: fp.site,
                        violationCount: fp.violationCount,
                        issue: 'High false positive rate'
                    });
                }
            }
        }
        
        // Critical findings
        if (metrics.overallAccuracy < 0.7) {
            metrics.criticalFindings.push('Overall accuracy below 70% - urgent quality fixes needed');
        }
        
        if (metrics.consistencyIssues.length > 3) {
            metrics.criticalFindings.push('Multiple scanners show consistency issues');
        }
        
        if (metrics.falsePositiveIssues.length > 2) {
            metrics.criticalFindings.push('High false positive rates detected');
        }
        
        return metrics;
    }

    generateRecommendations(metrics) {
        const recommendations = [];
        
        if (metrics.overallAccuracy < 0.8) {
            recommendations.push({
                priority: 'critical',
                category: 'accuracy',
                issue: 'Low overall accuracy',
                recommendation: 'Implement Phase 2 quality fixes immediately, focusing on contrast detection and element filtering'
            });
        }
        
        if (metrics.consistencyIssues.length > 0) {
            recommendations.push({
                priority: 'high',
                category: 'consistency',
                issue: 'Scanner inconsistency',
                recommendation: 'Review scanner algorithms for deterministic behavior and add proper error handling'
            });
        }
        
        if (metrics.performanceIssues.length > 0) {
            recommendations.push({
                priority: 'medium',
                category: 'performance',
                issue: 'Slow scan times',
                recommendation: 'Optimize slow scanners and implement parallel processing where possible'
            });
        }
        
        if (metrics.falsePositiveIssues.length > 0) {
            recommendations.push({
                priority: 'high',
                category: 'false_positives',
                issue: 'High false positive rates',
                recommendation: 'Implement intelligent element filtering and improve detection algorithms'
            });
        }
        
        return recommendations;
    }

    generateHTMLReport(report) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Phase 1: Diagnostic & Baseline Analysis Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .summary { background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .critical { background: #ffe6e6; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .section { margin-bottom: 30px; }
        .metric { display: inline-block; margin: 10px; padding: 15px; background: #f9f9f9; border-radius: 5px; }
        .scanner-result { margin: 10px 0; padding: 10px; background: #fafafa; border-left: 4px solid #ddd; }
        .good { border-left-color: #4CAF50; }
        .warning { border-left-color: #ff9800; }
        .error { border-left-color: #f44336; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Phase 1: Diagnostic & Baseline Analysis</h1>
        <p><strong>Generated:</strong> ${report.metadata.timestamp}</p>
        <p><strong>Test Sites:</strong> ${report.metadata.testSitesCount} | <strong>Scanners:</strong> ${report.metadata.scannersCount}</p>
    </div>

    <div class="summary">
        <h2>📊 Executive Summary</h2>
        <div class="metric">
            <strong>Overall Accuracy:</strong><br>
            ${(report.executiveSummary.overallAccuracy * 100).toFixed(1)}%
        </div>
        <div class="metric">
            <strong>Consistency Issues:</strong><br>
            ${report.executiveSummary.consistencyIssues.length}
        </div>
        <div class="metric">
            <strong>Performance Issues:</strong><br>
            ${report.executiveSummary.performanceIssues.length}
        </div>
        <div class="metric">
            <strong>False Positive Issues:</strong><br>
            ${report.executiveSummary.falsePositiveIssues.length}
        </div>
    </div>

    ${report.executiveSummary.criticalFindings.length > 0 ? `
    <div class="critical">
        <h2>🚨 Critical Findings</h2>
        <ul>
            ${report.executiveSummary.criticalFindings.map(finding => `<li>${finding}</li>`).join('')}
        </ul>
    </div>
    ` : ''}

    <div class="section">
        <h2>🎯 Accuracy Analysis</h2>
        ${Object.entries(report.detailedResults.accuracy).map(([scanner, tests]) => {
            const avgAccuracy = tests.reduce((sum, test) => sum + test.accuracyScore, 0) / tests.length;
            const cssClass = avgAccuracy > 0.8 ? 'good' : avgAccuracy > 0.6 ? 'warning' : 'error';
            return `
            <div class="scanner-result ${cssClass}">
                <h3>${scanner}</h3>
                <p><strong>Average Accuracy:</strong> ${(avgAccuracy * 100).toFixed(1)}%</p>
                <p><strong>Tests:</strong> ${tests.length}</p>
                <details>
                    <summary>View detailed results</summary>
                    <table>
                        <tr><th>Site</th><th>Violations</th><th>Expected</th><th>Accuracy</th><th>Score</th></tr>
                        ${tests.map(test => `
                        <tr>
                            <td>${test.site}</td>
                            <td>${test.violationCount}</td>
                            <td>${test.expected}</td>
                            <td>${test.accuracy}</td>
                            <td>${(test.accuracyScore * 100).toFixed(1)}%</td>
                        </tr>
                        `).join('')}
                    </table>
                </details>
            </div>
            `;
        }).join('')}
    </div>

    <div class="section">
        <h2>⚡ Performance Analysis</h2>
        ${Object.entries(report.detailedResults.performance).map(([scanner, perf]) => {
            return `
            <div class="scanner-result">
                <h3>${scanner}</h3>
                ${Object.entries(perf).map(([test, data]) => `
                <p><strong>${test}:</strong> ${Math.round(data.averageTime)}ms average (${data.samples} samples)</p>
                `).join('')}
            </div>
            `;
        }).join('')}
    </div>

    <div class="section">
        <h2>🔄 Consistency Analysis</h2>
        ${Object.entries(report.detailedResults.consistency).map(([scanner, consistency]) => {
            const cssClass = consistency.consistencyRate > 0.9 ? 'good' : consistency.consistencyRate > 0.7 ? 'warning' : 'error';
            return `
            <div class="scanner-result ${cssClass}">
                <h3>${scanner}</h3>
                <p><strong>Consistency Rate:</strong> ${(consistency.consistencyRate * 100).toFixed(1)}%</p>
                <p><strong>Unique Results:</strong> ${consistency.uniqueCounts} out of ${consistency.runs} runs</p>
                <p><strong>Standard Deviation:</strong> ${consistency.standardDeviation.toFixed(2)}</p>
            </div>
            `;
        }).join('')}
    </div>

    <div class="section">
        <h2>📋 Recommendations</h2>
        ${report.recommendations.map(rec => {
            const cssClass = rec.priority === 'critical' ? 'error' : rec.priority === 'high' ? 'warning' : 'good';
            return `
            <div class="scanner-result ${cssClass}">
                <h3>${rec.category.toUpperCase()} - ${rec.priority.toUpperCase()}</h3>
                <p><strong>Issue:</strong> ${rec.issue}</p>
                <p><strong>Recommendation:</strong> ${rec.recommendation}</p>
            </div>
            `;
        }).join('')}
    </div>
</body>
</html>
        `;
    }
}

// CLI interface
if (require.main === module) {
    const analyzer = new DiagnosticAnalyzer();
    analyzer.runDiagnosticAnalysis()
        .then((report) => {
            console.log('\n🎉 Phase 1 Diagnostic Analysis completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Phase 1 Analysis failed:', error);
            process.exit(1);
        });
}

module.exports = DiagnosticAnalyzer;