#!/usr/bin/env node

const ColorContrastScanner = require('./src/color-contrast-scanner.js');

async function rapidFixTables() {
  const scanner = new ColorContrastScanner();
  const fileUrl = `file://${__dirname}/test-sites/good-complex-data-tables.html`;
  
  console.log('🔍 RAPID FIX: good-complex-data-tables.html');
  
  try {
    const result = await scanner.scanColorContrast(fileUrl);
    console.log(`📊 Violations: ${result.violations.length}`);
    
    if (result.violations.length > 0) {
      const colorPatterns = {};
      result.violations.forEach(v => {
        const pattern = `${v.foregroundColor} on ${v.backgroundColor}`;
        colorPatterns[pattern] = (colorPatterns[pattern] || 0) + 1;
      });
      
      Object.entries(colorPatterns)
        .sort(([,a], [,b]) => b - a)
        .forEach(([pattern, count]) => {
          console.log(`  ${count}x: ${pattern}`);
        });
    }
    
    await scanner.close();
    return result;
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    await scanner.close();
    return null;
  }
}

rapidFixTables().catch(console.error);