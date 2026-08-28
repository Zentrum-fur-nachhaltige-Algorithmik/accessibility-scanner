import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  TASK_KINDS,
  validateTaskShape,
  isValidTaskShape,
  parseTasks,
} = require('../../src/agent/task');

const base = (over = {}) => ({
  id: 't1',
  description: 'Find out when the practice is open.',
  oracle: { type: 'urlMatches', pattern: 'hours' },
  sightedPath: [{ action: 'click', selector: 'a' }],
  ...over,
});

describe('agent/task: the kind field', () => {
  it('knows exactly two kinds', () => {
    expect(TASK_KINDS).toEqual(['action', 'information']);
  });

  it('defaults to an action task', () => {
    expect(validateTaskShape(base()).kind).toBe('action');
    expect(validateTaskShape(base({ kind: 'action' })).kind).toBe('action');
  });

  it('rejects a kind it does not know', () => {
    expect(() => validateTaskShape(base({ kind: 'reading' }))).toThrow(/"kind" must be one of/);
  });

  it('requires evidence on an information task', () => {
    expect(() => validateTaskShape(base({ kind: 'information' }))).toThrow(/"evidence"/);
    expect(() => validateTaskShape(base({ kind: 'information', evidence: '  ' }))).toThrow(
      /"evidence"/
    );
    expect(isValidTaskShape(base({ kind: 'information', evidence: 'Ordinationszeiten Mo' }))).toBe(
      true
    );
  });

  it('accepts the ground-truth answer and its type on an information task', () => {
    const t = validateTaskShape(
      base({
        kind: 'information',
        evidence: 'TEL: 01 2039333',
        answer: '+43 1 2039333',
        answerType: 'phone',
      })
    );
    expect(t.answer).toBe('+43 1 2039333');
    expect(t.answerType).toBe('phone');
  });

  it('rejects an unusable answer/answerType combination', () => {
    const info = { kind: 'information', evidence: 'TEL: 01 2039333' };
    expect(() => validateTaskShape(base({ ...info, answer: '  ', answerType: 'phone' }))).toThrow(
      /"answer" must be a non-empty string/
    );
    expect(() =>
      validateTaskShape(base({ ...info, answer: '+43 1 2039333', answerType: 'telephone' }))
    ).toThrow(/"answerType" must be one of/);
    expect(() => validateTaskShape(base({ ...info, answer: '+43 1 2039333' }))).toThrow(
      /"answerType" is required/
    );
    // An action task has no answer at all.
    expect(() => validateTaskShape(base({ answer: 'x', answerType: 'text' }))).toThrow(
      /only apply to kind "information"/
    );
  });

  it('carries kind and evidence through parseTasks', () => {
    const { tasks } = parseTasks({
      url: 'http://x/',
      tasks: [base(), base({ id: 't2', kind: 'information', evidence: 'Musterstrasse 1' })],
    });
    expect(tasks.map((t) => t.kind)).toEqual(['action', 'information']);
    expect(tasks[1].evidence).toBe('Musterstrasse 1');
    expect(tasks[0].evidence).toBeUndefined();
  });
});
