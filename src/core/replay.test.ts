import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';
import { replay, runPolicy, type Scenario } from './replay.ts';
import { makeRng } from './rng.ts';

const graph = makeGraph(100, gridEdges(10, 10));
// Infected blob: Manhattan distance ≤ 3 from (2, 2).
const truth = Array.from({ length: 100 }, (_, i) =>
  (Math.abs(Math.floor(i / 10) - 2) + Math.abs((i % 10) - 2) <= 3 ? 1 : 0) as 0 | 1);
const sc: Scenario = { graph, K: carCovariance(graph, DEFAULT_PRIOR), truth, seedNode: 55 };

describe('runPolicy', () => {
  it('records budget + 1 steps and distinct picks', () => {
    const tr = runPolicy(sc, 'LE', 10, makeRng(0));
    expect(tr.picks).toHaveLength(10);
    expect(new Set([sc.seedNode, ...tr.picks]).size).toBe(11);
    expect(tr.accuracy).toHaveLength(11);
    expect(tr.auc).toHaveLength(11);
  });

  it('is reproducible for a fixed seed', () => {
    expect(runPolicy(sc, 'RAND', 5, makeRng(9)).picks).toEqual(runPolicy(sc, 'RAND', 5, makeRng(9)).picks);
  });

  it('LE beats the seed-only accuracy after 20 tests on a blob outbreak', () => {
    const tr = runPolicy(sc, 'LE', 20, makeRng(0));
    expect(tr.accuracy[20]).toBeGreaterThan(tr.accuracy[0]);
  });
});

describe('replay', () => {
  it('reproduces a policy run from its picks', () => {
    const tr = runPolicy(sc, 'BALD', 8, makeRng(3));
    const re = replay(sc, tr.picks);
    expect(re.accuracy).toEqual(tr.accuracy);
    expect(re.auc).toEqual(tr.auc);
  });

  it('rejects repeated or seed picks', () => {
    expect(() => replay(sc, [55])).toThrow(/already observed/);
    expect(() => replay(sc, [1, 1])).toThrow(/already observed/);
  });

  it('rejects out-of-range picks', () => {
    expect(() => replay(sc, [100])).toThrow(/out of range/);
    expect(() => replay(sc, [-1])).toThrow(/out of range/);
  });
});
