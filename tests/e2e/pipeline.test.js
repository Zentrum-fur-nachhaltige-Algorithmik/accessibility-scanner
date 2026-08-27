import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startFixtureServer, stopFixtureServer, getBaseUrl } = require('../helpers/fixture-server');
const BaseScanner = require('../../src/core/base-scanner');
const ScanPipeline = require('../../src/core/scan-pipeline');

// Mock concurrent scanner
class MockConcurrentScanner extends BaseScanner {
  constructor() {
    super('mock-concurrent', {
      wcagCriteria: ['1.4.3'],
      wcagPrinciple: 'perceivable',
    });
  }

  async scan(page) {
    const title = await page.title();
    return {
      scannerId: this.id,
      passed: true,
      violations: [],
      summary: { pageTitle: title },
    };
  }
}

// Mock exclusive scanner
class MockExclusiveScanner extends BaseScanner {
  constructor() {
    super('mock-exclusive', {
      wcagCriteria: ['2.1.1'],
      wcagPrinciple: 'operable',
    });
  }

  get needsExclusiveAccess() {
    return true;
  }

  async scan(page) {
    const title = await page.title();
    return {
      scannerId: this.id,
      passed: false,
      violations: [
        this.formatViolation('mock-rule', 'minor', 'Mock violation'),
      ],
      summary: { pageTitle: title },
    };
  }
}

describe('ScanPipeline', () => {
  let pipeline;

  beforeAll(async () => {
    await startFixtureServer();
    pipeline = new ScanPipeline();
    pipeline.register(new MockConcurrentScanner());
    pipeline.register(new MockExclusiveScanner());
  });

  afterAll(async () => {
    await pipeline.close();
    await stopFixtureServer();
  });

  it('runs concurrent and exclusive scanners', async () => {
    const url = `${getBaseUrl()}/good-accessibility.html`;
    const result = await pipeline.scan(url);

    expect(result.url).toBe(url);
    expect(result.timestamp).toBeDefined();
    expect(result.scanners['mock-concurrent']).toBeDefined();
    expect(result.scanners['mock-concurrent'].passed).toBe(true);
    expect(result.scanners['mock-exclusive']).toBeDefined();
    expect(result.scanners['mock-exclusive'].passed).toBe(false);
    expect(result.totalViolations).toBe(1);
  });

  it('filters by scannerIds', async () => {
    const url = `${getBaseUrl()}/good-accessibility.html`;
    const result = await pipeline.scan(url, { scannerIds: ['mock-concurrent'] });

    expect(result.scanners['mock-concurrent']).toBeDefined();
    expect(result.scanners['mock-exclusive']).toBeUndefined();
  });

  it('throws when no scanners match', async () => {
    const emptyPipeline = new ScanPipeline();
    await expect(
      emptyPipeline.scan('http://localhost:1/nope')
    ).rejects.toThrow('No scanners');
    await emptyPipeline.close();
  });
});
