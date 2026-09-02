import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const AdvancedAriaScanner = require('../../src/scanners/advanced-aria');

/**
 * The two rules of this scanner whose criterion belongs to another scanner
 * (2.1.1 to keyboard-navigation, 4.1.3 to status-messages), which is why the
 * concurrent harness does not route their fixtures here.
 */
describe('AdvancedAriaScanner: trees and live regions', () => {
  let scanner;

  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
    scanner = new AdvancedAriaScanner();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('says nothing about a static tree or a status region that never updates', async () => {
    const page = await getPage(`${getBaseUrl()}/good-tree-and-live-region.html`);
    try {
      const result = await scanner.scan(page);
      expect(result.violations).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports a tree with links that no keyboard can enter', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-tree-and-live-region.html`);
    try {
      const result = await scanner.scan(page);
      const tree = result.violations.find((v) => v.type === 'tree-not-keyboard-reachable');
      expect(tree).toBeTruthy();
      expect(tree.wcagCriteria).toBe('2.1.1');
      expect(scanner.wcagCriteria).toContain('2.1.1');
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports aria-expanded only on a subtree that is actually collapsed', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-tree-and-live-region.html`);
    try {
      const result = await scanner.scan(page);
      expect(result.violations.filter((v) => v.type === 'missing-aria-expanded')).toHaveLength(2);
    } finally {
      await page.close();
    }
  }, 60000);

  it('reports the politeness contradiction under 4.1.3, once the region updates', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-tree-and-live-region.html`);
    try {
      const result = await scanner.scan(page);
      const live = result.violations.find(
        (v) => v.type === 'contradictory-live-region-politeness'
      );
      expect(live).toBeTruthy();
      expect(live.criterion).toBe('9.4.1.3');
      expect(live.wcagCriteria).toBe('4.1.3');
      expect(live.details.observedUpdate).toBe(true);
    } finally {
      await page.close();
    }
  }, 60000);
});
