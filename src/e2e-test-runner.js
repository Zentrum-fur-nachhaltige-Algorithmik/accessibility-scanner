const EndToEndTester = require('./end-to-end-tester');
const fs = require('fs-extra');
const path = require('path');

class E2ETestRunner {
    constructor(options = {}) {
        this.options = {
            outputDir: './test-results',
            batchSize: 5,
            parallel: false,
            verbose: true,
            ...options
        };
        
        this.tester = new EndToEndTester({
            screenshotPath: path.join(this.options.outputDir, 'screenshots'),
            reportsPath: path.join(this.options.outputDir, 'reports'),
            failedTestsPath: path.join(this.options.outputDir, 'failed-tests')
        });
        
        this.results = [];
        this.summary = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: 0
        };
    }

    async runTestSuite(testConfig) {
        console.log('🚀 Starting End-to-End Test Suite...\n');
        
        await this.tester.initialize();
        await fs.ensureDir(this.options.outputDir);
        
        const startTime = Date.now();
        
        try {
            if (Array.isArray(testConfig.websites)) {
                await this.runWebsiteTests(testConfig.websites, testConfig.criteria);
            }
            
            if (testConfig.customTests) {
                await this.runCustomTests(testConfig.customTests);
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            await this.generateFinalReport(duration);
            await this.generateFailureIsolationReport();
            
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            throw error;
        } finally {
            await this.tester.cleanup();
        }
        
        return this.summary;
    }

    async runWebsiteTests(websites, globalCriteria = {}) {
        console.log(`📊 Testing ${websites.length} websites...\n`);
        
        for (let i = 0; i < websites.length; i++) {
            const website = websites[i];
            const url = typeof website === 'string' ? website : website.url;
            const criteria = typeof website === 'object' ? { ...globalCriteria, ...website.criteria } : globalCriteria;
            
            console.log(`🔍 Testing (${i + 1}/${websites.length}): ${url}`);
            
            try {
                const result = await this.tester.runEndToEndTest(url, criteria);
                
                this.results.push({
                    url: url,
                    ...result,
                    testIndex: i + 1
                });
                
                this.summary.total++;
                if (result.success) {
                    this.summary.passed++;
                    console.log(`✅ PASSED: ${url}`);
                } else {
                    this.summary.failed++;
                    console.log(`❌ FAILED: ${url}`);
                    if (this.options.verbose) {
                        this.logFailureDetails(result.validation);
                    }
                }
                
            } catch (error) {
                this.summary.total++;
                this.summary.errors++;
                console.log(`💥 ERROR: ${url} - ${error.message}`);
                
                this.results.push({
                    url: url,
                    success: false,
                    error: error.message,
                    testIndex: i + 1
                });
            }
            
            console.log(''); // Empty line for readability
        }
    }

    async runCustomTests(customTests) {
        console.log(`🧪 Running ${customTests.length} custom tests...\n`);
        
        for (const customTest of customTests) {
            try {
                const result = await customTest.execute(this.tester);
                
                this.results.push({
                    testName: customTest.name,
                    ...result,
                    isCustomTest: true
                });
                
                this.summary.total++;
                if (result.success) {
                    this.summary.passed++;
                    console.log(`✅ PASSED: ${customTest.name}`);
                } else {
                    this.summary.failed++;
                    console.log(`❌ FAILED: ${customTest.name}`);
                }
                
            } catch (error) {
                this.summary.total++;
                this.summary.errors++;
                console.log(`💥 ERROR: ${customTest.name} - ${error.message}`);
            }
        }
    }

    logFailureDetails(validation) {
        if (validation.issues && validation.issues.length > 0) {
            console.log('   Issues found:');
            validation.issues.forEach(issue => {
                console.log(`   - ${issue.type}: ${issue.message || issue.element || issue.count || 'Check details'}`);
            });
        }
    }

    async generateFinalReport(duration) {
        const report = {
            summary: this.summary,
            duration: {
                milliseconds: duration,
                seconds: Math.round(duration / 1000),
                formatted: this.formatDuration(duration)
            },
            timestamp: new Date().toISOString(),
            results: this.results,
            failedTestsSummary: await this.tester.getFailedTestsSummary()
        };
        
        const reportPath = path.join(this.options.outputDir, 'final-report.json');
        await fs.writeJSON(reportPath, report, { spaces: 2 });
        
        const htmlReportPath = path.join(this.options.outputDir, 'final-report.html');
        await this.generateHTMLReport(report, htmlReportPath);
        
        console.log('📋 Final Test Results:');
        console.log(`   Total Tests: ${this.summary.total}`);
        console.log(`   ✅ Passed: ${this.summary.passed}`);
        console.log(`   ❌ Failed: ${this.summary.failed}`);
        console.log(`   💥 Errors: ${this.summary.errors}`);
        console.log(`   ⏱️  Duration: ${report.duration.formatted}\n`);
        console.log(`📄 Reports saved to: ${this.options.outputDir}`);
        console.log(`📊 HTML Report: ${htmlReportPath}`);
        
        return report;
    }

    async generateFailureIsolationReport() {
        const failedSummary = await this.tester.getFailedTestsSummary();
        
        if (failedSummary.totalFailed > 0) {
            console.log('\n🔍 Failed Test Isolation Summary:');
            console.log(`   Total Failed Tests: ${failedSummary.totalFailed}`);
            console.log('   Failure Types:');
            
            Object.entries(failedSummary.failureTypes).forEach(([type, count]) => {
                console.log(`   - ${type}: ${count}`);
            });
            
            const isolationReport = {
                summary: failedSummary,
                isolatedTestsPath: this.tester.options.failedTestsPath,
                instructions: {
                    'viewing_details': 'Each failed test has been isolated in its own directory with screenshots and detailed failure reports',
                    'debugging': 'Use the failure-report.json in each directory to understand what went wrong',
                    'retesting': 'You can re-run specific failed tests by targeting their URLs with custom criteria'
                }
            };
            
            const isolationReportPath = path.join(this.options.outputDir, 'failed-tests-summary.json');
            await fs.writeJSON(isolationReportPath, isolationReport, { spaces: 2 });
            
            console.log(`📁 Failed tests isolated in: ${this.tester.options.failedTestsPath}`);
            console.log(`📋 Isolation report: ${isolationReportPath}`);
        } else {
            console.log('\n🎉 No failed tests to isolate!');
        }
    }

    async generateHTMLReport(report, outputPath) {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>End-to-End Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .summary-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .summary-card.passed { border-left: 4px solid #28a745; }
        .summary-card.failed { border-left: 4px solid #dc3545; }
        .summary-card.errors { border-left: 4px solid #ffc107; }
        .summary-card h3 { margin: 0; font-size: 24px; }
        .summary-card p { margin: 5px 0 0 0; color: #666; }
        .test-results { margin-top: 30px; }
        .test-item { background: white; border: 1px solid #dee2e6; border-radius: 8px; margin-bottom: 15px; padding: 20px; }
        .test-item.passed { border-left: 4px solid #28a745; }
        .test-item.failed { border-left: 4px solid #dc3545; }
        .test-header { display: flex; justify-content: between; align-items: center; margin-bottom: 10px; }
        .test-url { font-weight: bold; color: #007bff; }
        .test-status { padding: 4px 8px; border-radius: 4px; color: white; font-size: 12px; }
        .test-status.passed { background: #28a745; }
        .test-status.failed { background: #dc3545; }
        .test-details { margin-top: 15px; }
        .issues-list { margin-top: 10px; }
        .issue { background: #fff3cd; border: 1px solid #ffeaa7; padding: 8px; margin: 5px 0; border-radius: 4px; }
        .screenshots { margin-top: 15px; }
        .screenshot { display: inline-block; margin: 5px; text-align: center; }
        .screenshot img { max-width: 150px; border: 1px solid #ddd; border-radius: 4px; }
        .failure-summary { background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 8px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 End-to-End Test Report</h1>
            <p>Generated on ${new Date(report.timestamp).toLocaleString()}</p>
            <p>Duration: ${report.duration.formatted}</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>${report.summary.total}</h3>
                <p>Total Tests</p>
            </div>
            <div class="summary-card passed">
                <h3>${report.summary.passed}</h3>
                <p>Passed</p>
            </div>
            <div class="summary-card failed">
                <h3>${report.summary.failed}</h3>
                <p>Failed</p>
            </div>
            <div class="summary-card errors">
                <h3>${report.summary.errors}</h3>
                <p>Errors</p>
            </div>
        </div>
        
        <div class="test-results">
            <h2>📊 Test Results</h2>
            ${report.results.map(result => `
                <div class="test-item ${result.success ? 'passed' : 'failed'}">
                    <div class="test-header">
                        <span class="test-url">${result.url || result.testName}</span>
                        <span class="test-status ${result.success ? 'passed' : 'failed'}">${result.success ? 'PASSED' : 'FAILED'}</span>
                    </div>
                    
                    ${result.validation && result.validation.issues ? `
                        <div class="issues-list">
                            <strong>Issues:</strong>
                            ${result.validation.issues.map(issue => `
                                <div class="issue">
                                    <strong>${issue.type}:</strong> ${issue.message || issue.element || issue.count || 'Check details'}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    ${result.error ? `<div class="issue"><strong>Error:</strong> ${result.error}</div>` : ''}
                    
                    ${result.report && result.report.accessibility ? `
                        <div class="test-details">
                            <strong>Accessibility Summary:</strong>
                            Violations: ${result.report.accessibility.summary.violations}, 
                            Passes: ${result.report.accessibility.summary.passes}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
        
        ${report.failedTestsSummary.totalFailed > 0 ? `
            <div class="failure-summary">
                <h3>🔍 Failed Tests Isolation</h3>
                <p><strong>Total Failed:</strong> ${report.failedTestsSummary.totalFailed}</p>
                <p><strong>Failure Types:</strong></p>
                <ul>
                    ${Object.entries(report.failedTestsSummary.failureTypes).map(([type, count]) => 
                        `<li>${type}: ${count}</li>`
                    ).join('')}
                </ul>
                <p>Each failed test has been isolated with detailed reports and screenshots for debugging.</p>
            </div>
        ` : '<div class="failure-summary"><h3>🎉 All Tests Passed!</h3></div>'}
    </div>
</body>
</html>`;
        
        await fs.writeFile(outputPath, html);
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        }
        return `${remainingSeconds}s`;
    }
}

async function runExample() {
    const runner = new E2ETestRunner({
        outputDir: './test-results',
        verbose: true
    });
    
    const testConfig = {
        websites: [
            {
                url: 'https://example.com',
                criteria: {
                    maxViolations: 0,
                    requiredHTMLElements: ['hasDoctype', 'hasLangAttribute', 'hasTitle'],
                    keyboardNavigation: true
                }
            },
            'https://httpbin.org/html',
            {
                url: 'https://www.w3.org',
                criteria: {
                    maxViolations: 5,
                    keyboardNavigation: true
                }
            }
        ],
        criteria: {
            maxViolations: 2,
            requiredHTMLElements: ['hasDoctype', 'hasTitle'],
            keyboardNavigation: false
        }
    };
    
    try {
        const summary = await runner.runTestSuite(testConfig);
        console.log('✅ Test suite completed successfully!');
        return summary;
    } catch (error) {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    runExample();
}

module.exports = E2ETestRunner;