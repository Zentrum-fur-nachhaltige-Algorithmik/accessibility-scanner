import { describe, it, expect } from 'vitest';
import ScanPipeline from '../../src/core/scan-pipeline';
import { isHardViolation, severityWeight, violationPenalty } from '../../src/core/severity';

const proven = { ruleId: 'color-contrast', severity: 'serious', wcagCriteria: ['1.4.3'] };
const suspected = {
  ruleId: 'video-caption',
  severity: 'info',
  verdict: 'needs-review',
  wcagCriteria: ['1.2.2'],
  nodes: [{ selector: 'video#intro' }],
  dossier: { question: 'Does this video have captions?', measurements: { tracks: 0 } },
};

describe('verdict routing in assembleResult', () => {
  it('keeps a needs-review finding out of the violations, the score and the categories', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      { scannerId: 'axe-core', passed: false, violations: [proven, suspected] },
    ]);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].ruleId).toBe('color-contrast');
    expect(result.violations[0].verdict).toBe('violation');
    expect(result.totalViolations).toBe(1);
    expect(result.accessibilityScore).toBe(95);
    expect(result.categories.perceivable.violations).toBe(1);

    expect(result.needsReview).toHaveLength(1);
    expect(result.needsReview[0].ruleId).toBe('video-caption');
    expect(result.needsReview[0].dossier.question).toBe('Does this video have captions?');
  });

  it('fills in verdict violation for everything left in violations', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      { scannerId: 'axe-core', passed: false, violations: [{ ruleId: 'z', severity: 'minor' }] },
    ]);
    expect(result.violations[0].verdict).toBe('violation');
  });

  it('marks the AAA demotion as needs-review and keeps its AAA fields', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      {
        scannerId: 'axe-core',
        passed: false,
        violations: [{ ruleId: 'x', severity: 'serious', wcagCriteria: ['2.5.5'] }],
      },
    ]);
    const [aaa] = result.needsReview;
    expect(aaa.verdict).toBe('needs-review');
    expect(aaa.aaa).toBe(true);
    expect(aaa.originalSeverity).toBe('serious');
    expect(result.violations).toHaveLength(0);
  });

  it('takes a scanner-reported needsReview list as needs-review', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      { scannerId: 'axe-core', passed: true, violations: [], needsReview: [{ ruleId: 'q' }] },
    ]);
    expect(result.needsReview[0].verdict).toBe('needs-review');
    expect(result.needsReview[0].scannerId).toBe('axe-core');
  });

  it('has no reviewLog when nothing was reviewed', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      { scannerId: 'axe-core', passed: false, violations: [suspected] },
    ]);
    expect(result.reviewLog).toBeUndefined();
  });
});

describe('reconcileIncompleteReviews', () => {
  const scannerResults = [
    { scannerId: 'axe-core', passed: false, violations: [proven, suspected] },
    {
      scannerId: 'llm-incomplete-reviewer',
      passed: true,
      violations: [],
      summary: {
        suppressed: [
          {
            axeRuleId: 'video-caption',
            selector: 'video#intro',
            reason: 'no audio track, criterion does not apply',
          },
        ],
      },
    },
  ];

  it('moves a cleared item from needsReview into the review log', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', scannerResults);

    expect(result.needsReview).toHaveLength(0);
    expect(result.reviewLog).toEqual([
      {
        ruleId: 'video-caption',
        selector: 'video#intro',
        verdict: 'pass',
        reason: 'no audio track, criterion does not apply',
        by: 'llm-incomplete-reviewer',
      },
    ]);
    expect(result.violations).toHaveLength(1);
  });

  it('leaves a needs-review item nobody decided alone', () => {
    const p = new ScanPipeline();
    const { kept, reviewLog } = p.reconcileIncompleteReviews(
      [{ ruleId: 'other-rule', nodes: [{ selector: 'video#intro' }] }],
      scannerResults
    );
    expect(kept).toHaveLength(1);
    expect(reviewLog).toHaveLength(0);
  });

  const reviewerFail = {
    ruleId: 'video-caption',
    severity: 'violation',
    impact: 'serious',
    description: 'confirmed: spoken dialogue, no captions',
    nodes: [{ selector: 'video#intro' }],
    wcagCriteria: ['1.2.2'],
    adjudicated: true,
    reviewedAxeRule: 'video-caption',
    reviewedSelector: 'video#intro',
  };
  const failDecision = {
    axeRuleId: 'video-caption',
    selector: 'video#intro',
    verdict: 'fail',
    reason: 'confirmed: spoken dialogue, no captions',
  };

  it('keeps the question open with the verdict attached while the reviewer is experimental', () => {
    // llm-incomplete-reviewer has no stability record in scanner-trust.json.
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      { scannerId: 'axe-core', passed: false, violations: [suspected] },
      {
        scannerId: 'llm-incomplete-reviewer',
        passed: false,
        violations: [reviewerFail],
        summary: { decided: [failDecision] },
      },
    ]);

    expect(result.violations).toHaveLength(0);
    expect(result.needsReview).toHaveLength(1);
    expect(result.needsReview[0].review).toEqual({
      by: 'llm-incomplete-reviewer',
      verdict: 'fail',
      reason: 'confirmed: spoken dialogue, no captions',
    });
    expect(result.reviewLog).toBeUndefined();
  });

  it('closes a question a proven reviewer answered fail', () => {
    const p = new ScanPipeline();
    const { kept, reviewLog } = p.reconcileIncompleteReviews(
      [suspected],
      [{ scannerId: 'llm-incomplete-reviewer', summary: { decided: [failDecision] } }],
      { reviewerProven: true }
    );
    expect(kept).toHaveLength(0);
    expect(reviewLog[0].verdict).toBe('fail');
  });

  it('keeps an uncertain item open and annotates the attempt', () => {
    const p = new ScanPipeline();
    const result = p.assembleResult('http://x', [
      { scannerId: 'axe-core', passed: false, violations: [suspected] },
      {
        scannerId: 'llm-incomplete-reviewer',
        passed: true,
        violations: [],
        summary: {
          decided: [
            {
              axeRuleId: 'video-caption',
              selector: 'video#intro',
              verdict: 'uncertain',
              reason: 'audio track state unknown',
            },
          ],
        },
      },
    ]);

    expect(result.needsReview).toHaveLength(1);
    expect(result.needsReview[0].review).toEqual({
      by: 'llm-incomplete-reviewer',
      verdict: 'uncertain',
      reason: 'audio track state unknown',
    });
    expect(result.reviewLog).toBeUndefined();
  });

  it('matches a needs-review item by its dossier selector', () => {
    const p = new ScanPipeline();
    const { kept, reviewLog } = p.reconcileIncompleteReviews(
      [
        {
          scannerId: 'nontext-contrast',
          ruleId: 'video-caption',
          verdict: 'needs-review',
          dossier: { element: { selector: 'video#intro' } },
        },
      ],
      scannerResults
    );
    expect(kept).toHaveLength(0);
    expect(reviewLog[0].selector).toBe('video#intro');
  });

  it('decides any scanner needs-review item, not only axe severity info', () => {
    const p = new ScanPipeline();
    const { kept, reviewLog } = p.reconcileIncompleteReviews(
      [
        {
          scannerId: 'color-contrast',
          ruleId: 'video-caption',
          severity: 'serious',
          verdict: 'needs-review',
          element: 'video#intro',
        },
      ],
      scannerResults
    );
    expect(kept).toHaveLength(0);
    expect(reviewLog[0].verdict).toBe('pass');
  });
});

describe('severity guard', () => {
  it('never treats a needs-review finding as a hard violation', () => {
    expect(isHardViolation({ severity: 'critical' })).toBe(true);
    expect(isHardViolation({ severity: 'critical', verdict: 'needs-review' })).toBe(false);
    expect(severityWeight({ severity: 'critical', verdict: 'needs-review' })).toBe(0);
    expect(violationPenalty([{ issue: 'a', severity: 'critical', verdict: 'needs-review' }])).toBe(
      0
    );
  });
});
