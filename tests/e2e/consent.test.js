import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { detectConsent, dismissConsent } = require('../../src/core/consent');

describe('consent pre-step', () => {
  let browser;
  let page;

  beforeAll(async () => {
    await startFixtureServer();
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    await stopFixtureServer();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) await page.close();
  });

  it('detects the banner and its accept button', async () => {
    await page.goto(`${getBaseUrl()}/consent-cookie-banner.html`, { waitUntil: 'load' });
    const found = await detectConsent(page);

    expect(found).toEqual({
      containerSelector: '#cookie-consent-banner',
      buttonSelector: '#accept-all',
      buttonLabel: 'Alle akzeptieren',
    });
  });

  it('clicks the accept button and waits for the banner to go', async () => {
    await page.goto(`${getBaseUrl()}/consent-cookie-banner.html`, { waitUntil: 'load' });
    const result = await dismissConsent(page);

    expect(result.detected).toBe(true);
    expect(result.dismissed).toBe(true);
    const stillThere = await page.evaluate(
      () => !!document.querySelector('#cookie-consent-banner')
    );
    expect(stillThere).toBe(false);
  });

  it('reports nothing on a page without an overlay', async () => {
    await page.goto(`${getBaseUrl()}/good-accessibility.html`, { waitUntil: 'load' });
    expect(await detectConsent(page)).toBeNull();
    expect(await dismissConsent(page)).toEqual({ detected: false, dismissed: false });
  });
});
