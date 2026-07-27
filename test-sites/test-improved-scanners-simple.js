#!/usr/bin/env node

/**
 * Simplified Test Runner for Improved Phase6a Scanners
 * 
 * Tests the improved scanner implementations by injecting them into browser context
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const STATIC_SERVER_PORT = 8085;
const TEST_RESULTS_DIR = path.join(__dirname, 'improved-test-results');

// Create output directory
if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

// Test cases with expected improvements
const TEST_CASES = [
    {
        name: 'bad-color-contrast',
        file: 'bad-color-contrast.html',
        description: 'Color contrast violations - should detect but be more accurate'
    },
    {
        name: 'bad-use-of-color',
        file: 'bad-use-of-color.html', 
        description: 'Use of color violations - should detect color-only patterns'
    },
    {
        name: 'bad-images-of-text',
        file: 'bad-images-of-text.html',
        description: 'Images of text violations - should detect with higher confidence'
    },
    {
        name: 'good-accessibility',
        file: 'good-accessibility.html',
        description: 'CRITICAL: Should pass with minimal violations'
    }
];

/**
 * Start HTTP server
 */
function startTestServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Improved Scanner Test Server');
                return;
            }
            
            const filePath = path.join(__dirname, req.url);
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        });
        
        server.listen(STATIC_SERVER_PORT, (err) => {
            if (err) reject(err);
            else {
                console.log(`🌐 Test server running on port ${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * Test improved scanners on a single page
 */
async function testImprovedScanners(page, testCase) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    
    const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
    
    try {
        await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Inject improved scanner code directly into page
        const colorContrastCode = fs.readFileSync(path.join(__dirname, '../fixes/color-contrast-scanner-improved.js'), 'utf8');
        const useOfColorCode = fs.readFileSync(path.join(__dirname, '../fixes/use-of-color-scanner-improved.js'), 'utf8');
        const imagesOfTextCode = fs.readFileSync(path.join(__dirname, '../fixes/images-of-text-scanner-improved.js'), 'utf8');
        
        // Execute scanners in browser context
        const results = await page.evaluate((colorCode, colorUseCode, imageCode) => {
            try {
                // Execute scanner code to define classes
                eval(colorCode.replace('module.exports = ImprovedColorContrastScanner;', ''));
                eval(colorUseCode.replace('module.exports = ImprovedUseOfColorScanner;', ''));
                eval(imageCode.replace('module.exports = ImprovedImagesOfTextScanner;', ''));
                
                const results = {};
                
                // Test Color Contrast Scanner
                try {
                    const colorScanner = new ImprovedColorContrastScanner({
                        wcagLevel: 'AA',
                        debugging: false
                    });
                    
                    // Manual scanning since we can't use the async page method
                    const violations = [];
                    const allElements = document.querySelectorAll('*');
                    let checkedCount = 0;
                    
                    allElements.forEach(element => {
                        if (!element.textContent.trim()) return;
                        if (!colorScanner.isRelevantTextElement(element)) return;
                        
                        checkedCount++;
                        
                        const style = window.getComputedStyle(element);
                        const foregroundColor = colorScanner.parseColor(style.color);
                        
                        if (!foregroundColor) return;
                        
                        const backgroundAnalysis = colorScanner.getEffectiveBackgroundColor(element);
                        const backgroundColor = backgroundAnalysis.color;
                        
                        const contrastRatio = colorScanner.calculateContrastRatio(foregroundColor, backgroundColor);
                        const isLarge = colorScanner.isLargeText(element);
                        const requiredRatio = isLarge ? 3.0 : 4.5;
                        
                        if (contrastRatio < requiredRatio) {
                            violations.push({
                                element: colorScanner.getElementSelector(element),
                                contrastRatio: contrastRatio,
                                requiredRatio: requiredRatio,
                                isLargeText: isLarge,
                                textContent: element.textContent.trim().substring(0, 50)
                            });
                        }
                    });
                    
                    results.colorContrast = {
                        violations: violations,
                        totalElements: allElements.length,
                        checkedElements: checkedCount,
                        passed: violations.length === 0
                    };
                } catch (error) {
                    results.colorContrast = { error: error.message };
                }
                
                // Test Use of Color Scanner
                try {
                    const colorUseScanner = new ImprovedUseOfColorScanner({
                        sensitivity: 'medium'
                    });
                    
                    const violations = [];
                    
                    // Check links
                    document.querySelectorAll('a[href]').forEach(link => {
                        if (colorUseScanner.isRelevantElement(link)) {
                            const analysis = colorUseScanner.analyzeLinkDifferentiation(link);
                            if (analysis.isViolation) {
                                violations.push({
                                    type: 'link-color-only',
                                    element: colorUseScanner.getElementSelector(link),
                                    confidence: analysis.confidence,
                                    reasoning: analysis.reasoning
                                });
                            }
                        }
                    });
                    
                    // Check status messages
                    const statusSelectors = '[class*="status"], [class*="alert"], [role="alert"], .error, .warning, .success';
                    document.querySelectorAll(statusSelectors).forEach(element => {
                        if (colorUseScanner.isRelevantElement(element)) {
                            const analysis = colorUseScanner.analyzeStatusMessage(element);
                            if (analysis.isViolation) {
                                violations.push({
                                    type: 'status-color-only',
                                    element: colorUseScanner.getElementSelector(element),
                                    confidence: analysis.confidence,
                                    reasoning: analysis.reasoning
                                });
                            }
                        }
                    });
                    
                    results.useOfColor = {
                        violations: violations,
                        passed: violations.length === 0
                    };
                } catch (error) {
                    results.useOfColor = { error: error.message };
                }
                
                // Test Images of Text Scanner  
                try {
                    const imageScanner = new ImprovedImagesOfTextScanner({
                        confidenceThreshold: 60
                    });
                    
                    const violations = [];
                    
                    // Check IMG elements
                    document.querySelectorAll('img').forEach(img => {
                        if (imageScanner.isRelevantElement(img)) {
                            const analysis = imageScanner.analyzeImage(img);
                            if (analysis.confidence.isViolation) {
                                violations.push({
                                    type: 'image-of-text',
                                    element: imageScanner.getElementSelector(img),
                                    confidence: analysis.confidence.confidence,
                                    reasoning: analysis.confidence.reasoning
                                });
                            }
                        }
                    });
                    
                    // Check background images
                    document.querySelectorAll('*').forEach(element => {
                        const style = window.getComputedStyle(element);
                        if (style.backgroundImage && style.backgroundImage !== 'none') {
                            if (imageScanner.isRelevantElement(element)) {
                                const analysis = imageScanner.analyzeBackgroundImage(element);
                                if (analysis && analysis.confidence.isViolation) {
                                    violations.push({
                                        type: 'background-image-of-text',
                                        element: imageScanner.getElementSelector(element),
                                        confidence: analysis.confidence.confidence,
                                        reasoning: analysis.confidence.reasoning
                                    });
                                }
                            }
                        }
                    });
                    
                    results.imagesOfText = {
                        violations: violations,
                        totalImages: document.querySelectorAll('img').length,
                        passed: violations.length === 0
                    };
                } catch (error) {
                    results.imagesOfText = { error: error.message };
                }
                
                return results;
                
            } catch (error) {
                return { error: 'Failed to execute scanner code: ' + error.message };
            }
        }, colorContrastCode, useOfColorCode, imagesOfTextCode);
        
        // Calculate overall result
        const totalViolations = (results.colorContrast?.violations?.length || 0) +
                               (results.useOfColor?.violations?.length || 0) +
                               (results.imagesOfText?.violations?.length || 0);
        
        const allPassed = results.colorContrast?.passed && 
                         results.useOfColor?.passed && 
                         results.imagesOfText?.passed;
        
        const testResult = {
            testCase: testCase.name,
            url: testUrl,
            timestamp: new Date().toISOString(),
            results: results,
            summary: {
                allPassed: allPassed,
                totalViolations: totalViolations,
                colorContrastViolations: results.colorContrast?.violations?.length || 0,
                useOfColorViolations: results.useOfColor?.violations?.length || 0,
                imagesOfTextViolations: results.imagesOfText?.violations?.length || 0
            }
        };
        
        // Print summary
        console.log(`   📊 Results:`);
        console.log(`      Color Contrast: ${results.colorContrast?.passed ? '✅ PASS' : '❌ FAIL'} (${results.colorContrast?.violations?.length || 0} violations)`);
        console.log(`      Use of Color: ${results.useOfColor?.passed ? '✅ PASS' : '❌ FAIL'} (${results.useOfColor?.violations?.length || 0} violations)`);
        console.log(`      Images of Text: ${results.imagesOfText?.passed ? '✅ PASS' : '❌ FAIL'} (${results.imagesOfText?.violations?.length || 0} violations)`);
        console.log(`      Overall: ${allPassed ? '✅ PASS' : '❌ FAIL'} (${totalViolations} total violations)`);
        
        // Save results
        const resultPath = path.join(TEST_RESULTS_DIR, `${testCase.name}-improved.json`);
        fs.writeFileSync(resultPath, JSON.stringify(testResult, null, 2));
        
        return testResult;
        
    } catch (error) {
        console.log(`   💥 Error: ${error.message}`);
        return {
            testCase: testCase.name,
            error: error.message,
            summary: { allPassed: false, totalViolations: -1 }
        };
    }
}

/**
 * Main test function
 */
async function main() {
    console.log('🚀 Testing Improved Phase6a Scanners (Simplified)...\n');
    
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
        
        const page = await browser.newPage();
        
        // Test each case
        for (const testCase of TEST_CASES) {
            const result = await testImprovedScanners(page, testCase);
            results.push(result);
            
            // Pause between tests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        await page.close();
        
        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 IMPROVED SCANNER TEST SUMMARY');
        console.log('='.repeat(70));
        
        const passCount = results.filter(r => r.summary?.allPassed).length;
        const totalCount = results.length;
        const successRate = Math.round((passCount / totalCount) * 100);
        
        console.log(`\n📈 Overall Results: ${passCount}/${totalCount} tests passed (${successRate}%)`);
        
        results.forEach(result => {
            if (result.summary) {
                console.log(`\n📄 ${result.testCase}:`);
                console.log(`   Overall: ${result.summary.allPassed ? '✅ PASS' : '❌ FAIL'}`);
                console.log(`   Total Violations: ${result.summary.totalViolations}`);
                console.log(`   Color Contrast: ${result.summary.colorContrastViolations}`);
                console.log(`   Use of Color: ${result.summary.useOfColorViolations}`);
                console.log(`   Images of Text: ${result.summary.imagesOfTextViolations}`);
            }
        });
        
        // Critical test check
        const goodAccessibilityResult = results.find(r => r.testCase === 'good-accessibility');
        if (goodAccessibilityResult?.summary?.allPassed) {
            console.log('\n🎉 CRITICAL SUCCESS: good-accessibility.html now passes all scanners!');
        } else if (goodAccessibilityResult) {
            console.log(`\n⚠️  CRITICAL ISSUE: good-accessibility.html still has ${goodAccessibilityResult.summary?.totalViolations || 'unknown'} violations`);
            console.log(`   - Color Contrast: ${goodAccessibilityResult.summary?.colorContrastViolations || 0}`);
            console.log(`   - Use of Color: ${goodAccessibilityResult.summary?.useOfColorViolations || 0}`);
            console.log(`   - Images of Text: ${goodAccessibilityResult.summary?.imagesOfTextViolations || 0}`);
        }
        
        console.log(`\n📋 Detailed results saved in: ${TEST_RESULTS_DIR}`);
        
        // Evaluation
        if (successRate >= 75) {
            console.log('\n✅ IMPROVEMENT SUCCESS: Scanners show significant improvement!');
        } else {
            console.log('\n⚠️  IMPROVEMENT NEEDED: Scanners still need more work');
        }
        
        console.log('\n🎯 Key Improvements Expected:');
        console.log('   - Reduced false positives in good-accessibility.html');
        console.log('   - More accurate violation detection');
        console.log('   - Better element filtering');
        console.log('   - Improved confidence scoring');
        
        // Exit code
        process.exit(successRate >= 50 ? 0 : 1);
        
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