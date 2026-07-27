#!/usr/bin/env node

/**
 * Matrix Test Runner for Accessibility Scanners
 * 
 * Systematically tests all Scanner × TestFile combinations
 * Provides structured false positive/negative analysis
 * Foundation for data-driven scanner improvement
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const INDIVIDUAL_API_URL = 'http://localhost:3002';
const STATIC_SERVER_PORT = 8083;
const TEST_HTML_DIR = __dirname;

// Test configuration with expected results per scanner
const SCANNER_EXPECTATIONS = {
    // Define which scanners should trigger on which files
    'color-contrast': {
        shouldFail: [
            'bad-color-contrast.html',
            'bad-nontext-contrast.html',
            'bad-focus-visible.html'
        ],
        shouldPass: [
            'good-accessibility.html',
            'good-css-background-accessible.html',
            'bad-use-of-color.html',  // Should not trigger color contrast
            'bad-images-of-text.html' // Should not trigger color contrast
        ]
    },
    'use-of-color': {
        shouldFail: [
            'bad-use-of-color.html'
        ],
        shouldPass: [
            'good-accessibility.html',
            'bad-color-contrast.html', // Should not trigger use of color
            'bad-images-of-text.html'
        ]
    },
    'images-of-text': {
        shouldFail: [
            'bad-images-of-text.html'
        ],
        shouldPass: [
            'good-accessibility.html',
            'bad-color-contrast.html',
            'bad-use-of-color.html'
        ]
    },
    'keyboard-navigation': {
        shouldFail: [
            'bad-keyboard-access.html',
            'bad-keyboard-trap.html',
            'bad-focus-order.html',
            'bad-focus-visible.html'
        ],
        shouldPass: [
            'good-accessibility.html',
            'bad-color-contrast.html'
        ]
    },
    'focus-management': {
        shouldFail: [
            'bad-focus-management.html',
            'bad-focus-order.html',
            'bad-keyboard-trap.html'
        ],
        shouldPass: [
            'good-focus-management.html',
            'good-accessibility.html',
            'bad-color-contrast.html'
        ]
    }
    // Add more scanner expectations as needed
};

// Get all test files
const TEST_FILES = {
    bad: [
        'bad-color-contrast.html',
        'bad-use-of-color.html', 
        'bad-images-of-text.html',
        'bad-seizure-risk.html',
        'bad-label-in-name.html',
        'bad-status-messages.html',
        'bad-nontext-contrast.html',
        'bad-timing-controls.html',
        'bad-form-errors.html',
        'bad-complex-aria.html',
        'bad-input-modalities.html',
        'bad-html-validation.html',
        'bad-keyboard-access.html',
        'bad-keyboard-trap.html',
        'bad-focus-order.html',
        'bad-focus-visible.html',
        'bad-link-purpose.html',
        'bad-focus-management.html'
    ],
    good: [
        'good-accessibility.html',
        'good-css-background-accessible.html',
        'good-focus-management.html'
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
            },
            timeout: 60000 // 60 second timeout
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
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
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
                res.end('Matrix Test HTML Server');
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
                console.log(`📡 Matrix test server running on http://localhost:${STATIC_SERVER_PORT}`);
                resolve(server);
            }
        });
    });
}

/**
 * Get available scanners from API
 */
async function getAvailableScanners() {
    try {
        const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scanners`);
        if (response.statusCode === 200) {
            return response.data.scanners.map(s => s.name);
        }
        return [];
    } catch (error) {
        console.error('Failed to get scanners:', error.message);
        return [];
    }
}

/**
 * Classify test result
 */
function classifyResult(scanner, testFile, hasViolations) {
    const expectations = SCANNER_EXPECTATIONS[scanner];
    if (!expectations) {
        return 'UNKNOWN'; // No expectations defined
    }
    
    const shouldFail = expectations.shouldFail.includes(testFile);
    const shouldPass = expectations.shouldPass.includes(testFile);
    
    if (!shouldFail && !shouldPass) {
        return 'UNKNOWN'; // File not in expectations
    }
    
    if (shouldFail && hasViolations) return 'TRUE_POSITIVE';
    if (shouldPass && !hasViolations) return 'TRUE_NEGATIVE';
    if (shouldPass && hasViolations) return 'FALSE_POSITIVE';
    if (shouldFail && !hasViolations) return 'FALSE_NEGATIVE';
    
    return 'UNKNOWN';
}

/**
 * Test single scanner against single file
 */
async function testScannerFile(scanner, testFile, testUrl) {
    const startTime = Date.now();
    
    try {
        const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scan/${scanner}`, {
            method: 'POST',
            body: {
                url: testUrl,
                options: { timeout: 45000 }
            }
        });
        
        const scanTime = Date.now() - startTime;
        
        if (response.statusCode !== 200) {
            throw new Error(`API returned status ${response.statusCode}`);
        }
        
        const result = response.data.result;
        const violations = result.violations || [];
        const hasViolations = violations.length > 0;
        const classification = classifyResult(scanner, testFile, hasViolations);
        
        return {
            scanner,
            testFile,
            scanTime,
            violations: violations.length,
            hasViolations,
            classification,
            success: true,
            violationDetails: violations.slice(0, 3) // Keep first 3 for analysis
        };
        
    } catch (error) {
        return {
            scanner,
            testFile,
            scanTime: Date.now() - startTime,
            error: error.message,
            success: false,
            classification: 'ERROR'
        };
    }
}

/**
 * Run matrix tests
 */
async function runMatrixTests(selectedScanners = null, selectedFiles = null) {
    console.log('🚀 Starting Matrix Test Runner...\\n');
    
    // Get available scanners
    const availableScanners = await getAvailableScanners();
    const scanners = selectedScanners || Object.keys(SCANNER_EXPECTATIONS);
    const validScanners = scanners.filter(s => availableScanners.includes(s));
    
    if (validScanners.length === 0) {
        console.log('❌ No valid scanners found');
        return null;
    }
    
    // Get test files
    const allFiles = [...TEST_FILES.bad, ...TEST_FILES.good];
    const testFiles = selectedFiles || allFiles;
    const existingFiles = testFiles.filter(file => fs.existsSync(path.join(TEST_HTML_DIR, file)));
    
    if (existingFiles.length === 0) {
        console.log('❌ No valid test files found');
        return null;
    }
    
    console.log(`📊 Matrix dimensions: ${validScanners.length} scanners × ${existingFiles.length} files = ${validScanners.length * existingFiles.length} combinations`);
    console.log(`🧪 Scanners: ${validScanners.join(', ')}`);
    console.log(`📄 Files: ${existingFiles.length} test files\\n`);
    
    // Start static server
    const server = await startStaticServer();
    
    const results = {
        scanners: validScanners,
        testFiles: existingFiles,
        matrix: {},
        summary: {
            total: 0,
            successful: 0,
            errors: 0,
            truePositives: 0,
            trueNegatives: 0,
            falsePositives: 0,
            falseNegatives: 0,
            unknown: 0
        },
        scannerSummary: {},
        fileSummary: {}
    };
    
    try {
        let completed = 0;
        const total = validScanners.length * existingFiles.length;
        
        // Run matrix tests
        for (const scanner of validScanners) {
            results.matrix[scanner] = {};
            results.scannerSummary[scanner] = {
                total: 0,
                truePositives: 0,
                trueNegatives: 0,
                falsePositives: 0,
                falseNegatives: 0,
                errors: 0,
                avgScanTime: 0
            };
            
            for (const testFile of existingFiles) {
                const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${testFile}`;
                
                console.log(`🔍 Testing ${scanner} on ${testFile} (${completed + 1}/${total})`);
                
                const result = await testScannerFile(scanner, testFile, testUrl);
                results.matrix[scanner][testFile] = result;
                
                // Update summaries
                results.summary.total++;
                results.scannerSummary[scanner].total++;
                
                if (result.success) {
                    results.summary.successful++;
                    results.scannerSummary[scanner].avgScanTime += result.scanTime;
                    
                    switch (result.classification) {
                        case 'TRUE_POSITIVE':
                            results.summary.truePositives++;
                            results.scannerSummary[scanner].truePositives++;
                            break;
                        case 'TRUE_NEGATIVE':
                            results.summary.trueNegatives++;
                            results.scannerSummary[scanner].trueNegatives++;
                            break;
                        case 'FALSE_POSITIVE':
                            results.summary.falsePositives++;
                            results.scannerSummary[scanner].falsePositives++;
                            break;
                        case 'FALSE_NEGATIVE':
                            results.summary.falseNegatives++;
                            results.scannerSummary[scanner].falseNegatives++;
                            break;
                        default:
                            results.summary.unknown++;
                    }
                } else {
                    results.summary.errors++;
                    results.scannerSummary[scanner].errors++;
                }
                
                completed++;
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Calculate average scan time
            if (results.scannerSummary[scanner].total > results.scannerSummary[scanner].errors) {
                results.scannerSummary[scanner].avgScanTime = Math.round(
                    results.scannerSummary[scanner].avgScanTime / 
                    (results.scannerSummary[scanner].total - results.scannerSummary[scanner].errors)
                );
            }
        }
        
    } finally {
        server.close();
        console.log('🛑 Matrix test server stopped\\n');
    }
    
    return results;
}

/**
 * Generate analysis report
 */
function generateAnalysisReport(results) {
    console.log('='.repeat(80));
    console.log('📊 MATRIX TEST ANALYSIS REPORT');
    console.log('='.repeat(80));
    
    const { summary } = results;
    const accuracy = summary.total > 0 ? Math.round(((summary.truePositives + summary.trueNegatives) / summary.total) * 100) : 0;
    const falsePositiveRate = summary.total > 0 ? Math.round((summary.falsePositives / summary.total) * 100) : 0;
    const falseNegativeRate = summary.total > 0 ? Math.round((summary.falseNegatives / summary.total) * 100) : 0;
    
    console.log(`\\n📈 OVERALL SUMMARY:`);
    console.log(`   Total combinations tested: ${summary.total}`);
    console.log(`   Successful scans: ${summary.successful}`);
    console.log(`   Errors: ${summary.errors}`);
    console.log(`   Overall accuracy: ${accuracy}%`);
    console.log(`   False positive rate: ${falsePositiveRate}%`);
    console.log(`   False negative rate: ${falseNegativeRate}%`);
    
    console.log(`\\n📊 DETAILED BREAKDOWN:`);
    console.log(`   True Positives: ${summary.truePositives} (correctly detected violations)`);
    console.log(`   True Negatives: ${summary.trueNegatives} (correctly passed clean files)`);
    console.log(`   False Positives: ${summary.falsePositives} (incorrectly flagged clean files)`);
    console.log(`   False Negatives: ${summary.falseNegatives} (missed actual violations)`);
    console.log(`   Unknown: ${summary.unknown} (no expectations defined)`);
    
    console.log(`\\n🔍 SCANNER PERFORMANCE:`);
    Object.entries(results.scannerSummary).forEach(([scanner, stats]) => {
        const scannerAccuracy = stats.total > 0 ? Math.round(((stats.truePositives + stats.trueNegatives) / stats.total) * 100) : 0;
        const scannerFPRate = stats.total > 0 ? Math.round((stats.falsePositives / stats.total) * 100) : 0;
        const scannerFNRate = stats.total > 0 ? Math.round((stats.falseNegatives / stats.total) * 100) : 0;
        
        console.log(`   ${scanner}:`);
        console.log(`     Accuracy: ${scannerAccuracy}% | FP: ${scannerFPRate}% | FN: ${scannerFNRate}%`);
        console.log(`     Avg scan time: ${stats.avgScanTime}ms | Errors: ${stats.errors}`);
        console.log(`     TP: ${stats.truePositives} | TN: ${stats.trueNegatives} | FP: ${stats.falsePositives} | FN: ${stats.falseNegatives}`);
    });
    
    console.log(`\\n🎯 PRIORITY ISSUES:`);
    
    // Identify scanners with high false positive rates
    const highFPScanners = Object.entries(results.scannerSummary)
        .filter(([_, stats]) => stats.total > 0 && (stats.falsePositives / stats.total) > 0.3)
        .map(([scanner, _]) => scanner);
    
    if (highFPScanners.length > 0) {
        console.log(`   🚨 High False Positive Rate (>30%): ${highFPScanners.join(', ')}`);
    }
    
    // Identify scanners with high false negative rates  
    const highFNScanners = Object.entries(results.scannerSummary)
        .filter(([_, stats]) => stats.total > 0 && (stats.falseNegatives / stats.total) > 0.3)
        .map(([scanner, _]) => scanner);
    
    if (highFNScanners.length > 0) {
        console.log(`   🚨 High False Negative Rate (>30%): ${highFNScanners.join(', ')}`);
    }
    
    // Performance issues
    const slowScanners = Object.entries(results.scannerSummary)
        .filter(([_, stats]) => stats.avgScanTime > 3000)
        .map(([scanner, stats]) => `${scanner} (${stats.avgScanTime}ms)`);
    
    if (slowScanners.length > 0) {
        console.log(`   ⏱️  Slow Scanners (>3s): ${slowScanners.join(', ')}`);
    }
    
    console.log(`\\n📋 RECOMMENDATIONS:`);
    if (accuracy >= 90) {
        console.log('   ✅ Excellent scanner performance - ready for production');
    } else if (accuracy >= 75) {
        console.log('   👍 Good scanner performance - minor tuning needed');
    } else if (accuracy >= 50) {
        console.log('   ⚠️  Moderate scanner performance - significant improvements needed');
    } else {
        console.log('   🚨 Poor scanner performance - major overhaul required');
    }
    
    if (falsePositiveRate > 20) {
        console.log('   🔧 Reduce scanner sensitivity to decrease false positives');
    }
    
    if (falseNegativeRate > 20) {
        console.log('   🔧 Improve scanner coverage to catch more violations');
    }
    
    console.log('\\n' + '='.repeat(80));
    
    return results;
}

/**
 * Save results to file
 */
function saveResults(results, filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = filename || `matrix-test-results-${timestamp}.json`;
    const outputPath = path.join(__dirname, '..', 'reports', outputFile);
    
    // Ensure reports directory exists
    const reportsDir = path.dirname(outputPath);
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`💾 Results saved to: ${outputPath}`);
    
    return outputPath;
}

/**
 * Main runner
 */
async function main() {
    try {
        // Check API health
        const healthResponse = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/health`);
        if (healthResponse.statusCode !== 200) {
            console.log('❌ Individual Scanner API not available');
            console.log('Please start: INDIVIDUAL_SCANNER_PORT=3002 node src/individual-scanner-api.js');
            process.exit(1);
        }
        
        console.log('✅ Individual Scanner API is healthy\\n');
        
        // Run matrix tests
        const results = await runMatrixTests();
        
        if (results) {
            // Generate analysis
            generateAnalysisReport(results);
            
            // Save results
            saveResults(results);
        }
        
    } catch (error) {
        console.error('💥 Matrix test failed:', error.message);
        process.exit(1);
    }
}

// Export for module use
module.exports = {
    runMatrixTests,
    generateAnalysisReport,
    saveResults,
    classifyResult
};

// Run if called directly
if (require.main === module) {
    main();
}