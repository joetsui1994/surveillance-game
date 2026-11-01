/** Visual constants and value→style mappings shared by the graph views. */
export const COLORS = {
  infected: '#c62828',
  clear: '#1565c0',
  truthInfected: '#ef9a9a',
  truthClear: '#90caf9',
  unknown: '#e8e8e8',
  ring: '#ef6c00',
  edge: '#9e9e9e',
  outline: '#757575',
  ink: '#1f1f1f',
};

/** Predictions rarely leave ~[0.35, 0.65], so the colour scale saturates at 0.5 ± this. */
export const PREDICTION_STRETCH = 0.15;

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Diverging blue–white–red for P(infected), stretched over 0.5 ± PREDICTION_STRETCH and clamped. */
export function predictionColor(p: number): string {
  const t = Math.max(-1, Math.min(1, (p - 0.5) / PREDICTION_STRETCH));
  const [r, g, b] = t >= 0
    ? [lerp(255, 229, t), lerp(255, 115, t), lerp(255, 115, t)]
    : [lerp(255, 100, -t), lerp(255, 160, -t), lerp(255, 225, -t)];
  return `rgb(${r},${g},${b})`;
}

/** Min–max scale `values` over `nodes` to [0, 1]; all-equal values map to 0. Other entries are 0. */
export function relativeScale(values: ArrayLike<number>, nodes: number[]): Float64Array {
  const out = new Float64Array(values.length);
  if (nodes.length === 0) return out;
  let lo = Infinity;
  let hi = -Infinity;
  for (const j of nodes) {
    lo = Math.min(lo, values[j]);
    hi = Math.max(hi, values[j]);
  }
  const range = hi - lo;
  if (!(range > 1e-12)) return out;
  for (const j of nodes) out[j] = (values[j] - lo) / range;
  return out;
}

/** Uncertainty ring for a node with relative uncertainty `rel` ∈ [0, 1]. */
export function ringStyle(rel: number): { width: number; opacity: number } {
  return { width: 0.5 + 5 * rel, opacity: 0.25 + 0.7 * rel };
}
