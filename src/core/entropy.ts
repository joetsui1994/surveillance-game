// 20-point Gauss–Hermite rule (numpy.polynomial.hermite.hermgauss(20)): ∫ e^{-x²} g(x) dx ≈ Σ w_k g(x_k).
const GH_X = [-5.387480890011233, -4.603682449550744, -3.944764040115625, -3.3478545673832163, -2.7888060584281305, -2.2549740020892752, -1.7385377121165861, -1.234076215395323, -0.7374737285453944, -0.24534070830090127, 0.24534070830090127, 0.7374737285453944, 1.234076215395323, 1.7385377121165861, 2.2549740020892752, 2.7888060584281305, 3.3478545673832163, 3.944764040115625, 4.603682449550744, 5.387480890011233];
const GH_W = [2.2293936455341447e-13, 4.3993409922731747e-10, 1.0860693707692782e-07, 7.80255647853206e-06, 0.00022833863601635365, 0.0032437733422378623, 0.024810520887463643, 0.1090172060200233, 0.28667550536283415, 0.4622436696006101, 0.4622436696006101, 0.28667550536283415, 0.1090172060200233, 0.024810520887463643, 0.0032437733422378623, 0.00022833863601635365, 7.80255647853206e-06, 1.0860693707692782e-07, 4.3993409922731747e-10, 2.2293936455341447e-13];
const SQRT_PI = Math.sqrt(Math.PI);
const EPS = 1e-6;

/** Binary entropy in nats, with p clamped to [1e-6, 1 − 1e-6]. */
export function binaryEntropy(p: number): number {
  const q = Math.min(Math.max(p, EPS), 1 - EPS);
  return -q * Math.log(q) - (1 - q) * Math.log(1 - q);
}

/** BALD mutual information for f ~ N(mean, variance), y ~ Bernoulli(σ(f)). */
export function baldScore(mean: number, variance: number): number {
  const s = Math.sqrt(2 * Math.max(variance, 0));
  let pBar = 0;
  let expH = 0;
  for (let k = 0; k < GH_X.length; k++) {
    const pk = 1 / (1 + Math.exp(-(mean + s * GH_X[k])));
    pBar += GH_W[k] * pk;
    expH += GH_W[k] * binaryEntropy(pk);
  }
  return Math.max(binaryEntropy(pBar / SQRT_PI) - expH / SQRT_PI, 0);
}
