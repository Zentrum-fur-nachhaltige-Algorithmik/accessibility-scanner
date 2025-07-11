const puppeteer = require('puppeteer');
const path = require('path');

/**
 * Dedicated focus detection debugging
 */
async function debugFocusDetection() {
  console.log('🔍 Focus Detection Debug Test...\n');

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

    // Test specific elements to understand the focus detection issue
    const testElements = [
      'a[href]',
      'button',
      'input[type="text"]'
    ];

    for (const selector of testElements) {
      console.log(`\n📍 Testing: ${selector}`);
      
      try {
        // Focus the element
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.focus();
            console.log('Focused:', el.tagName, el.id || el.className || 'no-id');
          }
        }, selector);

        // Take screenshot of focused element
        await page.screenshot({
          path: path.join(__dirname, '../tmp', `focus-debug-${selector.replace(/[\[\]]/g, '')}.png`)
        });

        // Get comprehensive style information
        const styleInfo = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active || active === document.body) return null;

          const rect = active.getBoundingClientRect();
          const computed = window.getComputedStyle(active);
          
          // Try different approaches to get focus styles
          const styles = {
            element: active.tagName + (active.id ? `#${active.id}` : '') + (active.className ? `.${active.className.split(' ')[0]}` : ''),
            
            // Current computed styles (should include focus styles if element is focused)
            current: {
              outline: computed.outline,
              outlineColor: computed.outlineColor,
              outlineWidth: computed.outlineWidth,
              outlineStyle: computed.outlineStyle,
              outlineOffset: computed.outlineOffset,
              boxShadow: computed.boxShadow,
              border: computed.border,
              borderColor: computed.borderColor,
              borderWidth: computed.borderWidth,
              backgroundColor: computed.backgroundColor
            },
            
            // CSS rules analysis
            cssRules: [],
            
            // Visual checks
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };

          // Try to get CSS rules that might apply
          try {
            const sheets = Array.from(document.styleSheets);
            for (const sheet of sheets) {
              try {
                const rules = Array.from(sheet.cssRules || sheet.rules || []);
                for (const rule of rules) {
                  if (rule.selectorText && rule.selectorText.includes(':focus')) {
                    styles.cssRules.push({
                      selector: rule.selectorText,
                      outline: rule.style.outline,
                      outlineColor: rule.style.outlineColor,
                      outlineWidth: rule.style.outlineWidth,
                      boxShadow: rule.style.boxShadow
                    });
                  }
                }
              } catch (e) {
                // Cross-origin or other CSS access issues
              }
            }
          } catch (e) {
            styles.cssRulesError = e.message;
          }

          return styles;
        });

        if (styleInfo) {
          console.log(`  Element: ${styleInfo.element}`);
          console.log(`  Current Outline: "${styleInfo.current.outline}"`);
          console.log(`  Current Outline Color: "${styleInfo.current.outlineColor}"`);
          console.log(`  Current Outline Width: "${styleInfo.current.outlineWidth}"`);
          console.log(`  Current Box Shadow: "${styleInfo.current.boxShadow}"`);
          console.log(`  Current Background: "${styleInfo.current.backgroundColor}"`);
          
          if (styleInfo.cssRules.length > 0) {
            console.log(`  CSS Focus Rules Found:`);
            styleInfo.cssRules.forEach(rule => {
              console.log(`    ${rule.selector}: outline="${rule.outline}", boxShadow="${rule.boxShadow}"`);
            });
          } else {
            console.log(`  ❌ No CSS focus rules found`);
          }

          // Analyze if focus is visible
          const hasOutline = styleInfo.current.outline && 
                            styleInfo.current.outline !== 'none' && 
                            styleInfo.current.outlineWidth !== '0px' &&
                            !styleInfo.current.outline.includes('none');
          
          const hasBoxShadow = styleInfo.current.boxShadow && 
                              styleInfo.current.boxShadow !== 'none' &&
                              !styleInfo.current.boxShadow.includes('rgba(0, 0, 0, 0)');

          const hasBackgroundChange = styleInfo.current.backgroundColor &&
                                     styleInfo.current.backgroundColor !== 'rgba(0, 0, 0, 0)';

          const isVisible = hasOutline || hasBoxShadow || hasBackgroundChange;
          
          console.log(`  Visibility Analysis:`);
          console.log(`    Has Outline: ${hasOutline}`);
          console.log(`    Has Box Shadow: ${hasBoxShadow}`);
          console.log(`    Has Background: ${hasBackgroundChange}`);
          console.log(`    Overall Visible: ${isVisible ? '✅' : '❌'}`);
        }

      } catch (error) {
        console.log(`  ❌ Error testing ${selector}: ${error.message}`);
      }
    }

    // Test the "bad" page for comparison
    console.log(`\n\n🔍 Testing BAD page for comparison...\n`);
    
    const badTestFile = path.join(__dirname, '../test-pages/phase6b-bad-keyboard-v2.html');
    const badFileUrl = `file://${badTestFile}`;
    
    await page.goto(badFileUrl, { waitUntil: 'networkidle0' });

    // Test a known "no focus" link
    await page.evaluate(() => {
      const link = document.querySelector('a.no-focus-link');
      if (link) {
        link.focus();
      }
    });

    const badStyleInfo = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;

      const computed = window.getComputedStyle(active);
      return {
        element: active.tagName + (active.className ? `.${active.className}` : ''),
        outline: computed.outline,
        outlineColor: computed.outlineColor,
        outlineWidth: computed.outlineWidth,
        boxShadow: computed.boxShadow
      };
    });

    if (badStyleInfo) {
      console.log(`BAD example - ${badStyleInfo.element}:`);
      console.log(`  Outline: "${badStyleInfo.outline}"`);
      console.log(`  Outline Width: "${badStyleInfo.outlineWidth}"`);
      console.log(`  Box Shadow: "${badStyleInfo.boxShadow}"`);
      
      const hasVisibleFocus = badStyleInfo.outline && 
                             badStyleInfo.outline !== 'none' && 
                             badStyleInfo.outlineWidth !== '0px';
      console.log(`  Should be invisible: ${hasVisibleFocus ? '❌ DETECTED' : '✅ CORRECTLY INVISIBLE'}`);
    }

  } catch (error) {
    console.error('❌ Debug test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (require.main === module) {
  debugFocusDetection().catch(console.error);
}

module.exports = debugFocusDetection;