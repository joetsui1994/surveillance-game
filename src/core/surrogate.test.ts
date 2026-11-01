import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';
import { fitLaplace, type Observation } from './surrogate.ts';

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const N = 100;
const grid = makeGraph(N, gridEdges(10, 10));
const K = carCovariance(grid, DEFAULT_PRIOR);

describe('fitLaplace', () => {
  it('returns the prior when nothing is observed', () => {
    const post = fitLaplace(K, N, []);
    expect(post.iterations).toBe(0);
    for (let j = 0; j < N; j++) {
      expect(post.mean[j]).toBe(0);
      expect(post.variance[j]).toBeCloseTo(K[j * N + j]);
      expect(post.p[j]).toBe(0.5);
    }
  });

  it('matches the analytic single-observation solution', () => {
    const post = fitLaplace(K, N, [{ node: 0, y: 1 }]);
    const f0 = post.mean[0];
    expect(f0).toBeCloseTo(K[0] * (1 - sigmoid(f0)), 8); // mode condition
    const W = sigmoid(f0) * (1 - sigmoid(f0));
    for (const j of [1, 7, 55, 99]) {
      expect(post.mean[j]).toBeCloseTo(K[j] * (1 - sigmoid(f0)), 8);
      expect(post.variance[j]).toBeCloseTo(K[j * N + j] - K[j] ** 2 / (K[0] + 1 / W), 8);
    }
  });

  it('satisfies the mode fixed point f = K_oo (y − σ(f)) with several observations', () => {
    const obs: Observation[] = [{ node: 0, y: 1 }, { node: 1, y: 0 }, { node: 55, y: 0 }, { node: 99, y: 1 }];
    const post = fitLaplace(K, N, obs);
    for (const o of obs) {
      let s = 0;
      for (const o2 of obs) s += K[o.node * N + o2.node] * (o2.y - sigmoid(post.mean[o2.node]));
      expect(post.mean[o.node]).toBeCloseTo(s, 8);
    }
  });

  it('raises P(infected) near a positive test, decaying with distance', () => {
    const post = fitLaplace(K, N, [{ node: 44, y: 1 }]);
    const row = [44, 45, 46, 47, 48].map((j) => post.p[j]);
    for (let i = 0; i < row.length - 1; i++) expect(row[i]).toBeGreaterThan(row[i + 1]);
    expect(row[4]).toBeGreaterThan(0.5);
  });

  it('is symmetric under mirrored observations on a path', () => {
    const path = makeGraph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    const Kp = carCovariance(path, DEFAULT_PRIOR);
    const post = fitLaplace(Kp, 6, [{ node: 0, y: 1 }, { node: 5, y: 0 }]);
    for (let i = 0; i < 6; i++) expect(post.p[i] + post.p[5 - i]).toBeCloseTo(1, 8);
  });

  it('stays finite with conflicting adjacent observations', () => {
    const post = fitLaplace(K, N, [{ node: 44, y: 1 }, { node: 45, y: 0 }]);
    for (let j = 0; j < N; j++) expect(Number.isFinite(post.p[j])).toBe(true);
  });

  it('rejects duplicate observations', () => {
    expect(() => fitLaplace(K, N, [{ node: 3, y: 1 }, { node: 3, y: 0 }])).toThrow(/duplicate/);
  });
});
