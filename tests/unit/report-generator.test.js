import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ReportGenerator = require('../../src/report/report-generator');

const violation = {
  scannerId: 'axe-core',
  source: 'axe-core',
  ruleId: 'color-contrast',
  severity: 'serious',
  verdict: 'violation',
  description: 'Text has insufficient contrast',
  criterion: '1.4.3',
  nodes: [{ selector: 'p.lead' }],
};

const review = {
  scannerId: 'axe-core',
  source: 'axe-core',
  ruleId: 'video-caption',
  severity: 'info',
  verdict: 'needs-review',
  description: '[Needs manual review] Videos must have captions',
  criterion: '1.2.2',
  nodes: [{ selector: 'video#intro' }],
  dossier: {
    question: 'Does this video meet WCAG 1.2.2 (captions)?',
    element: { selector: 'video#intro', html: '<video id="intro">', role: null, name: null },
    measurements: { hasTrackElement: false, durationSeconds: 42 },
    context: { axeRuleId: 'video-caption' },
  },
};

describe('ReportGenerator needs-review section', () => {
  const generator = new ReportGenerator();

  it('renders the question, the element and the measurements', () => {
    const html = generator.generateFindingsSection({
      violations: [violation],
      needsReview: [review],
    });

    expect(html).toContain('Needs review');
    expect(html).toContain('Does this video meet WCAG 1.2.2 (captions)?');
    expect(html).toContain('video#intro');
    expect(html).toContain('hasTrackElement: false');
    expect(html).toContain('durationSeconds: 42');
  });

  it('renders needs-review even when nothing is violated', () => {
    const html = generator.generateFindingsSection({ violations: [], needsReview: [review] });
    expect(html).toContain('No violations identified.');
    expect(html).toContain('Needs review');
  });

  it('leaves the section out when there is nothing to review', () => {
    const html = generator.generateFindingsSection({ violations: [violation], needsReview: [] });
    expect(html).not.toContain('Needs review');
  });

  it('keeps needs-review out of every count', () => {
    const data = { violations: [violation], needsReview: [review] };
    const distribution = generator.generateSeverityDistribution(data);
    expect(distribution).toContain('<strong>1</strong>');
    expect(distribution).not.toContain('Info');

    const principles = generator.groupViolationsByPrinciple(data.violations);
    expect(principles.perceivable).toHaveLength(1);
    expect(Object.values(principles).flat()).toHaveLength(1);
  });

  it('escapes dossier values', () => {
    const hostile = {
      ...review,
      dossier: {
        ...review.dossier,
        question: '<script>alert(1)</script>',
        measurements: { note: '"><img src=x>' },
      },
    };
    const html = generator.generateFindingsSection({ violations: [], needsReview: [hostile] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x>');
  });
});
