const AdvancedContrastScanner = require('./src/advanced-contrast-scanner');
const path = require('path');

/**
 * Debug false positives in the AdvancedContrastScanner
 */
async function debugContrastFalsePositives() {
  console.log('🔍 Debugging Advanced Contrast Scanner False Positives...\n');
  
  const scanner = new AdvancedContrastScanner();
  
  try {
    const goodUrl = `file://${path.join(__dirname, 'test-pages/phase6c-good-responsive.html')}`;
    
    console.log(`📊 Analyzing GOOD example in detail:`);
    console.log(`URL: ${goodUrl}\n`);
    
    const result = await scanner.scanAdvancedContrast(goodUrl);
    
    console.log(`Total violations: ${result.violations.length}`);
    console.log(`Visual evidence items: ${result.visualEvidence.length}\n`);
    
    console.log('📋 Detailed Violation Analysis:');
    result.violations.forEach((violation, i) => {
      console.log(`\n${i + 1}. VIOLATION:`);
      console.log(`   Criterion: ${violation.criterion}`);
      console.log(`   Element: ${violation.element}`);
      console.log(`   Issue: ${violation.issue}`);
      console.log(`   Element Type: ${violation.elementType}`);
      console.log(`   Contrast Ratio: ${violation.contrastRatio?.toFixed(2)}:1`);
      console.log(`   Required Ratio: ${violation.requiredRatio}:1`);
      console.log(`   Description: ${violation.description}`);
      console.log(`   Suggestion: ${violation.suggestion}`);
    });
    
    console.log('\n📋 Visual Evidence Analysis:');
    const evidenceByType = result.visualEvidence.reduce((acc, ev) => {
      if (!acc[ev.type]) acc[ev.type] = [];
      acc[ev.type].push(ev);
      return acc;
    }, {});
    
    Object.entries(evidenceByType).forEach(([type, items]) => {
      console.log(`\n${type.toUpperCase()} (${items.length} items):`);
      items.slice(0, 5).forEach((item, i) => {
        console.log(`  ${i + 1}. Element: ${item.element}`);
        console.log(`     Contrast: ${item.contrastRatio?.toFixed(2) || 'N/A'}:1`);
        if (item.contrastType) console.log(`     Type: ${item.contrastType}`);
        if (item.colors) {
          console.log(`     Colors: ${item.colors.foreground} vs ${item.colors.background}`);
        }
      });
      if (items.length > 5) {
        console.log(`     ... and ${items.length - 5} more`);
      }
    });
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await scanner.close();
  }
}

// Run debug
debugContrastFalsePositives().catch(console.error);