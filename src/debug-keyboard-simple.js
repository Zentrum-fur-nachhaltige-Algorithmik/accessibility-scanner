const puppeteer = require('puppeteer');
const path = require('path');

/**
 * Simple debug test to understand keyboard navigation issues
 */
async function debugKeyboardSimple() {
  console.log('🔍 Simple Keyboard Debug Test...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const testFile = path.join(__dirname, '../test-pages/phase6b-good-keyboard.html');
    const fileUrl = `file://${testFile}`;
    
    console.log(`Loading: ${fileUrl}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });

    // 1. Discover all interactive elements
    console.log('\n1. Discovering interactive elements...');
    const allElements = await page.evaluate(() => {
      const elements = [];
      const selectors = [
        'a[href]', 'button', 'input', 'textarea', 'select', 
        'details', '[tabindex]:not([tabindex="-1"])', 
        '[role="button"]', '[role="link"]', '[onclick]'
      ];
      
      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach((el, index) => {
          if (!el.hasAttribute('disabled') && !el.hidden) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              elements.push({
                selector: selector,
                id: el.id || `no-id-${index}`,
                className: el.className || 'no-class',
                tagName: el.tagName,
                text: el.textContent.trim().substring(0, 30),
                tabIndex: el.tabIndex,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
              });
            }
          }
        });
      });
      
      return elements;
    });

    console.log(`Found ${allElements.length} interactive elements:`);
    allElements.forEach((el, i) => {
      console.log(`  ${i + 1}. ${el.tagName} (${el.selector}) - "${el.text}" - tabIndex: ${el.tabIndex}`);
    });

    // 2. Test manual Tab navigation
    console.log('\n2. Manual Tab navigation test...');
    
    // Reset focus
    await page.evaluate(() => document.body.focus());
    
    const tabSequence = [];
    for (let i = 0; i < 15; i++) {
      // Get current focus
      const currentFocus = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return { element: 'null', tagName: 'null' };
        
        const rect = active.getBoundingClientRect();
        return {
          element: active.tagName.toLowerCase() + 
                  (active.id ? `#${active.id}` : '') + 
                  (active.className ? `.${active.className.split(' ').join('.')}` : ''),
          tagName: active.tagName,
          text: active.textContent.trim().substring(0, 30),
          x: rect.x,
          y: rect.y
        };
      });

      console.log(`  Step ${i}: Focus on ${currentFocus.element} - "${currentFocus.text}"`);
      tabSequence.push(currentFocus);

      // Press Tab
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Check if focus moved
      const newFocus = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return { element: 'null' };
        
        return {
          element: active.tagName.toLowerCase() + 
                  (active.id ? `#${active.id}` : '') + 
                  (active.className ? `.${active.className.split(' ').join('.')}` : ''),
          tagName: active.tagName
        };
      });

      // Check for trap (same element) - but allow first time
      if (i > 0 && currentFocus.element === newFocus.element) {
        console.log(`    >>> POTENTIAL KEYBOARD TRAP detected at ${currentFocus.element}`);
        console.log(`    >>> Current: ${JSON.stringify(currentFocus)}`);
        console.log(`    >>> New: ${JSON.stringify(newFocus)}`);
        break;
      }

      // Check for cycle (seen before)
      const seen = tabSequence.slice(0, -1).find(prev => prev.element === newFocus.element);
      if (seen) {
        console.log(`    >>> CYCLE detected - returned to ${newFocus.element}`);
        break;
      }
    }

    // 3. Test focus visibility
    console.log('\n3. Testing focus visibility...');
    
    for (const element of allElements.slice(0, 5)) { // Test first 5 elements
      try {
        await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (el) el.focus();
        }, element.selector);

        const focusStyles = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active) return null;
          
          const computed = window.getComputedStyle(active);
          const focusComputed = window.getComputedStyle(active, ':focus');
          
          return {
            element: active.tagName + (active.id ? `#${active.id}` : '') + (active.className ? `.${active.className}` : ''),
            outline: focusComputed.outline,
            outlineColor: focusComputed.outlineColor,
            outlineWidth: focusComputed.outlineWidth,
            outlineStyle: focusComputed.outlineStyle,
            boxShadow: focusComputed.boxShadow,
            backgroundColor: focusComputed.backgroundColor,
            normalOutline: computed.outline,
            normalBoxShadow: computed.boxShadow,
            normalBackgroundColor: computed.backgroundColor
          };
        });

        if (focusStyles) {
          const hasVisibleFocus = 
            (focusStyles.outline && focusStyles.outline !== 'none' && focusStyles.outlineWidth !== '0px') ||
            (focusStyles.boxShadow && focusStyles.boxShadow !== 'none') ||
            (focusStyles.backgroundColor && focusStyles.backgroundColor !== 'rgba(0, 0, 0, 0)');

          console.log(`  ${element.tagName} (${element.selector}): ${hasVisibleFocus ? '✅' : '❌'} visible focus`);
          console.log(`    Focus Outline: "${focusStyles.outline}" (width: ${focusStyles.outlineWidth}, color: ${focusStyles.outlineColor})`);
          console.log(`    Focus BoxShadow: "${focusStyles.boxShadow}"`);
          console.log(`    Normal Outline: "${focusStyles.normalOutline}"`);
          if (!hasVisibleFocus) {
            console.log(`    ❌ No visible focus indicator detected`);
          }
        }
      } catch (error) {
        console.log(`  Error testing ${element.selector}: ${error.message}`);
      }
    }

    console.log('\n🎯 Debug Summary:');
    console.log(`- Found ${allElements.length} interactive elements`);
    console.log(`- Tab sequence length: ${tabSequence.length}`);
    console.log('- Manual verification needed for focus visibility');

  } catch (error) {
    console.error('❌ Debug test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (require.main === module) {
  debugKeyboardSimple().catch(console.error);
}

module.exports = debugKeyboardSimple;