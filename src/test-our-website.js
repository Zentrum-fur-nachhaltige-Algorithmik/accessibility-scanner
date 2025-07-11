const puppeteer = require('puppeteer');
const ScreenReaderScanner = require('./screen-reader-scanner');
const EnhancedAccessibilityScanner = require('./enhanced-scanner');

async function testOurWebsite() {
  const browser = await puppeteer.launch({ 
    headless: false,  // So we can see what's happening
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1200, height: 800 }
  });

  try {
    console.log('🔍 Testing our own accessibility checker website...\n');

    // First let's take some screenshots
    const page = await browser.newPage();
    
    // Test with a mock local HTML version since we can't easily start the servers
    const testHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Web Accessibility Checker - Test</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; line-height: 1.6; color: #333; background: #f8f9fa; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; text-align: center; }
            .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
            .form { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 2rem; }
            .form-group { margin-bottom: 1.5rem; }
            .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
            .form-group input, .form-group select { width: 100%; padding: 0.75rem; border: 2px solid #e1e5e9; border-radius: 4px; }
            .btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 0.75rem 2rem; border-radius: 4px; font-weight: 600; cursor: pointer; }
            .options-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1rem 0; }
            .checkbox-group { display: flex; align-items: center; gap: 0.5rem; }
        </style>
    </head>
    <body>
        <header class="header">
            <h1>Web Accessibility Checker</h1>
            <p>Professional accessibility scanning with WCAG compliance and screen reader support</p>
        </header>

        <main class="container">
            <form class="form">
                <h2>Analyze Website Accessibility</h2>
                
                <div class="form-group">
                    <label for="url">Website URL *</label>
                    <input type="url" id="url" placeholder="https://example.com" required>
                    <small>Enter the full URL including https://</small>
                </div>

                <fieldset>
                    <legend>Scan Options</legend>
                    
                    <div class="options-grid">
                        <div class="form-group">
                            <label for="scan-type">Analysis Type</label>
                            <select id="scan-type">
                                <option value="basic">Basic Scan</option>
                                <option value="enhanced" selected>Enhanced + WCAG</option>
                                <option value="screen-reader">Screen Reader Focus</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="wcag-level">WCAG Compliance Level</label>
                            <select id="wcag-level">
                                <option value="A">Level A</option>
                                <option value="AA" selected>Level AA</option>
                                <option value="AAA">Level AAA</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="timeout">Timeout (seconds)</label>
                            <select id="timeout">
                                <option value="15000">15 seconds</option>
                                <option value="30000" selected>30 seconds</option>
                                <option value="60000">60 seconds</option>
                            </select>
                        </div>
                    </div>

                    <div class="options-grid">
                        <div class="checkbox-group">
                            <input type="checkbox" id="include-warnings" checked>
                            <label for="include-warnings">Include warnings and incomplete tests</label>
                        </div>

                        <div class="checkbox-group">
                            <input type="checkbox" id="test-keyboard-nav">
                            <label for="test-keyboard-nav">Test keyboard navigation</label>
                        </div>
                    </div>
                </fieldset>

                <button type="submit" class="btn">Analyze Accessibility</button>
            </form>
        </main>
    </body>
    </html>
    `;

    await page.setContent(testHTML);
    
    // Take a screenshot
    console.log('📸 Taking screenshot of our website...');
    await page.screenshot({ 
      path: '/tmp/accessibility-checker-website.png',
      fullPage: true 
    });
    console.log('Screenshot saved to /tmp/accessibility-checker-website.png');

    // Test keyboard navigation
    console.log('\n⌨️  Testing keyboard navigation...');
    await page.keyboard.press('Tab');
    const focusedElement1 = await page.evaluate(() => document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''));
    console.log('First tab: Focused on', focusedElement1);

    await page.keyboard.press('Tab');
    const focusedElement2 = await page.evaluate(() => document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''));
    console.log('Second tab: Focused on', focusedElement2);

    await page.keyboard.press('Tab');
    const focusedElement3 = await page.evaluate(() => document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''));
    console.log('Third tab: Focused on', focusedElement3);

    // Test form accessibility
    console.log('\n📝 Testing form accessibility...');
    const formAnalysis = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
      const results = [];
      
      inputs.forEach(input => {
        const label = document.querySelector(`label[for="${input.id}"]`) || input.closest('label');
        const hasLabel = !!label;
        const hasAriaLabel = !!input.getAttribute('aria-label');
        const hasAriaLabelledby = !!input.getAttribute('aria-labelledby');
        
        results.push({
          id: input.id || 'no-id',
          type: input.type || input.tagName.toLowerCase(),
          hasLabel,
          hasAriaLabel,
          hasAriaLabelledby,
          accessible: hasLabel || hasAriaLabel || hasAriaLabelledby
        });
      });
      
      return results;
    });

    console.log('Form accessibility analysis:');
    formAnalysis.forEach(input => {
      const status = input.accessible ? '✅' : '❌';
      console.log(`  ${status} ${input.type}#${input.id}: ${input.accessible ? 'Properly labeled' : 'Missing label'}`);
    });

    // Test color contrast (simple check)
    console.log('\n🎨 Testing color contrast...');
    const contrastCheck = await page.evaluate(() => {
      const headerStyle = window.getComputedStyle(document.querySelector('.header'));
      const buttonStyle = window.getComputedStyle(document.querySelector('.btn'));
      
      return {
        headerBg: headerStyle.background,
        headerColor: headerStyle.color,
        buttonBg: buttonStyle.background,
        buttonColor: buttonStyle.color
      };
    });
    
    console.log('Color analysis:');
    console.log('  Header:', contrastCheck.headerColor, 'on', contrastCheck.headerBg);
    console.log('  Button:', contrastCheck.buttonColor, 'on', contrastCheck.buttonBg);

    await page.close();

    // Now let's run our own accessibility scanner on this HTML
    console.log('\n🔬 Running our own accessibility scanner on our website...');
    
    const tempPage = await browser.newPage();
    await tempPage.setContent(testHTML);
    
    // Save as temp file and scan it
    const fs = require('fs');
    const tempFile = '/tmp/test-website.html';
    fs.writeFileSync(tempFile, testHTML);
    
    // Use file:// URL to test
    const fileUrl = `file://${tempFile}`;
    
    const screenReaderScanner = new ScreenReaderScanner();
    screenReaderScanner.browser = browser; // Reuse the same browser
    
    const report = await screenReaderScanner.screenReaderAnalysis(fileUrl);
    
    console.log('\n📊 Screen Reader Analysis Results:');
    console.log('  Heading Structure:', report.headingStructure.valid ? '✅ Valid' : '❌ Issues found');
    if (report.headingStructure.issues.length > 0) {
      report.headingStructure.issues.forEach(issue => console.log(`    - ${issue}`));
    }
    
    console.log('  Landmarks:');
    console.log(`    - Main: ${report.landmarks.main ? '✅' : '❌'}`);
    console.log(`    - Navigation: ${report.landmarks.navigation ? '✅' : '❌'}`);
    console.log(`    - Banner: ${report.landmarks.banner ? '✅' : '❌'}`);
    
    console.log('  Forms:');
    console.log(`    - Labels correct: ${report.forms.labelsCorrect ? '✅' : '❌'}`);
    console.log(`    - Total inputs: ${report.forms.totalInputs}`);
    
    console.log('  EU Compliance Score:', `${report.euCompliance.en301549.score}/100`);
    
    if (report.euCompliance.en301549.violations.length > 0) {
      console.log('  EU Violations:');
      report.euCompliance.en301549.violations.forEach(violation => {
        console.log(`    - ${violation.clause}: ${violation.description} (${violation.severity})`);
      });
    }

    // Test with Enhanced Scanner too
    console.log('\n🔬 Running Enhanced Scanner...');
    const enhancedScanner = new EnhancedAccessibilityScanner();
    enhancedScanner.browser = browser;
    
    const enhancedReport = await enhancedScanner.enhancedScan(fileUrl, {
      wcagLevel: 'AA',
      testKeyboardNav: true
    });
    
    console.log('\n📊 Enhanced Analysis Results:');
    console.log('  Accessibility Score:', `${enhancedReport.accessibilityScore}/100`);
    console.log('  Violations found:', enhancedReport.violations.length);
    
    if (enhancedReport.violations.length > 0) {
      console.log('  Top violations:');
      enhancedReport.violations.slice(0, 3).forEach(violation => {
        console.log(`    - ${violation.id}: ${violation.description} (${violation.impact})`);
      });
    }
    
    if (enhancedReport.keyboardNavigation) {
      console.log('  Keyboard Navigation:');
      console.log(`    - Tabbable elements: ${enhancedReport.keyboardNavigation.tabbableElements}`);
      console.log(`    - Logical tab order: ${enhancedReport.keyboardNavigation.logicalTabOrder ? '✅' : '❌'}`);
      if (enhancedReport.keyboardNavigation.keyboardTraps.length > 0) {
        console.log(`    - Keyboard traps: ${enhancedReport.keyboardNavigation.keyboardTraps.join(', ')}`);
      }
    }

    await tempPage.close();
    
  } catch (error) {
    console.error('Error testing website:', error);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  testOurWebsite();
}

module.exports = testOurWebsite;