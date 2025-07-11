/**
 * Comprehensive Test Runner
 * Orchestrates the entire End-to-End testing system with advanced configuration
 */

const EventEmitter = require('events');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const EnhancedE2ETester = require('./enhanced-e2e-tester');
const EnhancedBatchProcessor = require('./enhanced-batch-processor');

class ComprehensiveTestRunner extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            configFile: options.configFile || 'test-config.json',
            enableRealTimeMonitoring: options.enableRealTimeMonitoring !== false,
            enableFailedTestIsolation: options.enableFailedTestIsolation !== false,
            outputFormats: options.outputFormats || ['json', 'html', 'csv'],
            ...options
        };

        this.config = null;
        this.batchProcessor = null;
        this.activeSessions = new Map();
        this.systemMetrics = {
            startTime: null,
            endTime: null,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            isolatedFailures: 0
        };

        this.baseDir = process.cwd();
        this.configDir = path.join(this.baseDir, 'config');
        this.resultsDir = path.join(this.baseDir, 'test-results');
        this.logsDir = path.join(this.resultsDir, 'debug-logs');
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Comprehensive Test Runner...');
            
            // Ensure directories
            await this.ensureDirectories();
            
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize batch processor
            this.batchProcessor = new EnhancedBatchProcessor(this.config.batch || {});
            await this.batchProcessor.initialize();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Setup real-time monitoring
            if (this.options.enableRealTimeMonitoring) {
                this.setupRealTimeMonitoring();
            }

            console.log('✅ Comprehensive Test Runner initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Comprehensive Test Runner:', error.message);
            throw error;
        }
    }

    async ensureDirectories() {
        const dirs = [
            this.configDir,
            this.resultsDir,
            this.logsDir,
            path.join(this.resultsDir, 'failed-tests'),
            path.join(this.resultsDir, 'screenshots'),
            path.join(this.resultsDir, 'reports'),
            path.join(this.resultsDir, 'html-analysis')
        ];

        for (const dir of dirs) {
            await fs.ensureDir(dir);
        }
    }

    async loadConfiguration() {
        const configPath = path.join(this.configDir, this.options.configFile);
        
        try {
            if (await fs.pathExists(configPath)) {
                this.config = await fs.readJSON(configPath);
                console.log(`📋 Configuration loaded from: ${configPath}`);
            } else {
                this.config = this.getDefaultConfiguration();
                await fs.writeJSON(configPath, this.config, { spaces: 2 });
                console.log(`📋 Default configuration created at: ${configPath}`);
            }
        } catch (error) {
            console.warn(`⚠️ Failed to load configuration: ${error.message}`);
            this.config = this.getDefaultConfiguration();
        }
    }

    getDefaultConfiguration() {
        return {
            // Test Criteria Configuration
            testCriteria: {
                maxViolations: 0,
                requiredElements: ['lang', 'title', 'alt-texts'],
                keyboardNavigation: true,
                colorContrast: 'AA', // AA or AAA
                performanceThreshold: 3000, // milliseconds
                mobileResponsive: true,
                htmlValidation: true,
                screenReaderCompatibility: true
            },

            // Browser Configuration
            browser: {
                headless: true,
                viewport: { width: 1920, height: 1080 },
                timeout: 30000,
                userAgent: null, // Use default
                enableJavaScript: true,
                enableImages: true,
                enableCSS: true
            },

            // Screenshot Configuration
            screenshots: {
                enabled: true,
                captureFullPage: true,
                captureViewports: ['desktop', 'tablet', 'mobile'],
                quality: 80, // 1-100
                formats: ['png'],
                captureOnFailure: true,
                captureInteractiveStates: false // hover, focus, etc.
            },

            // Batch Processing Configuration
            batch: {
                maxConcurrent: 3,
                retryAttempts: 3,
                retryDelay: 1000,
                retryBackoff: 2,
                circuitBreakerThreshold: 5,
                circuitBreakerTimeout: 30000,
                timeoutPerTest: 60000,
                enablePersistence: true
            },

            // Reporting Configuration
            reporting: {
                formats: ['json', 'html', 'csv'],
                includeScreenshots: true,
                includeDebugInfo: true,
                generateSummary: true,
                includeFailureAnalysis: true,
                realTimeUpdates: true
            },

            // Failed Test Isolation Configuration
            failedTestIsolation: {
                enabled: true,
                isolateOnFirstFailure: true,
                preserveScreenshots: true,
                preserveHtmlSnapshot: true,
                generateRetryInstructions: true,
                categorizeFailures: true
            },

            // Performance Monitoring
            performance: {
                trackMemoryUsage: true,
                trackExecutionTime: true,
                enableProfiling: false,
                logResourceUsage: true
            },

            // Accessibility Configuration
            accessibility: {
                enableAxeCore: true,
                axeRules: {
                    'color-contrast': { enabled: true },
                    'keyboard-navigation': { enabled: true },
                    'aria-labels': { enabled: true },
                    'heading-order': { enabled: true },
                    'alt-text': { enabled: true },
                    'form-labels': { enabled: true },
                    'focus-management': { enabled: true }
                },
                customTests: {
                    screenReaderCompatibility: true,
                    keyboardNavigation: true,
                    colorContrastAnalysis: true,
                    responsiveDesign: true
                }
            },

            // Logging Configuration
            logging: {
                level: 'info', // debug, info, warn, error
                enableFileLogging: true,
                enableConsoleLogging: true,
                logToSeparateFiles: true,
                maxLogFileSize: '10MB',
                maxLogFiles: 5
            }
        };
    }

    setupEventListeners() {
        // Batch processor events
        this.batchProcessor.on('batchStarted', (data) => {
            console.log(`🚀 Batch started: ${data.batchId}`);
            this.emit('sessionStarted', data);
        });

        this.batchProcessor.on('batchProgress', (data) => {
            if (this.options.enableRealTimeMonitoring) {
                this.logProgress(data.batch);
            }
            this.emit('sessionProgress', data);
        });

        this.batchProcessor.on('batchCompleted', (data) => {
            console.log(`✅ Batch completed: ${data.batchId}`);
            this.updateSystemMetrics(data.batch);
            this.emit('sessionCompleted', data);
        });

        this.batchProcessor.on('batchFailed', (data) => {
            console.log(`❌ Batch failed: ${data.batchId}`);
            this.emit('sessionFailed', data);
        });

        this.batchProcessor.on('jobFailed', async (data) => {
            if (this.options.enableFailedTestIsolation) {
                await this.handleFailedTestIsolation(data);
            }
        });
    }

    setupRealTimeMonitoring() {
        // Performance monitoring
        setInterval(() => {
            const memUsage = process.memoryUsage();
            const metrics = {
                timestamp: new Date().toISOString(),
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024), // MB
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
                    external: Math.round(memUsage.external / 1024 / 1024) // MB
                },
                activeBatches: this.batchProcessor.listBatches().filter(b => b.status === 'processing').length,
                totalBatches: this.batchProcessor.listBatches().length
            };

            this.emit('systemMetrics', metrics);
            
            // Log to file if enabled
            if (this.config.logging.enableFileLogging) {
                this.logToFile('system-metrics.log', JSON.stringify(metrics));
            }
        }, 10000); // Every 10 seconds
    }

    async runSingleTest(url, customConfig = {}) {
        try {
            console.log(`🧪 Running single test: ${url}`);
            
            const sessionId = uuidv4();
            const startTime = Date.now();
            
            // Merge configurations
            const testConfig = {
                ...this.config.testCriteria,
                ...customConfig
            };

            // Initialize tester
            const tester = new EnhancedE2ETester({
                ...this.config.browser,
                testCriteria: testConfig
            });

            await tester.initialize();

            // Run test
            const result = await tester.testWebsite(url, testConfig);

            // Handle failed test isolation
            if (!result.validation.passed && this.options.enableFailedTestIsolation) {
                await this.isolateFailedTest(result, tester);
            }

            // Generate report
            await this.generateSingleTestReport(result, sessionId);

            // Cleanup
            await tester.cleanup();

            const duration = Date.now() - startTime;
            console.log(`✅ Single test completed in ${duration}ms`);

            return {
                sessionId,
                result,
                duration,
                status: result.validation.passed ? 'passed' : 'failed'
            };

        } catch (error) {
            console.error('❌ Single test failed:', error.message);
            throw error;
        }
    }

    async runBatchTest(urls, customConfig = {}) {
        try {
            console.log(`🚀 Running batch test with ${urls.length} URLs`);
            
            this.systemMetrics.startTime = Date.now();
            this.systemMetrics.totalTests += urls.length;

            // Merge configurations
            const batchConfig = {
                ...this.config.batch,
                ...this.config.testCriteria,
                ...customConfig
            };

            // Create and process batch
            const { batchId } = await this.batchProcessor.createBatch(urls, batchConfig);
            const result = await this.batchProcessor.processBatch(batchId);

            this.systemMetrics.endTime = Date.now();
            
            console.log(`✅ Batch test completed: ${batchId}`);
            return result;

        } catch (error) {
            console.error('❌ Batch test failed:', error.message);
            throw error;
        }
    }

    async runTestSuite(testSuite) {
        try {
            console.log(`🎯 Running test suite: ${testSuite.name || 'Unnamed'}`);
            
            const suiteResults = {
                id: uuidv4(),
                name: testSuite.name,
                startTime: Date.now(),
                endTime: null,
                tests: [],
                summary: {
                    total: 0,
                    passed: 0,
                    failed: 0,
                    duration: 0
                }
            };

            // Process each test configuration in the suite
            for (const testConfig of testSuite.tests) {
                const testResult = await this.processTestConfiguration(testConfig);
                suiteResults.tests.push(testResult);
                suiteResults.summary.total++;
                
                if (testResult.status === 'passed') {
                    suiteResults.summary.passed++;
                } else {
                    suiteResults.summary.failed++;
                }
            }

            suiteResults.endTime = Date.now();
            suiteResults.summary.duration = suiteResults.endTime - suiteResults.startTime;

            // Generate suite report
            await this.generateTestSuiteReport(suiteResults);

            console.log(`✅ Test suite completed: ${suiteResults.summary.passed}/${suiteResults.summary.total} passed`);
            return suiteResults;

        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            throw error;
        }
    }

    async processTestConfiguration(testConfig) {
        if (testConfig.type === 'single') {
            return await this.runSingleTest(testConfig.url, testConfig.config);
        } else if (testConfig.type === 'batch') {
            return await this.runBatchTest(testConfig.urls, testConfig.config);
        } else {
            throw new Error(`Unknown test type: ${testConfig.type}`);
        }
    }

    async handleFailedTestIsolation(data) {
        try {
            console.log(`🔴 Isolating failed test: ${data.job.url}`);
            
            // Create isolation directory
            const isolationDir = path.join(
                this.resultsDir, 
                'failed-tests', 
                `failed-${data.job.id}-${Date.now()}`
            );
            
            await fs.ensureDir(isolationDir);

            // Create comprehensive failure report
            const failureReport = {
                testId: data.job.id,
                batchId: data.batch.id,
                url: data.job.url,
                timestamp: new Date().toISOString(),
                attempts: data.job.attempts,
                error: data.job.error,
                batchConfig: data.batch.config,
                isolationReason: 'Automatic isolation due to test failure',
                systemInfo: {
                    platform: process.platform,
                    nodeVersion: process.version,
                    memoryUsage: process.memoryUsage()
                }
            };

            await fs.writeJSON(
                path.join(isolationDir, 'failure-report.json'), 
                failureReport, 
                { spaces: 2 }
            );

            // Generate retry instructions
            const retryInstructions = this.generateAdvancedRetryInstructions(data);
            await fs.writeFile(
                path.join(isolationDir, 'retry-instructions.md'), 
                retryInstructions
            );

            // Log isolation
            await this.logToFile('failed-test-isolations.log', 
                JSON.stringify({ ...failureReport, isolationDir }));

            this.systemMetrics.isolatedFailures++;
            
            console.log(`💾 Failed test isolated in: ${isolationDir}`);
            return isolationDir;

        } catch (error) {
            console.error('Failed to isolate test:', error.message);
        }
    }

    generateAdvancedRetryInstructions(data) {
        return `# Advanced Retry Instructions

## Test Information
- **Test ID**: ${data.job.id}
- **Batch ID**: ${data.batch.id}
- **URL**: ${data.job.url}
- **Attempts**: ${data.job.attempts}
- **Timestamp**: ${new Date().toISOString()}

## Failure Details
\`\`\`
${data.job.error?.message || 'Unknown error'}
\`\`\`

## Retry Options

### 1. Simple Retry
\`\`\`bash
node src/comprehensive-test-runner.js --single-test="${data.job.url}"
\`\`\`

### 2. Debug Mode Retry
\`\`\`bash
node src/comprehensive-test-runner.js --single-test="${data.job.url}" --debug --headless=false
\`\`\`

### 3. Custom Configuration Retry
\`\`\`bash
node src/comprehensive-test-runner.js --single-test="${data.job.url}" --config="custom-retry-config.json"
\`\`\`

### 4. Programmatic Retry
\`\`\`javascript
const runner = new ComprehensiveTestRunner();
await runner.initialize();

const result = await runner.runSingleTest('${data.job.url}', {
    maxViolations: 10, // More lenient
    performanceThreshold: 5000, // Higher threshold
    enableRetries: true,
    maxRetries: 5
});

console.log('Retry result:', result);
\`\`\`

## Troubleshooting Steps

1. **Check Network Connectivity**
   \`\`\`bash
   curl -I "${data.job.url}"
   \`\`\`

2. **Verify Site Accessibility**
   - Open the URL in a browser manually
   - Check for any server errors or maintenance pages

3. **Adjust Test Configuration**
   - Increase timeout values
   - Reduce strict validation criteria
   - Enable retry mechanisms

4. **System Resources**
   - Check available memory
   - Close other applications
   - Consider running tests sequentially

## Configuration Suggestions

Based on the failure, consider these configuration adjustments:

\`\`\`json
{
  "testCriteria": {
    "maxViolations": 5,
    "performanceThreshold": 5000
  },
  "browser": {
    "timeout": 60000
  },
  "batch": {
    "retryAttempts": 5,
    "retryDelay": 2000,
    "timeoutPerTest": 90000
  }
}
\`\`\`

---
Generated by Comprehensive Test Runner
`;
    }

    async generateSingleTestReport(result, sessionId) {
        try {
            const reportDir = path.join(this.resultsDir, 'reports');
            
            // JSON Report
            if (this.config.reporting.formats.includes('json')) {
                await fs.writeJSON(
                    path.join(reportDir, `single-test-${sessionId}.json`), 
                    result, 
                    { spaces: 2 }
                );
            }

            // HTML Report
            if (this.config.reporting.formats.includes('html')) {
                const htmlReport = this.generateSingleTestHTML(result, sessionId);
                await fs.writeFile(
                    path.join(reportDir, `single-test-${sessionId}.html`), 
                    htmlReport
                );
            }

            console.log(`📊 Single test report generated: ${sessionId}`);
        } catch (error) {
            console.error('Failed to generate single test report:', error.message);
        }
    }

    generateSingleTestHTML(result, sessionId) {
        const status = result.validation.passed ? 'PASSED' : 'FAILED';
        const statusClass = result.validation.passed ? 'passed' : 'failed';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Single Test Report - ${sessionId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { border-bottom: 2px solid #e1e5e9; padding-bottom: 20px; margin-bottom: 30px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .badge.passed { background: #d4edda; color: #155724; }
        .badge.failed { background: #f8d7da; color: #721c24; }
        .score { font-size: 2em; font-weight: bold; }
        .score.high { color: #28a745; }
        .score.medium { color: #ffc107; }
        .score.low { color: #dc3545; }
        .section { margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; }
        .violation { background: white; border-left: 4px solid #dc3545; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .screenshot { max-width: 100%; height: auto; border: 1px solid #dee2e6; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Single Test Report</h1>
            <p><strong>URL:</strong> <a href="${result.url}" target="_blank">${result.url}</a></p>
            <p><strong>Status:</strong> <span class="badge ${statusClass}">${status}</span></p>
            <p><strong>Test ID:</strong> ${result.testId}</p>
            <p><strong>Timestamp:</strong> ${new Date(result.metadata.timestamp).toLocaleString()}</p>
        </div>

        <div class="section">
            <h3>📊 Overall Score</h3>
            <div class="score ${result.validation.score >= 80 ? 'high' : result.validation.score >= 60 ? 'medium' : 'low'}">
                ${result.validation.score}/100
            </div>
        </div>

        ${result.accessibility && result.accessibility.violations && result.accessibility.violations.length > 0 ? `
        <div class="section">
            <h3>⚠️ Accessibility Violations (${result.accessibility.violations.length})</h3>
            ${result.accessibility.violations.map(violation => `
                <div class="violation">
                    <h4>${violation.id}</h4>
                    <p><strong>Impact:</strong> ${violation.impact}</p>
                    <p><strong>Description:</strong> ${violation.description}</p>
                    <p><strong>Nodes affected:</strong> ${violation.nodes}</p>
                    <p><a href="${violation.helpUrl}" target="_blank">Learn more</a></p>
                </div>
            `).join('')}
        </div>
        ` : ''}

        ${result.performance ? `
        <div class="section">
            <h3>⚡ Performance Metrics</h3>
            <p><strong>Load Time:</strong> ${result.performance.timing?.loadComplete || 'N/A'}ms</p>
            <p><strong>DOM Content Loaded:</strong> ${result.performance.timing?.domContentLoaded || 'N/A'}ms</p>
            <p><strong>First Paint:</strong> ${result.performance.timing?.firstPaint || 'N/A'}ms</p>
        </div>
        ` : ''}

        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; text-align: center;">
            Generated by Comprehensive Test Runner - ${new Date().toISOString()}
        </div>
    </div>
</body>
</html>`;
    }

    async generateTestSuiteReport(suiteResults) {
        try {
            const reportDir = path.join(this.resultsDir, 'reports');
            const reportPath = path.join(reportDir, `test-suite-${suiteResults.id}.json`);
            
            await fs.writeJSON(reportPath, suiteResults, { spaces: 2 });
            console.log(`📊 Test suite report generated: ${suiteResults.id}`);
        } catch (error) {
            console.error('Failed to generate test suite report:', error.message);
        }
    }

    logProgress(batch) {
        const progress = `[${batch.progress.completed + batch.progress.failed}/${batch.progress.total}] ` +
                        `✅ ${batch.progress.completed} ❌ ${batch.progress.failed} ` +
                        `(${batch.progress.percentage}%)`;
        
        console.log(`📈 Progress: ${progress}`);
    }

    updateSystemMetrics(batch) {
        this.systemMetrics.passedTests += batch.progress.completed;
        this.systemMetrics.failedTests += batch.progress.failed;
    }

    async logToFile(filename, message) {
        try {
            const logPath = path.join(this.logsDir, filename);
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] ${message}\n`;
            
            await fs.appendFile(logPath, logEntry);
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    // Public API methods
    getSystemMetrics() {
        return {
            ...this.systemMetrics,
            duration: this.systemMetrics.endTime ? 
                this.systemMetrics.endTime - this.systemMetrics.startTime : 
                Date.now() - this.systemMetrics.startTime,
            successRate: this.systemMetrics.totalTests > 0 ? 
                Math.round((this.systemMetrics.passedTests / this.systemMetrics.totalTests) * 100) : 0
        };
    }

    getActiveSessions() {
        return Array.from(this.activeSessions.values());
    }

    getConfiguration() {
        return this.config;
    }

    async updateConfiguration(newConfig) {
        this.config = { ...this.config, ...newConfig };
        const configPath = path.join(this.configDir, this.options.configFile);
        await fs.writeJSON(configPath, this.config, { spaces: 2 });
        console.log('📋 Configuration updated');
    }

    async cleanup() {
        if (this.batchProcessor) {
            // Clean up any ongoing batches
            console.log('🧹 Cleaning up test runner...');
        }
        console.log('✅ Test runner cleanup completed');
    }
}

module.exports = ComprehensiveTestRunner;