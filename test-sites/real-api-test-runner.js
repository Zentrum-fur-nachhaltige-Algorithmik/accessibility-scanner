#!/usr/bin/env node

/**
 * Real API Test Runner für Phase6a Accessibility Scanner
 * 
 * Testet die echte Phase6a API gegen erstellte HTML Test-Websites
 * ohne Mocking - verwendet tatsächliche HTTP-Requests an localhost:3000
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Konfiguration
const API_BASE_URL = 'http://localhost:3000';
const TEST_HTML_DIR = __dirname;
const STATIC_SERVER_PORT = 8081;

// Test-Konfiguration
const TEST_SITES = {
    bad: [
        {
            name: 'Color Contrast Violations',
            file: 'bad-color-contrast.html',
            expectedPhase6aFail: true,
            expectedViolations: {
                colorContrast: true,
                useOfColor: false,
                imagesOfText: false
            }
        },
        {
            name: 'Use of Color Violations', 
            file: 'bad-use-of-color.html',
            expectedPhase6aFail: true,
            expectedViolations: {
                colorContrast: false,
                useOfColor: true,
                imagesOfText: false
            }
        },
        {
            name: 'Images of Text Violations',
            file: 'bad-images-of-text.html',
            expectedPhase6aFail: true,
            expectedViolations: {
                colorContrast: false,
                useOfColor: false,
                imagesOfText: true
            }
        }
    ],
    good: [
        {
            name: 'Good Accessibility Practices',
            file: 'good-accessibility.html',
            expectedPhase6aFail: false,
            expectedViolations: {
                colorContrast: false,
                useOfColor: false,
                imagesOfText: false
            }
        }
    ]
};

/**
 * Startet einen einfachen HTTP-Server um HTML-Dateien zu servieren
 */
function startStaticServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            // CORS Headers hinzufügen
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            let filePath = path.join(TEST_HTML_DIR, req.url.substring(1));
            
            // Fallback auf index für root
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Test HTML Server Running');
                return;
            }
            
            // Datei existiert prüfen
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
                return;
            }
            
            // HTML-Datei servieren
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        });
        
        server.listen(STATIC_SERVER_PORT, (err) => {
            if (err) {
                reject(err);
            } else {
                console.log(`📡 Static HTML server running on http://localhost:${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * HTTP Request Helper
 */
function makeHttpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        
        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        data: data,
                        parseError: error.message
                    });
                }
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.end();
    });
}

/**
 * Phase6a API Health Check
 */
async function checkAPIHealth() {
    try {
        console.log('🔍 Checking Phase6a API health...');
        const response = await makeHttpRequest(`${API_BASE_URL}/api/health`);
        
        if (response.statusCode === 200) {
            console.log('✅ Phase6a API is running and healthy');
            return true;
        } else {
            console.log(`❌ API health check failed: ${response.statusCode}`);
            return false;
        }
    } catch (error) {
        console.log(`💥 API health check error: ${error.message}`);
        return false;
    }
}

/**
 * Führt Enhanced Scan mit Phase6a durch
 */
async function runPhase6aScan(testUrl, testCase) {
    console.log(`\n🔍 Testing: ${testCase.name}`);
    console.log(`   URL: ${testUrl}`);
    
    const startTime = Date.now();
    
    try {
        const response = await makeHttpRequest(`${API_BASE_URL}/api/enhanced-scan`, {
            method: 'POST',
            body: {
                url: testUrl,
                options: {
                    wcagLevel: 'AA',
                    includePhase6A: true,
                    includeWarnings: true,
                    timeout: 30000
                }
            }
        });
        
        const scanTime = Date.now() - startTime;
        
        if (response.statusCode !== 200) {
            throw new Error(`API returned status ${response.statusCode}: ${JSON.stringify(response.data)}`);
        }
        
        const result = response.data;
        
        console.log(`   ⏱️  Scan completed in ${scanTime}ms`);
        console.log(`   📊 Overall Score: ${result.overallScore}`);
        
        if (result.phase6ACompliance) {
            console.log(`   🎯 Phase6a Results:`);
            console.log(`      Color Contrast: ${result.phase6ACompliance.colorContrast.passed ? '✅ PASS' : '❌ FAIL'} (${result.phase6ACompliance.colorContrast.violations?.length || 0} violations)`);
            console.log(`      Use of Color: ${result.phase6ACompliance.useOfColor.passed ? '✅ PASS' : '❌ FAIL'} (${result.phase6ACompliance.useOfColor.violations?.length || 0} violations)`);
            console.log(`      Images of Text: ${result.phase6ACompliance.imagesOfText.passed ? '✅ PASS' : '❌ FAIL'} (${result.phase6ACompliance.imagesOfText.violations?.length || 0} violations)`);
            console.log(`      Phase6a Score: ${result.phase6AScore}%`);
        }
        
        return {
            success: true,
            result: result,
            scanTime: scanTime,
            testCase: testCase
        };
        
    } catch (error) {
        console.log(`   💥 Scan failed: ${error.message}`);
        return {
            success: false,
            error: error.message,
            scanTime: Date.now() - startTime,
            testCase: testCase
        };
    }
}

/**
 * Validiert Scanner-Ergebnisse gegen erwartete Werte
 */
function validatePhase6aResults(scanResult, testCase) {
    const issues = [];
    const result = scanResult.result;
    
    if (!result.phase6ACompliance) {
        issues.push('Phase6a compliance data missing from API response');
        return {
            passed: false,
            issues: issues,
            testCase: testCase.name
        };
    }
    
    const phase6a = result.phase6ACompliance;
    
    // Expected Overall Failure/Pass validieren
    const overallShouldFail = testCase.expectedPhase6aFail;
    const overallPassed = result.phase6AScore >= 90; // Annahme: >90% = Pass
    
    if (overallShouldFail && overallPassed) {
        issues.push(`Expected Phase6a to FAIL but got ${result.phase6AScore}% (PASS)`);
    } else if (!overallShouldFail && !overallPassed) {
        issues.push(`Expected Phase6a to PASS but got ${result.phase6AScore}% (FAIL)`);
    }
    
    // Spezifische Violations validieren
    if (testCase.expectedViolations.colorContrast && phase6a.colorContrast.passed) {
        issues.push('Expected Color Contrast violations but scanner found none');
    } else if (!testCase.expectedViolations.colorContrast && !phase6a.colorContrast.passed) {
        issues.push(`Unexpected Color Contrast violations: ${phase6a.colorContrast.violations?.length || 0}`);
    }
    
    if (testCase.expectedViolations.useOfColor && phase6a.useOfColor.passed) {
        issues.push('Expected Use of Color violations but scanner found none');
    } else if (!testCase.expectedViolations.useOfColor && !phase6a.useOfColor.passed) {
        issues.push(`Unexpected Use of Color violations: ${phase6a.useOfColor.violations?.length || 0}`);
    }
    
    if (testCase.expectedViolations.imagesOfText && phase6a.imagesOfText.passed) {
        issues.push('Expected Images of Text violations but scanner found none');
    } else if (!testCase.expectedViolations.imagesOfText && !phase6a.imagesOfText.passed) {
        issues.push(`Unexpected Images of Text violations: ${phase6a.imagesOfText.violations?.length || 0}`);
    }
    
    // Performance validieren
    if (scanResult.scanTime > 30000) {
        issues.push(`Scan took ${scanResult.scanTime}ms, expected <30000ms`);
    }
    
    return {
        passed: issues.length === 0,
        issues: issues,
        testCase: testCase.name
    };
}

/**
 * Führt alle Tests aus
 */
async function runAllTests() {
    console.log('🚀 Starting REAL Phase6a API Test Runner...\n');
    
    // 1. API Health Check
    const apiHealthy = await checkAPIHealth();
    if (!apiHealthy) {
        console.log('❌ API is not available. Please start the server with: npm run api:start');
        process.exit(1);
    }
    
    // 2. Static Server starten
    let staticServer;
    try {
        staticServer = await startStaticServer();
    } catch (error) {
        console.log(`💥 Failed to start static server: ${error.message}`);
        process.exit(1);
    }
    
    const results = {
        passed: 0,
        failed: 0,
        total: 0,
        details: []
    };
    
    try {
        // 3. BAD Examples testen
        console.log('\n📛 Testing BAD examples (should be detected as POOR):');
        for (const testCase of TEST_SITES.bad) {
            results.total++;
            const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
            
            const scanResult = await runPhase6aScan(testUrl, testCase);
            
            if (scanResult.success) {
                const validation = validatePhase6aResults(scanResult, testCase);
                
                if (validation.passed) {
                    console.log(`   ✅ PASSED - Correctly identified violations`);
                    results.passed++;
                } else {
                    console.log(`   ❌ FAILED - Issues found:`);
                    validation.issues.forEach(issue => console.log(`      - ${issue}`));
                    results.failed++;
                }
                
                results.details.push({
                    testCase: testCase.name,
                    file: testCase.file,
                    expected: testCase.expectedPhase6aFail ? 'FAIL' : 'PASS',
                    actual: scanResult.result.phase6AScore < 90 ? 'FAIL' : 'PASS',
                    score: scanResult.result.phase6AScore,
                    passed: validation.passed,
                    issues: validation.issues,
                    scanTime: scanResult.scanTime + 'ms'
                });
            } else {
                console.log(`   💥 ERROR - ${scanResult.error}`);
                results.failed++;
                results.details.push({
                    testCase: testCase.name,
                    file: testCase.file,
                    error: scanResult.error,
                    passed: false
                });
            }
        }
        
        // 4. GOOD Examples testen
        console.log('\n\n✅ Testing GOOD examples (should be detected as GOOD):');
        for (const testCase of TEST_SITES.good) {
            results.total++;
            const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
            
            const scanResult = await runPhase6aScan(testUrl, testCase);
            
            if (scanResult.success) {
                const validation = validatePhase6aResults(scanResult, testCase);
                
                if (validation.passed) {
                    console.log(`   ✅ PASSED - Correctly identified as good`);
                    results.passed++;
                } else {
                    console.log(`   ❌ FAILED - Issues found:`);
                    validation.issues.forEach(issue => console.log(`      - ${issue}`));
                    results.failed++;
                }
                
                results.details.push({
                    testCase: testCase.name,
                    file: testCase.file,
                    expected: testCase.expectedPhase6aFail ? 'FAIL' : 'PASS',
                    actual: scanResult.result.phase6AScore < 90 ? 'FAIL' : 'PASS',
                    score: scanResult.result.phase6AScore,
                    passed: validation.passed,
                    issues: validation.issues,
                    scanTime: scanResult.scanTime + 'ms'
                });
            } else {
                console.log(`   💥 ERROR - ${scanResult.error}`);
                results.failed++;
                results.details.push({
                    testCase: testCase.name,
                    file: testCase.file,
                    error: scanResult.error,
                    passed: false
                });
            }
        }
        
    } finally {
        // 5. Static Server stoppen
        if (staticServer) {
            staticServer.close();
            console.log(`\n🛑 Static server stopped`);
        }
    }
    
    return results;
}

/**
 * Erstellt detaillierten Test-Bericht
 */
function generateTestReport(results) {
    console.log('\n' + '='.repeat(70));
    console.log('📊 REAL PHASE6A API TEST RESULTS');
    console.log('='.repeat(70));
    
    const successRate = Math.round((results.passed / results.total) * 100);
    console.log(`\n📈 SUMMARY:`);
    console.log(`   Tests passed: ${results.passed}/${results.total} (${successRate}%)`);
    console.log(`   Tests failed: ${results.failed}/${results.total}`);
    
    if (results.details.length > 0) {
        console.log(`\n📋 DETAILED RESULTS:`);
        
        results.details.forEach(test => {
            const status = test.passed ? '✅' : '❌';
            console.log(`\n${status} ${test.testCase}`);
            console.log(`   File: ${test.file}`);
            
            if (test.error) {
                console.log(`   Error: ${test.error}`);
            } else {
                console.log(`   Expected: ${test.expected} | Actual: ${test.actual} | Score: ${test.score}%`);
                console.log(`   Scan Time: ${test.scanTime}`);
                
                if (test.issues && test.issues.length > 0) {
                    console.log(`   Issues:`);
                    test.issues.forEach(issue => console.log(`     - ${issue}`));
                }
            }
        });
    }
    
    console.log(`\n🎯 RECOMMENDATIONS:`);
    if (successRate === 100) {
        console.log('   🎉 Perfect! Phase6a API is working correctly for all test cases.');
        console.log('   Ready for production use.');
    } else if (successRate >= 75) {
        console.log('   👍 Good accuracy, but some issues need investigation.');
        console.log('   Review failed test cases and API responses.');
    } else {
        console.log('   ⚠️  Significant issues detected with Phase6a API.');
        console.log('   Phase6a implementation needs debugging and fixes.');
    }
    
    console.log('\n' + '='.repeat(70));
    
    return results;
}

/**
 * Main Test Runner
 */
async function main() {
    try {
        const results = await runAllTests();
        const report = generateTestReport(results);
        
        // Exit code für CI/CD
        process.exit(results.failed > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('💥 Real API test runner failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Führe Tests aus wenn Script direkt ausgeführt wird
if (require.main === module) {
    main();
}

module.exports = {
    runAllTests,
    validatePhase6aResults,
    generateTestReport,
    checkAPIHealth,
    startStaticServer
};