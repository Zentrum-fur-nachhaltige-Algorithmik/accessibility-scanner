import { describe, it, expect } from 'vitest';
import {
  groupViolations,
  isNeedsReview,
  needsReviewItems,
  onlyViolations,
  principleCounts,
  reviewMeasurements,
  reviewQuestion,
  severityCounts,
} from '../../frontend/lib/violations.js';

const violation = {
  scannerId: 'axe-core',
  ruleId: 'color-contrast',
  severity: 'serious',
  verdict: 'violation',
  criterion: '1.4.3',
  description: 'Insufficient contrast',
};

const review = {
  scannerId: 'axe-core',
  ruleId: 'video-caption',
  severity: 'info',
  verdict: 'needs-review',
  criterion: '1.2.2',
  description: '[Needs manual review] Videos must have captions',
  dossier: {
    question: 'Does this video meet WCAG 1.2.2 (captions)?',
    element: { selector: 'video#intro' },
    measurements: { hasTrackElement: false, durationSeconds: 42, unknown: null },
  },
};

describe('frontend violation helpers', () => {
  it('recognises a needs-review verdict', () => {
    expect(isNeedsReview(review)).toBe(true);
    expect(isNeedsReview(violation)).toBe(false);
    expect(isNeedsReview(undefined)).toBe(false);
  });

  it('never counts a needs-review finding as a failure', () => {
    const mixed = [violation, review];
    expect(onlyViolations(mixed)).toEqual([violation]);
    expect(severityCounts(mixed)).toEqual([{ severity: 'serious', label: 'Serious', count: 1 }]);
    expect(groupViolations(mixed)).toHaveLength(1);
    const perceivable = principleCounts(mixed).find((row) => row.key === 'perceivable');
    expect(perceivable.count).toBe(1);
  });

  it('reads the dossier question and the measurements', () => {
    expect(reviewQuestion(review)).toBe('Does this video meet WCAG 1.2.2 (captions)?');
    expect(reviewMeasurements(review)).toEqual([
      ['hasTrackElement', 'false'],
      ['durationSeconds', '42'],
    ]);
  });

  it('falls back to the description when there is no dossier', () => {
    expect(reviewQuestion({ description: 'Check this by hand' })).toBe('Check this by hand');
    expect(reviewMeasurements({})).toEqual([]);
  });

  it('reads needsReview off a result of any shape', () => {
    expect(needsReviewItems({ needsReview: [review] })).toEqual([review]);
    expect(needsReviewItems({})).toEqual([]);
    expect(needsReviewItems(null)).toEqual([]);
  });
});
