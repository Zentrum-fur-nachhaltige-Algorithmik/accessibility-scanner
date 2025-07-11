#!/usr/bin/env node

/**
 * Test Phase 1 HTMLValidationScanner with existing test files
 * Tests both good and bad examples to ensure comprehensive rule coverage
 */

const HTMLValidationScanner = require('./src/html-validation-scanner');
const path = require('path');

async function testPhase1WithExistingFiles() {
  console.log('🔬 Testing Phase 1 with Existing Test Files');
  console.log('='.repeat(60));

  const scanner = new HTMLValidationScanner();
  
  const testFiles = [
    {
      name: 'Good Accessibility (Should have few violations)',
      path: path.resolve(__dirname, 'test-sites/good-accessibility.html'),
      expectedViolations: 'few'
    },
    {
      name: 'Bad Color Contrast (Should have HTML structure violations)',
      path: path.resolve(__dirname, 'test-sites/bad-color-contrast.html'),
      expectedViolations: 'some'
    },
    {
      name: 'Phase 1 Test Page (Should have many violations)',
      path: path.resolve(__dirname, 'test-html/phase1-test.html'),
      expectedViolations: 'many'
    }
  ];
  
  try {
    for (const testFile of testFiles) {
      console.log(`\n📊 Testing: ${testFile.name}`);
      console.log(`📂 File: ${testFile.path}`);
      console.log(`🎯 Expected: ${testFile.expectedViolations} violations`);
      
      const fileUrl = `file://${testFile.path}`;
      const startTime = Date.now();
      
      const result = await scanner.scanHTMLCompliance(fileUrl, {
        timeout: 30000
      });
      
      const duration = Date.now() - startTime;
      
      console.log(`\n📈 Results:`);
      console.log(`   ⏱️ Duration: ${duration}ms`);
      console.log(`   📋 Total violations: ${result.violations.length}`);
      console.log(`   📊 Overall passed: ${result.passed}`);
      
      // Analyze rule types
      if (result.violations.length > 0) {
        console.log('\n🔍 Phase 1 Rules Triggered:');
        const ruleTypes = {};
        result.violations.forEach(v => {
          const type = v.issue || v.type || 'unknown';
          ruleTypes[type] = (ruleTypes[type] || 0) + 1;
        });
        
        Object.entries(ruleTypes)
          .sort(([,a], [,b]) => b - a)
          .forEach(([rule, count]) => {
            console.log(`   🔹 ${rule}: ${count} issues`);
          });
      } else {
        console.log('   ✅ No violations found');
      }
      
      // Check for uncovered rules that should be triggered
      console.log('\n🔍 Analysis:');
      const hasButtonViolations = result.violations.some(v => v.issue === 'button-name');
      const hasLinkViolations = result.violations.some(v => v.issue === 'link-name');
      const hasFormViolations = result.violations.some(v => v.issue === 'form-field-label');
      const hasDuplicateIds = result.violations.some(v => v.issue?.includes('duplicate-id'));
      const hasHeadingViolations = result.violations.some(v => v.issue?.includes('heading'));
      
      console.log(`   🔘 Button validation: ${hasButtonViolations ? '✅ Active' : '❌ Not triggered'}`);
      console.log(`   🔗 Link validation: ${hasLinkViolations ? '✅ Active' : '❌ Not triggered'}`);
      console.log(`   📝 Form validation: ${hasFormViolations ? '✅ Active' : '❌ Not triggered'}`);
      console.log(`   🆔 Duplicate ID validation: ${hasDuplicateIds ? '✅ Active' : '❌ Not triggered'}`);
      console.log(`   📄 Heading validation: ${hasHeadingViolations ? '✅ Active' : '❌ Not triggered'}`);
    }
    
    console.log('\n🏆 Phase 1 Comprehensive Test Results:');
    console.log('✅ All test files processed successfully');
    console.log('✅ HTMLValidationScanner working with existing test suite');
    console.log('📋 Ready to identify gaps in rule coverage');
    
    return true;
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    return false;
  } finally {
    await scanner.close();
  }
}

// Run if executed directly
if (require.main === module) {
  testPhase1WithExistingFiles()
    .then(success => {
      console.log(success ? '\n✅ Phase 1 testing with existing files completed!' : '\n❌ Phase 1 testing failed!');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Phase 1 testing error:', error);
      process.exit(1);
    });
}

module.exports = testPhase1WithExistingFiles;