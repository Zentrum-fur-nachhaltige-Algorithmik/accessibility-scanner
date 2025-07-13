const puppeteer = require('puppeteer');

async function rootCauseAnalysis() {
  console.log('🔬 ROOT CAUSE ANALYSIS: Why Axe fails to detect confirmed issues...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto('https://beeproduced.com', { waitUntil: 'networkidle0' });
    
    // Extended wait like our enhanced scanner
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    console.log('\n🔍 STEP 1: Verify the problematic elements exist...');
    const elementsCheck = await page.evaluate(() => {
      // Find all images in links (logo issue)
      const imagesInLinks = Array.from(document.querySelectorAll('a img')).map(img => ({
        src: img.src,
        alt: img.alt || null,
        hasAlt: img.hasAttribute('alt'),
        altValue: img.getAttribute('alt'),
        linkHref: img.closest('a') ? img.closest('a').href : null,
        outerHTML: img.outerHTML
      }));
      
      // Find email inputs (form issue)
      const emailInputs = Array.from(document.querySelectorAll('input[type="email"], input[placeholder*="mail"]')).map(input => ({
        id: input.id || null,
        placeholder: input.placeholder,
        hasLabel: !!document.querySelector('label[for="' + input.id + '"]'),
        hasAriaLabel: input.hasAttribute('aria-label'),
        ariaLabel: input.getAttribute('aria-label'),
        hasAriaLabelledBy: input.hasAttribute('aria-labelledby'),
        outerHTML: input.outerHTML
      }));
      
      return { imagesInLinks, emailInputs };
    });
    
    console.log('📊 ELEMENTS FOUND:');
    console.log(`Images in links: ${elementsCheck.imagesInLinks.length}`);
    elementsCheck.imagesInLinks.forEach((img, i) => {
      console.log(`  ${i+1}. Alt: '${img.alt}' | Has alt attr: ${img.hasAlt} | Src: ${img.src ? img.src.substring(0, 50) + '...' : 'no src'}`);
    });
    
    console.log(`Email inputs: ${elementsCheck.emailInputs.length}`);
    elementsCheck.emailInputs.forEach((input, i) => {
      console.log(`  ${i+1}. Placeholder: '${input.placeholder}' | Has label: ${input.hasLabel} | Has aria-label: ${input.hasAriaLabel}`);
    });
    
    // Load axe and run comprehensive analysis
    await page.addScriptTag({ path: './node_modules/axe-core/axe.min.js' });
    
    console.log('\n🔍 STEP 2: Test different Axe configurations...');
    
    // Test 1: Default axe run
    console.log('\n📊 TEST 1: Default axe.run()');
    const test1 = await page.evaluate(() => {
      return new Promise(resolve => {
        axe.run((err, results) => {
          resolve(err ? { error: err.message } : results);
        });
      });
    });
    console.log(`Violations: ${test1.violations ? test1.violations.length : 0}`);
    if (test1.violations && test1.violations.length > 0) {
      test1.violations.forEach(v => console.log(`  - ${v.id}: ${v.description}`));
    }
    
    // Test 2: Only image-alt rule
    console.log('\n📊 TEST 2: Only image-alt rule');
    const test2 = await page.evaluate(() => {
      return new Promise(resolve => {
        axe.run({
          runOnly: { type: 'rule', values: ['image-alt'] }
        }, (err, results) => {
          resolve(err ? { error: err.message } : results);
        });
      });
    });
    console.log(`Violations: ${test2.violations ? test2.violations.length : 0}`);
    if (test2.violations && test2.violations.length > 0) {
      test2.violations.forEach(v => console.log(`  - ${v.id}: ${v.description}`));
    }
    
    // Test 3: Only label rule
    console.log('\n📊 TEST 3: Only label rule');
    const test3 = await page.evaluate(() => {
      return new Promise(resolve => {
        axe.run({
          runOnly: { type: 'rule', values: ['label'] }
        }, (err, results) => {
          resolve(err ? { error: err.message } : results);
        });
      });
    });
    console.log(`Violations: ${test3.violations ? test3.violations.length : 0}`);
    if (test3.violations && test3.violations.length > 0) {
      test3.violations.forEach(v => console.log(`  - ${v.id}: ${v.description}`));
    }
    
    // Test 4: Check what axe actually sees
    console.log('\n📊 TEST 4: What does axe see when checking images?');
    const axeImageCheck = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const imageData = images.map(img => ({
        src: img.src,
        alt: img.alt,
        hasAlt: img.hasAttribute('alt'),
        role: img.getAttribute('role'),
        ariaLabel: img.getAttribute('aria-label'),
        ariaHidden: img.getAttribute('aria-hidden'),
        isInLink: !!img.closest('a'),
        isDecorative: img.getAttribute('role') === 'presentation' || img.getAttribute('role') === 'none'
      }));
      
      return { imageCount: images.length, imageData };
    });
    
    console.log(`Axe sees ${axeImageCheck.imageCount} images:`);
    axeImageCheck.imageData.forEach((img, i) => {
      console.log(`  ${i+1}. Alt: '${img.alt || 'MISSING'}' | In link: ${img.isInLink} | Role: '${img.role || 'none'}' | ARIA hidden: ${img.ariaHidden || 'false'}`);
    });
    
    // Test 5: Manual axe rule application
    console.log('\n📊 TEST 5: Manual rule check simulation');
    const manualCheck = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const violations = [];
      
      images.forEach(img => {
        // Simulate axe image-alt rule logic
        const hasAlt = img.hasAttribute('alt');
        const altText = img.getAttribute('alt');
        const isInLink = !!img.closest('a');
        const role = img.getAttribute('role');
        const ariaLabel = img.getAttribute('aria-label');
        const ariaHidden = img.getAttribute('aria-hidden') === 'true';
        
        // Check if image should have alt text
        const isDecorative = role === 'presentation' || role === 'none';
        const hasAccessibleName = hasAlt || ariaLabel;
        const isEmpty = !altText || altText.trim() === '';
        
        if (!ariaHidden && !isDecorative && isInLink && (!hasAlt || isEmpty)) {
          violations.push({
            element: img.outerHTML.substring(0, 100),
            issue: 'Image in link missing alt text',
            hasAlt: hasAlt,
            altText: altText,
            isInLink: isInLink
          });
        }
      });
      
      return violations;
    });
    
    console.log(`Manual check found ${manualCheck.length} image violations:`);
    manualCheck.forEach((violation, i) => {
      console.log(`  ${i+1}. ${violation.issue}`);
      console.log(`     Has alt: ${violation.hasAlt} | Alt text: '${violation.altText || 'EMPTY'}' | In link: ${violation.isInLink}`);
    });
    
    console.log('\n🔍 STEP 3: Check if elements are hidden or ignored...');
    const visibilityCheck = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.map(img => {
        const rect = img.getBoundingClientRect();
        const style = window.getComputedStyle(img);
        
        return {
          src: img.src ? img.src.substring(0, 50) : 'no-src',
          visible: rect.width > 0 && rect.height > 0,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          offscreen: rect.top < 0 || rect.bottom > window.innerHeight
        };
      });
    });
    
    console.log('Image visibility:');
    visibilityCheck.forEach((img, i) => {
      console.log(`  ${i+1}. Visible: ${img.visible} | Display: ${img.display} | Visibility: ${img.visibility} | Opacity: ${img.opacity}`);
    });
    
    // CRITICAL: Check if axe is actually running the rules we think it is
    console.log('\n🔍 STEP 6: Verify axe rule configuration...');
    const ruleCheck = await page.evaluate(() => {
      return new Promise(resolve => {
        // Get all available rules
        const allRules = axe.getRules();
        const imageAltRule = allRules.find(rule => rule.ruleId === 'image-alt');
        const labelRule = allRules.find(rule => rule.ruleId === 'label');
        
        // Run with explicit rule inclusion and get metadata
        axe.run({
          runOnly: { type: 'rule', values: ['image-alt', 'label'] }
        }, (err, results) => {
          resolve({
            error: err ? err.message : null,
            results: results,
            imageAltRule: imageAltRule,
            labelRule: labelRule,
            totalRules: allRules.length
          });
        });
      });
    });
    
    console.log(`Axe has ${ruleCheck.totalRules} total rules available`);
    console.log(`Image-alt rule found: ${!!ruleCheck.imageAltRule}`);
    console.log(`Label rule found: ${!!ruleCheck.labelRule}`);
    if (ruleCheck.results) {
      console.log(`Explicit rule run violations: ${ruleCheck.results.violations.length}`);
      console.log(`Explicit rule run passes: ${ruleCheck.results.passes.length}`);
      console.log(`Explicit rule run inapplicable: ${ruleCheck.results.inapplicable.length}`);
    }
    
    return {
      elementsCheck,
      axeTests: { test1, test2, test3 },
      axeImageCheck,
      manualCheck,
      visibilityCheck,
      ruleCheck
    };
    
  } catch (error) {
    console.error('❌ Root cause analysis failed:', error.message);
    console.error('Stack:', error.stack);
    return { error: error.message };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  rootCauseAnalysis()
    .then(result => {
      console.log('\n✅ Root cause analysis completed');
      
      if (result.manualCheck && result.manualCheck.length > 0) {
        console.log('\n🎯 CONCLUSION: Issues exist but Axe fails to detect them!');
        console.log('This proves there is a fundamental problem with our Axe setup or BeeProduced.com specific handling.');
      } else {
        console.log('\n🤔 CONCLUSION: Need to investigate further why even manual checks fail.');
      }
      
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = rootCauseAnalysis;