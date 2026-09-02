import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const MultipleWaysScanner = require('../../src/scanners/multiple-ways');
const TimingControlsScanner = require('../../src/scanners/timing-controls');

const rule = (v) => v.issue || v.ruleId || v.type;

/**
 * The rules that ask instead of deciding produce no violation, so the
 * good/bad harnesses cannot see them. These assertions are their fixture
 * evidence: what the question is, and when it is not asked at all.
 */
describe('structure scanners: needs-review questions', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('asks about 2.4.5 with the mechanisms it counted, and never fails it', async () => {
    const page = await getPage(`${getBaseUrl()}/bad-multiple-ways.html`);
    try {
      const result = await new MultipleWaysScanner().scan(page, {});
      expect(result.violations).toEqual([]);
      expect(result.needsReview).toHaveLength(1);
      const [item] = result.needsReview;
      expect(item.verdict).toBe('needs-review');
      expect(item.dossier.question).toBe('Does the site offer a second way to reach its pages?');
      expect(item.dossier.measurements.mechanismCount).toBeLessThan(2);
    } finally {
      await page.close();
    }
  }, 120000);

  it('counts a search that is collapsed behind a toggle', async () => {
    const page = await getPage(`${getBaseUrl()}/good-multiple-ways-collapsed-search.html`);
    try {
      const result = await new MultipleWaysScanner().scan(page, {});
      expect(result.summary.mechanisms).toContain('search');
      expect(result.needsReview).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120000);

  it('does not read a media player clock as a session countdown', async () => {
    const page = await getPage(`${getBaseUrl()}/good-player-clock-and-hydration.html`);
    try {
      const result = await new TimingControlsScanner().scan(page, { observationTime: 3000 });
      const rules = (result.violations || []).map(rule);
      expect(rules).not.toContain('timeout-no-extend-option');
      expect(rules).not.toContain('auto-update-no-controls');
    } finally {
      await page.close();
    }
  }, 120000);

  it('asks about a countdown whose extend control is elsewhere on the page', async () => {
    const page = await getPage(`${getBaseUrl()}/good-session-countdown-far-control.html`);
    try {
      const result = await new TimingControlsScanner().scan(page, { observationTime: 3000 });
      expect((result.violations || []).map(rule)).not.toContain('timeout-no-extend-option');
      const open = (result.needsReview || []).filter((v) => rule(v) === 'timeout-no-extend-option');
      expect(open).toHaveLength(1);
      expect(open[0].dossier.question).toContain('countdown');
      expect(open[0].dossier.measurements.controlText).toBeTruthy();
    } finally {
      await page.close();
    }
  }, 120000);
});
