import { describe, expect, it } from 'vitest';
import { accuracy, auc, lcArea } from './metrics.ts';

describe('accuracy', () => {
  it('scores only the given nodes with threshold 0.5', () => {
    const p = [0.9, 0.2, 0.6, 0.5];
    const truth = [1, 0, 0, 0];
    expect(accuracy(p, truth, [0, 1, 2, 3])).toBeCloseTo(0.75); // p = 0.5 counts as "not infected"
    expect(accuracy(p, truth, [0, 1])).toBe(1);
    expect(accuracy(p, truth, [])).toBe(1);
  });
});

describe('auc', () => {
  it('matches sklearn roc_auc_score', () => {
    expect(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1], [0, 1, 2, 3])).toBeCloseTo(0.75);
    expect(auc([0.2, 0.2, 0.7, 0.6, 0.6], [0, 1, 1, 0, 1], [0, 1, 2, 3, 4])).toBeCloseTo(2 / 3);
  });

  it('is null when only one class is present', () => {
    expect(auc([0.1, 0.9], [1, 1], [0, 1])).toBeNull();
  });
});

describe('lcArea', () => {
  it('averages the curve after the seed step', () => {
    expect(lcArea([0.5, 0.6, 0.8])).toBeCloseTo(0.7);
    expect(() => lcArea([0.5])).toThrow();
  });
});
