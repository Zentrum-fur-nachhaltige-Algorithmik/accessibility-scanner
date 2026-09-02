import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const MediaAccessibilityScanner = require('../../src/scanners/media-accessibility');

/**
 * The image rules of media-accessibility carry SC 1.1.1, which the scanner
 * does not declare, so the concurrent harness routes no fixture to them.
 */
describe('MediaAccessibilityScanner: the image rules', () => {
  let scanner;
  let result;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new MediaAccessibilityScanner();
    const page = await getPage(`${getBaseUrl()}/good-media-image-judgements.html`);
    try {
      result = await scanner.scan(page, { skipScreenshot: true });
    } finally {
      await page.close();
    }
  }, 180000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('proves no image failure on the page', () => {
    expect(result.violations).toEqual([]);
  });

  it('leaves the filename alt of the sole icon of a named button alone', () => {
    const rules = [...result.violations, ...result.needsReview].map((v) => v.ruleId || v.issue);
    expect(rules).not.toContain('image-alt');
  });

  it('asks about the image whose role and alt contradict each other', () => {
    const decorative = result.needsReview.filter((v) => v.ruleId === 'decorative-img');
    expect(decorative).toHaveLength(1);
    expect(decorative[0].dossier.question).toMatch(/Is this image decorative\?/);
    expect(decorative[0].dossier.element.selector).toContain('contradiction');
  });

  it('asks about a long description only where a caption says the image is a chart', () => {
    const complex = result.needsReview.filter((v) => v.ruleId === 'complex-img-alt');
    expect(complex).toHaveLength(1);
    expect(complex[0].dossier.element.selector).toContain('chart');
    expect(complex[0].dossier.context.figcaption).toMatch(/Chart/);
  });
});
