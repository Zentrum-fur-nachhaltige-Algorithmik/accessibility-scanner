import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const AccessibilityStatementScanner = require('../../src/scanners/accessibility-statement');
const ComplianceMonitoringScanner = require('../../src/scanners/compliance-monitoring');
const ContactMechanismScanner = require('../../src/scanners/contact-mechanism');
const EAAProcedureScanner = require('../../src/scanners/eaa-procedure');
const { matchesStatementLink, MISSING_STATEMENT_RULE } = require('../../src/utils/accessibility-statement');

const rule = (v) => v.issue || v.type || v.ruleId;

describe('EAA statement gate', () => {
  beforeAll(async () => {
    await startFixtureServer();
    await launchBrowser();
  }, 120000);

  afterAll(async () => {
    await closeBrowser();
    await stopFixtureServer();
  });

  it('recognises statement links and ignores unrelated footer links', () => {
    expect(matchesStatementLink('Accessibility Statement', '/a11y')).toBe(true);
    expect(matchesStatementLink('Erklärung zur Barrierefreiheit', '/barrierefreiheit')).toBe(true);
    expect(matchesStatementLink('Impressum', '/impressum.html')).toBe(false);
    expect(matchesStatementLink('Datenschutz', '/datenschutz.html')).toBe(false);
    // the old lists matched the bare words "statement" and "compliance"
    expect(matchesStatementLink('Financial statement', '/investors/statement')).toBe(false);
    expect(matchesStatementLink('Accessibility', 'mailto:a11y@example.org')).toBe(false);
  });

  it('reports one serious finding — not twelve, none critical — when no statement exists', async () => {
    const url = `${getBaseUrl()}/statement-none.html`;
    const scanners = [
      new AccessibilityStatementScanner(),
      new ComplianceMonitoringScanner(),
      new ContactMechanismScanner(),
      new EAAProcedureScanner(),
    ];

    const all = [];
    for (const scanner of scanners) {
      const page = await getPage(url);
      try {
        const result = await scanner.scan(page, { timeout: 20000 });
        all.push(...(result.violations || []).map((v) => ({ ...v, scannerId: result.scannerId })));
      } finally {
        await page.close();
      }
    }

    const statementRules = all.filter((v) => /statement|feedback|monitoring|audit|response-time|issue-tracking|improvement/.test(rule(v)));
    // Every scanner that speaks about the statement says the same one thing.
    expect([...new Set(statementRules.map(rule))]).toEqual([MISSING_STATEMENT_RULE]);
    expect(statementRules.every((v) => v.severity === 'serious')).toBe(true);
    expect(all.filter((v) => v.severity === 'critical' || v.severity === 'error')).toEqual([]);
  }, 120000);

  it('still detects an existing but incomplete statement', async () => {
    const page = await getPage(`${getBaseUrl()}/statement-incomplete.html`);
    try {
      const result = await new AccessibilityStatementScanner().scan(page, { timeout: 20000 });
      const rules = (result.violations || []).map(rule);
      expect(rules).not.toContain(MISSING_STATEMENT_RULE);
      // no compliance level, no contact, no review date
      expect(rules).toContain('incomplete-content');
      expect(rules).toContain('missing-contact');
      expect(rules).toContain('outdated-statement');
      expect(result.summary.statementExists).toBe(true);
    } finally {
      await page.close();
    }
  }, 120000);
});
