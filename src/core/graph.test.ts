import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';

describe('gridEdges', () => {
  it('builds a rows×cols lattice', () => {
    expect(gridEdges(2, 3)).toEqual([[0, 1], [0, 3], [1, 2], [1, 4], [2, 5], [3, 4], [4, 5]]);
    expect(gridEdges(10, 10)).toHaveLength(180);
  });
});

describe('makeGraph', () => {
  it('computes neighbours, degree and hop distances', () => {
    const g = makeGraph(4, [[0, 1], [1, 2], [2, 3]]);
    expect(g.neighbors[1].sort()).toEqual([0, 2]);
    expect(g.degree).toEqual([1, 2, 2, 1]);
    expect(g.dist[0 * 4 + 3]).toBe(3);
    expect(g.dist[2 * 4 + 2]).toBe(0);
  });

  it('marks unreachable pairs as -1', () => {
    const g = makeGraph(3, [[0, 1]]);
    expect(g.dist[0 * 3 + 2]).toBe(-1);
  });

  it('rejects bad edges', () => {
    expect(() => makeGraph(2, [[0, 0]])).toThrow(/bad edge/);
    expect(() => makeGraph(2, [[0, 2]])).toThrow(/bad edge/);
  });

  it('has expected structure on a 10×10 grid', () => {
    const g = makeGraph(100, gridEdges(10, 10));
    expect(g.degree[0]).toBe(2);
    expect(g.degree[5]).toBe(3);
    expect(g.degree[55]).toBe(4);
    expect(g.dist[0 * 100 + 99]).toBe(18);
  });
});
