#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

// Get all HTML files in test-sites directory
const testSitesDir = path.join(__dirname, 'test-sites');
const htmlFiles = fs.readdirSync(testSitesDir)
  .filter(file => file.endsWith('.html'))
  .sort();

console.log(`🔍 Found ${htmlFiles.length} HTML test files\n`);

// Function to make HTTP request
function makeRequest(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${responseData}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

async function testAllHtmlFiles() {
  const results = [];
  
  // Test a few key scanners on all HTML files
  const testScanners = ['color-contrast', 'keyboard-navigation', 'html-validation'];
  
  for (const scanner of testScanners) {
    console.log(`\n📊 Testing ${scanner} scanner on all HTML files...\n`);
    
    for (const htmlFile of htmlFiles) {
      const fileUrl = `file://${path.join(testSitesDir, htmlFile)}`;
      
      try {
        const result = await makeRequest(`/api/scan/${scanner}`, { url: fileUrl });
        
        const violations = result.result?.violations?.length || 0;
        const passed = result.result?.passed || false;
        
        console.log(`${passed ? '✅' : '❌'} ${htmlFile.padEnd(35)} - ${violations.toString().padStart(3)} violations`);
        
        results.push({
          file: htmlFile,
          scanner,
          passed,
          violations,
          realApiTested: true
        });
        
      } catch (error) {
        console.log(`❌ ${htmlFile.padEnd(35)} - ERROR: ${error.message}`);
        results.push({
          file: htmlFile,
          scanner,
          error: error.message,
          realApiTested: false
        });
      }
    }
  }
  
  // Summary analysis
  console.log('\n' + '='.repeat(70));
  console.log('📈 SUMMARY ANALYSIS');
  console.log('='.repeat(70));
  
  const uniqueFiles = [...new Set(results.map(r => r.file))];
  console.log(`\n📁 Total HTML files tested: ${uniqueFiles.length}`);
  
  // Check if bad files are actually failing
  const badFiles = results.filter(r => r.file.startsWith('bad-'));
  const goodFiles = results.filter(r => r.file.startsWith('good-'));
  
  console.log(`\n📛 BAD files (should fail): ${badFiles.length / testScanners.length}`);
  const badFilesPassing = badFiles.filter(r => r.passed).length;
  console.log(`   - Incorrectly passing: ${badFilesPassing} (${((badFilesPassing/badFiles.length)*100).toFixed(1)}%)`);
  
  console.log(`\n✅ GOOD files (should pass): ${goodFiles.length / testScanners.length}`);
  const goodFilesFailing = goodFiles.filter(r => !r.passed && !r.error).length;
  console.log(`   - Incorrectly failing: ${goodFilesFailing} (${((goodFilesFailing/goodFiles.length)*100).toFixed(1)}%)`);
  
  // Check for API connection issues
  const errorResults = results.filter(r => r.error);
  if (errorResults.length > 0) {
    console.log(`\n⚠️  API connection issues: ${errorResults.length}`);
  } else {
    console.log(`\n🎯 ALL FILES SUCCESSFULLY TESTED THROUGH REAL API`);
  }
  
  // Show most problematic files
  console.log(`\n🔍 Sample results by file type:`);
  
  // Sample bad files
  const sampleBadFiles = uniqueFiles.filter(f => f.startsWith('bad-')).slice(0, 5);
  sampleBadFiles.forEach(file => {
    const fileResults = results.filter(r => r.file === file);
    const totalViolations = fileResults.reduce((sum, r) => sum + (r.violations || 0), 0);
    console.log(`   📛 ${file}: ${totalViolations} total violations across ${fileResults.length} scanners`);
  });
  
  // Sample good files  
  const sampleGoodFiles = uniqueFiles.filter(f => f.startsWith('good-')).slice(0, 5);
  sampleGoodFiles.forEach(file => {
    const fileResults = results.filter(r => r.file === file);
    const totalViolations = fileResults.reduce((sum, r) => sum + (r.violations || 0), 0);
    const allPassed = fileResults.every(r => r.passed);
    console.log(`   ✅ ${file}: ${totalViolations} violations, all passed: ${allPassed}`);
  });
}

testAllHtmlFiles().catch(console.error);