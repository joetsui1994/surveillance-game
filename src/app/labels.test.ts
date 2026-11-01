import { describe, expect, it } from 'vitest';
import { nudgeLabels } from './labels.ts';

describe('nudgeLabels', () => {
  it('leaves well-separated labels alone', () => {
    expect(nudgeLabels([10, 50, 90], 14, 0, 200)).toEqual([10, 50, 90]);
  });

  it('pushes crowded labels apart, preserving order and input positions', () => {
    const out = nudgeLabels([100, 95, 102, 98], 14, 0, 200);
    const sorted = [...out].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(14 - 1e-9);
    expect(out[1]).toBeLessThan(out[3]); // 95 stays above 98
    expect(out[3]).toBeLessThan(out[0]); // 98 stays above 100
  });

  it('keeps labels inside the bounds', () => {
    const out = nudgeLabels([195, 196, 199], 14, 0, 200);
    expect(Math.max(...out)).toBeLessThanOrEqual(200);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
  });
});
