import type { PolicyName } from './policies.ts';
import type { Trajectory } from './replay.ts';

/** Per-step summary across runs; index t = after t tests. null where no run had a defined value. */
export interface Band {
  mean: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
}

export interface BotResult {
  policy: PolicyName;
  runs: number;
  /** Pick sequence for single-run (deterministic) policies; null for multi-run policies. */
  picks: number[] | null;
  accuracy: Band;
  auc: Band;
}

export interface BotsFile {
  version: 1;
  /** presetId → outbreakId → one result per policy. */
  presets: Record<string, Record<string, BotResult[]>>;
}

/** Linear-interpolation quantile of an ascending-sorted array. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function band(series: (number | null)[][]): Band {
  const steps = series[0].length;
  const out: Band = { mean: [], lo: [], hi: [] };
  for (let t = 0; t < steps; t++) {
    const vals = series.map((s) => s[t]).filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (vals.length === 0) {
      out.mean.push(null);
      out.lo.push(null);
      out.hi.push(null);
      continue;
    }
    out.mean.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    out.lo.push(quantile(vals, 0.05));
    out.hi.push(quantile(vals, 0.95));
  }
  return out;
}

export function summarise(policy: PolicyName, runs: Trajectory[]): BotResult {
  if (runs.length === 0) throw new Error('summarise: no runs');
  return {
    policy,
    runs: runs.length,
    picks: runs.length === 1 ? runs[0].picks : null,
    accuracy: band(runs.map((r) => r.accuracy)),
    auc: band(runs.map((r) => r.auc)),
  };
}
