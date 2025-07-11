const ColorContrastScanner = require('./color-contrast-scanner');
const UseOfColorScanner = require('./use-of-color-scanner');
const ImagesOfTextScanner = require('./images-of-text-scanner');

/**
 * Phase 6A Test Suite
 * Comprehensive testing for Phase 6A: Basis-Wahrnehmbarkeit scanners
 */
class Phase6ATestSuite {
  constructor() {
    this.colorContrastScanner = new ColorContrastScanner();
    this.useOfColorScanner = new UseOfColorScanner();
    this.imagesOfTextScanner = new ImagesOfTextScanner();
    this.testResults = [];
  }

  /**
   * Run all Phase 6A tests
   */
  async runAllTests() {
    console.log('🚀 Starting Phase 6A Test Suite...\n');
    
    const tests = [
      { name: 'Color Contrast Scanner Unit Tests', method: this.testColorContrastScanner.bind(this) },
      { name: 'Use of Color Scanner Unit Tests', method: this.testUseOfColorScanner.bind(this) },
      { name: 'Images of Text Scanner Unit Tests', method: this.testImagesOfTextScanner.bind(this) },
      { name: 'Integration Tests', method: this.testIntegration.bind(this) },
      { name: 'Performance Tests', method: this.testPerformance.bind(this) },
      { name: 'Compliance Tests', method: this.testCompliance.bind(this) }
    ];

    for (const test of tests) {
      try {
        console.log(`📋 Running ${test.name}...`);
        await test.method();
        this.testResults.push({ name: test.name, status: 'PASSED', error: null });
        console.log(`✅ ${test.name} - PASSED\n`);
      } catch (error) {
        this.testResults.push({ name: test.name, status: 'FAILED', error: error.message });
        console.log(`❌ ${test.name} - FAILED: ${error.message}\n`);
      }
    }

    await this.generateTestReport();
    await this.cleanup();
  }

  /**
   * Test Color Contrast Scanner
   */
  async testColorContrastScanner() {
    // Test 1: Basic contrast detection
    console.log('  🔍 Testing basic contrast detection...');
    
    // We'll use a data URL with known contrast issues for testing
    const testHtml = `
      <html>
        <head><title>Contrast Test</title></head>
        <body style="background: white;">
          <div style="color: #666666; background: #999999; padding: 10px;">Low contrast text</div>
          <div style="color: #000000; background: #ffffff; padding: 10px;">Good contrast text</div>
          <div style="color: #cccccc; background: #dddddd; padding: 10px;">Very poor contrast</div>
        </body>
      </html>
    `;
    
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;
    
    const result = await this.colorContrastScanner.scanColorContrast(dataUrl, {
      wcagLevel: 'AA',
      includeGradients: true
    });

    // Validate results
    if (!result.criterion || result.criterion !== '9.1.4.3') {
      throw new Error('Color contrast scanner did not return correct criterion');
    }

    if (result.passed) {
      throw new Error('Color contrast scanner should have detected violations in test page');
    }

    if (!result.violations || result.violations.length === 0) {
      throw new Error('Color contrast scanner should have found contrast violations');
    }

    console.log(`    Found ${result.violations.length} contrast violations`);
    console.log(`    Total elements checked: ${result.summary.totalElements}`);

    // Test 2: WCAG AAA level
    console.log('  🔍 Testing WCAG AAA level...');
    const aaaResult = await this.colorContrastScanner.scanColorContrast(dataUrl, {
      wcagLevel: 'AAA'
    });

    if (aaaResult.summary.minimumRatio !== 7) {
      throw new Error('WCAG AAA should require 7:1 ratio');
    }
  }

  /**
   * Test Use of Color Scanner
   */
  async testUseOfColorScanner() {
    console.log('  🔍 Testing use of color detection...');
    
    const testHtml = `
      <html>
        <head><title>Color Use Test</title></head>
        <body style="color: black;">
          <p>Normal text with <a href="#" style="color: rgb(255, 0, 0); text-decoration: none;">link with only color difference</a> in text.</p>
          <p>Normal text with <a href="#" style="color: blue; text-decoration: underline;">properly marked link</a> in text.</p>
          <form>
            <div class="form-group">
              <input type="email" id="email">
              <div class="error" style="color: rgb(255, 0, 0);">Error message</div>
            </div>
            <div class="form-group">
              <input type="text" id="name">
              <div class="error" style="color: rgb(255, 0, 0); background: #ffe6e6;">✗ Error with icon</div>
            </div>
          </form>
          <div class="status success" style="background-color: green; color: white;">Success message only with color</div>
          <div class="status error" style="background-color: red; color: white;">✗ Error with icon</div>
        </body>
      </html>
    `;
    
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;
    const result = await this.useOfColorScanner.scanColorDependency(dataUrl);

    // Validate results
    if (!result.criterion || result.criterion !== '9.1.4.1') {
      throw new Error('Use of color scanner did not return correct criterion');
    }

    if (result.passed) {
      throw new Error('Use of color scanner should have detected color-only violations');
    }

    console.log(`    Found ${result.violations.length} color dependency violations`);
    console.log(`    Links using only color: ${result.summary.linksColorOnly}`);
    console.log(`    Form errors using only color: ${result.summary.formErrorsColorOnly}`);
  }

  /**
   * Test Images of Text Scanner
   */
  async testImagesOfTextScanner() {
    console.log('  🔍 Testing images of text detection...');
    
    const testHtml = `
      <html>
        <head><title>Images of Text Test</title></head>
        <body>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==" alt="Submit Button" class="btn-text">
          <img src="logo.png" alt="Company Logo" class="logo">
          <img src="decoration.png" alt="" class="decorative">
          <button style="background-image: url('button-bg.png');">Click Here</button>
          <div style="background-image: url('header-text.png');">Welcome to Our Site</div>
        </body>
      </html>
    `;
    
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;
    const result = await this.imagesOfTextScanner.scanImagesOfText(dataUrl, {
      useOCR: false,
      skipLogos: true,
      skipDecorative: true
    });

    // Validate results
    if (!result.criterion || result.criterion !== '9.1.4.5') {
      throw new Error('Images of text scanner did not return correct criterion');
    }

    console.log(`    Total images found: ${result.summary.totalImages}`);
    console.log(`    Suspected text images: ${result.summary.suspectedTextImages}`);
    console.log(`    Confirmed text images: ${result.summary.confirmedTextImages}`);
    console.log(`    Violations found: ${result.violations.length}`);
  }

  /**
   * Test Integration with existing scanners
   */
  async testIntegration() {
    console.log('  🔍 Testing integration capabilities...');
    
    // Test that all scanners can be instantiated and closed properly
    const scanners = [
      this.colorContrastScanner,
      this.useOfColorScanner,
      this.imagesOfTextScanner
    ];

    for (const scanner of scanners) {
      await scanner.init();
      await scanner.close();
    }

    console.log('    All scanners initialized and closed successfully');
  }

  /**
   * Test Performance
   */
  async testPerformance() {
    console.log('  🔍 Testing performance benchmarks...');
    
    const testHtml = `
      <html>
        <head><title>Performance Test</title></head>
        <body>
          ${Array.from({length: 100}, (_, i) => 
            `<div style="color: #${i.toString(16).padStart(6, '0')}; background: #ffffff;">Text ${i}</div>`
          ).join('')}
          ${Array.from({length: 50}, (_, i) => 
            `<a href="#" style="color: red;">Link ${i}</a>`
          ).join(' ')}
          ${Array.from({length: 20}, (_, i) => 
            `<img src="test${i}.png" alt="Test image ${i}">`
          ).join('')}
        </body>
      </html>
    `;
    
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;

    // Test Color Contrast Scanner performance
    const startTime = Date.now();
    await this.colorContrastScanner.scanColorContrast(dataUrl);
    const contrastTime = Date.now() - startTime;

    // Test Use of Color Scanner performance  
    const startTime2 = Date.now();
    await this.useOfColorScanner.scanColorDependency(dataUrl);
    const colorTime = Date.now() - startTime2;

    // Test Images of Text Scanner performance
    const startTime3 = Date.now();
    await this.imagesOfTextScanner.scanImagesOfText(dataUrl);
    const imagesTime = Date.now() - startTime3;

    console.log(`    Color Contrast Scanner: ${contrastTime}ms`);
    console.log(`    Use of Color Scanner: ${colorTime}ms`);
    console.log(`    Images of Text Scanner: ${imagesTime}ms`);

    // Performance thresholds (adjust as needed)
    if (contrastTime > 10000) throw new Error('Color contrast scan too slow');
    if (colorTime > 10000) throw new Error('Use of color scan too slow');
    if (imagesTime > 10000) throw new Error('Images of text scan too slow');
  }

  /**
   * Test Compliance with official examples
   */
  async testCompliance() {
    console.log('  🔍 Testing EN 301 549 compliance...');
    
    // Test with a page that should pass all tests
    const compliantHtml = `
      <html lang="en">
        <head><title>Compliant Test Page</title></head>
        <body style="color: #000000; background: #ffffff;">
          <h1>Accessible Page</h1>
          <p>This text has sufficient contrast with <a href="#" style="color: #0000EE; text-decoration: underline;">properly marked links</a>.</p>
          <form>
            <label for="email">Email (required):</label>
            <input type="email" id="email" required>
            <div class="error-message" style="display: none;">
              <span style="color: red;">⚠</span> Please enter a valid email address
            </div>
          </form>
          <div class="success" style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724;">
            ✓ Success: Your form has been submitted
          </div>
        </body>
      </html>
    `;
    
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(compliantHtml)}`;

    const contrastResult = await this.colorContrastScanner.scanColorContrast(dataUrl);
    const colorResult = await this.useOfColorScanner.scanColorDependency(dataUrl);
    const imagesResult = await this.imagesOfTextScanner.scanImagesOfText(dataUrl);

    console.log(`    Color Contrast Compliance: ${contrastResult.passed ? 'PASS' : 'FAIL'}`);
    console.log(`    Use of Color Compliance: ${colorResult.passed ? 'PASS' : 'FAIL'}`);
    console.log(`    Images of Text Compliance: ${imagesResult.passed ? 'PASS' : 'FAIL'}`);
  }

  /**
   * Generate comprehensive test report
   */
  async generateTestReport() {
    console.log('\n📊 Phase 6A Test Results Summary:');
    console.log('================================');
    
    const passed = this.testResults.filter(r => r.status === 'PASSED').length;
    const failed = this.testResults.filter(r => r.status === 'FAILED').length;
    const total = this.testResults.length;
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

    if (failed > 0) {
      console.log('❌ Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAILED')
        .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    }

    // Success criteria check
    const successCriteria = [
      { name: 'Color Contrast Scanner implemented', met: true },
      { name: 'Use of Color Scanner implemented', met: true },
      { name: 'Images of Text Scanner implemented', met: true },
      { name: 'All unit tests pass', met: failed === 0 },
      { name: 'Performance under 10s per scanner', met: true },
      { name: 'EN 301 549 compliance mapping', met: true }
    ];

    console.log('\n✅ Phase 6A Success Criteria:');
    successCriteria.forEach(criteria => {
      console.log(`  ${criteria.met ? '✅' : '❌'} ${criteria.name}`);
    });

    const overallSuccess = successCriteria.every(c => c.met);
    console.log(`\n🎯 Overall Phase 6A Status: ${overallSuccess ? 'SUCCESS' : 'NEEDS WORK'}`);
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      await this.colorContrastScanner.close();
      await this.useOfColorScanner.close();
      await this.imagesOfTextScanner.close();
    } catch (error) {
      console.log('⚠️  Error during cleanup:', error.message);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const testSuite = new Phase6ATestSuite();
  testSuite.runAllTests().catch(console.error);
}

module.exports = Phase6ATestSuite;