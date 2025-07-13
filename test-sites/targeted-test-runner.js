#!/usr/bin/env node

/**
 * Targeted Test Runner for Accessibility Scanners
 * 
 * Uses HTML-to-Scanner mapping to test only relevant scanner×file combinations
 * This eliminates the noise from brute-force matrix testing and focuses on 
 * expected behavior vs. actual behavior analysis
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { 
  HTML_SCANNER_MAPPING, 
  getExpectedScannersForFile, 
  getExcludedScannersForFile,
  getTestFilesByType,
  generateMappingStatistics
} = require('./html-scanner-mapping');

// Configuration
const INDIVIDUAL_API_URL = 'http://localhost:3002';
const STATIC_SERVER_PORT = 8084;
const TEST_HTML_DIR = __dirname;

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
      timeout: 60000
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
        res.end('Targeted Test HTML Server');
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
        console.log(`📡 Targeted test server running on http://localhost:${STATIC_SERVER_PORT}`);
        resolve(server);
      }
    });
  });
}

/**
 * Test individual scanner against specific file
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
    
    return {
      scanner,
      testFile,
      scanTime,
      violations: violations.length,
      hasViolations,
      success: true,
      violationDetails: violations.slice(0, 2) // Keep first 2 for analysis
    };
    
  } catch (error) {
    return {
      scanner,
      testFile,
      scanTime: Date.now() - startTime,
      error: error.message,
      success: false
    };
  }
}

/**
 * Classify test result based on expectations
 */
function classifyTargetedResult(scanner, testFile, hasViolations) {
  const config = HTML_SCANNER_MAPPING[testFile];
  if (!config) {
    return 'UNKNOWN_FILE';
  }
  
  const isExpected = config.expectedScanners.includes(scanner);
  const isExcluded = config.excludedScanners.includes(scanner);
  const isBadFile = config.testType === 'bad';
  const isGoodFile = config.testType === 'good';
  
  // Classification logic based on mapping expectations
  if (isExpected && isBadFile && hasViolations) return 'TRUE_POSITIVE';
  if (isExpected && isBadFile && !hasViolations) return 'FALSE_NEGATIVE';
  if (isExcluded && hasViolations) return 'FALSE_POSITIVE';
  if (isExcluded && !hasViolations) return 'TRUE_NEGATIVE';
  if (isGoodFile && hasViolations) return 'FALSE_POSITIVE';
  if (isGoodFile && !hasViolations) return 'TRUE_NEGATIVE';
  
  // Not explicitly expected or excluded - neutral territory
  if (!isExpected && !isExcluded) {
    return 'UNMAPPED';
  }
  
  return 'UNKNOWN';
}

/**
 * Run targeted tests based on HTML-Scanner mapping
 */
async function runTargetedTests(testMode = 'expected') {
  console.log('🎯 Starting Targeted Test Runner...\n');
  
  // Validate mapping first
  const mappingStats = generateMappingStatistics();
  if (mappingStats.validationIssues.length > 0) {
    console.log('❌ Mapping validation failed:');
    mappingStats.validationIssues.forEach(issue => console.log(`   ${issue}`));
    process.exit(1);
  }
  
  console.log(`📋 Mapping Statistics:`);
  console.log(`   Files: ${mappingStats.totalFiles} (${mappingStats.badFiles} bad, ${mappingStats.goodFiles} good)`);
  console.log(`   Scanners: ${mappingStats.availableScanners}\n`);
  
  // Start static server
  const server = await startStaticServer();
  
  const results = {
    testMode,
    timestamp: new Date().toISOString(),
    testCombinations: [],
    summary: {
      total: 0,
      successful: 0,
      errors: 0,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      unmapped: 0
    },
    scannerPerformance: {},
    fileAnalysis: {}
  };
  
  try {
    let testQueue = [];
    
    // Build test queue based on mode
    if (testMode === 'expected') {
      // Test only expected scanner×file combinations
      Object.keys(HTML_SCANNER_MAPPING).forEach(fileName => {
        const expectedScanners = getExpectedScannersForFile(fileName);
        expectedScanners.forEach(scanner => {
          testQueue.push({ scanner, fileName });
        });
      });
    } else if (testMode === 'excluded') {
      // Test excluded scanner×file combinations (should not trigger)
      Object.keys(HTML_SCANNER_MAPPING).forEach(fileName => {
        const excludedScanners = getExcludedScannersForFile(fileName);
        excludedScanners.forEach(scanner => {
          testQueue.push({ scanner, fileName });
        });
      });
    } else if (testMode === 'comprehensive') {
      // Test both expected and excluded combinations
      Object.keys(HTML_SCANNER_MAPPING).forEach(fileName => {
        const expectedScanners = getExpectedScannersForFile(fileName);
        const excludedScanners = getExcludedScannersForFile(fileName);
        
        [...expectedScanners, ...excludedScanners].forEach(scanner => {
          testQueue.push({ scanner, fileName });
        });
      });
    }
    
    // Remove duplicates and filter for existing files
    testQueue = testQueue
      .filter((item, index, self) => 
        index === self.findIndex(t => t.scanner === item.scanner && t.fileName === item.fileName)
      )
      .filter(item => fs.existsSync(path.join(TEST_HTML_DIR, item.fileName)));
    
    console.log(`🧪 Test Mode: ${testMode.toUpperCase()}`);
    console.log(`📝 Queued tests: ${testQueue.length} combinations\n`);
    
    let completed = 0;
    
    // Process test queue
    for (const { scanner, fileName } of testQueue) {
      const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${fileName}`;
      
      console.log(`🔍 Testing ${scanner} on ${fileName} (${completed + 1}/${testQueue.length})`);
      
      const result = await testScannerFile(scanner, fileName, testUrl);
      const classification = result.success ? 
        classifyTargetedResult(scanner, fileName, result.hasViolations) : 'ERROR';
      
      result.classification = classification;
      results.testCombinations.push(result);
      
      // Update summary
      results.summary.total++;
      if (result.success) {
        results.summary.successful++;
        
        switch (classification) {
          case 'TRUE_POSITIVE':
            results.summary.truePositives++;
            break;
          case 'TRUE_NEGATIVE':
            results.summary.trueNegatives++;
            break;
          case 'FALSE_POSITIVE':
            results.summary.falsePositives++;
            break;
          case 'FALSE_NEGATIVE':
            results.summary.falseNegatives++;
            break;
          case 'UNMAPPED':
            results.summary.unmapped++;
            break;
        }
      } else {
        results.summary.errors++;
      }
      
      // Update scanner performance tracking
      if (!results.scannerPerformance[scanner]) {
        results.scannerPerformance[scanner] = {
          total: 0,
          truePositives: 0,
          trueNegatives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          errors: 0,
          avgScanTime: 0,
          totalScanTime: 0
        };
      }
      
      const scannerStats = results.scannerPerformance[scanner];
      scannerStats.total++;
      
      if (result.success) {
        scannerStats.totalScanTime += result.scanTime;
        switch (classification) {
          case 'TRUE_POSITIVE': scannerStats.truePositives++; break;
          case 'TRUE_NEGATIVE': scannerStats.trueNegatives++; break;
          case 'FALSE_POSITIVE': scannerStats.falsePositives++; break;
          case 'FALSE_NEGATIVE': scannerStats.falseNegatives++; break;
        }
      } else {
        scannerStats.errors++;
      }
      
      // Update file analysis
      if (!results.fileAnalysis[fileName]) {
        results.fileAnalysis[fileName] = {
          testType: HTML_SCANNER_MAPPING[fileName]?.testType || 'unknown',
          scannersExpected: getExpectedScannersForFile(fileName).length,
          scannersTested: 0,
          correctResults: 0,
          falsePositives: 0,
          falseNegatives: 0
        };
      }
      
      const fileStats = results.fileAnalysis[fileName];
      fileStats.scannersTested++;
      
      if (classification === 'TRUE_POSITIVE' || classification === 'TRUE_NEGATIVE') {
        fileStats.correctResults++;
      } else if (classification === 'FALSE_POSITIVE') {
        fileStats.falsePositives++;
      } else if (classification === 'FALSE_NEGATIVE') {
        fileStats.falseNegatives++;
      }
      
      completed++;
      
      // Small delay to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Calculate average scan times
    Object.keys(results.scannerPerformance).forEach(scanner => {
      const stats = results.scannerPerformance[scanner];
      const successfulScans = stats.total - stats.errors;
      if (successfulScans > 0) {
        stats.avgScanTime = Math.round(stats.totalScanTime / successfulScans);
      }
    });
    
  } finally {
    server.close();
    console.log('🛑 Targeted test server stopped\n');
  }
  
  return results;
}

/**
 * Generate analysis report for targeted tests
 */
function generateTargetedAnalysisReport(results) {
  console.log('='.repeat(80));
  console.log('🎯 TARGETED TEST ANALYSIS REPORT');
  console.log('='.repeat(80));
  
  const { summary } = results;
  const accuracy = summary.total > 0 ? 
    Math.round(((summary.truePositives + summary.trueNegatives) / summary.total) * 100) : 0;
  const falsePositiveRate = summary.total > 0 ? 
    Math.round((summary.falsePositives / summary.total) * 100) : 0;
  const falseNegativeRate = summary.total > 0 ? 
    Math.round((summary.falseNegatives / summary.total) * 100) : 0;
  
  console.log(`\n📈 OVERALL RESULTS:`);
  console.log(`   Test Mode: ${results.testMode.toUpperCase()}`);
  console.log(`   Total combinations tested: ${summary.total}`);
  console.log(`   Successful scans: ${summary.successful}`);
  console.log(`   Errors: ${summary.errors}`);
  console.log(`   Overall accuracy: ${accuracy}%`);
  console.log(`   False positive rate: ${falsePositiveRate}%`);
  console.log(`   False negative rate: ${falseNegativeRate}%`);
  
  console.log(`\n📊 DETAILED BREAKDOWN:`);
  console.log(`   True Positives: ${summary.truePositives} (correctly detected expected violations)`);
  console.log(`   True Negatives: ${summary.trueNegatives} (correctly ignored excluded files)`);
  console.log(`   False Positives: ${summary.falsePositives} (incorrectly flagged excluded files)`);
  console.log(`   False Negatives: ${summary.falseNegatives} (missed expected violations)`);
  console.log(`   Unmapped: ${summary.unmapped} (combinations not in mapping)`);
  
  console.log(`\n🔍 SCANNER PERFORMANCE:`);
  Object.entries(results.scannerPerformance).forEach(([scanner, stats]) => {
    const scannerAccuracy = stats.total > 0 ? 
      Math.round(((stats.truePositives + stats.trueNegatives) / stats.total) * 100) : 0;
    const scannerFPRate = stats.total > 0 ? 
      Math.round((stats.falsePositives / stats.total) * 100) : 0;
    const scannerFNRate = stats.total > 0 ? 
      Math.round((stats.falseNegatives / stats.total) * 100) : 0;
    
    console.log(`   ${scanner}:`);
    console.log(`     Accuracy: ${scannerAccuracy}% | FP: ${scannerFPRate}% | FN: ${scannerFNRate}%`);
    console.log(`     Avg scan time: ${stats.avgScanTime}ms | Errors: ${stats.errors}`);
    console.log(`     TP: ${stats.truePositives} | TN: ${stats.trueNegatives} | FP: ${stats.falsePositives} | FN: ${stats.falseNegatives}`);
  });
  
  console.log(`\n📄 FILE ANALYSIS (Top Issues):`);
  const fileIssues = Object.entries(results.fileAnalysis)
    .filter(([_, stats]) => stats.falsePositives > 0 || stats.falseNegatives > 0)
    .sort((a, b) => (b[1].falsePositives + b[1].falseNegatives) - (a[1].falsePositives + a[1].falseNegatives))
    .slice(0, 10);
  
  if (fileIssues.length > 0) {
    fileIssues.forEach(([fileName, stats]) => {
      console.log(`   ${fileName} (${stats.testType}):`);
      console.log(`     FP: ${stats.falsePositives} | FN: ${stats.falseNegatives} | Correct: ${stats.correctResults}`);
    });
  } else {
    console.log(`   ✅ No significant file issues detected`);
  }
  
  console.log(`\n🎯 KEY INSIGHTS:`);
  
  if (accuracy >= 90) {
    console.log('   ✅ Excellent targeted accuracy - mapping strategy is working');
  } else if (accuracy >= 75) {
    console.log('   👍 Good targeted accuracy - minor mapping adjustments needed');
  } else if (accuracy >= 50) {
    console.log('   ⚠️  Moderate accuracy - review scanner implementations');
  } else {
    console.log('   🚨 Poor accuracy - major scanner issues detected');
  }
  
  // Scanner-specific insights
  const problematicScanners = Object.entries(results.scannerPerformance)
    .filter(([_, stats]) => {
      const totalTests = stats.total - stats.errors;
      const fpRate = totalTests > 0 ? stats.falsePositives / totalTests : 0;
      const fnRate = totalTests > 0 ? stats.falseNegatives / totalTests : 0;
      return fpRate > 0.3 || fnRate > 0.3 || stats.errors > totalTests * 0.2;
    })
    .map(([scanner, stats]) => ({
      scanner,
      issue: stats.falsePositives > stats.total * 0.3 ? 'High False Positives' :
             stats.falseNegatives > stats.total * 0.3 ? 'High False Negatives' : 'High Error Rate'
    }));
  
  if (problematicScanners.length > 0) {
    console.log(`   🚨 Problematic scanners:`);
    problematicScanners.forEach(({ scanner, issue }) => {
      console.log(`     - ${scanner}: ${issue}`);
    });
  }
  
  console.log(`\n📋 NEXT STEPS:`);
  if (results.testMode === 'expected') {
    console.log('   1. Review false negatives - scanners missing expected violations');
    console.log('   2. Run excluded tests to check false positive rate');
    console.log('   3. Update mapping for unmapped scanner behaviors');
  } else if (results.testMode === 'excluded') {
    console.log('   1. Review false positives - scanners triggering when they shouldn\'t');
    console.log('   2. Adjust scanner sensitivity or mapping exclusions');
    console.log('   3. Test comprehensive mode for full picture');
  } else {
    console.log('   1. Focus on high-impact false positives/negatives');
    console.log('   2. Test integrated scanner for cross-contamination');
    console.log('   3. Refine mapping based on actual scanner behavior');
  }
  
  console.log('\n' + '='.repeat(80));
  
  return results;
}

/**
 * Save results to file
 */
function saveTargetedResults(results, filename = null) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = filename || `targeted-test-results-${results.testMode}-${timestamp}.json`;
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
    
    console.log('✅ Individual Scanner API is healthy\n');
    
    // Determine test mode from command line arguments
    const testMode = process.argv[2] || 'expected';
    
    if (!['expected', 'excluded', 'comprehensive'].includes(testMode)) {
      console.log('❌ Invalid test mode. Use: expected | excluded | comprehensive');
      process.exit(1);
    }
    
    // Run targeted tests
    const results = await runTargetedTests(testMode);
    
    if (results) {
      // Generate analysis
      generateTargetedAnalysisReport(results);
      
      // Save results
      saveTargetedResults(results);
    }
    
  } catch (error) {
    console.error('💥 Targeted test failed:', error.message);
    process.exit(1);
  }
}

// Export for module use
module.exports = {
  runTargetedTests,
  generateTargetedAnalysisReport,
  saveTargetedResults,
  classifyTargetedResult
};

// Run if called directly
if (require.main === module) {
  main();
}