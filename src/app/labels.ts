/**
 * Vertical positions for end-of-line labels: keep each label as close to its target `y` as possible,
 * at least `minGap` apart, inside [lo, hi]. Returns positions in the input order.
 */
export function nudgeLabels(ys: number[], minGap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y: Math.min(Math.max(y, lo), hi), i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + minGap);
  const overflow = order.length > 0 ? order[order.length - 1].y - hi : 0;
  if (overflow > 0) for (const o of order) o.y -= overflow;
  if (order.length > 0 && order[0].y < lo) {
    order[0].y = lo;
    for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + minGap);
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}
