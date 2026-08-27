import { describe, it, expect } from 'vitest';
import {
  normalizeSeverity,
  severityWeight,
  violationPenalty,
  scoreFromPenalty,
} from '../../src/core/severity';
import ScanPipeline from '../../src/core/scan-pipeline';

describe('severity', () => {
  it('normalises the severity zoo', () => {
    expect(normalizeSeverity({ severity: 'error' })).toBe('critical');
    expect(normalizeSeverity({ severity: 'high' })).toBe('serious');
    expect(normalizeSeverity({ severity: 'warning' })).toBe('moderate');
    expect(normalizeSeverity({ severity: 'violation' })).toBe('moderate');
    expect(normalizeSeverity({ severity: 'violation', impact: 'serious' })).toBe('serious');
    expect(normalizeSeverity({ severity: null })).toBe('moderate');
    expect(normalizeSeverity({ severity: 'info' })).toBe('info');
  });
  it("a 'violation'-severity finding weighs 2 in the score", () => {
    expect(severityWeight({ severity: 'violation' })).toBe(2);
    const p = new ScanPipeline();
    expect(p.computeViolationWeightedScore([{ severity: 'violation' }])).toBe(98);
    expect(
      p.computeViolationWeightedScore([{ severity: 'info' }, { severity: 'best-practice' }])
    ).toBe(100);
  });
  it('an AAA-only finding is downgraded to info and weighs 0', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      {
        scannerId: 'axe-core',
        passed: false,
        violations: [
          { ruleId: 'x', severity: 'serious', wcagCriteria: ['2.5.5'] },
          { ruleId: 'y', severity: 'serious', wcagCriteria: ['2.5.8'] },
        ],
      },
    ]);
    const [aaa, aa] = result.violations;
    expect(aaa.wcagLevel).toBe('AAA');
    expect(aaa.severity).toBe('info');
    expect(aaa.aaa).toBe(true);
    expect(aaa.originalSeverity).toBe('serious');
    expect(aa.wcagLevel).toBe('AA');
    expect(aa.severity).toBe('serious');
    expect(result.accessibilityScore).toBe(95);
  });

  describe('score aggregation', () => {
    const repeat = (issue, severity, n) => Array.from({ length: n }, () => ({ issue, severity }));

    it('counts n instances of one rule as one defect with a capped surcharge', () => {
      const one = violationPenalty(repeat('focus-ring', 'serious', 1));
      const eight = violationPenalty(repeat('focus-ring', 'serious', 8));
      const hundred = violationPenalty(repeat('focus-ring', 'serious', 100));
      expect(one).toBe(5);
      expect(eight).toBeCloseTo(5 * (1 + Math.log10(8) / 2), 6);
      expect(hundred).toBe(7.5); // capped at x1.5, not 500
    });

    it('ranks breadth worse than depth', () => {
      const deep = violationPenalty(repeat('a', 'serious', 50));
      const broad = violationPenalty([
        ...repeat('a', 'serious', 1),
        ...repeat('b', 'serious', 1),
        ...repeat('c', 'serious', 1),
        ...repeat('d', 'serious', 1),
      ]);
      expect(broad).toBeGreaterThan(deep);
    });

    it('keeps the score discriminating instead of clipping to 0', () => {
      // The old 100 - sum(weights) returned 0 for both of these.
      const bad = scoreFromPenalty(violationPenalty(repeat('a', 'critical', 30)));
      const worse = scoreFromPenalty(
        violationPenalty(
          Array.from({ length: 30 }, (_, i) => ({ issue: `rule-${i}`, severity: 'critical' }))
        )
      );
      expect(bad).toBeGreaterThan(worse);
      expect(worse).toBeGreaterThan(0);
    });

    it('equals 100 minus the penalty for lightly-broken pages', () => {
      expect(scoreFromPenalty(2)).toBe(98);
      expect(scoreFromPenalty(5)).toBe(95);
      expect(scoreFromPenalty(0)).toBe(100);
    });

    it('collapses one procedural finding reported by two scanners', () => {
      const p = new ScanPipeline();
      const result = p.assembleResult('http://x', [
        {
          scannerId: 'accessibility-statement',
          passed: false,
          violations: [
            {
              criterion: 'EAA-Statement',
              element: 'website',
              issue: 'missing-accessibility-statement',
              severity: 'serious',
            },
          ],
        },
        {
          scannerId: 'eaa-procedure',
          passed: false,
          violations: [
            {
              criterion: 'EAA-Statement',
              element: 'website',
              issue: 'missing-accessibility-statement',
              severity: 'serious',
            },
          ],
        },
      ]);
      expect(result.totalViolations).toBe(1);
      expect(result.accessibilityScore).toBe(95);
    });
  });
});
