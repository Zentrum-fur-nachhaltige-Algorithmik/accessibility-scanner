#!/usr/bin/env node

/**
 * Test Runner for Individual Scanner API
 * Validates that each scanner can run in isolation
 * Tests the foundation for matrix testing infrastructure
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const INDIVIDUAL_API_URL = 'http://localhost:3002';
const STATIC_SERVER_PORT = 8082;
const TEST_HTML_DIR = __dirname;

// Small test set for validation
const VALIDATION_TESTS = {
    'color-contrast': [
        { file: 'bad-color-contrast.html', expectedViolations: true },
        { file: 'good-accessibility.html', expectedViolations: false }
    ],
    'use-of-color': [
        { file: 'bad-use-of-color.html', expectedViolations: true },
        { file: 'good-accessibility.html', expectedViolations: false }
    ],
    'images-of-text': [
        { file: 'bad-images-of-text.html', expectedViolations: true },
        { file: 'good-accessibility.html', expectedViolations: false }
    ]
};

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
 * Start static HTML server
 */
function startStaticServer() {
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
            
            const filePath = path.join(TEST_HTML_DIR, req.url.substring(1));
            
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Individual Scanner API Test Server');
                return;
            }
            
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`File not found: ${req.url}`);
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        });
        
        server.listen(STATIC_SERVER_PORT, (err) => {
            if (err) {
                reject(err);
            } else {
                console.log(`📡 Test HTML server running on http://localhost:${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * Check Individual Scanner API health
 */
async function checkAPIHealth() {
    try {
        console.log('🔍 Checking Individual Scanner API health...');
        const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/health`);
        
        if (response.statusCode === 200) {
            console.log('✅ Individual Scanner API is running and healthy');
            console.log(`📊 Available scanners: ${response.data.availableScanners?.length || 0}`);
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
 * List available scanners
 */
async function listScanners() {
    try {
        const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scanners`);
        
        if (response.statusCode === 200) {
            console.log(`\\n📋 Available Scanners (${response.data.totalScanners}):`);
            response.data.scanners.forEach(scanner => {
                console.log(`   ${scanner.name}: ${scanner.displayName}`);
                console.log(`     ${scanner.description}`);
                console.log(`     Endpoint: ${scanner.endpoint}`);
            });
            return response.data.scanners;
        } else {
            console.log('❌ Failed to list scanners');
            return [];
        }
    } catch (error) {
        console.log(`💥 Scanner listing error: ${error.message}`);
        return [];
    }
}

/**
 * Test individual scanner
 */
async function testIndividualScanner(scannerName, testUrl, testCase) {
    console.log(`\\n🔍 Testing ${scannerName} scanner:`);
    console.log(`   URL: ${testUrl}`);
    console.log(`   Expected violations: ${testCase.expectedViolations ? 'YES' : 'NO'}`);
    
    const startTime = Date.now();
    
    try {
        const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scan/${scannerName}`, {
            method: 'POST',
            body: {
                url: testUrl,
                options: {
                    timeout: 30000
                }
            }
        });
        
        const scanTime = Date.now() - startTime;
        
        if (response.statusCode !== 200) {
            throw new Error(`API returned status ${response.statusCode}: ${JSON.stringify(response.data)}`);
        }
        
        const result = response.data.result;
        const hasViolations = result.violations && result.violations.length > 0;
        
        console.log(`   ⏱️  Scan completed in ${scanTime}ms`);
        console.log(`   📊 Violations found: ${hasViolations ? result.violations.length : 0}`);
        console.log(`   🎯 Expected vs Actual: ${testCase.expectedViolations ? 'FAIL' : 'PASS'} vs ${hasViolations ? 'FAIL' : 'PASS'}`);
        
        // Validate result
        const correct = (testCase.expectedViolations && hasViolations) || (!testCase.expectedViolations && !hasViolations);
        
        if (correct) {
            console.log(`   ✅ CORRECT - Scanner behaved as expected`);
        } else {
            if (testCase.expectedViolations && !hasViolations) {
                console.log(`   ❌ FALSE NEGATIVE - Expected violations but found none`);
            } else {
                console.log(`   ❌ FALSE POSITIVE - Found violations but none expected`);
            }
        }
        
        return {
            scanner: scannerName,
            testCase: testCase,
            scanTime: scanTime,
            violations: result.violations || [],
            correct: correct,
            type: correct ? 'CORRECT' : (testCase.expectedViolations && !hasViolations ? 'FALSE_NEGATIVE' : 'FALSE_POSITIVE')
        };
        
    } catch (error) {
        console.log(`   💥 Scan failed: ${error.message}`);
        return {
            scanner: scannerName,
            testCase: testCase,
            scanTime: Date.now() - startTime,
            error: error.message,
            correct: false,
            type: 'ERROR'
        };
    }
}

/**
 * Test batch scanning
 */
async function testBatchScanning() {
    console.log(`\\n📦 Testing Batch Scanning:`);
    
    const testUrls = [
        `http://localhost:${STATIC_SERVER_PORT}/bad-color-contrast.html`,
        `http://localhost:${STATIC_SERVER_PORT}/good-accessibility.html`
    ];
    
    const scanners = ['color-contrast', 'use-of-color', 'images-of-text'];
    
    try {
        const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scan/batch`, {
            method: 'POST',
            body: {
                url: testUrls[0],
                scanners: scanners,
                options: { timeout: 30000 }
            }
        });
        
        if (response.statusCode === 200) {
            console.log(`   ✅ Batch scan successful`);
            console.log(`   📊 Scanners run: ${response.data.totalScanners}`);
            
            Object.keys(response.data.results).forEach(scanner => {
                const result = response.data.results[scanner];
                if (result.success !== false) {
                    console.log(`     ${scanner}: ${result.violations?.length || 0} violations (${result.scanDuration}ms)`);
                } else {
                    console.log(`     ${scanner}: ERROR - ${result.error}`);
                }
            });
            
            return true;
        } else {
            console.log(`   ❌ Batch scan failed: ${response.statusCode}`);
            return false;
        }
        
    } catch (error) {
        console.log(`   💥 Batch scan error: ${error.message}`);
        return false;
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('🚀 Starting Individual Scanner API Tests...\\n');
    
    const results = {
        total: 0,
        correct: 0,
        falsePositives: 0,
        falseNegatives: 0,
        errors: 0,
        details: []
    };
    
    // Health check
    const apiHealthy = await checkAPIHealth();
    if (!apiHealthy) {
        console.log('💥 Individual Scanner API is not available. Please start it first.');
        console.log('Run: node src/individual-scanner-api.js');
        process.exit(1);
    }
    
    // List scanners
    const scanners = await listScanners();
    if (scanners.length === 0) {
        console.log('💥 No scanners available');
        process.exit(1);
    }
    
    // Start static server
    const server = await startStaticServer();
    
    try {
        // Test individual scanners
        console.log(`\\n🧪 Testing Individual Scanner Isolation:`);
        
        for (const [scannerName, testCases] of Object.entries(VALIDATION_TESTS)) {
            for (const testCase of testCases) {
                // Check if test file exists
                if (!fs.existsSync(path.join(TEST_HTML_DIR, testCase.file))) {
                    console.log(`\\n⚠️  SKIPPING: ${scannerName} - File ${testCase.file} not found`);
                    continue;
                }
                
                const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testCase.file}`;
                const result = await testIndividualScanner(scannerName, testUrl, testCase);
                
                results.total++;
                if (result.correct) {
                    results.correct++;
                } else if (result.type === 'FALSE_POSITIVE') {
                    results.falsePositives++;
                } else if (result.type === 'FALSE_NEGATIVE') {
                    results.falseNegatives++;
                } else if (result.type === 'ERROR') {
                    results.errors++;
                }
                
                results.details.push(result);
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Test batch scanning
        const batchSuccess = await testBatchScanning();
        
        // Generate report
        console.log('\\n' + '='.repeat(80));
        console.log('📊 INDIVIDUAL SCANNER API TEST RESULTS');
        console.log('='.repeat(80));
        
        const accuracy = Math.round((results.correct / results.total) * 100);
        console.log(`\\n📈 SUMMARY:`);
        console.log(`   Tests run: ${results.total}`);
        console.log(`   Correct: ${results.correct} (${accuracy}%)`);
        console.log(`   False Positives: ${results.falsePositives}`);
        console.log(`   False Negatives: ${results.falseNegatives}`);
        console.log(`   Errors: ${results.errors}`);
        console.log(`   Batch scanning: ${batchSuccess ? 'WORKING' : 'FAILED'}`);
        
        console.log(`\\n🎯 INFRASTRUCTURE STATUS:`);
        if (accuracy >= 80 && batchSuccess) {
            console.log('   ✅ Individual Scanner API is ready for matrix testing');
            console.log('   ✅ Scanner isolation is working');
            console.log('   ✅ Batch testing functionality confirmed');
        } else {
            console.log('   ⚠️  Individual Scanner API needs fixes before matrix testing');
            if (!batchSuccess) {
                console.log('   ❌ Batch testing not working');
            }
            if (accuracy < 80) {
                console.log('   ❌ Scanner isolation issues detected');
            }
        }
        
        console.log(`\\n📋 DETAILED RESULTS:`);
        results.details.forEach(result => {
            const status = result.correct ? '✅' : '❌';
            console.log(`   ${status} ${result.scanner}: ${result.type} (${result.scanTime}ms)`);
            if (result.error) {
                console.log(`     Error: ${result.error}`);
            }
        });
        
        console.log('\\n' + '='.repeat(80));
        
    } finally {
        // Stop static server
        server.close();
        console.log('🛑 Test server stopped');
    }
    
    return results;
}

// Run tests if called directly
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = {
    runTests,
    testIndividualScanner,
    checkAPIHealth
};