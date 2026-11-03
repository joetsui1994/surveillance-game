// Layout checks in rendered pixels, mirroring offline/layout_quality.py (the game draws [0, 1]² into 280 px).
export const PX_PER_UNIT = 280;
/** Centre-to-centre; uncertainty rings reach ~15 px from a node's centre. */
export const MIN_NODE_GAP_PX = 28;
/** A node's centre to any edge it isn't part of. */
export const MIN_EDGE_CLEARANCE_PX = 14;

export type Point = [number, number];

export interface LayoutFaults {
  /** Node pairs closer than MIN_NODE_GAP_PX. */
  close: [number, number][];
  /** [node, edge index] where the node sits within MIN_EDGE_CLEARANCE_PX of an edge it isn't part of. */
  onEdge: [number, number][];
  /** Pairs of edge indices that cross. */
  crossings: [number, number][];
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const orient = (a: Point, b: Point, c: Point) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** True if segments p1p2 and p3p4 properly cross (touching or collinear doesn't count). */
export function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  return orient(p1, p2, p3) * orient(p1, p2, p4) < 0 && orient(p3, p4, p1) * orient(p3, p4, p2) < 0;
}

export function layoutFaults(layout: Point[], edges: [number, number][]): LayoutFaults {
  const px = layout.map(([x, y]): Point => [x * PX_PER_UNIT, y * PX_PER_UNIT]);
  const close: [number, number][] = [];
  for (let i = 0; i < px.length; i++)
    for (let j = i + 1; j < px.length; j++) if (Math.hypot(px[i][0] - px[j][0], px[i][1] - px[j][1]) < MIN_NODE_GAP_PX) close.push([i, j]);
  const onEdge: [number, number][] = [];
  edges.forEach(([a, b], e) => {
    for (let i = 0; i < px.length; i++) if (i !== a && i !== b && pointSegmentDistance(px[i], px[a], px[b]) < MIN_EDGE_CLEARANCE_PX) onEdge.push([i, e]);
  });
  const crossings: [number, number][] = [];
  for (let e = 0; e < edges.length; e++)
    for (let f = e + 1; f < edges.length; f++) {
      const [a, b] = edges[e];
      const [c, d] = edges[f];
      if (new Set([a, b, c, d]).size === 4 && segmentsCross(px[a], px[b], px[c], px[d])) crossings.push([e, f]);
    }
  return { close, onEdge, crossings };
}
