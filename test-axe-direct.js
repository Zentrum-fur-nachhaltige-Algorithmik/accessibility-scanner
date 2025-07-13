const puppeteer = require('puppeteer');

async function testAxeDirect() {
  console.log('🔍 Testing Axe directly with specific rules...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto('https://beeproduced.com', { waitUntil: 'networkidle0' });
    
    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Load axe
    await page.addScriptTag({
      path: './node_modules/axe-core/axe.min.js'
    });
    
    console.log('\n📊 Test 1: Run specific image-alt rule...');
    const imageAltTest = await page.evaluate(() => {
      return new Promise((resolve) => {
        axe.run({
          rules: {
            'image-alt': { enabled: true }
          }
        }, (err, results) => {
          if (err) resolve({ error: err.message });
          else resolve(results);
        });
      });
    });
    
    console.log(`Image-alt violations: ${imageAltTest.violations?.length || 0}`);
    if (imageAltTest.violations?.length > 0) {
      imageAltTest.violations.forEach(v => {
        console.log(`  - ${v.id}: ${v.description}`);
      });
    }
    
    console.log('\n📊 Test 2: Run specific label rule...');
    const labelTest = await page.evaluate(() => {
      return new Promise((resolve) => {
        axe.run({
          rules: {
            'label': { enabled: true }
          }
        }, (err, results) => {
          if (err) resolve({ error: err.message });
          else resolve(results);
        });
      });
    });
    
    console.log(`Label violations: ${labelTest.violations?.length || 0}`);
    if (labelTest.violations?.length > 0) {
      labelTest.violations.forEach(v => {
        console.log(`  - ${v.id}: ${v.description}`);
      });
    }
    
    console.log('\n📊 Test 3: Run ALL rules without restrictions...');
    const allRulesTest = await page.evaluate(() => {
      return new Promise((resolve) => {
        // Just run axe with no config - all default rules
        axe.run((err, results) => {
          if (err) resolve({ error: err.message });
          else resolve(results);
        });
      });
    });
    
    console.log(`All rules violations: ${allRulesTest.violations?.length || 0}`);
    if (allRulesTest.violations?.length > 0) {
      console.log('Found violations:');
      allRulesTest.violations.forEach(v => {
        console.log(`  - ${v.id} (${v.impact}): ${v.description}`);
      });
    }
    
    console.log('\n📊 Test 4: Check what rules are available...');
    const availableRules = await page.evaluate(() => {
      return axe.getRules();
    });
    
    const imageRules = availableRules.filter(rule => rule.ruleId.includes('image') || rule.ruleId.includes('alt'));
    const labelRules = availableRules.filter(rule => rule.ruleId.includes('label'));
    
    console.log('Image/Alt related rules:');
    imageRules.forEach(rule => {
      console.log(`  - ${rule.ruleId}: ${rule.description}`);
    });
    
    console.log('Label related rules:');
    labelRules.forEach(rule => {
      console.log(`  - ${rule.ruleId}: ${rule.description}`);
    });
    
    return {
      imageAltTest,
      labelTest,
      allRulesTest,
      availableRules: availableRules.length
    };
    
  } catch (error) {
    console.error('❌ Direct axe test failed:', error.message);
    return { error: error.message };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  testAxeDirect()
    .then(result => {
      console.log('\n✅ Direct axe testing completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = testAxeDirect;