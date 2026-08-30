import { describe, it, expect } from 'vitest';
import { barrierScore } from '../../src/agent/barrier-score.js';

const run = (nSr, success = true) => ({ nSr, success });
const taskResult = (id, nOpt, runs, kind) => ({ task: { id, kind }, nSighted: 1, nOpt, runs });

describe('barrierScore', () => {
  it('splits nOpt/nSR into the agent factor Q and the barrier factor B', () => {
    const blind = { tasks: [taskResult('a', 3, [run(6), run(12)])] };
    const priv = { tasks: [taskResult('a', 3, [run(4), run(2)])] };
    const { tasks, site } = barrierScore(blind, priv);
    expect(tasks[0].nPriv).toBe(3);
    expect(tasks[0].Q).toBe(1);
    // per blind run 3/6 and 3/12, averaged
    expect(tasks[0].B).toBeCloseTo((0.5 + 0.25) / 2);
    expect(site.B).toBeCloseTo(0.375);
    expect(site.Bpooled).toBeCloseTo(6 / 18);
  });

  it('caps both factors at 1 and scores a failed blind run as 0', () => {
    const blind = { tasks: [taskResult('a', 3, [run(2), run(19, false)])] };
    const priv = { tasks: [taskResult('a', 3, [run(5)])] };
    const { tasks } = barrierScore(blind, priv);
    expect(tasks[0].Q).toBeCloseTo(0.6);
    expect(tasks[0].B).toBeCloseTo((1 + 0) / 2);
  });

  it('leaves a task the privileged agent never solved out of B as agent-limited', () => {
    const blind = { tasks: [taskResult('a', 3, [run(4)]), taskResult('b', 3, [run(4)])] };
    const priv = { tasks: [taskResult('a', 3, [run(19, false)]), taskResult('b', 3, [run(4)])] };
    const { tasks, site } = barrierScore(blind, priv);
    expect(tasks[0].agentLimited).toBe(true);
    expect(tasks[0].B).toBeNull();
    expect(site.scored).toBe(1);
    expect(site.agentLimited).toEqual(['a']);
    expect(site.B).toBe(1);
  });

  it('ignores tasks missing from the privileged run', () => {
    const blind = { tasks: [taskResult('a', 3, [run(4)]), taskResult('c', 3, [run(4)])] };
    const priv = { tasks: [taskResult('a', 3, [run(4)])] };
    expect(barrierScore(blind, priv).tasks.map((t) => t.id)).toEqual(['a']);
  });
});
