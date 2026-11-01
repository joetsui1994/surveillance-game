import type { Graph } from './graph.ts';
import { fitLaplace, type Observation, type Posterior } from './surrogate.ts';
import { selectNode, unobservedNodes, type PolicyName } from './policies.ts';
import { accuracy, auc } from './metrics.ts';

export interface Scenario {
  graph: Graph;
  /** Prior covariance (row-major n×n). */
  K: Float64Array;
  truth: (0 | 1)[];
  seedNode: number;
}

/** Per-step record; index t = state after t tests (t = 0 is seed only). */
export interface Trajectory {
  picks: number[];
  accuracy: number[];
  auc: (number | null)[];
  final: Posterior;
}

function evaluate(sc: Scenario, obs: Observation[]) {
  const post = fitLaplace(sc.K, sc.graph.n, obs);
  const unobs = unobservedNodes(sc.graph.n, obs);
  return { post, acc: accuracy(post.p, sc.truth, unobs), auc: auc(post.p, sc.truth, unobs) };
}

/** Score a fixed sequence of picks (used for human plays). */
export function replay(sc: Scenario, picks: number[]): Trajectory {
  const obs: Observation[] = [{ node: sc.seedNode, y: sc.truth[sc.seedNode] }];
  let e = evaluate(sc, obs);
  const acc = [e.acc];
  const aucs = [e.auc];
  for (const node of picks) {
    if (!(Number.isInteger(node) && node >= 0 && node < sc.graph.n)) throw new Error(`replay: node ${node} out of range`);
    if (obs.some((o) => o.node === node)) throw new Error(`replay: node ${node} already observed`);
    obs.push({ node, y: sc.truth[node] });
    e = evaluate(sc, obs);
    acc.push(e.acc);
    aucs.push(e.auc);
  }
  return { picks: [...picks], accuracy: acc, auc: aucs, final: e.post };
}

/** Run a policy for `budget` tests from the seed node. */
export function runPolicy(sc: Scenario, policy: PolicyName, budget: number, rng: () => number): Trajectory {
  const obs: Observation[] = [{ node: sc.seedNode, y: sc.truth[sc.seedNode] }];
  let e = evaluate(sc, obs);
  const picks: number[] = [];
  const acc = [e.acc];
  const aucs = [e.auc];
  for (let t = 0; t < budget; t++) {
    const node = selectNode(policy, { graph: sc.graph, posterior: e.post, obs, rng });
    picks.push(node);
    obs.push({ node, y: sc.truth[node] });
    e = evaluate(sc, obs);
    acc.push(e.acc);
    aucs.push(e.auc);
  }
  return { picks, accuracy: acc, auc: aucs, final: e.post };
}
