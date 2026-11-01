import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { cholesky } from './linalg.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';

describe('carCovariance', () => {
  it('matches the closed form on a 2-node graph', () => {
    const g = makeGraph(2, [[0, 1]]);
    const [alpha, tau, b0Var] = [0.5, 2, 0.3];
    const K = carCovariance(g, { alpha, tau, b0Var });
    const s = 1 / (tau * (1 - alpha * alpha));
    expect(K[0]).toBeCloseTo(s + b0Var);
    expect(K[1]).toBeCloseTo(s * alpha);
    expect(K[3]).toBeCloseTo(s + b0Var);
  });

  it('is symmetric positive definite on the 10×10 grid', () => {
    const g = makeGraph(100, gridEdges(10, 10));
    const K = carCovariance(g, DEFAULT_PRIOR);
    for (let i = 0; i < 100; i++) for (let j = 0; j < i; j++) expect(K[i * 100 + j]).toBeCloseTo(K[j * 100 + i], 10);
    expect(() => cholesky(K, 100)).not.toThrow();
  });

  it('gives low-degree (corner) nodes higher prior variance than interior nodes', () => {
    const g = makeGraph(100, gridEdges(10, 10));
    const K = carCovariance(g, DEFAULT_PRIOR);
    expect(K[0]).toBeGreaterThan(K[55 * 100 + 55]);
  });

  it('rejects isolated nodes and alpha outside [0, 1)', () => {
    expect(() => carCovariance(makeGraph(3, [[0, 1]]), DEFAULT_PRIOR)).toThrow(/isolated/);
    expect(() => carCovariance(makeGraph(2, [[0, 1]]), { ...DEFAULT_PRIOR, alpha: 1 })).toThrow(/alpha/);
  });
});
