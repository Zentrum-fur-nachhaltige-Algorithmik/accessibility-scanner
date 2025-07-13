const ResilientAccessibilityScanner = require('./src/resilient-accessibility-scanner');

async function testFallbackScanners() {
  console.log('🔍 Testing TIER 3 Fallback Scanners (Axe-independent)...');
  
  const scanner = new ResilientAccessibilityScanner();
  
  try {
    console.log('\n📊 Testing fallback scanners directly...');
    
    // Create directory for screenshots
    const fs = require('fs-extra');
    await fs.ensureDir('/tmp/test-fallback');
    
    // Call the fallback scan method directly
    const fallbackResult = await scanner.comprehensiveFallbackScan('https://beeproduced.com', '/tmp/test-fallback');
    
    console.log('\n📊 FALLBACK SCANNER RESULTS:');
    console.log(`✅ Strategy: ${fallbackResult.strategy}`);
    console.log(`📊 Coverage: ${fallbackResult.coverage.join(', ')}`);
    console.log(`⭐ Aggregated Score: ${fallbackResult.aggregatedScore}`);
    console.log(`🚨 Total Violations: ${fallbackResult.totalViolations}`);
    
    console.log('\n🔍 Individual Scanner Results:');
    Object.keys(fallbackResult.scanners).forEach(scannerName => {
      const result = fallbackResult.scanners[scannerName];
      console.log(`\n  📋 ${scannerName}:`);
      
      if (result.error) {
        console.log(`     ❌ Error: ${result.error}`);
      } else {
        console.log(`     ✅ Success: ${result.success || 'completed'}`);
        
        if (result.violations && result.violations.length > 0) {
          console.log(`     🚨 Violations: ${result.violations.length}`);
          result.violations.slice(0, 3).forEach((violation, i) => {
            console.log(`       ${i + 1}. ${violation.rule || violation.id || violation.type}: ${violation.description ? violation.description.substring(0, 80) + '...' : 'No description'}`);
          });
        } else if (result.issues && result.issues.length > 0) {
          console.log(`     🚨 Issues: ${result.issues.length}`);
          result.issues.slice(0, 3).forEach((issue, i) => {
            console.log(`       ${i + 1}. ${issue.type || issue.rule}: ${issue.message ? issue.message.substring(0, 80) + '...' : 'No message'}`);
          });
        } else {
          console.log(`     ✅ No violations found`);
        }
        
        if (result.score !== undefined) {
          console.log(`     ⭐ Score: ${result.score}`);
        }
      }
    });
    
    // Check specifically for image and form issues
    console.log('\n🎯 CHECKING FOR SPECIFIC ISSUES:');
    
    // Check ScreenReader scanner for missing alt text
    const screenReaderResult = fallbackResult.scanners.ScreenReader;
    if (screenReaderResult && screenReaderResult.violations) {
      const altTextIssues = screenReaderResult.violations.filter(v => 
        (v.rule && v.rule.includes('alt')) || 
        (v.rule && v.rule.includes('image')) || 
        (v.description && v.description.toLowerCase().includes('alt')) || 
        (v.description && v.description.toLowerCase().includes('image'))
      );
      console.log(`  🖼️  Alt-text issues found by ScreenReader: ${altTextIssues.length}`);
    }
    
    // Check HTMLValidation scanner for form issues
    const htmlValidationResult = fallbackResult.scanners.HTMLValidation;
    if (htmlValidationResult && htmlValidationResult.violations) {
      const labelIssues = htmlValidationResult.violations.filter(v => 
        (v.rule && v.rule.includes('label')) || 
        (v.rule && v.rule.includes('form')) ||
        (v.description && v.description.toLowerCase().includes('label')) || 
        (v.description && v.description.toLowerCase().includes('input'))
      );
      console.log(`  📧 Label issues found by HTMLValidation: ${labelIssues.length}`);
    }
    
    console.log('\n🎯 CONCLUSION:');
    if (fallbackResult.totalViolations > 0) {
      console.log('✅ SUCCESS! Fallback scanners found accessibility issues!');
      console.log('This proves the Tier 3 system works when Axe fails.');
    } else {
      console.log('🤔 Fallback scanners also found no issues.');
      console.log('This suggests either:');
      console.log('1. The specialized scanners need enhancement');
      console.log('2. BeeProduced.com really is very accessible');
      console.log('3. Different scanning approaches are needed');
    }
    
    return fallbackResult;
    
  } catch (error) {
    console.error('❌ Fallback scanner test failed:', error.message);
    console.error('Stack:', error.stack);
    return { error: error.message };
  }
}

if (require.main === module) {
  testFallbackScanners()
    .then(result => {
      console.log('\n✅ Fallback scanner test completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = testFallbackScanners;