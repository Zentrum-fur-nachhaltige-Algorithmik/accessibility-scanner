import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const BaseScanner = require('../../src/core/base-scanner');

class TestScanner extends BaseScanner {
  constructor() {
    super('test-scanner', {
      wcagCriteria: ['1.1.1'],
      wcagPrinciple: 'perceivable',
    });
  }

  async scan(page, options = {}) {
    return {
      scannerId: this.id,
      passed: true,
      violations: [],
      summary: { tested: true },
    };
  }
}

class ExclusiveTestScanner extends BaseScanner {
  constructor() {
    super('exclusive-test', {
      wcagCriteria: ['2.1.1'],
      wcagPrinciple: 'operable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  async scan(page) {
    return {
      scannerId: this.id,
      passed: true,
      violations: [],
      summary: {},
    };
  }
}

describe('BaseScanner', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new BaseScanner('direct')).toThrow('abstract');
  });

  it('sets id and metadata on subclass', () => {
    const scanner = new TestScanner();
    expect(scanner.id).toBe('test-scanner');
    expect(scanner.wcagCriteria).toEqual(['1.1.1']);
    expect(scanner.wcagPrinciple).toBe('perceivable');
  });

  it('needsExclusiveAccess defaults to false', () => {
    const scanner = new TestScanner();
    expect(scanner.needsExclusiveAccess).toBe(false);
  });

  it('needsExclusiveAccess can be overridden', () => {
    const scanner = new ExclusiveTestScanner();
    expect(scanner.needsExclusiveAccess).toBe(true);
  });

  it('formatViolation returns standardized object', () => {
    const scanner = new TestScanner();
    const v = scanner.formatViolation('rule-1', 'critical', 'Missing alt', ['img#logo']);
    expect(v).toEqual({
      scannerId: 'test-scanner',
      ruleId: 'rule-1',
      impact: 'critical',
      severity: 'violation',
      description: 'Missing alt',
      nodes: ['img#logo'],
      helpUrl: '',
      wcagCriteria: ['1.1.1'],
    });
  });

  it('scan() can be called on subclass', async () => {
    const scanner = new TestScanner();
    const result = await scanner.scan(null);
    expect(result.scannerId).toBe('test-scanner');
    expect(result.passed).toBe(true);
  });
});
