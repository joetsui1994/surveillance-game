import { probabilityStd } from '../../core/entropy.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { fitLaplace } from '../../core/surrogate.ts';
import { auc } from '../../core/metrics.ts';
import { unobservedNodes } from '../../core/policies.ts';
import { relativeScale } from '../scales.ts';

/** The model's state after `t` tests of a replayed game. */
export interface Frame {
  t: number;
  tested: Map<number, 0 | 1>;
  p: Float64Array;
  /** Relative uncertainty (posterior SD of P(infected), min–max scaled over untested nodes). */
  uncertainty: Float64Array;
  auc: number | null;
  commentary: string;
}

const status = (y: 0 | 1) => (y === 1 ? 'infected' : 'clear');
const fmt = (v: number | null) => (v === null ? '–' : v.toFixed(2));

/** Frames 0..picks.length for stepping through a game (≤ 31 Laplace fits, a few ms). */
export function replayFrames(model: PresetModel, outbreak: Outbreak, picks: number[]): Frame[] {
  const { graph, K } = model;
  const { truth, seedNode } = outbreak;
  const frames: Frame[] = [];
  const nodes = [seedNode, ...picks];
  for (let t = 0; t <= picks.length; t++) {
    const obs = nodes.slice(0, t + 1).map((node) => ({ node, y: truth[node] }));
    const post = fitLaplace(K, graph.n, obs);
    const untested = unobservedNodes(graph.n, obs);
    const sd = Float64Array.from(post.mean, (mu, j) => probabilityStd(mu, post.variance[j]));
    const a = auc(post.p, truth, untested);
    let commentary: string;
    if (t === 0) {
      commentary = `Start: only the starting location ${seedNode} is tested (${status(truth[seedNode])}).`;
    } else {
      const node = picks[t - 1];
      const known = nodes.slice(0, t).filter((j) => truth[j] === 1);
      const hops = known.length === 0 ? null : Math.min(...known.map((j) => graph.dist[j * graph.n + node]));
      const where = hops === null ? 'no infection found yet' : hops === 1 ? 'next to a known infection' : `${hops} hops from the nearest known infection`;
      commentary = `Test ${t}: location ${node}, ${status(truth[node])} · ${where} · AUC ${fmt(frames[t - 1].auc)} → ${fmt(a)}`;
    }
    frames.push({ t, tested: new Map(obs.map((o) => [o.node, o.y])), p: post.p, uncertainty: relativeScale(sd, untested), auc: a, commentary });
  }
  return frames;
}
