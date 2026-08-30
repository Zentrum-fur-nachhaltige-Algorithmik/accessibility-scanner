import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  parseArgs,
  tasksOf,
  rebase,
  describeRoute,
  referenceFiles,
  validateNopt,
  printTable,
  REFERENCE_DIR,
} = require('../../src/agent/validate-nopt');

describe('agent/validate-nopt: CLI arguments', () => {
  it('measures the whole reference directory by default', () => {
    const args = parseArgs([]);
    expect(args).toMatchObject({ dir: REFERENCE_DIR, files: [], remote: false, only: null });
  });

  it('takes files, an origin override and a task filter', () => {
    const args = parseArgs([
      'a.json',
      '--url',
      'http://127.0.0.1:8804/',
      '--only',
      'x, y',
      '--remote',
    ]);
    expect(args).toMatchObject({
      files: ['a.json'],
      url: 'http://127.0.0.1:8804/',
      only: ['x', 'y'],
      remote: true,
    });
  });

  it('moves a recorded url onto another origin, path and query kept', () => {
    expect(rebase('http://localhost:8804/leistungen?a=1', 'http://127.0.0.1:9000')).toBe(
      'http://127.0.0.1:9000/leistungen?a=1'
    );
    expect(rebase('http://localhost:8804/x', null)).toBe('http://localhost:8804/x');
  });
});

describe('agent/validate-nopt: reading the recorded runs', () => {
  it('takes every task that carries a recorded nOpt', () => {
    const rows = tasksOf(
      {
        url: 'http://localhost:8804/',
        tasks: [
          { task: { id: 'a' }, nOpt: 3 },
          { task: { id: 'b' } }, // never measured
          { task: { id: 'c', meta: { url: 'http://localhost:8804/team' } }, nOpt: 7 },
        ],
      },
      '/tmp/run.json'
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rows[0]).toMatchObject({ before: 3, url: 'http://localhost:8804/', file: 'run.json' });
    expect(rows[1].url).toBe('http://localhost:8804/team');
  });

  it('finds the recorded runs of the repository', () => {
    const files = referenceFiles(REFERENCE_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith('.json'))).toBe(true);
  });

  it('explains a route by what it skipped and what it typed', () => {
    const note = describeRoute({
      nOpt: 2,
      skipped: [0],
      steps: [
        { action: 'click', reach: { commands: [{ type: 'prevLink' }] } },
        { action: 'read', reach: { commands: [{ type: 'find', arg: 'preise' }] } },
      ],
    });
    expect(note).toBe('skipped waypoint 0 | prevLink activate find');
  });
});

describe('agent/validate-nopt: the regression table', () => {
  const logger = () => {
    const lines = [];
    return { lines, log: (l) => lines.push(String(l)) };
  };

  const TASKS = [
    { file: 'run.json', id: 'shorter', task: { id: 'shorter' }, before: 5, url: 'http://x/' },
    { file: 'run.json', id: 'same', task: { id: 'same' }, before: 3, url: 'http://x/' },
    { file: 'run.json', id: 'broken', task: { id: 'broken' }, before: 4, url: 'http://x/' },
  ];

  const measure = async (task) => {
    if (task.id === 'shorter') return { nOpt: 2, route: 'dag', skipped: [0], steps: [] };
    if (task.id === 'same') return { nOpt: 3, route: 'guided', steps: [] };
    return { nOpt: null, error: 'target not found: #gone' };
  };

  it('puts the recorded value beside the new one', async () => {
    const rows = await validateNopt({ tasks: TASKS, logger: null, measure });
    expect(rows.map((r) => [r.before, r.after, r.delta])).toEqual([
      [5, 2, -3],
      [3, 3, 0],
      [4, null, null],
    ]);
    expect(rows[0].route).toBe('dag');
    expect(rows[2].error).toMatch(/target not found/);
  });

  it('counts the failures and names every changed value', async () => {
    const rows = await validateNopt({ tasks: TASKS, logger: null, measure });
    const out = logger();
    expect(printTable(rows, out)).toBe(1);
    const text = out.lines.join('\n');
    expect(text).toMatch(/3 task\(s\): 2 measured, 1 changed, 1 failed/);
    expect(text).toMatch(/shorter: 5 -> 2 via skipped waypoint 0/);
    expect(text).toMatch(/FAILED broken: target not found/);
  });
});
