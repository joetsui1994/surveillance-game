import { choleskyJitter, solveLower, solveLowerT } from './linalg.ts';

export interface Observation {
  node: number;
  y: 0 | 1;
}

export interface Posterior {
  /** Laplace posterior mean of the latent f, per node. */
  mean: Float64Array;
  /** Laplace posterior variance of the latent f, per node. */
  variance: Float64Array;
  /** P(infected) per node, probit approximation. */
  p: Float64Array;
  iterations: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const softplus = (x: number) => (x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x)));
const logLik = (y: number, f: number) => y * f - softplus(f);

/**
 * Laplace approximation for binary GP classification with logistic link
 * (Rasmussen & Williams 2006, Algorithms 3.1 & 3.2), restricted to observed nodes.
 * K is the prior covariance over all n nodes (row-major).
 */
export function fitLaplace(K: Float64Array, n: number, obs: Observation[], maxIter = 100, tol = 1e-10): Posterior {
  const m = obs.length;
  const idx = obs.map((o) => o.node);
  const y = obs.map((o) => o.y);
  if (new Set(idx).size !== m) throw new Error('fitLaplace: duplicate observed node');

  const Koo = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) Koo[i * m + j] = K[idx[i] * n + idx[j]];
  const matvec = (v: Float64Array) => {
    const out = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += Koo[i * m + j] * v[j];
      out[i] = s;
    }
    return out;
  };
  const objective = (a: Float64Array, f: Float64Array) => {
    let s = 0;
    for (let i = 0; i < m; i++) s += -0.5 * a[i] * f[i] + logLik(y[i], f[i]);
    return s;
  };
  const factor = (f: Float64Array) => {
    const sW = new Float64Array(m);
    const W = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const pi = sigmoid(f[i]);
      W[i] = pi * (1 - pi);
      sW[i] = Math.sqrt(W[i]);
    }
    const B = new Float64Array(m * m);
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) B[i * m + j] = (i === j ? 1 : 0) + sW[i] * Koo[i * m + j] * sW[j];
    return { W, sW, L: choleskyJitter(B, m) };
  };

  let a = new Float64Array(m);
  let f = new Float64Array(m);
  let obj = objective(a, f);
  let iterations = 0;
  for (; iterations < maxIter && m > 0; iterations++) {
    const { W, sW, L } = factor(f);
    const b = new Float64Array(m);
    for (let i = 0; i < m; i++) b[i] = W[i] * f[i] + (y[i] - sigmoid(f[i]));
    const Kb = matvec(b);
    const rhs = new Float64Array(m);
    for (let i = 0; i < m; i++) rhs[i] = sW[i] * Kb[i];
    const c = solveLowerT(L, m, solveLower(L, m, rhs));
    const aNew = new Float64Array(m);
    for (let i = 0; i < m; i++) aNew[i] = b[i] - sW[i] * c[i];
    let fNew = matvec(aNew);
    let objNew = objective(aNew, fNew);
    // Step-halving if the Newton step did not improve the objective.
    for (let h = 0; h < 10 && objNew < obj; h++) {
      for (let i = 0; i < m; i++) aNew[i] = 0.5 * (aNew[i] + a[i]);
      fNew = matvec(aNew);
      objNew = objective(aNew, fNew);
    }
    // No improving step even after halving: the current f is the numerical optimum.
    if (objNew < obj) break;
    const converged = Math.abs(objNew - obj) < tol;
    a = aNew;
    f = fNew;
    obj = objNew;
    if (converged) {
      iterations++;
      break;
    }
  }

  const mean = new Float64Array(n);
  const variance = new Float64Array(n);
  const p = new Float64Array(n);
  const { sW, L } = m > 0 ? factor(f) : { sW: new Float64Array(0), L: new Float64Array(0) };
  const grad = new Float64Array(m);
  for (let i = 0; i < m; i++) grad[i] = y[i] - sigmoid(f[i]);
  const k = new Float64Array(m);
  for (let j = 0; j < n; j++) {
    let mu = 0;
    for (let i = 0; i < m; i++) {
      k[i] = K[idx[i] * n + j];
      mu += k[i] * grad[i];
    }
    let v = K[j * n + j];
    if (m > 0) {
      const scaled = new Float64Array(m);
      for (let i = 0; i < m; i++) scaled[i] = sW[i] * k[i];
      const w = solveLower(L, m, scaled);
      for (let i = 0; i < m; i++) v -= w[i] * w[i];
    }
    mean[j] = mu;
    variance[j] = Math.max(v, 0);
    p[j] = sigmoid(mu / Math.sqrt(1 + (Math.PI * variance[j]) / 8));
  }
  return { mean, variance, p, iterations };
}
