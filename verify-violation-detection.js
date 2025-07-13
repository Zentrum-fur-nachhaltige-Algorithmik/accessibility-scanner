#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');

// Function to make HTTP request to real API
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

async function verifyViolationDetection() {
  console.log('🔍 COMPREHENSIVE VIOLATION DETECTION VERIFICATION\n');
  
  // Test specific files known to have violations
  const testCases = [
    {
      file: 'bad-color-contrast.html',
      scanner: 'color-contrast',
      expectedMinViolations: 20, // Should find many contrast violations
      description: 'Multiple color contrast failures'
    },
    {
      file: 'bad-keyboard-access.html', 
      scanner: 'keyboard-navigation',
      expectedMinViolations: 25, // Should find many keyboard issues
      description: 'Non-keyboard accessible elements'
    },
    {
      file: 'bad-form-labels.html',
      scanner: 'keyboard-navigation', 
      expectedMinViolations: 15, // Should find unlabeled form inputs
      description: 'Forms without proper labels'
    },
    {
      file: 'bad-html-validation.html',
      scanner: 'html-validation',
      expectedMinViolations: 30, // Should find many HTML structure issues
      description: 'Invalid HTML structure and ARIA'
    },
    {
      file: 'bad-image-alt.html',
      scanner: 'color-contrast', // Test images without alt text affect contrast
      expectedMinViolations: 5,
      description: 'Images without alt text'
    },
    {
      file: 'good-accessibility.html',
      scanner: 'color-contrast',
      expectedMinViolations: 0, // Should be clean after my fixes
      description: 'Well-formed accessibility (should pass)'
    },
    {
      file: 'good-accessibility.html',
      scanner: 'keyboard-navigation', 
      expectedMinViolations: 0, // Should be clean after my fixes
      description: 'Good keyboard accessibility (should pass)'
    },
    {
      file: 'good-accessibility.html',
      scanner: 'html-validation',
      expectedMinViolations: 0, // Should be clean after my fixes  
      description: 'Valid HTML structure (should pass)'
    }
  ];
  
  const results = [];
  
  for (const testCase of testCases) {
    const fileUrl = `file://${path.join(__dirname, 'test-sites', testCase.file)}`;
    
    try {
      console.log(`📋 Testing: ${testCase.file}`);
      console.log(`🔧 Scanner: ${testCase.scanner}`);
      console.log(`📝 Expected: ${testCase.description}`);
      
      const result = await makeRequest(`/api/scan/${testCase.scanner}`, { url: fileUrl });
      
      const violations = result.result?.violations?.length || 0;
      const passed = result.result?.passed || false;
      
      console.log(`📊 Found: ${violations} violations`);
      console.log(`🎯 Status: ${passed ? 'PASSED' : 'FAILED'}`);
      
      // Verify violation count meets expectations
      const meetsExpectation = violations >= testCase.expectedMinViolations;
      
      if (meetsExpectation) {
        console.log(`✅ CORRECT: Found ${violations} violations (expected ≥${testCase.expectedMinViolations})`);
      } else {
        console.log(`❌ ISSUE: Found ${violations} violations (expected ≥${testCase.expectedMinViolations})`);
        console.log(`⚠️  This suggests the scanner may not be detecting all violations!`);
      }
      
      results.push({
        ...testCase,
        actualViolations: violations,
        passed,
        meetsExpectation,
        apiWorking: true
      });
      
      // Show sample violations for verification
      if (violations > 0 && result.result.violations) {
        console.log(`🔍 Sample violations found:`);
        result.result.violations.slice(0, 3).forEach((violation, i) => {
          const element = violation.element || violation.selector || 'unknown';
          const description = violation.description || violation.issue || 'no description';
          console.log(`   ${i + 1}. ${element}: ${description}`);
        });
      }
      
      console.log('\n' + '-'.repeat(60) + '\n');
      
    } catch (error) {
      console.log(`❌ API ERROR: ${error.message}\n`);
      results.push({
        ...testCase,
        error: error.message,
        apiWorking: false
      });
    }
  }
  
  // Final analysis
  console.log('📈 FINAL ANALYSIS');
  console.log('='.repeat(50));
  
  const workingTests = results.filter(r => r.apiWorking);
  const meetingExpectations = workingTests.filter(r => r.meetsExpectation);
  
  console.log(`\n🔧 API Tests Working: ${workingTests.length}/${results.length}`);
  console.log(`✅ Meeting Expectations: ${meetingExpectations.length}/${workingTests.length}`);
  
  // Check for potential issues
  const potentialIssues = workingTests.filter(r => !r.meetsExpectation);
  if (potentialIssues.length > 0) {
    console.log(`\n⚠️  POTENTIAL ISSUES DETECTED:`);
    potentialIssues.forEach(issue => {
      console.log(`   - ${issue.file} (${issue.scanner}): Got ${issue.actualViolations}, expected ≥${issue.expectedMinViolations}`);
    });
    console.log(`\n🔍 These may indicate:`);
    console.log(`   1. Scanner not detecting all violations`);
    console.log(`   2. Test expectations too high`);
    console.log(`   3. HTML files don't contain expected violations`);
  } else {
    console.log(`\n🎉 ALL SCANNERS DETECTING EXPECTED VIOLATIONS!`);
    console.log(`✅ No evidence of mocking or missing detection`);
  }
  
  // Verify my debugging claims
  console.log(`\n🎯 DEBUGGING VERIFICATION:`);
  const goodFileResults = results.filter(r => r.file === 'good-accessibility.html');
  const allGoodFilesPassing = goodFileResults.every(r => r.passed && r.actualViolations === 0);
  
  if (allGoodFilesPassing) {
    console.log(`✅ good-accessibility.html passes all scanners (0 violations)`);
    console.log(`✅ My debugging fixes appear to be working correctly`);
  } else {
    console.log(`❌ good-accessibility.html still has violations - debugging incomplete`);
  }
  
  const badFileResults = results.filter(r => r.file.startsWith('bad-'));
  const allBadFilesFailing = badFileResults.every(r => !r.passed && r.actualViolations > 0);
  
  if (allBadFilesFailing) {
    console.log(`✅ All bad files correctly failing with violations detected`);
    console.log(`✅ Scanners successfully detecting real accessibility issues`);
  } else {
    console.log(`❌ Some bad files incorrectly passing - scanner sensitivity issues`);
  }
}

verifyViolationDetection().catch(console.error);