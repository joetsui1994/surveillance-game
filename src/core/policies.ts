import type { Graph } from './graph.ts';
import type { Observation, Posterior } from './surrogate.ts';
import { baldScore, binaryEntropy } from './entropy.ts';

export const POLICIES = ['LE', 'NE', 'BALD', 'DC', 'RI', 'RAND'] as const;
export type PolicyName = (typeof POLICIES)[number];

export interface PolicyContext {
  graph: Graph;
  posterior: Posterior;
  obs: Observation[];
  rng: () => number;
}

export function neScores(post: Posterior): Float64Array {
  return post.p.map(binaryEntropy);
}

export function baldScores(post: Posterior): Float64Array {
  return post.mean.map((mu, j) => baldScore(mu, post.variance[j]));
}

/** Local Entropy (ported from local_entropy.py): 1/d-weighted mean entropy of all other nodes. */
export function leScores(g: Graph, post: Posterior): Float64Array {
  const { n, dist } = g;
  const H = neScores(post);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let num = 0;
    let den = 0;
    for (let j = 0; j < n; j++) {
      const d = dist[k * n + j];
      if (j === k || d < 0) continue;
      num += H[j] / d;
      den += 1 / d;
    }
    out[k] = den > 0 ? num / den : 0;
  }
  return out;
}

export function unobservedNodes(n: number, obs: Observation[]): number[] {
  const seen = new Set(obs.map((o) => o.node));
  return Array.from({ length: n }, (_, i) => i).filter((i) => !seen.has(i));
}

/** Argmax over candidates with seeded random tie-breaking. */
export function pickMax(candidates: number[], score: ArrayLike<number>, rng: () => number): number {
  if (candidates.length === 0) throw new Error('pickMax: no candidates');
  let best = -Infinity;
  for (const c of candidates) best = Math.max(best, score[c]);
  const ties = candidates.filter((c) => score[c] >= best - 1e-12);
  return ties[Math.floor(rng() * ties.length)];
}

export function selectNode(name: PolicyName, ctx: PolicyContext): number {
  const { graph, posterior, obs, rng } = ctx;
  const candidates = unobservedNodes(graph.n, obs);
  switch (name) {
    case 'NE':
      return pickMax(candidates, neScores(posterior), rng);
    case 'BALD':
      return pickMax(candidates, baldScores(posterior), rng);
    case 'LE':
      return pickMax(candidates, leScores(graph, posterior), rng);
    case 'DC':
      return pickMax(candidates, graph.degree, rng);
    case 'RI': {
      const cand = new Set(candidates);
      const frontier = new Set<number>();
      for (const o of obs) if (o.y === 1) for (const v of graph.neighbors[o.node]) if (cand.has(v)) frontier.add(v);
      const pool = frontier.size > 0 ? [...frontier].sort((a, b) => a - b) : candidates;
      return pool[Math.floor(rng() * pool.length)];
    }
    case 'RAND':
      return candidates[Math.floor(rng() * candidates.length)];
  }
}
