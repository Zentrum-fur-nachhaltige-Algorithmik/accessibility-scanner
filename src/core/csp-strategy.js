/**
 * csp-strategy
 * CSP bypass strategies for injecting axe-core into pages that restrict inline scripts.
 * Tried in order: plain script tag, evaluateOnNewDocument (before CSP loads),
 * CDP Page.setBypassCSP, then a script tag with the source inlined.
 */
const fs = require('fs-extra');
const path = require('path');

/**
 * Try navigating with CSP fallback strategies.
 * Injects axe-core and runs it, returning results on success.
 *
 * @param {import('puppeteer').Page} page - already-open page
 * @param {string} url - target URL
 * @param {Object} options
 * @returns {Promise<Object|null>} axe results or null if all strategies fail
 */
async function navigateWithCSPFallback(page, url, options = {}) {
  const timeout = options.timeout || 30000;

  // Strategy 1: Standard script tag injection (works when CSP allows)
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout });
    await page.addScriptTag({ path: './node_modules/axe-core/axe.min.js' });

    const results = await runAxeOnPage(page);
    if (!results.error) return results;
  } catch (e) {
    // CSP likely blocked: fall through to mitigations
  }

  // Strategy 2: evaluateOnNewDocument, inject axe before CSP loads
  try {
    const axeSource = await fs.readFile(path.resolve('./node_modules/axe-core/axe.min.js'), 'utf8');
    await page.evaluateOnNewDocument(axeSource);
    await page.goto(url, { waitUntil: 'networkidle0', timeout });

    const results = await runAxeOnPage(page);
    if (!results.error) return results;
  } catch (e) {
    // Fall through
  }

  // Strategy 3: CDP CSP bypass
  try {
    const client = await page.target().createCDPSession();
    await client.send('Page.setBypassCSP', { enabled: true });
    await page.goto(url, { waitUntil: 'networkidle0', timeout });
    await page.addScriptTag({ path: './node_modules/axe-core/axe.min.js' });

    const results = await runAxeOnPage(page);
    await client.detach();
    if (!results.error) return results;
  } catch (e) {
    // Fall through
  }

  // Strategy 4: Content injection (inline axe source)
  try {
    const axeSource = await fs.readFile(path.resolve('./node_modules/axe-core/axe.min.js'), 'utf8');
    await page.goto(url, { waitUntil: 'networkidle0', timeout });
    await page.addScriptTag({ content: axeSource });

    const results = await runAxeOnPage(page);
    if (!results.error) return results;
  } catch (e) {
    // All strategies failed
  }

  return null;
}

/**
 * Run axe on an already-loaded page.
 */
async function runAxeOnPage(page) {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      if (typeof axe === 'undefined') {
        resolve({ error: 'axe is not defined' });
        return;
      }
      axe.run((err, results) => {
        if (err) resolve({ error: err.message });
        else resolve(results);
      });
    });
  });
}

module.exports = { navigateWithCSPFallback, runAxeOnPage };
