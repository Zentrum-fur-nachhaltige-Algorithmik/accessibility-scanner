import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseArgs, printTable, validateNopt } = require('../../src/agent/validate-nopt');
const { DEFAULTS } = require('../../src/agent/bfs-optimum');

describe('agent/validate-nopt: CLI arguments', () => {
  it('defaults to the within-page BFS budgets', () => {
    const args = parseArgs(['https://example.com', '--tasks', 't.json']);
    expect(args).toMatchObject({
      url: 'https://example.com',
      tasks: 't.json',
      maxPages: DEFAULTS.maxPages,
      maxEdges: DEFAULTS.maxEdges,
      timeoutMs: DEFAULTS.timeoutMs,
    });
    expect(args.maxPages).toBe(1);
  });

  it('takes the exhaustive budgets when asked', () => {
    const args = parseArgs([
      'https://example.com',
      '--tasks',
      't.json',
      '--max-pages',
      '40',
      '--max-edges',
      '600',
      '--only',
      'a, b',
    ]);
    expect(args).toMatchObject({ maxPages: 40, maxEdges: 600, only: ['a', 'b'] });
  });
});

describe('agent/validate-nopt: verdicts', () => {
  const logger = () => {
    const lines = [];
    return { lines, log: (l) => lines.push(String(l)) };
  };

  it('counts a conclusive bfs < guided as a gap', () => {
    const out = logger();
    const gaps = printTable(
      [
        { id: 'ok', nOptGuided: 3, nOptBfs: 3, delta: 0, gap: false, conclusive: true },
        {
          id: 'gappy',
          nOptGuided: 5,
          nOptBfs: 4,
          delta: 1,
          gap: true,
          conclusive: true,
          reason: 'optimal',
          bfsPath: 'formFields jumpTo type activate',
        },
      ],
      out
    );
    expect(gaps).toBe(1);
    expect(out.lines.join('\n')).toMatch(/GAP gappy: bfs 4 < guided 5/);
  });

  it('never fails on an inconclusive (truncated) row', () => {
    const out = logger();
    const gaps = printTable(
      [
        {
          id: 'slow',
          nOptGuided: 8,
          nOptBfs: null,
          delta: null,
          gap: false,
          conclusive: false,
          reason: 'timeout',
          bestFound: 4,
        },
      ],
      out
    );
    expect(gaps).toBe(0);
    expect(out.lines.join('\n')).toMatch(/1 inconclusive, 0 gap/);
  });

  it('marks the gap row from the comparison result', async () => {
    const rows = await validateNopt({
      browser: null,
      url: 'https://example.com',
      tasks: [{ id: 'fine' }, { id: 'gappy' }],
      options: {},
      logger: null,
      compare: async (browser, url, task) => ({
        taskId: task.id,
        nOptGuided: 5,
        nOptBfs: task.id === 'gappy' ? 4 : 5,
        delta: task.id === 'gappy' ? 1 : 0,
        bfsPath: [{ type: 'links' }, { type: 'activate' }],
        explored: { reason: 'optimal', edges: 3 },
        ms: 1,
      }),
    });
    expect(rows.map((r) => r.gap)).toEqual([false, true]);
    expect(rows[1].bfsPath).toBe('links activate');
  });
});
