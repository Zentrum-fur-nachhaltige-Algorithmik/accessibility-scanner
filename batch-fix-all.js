#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');
const fs = require('fs');
const path = require('path');

// Proven color fixes
const PROVEN_FIXES = {
  '#4caf50': '#327d36',  // Green
  '#2196f3': '#1a78c2',  // Blue  
  '#ff9800': '#a66300',  // Orange
  '#f44336': '#d32f2f',  // Red
  '#cccccc': '#666666',  // Gray
  '#007bff': '#0056b3',  // Bootstrap blue
  '#1976d2': '#0d47a1',  // Dark blue
  '#f57c00': '#bf360c',  // Orange variant
  '#e0e0e0': '#f0f0f0',  // Light gray bg
};

async function rapidFixFile(filename) {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/${filename}`;
  
  console.log(`\n🔍 PROCESSING: ${filename}`);
  
  try {
    // Check current violations
    let result = await scanner.scanColorContrast(fileUrl);
    const originalViolations = result.violations.length;
    
    if (originalViolations === 0) {
      console.log(`✅ Already clean (0 violations)`);
      await scanner.close();
      return { filename, before: 0, after: 0, fixed: true };
    }
    
    console.log(`📊 Found ${originalViolations} violations`);
    
    // Apply proven fixes
    const filePath = path.join(__dirname, 'test-sites', filename);
    let content = fs.readFileSync(filePath, 'utf8');
    let fixesApplied = 0;
    
    for (const [oldColor, newColor] of Object.entries(PROVEN_FIXES)) {
      if (content.includes(oldColor)) {
        content = content.replaceAll(oldColor, newColor);
        fixesApplied++;
        console.log(`   🔧 ${oldColor} → ${newColor}`);
      }
      
      // Also check uppercase
      const oldUpper = oldColor.toUpperCase();
      if (content.includes(oldUpper)) {
        content = content.replaceAll(oldUpper, newColor);
        fixesApplied++;
        console.log(`   🔧 ${oldUpper} → ${newColor}`);
      }
    }
    
    if (fixesApplied > 0) {
      fs.writeFileSync(filePath, content);
      console.log(`   📝 Applied ${fixesApplied} color fixes`);
      
      // Re-test
      result = await scanner.scanColorContrast(fileUrl);
      const finalViolations = result.violations.length;
      
      if (finalViolations === 0) {
        console.log(`   ✅ SUCCESS: ${originalViolations} → 0 violations`);
      } else {
        console.log(`   🔄 PARTIAL: ${originalViolations} → ${finalViolations} violations`);
        
        // Show remaining patterns
        const colorPatterns = {};
        result.violations.forEach(v => {
          const pattern = `${v.foregroundColor} on ${v.backgroundColor}`;
          colorPatterns[pattern] = (colorPatterns[pattern] || 0) + 1;
        });
        
        console.log(`   🔍 Remaining patterns:`);
        Object.entries(colorPatterns)
          .sort(([,a], [,b]) => b - a)
          .forEach(([pattern, count]) => {
            console.log(`      ${count}x: ${pattern}`);
          });
      }
      
      await scanner.close();
      return { 
        filename, 
        before: originalViolations, 
        after: finalViolations, 
        fixed: finalViolations === 0,
        fixesApplied 
      };
    } else {
      console.log(`   ⚠️  No known fixes apply`);
      await scanner.close();
      return { 
        filename, 
        before: originalViolations, 
        after: originalViolations, 
        fixed: false,
        fixesApplied: 0 
      };
    }
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    await scanner.close();
    return { filename, error: error.message };
  }
}

async function batchFixAll() {
  console.log('🚀 BATCH FIXING ALL REMAINING GOOD FILES');
  console.log('='.repeat(50));
  
  // Get all good files
  const testSitesDir = path.join(__dirname, 'test-sites');
  const goodFiles = fs.readdirSync(testSitesDir)
    .filter(file => file.startsWith('good-') && file.endsWith('.html'))
    .sort();
  
  console.log(`📊 Processing ${goodFiles.length} good files`);
  
  const results = [];
  
  for (const file of goodFiles) {
    const result = await rapidFixFile(file);
    results.push(result);
    
    // Small delay to prevent overload
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📈 BATCH FIX SUMMARY');
  console.log('='.repeat(50));
  
  const fixed = results.filter(r => r.fixed && !r.error);
  const partial = results.filter(r => !r.fixed && !r.error && r.fixesApplied > 0);
  const clean = results.filter(r => r.before === 0);
  const errors = results.filter(r => r.error);
  
  console.log(`✅ Fully Fixed: ${fixed.length}`);
  console.log(`🔄 Partially Fixed: ${partial.length}`);
  console.log(`✨ Already Clean: ${clean.length}`);
  console.log(`❌ Errors: ${errors.length}`);
  
  const totalViolationsBefore = results.reduce((sum, r) => sum + (r.before || 0), 0);
  const totalViolationsAfter = results.reduce((sum, r) => sum + (r.after || 0), 0);
  
  console.log(`\n📊 TOTAL IMPACT:`);
  console.log(`   Before: ${totalViolationsBefore} violations`);
  console.log(`   After: ${totalViolationsAfter} violations`);
  console.log(`   Fixed: ${totalViolationsBefore - totalViolationsAfter} violations`);
  console.log(`   Success Rate: ${((totalViolationsBefore - totalViolationsAfter) / totalViolationsBefore * 100).toFixed(1)}%`);
  
  if (partial.length > 0) {
    console.log(`\n🔄 FILES NEEDING MANUAL ATTENTION:`);
    partial.forEach(r => {
      console.log(`   ${r.filename}: ${r.before} → ${r.after} violations`);
    });
  }
  
  if (totalViolationsAfter === 0) {
    console.log(`\n🎉 COMPLETE SUCCESS! All ${goodFiles.length} files have 0 violations!`);
  }
}

batchFixAll().catch(console.error);