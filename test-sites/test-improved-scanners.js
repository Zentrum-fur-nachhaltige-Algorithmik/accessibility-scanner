#!/usr/bin/env node

/**
 * Test Runner for Improved Phase6a Scanners
 * 
 * Tests the improved scanner implementations against our test cases
 * to validate that the fixes resolve the identified issues
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Import improved scanners
const ImprovedColorContrastScanner = require('../fixes/color-contrast-scanner-improved');
const ImprovedUseOfColorScanner = require('../fixes/use-of-color-scanner-improved');
const ImprovedImagesOfTextScanner = require('../fixes/images-of-text-scanner-improved');

// Configuration
const STATIC_SERVER_PORT = 8084;
const TEST_RESULTS_DIR = path.join(__dirname, 'improved-test-results');

// Create output directory
if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

// Test configuration with expected results for improved scanners
const TEST_CASES = [
    {
        name: 'bad-color-contrast',
        file: 'bad-color-contrast.html',
        description: 'Multiple color contrast violations',
        expected: {
            colorContrast: {
                shouldFail: true,
                minViolations: 5,
                maxViolations: 15, // Should be more targeted than before
                confidence: 'high'
            },
            useOfColor: {
                shouldFail: false, // This file focuses on contrast, not color use
                maxViolations: 2,
                confidence: 'low'
            },
            imagesOfText: {
                shouldFail: false,
                maxViolations: 0,
                confidence: 'none'
            }
        }
    },
    {
        name: 'bad-use-of-color',
        file: 'bad-use-of-color.html',
        description: 'Use of color violations',
        expected: {
            colorContrast: {
                shouldFail: false, // Good contrasts in this file
                maxViolations: 3,
                confidence: 'low'
            },
            useOfColor: {
                shouldFail: true,
                minViolations: 5,
                maxViolations: 10,
                confidence: 'high'
            },
            imagesOfText: {
                shouldFail: false,
                maxViolations: 0,
                confidence: 'none'
            }
        }
    },
    {
        name: 'bad-images-of-text',
        file: 'bad-images-of-text.html',
        description: 'Images of text violations',
        expected: {
            colorContrast: {
                shouldFail: false, // Should not detect contrast issues in text images
                maxViolations: 2,
                confidence: 'low'
            },
            useOfColor: {
                shouldFail: false,
                maxViolations: 1,
                confidence: 'low'
            },
            imagesOfText: {
                shouldFail: true,
                minViolations: 4,
                maxViolations: 8,
                confidence: 'medium'
            }
        }
    },
    {
        name: 'good-accessibility',
        file: 'good-accessibility.html',
        description: 'Good accessibility practices - should pass',
        expected: {
            colorContrast: {
                shouldFail: false, // CRITICAL: This should now pass!
                maxViolations: 1,
                confidence: 'low'
            },
            useOfColor: {
                shouldFail: false, // CRITICAL: This should now pass!
                maxViolations: 1,
                confidence: 'low'
            },
            imagesOfText: {
                shouldFail: false,
                maxViolations: 0,
                confidence: 'none'
            }
        }
    }
];

/**
 * Start HTTP server for test files
 */
function startTestServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Improved Scanner Test Server');
                return;
            }
            
            const filePath = path.join(__dirname, req.url);
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        });
        
        server.listen(STATIC_SERVER_PORT, (err) => {
            if (err) reject(err);
            else {
                console.log(`🌐 Test server running on http://localhost:${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * Test improved color contrast scanner
 */
async function testColorContrastScanner(page, testCase) {
    console.log(`  🎨 Testing Color Contrast Scanner...`);
    
    try {
        // Inject improved scanner
        await page.addScriptTag({
            path: path.join(__dirname, '../fixes/color-contrast-scanner-improved.js')
        });
        
        const results = await page.evaluate(() => {
            const scanner = new ImprovedColorContrastScanner({
                wcagLevel: 'AA',
                debugging: true,
                tolerances: {
                    rounding: 0.1,
                    measurement: 0.05
                }
            });
            
            return scanner.scanColorContrast(document);
        });
        
        const expected = testCase.expected.colorContrast;
        const violations = results.violations || [];
        
        const analysis = {
            passed: !expected.shouldFail ? violations.length <= expected.maxViolations : violations.length >= expected.minViolations,
            violations: violations.length,
            expected: expected,
            details: violations.slice(0, 5).map(v => ({
                element: v.element,
                contrastRatio: v.contrastRatio,
                required: v.requiredRatio,
                confidence: v.confidence
            }))
        };
        
        return {
            scanner: 'colorContrast',
            results: results,
            analysis: analysis,
            summary: {
                totalElements: results.summary?.totalElements || 0,
                checkedElements: results.summary?.checkedElements || 0,
                violations: violations.length,
                passed: analysis.passed
            }
        };
        
    } catch (error) {
        return {
            scanner: 'colorContrast',
            error: error.message,
            analysis: { passed: false }
        };
    }
}

/**
 * Test improved use of color scanner
 */
async function testUseOfColorScanner(page, testCase) {
    console.log(`  🌈 Testing Use of Color Scanner...`);
    
    try {
        await page.addScriptTag({
            path: path.join(__dirname, '../fixes/use-of-color-scanner-improved.js')
        });
        
        const results = await page.evaluate(() => {
            const scanner = new ImprovedUseOfColorScanner({
                sensitivity: 'medium',
                requireMultipleIndicators: true,
                debugging: true
            });
            
            return scanner.scanColorDependency(document);
        });
        
        const expected = testCase.expected.useOfColor;
        const violations = results.violations || [];
        
        const analysis = {
            passed: !expected.shouldFail ? violations.length <= expected.maxViolations : violations.length >= expected.minViolations,
            violations: violations.length,
            expected: expected,
            details: violations.slice(0, 5).map(v => ({
                type: v.type,
                element: v.element,
                issue: v.issue,
                confidence: v.confidence
            }))
        };
        
        return {
            scanner: 'useOfColor',
            results: results,
            analysis: analysis,
            summary: {
                linksChecked: results.summary?.linksChecked || 0,
                statusMessagesChecked: results.summary?.statusMessagesChecked || 0,
                violations: violations.length,
                passed: analysis.passed
            }
        };
        
    } catch (error) {
        return {
            scanner: 'useOfColor',
            error: error.message,
            analysis: { passed: false }
        };
    }
}

/**
 * Test improved images of text scanner
 */
async function testImagesOfTextScanner(page, testCase) {
    console.log(`  🖼️ Testing Images of Text Scanner...`);
    
    try {
        await page.addScriptTag({
            path: path.join(__dirname, '../fixes/images-of-text-scanner-improved.js')
        });
        
        const results = await page.evaluate(() => {
            const scanner = new ImprovedImagesOfTextScanner({
                confidenceThreshold: 60,
                debugging: true
            });
            
            return scanner.scanImagesOfText(document);
        });
        
        const expected = testCase.expected.imagesOfText;
        const violations = results.violations || [];
        
        const analysis = {
            passed: !expected.shouldFail ? violations.length <= expected.maxViolations : violations.length >= expected.minViolations,
            violations: violations.length,
            expected: expected,
            details: violations.slice(0, 5).map(v => ({
                type: v.type,
                element: v.element,
                confidence: v.confidence,
                recommendation: v.recommendation?.action
            }))
        };
        
        return {
            scanner: 'imagesOfText',
            results: results,
            analysis: analysis,
            summary: {
                totalImages: results.summary?.totalImages || 0,
                suspectedTextImages: results.summary?.suspectedTextImages || 0,
                violations: violations.length,
                passed: analysis.passed
            }
        };
        
    } catch (error) {
        return {
            scanner: 'imagesOfText',
            error: error.message,
            analysis: { passed: false }
        };
    }
}

/**
 * Test a single test case
 */
async function testSingleCase(browser, testCase, server) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    console.log(`📄 File: ${testCase.file}`);
    console.log(`📝 Description: ${testCase.description}`);
    
    const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
    const page = await browser.newPage();
    
    try {
        await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Run all three improved scanners
        const colorContrastResult = await testColorContrastScanner(page, testCase);
        const useOfColorResult = await testUseOfColorScanner(page, testCase);
        const imagesOfTextResult = await testImagesOfTextScanner(page, testCase);
        
        const testResult = {
            testCase: testCase.name,
            url: testUrl,
            timestamp: new Date().toISOString(),
            results: {
                colorContrast: colorContrastResult,
                useOfColor: useOfColorResult,
                imagesOfText: imagesOfTextResult
            },
            overall: {
                allPassed: colorContrastResult.analysis.passed && 
                          useOfColorResult.analysis.passed && 
                          imagesOfTextResult.analysis.passed,
                totalViolations: (colorContrastResult.summary?.violations || 0) +
                               (useOfColorResult.summary?.violations || 0) +
                               (imagesOfTextResult.summary?.violations || 0)
            }
        };
        
        // Save detailed results
        const resultPath = path.join(TEST_RESULTS_DIR, `${testCase.name}-result.json`);
        fs.writeFileSync(resultPath, JSON.stringify(testResult, null, 2));
        
        // Print summary
        console.log(`   📊 Results:`);
        console.log(`      Color Contrast: ${colorContrastResult.analysis.passed ? '✅ PASS' : '❌ FAIL'} (${colorContrastResult.summary?.violations || 0} violations)`);
        console.log(`      Use of Color: ${useOfColorResult.analysis.passed ? '✅ PASS' : '❌ FAIL'} (${useOfColorResult.summary?.violations || 0} violations)`);
        console.log(`      Images of Text: ${imagesOfTextResult.analysis.passed ? '✅ PASS' : '❌ FAIL'} (${imagesOfTextResult.summary?.violations || 0} violations)`);
        console.log(`      Overall: ${testResult.overall.allPassed ? '✅ PASS' : '❌ FAIL'}`);
        
        return testResult;
        
    } catch (error) {
        console.log(`   💥 Error: ${error.message}`);
        return {
            testCase: testCase.name,
            error: error.message,
            overall: { allPassed: false }
        };
    } finally {
        await page.close();
    }
}

/**
 * Generate comparison report
 */
function generateComparisonReport(results) {
    const reportPath = path.join(TEST_RESULTS_DIR, 'improvement-comparison.html');
    
    const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Phase6a Scanner Improvement Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .test-case { margin: 30px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .pass { background-color: #e8f5e8; border-color: #4caf50; }
        .fail { background-color: #ffebee; border-color: #f44336; }
        .improvement { background-color: #e3f2fd; border-color: #2196f3; }
        .scanner-result { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 4px; }
        .violation-count { font-weight: bold; color: #d32f2f; }
        .pass-count { font-weight: bold; color: #388e3c; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f5f5f5; }
        .improvement-highlight { background-color: #c8e6c9; }
    </style>
</head>
<body>
    <h1>🚀 Phase6a Scanner Improvement Results</h1>
    <p><strong>Test Date:</strong> ${new Date().toLocaleString()}</p>
    
    <h2>📊 Summary</h2>
    <table>
        <thead>
            <tr>
                <th>Test Case</th>
                <th>Color Contrast</th>
                <th>Use of Color</th>
                <th>Images of Text</th>
                <th>Overall Result</th>
                <th>Key Improvement</th>
            </tr>
        </thead>
        <tbody>
            ${results.map(result => `
                <tr class="${result.overall.allPassed ? '' : 'fail'}">
                    <td><strong>${result.testCase}</strong></td>
                    <td>${result.results.colorContrast.analysis.passed ? '✅ PASS' : '❌ FAIL'} 
                        (${result.results.colorContrast.summary?.violations || 0})</td>
                    <td>${result.results.useOfColor.analysis.passed ? '✅ PASS' : '❌ FAIL'} 
                        (${result.results.useOfColor.summary?.violations || 0})</td>
                    <td>${result.results.imagesOfText.analysis.passed ? '✅ PASS' : '❌ FAIL'} 
                        (${result.results.imagesOfText.summary?.violations || 0})</td>
                    <td class="${result.overall.allPassed ? 'pass-count' : 'violation-count'}">
                        ${result.overall.allPassed ? 'PASS' : 'FAIL'}
                    </td>
                    <td>${getKeyImprovement(result)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <h2>📋 Detailed Results</h2>
    ${results.map(result => `
        <div class="test-case ${result.overall.allPassed ? 'pass' : 'fail'}">
            <h3>${result.testCase}</h3>
            <p><strong>URL:</strong> ${result.url}</p>
            
            <div class="scanner-result">
                <h4>🎨 Color Contrast Scanner</h4>
                <p><strong>Result:</strong> ${result.results.colorContrast.analysis.passed ? '✅ PASS' : '❌ FAIL'}</p>
                <p><strong>Violations:</strong> ${result.results.colorContrast.summary?.violations || 0}</p>
                <p><strong>Elements Checked:</strong> ${result.results.colorContrast.summary?.checkedElements || 0}</p>
                ${result.results.colorContrast.analysis.details ? `
                    <details>
                        <summary>Violation Details</summary>
                        <ul>
                            ${result.results.colorContrast.analysis.details.map(v => `
                                <li>${v.element}: ${v.contrastRatio}:1 (required: ${v.required}:1) - ${v.confidence} confidence</li>
                            `).join('')}
                        </ul>
                    </details>
                ` : ''}
            </div>
            
            <div class="scanner-result">
                <h4>🌈 Use of Color Scanner</h4>
                <p><strong>Result:</strong> ${result.results.useOfColor.analysis.passed ? '✅ PASS' : '❌ FAIL'}</p>
                <p><strong>Violations:</strong> ${result.results.useOfColor.summary?.violations || 0}</p>
                <p><strong>Links Checked:</strong> ${result.results.useOfColor.summary?.linksChecked || 0}</p>
                ${result.results.useOfColor.analysis.details ? `
                    <details>
                        <summary>Violation Details</summary>
                        <ul>
                            ${result.results.useOfColor.analysis.details.map(v => `
                                <li>${v.type}: ${v.element} - ${v.issue} (${v.confidence} confidence)</li>
                            `).join('')}
                        </ul>
                    </details>
                ` : ''}
            </div>
            
            <div class="scanner-result">
                <h4>🖼️ Images of Text Scanner</h4>
                <p><strong>Result:</strong> ${result.results.imagesOfText.analysis.passed ? '✅ PASS' : '❌ FAIL'}</p>
                <p><strong>Violations:</strong> ${result.results.imagesOfText.summary?.violations || 0}</p>
                <p><strong>Images Checked:</strong> ${result.results.imagesOfText.summary?.totalImages || 0}</p>
                ${result.results.imagesOfText.analysis.details ? `
                    <details>
                        <summary>Violation Details</summary>
                        <ul>
                            ${result.results.imagesOfText.analysis.details.map(v => `
                                <li>${v.type}: ${v.element} - ${v.confidence}% confidence (${v.recommendation})</li>
                            `).join('')}
                        </ul>
                    </details>
                ` : ''}
            </div>
        </div>
    `).join('')}
    
    <h2>🎯 Key Improvements Made</h2>
    <ul>
        <li><strong>Background Color Inheritance:</strong> Fixed alpha blending and proper color inheritance</li>
        <li><strong>Element Filtering:</strong> Added comprehensive filtering for hidden and irrelevant elements</li>
        <li><strong>Link Detection:</strong> Improved detection of multiple visual indicators beyond color</li>
        <li><strong>Status Messages:</strong> Better recognition of text and icon indicators</li>
        <li><strong>Image Text Detection:</strong> Raised confidence thresholds and improved context analysis</li>
        <li><strong>Configuration System:</strong> Made thresholds and sensitivity configurable</li>
    </ul>
    
    <h2>🏆 Success Criteria</h2>
    <p><strong>Target:</strong> good-accessibility.html should pass all scanners</p>
    <p><strong>Actual:</strong> ${getGoodAccessibilityResult(results)}</p>
    
    <h2>📈 Next Steps</h2>
    <ol>
        <li>Deploy improved scanners to production API</li>
        <li>Update Phase6a integration layer</li>
        <li>Run comprehensive regression testing</li>
        <li>Monitor false positive rates in production</li>
    </ol>
</body>
</html>`;
    
    fs.writeFileSync(reportPath, html);
    console.log(`\n📋 Detailed report saved: ${reportPath}`);
    
    function getKeyImprovement(result) {
        if (result.testCase === 'good-accessibility' && result.overall.allPassed) {
            return '🎉 Now correctly passes!';
        } else if (result.overall.totalViolations < 10) {
            return 'Reduced false positives';
        } else {
            return 'Still needs work';
        }
    }
    
    function getGoodAccessibilityResult(results) {
        const goodResult = results.find(r => r.testCase === 'good-accessibility');
        return goodResult?.overall.allPassed ? '✅ SUCCESS - All scanners pass!' : '❌ Still failing';
    }
}

/**
 * Main test function
 */
async function main() {
    console.log('🚀 Testing Improved Phase6a Scanners...\n');
    
    let server, browser;
    const results = [];
    
    try {
        // Start server
        server = await startTestServer();
        
        // Start browser
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        // Test each case
        for (const testCase of TEST_CASES) {
            const result = await testSingleCase(browser, testCase, server);
            results.push(result);
            
            // Pause between tests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Generate reports
        generateComparisonReport(results);
        
        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 IMPROVED SCANNER TEST SUMMARY');
        console.log('='.repeat(70));
        
        const passCount = results.filter(r => r.overall.allPassed).length;
        const totalCount = results.length;
        const successRate = Math.round((passCount / totalCount) * 100);
        
        console.log(`\n📈 Results: ${passCount}/${totalCount} tests passed (${successRate}%)`);
        
        // Critical test check
        const goodAccessibilityResult = results.find(r => r.testCase === 'good-accessibility');
        if (goodAccessibilityResult?.overall.allPassed) {
            console.log('🎉 CRITICAL SUCCESS: good-accessibility.html now passes all scanners!');
        } else {
            console.log('⚠️  CRITICAL ISSUE: good-accessibility.html still failing');
        }
        
        console.log(`\n📋 Detailed results saved in: ${TEST_RESULTS_DIR}`);
        
        // Exit code
        process.exit(successRate >= 75 ? 0 : 1);
        
    } catch (error) {
        console.error('💥 Test failed:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
        if (server) server.close();
    }
}

if (require.main === module) {
    main();
}