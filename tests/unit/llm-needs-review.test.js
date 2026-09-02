import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const LLMAltQualityScanner = require('../../src/scanners/llm/alt-quality');
const LLMSensoryScanner = require('../../src/scanners/llm/sensory-characteristics');
const LLMReadingLevelScanner = require('../../src/scanners/llm/reading-level');
const { createAllScanners } = require('../../src/core/scanner-registry');

/** The client is never called: these tests hand the scanner the model's answer. */
const stubClient = {
  predict: async () => {
    throw new Error('LLM must not be called in this test');
  },
};

describe('LLM findings are needs-review questions', () => {
  const scanner = new LLMAltQualityScanner(stubClient);

  const modelSaid = [
    {
      criterion: '1.1.1',
      description: 'Alt "IMG_2043.JPG" repeats the filename.',
      impact: 'serious',
      selector: 'img#hero',
    },
  ];

  it('gives every finding the needs-review verdict and no severity weight', () => {
    const [finding] = scanner.convertViolations(modelSaid, { model: 'google/gemini-3.7-flash' });
    expect(finding.verdict).toBe('needs-review');
    expect(finding.severity).toBe('info');
    expect(finding.ruleId).toBe('1.1.1');
    expect(finding.source).toBe('llm-alt-quality');
    expect(finding.scannerId).toBe('llm-alt-quality');
  });

  it('states the decision, the element, the measurement and who asked', () => {
    const [finding] = scanner.convertViolations(modelSaid, {
      model: 'google/gemini-3.7-flash',
      measurements: { imagesInspected: 4 },
      bySelector: {
        'img#hero': {
          element: { html: '<img id="hero" alt="IMG_2043.JPG">', role: null, name: null },
          measurements: { alt: 'IMG_2043.JPG', filename: 'IMG_2043.JPG' },
        },
      },
    });

    expect(finding.dossier.question).toBe(
      'Does the element `img#hero` meet Non-text Content (WCAG 1.1.1)?'
    );
    expect(finding.dossier.element).toEqual({
      selector: 'img#hero',
      html: '<img id="hero" alt="IMG_2043.JPG">',
      role: null,
      name: null,
    });
    expect(finding.dossier.measurements).toEqual({
      imagesInspected: 4,
      alt: 'IMG_2043.JPG',
      filename: 'IMG_2043.JPG',
    });
    expect(finding.dossier.context).toEqual({
      evidence: 'Alt "IMG_2043.JPG" repeats the filename.',
      model: 'google/gemini-3.7-flash',
    });
  });

  it('asks about the page when the model named no element', () => {
    const s = new LLMSensoryScanner(stubClient);
    const [finding] = s.convertViolations([{ criterion: '1.3.3', description: 'Round button.' }]);
    expect(finding.dossier.question).toBe(
      'Does this page meet Sensory Characteristics (WCAG 1.3.3)?'
    );
    expect(finding.dossier.element).toEqual({ selector: null, html: null, role: null, name: null });
    expect(finding.dossier.context.model).toBe('unknown');
  });

  it('still drops a criterion the scanner does not claim', () => {
    const findings = scanner.convertViolations([{ criterion: '1.4.3', description: 'contrast' }]);
    expect(findings).toEqual([]);
    expect(scanner.droppedViolationCount).toBeGreaterThan(0);
  });

  it('returns questions, never violations, and passes', () => {
    const result = scanner.reviewResult(scanner.convertViolations(modelSaid), {
      imagesInspected: 1,
    });
    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.needsReview).toHaveLength(1);
    expect(result.summary.openQuestions).toBe(1);
  });
});

describe('reading level is measured in code', () => {
  const scanner = new LLMReadingLevelScanner(stubClient);

  it('reports Flesch for English and the Wiener Sachtextformel for German', () => {
    const en = scanner.readability('the cat sat on the mat and then it slept'.split(' '), 2, 'en');
    expect(en.fleschReadingEase).toBeGreaterThan(80);
    expect(en.wienerSachtextformel).toBeUndefined();

    const de = scanner.readability(
      'Die Verwaltungsvereinfachung erfordert eine Zusammenarbeit aller Verwaltungseinheiten'.split(
        ' '
      ),
      1,
      'de-AT'
    );
    expect(de.wienerSachtextformel).toBeGreaterThan(0);
    expect(de.longWordsPercent).toBeGreaterThan(50);
  });

  it('counts at least one syllable per word', () => {
    expect(scanner.countSyllables('strength')).toBe(1);
    expect(scanner.countSyllables('table')).toBe(1);
    expect(scanner.countSyllables('Verwaltung')).toBe(3);
  });
});

describe('registry after the deletions', () => {
  const ids = createAllScanners({ llmClient: {} }).map((s) => s.id);

  it('no longer registers the two page-search scanners', () => {
    expect(ids).not.toContain('llm-media-alternatives');
    expect(ids).not.toContain('llm-behavioral');
  });

  it('keeps the ten LLM scanners that ask a question or answer one', () => {
    expect(ids.filter((id) => id.startsWith('llm-'))).toHaveLength(10);
  });

  it('drops the criteria those scanners claimed', () => {
    const claimed = new Set(
      createAllScanners({ llmClient: {} }).flatMap((s) => s.wcagCriteria || [])
    );
    for (const sc of ['1.2.6', '1.2.7', '1.2.8', '1.2.9', '2.2.3', '2.2.5', '3.2.5', '1.4.7']) {
      expect(claimed.has(sc), sc).toBe(false);
    }
  });
});
