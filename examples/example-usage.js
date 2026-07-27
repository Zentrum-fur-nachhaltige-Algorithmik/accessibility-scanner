/**
 * Example Usage of Enhanced E2E Testing System
 * Demonstrates comprehensive testing capabilities
 */

const ComprehensiveTestRunner = require('../src/comprehensive-test-runner');
const path = require('path');

async function demonstrateSystem() {
    console.log('🚀 Enhanced E2E Testing System - Examples\n');

    const runner = new ComprehensiveTestRunner({
        configFile: 'example-config.json'
    });

    try {
        // Initialize the system
        await runner.initialize();

        // Example 1: Single Website Test
        await example1_SingleWebsiteTest(runner);

        // Example 2: Batch Testing
        await example2_BatchTesting(runner);

        // Example 3: Test Suite Execution
        await example3_TestSuiteExecution(runner);

        // Example 4: Failed Test Analysis
        await example4_FailedTestAnalysis(runner);

        // Example 5: Real-time Monitoring
        await example5_RealTimeMonitoring(runner);

        console.log('\n✅ All examples completed successfully!');

    } catch (error) {
        console.error('❌ Example execution failed:', error.message);
    } finally {
        await runner.cleanup();
    }
}

async function example1_SingleWebsiteTest(runner) {
    console.log('📋 Example 1: Single Website Test');
    console.log('=====================================\n');

    // Test a single website with custom configuration
    const result = await runner.runSingleTest('https://example.com', {
        maxViolations: 5,
        performanceThreshold: 3000,
        colorContrast: 'AA',
        keyboardNavigation: true
    });

    console.log(`Result: ${result.status}`);
    console.log(`Score: ${result.result.validation.score}/100`);
    console.log(`Duration: ${result.duration}ms`);
    
    if (result.result.accessibility?.violations_count > 0) {
        console.log(`Accessibility violations: ${result.result.accessibility.violations_count}`);
    }

    console.log(`Report saved: test-results/reports/single-test-${result.sessionId}.html\n`);
}

async function example2_BatchTesting(runner) {
    console.log('📋 Example 2: Batch Testing');
    console.log('============================\n');

    // Test multiple websites in batch
    const testUrls = [
        'https://example.com',
        'https://github.com',
        'https://stackoverflow.com'
    ];

    const batchConfig = {
        maxConcurrent: 2,
        retryAttempts: 3,
        performanceThreshold: 4000
    };

    const result = await runner.runBatchTest(testUrls, batchConfig);

    console.log(`Batch completed: ${result.id}`);
    console.log(`Total tests: ${result.progress.total}`);
    console.log(`Passed: ${result.progress.completed}`);
    console.log(`Failed: ${result.progress.failed}`);
    console.log(`Success rate: ${result.progress.percentage}%`);

    console.log(`Batch report saved: test-results/reports/batch-${result.id}.html\n`);
}

async function example3_TestSuiteExecution(runner) {
    console.log('📋 Example 3: Test Suite Execution');
    console.log('===================================\n');

    // Define a comprehensive test suite
    const testSuite = {
        name: 'E-commerce Accessibility Suite',
        description: 'Comprehensive testing for e-commerce websites',
        tests: [
            {
                type: 'single',
                name: 'Homepage Test',
                url: 'https://example-shop.com',
                config: {
                    maxViolations: 0,
                    performanceThreshold: 2000,
                    colorContrast: 'AAA'
                }
            },
            {
                type: 'batch',
                name: 'Product Pages',
                urls: [
                    'https://example-shop.com/product/1',
                    'https://example-shop.com/product/2',
                    'https://example-shop.com/product/3'
                ],
                config: {
                    maxConcurrent: 3,
                    keyboardNavigation: true,
                    mobileResponsive: true
                }
            }
        ]
    };

    const result = await runner.runTestSuite(testSuite);

    console.log(`Test suite completed: ${result.name}`);
    console.log(`Total tests: ${result.summary.total}`);
    console.log(`Passed: ${result.summary.passed}`);
    console.log(`Failed: ${result.summary.failed}`);
    console.log(`Duration: ${Math.round(result.summary.duration / 1000)}s`);

    console.log(`Suite report saved: test-results/reports/test-suite-${result.id}.json\n`);
}

async function example4_FailedTestAnalysis(runner) {
    console.log('📋 Example 4: Failed Test Analysis');
    console.log('===================================\n');

    // Simulate a test that might fail
    try {
        const result = await runner.runSingleTest('https://non-existent-website-12345.com', {
            maxViolations: 0,
            performanceThreshold: 1000 // Very strict
        });

        console.log('Test passed unexpectedly');
    } catch (error) {
        console.log('Test failed as expected for demonstration');
    }

    // Show failed test isolation capabilities
    const failedTests = runner.batchProcessor?.getFailedTests() || [];
    
    if (failedTests.length > 0) {
        console.log(`Found ${failedTests.length} isolated failed tests:`);
        failedTests.forEach((test, index) => {
            console.log(`${index + 1}. Job ID: ${test.job.id}`);
            console.log(`   URL: ${test.job.url}`);
            console.log(`   Error: ${test.job.error?.message}`);
            console.log(`   Isolation Path: ${test.isolationPath || 'Not set'}`);
        });
    } else {
        console.log('No failed tests found in this session');
    }

    console.log('');
}

async function example5_RealTimeMonitoring(runner) {
    console.log('📋 Example 5: Real-time Monitoring');
    console.log('===================================\n');

    // Setup event listeners for real-time monitoring
    runner.on('sessionStarted', (data) => {
        console.log(`🚀 Session started: ${data.batchId}`);
    });

    runner.on('sessionProgress', (data) => {
        const batch = data.batch;
        console.log(`📈 Progress: ${batch.progress.completed}/${batch.progress.total} (${batch.progress.percentage}%)`);
    });

    runner.on('sessionCompleted', (data) => {
        console.log(`✅ Session completed: ${data.batchId}`);
    });

    runner.on('systemMetrics', (metrics) => {
        console.log(`💾 Memory: ${metrics.memory.heapUsed}MB, Active batches: ${metrics.activeBatches}`);
    });

    // Show current system metrics
    const metrics = runner.getSystemMetrics();
    console.log('Current system metrics:');
    console.log(`- Total tests: ${metrics.totalTests}`);
    console.log(`- Passed tests: ${metrics.passedTests}`);
    console.log(`- Failed tests: ${metrics.failedTests}`);
    console.log(`- Success rate: ${metrics.successRate}%`);
    console.log(`- Isolated failures: ${metrics.isolatedFailures}`);

    if (metrics.startTime) {
        console.log(`- Runtime: ${Math.round(metrics.duration / 1000)}s`);
    }

    console.log('');
}

// Additional utility functions for advanced usage

async function createCustomTestSuite() {
    return {
        name: 'WCAG 2.2 AA Compliance Suite',
        description: 'Comprehensive WCAG 2.2 AA compliance testing',
        version: '1.0.0',
        tests: [
            {
                type: 'single',
                name: 'Perceivable - Color Contrast',
                url: 'https://target-website.com',
                config: {
                    maxViolations: 0,
                    colorContrast: 'AA',
                    customTests: {
                        colorContrastAnalysis: true
                    }
                }
            },
            {
                type: 'single',
                name: 'Operable - Keyboard Navigation',
                url: 'https://target-website.com',
                config: {
                    keyboardNavigation: true,
                    customTests: {
                        keyboardNavigation: true
                    }
                }
            },
            {
                type: 'batch',
                name: 'Understandable - Multiple Pages',
                urls: [
                    'https://target-website.com/',
                    'https://target-website.com/about',
                    'https://target-website.com/contact'
                ],
                config: {
                    htmlValidation: true,
                    customTests: {
                        screenReaderCompatibility: true
                    }
                }
            },
            {
                type: 'single',
                name: 'Robust - Mobile Responsiveness',
                url: 'https://target-website.com',
                config: {
                    mobileResponsive: true,
                    screenshots: {
                        captureViewports: ['mobile', 'tablet', 'desktop']
                    }
                }
            }
        ]
    };
}

async function demonstrateAdvancedConfiguration() {
    const advancedConfig = {
        testCriteria: {
            maxViolations: 0,
            requiredElements: ['lang', 'title', 'alt-texts', 'form-labels'],
            keyboardNavigation: true,
            colorContrast: 'AAA',
            performanceThreshold: 2000,
            mobileResponsive: true,
            htmlValidation: true,
            screenReaderCompatibility: true
        },
        browser: {
            headless: false, // Show browser for debugging
            viewport: { width: 1920, height: 1080 },
            timeout: 45000,
            enableJavaScript: true,
            enableImages: true,
            enableCSS: true
        },
        screenshots: {
            enabled: true,
            captureFullPage: true,
            captureViewports: ['desktop', 'tablet', 'mobile'],
            quality: 90,
            captureOnFailure: true,
            captureInteractiveStates: true
        },
        batch: {
            maxConcurrent: 5,
            retryAttempts: 5,
            retryDelay: 2000,
            retryBackoff: 2,
            circuitBreakerThreshold: 3,
            timeoutPerTest: 90000
        },
        failedTestIsolation: {
            enabled: true,
            isolateOnFirstFailure: true,
            preserveScreenshots: true,
            preserveHtmlSnapshot: true,
            generateRetryInstructions: true,
            categorizeFailures: true
        },
        accessibility: {
            enableAxeCore: true,
            axeRules: {
                'color-contrast': { enabled: true },
                'keyboard-navigation': { enabled: true },
                'aria-labels': { enabled: true },
                'heading-order': { enabled: true },
                'alt-text': { enabled: true },
                'form-labels': { enabled: true },
                'focus-management': { enabled: true },
                'landmark-roles': { enabled: true }
            },
            customTests: {
                screenReaderCompatibility: true,
                keyboardNavigation: true,
                colorContrastAnalysis: true,
                responsiveDesign: true,
                formValidation: true
            }
        }
    };

    return advancedConfig;
}

// Export for module usage
module.exports = {
    demonstrateSystem,
    createCustomTestSuite,
    demonstrateAdvancedConfiguration
};

// Run examples if this file is executed directly
if (require.main === module) {
    demonstrateSystem().catch(error => {
        console.error('Example execution failed:', error);
        process.exit(1);
    });
}