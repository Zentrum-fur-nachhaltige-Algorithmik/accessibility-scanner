#!/usr/bin/env node

/**
 * Quick Sample Test Runner
 * 
 * Runs a small subset of tests to generate sample data for isolation
 * This helps speed up the debugging workflow setup
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { classifyTargetedResult } = require('../test-sites/targeted-test-runner');
const { HTML_SCANNER_MAPPING } = require('../test-sites/html-scanner-mapping');

// Configuration
const INDIVIDUAL_API_URL = 'http://localhost:3002';
const STATIC_SERVER_PORT = 8085;
const TEST_HTML_DIR = path.join(__dirname, '..', 'test-sites');

// Sample test combinations - mix of expected issues
const SAMPLE_TESTS = [
  // Expected to work (true positives)
  { scanner: 'color-contrast', file: 'bad-color-contrast.html' },
  { scanner: 'use-of-color', file: 'bad-use-of-color.html' },
  
  // Expected false negatives
  { scanner: 'page-structure', file: 'bad-image-alt.html' },
  { scanner: 'keyboard-navigation', file: 'bad-keyboard-access.html' },
  
  // Expected false positives  
  { scanner: 'color-contrast', file: 'good-accessibility.html' },
  { scanner: 'use-of-color', file: 'good-accessibility.html' },
  
  // More mixed cases
  { scanner: 'focus-management', file: 'bad-focus-visible.html' },
  { scanner: 'error-handling', file: 'bad-form-labels.html' },
  { scanner: 'page-structure', file: 'bad-complex-aria.html' },
  { scanner: 'language-detection', file: 'bad-language.html' }
];

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
      timeout: 30000
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
        res.end('Quick Sample Test Server');
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
        console.log(`📡 Quick sample test server running on http://localhost:${STATIC_SERVER_PORT}`);
        resolve(server);
      }
    });
  });
}

async function testScannerFile(scanner, testFile, testUrl) {
  const startTime = Date.now();
  
  try {
    const response = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/scan/${scanner}`, {
      method: 'POST',
      body: {
        url: testUrl,
        options: { timeout: 30000 }
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
      violationDetails: violations.slice(0, 2)
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

async function runQuickSample() {
  console.log('⚡ Starting Quick Sample Test...\n');
  
  // Check API health
  try {
    const healthResponse = await makeHttpRequest(`${INDIVIDUAL_API_URL}/api/health`);
    if (healthResponse.statusCode !== 200) {
      console.log('❌ Individual Scanner API not available');
      console.log('Please start: INDIVIDUAL_SCANNER_PORT=3002 node src/individual-scanner-api.js');
      process.exit(1);
    }
    console.log('✅ Individual Scanner API is healthy\n');
  } catch (error) {
    console.log('❌ Cannot connect to Individual Scanner API');
    process.exit(1);
  }
  
  // Start static server
  const server = await startStaticServer();
  
  const results = {
    testMode: 'quick-sample',
    timestamp: new Date().toISOString(),
    testCombinations: [],
    summary: {
      total: 0,
      successful: 0,
      errors: 0,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 0,
      falseNegatives: 0
    }
  };
  
  try {
    console.log(`🧪 Testing ${SAMPLE_TESTS.length} sample combinations...\n`);
    
    for (let i = 0; i < SAMPLE_TESTS.length; i++) {
      const { scanner, file } = SAMPLE_TESTS[i];
      const testUrl = `http://localhost:${STATIC_SERVER_PORT}/${file}`;
      
      // Check if file exists
      if (!fs.existsSync(path.join(TEST_HTML_DIR, file))) {
        console.log(`⚠️  SKIPPING: ${file} not found`);
        continue;
      }
      
      console.log(`🔍 Testing ${scanner} on ${file} (${i + 1}/${SAMPLE_TESTS.length})`);
      
      const result = await testScannerFile(scanner, file, testUrl);
      const classification = result.success ? 
        classifyTargetedResult(scanner, file, result.hasViolations) : 'ERROR';
      
      result.classification = classification;
      results.testCombinations.push(result);
      
      // Update summary
      results.summary.total++;
      if (result.success) {
        results.summary.successful++;
        
        switch (classification) {
          case 'TRUE_POSITIVE':
            results.summary.truePositives++;
            console.log(`   ✅ TRUE_POSITIVE: Found ${result.violations} violations as expected`);
            break;
          case 'TRUE_NEGATIVE':
            results.summary.trueNegatives++;
            console.log(`   ✅ TRUE_NEGATIVE: Correctly found no violations`);
            break;
          case 'FALSE_POSITIVE':
            results.summary.falsePositives++;
            console.log(`   ❌ FALSE_POSITIVE: Incorrectly found ${result.violations} violations`);
            break;
          case 'FALSE_NEGATIVE':
            results.summary.falseNegatives++;
            console.log(`   ❌ FALSE_NEGATIVE: Missed expected violations`);
            break;
          default:
            console.log(`   ⚪ ${classification}`);
        }
      } else {
        results.summary.errors++;
        console.log(`   💥 ERROR: ${result.error}`);
      }
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Generate quick report
    console.log('\n' + '='.repeat(60));
    console.log('⚡ QUICK SAMPLE TEST RESULTS');
    console.log('='.repeat(60));
    
    const { summary } = results;
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total tests: ${summary.total}`);
    console.log(`   Successful: ${summary.successful}`);
    console.log(`   Errors: ${summary.errors}`);
    console.log(`   True Positives: ${summary.truePositives}`);
    console.log(`   True Negatives: ${summary.trueNegatives}`);
    console.log(`   False Positives: ${summary.falsePositives} 🚨`);
    console.log(`   False Negatives: ${summary.falseNegatives} 🚨`);
    
    // Save results
    const reportsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `quick-sample-results-${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    
    console.log(`\n💾 Results saved to: ${reportPath}`);
    console.log(`\n🔧 Next step: Run isolated test organizer`);
    console.log(`   node isolated-tests/isolated-test-organizer.js "${reportPath}"`);
    
    return reportPath;
    
  } finally {
    server.close();
    console.log('\n🛑 Quick sample test server stopped');
  }
}

// Run if called directly
if (require.main === module) {
  runQuickSample().catch(console.error);
}

module.exports = { runQuickSample };