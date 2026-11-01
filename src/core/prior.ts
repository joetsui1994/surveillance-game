import type { Graph } from './graph.ts';
import { inverseSPD } from './linalg.ts';

/** Paper's prior: f = b0 + car, b0_i ~ N(0, b0Var), car ~ CAR(alpha, tau). */
export interface PriorParams {
  alpha: number;
  tau: number;
  b0Var: number;
}

export const DEFAULT_PRIOR: PriorParams = { alpha: 0.9, tau: 1, b0Var: 1 };

/** Prior covariance K = b0Var·I + (tau·(D − alpha·A))⁻¹, row-major n×n. */
export function carCovariance(g: Graph, p: PriorParams): Float64Array {
  const { n } = g;
  if (!(p.alpha >= 0 && p.alpha < 1)) throw new Error('carCovariance: alpha must be in [0, 1)');
  const Q = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    if (g.degree[i] === 0) throw new Error(`carCovariance: node ${i} is isolated`);
    Q[i * n + i] = p.tau * g.degree[i];
    for (const j of g.neighbors[i]) Q[i * n + j] = -p.tau * p.alpha;
  }
  const K = inverseSPD(Q, n);
  for (let i = 0; i < n; i++) K[i * n + i] += p.b0Var;
  return K;
}
