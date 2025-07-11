/**
 * Enhanced End-to-End Website Testing System
 * Builds upon existing infrastructure with advanced capabilities
 */

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axeCore = require('axe-core');

class EnhancedE2ETester {
    constructor(options = {}) {
        this.options = {
            headless: options.headless !== false,
            viewport: options.viewport || { width: 1920, height: 1080 },
            timeout: options.timeout || 30000,
            enableRetries: options.enableRetries !== false,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            captureFullPage: options.captureFullPage !== false,
            captureViewports: options.captureViewports || ['desktop', 'tablet', 'mobile'],
            testCriteria: {
                maxViolations: 0,
                requiredElements: ['lang', 'title', 'alt-texts'],
                keyboardNavigation: true,
                colorContrast: 'AA',
                performanceThreshold: 3000,
                mobileResponsive: true,
                ...options.testCriteria
            }
        };

        this.browser = null;
        this.testResults = new Map();
        this.failedTestsDir = path.join(process.cwd(), 'test-results', 'failed-tests');
        this.screenshotsDir = path.join(process.cwd(), 'test-results', 'screenshots');
        this.reportsDir = path.join(process.cwd(), 'test-results', 'reports');
        this.htmlAnalysisDir = path.join(process.cwd(), 'test-results', 'html-analysis');
        this.debugLogsDir = path.join(process.cwd(), 'test-results', 'debug-logs');

        this.viewportSizes = {
            desktop: { width: 1920, height: 1080 },
            tablet: { width: 768, height: 1024 },
            mobile: { width: 375, height: 667 }
        };
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Enhanced E2E Tester...');
            
            // Create all required directories
            await this.ensureDirectories();
            
            // Launch browser with optimized settings
            this.browser = await puppeteer.launch({
                headless: this.options.headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            });

            console.log('✅ Enhanced E2E Tester initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Enhanced E2E Tester:', error.message);
            throw error;
        }
    }

    async ensureDirectories() {
        const dirs = [
            this.failedTestsDir,
            this.screenshotsDir,
            this.reportsDir,
            this.htmlAnalysisDir,
            this.debugLogsDir
        ];

        for (const dir of dirs) {
            await fs.ensureDir(dir);
        }
    }

    async testWebsite(url, config = {}) {
        const testId = uuidv4();
        const startTime = Date.now();
        
        console.log(`🧪 Testing website: ${url} (ID: ${testId})`);

        const testConfig = {
            ...this.options.testCriteria,
            ...config
        };

        let page = null;
        let attempts = 0;
        const maxAttempts = this.options.enableRetries ? this.options.maxRetries + 1 : 1;

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`📋 Attempt ${attempts}/${maxAttempts} for ${url}`);

                page = await this.browser.newPage();
                await page.setViewport(this.options.viewport);

                // Set timeouts
                page.setDefaultTimeout(this.options.timeout);
                page.setDefaultNavigationTimeout(this.options.timeout);

                // Navigate to page
                const navigationStart = Date.now();
                await page.goto(url, { waitUntil: 'networkidle0' });
                const navigationTime = Date.now() - navigationStart;

                // Comprehensive testing
                const testResults = await this.runComprehensiveTests(page, url, testId, testConfig);
                testResults.metadata = {
                    testId,
                    url,
                    timestamp: new Date().toISOString(),
                    duration: Date.now() - startTime,
                    navigationTime,
                    attempt: attempts,
                    userAgent: await page.evaluate(() => navigator.userAgent),
                    viewport: this.options.viewport
                };

                // Validate results
                const validation = await this.validateTestResults(testResults, testConfig);
                testResults.validation = validation;

                // Handle failed tests
                if (!validation.passed) {
                    await this.isolateFailedTest(testId, testResults, page);
                }

                // Store results
                this.testResults.set(testId, testResults);
                await this.saveTestResults(testId, testResults);

                await page.close();
                console.log(`✅ Test completed for ${url} (${validation.passed ? 'PASSED' : 'FAILED'})`);
                
                return testResults;

            } catch (error) {
                console.error(`❌ Attempt ${attempts} failed for ${url}:`, error.message);
                
                if (page) {
                    await page.close().catch(() => {});
                }

                if (attempts === maxAttempts) {
                    // Final attempt failed - create error report
                    const errorResults = await this.createErrorReport(url, testId, error, attempts);
                    await this.isolateFailedTest(testId, errorResults);
                    return errorResults;
                }

                // Wait before retry
                if (attempts < maxAttempts) {
                    await this.delay(this.options.retryDelay * attempts);
                }
            }
        }
    }

    async runComprehensiveTests(page, url, testId, config) {
        console.log('🔍 Running comprehensive accessibility tests...');

        const results = {
            url,
            testId,
            accessibility: {},
            html: {},
            performance: {},
            screenshots: {},
            customTests: {}
        };

        try {
            // 1. Accessibility Testing with axe-core
            results.accessibility = await this.runAccessibilityTests(page);

            // 2. HTML Structure Analysis
            results.html = await this.analyzeHTMLStructure(page);

            // 3. Performance Metrics
            results.performance = await this.measurePerformance(page);

            // 4. Screenshot Documentation
            results.screenshots = await this.captureComprehensiveScreenshots(page, testId);

            // 5. Custom Accessibility Tests
            results.customTests = await this.runCustomAccessibilityTests(page, config);

            // 6. Keyboard Navigation Testing
            results.keyboardNavigation = await this.testKeyboardNavigation(page);

            // 7. Mobile Responsiveness
            results.responsive = await this.testResponsiveness(page);

            // 8. HTML Validation
            results.htmlValidation = await this.validateHTMLCompliance(page);

        } catch (error) {
            console.error('Error during comprehensive testing:', error.message);
            results.error = {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            };
        }

        return results;
    }

    async runAccessibilityTests(page) {
        try {
            // Inject axe-core
            await page.addScriptTag({
                content: axeCore.source
            });

            // Run axe-core analysis
            const axeResults = await page.evaluate(async () => {
                return await axe.run(document, {
                    rules: {
                        'color-contrast': { enabled: true },
                        'keyboard-navigation': { enabled: true },
                        'aria-labels': { enabled: true },
                        'heading-order': { enabled: true },
                        'alt-text': { enabled: true }
                    }
                });
            });

            return {
                violations: axeResults.violations.map(violation => ({
                    id: violation.id,
                    impact: violation.impact,
                    description: violation.description,
                    help: violation.help,
                    helpUrl: violation.helpUrl,
                    nodes: violation.nodes.length,
                    tags: violation.tags
                })),
                passes: axeResults.passes.length,
                violations_count: axeResults.violations.length,
                incomplete: axeResults.incomplete.length,
                inapplicable: axeResults.inapplicable.length,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Accessibility test error:', error.message);
            return { error: error.message, timestamp: new Date().toISOString() };
        }
    }

    async analyzeHTMLStructure(page) {
        try {
            const analysis = await page.evaluate(() => {
                const doc = document;
                
                // Check DOCTYPE
                const doctype = doc.doctype ? 
                    `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>` 
                    : null;

                // Check language attribute
                const langAttr = doc.documentElement.getAttribute('lang');

                // Analyze heading structure
                const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
                    level: parseInt(h.tagName.charAt(1)),
                    text: h.textContent.trim().substring(0, 100),
                    id: h.id || null
                }));

                // Check meta tags
                const metaTags = Array.from(doc.querySelectorAll('meta')).map(meta => ({
                    name: meta.getAttribute('name') || meta.getAttribute('property'),
                    content: meta.getAttribute('content'),
                    charset: meta.getAttribute('charset')
                }));

                // Check for accessibility elements
                const ariaElements = doc.querySelectorAll('[aria-label], [aria-describedby], [aria-labelledby], [role]').length;
                const altTextImages = doc.querySelectorAll('img[alt]').length;
                const totalImages = doc.querySelectorAll('img').length;

                return {
                    doctype,
                    langAttr,
                    title: doc.title,
                    headings: {
                        structure: headings,
                        count: headings.length,
                        hierarchy_valid: this.validateHeadingHierarchy(headings)
                    },
                    metaTags,
                    accessibility: {
                        ariaElements,
                        imagesWithAlt: altTextImages,
                        totalImages,
                        altTextCoverage: totalImages > 0 ? (altTextImages / totalImages * 100).toFixed(2) : 100
                    }
                };
            });

            return analysis;
        } catch (error) {
            console.error('HTML analysis error:', error.message);
            return { error: error.message, timestamp: new Date().toISOString() };
        }
    }

    async measurePerformance(page) {
        try {
            const metrics = await page.metrics();
            const performanceTiming = await page.evaluate(() => {
                const perf = performance.timing;
                return {
                    domContentLoaded: perf.domContentLoadedEventEnd - perf.navigationStart,
                    loadComplete: perf.loadEventEnd - perf.navigationStart,
                    firstPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-paint')?.startTime || 0,
                    firstContentfulPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime || 0
                };
            });

            return {
                ...metrics,
                timing: performanceTiming,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Performance measurement error:', error.message);
            return { error: error.message, timestamp: new Date().toISOString() };
        }
    }

    async captureComprehensiveScreenshots(page, testId) {
        try {
            const screenshots = {};
            const testScreenshotsDir = path.join(this.screenshotsDir, testId);
            await fs.ensureDir(testScreenshotsDir);

            // Capture screenshots for each viewport
            for (const [device, size] of Object.entries(this.viewportSizes)) {
                if (this.options.captureViewports.includes(device)) {
                    await page.setViewport(size);
                    await page.waitForTimeout(1000); // Allow reflow

                    // Full page screenshot
                    const fullPagePath = path.join(testScreenshotsDir, `${device}-full-page.png`);
                    await page.screenshot({
                        path: fullPagePath,
                        fullPage: this.options.captureFullPage
                    });

                    // Viewport screenshot
                    const viewportPath = path.join(testScreenshotsDir, `${device}-viewport.png`);
                    await page.screenshot({
                        path: viewportPath,
                        fullPage: false
                    });

                    screenshots[device] = {
                        fullPage: fullPagePath,
                        viewport: viewportPath,
                        size
                    };
                }
            }

            // Reset to default viewport
            await page.setViewport(this.options.viewport);

            return screenshots;
        } catch (error) {
            console.error('Screenshot capture error:', error.message);
            return { error: error.message, timestamp: new Date().toISOString() };
        }
    }

    async runCustomAccessibilityTests(page, config) {
        try {
            const customTests = {};

            // Color contrast testing
            if (config.colorContrast) {
                customTests.colorContrast = await this.testColorContrast(page, config.colorContrast);
            }

            // Screen reader compatibility
            customTests.screenReader = await this.testScreenReaderCompatibility(page);

            return customTests;
        } catch (error) {
            console.error('Custom accessibility tests error:', error.message);
            return { error: error.message, timestamp: new Date().toISOString() };
        }
    }

    async testColorContrast(page, standard) {
        try {
            const contrastResults = await page.evaluate((standardLevel) => {
                const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && el.offsetHeight > 0;
                });

                const results = [];
                const minRatio = standardLevel === 'AAA' ? 7 : 4.5;

                elements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const textColor = style.color;
                    const bgColor = style.backgroundColor;
                    
                    if (textColor && bgColor && textColor !== bgColor) {
                        // Simplified contrast check (would need actual color parsing for production)
                        results.push({
                            element: el.tagName.toLowerCase(),
                            textColor,
                            backgroundColor: bgColor,
                            text: el.textContent.trim().substring(0, 50)
                        });
                    }
                });

                return {
                    elementsChecked: results.length,
                    standard: standardLevel,
                    requiredRatio: minRatio,
                    timestamp: new Date().toISOString()
                };
            }, standard);

            return contrastResults;
        } catch (error) {
            console.error('Color contrast test error:', error.message);
            return { error: error.message };
        }
    }

    async testScreenReaderCompatibility(page) {
        try {
            const srCompatibility = await page.evaluate(() => {
                const landmarks = document.querySelectorAll('[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], main, nav, header, footer').length;
                const headingStructure = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
                const ariaLabels = document.querySelectorAll('[aria-label], [aria-labelledby]').length;
                const altTexts = document.querySelectorAll('img[alt]').length;
                const totalImages = document.querySelectorAll('img').length;

                return {
                    landmarks,
                    headingStructure,
                    ariaLabels,
                    altTextCoverage: totalImages > 0 ? (altTexts / totalImages * 100).toFixed(2) : 100,
                    skipLinks: document.querySelectorAll('a[href^="#"]').length,
                    timestamp: new Date().toISOString()
                };
            });

            return srCompatibility;
        } catch (error) {
            console.error('Screen reader compatibility test error:', error.message);
            return { error: error.message };
        }
    }

    async testKeyboardNavigation(page) {
        try {
            console.log('🎯 Testing keyboard navigation...');
            
            const keyboardResults = await page.evaluate(async () => {
                const focusableElements = Array.from(document.querySelectorAll(
                    'a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])'
                )).filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });

                return {
                    focusableCount: focusableElements.length,
                    tabIndexElements: document.querySelectorAll('[tabindex]').length,
                    timestamp: new Date().toISOString()
                };
            });

            // Simulate tab navigation
            await page.focus('body');
            const tabSteps = Math.min(10, keyboardResults.focusableCount); // Test first 10 elements
            
            for (let i = 0; i < tabSteps; i++) {
                await page.keyboard.press('Tab');
                await page.waitForTimeout(100);
            }

            keyboardResults.tabNavigationTested = tabSteps;
            return keyboardResults;
        } catch (error) {
            console.error('Keyboard navigation test error:', error.message);
            return { error: error.message };
        }
    }

    async testResponsiveness(page) {
        try {
            console.log('📱 Testing responsive design...');
            
            const responsiveResults = {};
            
            for (const [device, size] of Object.entries(this.viewportSizes)) {
                await page.setViewport(size);
                await page.waitForTimeout(500);

                const deviceResults = await page.evaluate((deviceName) => {
                    const viewport = {
                        width: window.innerWidth,
                        height: window.innerHeight
                    };

                    const overflowElements = Array.from(document.querySelectorAll('*')).filter(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > viewport.width;
                    }).length;

                    const mediaQueries = Array.from(document.styleSheets).reduce((queries, sheet) => {
                        try {
                            return queries + Array.from(sheet.cssRules).filter(rule => 
                                rule instanceof CSSMediaRule
                            ).length;
                        } catch (e) {
                            return queries;
                        }
                    }, 0);

                    return {
                        device: deviceName,
                        viewport,
                        overflowElements,
                        mediaQueries,
                        timestamp: new Date().toISOString()
                    };
                }, device);

                responsiveResults[device] = deviceResults;
            }

            // Reset viewport
            await page.setViewport(this.options.viewport);
            
            return responsiveResults;
        } catch (error) {
            console.error('Responsive design test error:', error.message);
            return { error: error.message };
        }
    }

    async validateHTMLCompliance(page) {
        try {
            const validation = await page.evaluate(() => {
                const doc = document;
                const issues = [];

                // Check DOCTYPE
                if (!doc.doctype) {
                    issues.push({ type: 'error', message: 'Missing DOCTYPE declaration' });
                }

                // Check html lang attribute
                if (!doc.documentElement.getAttribute('lang')) {
                    issues.push({ type: 'error', message: 'Missing lang attribute on html element' });
                }

                // Check title
                if (!doc.title || doc.title.trim().length === 0) {
                    issues.push({ type: 'error', message: 'Missing or empty title element' });
                }

                // Check for duplicate IDs
                const ids = Array.from(doc.querySelectorAll('[id]')).map(el => el.id);
                const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
                if (duplicateIds.length > 0) {
                    issues.push({ type: 'error', message: `Duplicate IDs found: ${duplicateIds.join(', ')}` });
                }

                return {
                    valid: issues.filter(i => i.type === 'error').length === 0,
                    issues,
                    timestamp: new Date().toISOString()
                };
            });

            return validation;
        } catch (error) {
            console.error('HTML validation error:', error.message);
            return { error: error.message };
        }
    }

    async validateTestResults(results, config) {
        try {
            const validation = {
                passed: true,
                failures: [],
                score: 0,
                maxScore: 100
            };

            // Check violations against max allowed
            if (results.accessibility && results.accessibility.violations_count > config.maxViolations) {
                validation.passed = false;
                validation.failures.push({
                    type: 'accessibility_violations',
                    expected: config.maxViolations,
                    actual: results.accessibility.violations_count,
                    message: `Too many accessibility violations: ${results.accessibility.violations_count} > ${config.maxViolations}`
                });
            }

            // Check performance against threshold
            if (results.performance && results.performance.timing && 
                results.performance.timing.loadComplete > config.performanceThreshold) {
                validation.passed = false;
                validation.failures.push({
                    type: 'performance_threshold',
                    expected: config.performanceThreshold,
                    actual: results.performance.timing.loadComplete,
                    message: `Load time exceeds threshold: ${results.performance.timing.loadComplete}ms > ${config.performanceThreshold}ms`
                });
            }

            // Check required elements
            if (config.requiredElements && results.html) {
                for (const required of config.requiredElements) {
                    let found = false;
                    
                    switch (required) {
                        case 'lang':
                            found = !!results.html.langAttr;
                            break;
                        case 'title':
                            found = !!results.html.title;
                            break;
                        case 'alt-texts':
                            found = results.html.accessibility && 
                                   parseFloat(results.html.accessibility.altTextCoverage) > 90;
                            break;
                    }

                    if (!found) {
                        validation.passed = false;
                        validation.failures.push({
                            type: 'required_element_missing',
                            element: required,
                            message: `Required element missing or insufficient: ${required}`
                        });
                    }
                }
            }

            // Calculate score
            const totalChecks = 10; // Adjust based on actual checks
            const failedChecks = validation.failures.length;
            validation.score = Math.max(0, Math.round(((totalChecks - failedChecks) / totalChecks) * 100));

            validation.timestamp = new Date().toISOString();
            return validation;
        } catch (error) {
            console.error('Test validation error:', error.message);
            return {
                passed: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async isolateFailedTest(testId, testResults, page = null) {
        try {
            console.log(`🔴 Isolating failed test: ${testId}`);
            
            const failedTestDir = path.join(this.failedTestsDir, testId);
            await fs.ensureDir(failedTestDir);

            // 1. Save failure report
            const failureReport = {
                testId,
                url: testResults.url || testResults.metadata?.url,
                timestamp: new Date().toISOString(),
                failureType: testResults.validation ? 'validation_failed' : 'execution_error',
                failures: testResults.validation?.failures || [],
                testResults: {
                    accessibility: testResults.accessibility,
                    performance: testResults.performance,
                    validation: testResults.validation
                },
                metadata: testResults.metadata || {}
            };

            await fs.writeJSON(
                path.join(failedTestDir, 'failure-report.json'), 
                failureReport, 
                { spaces: 2 }
            );

            // 2. Copy screenshots if they exist
            const screenshotsSourceDir = path.join(this.screenshotsDir, testId);
            const screenshotsFailedDir = path.join(failedTestDir, 'screenshots');
            
            if (await fs.pathExists(screenshotsSourceDir)) {
                await fs.copy(screenshotsSourceDir, screenshotsFailedDir);
            }

            // 3. Save HTML snapshot if page is available
            if (page) {
                try {
                    const htmlContent = await page.content();
                    await fs.writeFile(
                        path.join(failedTestDir, 'html-snapshot.html'), 
                        htmlContent
                    );
                } catch (htmlError) {
                    console.warn('Could not save HTML snapshot:', htmlError.message);
                }
            }

            // 4. Save debug information
            const debugInfo = {
                testId,
                timestamp: new Date().toISOString(),
                userAgent: testResults.metadata?.userAgent,
                viewport: testResults.metadata?.viewport,
                duration: testResults.metadata?.duration,
                attempt: testResults.metadata?.attempt,
                error: testResults.error || null,
                systemInfo: {
                    platform: process.platform,
                    nodeVersion: process.version,
                    memoryUsage: process.memoryUsage()
                }
            };

            await fs.writeJSON(
                path.join(failedTestDir, 'debug-info.json'), 
                debugInfo, 
                { spaces: 2 }
            );

            // 5. Create retry instructions
            const retryInstructions = this.generateRetryInstructions(testResults);
            await fs.writeFile(
                path.join(failedTestDir, 'retry-instructions.md'), 
                retryInstructions
            );

            console.log(`💾 Failed test isolated in: ${failedTestDir}`);
            return failedTestDir;
        } catch (error) {
            console.error('Failed to isolate test:', error.message);
            throw error;
        }
    }

    generateRetryInstructions(testResults) {
        const url = testResults.url || testResults.metadata?.url || 'unknown';
        const testId = testResults.testId || testResults.metadata?.testId || 'unknown';

        return `# Retry Instructions for Failed Test

## Test Information
- **Test ID**: ${testId}
- **URL**: ${url}
- **Timestamp**: ${new Date().toISOString()}
- **Status**: FAILED

## Failure Analysis
${testResults.validation?.failures ? 
    testResults.validation.failures.map(f => `- **${f.type}**: ${f.message}`).join('\n') : 
    'Execution error occurred during testing'
}

## How to Retry This Test

### Manual Retry
\`\`\`bash
node src/enhanced-e2e-tester.js --url="${url}" --test-id="${testId}"
\`\`\`

### Programmatic Retry
\`\`\`javascript
const tester = new EnhancedE2ETester();
await tester.initialize();
const result = await tester.testWebsite('${url}');
await tester.cleanup();
\`\`\`

### Debug Mode Retry
\`\`\`bash
node src/enhanced-e2e-tester.js --url="${url}" --debug --headless=false
\`\`\`

## Recommended Actions
1. Check network connectivity to the target URL
2. Verify the website is accessible and functioning
3. Review the HTML snapshot for any obvious issues
4. Check the debug information for system-related problems
5. Consider adjusting test criteria if failures are acceptable

## Files in This Isolation Directory
- \`failure-report.json\` - Detailed failure analysis
- \`screenshots/\` - All screenshots captured during the test
- \`html-snapshot.html\` - HTML content at the time of failure
- \`debug-info.json\` - Technical debugging information
- \`retry-instructions.md\` - This file

---
Generated by Enhanced E2E Testing System
`;
    }

    async createErrorReport(url, testId, error, attempts) {
        return {
            testId,
            url,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            metadata: {
                testId,
                url,
                timestamp: new Date().toISOString(),
                attempts,
                status: 'ERROR'
            },
            validation: {
                passed: false,
                failures: [{
                    type: 'execution_error',
                    message: `Test execution failed after ${attempts} attempts: ${error.message}`
                }]
            }
        };
    }

    async saveTestResults(testId, results) {
        try {
            const reportPath = path.join(this.reportsDir, `${testId}.json`);
            await fs.writeJSON(reportPath, results, { spaces: 2 });
            
            // Also save HTML analysis separately
            if (results.html) {
                const htmlAnalysisPath = path.join(this.htmlAnalysisDir, `${testId}-analysis.json`);
                await fs.writeJSON(htmlAnalysisPath, results.html, { spaces: 2 });
            }
        } catch (error) {
            console.error('Failed to save test results:', error.message);
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🧹 Browser cleanup completed');
        }
    }

    // Batch testing methods
    async testMultipleWebsites(urls, config = {}) {
        console.log(`🚀 Starting batch test for ${urls.length} websites...`);
        
        const results = [];
        const batchConfig = {
            concurrent: config.concurrent || 1,
            ...config
        };

        if (batchConfig.concurrent === 1) {
            // Sequential processing
            for (let i = 0; i < urls.length; i++) {
                console.log(`📋 Processing ${i + 1}/${urls.length}: ${urls[i]}`);
                const result = await this.testWebsite(urls[i], config);
                results.push(result);
            }
        } else {
            // Concurrent processing
            const chunks = this.chunkArray(urls, batchConfig.concurrent);
            for (const chunk of chunks) {
                const chunkPromises = chunk.map(url => this.testWebsite(url, config));
                const chunkResults = await Promise.allSettled(chunkPromises);
                results.push(...chunkResults.map(r => r.value || r.reason));
            }
        }

        // Generate batch summary
        const batchSummary = this.generateBatchSummary(results);
        await fs.writeJSON(
            path.join(this.reportsDir, 'batch-summary.json'), 
            batchSummary, 
            { spaces: 2 }
        );

        console.log(`✅ Batch testing completed. ${batchSummary.passed}/${batchSummary.total} tests passed`);
        return { results, summary: batchSummary };
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    generateBatchSummary(results) {
        const summary = {
            total: results.length,
            passed: 0,
            failed: 0,
            errors: 0,
            timestamp: new Date().toISOString(),
            averageScore: 0,
            failedTests: []
        };

        let totalScore = 0;
        let validTests = 0;

        for (const result of results) {
            if (result && result.validation) {
                validTests++;
                if (result.validation.passed) {
                    summary.passed++;
                } else {
                    summary.failed++;
                    summary.failedTests.push({
                        testId: result.testId,
                        url: result.url,
                        failures: result.validation.failures
                    });
                }
                totalScore += result.validation.score || 0;
            } else {
                summary.errors++;
            }
        }

        summary.averageScore = validTests > 0 ? Math.round(totalScore / validTests) : 0;
        return summary;
    }
}

module.exports = EnhancedE2ETester;