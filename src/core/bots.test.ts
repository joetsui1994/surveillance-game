import { describe, expect, it } from 'vitest';
import { quantile, summarise } from './bots.ts';
import type { Trajectory } from './replay.ts';

const traj = (accuracy: number[], auc: (number | null)[], picks: number[]): Trajectory => ({
  picks,
  accuracy,
  auc,
  final: { mean: new Float64Array(0), variance: new Float64Array(0), p: new Float64Array(0), iterations: 0 },
});

describe('quantile', () => {
  it('interpolates linearly (numpy default)', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.05)).toBeCloseTo(1.2);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([7], 0.95)).toBe(7);
  });
});

describe('summarise', () => {
  it('keeps picks and collapses the band for a single run', () => {
    const r = summarise('LE', [traj([0.5, 0.7], [null, 0.8], [3])]);
    expect(r.runs).toBe(1);
    expect(r.picks).toEqual([3]);
    expect(r.accuracy).toEqual({ mean: [0.5, 0.7], lo: [0.5, 0.7], hi: [0.5, 0.7] });
    expect(r.auc.mean).toEqual([null, 0.8]);
  });

  it('averages multiple runs, ignoring null AUCs', () => {
    const r = summarise('RAND', [traj([0.4, 0.6], [null, 0.6], [1]), traj([0.6, 0.8], [0.5, null], [2])]);
    expect(r.picks).toBeNull();
    expect(r.accuracy.mean[0]).toBeCloseTo(0.5);
    expect(r.accuracy.mean[1]).toBeCloseTo(0.7);
    expect(r.auc.mean).toEqual([0.5, 0.6]);
  });
});
