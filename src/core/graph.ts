export interface Graph {
  n: number;
  edges: [number, number][];
  neighbors: number[][];
  degree: number[];
  /** Hop distances, row-major n×n; -1 if unreachable. */
  dist: Int32Array;
}

export function makeGraph(n: number, edges: [number, number][]): Graph {
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) throw new Error(`makeGraph: bad edge ${a}-${b}`);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  const dist = new Int32Array(n * n).fill(-1);
  for (let s = 0; s < n; s++) {
    dist[s * n + s] = 0;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const v of neighbors[u]) {
        if (dist[s * n + v] === -1) {
          dist[s * n + v] = dist[s * n + u] + 1;
          queue.push(v);
        }
      }
    }
  }
  return { n, edges, neighbors, degree: neighbors.map((nb) => nb.length), dist };
}

export function gridEdges(rows: number, cols: number): [number, number][] {
  const edges: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) edges.push([r * cols + c, r * cols + c + 1]);
      if (r + 1 < rows) edges.push([r * cols + c, (r + 1) * cols + c]);
    }
  return edges;
}
