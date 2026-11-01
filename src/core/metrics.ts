/** Fraction of `nodes` whose thresholded prediction (p > 0.5 ⇒ infected) matches truth. */
export function accuracy(p: ArrayLike<number>, truth: ArrayLike<number>, nodes: number[]): number {
  if (nodes.length === 0) return 1;
  let correct = 0;
  for (const j of nodes) if ((p[j] > 0.5 ? 1 : 0) === truth[j]) correct++;
  return correct / nodes.length;
}

/** ROC-AUC over `nodes` (Mann–Whitney, ties count ½). null if only one class present. */
export function auc(p: ArrayLike<number>, truth: ArrayLike<number>, nodes: number[]): number | null {
  const pos = nodes.filter((j) => truth[j] === 1);
  const neg = nodes.filter((j) => truth[j] === 0);
  if (pos.length === 0 || neg.length === 0) return null;
  let s = 0;
  for (const i of pos) for (const j of neg) s += p[i] > p[j] ? 1 : p[i] === p[j] ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/**
 * Learning-curve area: mean of curve[1..] (curve[0] is the seed-only state). Undefined (null) steps,
 * e.g. AUC when unobserved nodes are all one class, are skipped; null if no step is defined.
 */
export function lcArea(curve: (number | null)[]): number | null {
  if (curve.length < 2) throw new Error('lcArea: need at least one test after the seed');
  const defined = curve.slice(1).filter((v): v is number => v !== null);
  return defined.length > 0 ? defined.reduce((a, b) => a + b, 0) / defined.length : null;
}
