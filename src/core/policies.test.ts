import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';
import { fitLaplace, type Observation, type Posterior } from './surrogate.ts';
import { leScores, pickMax, POLICIES, selectNode, unobservedNodes } from './policies.ts';
import { makeRng } from './rng.ts';

const fakePosterior = (p: number[]): Posterior => ({
  mean: new Float64Array(p.length),
  variance: new Float64Array(p.length),
  p: Float64Array.from(p),
  iterations: 0,
});

const grid = makeGraph(100, gridEdges(10, 10));
const K = carCovariance(grid, DEFAULT_PRIOR);

describe('leScores', () => {
  it('matches the Python local_entropy_select reference on a 4-node path', () => {
    const path = makeGraph(4, [[0, 1], [1, 2], [2, 3]]);
    const s = leScores(path, fakePosterior([0.5, 0.9, 0.5, 0.1]));
    // Reference values computed with the formula in local_entropy.py (numpy).
    expect(s[0]).toBeCloseTo(0.4254641208010383, 10);
    expect(s[1]).toBeCloseTo(0.6195343391262459, 10);
    expect(s[2]).toBeCloseTo(0.3986958148251476, 10);
    expect(s[3]).toBeCloseTo(0.5927660331503553, 10);
  });
});

describe('pickMax', () => {
  it('breaks ties reproducibly with the rng', () => {
    const score = [1, 3, 3, 0];
    const a = pickMax([0, 1, 2, 3], score, makeRng(5));
    expect([1, 2]).toContain(a);
    expect(pickMax([0, 1, 2, 3], score, makeRng(5))).toBe(a);
  });
});

describe('selectNode', () => {
  const obs: Observation[] = [{ node: 44, y: 1 }, { node: 0, y: 0 }];
  const post = fitLaplace(K, 100, obs);

  it('never selects an observed node, for every policy', () => {
    for (const name of POLICIES) {
      for (let seed = 0; seed < 20; seed++) {
        const node = selectNode(name, { graph: grid, posterior: post, obs, rng: makeRng(seed) });
        expect(node === 44 || node === 0).toBe(false);
      }
    }
  });

  it('NE picks the unobserved node with p closest to 0.5', () => {
    const path = makeGraph(4, [[0, 1], [1, 2], [2, 3]]);
    const node = selectNode('NE', {
      graph: path,
      posterior: fakePosterior([0.5, 0.9, 0.45, 0.1]),
      obs: [{ node: 0, y: 1 }],
      rng: makeRng(0),
    });
    expect(node).toBe(2);
  });

  it('DC picks a maximum-degree node', () => {
    const node = selectNode('DC', { graph: grid, posterior: post, obs, rng: makeRng(0) });
    expect(grid.degree[node]).toBe(4);
  });

  it('RI picks a neighbour of a known infection, else any unobserved node', () => {
    for (let seed = 0; seed < 20; seed++) {
      const node = selectNode('RI', { graph: grid, posterior: post, obs, rng: makeRng(seed) });
      expect([34, 43, 45, 54]).toContain(node);
    }
    const noInfected: Observation[] = [{ node: 44, y: 0 }];
    const node = selectNode('RI', { graph: grid, posterior: post, obs: noInfected, rng: makeRng(1) });
    expect(unobservedNodes(100, noInfected)).toContain(node);
  });
});
