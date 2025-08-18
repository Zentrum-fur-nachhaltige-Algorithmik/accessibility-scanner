#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');
const fs = require('fs');
const path = require('path');

async function finalStatusCheck() {
  console.log('🏁 FINAL STATUS CHECK - Complete False Positive Elimination Results');
  console.log('='.repeat(70));
  
  const testSitesDir = path.join(__dirname, 'test-sites');
  const goodFiles = fs.readdirSync(testSitesDir)
    .filter(file => file.startsWith('good-') && file.endsWith('.html'))
    .sort();
  
  console.log(`📊 Checking ${goodFiles.length} good files for violations\n`);
  
  const results = [];
  let totalViolations = 0;
  let cleanFiles = 0;
  
  for (const filename of goodFiles) {
    const scanner = new ColorContrastScanner();
    const fileUrl = `file://${__dirname}/test-sites/${filename}`;
    
    try {
      const result = await scanner.scanColorContrast(fileUrl);
      const violations = result.violations.length;
      totalViolations += violations;
      
      if (violations === 0) {
        cleanFiles++;
        console.log(`✅ ${filename}: CLEAN (0 violations)`);
      } else {
        console.log(`❌ ${filename}: ${violations} violations`);
      }
      
      results.push({ filename, violations, passed: violations === 0 });
      await scanner.close();
      
    } catch (error) {
      console.error(`❌ ${filename}: ERROR - ${error.message}`);
      results.push({ filename, error: error.message });
      await scanner.close();
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('🎯 FINAL RESULTS SUMMARY');
  console.log('='.repeat(70));
  
  const problemFiles = results.filter(r => r.violations > 0);
  const successRate = (cleanFiles / goodFiles.length * 100).toFixed(1);
  
  console.log(`📈 SUCCESS METRICS:`);
  console.log(`   ✅ Clean Files: ${cleanFiles}/${goodFiles.length} (${successRate}%)`);
  console.log(`   ❌ Problem Files: ${problemFiles.length}`);
  console.log(`   📊 Total Remaining Violations: ${totalViolations}`);
  
  if (totalViolations === 0) {
    console.log(`\n🎉 COMPLETE SUCCESS! ALL ${goodFiles.length} FILES HAVE 0 VIOLATIONS!`);
    console.log(`🚀 FALSE POSITIVE ELIMINATION: 100% COMPLETE`);
  } else {
    console.log(`\n🔄 ${totalViolations} violations remaining in ${problemFiles.length} files:`);
    problemFiles.forEach(file => {
      console.log(`   ${file.filename}: ${file.violations} violations`);
    });
    
    const eliminationRate = ((cleanFiles / goodFiles.length) * 100).toFixed(1);
    console.log(`\n📊 FALSE POSITIVE ELIMINATION RATE: ${eliminationRate}%`);
  }
  
  // Individual file breakdown for problem files
  if (problemFiles.length > 0 && problemFiles.length <= 5) {
    console.log(`\n🔍 REMAINING PROBLEM FILES ANALYSIS:`);
    
    for (const problemFile of problemFiles.slice(0, 5)) {
      console.log(`\n📋 ${problemFile.filename}:`);
      
      const scanner = new ColorContrastScanner();
      const fileUrl = `file://${__dirname}/test-sites/${problemFile.filename}`;
      
      try {
        const result = await scanner.scanColorContrast(fileUrl);
        
        const colorPatterns = {};
        result.violations.forEach(v => {
          const pattern = `${v.foregroundColor} on ${v.backgroundColor}`;
          colorPatterns[pattern] = (colorPatterns[pattern] || 0) + 1;
        });
        
        Object.entries(colorPatterns)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .forEach(([pattern, count]) => {
            console.log(`   ${count}x: ${pattern}`);
          });
          
        await scanner.close();
        
      } catch (error) {
        console.error(`   Error analyzing: ${error.message}`);
        await scanner.close();
      }
    }
  }
}

finalStatusCheck().catch(console.error);