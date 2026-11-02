import type { Outbreak, PresetModel } from '../../core/presets.ts';
import type { Play, RankMetric } from '../net/types.ts';
import { isValidFor, scoreSession, type Session } from '../session.ts';

export interface Scores {
  auc: number | null;
  aucArea: number | null;
  accuracy: number | null;
}

export interface PlayerScore extends Scores {
  play: Play;
  /** Display name, with " (2)" etc. when several players share a nickname. */
  name: string;
  /** AUC after each test (index 0 = seed only). */
  curve: (number | null)[];
}

export const METRIC_LABEL: Record<RankMetric, string> = { auc: 'AUC', lc_auc: 'Learning-curve AUC', accuracy: 'Accuracy' };

export function metricValue(s: Scores, metric: RankMetric): number | null {
  return metric === 'auc' ? s.auc : metric === 'lc_auc' ? s.aucArea : s.accuracy;
}

export function formatMetric(v: number | null, metric: RankMetric): string {
  if (v === null) return '–';
  return metric === 'accuracy' ? `${(100 * v).toFixed(0)}%` : v.toFixed(3);
}

/** Nicknames made unique for display, in submission order: "ada", "ada (2)", … (case-insensitive). */
export function displayNames(plays: Play[]): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const p of [...plays].sort((a, b) => a.id - b.id)) {
    const key = p.nickname.trim().toLowerCase();
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    out.set(p.id, k === 1 ? p.nickname.trim() : `${p.nickname.trim()} (${k})`);
  }
  return out;
}

export function playSession(play: Play, outbreak: Outbreak): Session {
  return {
    presetId: play.presetId,
    outbreakId: play.outbreakId,
    budget: play.budget,
    seedNode: outbreak.seedNode,
    picks: play.picks,
    usedPredictions: play.usedPredictions,
    usedUncertainty: play.usedUncertainty,
    roundId: play.roundId,
  };
}

/** Score every visible play by replaying its picks. Plays that don't fit the outbreak (e.g. testing the seed) are dropped. */
export function scorePlays(model: PresetModel, outbreak: Outbreak, plays: Play[]): PlayerScore[] {
  const names = displayNames(plays);
  const out: PlayerScore[] = [];
  for (const play of plays) {
    if (play.hidden) continue;
    const session = playSession(play, outbreak);
    if (!isValidFor(session, model.preset, outbreak) || play.picks.length !== play.budget) continue;
    const s = scoreSession(model, outbreak, session);
    out.push({ play, name: names.get(play.id)!, auc: s.auc, aucArea: s.aucArea, accuracy: s.accuracy, curve: s.trajectory.auc });
  }
  return out;
}

const r3 = (v: number) => Math.round(v * 1000);

/**
 * Sort best-first by `value` and assign competition ranks (1, 2, 2, 4) with ties at the 3 decimals shown.
 * Items without a value come last with rank null.
 */
export function rankBy<T>(items: T[], value: (t: T) => number | null): { item: T; rank: number | null }[] {
  const defined = items.filter((t) => value(t) !== null).sort((a, b) => value(b)! - value(a)!);
  const ranked = defined.map((item, k) => ({ item, k }));
  const out: { item: T; rank: number | null }[] = [];
  for (const { item, k } of ranked) {
    const prev = out[k - 1];
    const tie = prev && r3(value(prev.item)!) === r3(value(item)!);
    out.push({ item, rank: tie ? prev.rank : k + 1 });
  }
  return [...out, ...items.filter((t) => value(t) === null).map((item) => ({ item, rank: null }))];
}

/** Per-step median of the curves (null where no curve is defined). */
export function medianCurve(curves: (number | null)[][]): (number | null)[] {
  const steps = Math.max(0, ...curves.map((c) => c.length));
  return Array.from({ length: steps }, (_, t) => {
    const v = curves.map((c) => c[t]).filter((x): x is number => x !== null && x !== undefined).sort((a, b) => a - b);
    if (v.length === 0) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
  });
}
