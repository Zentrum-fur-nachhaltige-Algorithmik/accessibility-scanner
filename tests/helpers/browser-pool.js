const puppeteer = require('puppeteer');

let browser = null;

async function launchBrowser() {
  if (browser) return browser;

  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  return browser;
}

async function getPage(url) {
  if (!browser) {
    throw new Error('Browser not launched. Call launchBrowser() first.');
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  if (url) {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  }

  return page;
}

async function closeBrowser() {
  if (!browser) return;
  await browser.close();
  browser = null;
}

function getBrowser() {
  if (!browser) throw new Error('Browser not launched');
  return browser;
}

module.exports = { launchBrowser, getPage, closeBrowser, getBrowser };
