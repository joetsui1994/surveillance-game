import { describe, expect, it } from 'vitest';
import { layoutFaults, segmentsCross, type Point } from './layoutQuality.ts';

describe('segmentsCross', () => {
  it('detects a proper crossing but not touching or parallel segments', () => {
    expect(segmentsCross([0, 0], [1, 1], [0, 1], [1, 0])).toBe(true);
    expect(segmentsCross([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
    expect(segmentsCross([0, 0], [1, 0], [1, 0], [1, 1])).toBe(false);
  });
});

describe('layoutFaults', () => {
  it('finds no faults in a well-spread square', () => {
    const square: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(layoutFaults(square, [[0, 1], [1, 2], [2, 3], [3, 0]])).toEqual({ close: [], onEdge: [], crossings: [] });
  });

  it('reports an X crossing as one pair of edge indices', () => {
    const x: Point[] = [[0, 0], [1, 1], [0, 1], [1, 0]];
    expect(layoutFaults(x, [[0, 1], [2, 3]]).crossings).toEqual([[0, 1]]);
  });

  it('reports overlapping nodes (closer than 28 px at 280 px per unit)', () => {
    const near: Point[] = [[0.5, 0.5], [0.55, 0.5], [0, 0]];
    expect(layoutFaults(near, []).close).toEqual([[0, 1]]);
  });

  it('reports a node sitting on an edge it is not part of', () => {
    const line: Point[] = [[0, 0.5], [1, 0.5], [0.5, 0.52]];
    expect(layoutFaults(line, [[0, 1]]).onEdge).toEqual([[2, 0]]);
  });
});
