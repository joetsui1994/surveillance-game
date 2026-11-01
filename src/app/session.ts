import type { Outbreak, Preset, PresetModel } from '../core/presets.ts';
import { scenarioFor } from '../core/presets.ts';
import { lcArea } from '../core/metrics.ts';
import { replay, type Trajectory } from '../core/replay.ts';
import type { Observation } from '../core/surrogate.ts';

/** One player's game. Plain data only, so it serialises to localStorage (and, in Plan 3, to the server). */
export interface Session {
  presetId: string;
  outbreakId: string;
  budget: number;
  seedNode: number;
  picks: number[];
  usedPredictions: boolean;
  usedUncertainty: boolean;
}

export function startSession(preset: Preset, outbreak: Outbreak, budget = preset.defaultBudget): Session {
  if (!(Number.isInteger(budget) && budget >= 1 && budget <= preset.maxBudget))
    throw new Error(`startSession: budget must be an integer in 1..${preset.maxBudget}`);
  return {
    presetId: preset.id,
    outbreakId: outbreak.id,
    budget,
    seedNode: outbreak.seedNode,
    picks: [],
    usedPredictions: false,
    usedUncertainty: false,
  };
}

export const testsLeft = (s: Session): number => s.budget - s.picks.length;
export const isFinished = (s: Session): boolean => testsLeft(s) === 0;
export const isTested = (s: Session, node: number): boolean => node === s.seedNode || s.picks.includes(node);

export function pick(s: Session, node: number, n: number): Session {
  if (isFinished(s)) throw new Error('pick: no tests left');
  if (!(Number.isInteger(node) && node >= 0 && node < n)) throw new Error(`pick: node ${node} out of range`);
  if (isTested(s, node)) throw new Error(`pick: node ${node} already tested`);
  return { ...s, picks: [...s.picks, node] };
}

/** Record that a model overlay was switched on at least once (shown on the leaderboard in Plan 3). */
export function noteToggles(s: Session, predictions: boolean, uncertainty: boolean): Session {
  const usedPredictions = s.usedPredictions || predictions;
  const usedUncertainty = s.usedUncertainty || uncertainty;
  return usedPredictions === s.usedPredictions && usedUncertainty === s.usedUncertainty ? s : { ...s, usedPredictions, usedUncertainty };
}

export function observations(s: Session, truth: (0 | 1)[]): Observation[] {
  return [s.seedNode, ...s.picks].map((node) => ({ node, y: truth[node] }));
}

export interface SessionScore {
  trajectory: Trajectory;
  /** Final ROC-AUC on untested nodes (the paper's metric); null if undefined. */
  auc: number | null;
  /** Mean AUC over tests 1..budget; null if undefined at every step. */
  aucArea: number | null;
  accuracy: number;
}

export function scoreSession(model: PresetModel, outbreak: Outbreak, s: Session): SessionScore {
  const trajectory = replay(scenarioFor(model, outbreak), s.picks);
  return {
    trajectory,
    auc: trajectory.auc[trajectory.auc.length - 1],
    aucArea: s.picks.length > 0 ? lcArea(trajectory.auc) : null,
    accuracy: trajectory.accuracy[trajectory.accuracy.length - 1],
  };
}

export function serializeSession(s: Session): string {
  return JSON.stringify(s);
}

/** Parse a stored session; returns null for anything malformed. */
export function deserializeSession(text: string | null): Session | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Session;
    const ok =
      typeof s.presetId === 'string' &&
      typeof s.outbreakId === 'string' &&
      Number.isInteger(s.budget) &&
      Number.isInteger(s.seedNode) &&
      Array.isArray(s.picks) &&
      s.picks.every(Number.isInteger) &&
      s.picks.length <= s.budget &&
      typeof s.usedPredictions === 'boolean' &&
      typeof s.usedUncertainty === 'boolean';
    return ok ? s : null;
  } catch {
    return null;
  }
}
