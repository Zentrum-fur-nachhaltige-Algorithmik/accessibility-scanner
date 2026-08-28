import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const { launchBrowser, closeBrowser, getPage } = require('../helpers/browser-pool');
const AccessibilityStatementScanner = require('../../src/scanners/accessibility-statement');
const {
  matchesStatementLink,
  MISSING_STATEMENT_RULE,
} = require('../../src/utils/accessibility-statement');

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
    // the bare words "statement" and "compliance" must not match
    expect(matchesStatementLink('Financial statement', '/investors/statement')).toBe(false);
    expect(matchesStatementLink('Accessibility', 'mailto:a11y@example.org')).toBe(false);
    // the bare word "accessibility" is the title of countless articles: it
    // identifies a statement only as the whole link text or a whole path segment
    expect(matchesStatementLink('Introduction to Web Accessibility', '/intro')).toBe(false);
    expect(
      matchesStatementLink('Tolerating Inaccessibility', '/blog/tolerating-inaccessibility/')
    ).toBe(false);
    expect(matchesStatementLink('Web Accessibility for Designers', '/resources/designers/')).toBe(
      false
    );
    expect(matchesStatementLink('Accessibility', '/accessibility/')).toBe(true);
    expect(matchesStatementLink('Read more', '/help/accessibility.html')).toBe(true);
  });

  it('reports one serious finding (not twelve, none critical) when no statement exists', async () => {
    const page = await getPage(`${getBaseUrl()}/statement-none.html`);
    let violations = [];
    try {
      const result = await new AccessibilityStatementScanner().scan(page, { timeout: 20000 });
      violations = result.violations || [];
    } finally {
      await page.close();
    }

    expect(violations.map(rule)).toEqual([MISSING_STATEMENT_RULE]);
    expect(violations.every((v) => v.severity === 'serious')).toBe(true);
  }, 120000);

  it('detects an existing but incomplete statement', async () => {
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

  it('does not audit a page about accessibility as the statement', async () => {
    const page = await getPage(`${getBaseUrl()}/good-accessibility-marketing-page.html`);
    try {
      const result = await new AccessibilityStatementScanner().scan(page, { timeout: 20000 });
      expect((result.violations || []).map(rule)).toEqual([MISSING_STATEMENT_RULE]);
    } finally {
      await page.close();
    }
  }, 120000);

  it('accepts a complete statement', async () => {
    const page = await getPage(`${getBaseUrl()}/good-accessibility-statement-complete.html`);
    try {
      const result = await new AccessibilityStatementScanner().scan(page, { timeout: 20000 });
      expect(result.violations).toEqual([]);
      expect(result.summary.conformanceStatus).toBeTruthy();
    } finally {
      await page.close();
    }
  }, 120000);
});
