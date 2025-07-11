const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class EndToEndTester {
    constructor(options = {}) {
        this.options = {
            headless: true,
            timeout: 30000,
            screenshotPath: './test-results/screenshots',
            reportsPath: './test-results/reports',
            failedTestsPath: './test-results/failed-tests',
            ...options
        };
        
        this.browser = null;
        this.page = null;
        this.testResults = {};
        this.failedTests = [];
    }

    async initialize() {
        await fs.ensureDir(this.options.screenshotPath);
        await fs.ensureDir(this.options.reportsPath);
        await fs.ensureDir(this.options.failedTestsPath);
        
        this.browser = await puppeteer.launch({
            headless: this.options.headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1920, height: 1080 });
    }

    async generateWebsiteReport(url) {
        const reportId = uuidv4();
        const report = {
            id: reportId,
            url: url,
            timestamp: new Date().toISOString(),
            accessibility: await this.runAccessibilityTests(url),
            html: await this.fetchAndInspectHTML(url),
            screenshots: await this.captureScreenshots(url, reportId),
            validationResults: []
        };

        const reportPath = path.join(this.options.reportsPath, `${reportId}.json`);
        await fs.writeJSON(reportPath, report, { spaces: 2 });
        
        return report;
    }

    async runAccessibilityTests(url) {
        try {
            await this.page.goto(url, { waitUntil: 'networkidle0', timeout: this.options.timeout });
            
            const axeResults = await this.page.evaluate(async () => {
                if (typeof window.axe === 'undefined') {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js';
                    document.head.appendChild(script);
                    
                    return new Promise((resolve) => {
                        script.onload = async () => {
                            const results = await window.axe.run();
                            resolve(results);
                        };
                    });
                } else {
                    return await window.axe.run();
                }
            });

            const customTests = await this.runCustomAccessibilityTests();
            
            return {
                axe: axeResults,
                custom: customTests,
                summary: {
                    violations: axeResults.violations.length,
                    passes: axeResults.passes.length,
                    incomplete: axeResults.incomplete.length
                }
            };
            
        } catch (error) {
            throw new Error(`Accessibility test failed: ${error.message}`);
        }
    }

    async runCustomAccessibilityTests() {
        const tests = [];
        
        const colorContrastTest = await this.page.evaluate(() => {
            const elements = document.querySelectorAll('*');
            const issues = [];
            
            elements.forEach(el => {
                const styles = window.getComputedStyle(el);
                const color = styles.color;
                const backgroundColor = styles.backgroundColor;
                
                if (color !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'rgba(0, 0, 0, 0)') {
                    issues.push({
                        element: el.tagName,
                        color: color,
                        backgroundColor: backgroundColor,
                        text: el.textContent?.substring(0, 50)
                    });
                }
            });
            
            return { testName: 'colorContrast', issues: issues.slice(0, 10) };
        });
        
        tests.push(colorContrastTest);
        
        const keyboardNavigationTest = await this.testKeyboardNavigation();
        tests.push(keyboardNavigationTest);
        
        const screenReaderTest = await this.testScreenReaderCompatibility();
        tests.push(screenReaderTest);
        
        return tests;
    }

    async testKeyboardNavigation() {
        const focusableElements = await this.page.evaluate(() => {
            const focusable = document.querySelectorAll(
                'a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])'
            );
            return Array.from(focusable).map(el => ({
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                tabIndex: el.tabIndex
            }));
        });

        const keyboardTestResults = [];
        let focusedElementsCount = 0;

        for (let i = 0; i < Math.min(focusableElements.length, 10); i++) {
            await this.page.keyboard.press('Tab');
            
            const activeElement = await this.page.evaluate(() => {
                const active = document.activeElement;
                return {
                    tagName: active.tagName,
                    id: active.id,
                    className: active.className,
                    hasFocus: document.activeElement === active
                };
            });
            
            if (activeElement.hasFocus) {
                focusedElementsCount++;
            }
            
            keyboardTestResults.push(activeElement);
        }

        return {
            testName: 'keyboardNavigation',
            totalFocusable: focusableElements.length,
            successfullyFocused: focusedElementsCount,
            success: focusedElementsCount > 0,
            details: keyboardTestResults
        };
    }

    async testScreenReaderCompatibility() {
        const ariaLabels = await this.page.evaluate(() => {
            const elements = document.querySelectorAll('[aria-label], [aria-labelledby], [aria-describedby]');
            return Array.from(elements).map(el => ({
                tagName: el.tagName,
                ariaLabel: el.getAttribute('aria-label'),
                ariaLabelledby: el.getAttribute('aria-labelledby'),
                ariaDescribedby: el.getAttribute('aria-describedby'),
                role: el.getAttribute('role')
            }));
        });

        const headingStructure = await this.page.evaluate(() => {
            const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
            return Array.from(headings).map(h => ({
                level: parseInt(h.tagName.substring(1)),
                text: h.textContent?.substring(0, 100)
            }));
        });

        return {
            testName: 'screenReaderCompatibility',
            ariaElementsCount: ariaLabels.length,
            headingStructure: headingStructure,
            hasProperHeadingStructure: headingStructure.length > 0 && headingStructure[0]?.level === 1
        };
    }

    async fetchAndInspectHTML(url) {
        try {
            await this.page.goto(url, { waitUntil: 'networkidle0' });
            
            const htmlContent = await this.page.content();
            const htmlAnalysis = await this.analyzeHTML(htmlContent);
            
            return {
                content: htmlContent,
                analysis: htmlAnalysis,
                size: Buffer.byteLength(htmlContent, 'utf8')
            };
            
        } catch (error) {
            throw new Error(`HTML fetch failed: ${error.message}`);
        }
    }

    async analyzeHTML(htmlContent) {
        const analysis = {
            hasDoctype: htmlContent.includes('<!DOCTYPE'),
            hasLangAttribute: htmlContent.includes('<html lang='),
            hasViewportMeta: htmlContent.includes('viewport'),
            hasTitle: htmlContent.includes('<title>'),
            imageCount: (htmlContent.match(/<img/g) || []).length,
            linkCount: (htmlContent.match(/<a/g) || []).length,
            formCount: (htmlContent.match(/<form/g) || []).length,
            headingCount: (htmlContent.match(/<h[1-6]/g) || []).length
        };

        analysis.htmlValidityScore = Object.values(analysis).filter(v => v === true).length / Object.keys(analysis).filter(k => typeof analysis[k] === 'boolean').length;
        
        return analysis;
    }

    async captureScreenshots(url, reportId) {
        const screenshots = {};
        
        try {
            await this.page.goto(url, { waitUntil: 'networkidle0' });
            
            const fullPagePath = path.join(this.options.screenshotPath, `${reportId}-full-page.png`);
            await this.page.screenshot({ 
                path: fullPagePath, 
                fullPage: true 
            });
            screenshots.fullPage = fullPagePath;
            
            const viewportPath = path.join(this.options.screenshotPath, `${reportId}-viewport.png`);
            await this.page.screenshot({ 
                path: viewportPath 
            });
            screenshots.viewport = viewportPath;
            
            await this.page.emulate(puppeteer.devices['iPhone X']);
            const mobilePath = path.join(this.options.screenshotPath, `${reportId}-mobile.png`);
            await this.page.screenshot({ 
                path: mobilePath 
            });
            screenshots.mobile = mobilePath;
            
            await this.page.setViewport({ width: 1920, height: 1080 });
            
        } catch (error) {
            console.error(`Screenshot capture failed: ${error.message}`);
        }
        
        return screenshots;
    }

    async validateTest(testResult, expectedCriteria) {
        const validation = {
            testId: testResult.id || uuidv4(),
            testName: testResult.testName || 'Unknown Test',
            passed: true,
            issues: [],
            timestamp: new Date().toISOString()
        };

        if (expectedCriteria.minAccessibilityScore && 
            testResult.accessibility?.summary?.violations > expectedCriteria.maxViolations) {
            validation.passed = false;
            validation.issues.push({
                type: 'accessibility_violations',
                count: testResult.accessibility.summary.violations,
                expected: `<= ${expectedCriteria.maxViolations}`
            });
        }

        if (expectedCriteria.requiredHTMLElements) {
            for (const element of expectedCriteria.requiredHTMLElements) {
                if (!testResult.html?.analysis?.[element]) {
                    validation.passed = false;
                    validation.issues.push({
                        type: 'missing_html_element',
                        element: element
                    });
                }
            }
        }

        if (expectedCriteria.keyboardNavigation && 
            !testResult.accessibility?.custom?.find(t => t.testName === 'keyboardNavigation')?.success) {
            validation.passed = false;
            validation.issues.push({
                type: 'keyboard_navigation_failed'
            });
        }

        if (!validation.passed) {
            this.failedTests.push(validation);
            await this.isolateFailedTest(validation, testResult);
        }

        return validation;
    }

    async isolateFailedTest(validation, testResult) {
        const failedTestDir = path.join(this.options.failedTestsPath, validation.testId);
        await fs.ensureDir(failedTestDir);
        
        const failureReport = {
            validation: validation,
            testResult: testResult,
            isolatedAt: new Date().toISOString(),
            debugInfo: {
                url: testResult.url,
                userAgent: await this.page.evaluate(() => navigator.userAgent),
                viewport: await this.page.viewport()
            }
        };
        
        await fs.writeJSON(
            path.join(failedTestDir, 'failure-report.json'), 
            failureReport, 
            { spaces: 2 }
        );
        
        if (testResult.screenshots) {
            for (const [type, screenshotPath] of Object.entries(testResult.screenshots)) {
                if (await fs.pathExists(screenshotPath)) {
                    await fs.copy(
                        screenshotPath, 
                        path.join(failedTestDir, `${type}.png`)
                    );
                }
            }
        }
        
        console.log(`Failed test isolated: ${failedTestDir}`);
    }

    async runEndToEndTest(url, expectedCriteria = {}) {
        if (!this.browser) {
            await this.initialize();
        }

        const defaultCriteria = {
            maxViolations: 0,
            requiredHTMLElements: ['hasDoctype', 'hasLangAttribute', 'hasTitle'],
            keyboardNavigation: true,
            minHtmlValidityScore: 0.8
        };

        const criteria = { ...defaultCriteria, ...expectedCriteria };
        
        try {
            const report = await this.generateWebsiteReport(url);
            const validation = await this.validateTest(report, criteria);
            
            return {
                report: report,
                validation: validation,
                success: validation.passed
            };
            
        } catch (error) {
            const errorValidation = {
                testId: uuidv4(),
                testName: 'E2E Test Execution',
                passed: false,
                issues: [{ type: 'execution_error', message: error.message }],
                timestamp: new Date().toISOString()
            };
            
            this.failedTests.push(errorValidation);
            
            return {
                report: null,
                validation: errorValidation,
                success: false,
                error: error.message
            };
        }
    }

    async getFailedTestsSummary() {
        return {
            totalFailed: this.failedTests.length,
            failureTypes: this.failedTests.reduce((acc, test) => {
                test.issues.forEach(issue => {
                    acc[issue.type] = (acc[issue.type] || 0) + 1;
                });
                return acc;
            }, {}),
            failedTests: this.failedTests
        };
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

module.exports = EndToEndTester;