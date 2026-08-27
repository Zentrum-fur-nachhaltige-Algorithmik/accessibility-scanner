import { describe, it, expect } from 'vitest';
import { levelOf, levelOfViolation, normalizeCriterion } from '../../src/core/wcag-levels';

describe('wcag-levels', () => {
  it('maps criteria to levels', () => {
    expect(levelOf('2.5.5')).toBe('AAA');
    expect(levelOf('9.2.5.8')).toBe('AA');
    expect(levelOf('1.1.1')).toBe('A');
    expect(levelOf('2.4.13')).toBe('AAA');
    expect(levelOf('wcag143')).toBe('AA');
    expect(levelOf('9.9.9')).toBeNull();
  });
  it('normalises EN 301 549 clauses and axe tags', () => {
    expect(normalizeCriterion('9.1.4.3')).toBe('1.4.3');
    expect(normalizeCriterion('wcag2411')).toBe('2.4.11');
    expect(normalizeCriterion('1.4.3 Kontrast')).toBe('1.4.3');
    expect(normalizeCriterion('wcag2aa')).toBeNull();
  });
  it('levelOfViolation: AAA only if every criterion is AAA, else the lowest', () => {
    expect(levelOfViolation({ wcagCriteria: ['2.5.5'] })).toBe('AAA');
    expect(levelOfViolation({ wcagCriteria: ['1.4.3', '1.4.6'] })).toBe('AA');
    expect(levelOfViolation({ criterion: '9.2.1.1' })).toBe('A');
    expect(levelOfViolation({ axeTags: ['cat.color', 'wcag2aaa'] })).toBe('AAA');
    expect(levelOfViolation({ axeTags: ['wcag143', 'wcag2aa'] })).toBe('AA');
    expect(levelOfViolation({})).toBeNull();
  });
});
