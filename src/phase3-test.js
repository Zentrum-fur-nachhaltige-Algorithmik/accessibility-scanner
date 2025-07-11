const ScreenReaderScanner = require('./screen-reader-scanner');

async function runPhase3Tests() {
  const scanner = new ScreenReaderScanner();
  
  console.log('Running Phase 3 Test Cases - Screen Reader & EU Compliance...\n');

  try {
    console.log('=== Test 7: Heading Structure Analysis ===');
    console.log('Testing with: https://example.com');
    const test7 = await scanner.screenReaderAnalysis('https://example.com');
    
    console.log('Heading Structure Result:', {
      valid: test7.headingStructure.valid,
      totalHeadings: test7.headingStructure.totalHeadings,
      h1Count: test7.headingStructure.h1Count,
      issuesFound: test7.headingStructure.issues.length,
      sampleIssues: test7.headingStructure.issues.slice(0, 3)
    });
    
    if (test7.headingStructure.hierarchy.length > 0) {
      console.log('Heading Hierarchy Sample:', 
        test7.headingStructure.hierarchy.slice(0, 3).map(h => ({
          level: h.level,
          text: h.text.substring(0, 50),
          tagName: h.tagName
        }))
      );
    }
    console.log('✓ Test 7 completed\n');

    console.log('=== Test 8: EU Compliance Check ===');
    console.log('EU Compliance Results:', {
      en301549Score: test7.euCompliance.en301549.score,
      compliant: test7.euCompliance.en301549.compliant,
      violationsCount: test7.euCompliance.en301549.violations.length,
      eaaReady: test7.euCompliance.eaaCompliance.ready,
      missingRequirements: test7.euCompliance.eaaCompliance.missingRequirements
    });
    
    if (test7.euCompliance.en301549.violations.length > 0) {
      console.log('Sample EU Violations:');
      test7.euCompliance.en301549.violations.slice(0, 2).forEach(violation => {
        console.log(`  - ${violation.clause}: ${violation.description} (${violation.severity})`);
      });
    }
    console.log('✓ Test 8 completed\n');

    console.log('=== Landmark Analysis Test ===');
    console.log('Landmarks Found:', {
      main: test7.landmarks.main,
      navigation: test7.landmarks.navigation,
      banner: test7.landmarks.banner,
      contentinfo: test7.landmarks.contentinfo,
      landmarkCount: test7.landmarks.landmarkCount,
      issues: test7.landmarks.issues
    });
    console.log('✓ Landmark analysis completed\n');

    console.log('=== Image Analysis Test ===');
    console.log('Image Accessibility:', {
      totalImages: test7.images.total,
      withAlt: test7.images.withAlt,
      decorative: test7.images.decorative,
      problematicCount: test7.images.problematic.length
    });
    
    if (test7.images.problematic.length > 0) {
      console.log('Sample Image Issues:', 
        test7.images.problematic.slice(0, 2).map(img => ({
          issue: img.issue,
          severity: img.severity
        }))
      );
    }
    console.log('✓ Image analysis completed\n');

    console.log('=== Form Analysis Test ===');
    console.log('Form Accessibility:', {
      totalForms: test7.forms.totalForms,
      totalInputs: test7.forms.totalInputs,
      labelsCorrect: test7.forms.labelsCorrect,
      errorHandling: test7.forms.errorHandling,
      requiredFieldsCount: test7.forms.requiredFields.length
    });
    console.log('✓ Form analysis completed\n');

    console.log('=== ARIA Usage Test ===');
    console.log('ARIA Analysis:', {
      totalAriaElements: test7.ariaUsage.totalAriaElements,
      correctUsage: test7.ariaUsage.correctUsage,
      misusedAttributesCount: test7.ariaUsage.misusedAttributes.length,
      recommendationsCount: test7.ariaUsage.recommendations.length
    });
    
    if (test7.ariaUsage.misusedAttributes.length > 0) {
      console.log('ARIA Issues:', test7.ariaUsage.misusedAttributes.slice(0, 2));
    }
    console.log('✓ ARIA analysis completed\n');

    console.log('=== Performance Test ===');
    const startTime = Date.now();
    await scanner.screenReaderAnalysis('https://example.com');
    const duration = Date.now() - startTime;
    console.log(`Screen reader analysis completed in ${duration}ms`);
    console.log(`✓ Performance: ${duration < 45000 ? 'PASSED' : 'FAILED'} (< 45 seconds)`);

    console.log('\n=== Complex Website Test ===');
    console.log('Testing with a more complex site...');
    try {
      const complexTest = await scanner.screenReaderAnalysis('https://news.ycombinator.com');
      console.log('Complex Site Results:', {
        headings: complexTest.headingStructure.totalHeadings,
        images: complexTest.images.total,
        forms: complexTest.forms.totalForms,
        ariaElements: complexTest.ariaUsage.totalAriaElements,
        euScore: complexTest.euCompliance.en301549.score
      });
      console.log('✓ Complex website test completed');
    } catch (error) {
      console.log('⚠ Complex website test failed (expected with some sites)');
    }

  } catch (error) {
    console.error('Phase 3 test failed:', error);
  } finally {
    await scanner.close();
    console.log('\nAll Phase 3 tests completed!');
  }
}

if (require.main === module) {
  runPhase3Tests();
}

module.exports = runPhase3Tests;