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

async function analyzeGoodCoverage() {
  console.log('🔍 ANALYZING GOOD HTML COVERAGE FOR FALSE POSITIVE DETECTION\n');
  
  // Get all good HTML files
  const testSitesDir = path.join(__dirname, 'test-sites');
  const goodFiles = fs.readdirSync(testSitesDir)
    .filter(file => file.startsWith('good-') && file.endsWith('.html'))
    .sort();

  console.log(`📊 Found ${goodFiles.length} good HTML examples\n`);

  // Test each good file with multiple scanners to detect false positives
  const testScanners = ['color-contrast', 'keyboard-navigation', 'html-validation'];
  const results = [];
  let totalFalsePositives = 0;

  for (const goodFile of goodFiles) {
    console.log(`🔍 Testing: ${goodFile}`);
    const fileUrl = `file://${path.join(testSitesDir, goodFile)}`;
    
    let fileFalsePositives = 0;
    const fileResults = {};
    
    for (const scanner of testScanners) {
      try {
        const result = await makeRequest(`/api/scan/${scanner}`, { url: fileUrl });
        
        const violations = result.result?.violations?.length || 0;
        const passed = result.result?.passed || false;
        
        fileResults[scanner] = { violations, passed };
        
        if (!passed && violations > 0) {
          fileFalsePositives += violations;
          console.log(`   ❌ ${scanner}: ${violations} false positives`);
        } else {
          console.log(`   ✅ ${scanner}: clean (${violations} violations)`);
        }
        
      } catch (error) {
        console.log(`   🔧 ${scanner}: ERROR - ${error.message}`);
        fileResults[scanner] = { error: error.message };
      }
    }
    
    results.push({
      file: goodFile,
      scannerResults: fileResults,
      totalFalsePositives: fileFalsePositives
    });
    
    totalFalsePositives += fileFalsePositives;
    
    if (fileFalsePositives > 0) {
      console.log(`   📊 Total false positives: ${fileFalsePositives}`);
    }
    
    console.log('');
  }
  
  // Analyze coverage gaps
  console.log('\n' + '='.repeat(70));
  console.log('📈 FALSE POSITIVE ANALYSIS');
  console.log('='.repeat(70));
  
  const filesWithFalsePositives = results.filter(r => r.totalFalsePositives > 0);
  
  console.log(`\n📊 Summary:`);
  console.log(`   Good files tested: ${goodFiles.length}`);
  console.log(`   Files with false positives: ${filesWithFalsePositives.length}`);
  console.log(`   Total false positives found: ${totalFalsePositives}`);
  console.log(`   False positive rate: ${((filesWithFalsePositives.length / goodFiles.length) * 100).toFixed(1)}%`);
  
  if (filesWithFalsePositives.length > 0) {
    console.log(`\n🚨 FILES WITH FALSE POSITIVES:`);
    filesWithFalsePositives.forEach(file => {
      console.log(`   - ${file.file}: ${file.totalFalsePositives} violations`);
      Object.entries(file.scannerResults).forEach(([scanner, result]) => {
        if (result.violations > 0) {
          console.log(`     * ${scanner}: ${result.violations} false positives`);
        }
      });
    });
  }
  
  // Analyze pattern coverage
  console.log(`\n🔍 PATTERN COVERAGE ANALYSIS:`);
  
  const patterns = {
    'forms': goodFiles.filter(f => f.includes('form')).length,
    'images': goodFiles.filter(f => f.includes('image') || f.includes('alt')).length,
    'keyboard': goodFiles.filter(f => f.includes('keyboard')).length,
    'aria': goodFiles.filter(f => f.includes('aria')).length,
    'color': goodFiles.filter(f => f.includes('color') || f.includes('contrast')).length,
    'tables': goodFiles.filter(f => f.includes('table')).length,
    'focus': goodFiles.filter(f => f.includes('focus')).length,
    'language': goodFiles.filter(f => f.includes('language')).length,
    'motion': goodFiles.filter(f => f.includes('motion')).length,
    'text': goodFiles.filter(f => f.includes('text')).length
  };
  
  console.log(`\nPattern coverage in good examples:`);
  Object.entries(patterns).forEach(([pattern, count]) => {
    console.log(`   ${pattern.padEnd(12)}: ${count} files`);
  });
  
  // Identify potential gaps
  console.log(`\n⚠️  POTENTIAL COVERAGE GAPS:`);
  
  const lowCoverage = Object.entries(patterns).filter(([_, count]) => count <= 2);
  if (lowCoverage.length > 0) {
    console.log(`   Patterns with ≤2 good examples:`);
    lowCoverage.forEach(([pattern, count]) => {
      console.log(`   - ${pattern}: only ${count} good examples`);
    });
  }
  
  // Suggest additional test cases
  console.log(`\n💡 SUGGESTED ADDITIONAL GOOD HTML EXAMPLES:`);
  console.log(`   1. Modern HTML5 semantic elements (article, section, aside)`);
  console.log(`   2. Complex form patterns (multi-step, validation)`);
  console.log(`   3. Modern CSS Grid/Flexbox layouts`);
  console.log(`   4. Single Page Application (SPA) patterns`);
  console.log(`   5. Media queries and responsive design`);
  console.log(`   6. Web Components and Shadow DOM`);
  console.log(`   7. Progressive Web App (PWA) features`);
  console.log(`   8. Modern JavaScript frameworks (React, Vue, Angular)`);
  console.log(`   9. Advanced ARIA patterns (live regions, complex widgets)`);
  console.log(`   10. Internationalization and RTL layouts`);
  
  console.log(`\n🎯 RECOMMENDATIONS:`);
  if (totalFalsePositives === 0) {
    console.log(`✅ Excellent: No false positives detected in current good examples`);
    console.log(`✅ Scanners appear well-calibrated for existing patterns`);
    console.log(`📈 Consider adding more diverse good examples to stress-test scanners`);
  } else {
    console.log(`❌ ${totalFalsePositives} false positives need investigation`);
    console.log(`🔧 Priority: Fix false positives before adding new test cases`);
  }
  
  console.log(`\n📊 Coverage assessment: ${goodFiles.length}/49 ratio suggests moderate good example coverage`);
  console.log(`🎯 Target: Aim for 1:1 ratio (49 good examples) for comprehensive testing`);
}

analyzeGoodCoverage().catch(console.error);