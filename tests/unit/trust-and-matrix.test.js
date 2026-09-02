import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { llmFailures, MIN_LLM_RUNS } = require('../../scripts/derive-scanner-trust');
const { buildRows, validate, HOW } = require('../../scripts/coverage-matrix');
const trust = require('../../src/core/scanner-trust.json');

describe('LLM trust derives from the stability record', () => {
  const clean = { rule: 'llm-auth/3.3.8', runs: 3, agreement: 0.95, precision: 0.95 };

  it('is not proven without a record', () => {
    const reasons = llmFailures('llm-auth', null);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^LLM scanner: no stability record/);
  });

  it('is not proven when the record says nothing about this scanner', () => {
    const record = new Map([['llm-alt-quality', [clean]]]);
    expect(llmFailures('llm-auth', record)[0]).toMatch(/no stability record for llm-auth/);
  });

  it('is proven when every rule has enough agreeing runs and precision', () => {
    const record = new Map([['llm-auth', [clean, { ...clean, rule: 'llm-auth/3.3.9' }]]]);
    expect(llmFailures('llm-auth', record)).toEqual([]);
  });

  it('names too few runs, weak agreement and weak precision', () => {
    const record = new Map([
      ['llm-auth', [{ rule: 'llm-auth/3.3.8', runs: 1, agreement: 0.5, precision: 0.4 }]],
    ]);
    const reasons = llmFailures('llm-auth', record);
    expect(reasons.join(' | ')).toContain(`recorded 1 run(s), needs ${MIN_LLM_RUNS}`);
    expect(reasons.join(' | ')).toContain('agreement 0.5');
    expect(reasons.join(' | ')).toContain('precision');
  });

  it('has every LLM scanner quarantined while no record exists', () => {
    const llm = Object.entries(trust.scanners).filter(([id]) => id.startsWith('llm-'));
    expect(llm.length).toBe(10);
    for (const [id, v] of llm) {
      expect(v.tier, id).toBe('experimental');
      expect(v.reason, id).toMatch(/no stability record/);
    }
  });
});

describe('the coverage matrix says how each criterion is decided', () => {
  const { rows } = buildRows();
  const bySc = new Map(rows.map((r) => [r.sc, r]));

  it('gives every criterion one of the four answers', () => {
    for (const row of rows) expect(Object.values(HOW), row.sc).toContain(row.how);
  });

  it('fails validation when a row carries no how', () => {
    const broken = [{ ...bySc.get('1.1.1'), how: undefined }];
    expect(validate(broken).join(' ')).toMatch(/carries no valid "how"/);
  });

  it('calls the dossier suppliers adjudicated and the page readers page-judgement', () => {
    expect(bySc.get('3.3.7').how).toBe(HOW.ADJUDICATED);
    expect(bySc.get('3.2.6').how).toBe(HOW.ADJUDICATED);
    expect(bySc.get('2.4.13').how).toBe(HOW.ADJUDICATED);
    expect(bySc.get('3.1.5').how).toBe(HOW.PAGE_JUDGEMENT);
    expect(bySc.get('3.1.3').how).toBe(HOW.PAGE_JUDGEMENT);
    expect(bySc.get('1.4.3').how).toBe(HOW.MEASURED);
  });

  it('marks the criteria of the deleted scanners manual, with a reason', () => {
    for (const sc of ['1.2.6', '1.2.9', '2.2.3', '3.2.5', '3.3.5', '1.4.7', '3.1.6', '1.3.6']) {
      const row = bySc.get(sc);
      expect(row.how, sc).toBe(HOW.MANUAL);
      expect(row.justification.trim().length, sc).toBeGreaterThan(0);
    }
  });

  it('credits no criterion to an axe rule that never runs', () => {
    const neverRun = [
      'label-content-name-mismatch',
      'css-orientation-lock',
      'audio-caption',
      'aria-roledescription',
      'p-as-heading',
      'table-fake-caption',
      'td-has-header',
    ];
    for (const row of rows) {
      for (const rule of neverRun) expect(row.axeRules, row.sc).not.toContain(rule);
    }
  });

  it('credits no criterion to a rule axe buckets as a best practice only', () => {
    // Those rules bear on real clauses (empty-heading, heading-order, region,
    // skip-link, tabindex, ...), but the adapter routes them to advice and
    // they carry no wcag tag, so the matrix must not call their criteria
    // covered either.
    const axe = require('axe-core');
    const bestPracticeOnly = new Set(
      axe
        .getRules()
        .filter((r) => r.tags.includes('best-practice') && !r.tags.some((t) => /^wcag/.test(t)))
        .map((r) => r.ruleId)
    );
    expect(bestPracticeOnly.size).toBeGreaterThan(0);
    for (const row of rows) {
      for (const rule of row.axeRules || []) {
        expect(bestPracticeOnly.has(rule), `${row.sc} credited to ${rule}`).toBe(false);
      }
    }
  });
});

describe('the axe adapter asks for the tags the audit claims', () => {
  const { AXE_TAGS } = require('../../src/scanners/axe-core');

  it('asks for every WCAG 2.0 to 2.2 A and AA tag', () => {
    for (const tag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']) {
      expect(AXE_TAGS).toContain(tag);
    }
  });

  it('leaves axe experimental and deprecated rules excluded', () => {
    // The user decided on 2026-09-02 not to enable them. tagExclude is axe's
    // own default and this adapter does not override it, so the seven rules
    // it holds back stay out of the audit and out of the coverage matrix.
    const axe = require('axe-core');
    expect(axe._audit.tagExclude).toEqual(['experimental', 'deprecated']);
    expect(AXE_TAGS).not.toContain('experimental');
    expect(AXE_TAGS).not.toContain('deprecated');
  });
});
