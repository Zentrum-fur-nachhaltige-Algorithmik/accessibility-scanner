const puppeteer = require('puppeteer');

async function debugSpecificIssues() {
  console.log('🔍 Debugging yesterday\'s specific accessibility issues...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('📊 Loading BeeProduced.com...');
    await page.goto('https://beeproduced.com', { 
      waitUntil: 'networkidle0',
      timeout: 45000 
    });
    
    // Wait extra time for dynamic content
    console.log('⏱️  Waiting for dynamic content...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check for logo image issues
    console.log('\n🖼️  CHECKING LOGO ALT-TEXT ISSUE...');
    const logoCheck = await page.evaluate(() => {
      const images = document.querySelectorAll('a img');
      const logoResults = [];
      
      images.forEach((img, i) => {
        const link = img.closest('a');
        const hasAlt = img.hasAttribute('alt') && img.alt.trim() !== '';
        
        logoResults.push({
          index: i + 1,
          src: img.src || 'no-src',
          alt: img.alt || '[MISSING ALT]',
          hasAlt: hasAlt,
          linkHref: link ? link.href : 'no-link',
          isIssue: !hasAlt && link, // Missing alt on linked image
          html: img.outerHTML.substring(0, 150)
        });
      });
      
      return logoResults;
    });
    
    console.log('Logo images found:');
    let logoIssues = 0;
    logoCheck.forEach(logo => {
      console.log(`  ${logo.index}. ${logo.src}`);
      console.log(`     Alt: '${logo.alt}'`);
      console.log(`     Has Alt: ${logo.hasAlt}`);
      console.log(`     Is Issue: ${logo.isIssue ? 'YES - PROBLEM!' : 'No'}`);
      if (logo.isIssue) logoIssues++;
    });
    
    // Check for email input issues
    console.log('\n📧 CHECKING EMAIL INPUT LABEL ISSUE...');
    const emailCheck = await page.evaluate(() => {
      const emailInputs = document.querySelectorAll('input[type="email"], input[placeholder*="mail"], input[placeholder*="email"]');
      const emailResults = [];
      
      emailInputs.forEach((input, i) => {
        const hasLabel = document.querySelector('label[for="' + input.id + '"]');
        const hasAriaLabel = input.hasAttribute('aria-label') && input.getAttribute('aria-label').trim() !== '';
        const hasAriaLabelledBy = input.hasAttribute('aria-labelledby');
        const hasAccessibleName = hasLabel || hasAriaLabel || hasAriaLabelledBy;
        
        emailResults.push({
          index: i + 1,
          id: input.id || 'no-id',
          placeholder: input.placeholder || 'no-placeholder',
          hasLabel: Boolean(hasLabel),
          hasAriaLabel: hasAriaLabel,
          hasAccessibleName: hasAccessibleName,
          isIssue: !hasAccessibleName, // Missing accessible name
          html: input.outerHTML.substring(0, 150)
        });
      });
      
      return emailResults;
    });
    
    console.log('Email inputs found:');
    let emailIssues = 0;
    emailCheck.forEach(email => {
      console.log(`  ${email.index}. ID: ${email.id}`);
      console.log(`     Placeholder: '${email.placeholder}'`);
      console.log(`     Has Label: ${email.hasLabel}`);
      console.log(`     Has ARIA Label: ${email.hasAriaLabel}`);
      console.log(`     Has Accessible Name: ${email.hasAccessibleName}`);
      console.log(`     Is Issue: ${email.isIssue ? 'YES - PROBLEM!' : 'No'}`);
      if (email.isIssue) emailIssues++;
    });
    
    console.log('\n📊 SUMMARY:');
    console.log(`Logo Alt-Text Issues: ${logoIssues}`);
    console.log(`Email Label Issues: ${emailIssues}`);
    console.log(`Total Issues Found: ${logoIssues + emailIssues}`);
    
    if (logoIssues + emailIssues === 0) {
      console.log('\n🤔 NO ISSUES FOUND! This suggests:');
      console.log('1. ✅ BeeProduced.com FIXED the issues since yesterday');
      console.log('2. 🔄 Our scanner timing/config is different'); 
      console.log('3. 🌐 Website content varies by region/cache');
      console.log('4. 🕰️  Dynamic content loading differences');
    } else {
      console.log('\n⚠️  ISSUES CONFIRMED! Scanner should detect these.');
      console.log('This means our Axe configuration needs adjustment.');
    }
    
    return { logoIssues, emailIssues, logoCheck, emailCheck };
    
  } catch (error) {
    console.error('❌ Debug check failed:', error.message);
    return { error: error.message };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  debugSpecificIssues()
    .then(result => {
      if (result.error) {
        console.log('❌ Debug failed:', result.error);
      } else {
        console.log('\n✅ Debugging completed');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = debugSpecificIssues;