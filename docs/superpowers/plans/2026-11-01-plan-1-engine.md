# Surveillance Game — Plan 1: Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless engine of the surveillance game: a pure-TypeScript surrogate model, AL policies, metrics and replay (`src/core/`), the preset/outbreak data for a 10×10 grid, a calibrated prior, precomputed bots, a speed benchmark and an MCMC validation report.

**Architecture:** `src/core/` is DOM-free TypeScript run by both the browser (Plans 2–3) and Node scripts. The surrogate is a latent-Gaussian CAR model (the paper's prior structure) fitted by Laplace approximation over observed nodes only (Rasmussen & Williams Alg. 3.1/3.2), so a fit is ~0.1 ms. Offline Python (uv) builds presets with the paper repo's `simulate_binary_outbreak` and validates the surrogate against NumPyro MCMC. Node scripts calibrate the prior and precompute bots into static JSON.

**Tech Stack:** TypeScript 5.8+/7 (type-stripped `.ts` run directly by Node ≥ 23.6), Vitest, Python 3.12 via `uv` (networkx, numpy, numpyro, jax, matplotlib).

**Spec:** `docs/superpowers/specs/2026-11-01-surveillance-game-design.md`. This is Plan 1 of 3 (Plan 2: player app; Plan 3: multiplayer/presenter/board).

**Pre-verified:** All code in this plan was run in a prototype before writing: 49 tests pass, typecheck clean, benchmark/calibration/bots/validation all run. Expected outputs below are from that run.

---

## Conventions

- Working directory for every command: `/Users/user/Documents/conferences-workshops/ICID2026/workshop/surveillance-game` (the "app root"). The paper repo must exist at `../optimal-disease-surveillance-AL` (it does).
- Imports between TS files use explicit `.ts` extensions and `import type` for type-only imports (required for Node type-stripping).
- Matrices are dense, row-major `Float64Array` of length `n*n`; element (i, j) is `M[i * n + j]`.
- Node scripts are run with `node --disable-warning=ExperimentalWarning scripts/<name>.ts` (wrapped by npm scripts).
- Commit after every task. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## File Structure

```
surveillance-game/
├── package.json, tsconfig.json, .gitignore
├── src/core/                    pure TS, no DOM
│   ├── rng.ts                   seeded PRNG (mulberry32)
│   ├── graph.ts                 Graph type, BFS hop distances, grid edges
│   ├── linalg.ts                Cholesky, triangular solves, SPD inverse
│   ├── prior.ts                 CAR prior covariance K = b0Var·I + (τ(D − αA))⁻¹
│   ├── surrogate.ts             Laplace fit → {mean, variance, p}
│   ├── entropy.ts               binary entropy, BALD (Gauss–Hermite)
│   ├── policies.ts              LE, NE, BALD, DC, RI, RAND + score functions
│   ├── metrics.ts               accuracy, AUC, learning-curve area
│   ├── replay.ts                Scenario, replay(picks), runPolicy
│   ├── presets.ts               preset/outbreak types, loader, model builder
│   ├── bots.ts                  bot result types + run summarisation
│   └── *.test.ts                Vitest unit tests (one per module)
├── scripts/                     Node scripts using src/core
│   ├── io.ts                    paths + JSON load/save
│   ├── bench.ts                 speed benchmark
│   ├── calibrate-prior.ts       prior grid search → presets.json
│   ├── build-bots.ts            → public/data/bots.json
│   └── export-scenarios.ts      → offline/out/scenarios.json
├── offline/                     Python (uv project)
│   ├── pyproject.toml
│   ├── build_presets.py         graphs + outbreaks → public/data/presets.json
│   └── validate_surrogate.py    Laplace vs NumPyro MCMC → docs/validation/
├── public/data/                 presets.json, bots.json (committed)
└── docs/                        spec, plans, benchmark.md, validation/
```


---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "surveillance-game",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "bench": "node --disable-warning=ExperimentalWarning scripts/bench.ts",
    "data:presets": "uv run --project offline python offline/build_presets.py",
    "data:calibrate": "node --disable-warning=ExperimentalWarning scripts/calibrate-prior.ts --write",
    "data:bots": "node --disable-warning=ExperimentalWarning scripts/build-bots.ts",
    "data": "npm run data:presets && npm run data:calibrate && npm run data:bots",
    "validate": "node --disable-warning=ExperimentalWarning scripts/export-scenarios.ts && uv run --project offline python offline/validate_surrogate.py"
  },
  "devDependencies": {
    "@types/node": "^26.6.6",
    "typescript": "^7.0.2",
    "vitest": "^3.2.7"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 3: Install dev dependencies**

Run: `npm install -D typescript vitest @types/node`
Expected: installs without errors; `npx vitest --version` prints `vitest/3.x` (or newer) and `npx tsc -v` prints 5.8+ (7.x is fine).

- [ ] **Step 4: Extend `.gitignore`**

Append these lines to the existing `.gitignore`:

```
offline/out/
offline/.venv/
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: scaffold TypeScript + Vitest project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 2: Seeded RNG

A small deterministic PRNG so bots and tie-breaking are reproducible.

**Files:**
- Create: `src/core/rng.ts`
- Test: `src/core/rng.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/rng.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { makeRng } from './rng.ts';

describe('makeRng', () => {
  it('is reproducible for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs across seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('returns values in [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 10_000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/rng.test.ts`
Expected: FAIL — `Failed to load url ./rng.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/rng.ts`

```ts
/** Seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/rng.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/rng.ts src/core/rng.test.ts
git commit -m "feat(core): seeded rng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 3: Graph and hop distances

Graph structure with all-pairs BFS hop distances (needed by LE and the hover rings) and a grid-edge helper.

**Files:**
- Create: `src/core/graph.ts`
- Test: `src/core/graph.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/graph.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/graph.test.ts`
Expected: FAIL — `Failed to load url ./graph.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/graph.ts`

```ts
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
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/graph.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph.ts src/core/graph.test.ts
git commit -m "feat(core): graph and hop distances

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 4: Dense linear algebra

Cholesky (with jitter fallback), triangular solves and SPD inverse. Sizes are ≤ ~200, so dense O(n³) is fine.

**Files:**
- Create: `src/core/linalg.ts`
- Test: `src/core/linalg.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/linalg.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { cholesky, choleskyJitter, inverseSPD, solveLower, solveLowerT } from './linalg.ts';

const A = Float64Array.from([4, 2, 2, 3]);

describe('cholesky', () => {
  it('factors a 2×2 SPD matrix', () => {
    const L = cholesky(A, 2);
    expect(L[0]).toBeCloseTo(2);
    expect(L[1]).toBe(0);
    expect(L[2]).toBeCloseTo(1);
    expect(L[3]).toBeCloseTo(Math.SQRT2);
  });

  it('throws on non-PD input', () => {
    expect(() => cholesky(Float64Array.from([1, 2, 2, 1]), 2)).toThrow(/positive definite/);
  });

  it('choleskyJitter recovers a singular PSD matrix', () => {
    const L = choleskyJitter(Float64Array.from([1, 1, 1, 1]), 2);
    expect(Number.isFinite(L[3])).toBe(true);
  });
});

describe('triangular solves', () => {
  it('solve L x = b and Lᵀ x = b', () => {
    const L = cholesky(A, 2);
    const b = Float64Array.from([2, 5]);
    const x = solveLowerT(L, 2, solveLower(L, 2, b)); // A x = b
    expect(4 * x[0] + 2 * x[1]).toBeCloseTo(2);
    expect(2 * x[0] + 3 * x[1]).toBeCloseTo(5);
  });
});

describe('inverseSPD', () => {
  it('returns the inverse', () => {
    const inv = inverseSPD(A, 2);
    expect(4 * inv[0] + 2 * inv[2]).toBeCloseTo(1);
    expect(4 * inv[1] + 2 * inv[3]).toBeCloseTo(0);
    expect(2 * inv[0] + 3 * inv[2]).toBeCloseTo(0);
    expect(2 * inv[1] + 3 * inv[3]).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/linalg.test.ts`
Expected: FAIL — `Failed to load url ./linalg.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/linalg.ts`

```ts
// Dense row-major linear algebra on Float64Array. Matrices are n×n unless stated.

export function cholesky(A: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (!(s > 0)) throw new Error(`cholesky: matrix not positive definite (pivot ${i})`);
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }
  return L;
}

/** Cholesky with escalating diagonal jitter for nearly-singular matrices. */
export function choleskyJitter(A: Float64Array, n: number): Float64Array {
  let jitter = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (jitter === 0) return cholesky(A, n);
      const B = A.slice();
      for (let i = 0; i < n; i++) B[i * n + i] += jitter;
      return cholesky(B, n);
    } catch {
      jitter = jitter === 0 ? 1e-10 : jitter * 100;
    }
  }
  throw new Error('choleskyJitter: failed after jitter 1e0');
}

/** Solve L x = b for lower-triangular L. */
export function solveLower(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Solve Lᵀ x = b for lower-triangular L. */
export function solveLowerT(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Inverse of a symmetric positive-definite matrix. */
export function inverseSPD(A: Float64Array, n: number): Float64Array {
  const L = choleskyJitter(A, n);
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0);
    e[j] = 1;
    const col = solveLowerT(L, n, solveLower(L, n, e));
    for (let i = 0; i < n; i++) inv[i * n + j] = col[i];
  }
  return inv;
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/linalg.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/linalg.ts src/core/linalg.test.ts
git commit -m "feat(core): dense linear algebra

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 5: CAR prior covariance

The paper's prior f = b0 + car, b0ᵢ ~ N(0, b0Var), car ~ CAR(α, τ) with precision τ(D − αA), expressed as a covariance matrix K computed once per graph.

**Files:**
- Create: `src/core/prior.ts`
- Test: `src/core/prior.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/prior.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { cholesky } from './linalg.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';

describe('carCovariance', () => {
  it('matches the closed form on a 2-node graph', () => {
    const g = makeGraph(2, [[0, 1]]);
    const [alpha, tau, b0Var] = [0.5, 2, 0.3];
    const K = carCovariance(g, { alpha, tau, b0Var });
    const s = 1 / (tau * (1 - alpha * alpha));
    expect(K[0]).toBeCloseTo(s + b0Var);
    expect(K[1]).toBeCloseTo(s * alpha);
    expect(K[3]).toBeCloseTo(s + b0Var);
  });

  it('is symmetric positive definite on the 10×10 grid', () => {
    const g = makeGraph(100, gridEdges(10, 10));
    const K = carCovariance(g, DEFAULT_PRIOR);
    for (let i = 0; i < 100; i++) for (let j = 0; j < i; j++) expect(K[i * 100 + j]).toBeCloseTo(K[j * 100 + i], 10);
    expect(() => cholesky(K, 100)).not.toThrow();
  });

  it('gives low-degree (corner) nodes higher prior variance than interior nodes', () => {
    const g = makeGraph(100, gridEdges(10, 10));
    const K = carCovariance(g, DEFAULT_PRIOR);
    expect(K[0]).toBeGreaterThan(K[55 * 100 + 55]);
  });

  it('rejects isolated nodes and alpha outside [0, 1)', () => {
    expect(() => carCovariance(makeGraph(3, [[0, 1]]), DEFAULT_PRIOR)).toThrow(/isolated/);
    expect(() => carCovariance(makeGraph(2, [[0, 1]]), { ...DEFAULT_PRIOR, alpha: 1 })).toThrow(/alpha/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/prior.test.ts`
Expected: FAIL — `Failed to load url ./prior.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/prior.ts`

```ts
import type { Graph } from './graph.ts';
import { inverseSPD } from './linalg.ts';

/** Paper's prior: f = b0 + car, b0_i ~ N(0, b0Var), car ~ CAR(alpha, tau). */
export interface PriorParams {
  alpha: number;
  tau: number;
  b0Var: number;
}

export const DEFAULT_PRIOR: PriorParams = { alpha: 0.9, tau: 1, b0Var: 1 };

/** Prior covariance K = b0Var·I + (tau·(D − alpha·A))⁻¹, row-major n×n. */
export function carCovariance(g: Graph, p: PriorParams): Float64Array {
  const { n } = g;
  if (!(p.alpha >= 0 && p.alpha < 1)) throw new Error('carCovariance: alpha must be in [0, 1)');
  const Q = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    if (g.degree[i] === 0) throw new Error(`carCovariance: node ${i} is isolated`);
    Q[i * n + i] = p.tau * g.degree[i];
    for (const j of g.neighbors[i]) Q[i * n + j] = -p.tau * p.alpha;
  }
  const K = inverseSPD(Q, n);
  for (let i = 0; i < n; i++) K[i * n + i] += p.b0Var;
  return K;
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/prior.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/prior.ts src/core/prior.test.ts
git commit -m "feat(core): car prior covariance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 6: Laplace surrogate

Laplace approximation for logistic GP classification restricted to the m observed nodes (R&W Alg. 3.1 for the mode with step-halving; Alg. 3.2 for predictive mean/variance at all n nodes). P(infected) uses the probit approximation σ(μ/√(1 + πs²/8)). Cost is O(m³ + n·m²) per fit, since K is precomputed.

**Files:**
- Create: `src/core/surrogate.ts`
- Test: `src/core/surrogate.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/surrogate.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';
import { fitLaplace, type Observation } from './surrogate.ts';

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const N = 100;
const grid = makeGraph(N, gridEdges(10, 10));
const K = carCovariance(grid, DEFAULT_PRIOR);

describe('fitLaplace', () => {
  it('returns the prior when nothing is observed', () => {
    const post = fitLaplace(K, N, []);
    expect(post.iterations).toBe(0);
    for (let j = 0; j < N; j++) {
      expect(post.mean[j]).toBe(0);
      expect(post.variance[j]).toBeCloseTo(K[j * N + j]);
      expect(post.p[j]).toBe(0.5);
    }
  });

  it('matches the analytic single-observation solution', () => {
    const post = fitLaplace(K, N, [{ node: 0, y: 1 }]);
    const f0 = post.mean[0];
    expect(f0).toBeCloseTo(K[0] * (1 - sigmoid(f0)), 8); // mode condition
    const W = sigmoid(f0) * (1 - sigmoid(f0));
    for (const j of [1, 7, 55, 99]) {
      expect(post.mean[j]).toBeCloseTo(K[j] * (1 - sigmoid(f0)), 8);
      expect(post.variance[j]).toBeCloseTo(K[j * N + j] - K[j] ** 2 / (K[0] + 1 / W), 8);
    }
  });

  it('satisfies the mode fixed point f = K_oo (y − σ(f)) with several observations', () => {
    const obs: Observation[] = [{ node: 0, y: 1 }, { node: 1, y: 0 }, { node: 55, y: 0 }, { node: 99, y: 1 }];
    const post = fitLaplace(K, N, obs);
    for (const o of obs) {
      let s = 0;
      for (const o2 of obs) s += K[o.node * N + o2.node] * (o2.y - sigmoid(post.mean[o2.node]));
      expect(post.mean[o.node]).toBeCloseTo(s, 8);
    }
  });

  it('raises P(infected) near a positive test, decaying with distance', () => {
    const post = fitLaplace(K, N, [{ node: 44, y: 1 }]);
    const row = [44, 45, 46, 47, 48].map((j) => post.p[j]);
    for (let i = 0; i < row.length - 1; i++) expect(row[i]).toBeGreaterThan(row[i + 1]);
    expect(row[4]).toBeGreaterThan(0.5);
  });

  it('is symmetric under mirrored observations on a path', () => {
    const path = makeGraph(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    const Kp = carCovariance(path, DEFAULT_PRIOR);
    const post = fitLaplace(Kp, 6, [{ node: 0, y: 1 }, { node: 5, y: 0 }]);
    for (let i = 0; i < 6; i++) expect(post.p[i] + post.p[5 - i]).toBeCloseTo(1, 8);
  });

  it('stays finite with conflicting adjacent observations', () => {
    const post = fitLaplace(K, N, [{ node: 44, y: 1 }, { node: 45, y: 0 }]);
    for (let j = 0; j < N; j++) expect(Number.isFinite(post.p[j])).toBe(true);
  });

  it('rejects duplicate observations', () => {
    expect(() => fitLaplace(K, N, [{ node: 3, y: 1 }, { node: 3, y: 0 }])).toThrow(/duplicate/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/surrogate.test.ts`
Expected: FAIL — `Failed to load url ./surrogate.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/surrogate.ts`

```ts
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
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/surrogate.test.ts && npx tsc --noEmit`
Expected: PASS (7 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/surrogate.ts src/core/surrogate.test.ts
git commit -m "feat(core): laplace surrogate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 7: Entropy and BALD

Binary entropy (nats, clamped) and BALD mutual information via 20-point Gauss–Hermite quadrature (nodes/weights from `numpy.polynomial.hermite.hermgauss(20)`).

**Files:**
- Create: `src/core/entropy.ts`
- Test: `src/core/entropy.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/entropy.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { baldScore, binaryEntropy } from './entropy.ts';
import { makeRng } from './rng.ts';

describe('binaryEntropy', () => {
  it('is ln 2 at p = 0.5, symmetric, and finite at the boundaries', () => {
    expect(binaryEntropy(0.5)).toBeCloseTo(Math.LN2);
    expect(binaryEntropy(0.2)).toBeCloseTo(binaryEntropy(0.8));
    expect(binaryEntropy(0)).toBeGreaterThan(0);
    expect(binaryEntropy(0)).toBeLessThan(1e-4);
    expect(binaryEntropy(1)).toBeCloseTo(binaryEntropy(0));
  });
});

describe('baldScore', () => {
  it('is zero with no latent uncertainty', () => {
    expect(baldScore(0.7, 0)).toBeCloseTo(0, 12);
  });

  it('grows with latent variance at mean 0', () => {
    expect(baldScore(0, 1)).toBeGreaterThan(baldScore(0, 0.5));
    expect(baldScore(0, 4)).toBeGreaterThan(baldScore(0, 1));
  });

  it('agrees with a Monte Carlo estimate', () => {
    const rng = makeRng(123);
    const [mu, v, S] = [0.8, 1.5, 200_000];
    let pBar = 0;
    let expH = 0;
    for (let s = 0; s < S; s++) {
      const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); // Box–Muller
      const p = 1 / (1 + Math.exp(-(mu + Math.sqrt(v) * z)));
      pBar += p / S;
      expH += binaryEntropy(p) / S;
    }
    expect(baldScore(mu, v)).toBeCloseTo(binaryEntropy(pBar) - expH, 3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/entropy.test.ts`
Expected: FAIL — `Failed to load url ./entropy.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/entropy.ts`

```ts
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
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/entropy.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/entropy.ts src/core/entropy.test.ts
git commit -m "feat(core): entropy and bald

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 8: Policies

All six policies. LE is a direct port of `optimal-disease-surveillance-AL/code/binary_prevalence/active_allocation/local_entropy.py` (entropy over all nodes, weight 1/d, self excluded, normalised by the weight sum). Ties are broken with the seeded RNG.

**Files:**
- Create: `src/core/policies.ts`
- Test: `src/core/policies.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/policies.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';
import { fitLaplace, type Observation, type Posterior } from './surrogate.ts';
import { leScores, pickMax, POLICIES, selectNode, unobservedNodes } from './policies.ts';
import { makeRng } from './rng.ts';

const fakePosterior = (p: number[]): Posterior => ({
  mean: new Float64Array(p.length),
  variance: new Float64Array(p.length),
  p: Float64Array.from(p),
  iterations: 0,
});

const grid = makeGraph(100, gridEdges(10, 10));
const K = carCovariance(grid, DEFAULT_PRIOR);

describe('leScores', () => {
  it('matches the Python local_entropy_select reference on a 4-node path', () => {
    const path = makeGraph(4, [[0, 1], [1, 2], [2, 3]]);
    const s = leScores(path, fakePosterior([0.5, 0.9, 0.5, 0.1]));
    // Reference values computed with the formula in local_entropy.py (numpy).
    expect(s[0]).toBeCloseTo(0.4254641208010383, 10);
    expect(s[1]).toBeCloseTo(0.6195343391262459, 10);
    expect(s[2]).toBeCloseTo(0.3986958148251476, 10);
    expect(s[3]).toBeCloseTo(0.5927660331503553, 10);
  });
});

describe('pickMax', () => {
  it('breaks ties reproducibly with the rng', () => {
    const score = [1, 3, 3, 0];
    const a = pickMax([0, 1, 2, 3], score, makeRng(5));
    expect([1, 2]).toContain(a);
    expect(pickMax([0, 1, 2, 3], score, makeRng(5))).toBe(a);
  });
});

describe('selectNode', () => {
  const obs: Observation[] = [{ node: 44, y: 1 }, { node: 0, y: 0 }];
  const post = fitLaplace(K, 100, obs);

  it('never selects an observed node, for every policy', () => {
    for (const name of POLICIES) {
      for (let seed = 0; seed < 20; seed++) {
        const node = selectNode(name, { graph: grid, posterior: post, obs, rng: makeRng(seed) });
        expect(node === 44 || node === 0).toBe(false);
      }
    }
  });

  it('NE picks the unobserved node with p closest to 0.5', () => {
    const path = makeGraph(4, [[0, 1], [1, 2], [2, 3]]);
    const node = selectNode('NE', {
      graph: path,
      posterior: fakePosterior([0.5, 0.9, 0.45, 0.1]),
      obs: [{ node: 0, y: 1 }],
      rng: makeRng(0),
    });
    expect(node).toBe(2);
  });

  it('DC picks a maximum-degree node', () => {
    const node = selectNode('DC', { graph: grid, posterior: post, obs, rng: makeRng(0) });
    expect(grid.degree[node]).toBe(4);
  });

  it('RI picks a neighbour of a known infection, else any unobserved node', () => {
    for (let seed = 0; seed < 20; seed++) {
      const node = selectNode('RI', { graph: grid, posterior: post, obs, rng: makeRng(seed) });
      expect([34, 43, 45, 54]).toContain(node);
    }
    const noInfected: Observation[] = [{ node: 44, y: 0 }];
    const node = selectNode('RI', { graph: grid, posterior: post, obs: noInfected, rng: makeRng(1) });
    expect(unobservedNodes(100, noInfected)).toContain(node);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/policies.test.ts`
Expected: FAIL — `Failed to load url ./policies.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/policies.ts`

```ts
import type { Graph } from './graph.ts';
import type { Observation, Posterior } from './surrogate.ts';
import { baldScore, binaryEntropy } from './entropy.ts';

export const POLICIES = ['LE', 'NE', 'BALD', 'DC', 'RI', 'RAND'] as const;
export type PolicyName = (typeof POLICIES)[number];

export interface PolicyContext {
  graph: Graph;
  posterior: Posterior;
  obs: Observation[];
  rng: () => number;
}

export function neScores(post: Posterior): Float64Array {
  return post.p.map(binaryEntropy);
}

export function baldScores(post: Posterior): Float64Array {
  return post.mean.map((mu, j) => baldScore(mu, post.variance[j]));
}

/** Local Entropy (ported from local_entropy.py): 1/d-weighted mean entropy of all other nodes. */
export function leScores(g: Graph, post: Posterior): Float64Array {
  const { n, dist } = g;
  const H = neScores(post);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let num = 0;
    let den = 0;
    for (let j = 0; j < n; j++) {
      const d = dist[k * n + j];
      if (j === k || d < 0) continue;
      num += H[j] / d;
      den += 1 / d;
    }
    out[k] = den > 0 ? num / den : 0;
  }
  return out;
}

export function unobservedNodes(n: number, obs: Observation[]): number[] {
  const seen = new Set(obs.map((o) => o.node));
  return Array.from({ length: n }, (_, i) => i).filter((i) => !seen.has(i));
}

/** Argmax over candidates with seeded random tie-breaking. */
export function pickMax(candidates: number[], score: ArrayLike<number>, rng: () => number): number {
  if (candidates.length === 0) throw new Error('pickMax: no candidates');
  let best = -Infinity;
  for (const c of candidates) best = Math.max(best, score[c]);
  const ties = candidates.filter((c) => score[c] >= best - 1e-12);
  return ties[Math.floor(rng() * ties.length)];
}

export function selectNode(name: PolicyName, ctx: PolicyContext): number {
  const { graph, posterior, obs, rng } = ctx;
  const candidates = unobservedNodes(graph.n, obs);
  switch (name) {
    case 'NE':
      return pickMax(candidates, neScores(posterior), rng);
    case 'BALD':
      return pickMax(candidates, baldScores(posterior), rng);
    case 'LE':
      return pickMax(candidates, leScores(graph, posterior), rng);
    case 'DC':
      return pickMax(candidates, graph.degree, rng);
    case 'RI': {
      const cand = new Set(candidates);
      const frontier = new Set<number>();
      for (const o of obs) if (o.y === 1) for (const v of graph.neighbors[o.node]) if (cand.has(v)) frontier.add(v);
      const pool = frontier.size > 0 ? [...frontier].sort((a, b) => a - b) : candidates;
      return pool[Math.floor(rng() * pool.length)];
    }
    case 'RAND':
      return candidates[Math.floor(rng() * candidates.length)];
  }
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/policies.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/policies.ts src/core/policies.test.ts
git commit -m "feat(core): policies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 9: Metrics

Scores on unobserved nodes: accuracy (p > 0.5 ⇒ infected), ROC-AUC (Mann–Whitney, null if one class; reference values from sklearn), learning-curve area (mean accuracy over steps 1..B).

**Files:**
- Create: `src/core/metrics.ts`
- Test: `src/core/metrics.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/metrics.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { accuracy, auc, lcArea } from './metrics.ts';

describe('accuracy', () => {
  it('scores only the given nodes with threshold 0.5', () => {
    const p = [0.9, 0.2, 0.6, 0.5];
    const truth = [1, 0, 0, 0];
    expect(accuracy(p, truth, [0, 1, 2, 3])).toBeCloseTo(0.75); // p = 0.5 counts as "not infected"
    expect(accuracy(p, truth, [0, 1])).toBe(1);
    expect(accuracy(p, truth, [])).toBe(1);
  });
});

describe('auc', () => {
  it('matches sklearn roc_auc_score', () => {
    expect(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1], [0, 1, 2, 3])).toBeCloseTo(0.75);
    expect(auc([0.2, 0.2, 0.7, 0.6, 0.6], [0, 1, 1, 0, 1], [0, 1, 2, 3, 4])).toBeCloseTo(2 / 3);
  });

  it('is null when only one class is present', () => {
    expect(auc([0.1, 0.9], [1, 1], [0, 1])).toBeNull();
  });
});

describe('lcArea', () => {
  it('averages the curve after the seed step', () => {
    expect(lcArea([0.5, 0.6, 0.8])).toBeCloseTo(0.7);
    expect(() => lcArea([0.5])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/metrics.test.ts`
Expected: FAIL — `Failed to load url ./metrics.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/metrics.ts`

```ts
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

/** Learning-curve area: mean of curve[1..] (curve[0] is the seed-only state). */
export function lcArea(curve: number[]): number {
  if (curve.length < 2) throw new Error('lcArea: need at least one test after the seed');
  let s = 0;
  for (let t = 1; t < curve.length; t++) s += curve[t];
  return s / (curve.length - 1);
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/metrics.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/metrics.ts src/core/metrics.test.ts
git commit -m "feat(core): metrics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 10: Replay and policy runs

`replay` scores a human's pick sequence; `runPolicy` drives a bot. Both record per-step accuracy/AUC where index t = after t tests (t = 0 is the seed node only).

**Files:**
- Create: `src/core/replay.ts`
- Test: `src/core/replay.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/replay.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { gridEdges, makeGraph } from './graph.ts';
import { carCovariance, DEFAULT_PRIOR } from './prior.ts';
import { replay, runPolicy, type Scenario } from './replay.ts';
import { makeRng } from './rng.ts';

const graph = makeGraph(100, gridEdges(10, 10));
// Infected blob: Manhattan distance ≤ 3 from (2, 2).
const truth = Array.from({ length: 100 }, (_, i) =>
  (Math.abs(Math.floor(i / 10) - 2) + Math.abs((i % 10) - 2) <= 3 ? 1 : 0) as 0 | 1);
const sc: Scenario = { graph, K: carCovariance(graph, DEFAULT_PRIOR), truth, seedNode: 55 };

describe('runPolicy', () => {
  it('records budget + 1 steps and distinct picks', () => {
    const tr = runPolicy(sc, 'LE', 10, makeRng(0));
    expect(tr.picks).toHaveLength(10);
    expect(new Set([sc.seedNode, ...tr.picks]).size).toBe(11);
    expect(tr.accuracy).toHaveLength(11);
    expect(tr.auc).toHaveLength(11);
  });

  it('is reproducible for a fixed seed', () => {
    expect(runPolicy(sc, 'RAND', 5, makeRng(9)).picks).toEqual(runPolicy(sc, 'RAND', 5, makeRng(9)).picks);
  });

  it('LE beats the seed-only accuracy after 20 tests on a blob outbreak', () => {
    const tr = runPolicy(sc, 'LE', 20, makeRng(0));
    expect(tr.accuracy[20]).toBeGreaterThan(tr.accuracy[0]);
  });
});

describe('replay', () => {
  it('reproduces a policy run from its picks', () => {
    const tr = runPolicy(sc, 'BALD', 8, makeRng(3));
    const re = replay(sc, tr.picks);
    expect(re.accuracy).toEqual(tr.accuracy);
    expect(re.auc).toEqual(tr.auc);
  });

  it('rejects repeated or seed picks', () => {
    expect(() => replay(sc, [55])).toThrow(/already observed/);
    expect(() => replay(sc, [1, 1])).toThrow(/already observed/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/replay.test.ts`
Expected: FAIL — `Failed to load url ./replay.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/replay.ts`

```ts
import type { Graph } from './graph.ts';
import { fitLaplace, type Observation, type Posterior } from './surrogate.ts';
import { selectNode, unobservedNodes, type PolicyName } from './policies.ts';
import { accuracy, auc } from './metrics.ts';

export interface Scenario {
  graph: Graph;
  /** Prior covariance (row-major n×n). */
  K: Float64Array;
  truth: (0 | 1)[];
  seedNode: number;
}

/** Per-step record; index t = state after t tests (t = 0 is seed only). */
export interface Trajectory {
  picks: number[];
  accuracy: number[];
  auc: (number | null)[];
  final: Posterior;
}

function evaluate(sc: Scenario, obs: Observation[]) {
  const post = fitLaplace(sc.K, sc.graph.n, obs);
  const unobs = unobservedNodes(sc.graph.n, obs);
  return { post, acc: accuracy(post.p, sc.truth, unobs), auc: auc(post.p, sc.truth, unobs) };
}

/** Score a fixed sequence of picks (used for human plays). */
export function replay(sc: Scenario, picks: number[]): Trajectory {
  const obs: Observation[] = [{ node: sc.seedNode, y: sc.truth[sc.seedNode] }];
  let e = evaluate(sc, obs);
  const acc = [e.acc];
  const aucs = [e.auc];
  for (const node of picks) {
    if (obs.some((o) => o.node === node)) throw new Error(`replay: node ${node} already observed`);
    obs.push({ node, y: sc.truth[node] });
    e = evaluate(sc, obs);
    acc.push(e.acc);
    aucs.push(e.auc);
  }
  return { picks: [...picks], accuracy: acc, auc: aucs, final: e.post };
}

/** Run a policy for `budget` tests from the seed node. */
export function runPolicy(sc: Scenario, policy: PolicyName, budget: number, rng: () => number): Trajectory {
  const obs: Observation[] = [{ node: sc.seedNode, y: sc.truth[sc.seedNode] }];
  let e = evaluate(sc, obs);
  const picks: number[] = [];
  const acc = [e.acc];
  const aucs = [e.auc];
  for (let t = 0; t < budget; t++) {
    const node = selectNode(policy, { graph: sc.graph, posterior: e.post, obs, rng });
    picks.push(node);
    obs.push({ node, y: sc.truth[node] });
    e = evaluate(sc, obs);
    acc.push(e.acc);
    aucs.push(e.auc);
  }
  return { picks, accuracy: acc, auc: aucs, final: e.post };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/replay.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/replay.ts src/core/replay.test.ts
git commit -m "feat(core): replay and policy runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 11: Presets model

Types for `public/data/presets.json`, light validation, and helpers to build the graph + K once per preset and a Scenario per outbreak.

**Files:**
- Create: `src/core/presets.ts`
- Test: `src/core/presets.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/presets.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel, scenarioFor, type Preset } from './presets.ts';

const tiny: Preset = {
  id: 'path4',
  name: 'Path',
  n: 4,
  edges: [[0, 1], [1, 2], [2, 3]],
  layout: [[0, 0], [0.33, 0], [0.66, 0], [1, 0]],
  communities: null,
  defaultBudget: 1,
  maxBudget: 2,
  prior: { alpha: 0.9, tau: 1, b0Var: 1 },
  outbreaks: [{ id: 'ob00', split: 'game', truth: [1, 1, 0, 0], seedNode: 0, prevalence: 0.5 }],
};

describe('parsePresetFile', () => {
  it('accepts a valid file', () => {
    expect(parsePresetFile({ version: 1, presets: [tiny] }).presets[0].id).toBe('path4');
  });

  it('rejects malformed files', () => {
    expect(() => parsePresetFile({ version: 2, presets: [] })).toThrow(/version/);
    expect(() => parsePresetFile({ version: 1, presets: [{ ...tiny, maxBudget: 4 }] })).toThrow(/budgets/);
    const badTruth = { ...tiny, outbreaks: [{ ...tiny.outbreaks[0], truth: [1, 0] as (0 | 1)[] }] };
    expect(() => parsePresetFile({ version: 1, presets: [badTruth] })).toThrow(/truth/);
  });
});

describe('presetModel / scenarioFor', () => {
  it('builds a graph, covariance and scenario', () => {
    const model = presetModel(tiny);
    expect(model.graph.n).toBe(4);
    expect(model.K).toHaveLength(16);
    const sc = scenarioFor(model, tiny.outbreaks[0]);
    expect(sc.seedNode).toBe(0);
    expect(sc.truth).toEqual([1, 1, 0, 0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/presets.test.ts`
Expected: FAIL — `Failed to load url ./presets.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/presets.ts`

```ts
import { makeGraph, type Graph } from './graph.ts';
import { carCovariance, type PriorParams } from './prior.ts';
import type { Scenario } from './replay.ts';

export interface Outbreak {
  id: string;
  /** 'game' outbreaks are played; 'calib' outbreaks are only used to calibrate the prior. */
  split: 'game' | 'calib';
  truth: (0 | 1)[];
  seedNode: number;
  prevalence: number;
}

export interface Preset {
  id: string;
  name: string;
  n: number;
  edges: [number, number][];
  /** Node positions in [0, 1]². */
  layout: [number, number][];
  communities: number[] | null;
  defaultBudget: number;
  maxBudget: number;
  prior: PriorParams;
  outbreaks: Outbreak[];
}

export interface PresetFile {
  version: 1;
  presets: Preset[];
}

/** Light structural validation of presets.json; throws with a useful message. */
export function parsePresetFile(json: unknown): PresetFile {
  const file = json as PresetFile;
  if (file?.version !== 1 || !Array.isArray(file.presets)) throw new Error('presets: expected { version: 1, presets: [...] }');
  for (const p of file.presets) {
    if (p.layout.length !== p.n) throw new Error(`presets/${p.id}: layout length ${p.layout.length} ≠ n ${p.n}`);
    if (!(p.defaultBudget > 0 && p.defaultBudget <= p.maxBudget && p.maxBudget < p.n))
      throw new Error(`presets/${p.id}: budgets must satisfy 0 < default ≤ max < n`);
    for (const o of p.outbreaks) {
      if (o.truth.length !== p.n) throw new Error(`presets/${p.id}/${o.id}: truth length ≠ n`);
      if (!(o.seedNode >= 0 && o.seedNode < p.n)) throw new Error(`presets/${p.id}/${o.id}: seedNode out of range`);
    }
  }
  return file;
}

export interface PresetModel {
  preset: Preset;
  graph: Graph;
  K: Float64Array;
}

/** Build the graph and prior covariance for a preset (do this once per preset). */
export function presetModel(preset: Preset): PresetModel {
  const graph = makeGraph(preset.n, preset.edges);
  return { preset, graph, K: carCovariance(graph, preset.prior) };
}

export function scenarioFor(model: PresetModel, outbreak: Outbreak): Scenario {
  return { graph: model.graph, K: model.K, truth: outbreak.truth, seedNode: outbreak.seedNode };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/presets.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/presets.ts src/core/presets.test.ts
git commit -m "feat(core): presets model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 12: Bot summaries

Types for `public/data/bots.json` and `summarise`, which collapses one or many trajectories into per-step mean and 5–95% band (nulls ignored for AUC).

**Files:**
- Create: `src/core/bots.ts`
- Test: `src/core/bots.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/bots.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { quantile, summarise } from './bots.ts';
import type { Trajectory } from './replay.ts';

const traj = (accuracy: number[], auc: (number | null)[], picks: number[]): Trajectory => ({
  picks,
  accuracy,
  auc,
  final: { mean: new Float64Array(0), variance: new Float64Array(0), p: new Float64Array(0), iterations: 0 },
});

describe('quantile', () => {
  it('interpolates linearly (numpy default)', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.05)).toBeCloseTo(1.2);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([7], 0.95)).toBe(7);
  });
});

describe('summarise', () => {
  it('keeps picks and collapses the band for a single run', () => {
    const r = summarise('LE', [traj([0.5, 0.7], [null, 0.8], [3])]);
    expect(r.runs).toBe(1);
    expect(r.picks).toEqual([3]);
    expect(r.accuracy).toEqual({ mean: [0.5, 0.7], lo: [0.5, 0.7], hi: [0.5, 0.7] });
    expect(r.auc.mean).toEqual([null, 0.8]);
  });

  it('averages multiple runs, ignoring null AUCs', () => {
    const r = summarise('RAND', [traj([0.4, 0.6], [null, 0.6], [1]), traj([0.6, 0.8], [0.5, null], [2])]);
    expect(r.picks).toBeNull();
    expect(r.accuracy.mean[0]).toBeCloseTo(0.5);
    expect(r.accuracy.mean[1]).toBeCloseTo(0.7);
    expect(r.auc.mean).toEqual([0.5, 0.6]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/bots.test.ts`
Expected: FAIL — `Failed to load url ./bots.ts` / cannot find module.

- [ ] **Step 3: Write the implementation** — `src/core/bots.ts`

```ts
import type { PolicyName } from './policies.ts';
import type { Trajectory } from './replay.ts';

/** Per-step summary across runs; index t = after t tests. null where no run had a defined value. */
export interface Band {
  mean: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
}

export interface BotResult {
  policy: PolicyName;
  runs: number;
  /** Pick sequence for single-run (deterministic) policies; null for multi-run policies. */
  picks: number[] | null;
  accuracy: Band;
  auc: Band;
}

export interface BotsFile {
  version: 1;
  /** presetId → outbreakId → one result per policy. */
  presets: Record<string, Record<string, BotResult[]>>;
}

/** Linear-interpolation quantile of an ascending-sorted array. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function band(series: (number | null)[][]): Band {
  const steps = series[0].length;
  const out: Band = { mean: [], lo: [], hi: [] };
  for (let t = 0; t < steps; t++) {
    const vals = series.map((s) => s[t]).filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (vals.length === 0) {
      out.mean.push(null);
      out.lo.push(null);
      out.hi.push(null);
      continue;
    }
    out.mean.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    out.lo.push(quantile(vals, 0.05));
    out.hi.push(quantile(vals, 0.95));
  }
  return out;
}

export function summarise(policy: PolicyName, runs: Trajectory[]): BotResult {
  if (runs.length === 0) throw new Error('summarise: no runs');
  return {
    policy,
    runs: runs.length,
    picks: runs.length === 1 ? runs[0].picks : null,
    accuracy: band(runs.map((r) => r.accuracy)),
    auc: band(runs.map((r) => r.auc)),
  };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/core/bots.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests), typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/core/bots.ts src/core/bots.test.ts
git commit -m "feat(core): bot summaries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 13: Full core test run

- [ ] **Step 1: Run every test and the typecheck**

Run: `npm test && npm run typecheck`
Expected: `Test Files  11 passed (11)`, `Tests  49 passed (49)`; typecheck silent. If anything fails, fix before continuing (no commit needed if nothing changed).

---

### Task 14: Offline Python environment and preset builder

Builds `public/data/presets.json`: the 10×10 grid (node id = row·10 + col, layout = grid coordinates in [0,1]²) with 30 outbreaks simulated by the paper repo's `simulate_binary_outbreak` (prevalence 25–50%): the first 10 are `split: "game"`, the remaining 20 `split: "calib"` (used only for prior calibration). Each outbreak has a random seed node. More presets (BA, SBM) are added later by extending the `PRESETS` registry.

**Files:**
- Create: `offline/pyproject.toml`
- Create: `offline/build_presets.py`
- Create (generated): `public/data/presets.json`

- [ ] **Step 1: Write `offline/pyproject.toml`**

```toml
[project]
name = "surveillance-game-offline"
version = "0.1.0"
requires-python = ">=3.11,<3.13"
dependencies = [
    "networkx>=3.2",
    "numpy>=1.26",
    "numpyro>=0.15",
    "jax>=0.4.30",
    "matplotlib>=3.8",
]

[tool.uv]
package = false
```

- [ ] **Step 2: Write `offline/build_presets.py`**

```python
"""Build preset graphs and outbreaks for the surveillance game.

Writes public/data/presets.json. Outbreaks are simulated with the paper repo's
simulate_binary_outbreak (optimal-disease-surveillance-AL).
"""
import argparse
import json
import os
import sys
from pathlib import Path

import networkx as nx
import numpy as np

# The paper repo is expected to sit next to this app (override with SURVEILLANCE_REPO).
REPO_CODE = Path(os.environ.get("SURVEILLANCE_REPO", Path(__file__).resolve().parents[2] / "optimal-disease-surveillance-AL")) / "code"
sys.path.insert(0, str(REPO_CODE))
from binary_prevalence.outbreak_simulation.base import simulate_binary_outbreak  # noqa: E402

DEFAULT_PRIOR = {"alpha": 0.9, "tau": 1.0, "b0Var": 1.0}


def grid_preset(rows, cols):
    g = nx.grid_2d_graph(rows, cols)
    mapping = {(r, c): r * cols + c for r, c in g.nodes}
    g = nx.relabel_nodes(g, mapping)
    layout = [[(i % cols) / (cols - 1), (i // cols) / (rows - 1)] for i in range(rows * cols)]
    return g, layout, None


# id -> (name, builder, outbreak simulation params)
PRESETS = {
    "grid10": ("10×10 grid", lambda: grid_preset(10, 10), {"end_time": 8, "transmission_p": 0.25, "initial_infected_num": 1}),
}


def simulate_outbreaks(g, params, count, game_count, seed, prevalence_range=(0.25, 0.5), max_tries=10_000):
    """Simulate `count` distinct outbreaks; the first `game_count` are played, the rest calibrate the prior."""
    n = g.number_of_nodes()
    rng = np.random.default_rng(seed)
    outbreaks = []
    for _ in range(max_tries):
        if len(outbreaks) == count:
            break
        np.random.seed(int(rng.integers(0, 2**31 - 1)))  # simulator uses the global numpy RNG
        history = simulate_binary_outbreak(g, **params)
        truth = [int(x) for x in history[params["end_time"]]]
        prevalence = sum(truth) / n
        if not (prevalence_range[0] <= prevalence <= prevalence_range[1]):
            continue
        if any(o["truth"] == truth for o in outbreaks):
            continue
        outbreaks.append({
            "id": f"ob{len(outbreaks):02d}",
            "split": "game" if len(outbreaks) < game_count else "calib",
            "truth": truth,
            "seedNode": int(rng.integers(0, n)),
            "prevalence": round(prevalence, 4),
        })
    if len(outbreaks) < count:
        raise RuntimeError(f"only found {len(outbreaks)} outbreaks in prevalence range {prevalence_range}")
    return outbreaks


def build(out_path, game_outbreaks, calib_outbreaks, seed):
    presets = []
    for i, (pid, (name, builder, sim_params)) in enumerate(PRESETS.items()):
        g, layout, communities = builder()
        n = g.number_of_nodes()
        assert sorted(g.nodes) == list(range(n)), "nodes must be labelled 0..n-1"
        assert nx.is_connected(g), f"{pid} must be connected"
        presets.append({
            "id": pid,
            "name": name,
            "n": n,
            "edges": sorted([min(a, b), max(a, b)] for a, b in g.edges),
            "layout": layout,
            "communities": communities,
            "defaultBudget": round(0.2 * n),
            "maxBudget": round(0.3 * n),
            "prior": DEFAULT_PRIOR,
            "outbreaks": simulate_outbreaks(g, sim_params, game_outbreaks + calib_outbreaks, game_outbreaks, seed + i),
        })
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"version": 1, "presets": presets}))
    for p in presets:
        prev = [o["prevalence"] for o in p["outbreaks"]]
        print(f"{p['id']}: n={p['n']} edges={len(p['edges'])} outbreaks={len(prev)} prevalence {min(prev):.2f}-{max(prev):.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "data" / "presets.json")
    ap.add_argument("--game-outbreaks", type=int, default=10)
    ap.add_argument("--calib-outbreaks", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261112)
    args = ap.parse_args()
    build(args.out, args.game_outbreaks, args.calib_outbreaks, args.seed)
```

- [ ] **Step 3: Build the presets**

Run: `npm run data:presets`
Expected (first run also creates `offline/.venv` and downloads Python 3.12 if needed):
```
grid10: n=100 edges=180 outbreaks=30 prevalence 0.25-0.49
```

- [ ] **Step 4: Sanity-check an outbreak visually**

Run:
```bash
node -e 'const o=require("./public/data/presets.json").presets[0].outbreaks[0].truth; for(let r=0;r<10;r++) console.log(o.slice(r*10,r*10+10).map(x=>x?"#":".").join(""))'
```
Expected: a single contiguous `#` blob (e.g. bottom-right region), not scattered noise.

- [ ] **Step 5: Verify the TS loader accepts the file**

Run: `node --disable-warning=ExperimentalWarning -e 'import("./src/core/presets.ts").then(m=>{const f=m.parsePresetFile(require("./public/data/presets.json"));console.log(f.presets.map(p=>p.id+":"+p.outbreaks.length))})'`
Expected: `[ 'grid10:30' ]`

- [ ] **Step 6: Commit**

```bash
git add offline/pyproject.toml offline/uv.lock offline/build_presets.py public/data/presets.json
git commit -m "feat(data): 10x10 grid preset with simulated outbreaks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Speed benchmark

The benchmark the user asked for: per-operation timings on the grid and on the paper's 160-node high-modularity SBM.

**Files:**
- Create: `scripts/io.ts`
- Create: `scripts/bench.ts`
- Create (generated): `docs/benchmark.md`

- [ ] **Step 1: Write `scripts/io.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePresetFile, type PresetFile } from '../src/core/presets.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRESETS_PATH = resolve(ROOT, 'public/data/presets.json');
export const BOTS_PATH = resolve(ROOT, 'public/data/bots.json');

export function loadPresets(path = PRESETS_PATH): PresetFile {
  return parsePresetFile(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}
```

- [ ] **Step 2: Write `scripts/bench.ts`**

```ts
// Speed benchmark for the in-browser surrogate. Usage: npm run bench [-- path/to/graph.adjlist]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeGraph, type Graph } from '../src/core/graph.ts';
import { carCovariance, DEFAULT_PRIOR } from '../src/core/prior.ts';
import { fitLaplace, type Observation } from '../src/core/surrogate.ts';
import { baldScores, leScores, neScores } from '../src/core/policies.ts';
import { runPolicy } from '../src/core/replay.ts';
import { makeRng } from '../src/core/rng.ts';
import { loadPresets, ROOT } from './io.ts';

const PAPER_SBM = resolve(ROOT, '../optimal-disease-surveillance-AL/materials/synthetic-graphs/SB-high_modularity/SB-high_modularity-seed865503.relabelled.adjlist');

function parseAdjlist(text: string): Graph {
  const edges: [number, number][] = [];
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [u, ...vs] = line.trim().split(/\s+/).map(Number);
    n = Math.max(n, u + 1, ...vs.map((v) => v + 1));
    for (const v of vs) edges.push([u, v]);
  }
  return makeGraph(n, edges);
}

function time(fn: () => void, reps: number): number {
  fn(); // warm-up
  const t = performance.now();
  for (let r = 0; r < reps; r++) fn();
  return (performance.now() - t) / reps;
}

function bench(label: string, g: Graph) {
  const rng = makeRng(0);
  let K: Float64Array = new Float64Array(0);
  const kMs = time(() => { K = carCovariance(g, DEFAULT_PRIOR); }, 5);
  console.log(`\n### ${label} (n = ${g.n}, edges = ${g.edges.length})\n`);
  console.log('| operation | ms |\n|---|---|');
  console.log(`| build prior covariance (once per graph) | ${kMs.toFixed(2)} |`);
  for (const m of [1, 10, 20, 30]) {
    const nodes = Array.from({ length: g.n }, (_, i) => i).sort(() => rng() - 0.5).slice(0, m);
    const obs: Observation[] = nodes.map((node) => ({ node, y: rng() < 0.4 ? 1 : 0 }));
    console.log(`| fit, ${m} observations | ${time(() => fitLaplace(K, g.n, obs), 200).toFixed(3)} |`);
  }
  const post = fitLaplace(K, g.n, [{ node: 0, y: 1 }]);
  console.log(`| NE scores | ${time(() => neScores(post), 200).toFixed(3)} |`);
  console.log(`| BALD scores | ${time(() => baldScores(post), 200).toFixed(3)} |`);
  console.log(`| LE scores | ${time(() => leScores(g, post), 200).toFixed(3)} |`);
  const truth = Array.from({ length: g.n }, (_, i) => (i % 3 === 0 ? 1 : 0) as 0 | 1);
  const budget = Math.round(0.3 * g.n);
  const sc = { graph: g, K, truth, seedNode: 0 };
  console.log(`| full LE run, budget ${budget} | ${time(() => runPolicy(sc, 'LE', budget, makeRng(1)), 3).toFixed(1)} |`);
}

const grid = loadPresets().presets.find((p) => p.id === 'grid10');
if (grid) bench('grid10', makeGraph(grid.n, grid.edges));
const extra = process.argv[2] ?? (existsSync(PAPER_SBM) ? PAPER_SBM : undefined);
if (extra) bench(`adjlist: ${extra.split('/').pop()}`, parseAdjlist(readFileSync(extra, 'utf8')));
```

- [ ] **Step 3: Run it and save the report**

Run: `npm run -s bench > docs/benchmark.md && cat docs/benchmark.md`
Expected (timings vary by machine; prototype on this Mac):
```
### grid10 (n = 100, edges = 180)
| build prior covariance (once per graph) | ~1.5 |
| fit, 20 observations | ~0.11 |
| LE scores | ~0.03 |
| full LE run, budget 30 | ~3.6 |
### adjlist: SB-high_modularity-seed865503.relabelled.adjlist (n = 160, edges = 405)
| fit, 30 observations | ~0.2 |
```
Acceptance: every per-click operation (fit + any policy scores) < 5 ms on both graphs.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add scripts/io.ts scripts/bench.ts docs/benchmark.md
git commit -m "feat(scripts): surrogate speed benchmark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Prior calibration

Grid-search (α, τ, b0Var) on the `calib` outbreaks, maximising mean learning-curve accuracy of LE + Random at the default budget; writes the winner into `presets.json`. Must be re-run whenever `build_presets.py` is re-run (it resets the prior to the default) — `npm run data` does all three steps in order.

**Files:**
- Create: `scripts/calibrate-prior.ts`
- Modify (generated): `public/data/presets.json`

- [ ] **Step 1: Write `scripts/calibrate-prior.ts`**

```ts
// Grid-search the CAR prior (alpha, tau, b0Var) per preset on its 'calib' outbreaks, maximising the mean
// learning-curve accuracy of LE and Random. Usage: npm run data:calibrate  (add --write to update presets.json)
import { makeGraph } from '../src/core/graph.ts';
import { carCovariance, type PriorParams } from '../src/core/prior.ts';
import { runPolicy } from '../src/core/replay.ts';
import { lcArea } from '../src/core/metrics.ts';
import { makeRng } from '../src/core/rng.ts';
import { loadPresets, PRESETS_PATH, writeJson } from './io.ts';

const ALPHAS = [0.5, 0.8, 0.9, 0.95, 0.99];
const TAUS = [0.01, 0.03, 0.1, 0.3, 1];
const B0_VARS = [0.01, 0.1, 1];
const RANDOM_RUNS = 3;

const write = process.argv.includes('--write');
const file = loadPresets();

for (const preset of file.presets) {
  const graph = makeGraph(preset.n, preset.edges);
  const calib = preset.outbreaks.filter((o) => o.split === 'calib');
  if (calib.length === 0) throw new Error(`${preset.id}: no calib outbreaks`);
  const results: { prior: PriorParams; score: number }[] = [];
  for (const alpha of ALPHAS) for (const tau of TAUS) for (const b0Var of B0_VARS) {
    const prior = { alpha, tau, b0Var };
    const K = carCovariance(graph, prior);
    let total = 0;
    let count = 0;
    for (const ob of calib) {
      const sc = { graph, K, truth: ob.truth, seedNode: ob.seedNode };
      total += lcArea(runPolicy(sc, 'LE', preset.defaultBudget, makeRng(0)).accuracy);
      count++;
      for (let r = 0; r < RANDOM_RUNS; r++) {
        total += lcArea(runPolicy(sc, 'RAND', preset.defaultBudget, makeRng(r)).accuracy);
        count++;
      }
    }
    results.push({ prior, score: total / count });
  }
  results.sort((a, b) => b.score - a.score);
  console.log(`\n${preset.id} — top 5 of ${results.length} (mean learning-curve accuracy on ${calib.length} calib outbreaks)`);
  for (const r of results.slice(0, 5)) console.log(`  alpha=${r.prior.alpha} tau=${r.prior.tau} b0Var=${r.prior.b0Var}  ${r.score.toFixed(4)}`);
  const best = results[0].prior;
  const edges: [string, number, number[]][] = [['alpha', best.alpha, ALPHAS], ['tau', best.tau, TAUS], ['b0Var', best.b0Var, B0_VARS]];
  for (const [name, value, grid] of edges)
    if (value === grid[0] || value === grid[grid.length - 1]) console.warn(`  ⚠ best ${name}=${value} is on the grid boundary; consider extending the grid`);
  preset.prior = best;
}

if (write) {
  writeJson(PRESETS_PATH, file);
  console.log(`\nWrote calibrated priors to ${PRESETS_PATH}`);
}
```

- [ ] **Step 2: Run and write**

Run: `npm run data:calibrate`
Expected (≈10 s):
```
grid10 — top 5 of 75 (mean learning-curve accuracy on 20 calib outbreaks)
  alpha=0.9 tau=0.03 b0Var=0.1  0.7871
  ...
Wrote calibrated priors to .../public/data/presets.json
```
No `⚠ ... grid boundary` warning should appear. If one does, extend that parameter's grid and rerun.

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit
git add scripts/calibrate-prior.ts public/data/presets.json
git commit -m "feat(data): calibrate CAR prior on held-out outbreaks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Precompute bots

Runs every policy on every `game` outbreak up to `maxBudget` (any presenter budget ≤ maxBudget is a prefix of these runs, since all policies are myopic). LE/NE/BALD/DC: 1 seeded run; RI/RAND: 200 runs → mean and 5–95% band.

**Files:**
- Create: `scripts/build-bots.ts`
- Create (generated): `public/data/bots.json`

- [ ] **Step 1: Write `scripts/build-bots.ts`**

```ts
// Precompute bot trajectories for every preset × game outbreak. Usage: npm run data:bots
import { presetModel, scenarioFor } from '../src/core/presets.ts';
import { runPolicy, type Trajectory } from '../src/core/replay.ts';
import { makeRng } from '../src/core/rng.ts';
import { summarise, type BotResult, type BotsFile } from '../src/core/bots.ts';
import type { PolicyName } from '../src/core/policies.ts';
import { BOTS_PATH, loadPresets, writeJson } from './io.ts';

/** Deterministic policies run once (seeded tie-breaking); stochastic ones are averaged. */
const RUNS: Record<PolicyName, number> = { LE: 1, NE: 1, BALD: 1, DC: 1, RI: 200, RAND: 200 };

const out: BotsFile = { version: 1, presets: {} };
for (const preset of loadPresets().presets) {
  const model = presetModel(preset);
  out.presets[preset.id] = {};
  const finals: Record<string, number[]> = {};
  for (const ob of preset.outbreaks.filter((o) => o.split === 'game')) {
    const sc = scenarioFor(model, ob);
    const results: BotResult[] = [];
    for (const [policy, runs] of Object.entries(RUNS) as [PolicyName, number][]) {
      const trajectories: Trajectory[] = [];
      for (let r = 0; r < runs; r++) trajectories.push(runPolicy(sc, policy, preset.maxBudget, makeRng(r)));
      const res = summarise(policy, trajectories);
      results.push(res);
      (finals[policy] ??= []).push(res.accuracy.mean[preset.defaultBudget] as number);
    }
    out.presets[preset.id][ob.id] = results;
  }
  console.log(`\n${preset.id}: mean accuracy after ${preset.defaultBudget} tests (game outbreaks)`);
  for (const [policy, vals] of Object.entries(finals))
    console.log(`  ${policy.padEnd(5)} ${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)}`);
}
writeJson(BOTS_PATH, out);
console.log(`\nWrote ${BOTS_PATH}`);
```

- [ ] **Step 2: Run it**

Run: `npm run data:bots`
Expected (≈15 s; ~210 KB file):
```
grid10: mean accuracy after 20 tests (game outbreaks)
  LE    0.896
  NE    0.924
  BALD  0.853
  DC    0.856
  RI    0.632
  RAND  0.867
```
Sanity: LE should beat RAND at every budget, and LE should beat NE at small budgets (≈0.85 vs 0.79 after 5 tests) — this reproduces the paper's "LE wins at small budgets" result. Check with:
```bash
node -e 'const b=require("./public/data/bots.json").presets.grid10;const P=["LE","NE","RAND"];for(const t of [3,5,10,20]) console.log(t,P.map(p=>{const v=Object.values(b).map(r=>r.find(x=>x.policy===p).accuracy.mean[t]);return p+"="+(v.reduce((a,c)=>a+c,0)/v.length).toFixed(3)}).join(" "))'
```

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit
git add scripts/build-bots.ts public/data/bots.json
git commit -m "feat(data): precompute bot trajectories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Validate the surrogate against NumPyro MCMC

Exports snapshots (LE runs on 3 game outbreaks at t = 0, B/2, B) with the browser model's predictions, then fits the same observations with NumPyro under (a) the same fixed priors — tests the Laplace approximation — and (b) the paper's priors — shows the effect of calibration. Produces a table and scatter plot for the talk.

**Files:**
- Create: `scripts/export-scenarios.ts`
- Create: `offline/validate_surrogate.py`
- Create (generated): `docs/validation/validation.md`, `docs/validation/validation.png`

- [ ] **Step 1: Write `scripts/export-scenarios.ts`**

```ts
// Export observation snapshots (from LE runs) plus the browser surrogate's predictions, for MCMC validation.
// Writes offline/out/scenarios.json; consumed by offline/validate_surrogate.py.
import { resolve } from 'node:path';
import { presetModel, scenarioFor } from '../src/core/presets.ts';
import { runPolicy } from '../src/core/replay.ts';
import { fitLaplace, type Observation } from '../src/core/surrogate.ts';
import { makeRng } from '../src/core/rng.ts';
import { loadPresets, ROOT, writeJson } from './io.ts';

const OUTBREAKS_PER_PRESET = 3;
const scenarios = [];
for (const preset of loadPresets().presets) {
  const model = presetModel(preset);
  const steps = [0, Math.round(preset.defaultBudget / 2), preset.defaultBudget];
  for (const ob of preset.outbreaks.filter((o) => o.split === 'game').slice(0, OUTBREAKS_PER_PRESET)) {
    const tr = runPolicy(scenarioFor(model, ob), 'LE', preset.defaultBudget, makeRng(0));
    for (const t of steps) {
      const obs: Observation[] = [ob.seedNode, ...tr.picks.slice(0, t)].map((node) => ({ node, y: ob.truth[node] }));
      const start = performance.now();
      const post = fitLaplace(model.K, preset.n, obs);
      scenarios.push({
        id: `${preset.id}/${ob.id}/t${t}`,
        n: preset.n,
        edges: preset.edges,
        prior: preset.prior,
        obs,
        p: Array.from(post.p),
        laplaceMs: performance.now() - start,
      });
    }
  }
}
const path = resolve(ROOT, 'offline/out/scenarios.json');
writeJson(path, scenarios);
console.log(`Wrote ${scenarios.length} scenarios to ${path}`);
```

- [ ] **Step 2: Write `offline/validate_surrogate.py`**

```python
"""Compare the browser Laplace surrogate against NumPyro MCMC on exported scenarios.

Two MCMC references per scenario:
  fixed — same model and the same fixed (alpha, tau, b0Var) as the browser: tests the Laplace approximation.
  paper — the paper's priors (alpha ~ U(0,1), tau ~ LogNormal(0, 0.1), b0 ~ N(0, 1)): tests the model choice.

Reads offline/out/scenarios.json (npm run validate), writes docs/validation/validation.md and validation.png.
"""
import json
import time
from pathlib import Path

import jax.numpy as jnp
import matplotlib
import numpy as np
import numpyro
import numpyro.distributions as dist
from jax.random import PRNGKey

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
REPORT = Path(__file__).resolve().parents[1] / "docs" / "validation"
NUM_WARMUP, NUM_SAMPLES = 500, 1000


def car_model(adj, obs_nodes, y, prior, mode):
    n = adj.shape[0]
    if mode == "fixed":
        b0 = numpyro.sample("b0", dist.Normal(0, np.sqrt(prior["b0Var"])).expand([n]))
        alpha, tau = prior["alpha"], prior["tau"]
    else:
        b0 = numpyro.sample("b0", dist.Normal(0, 1).expand([n]))
        alpha = numpyro.sample("alpha", dist.Uniform(0, 1))
        tau = numpyro.sample("tau", dist.LogNormal(0, 0.1))
    car = numpyro.sample("car", dist.CAR(loc=jnp.zeros(n), correlation=alpha, conditional_precision=tau, adj_matrix=adj, is_sparse=False))
    f = b0 + car
    numpyro.deterministic("p", 1 / (1 + jnp.exp(-f)))
    numpyro.sample("obs", dist.Bernoulli(logits=f[obs_nodes]), obs=y)


def entropy(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -p * np.log(p) - (1 - p) * np.log(1 - p)


def le_scores(dist_matrix, p):
    """Local Entropy as in local_entropy.py (all other reachable nodes, weight 1/d)."""
    h = entropy(p)
    with np.errstate(divide="ignore"):
        w = np.where(dist_matrix > 0, 1.0 / dist_matrix, 0.0)
    return (w @ h) / w.sum(axis=1)


def hop_distances(adj):
    n = adj.shape[0]
    d = np.full((n, n), -1)
    for s in range(n):
        d[s, s] = 0
        frontier = [s]
        while frontier:
            nxt = []
            for u in frontier:
                for v in np.nonzero(adj[u])[0]:
                    if d[s, v] < 0:
                        d[s, v] = d[s, u] + 1
                        nxt.append(v)
            frontier = nxt
    return d


def top_in_top5(lap_scores, mc_scores, unobs):
    """Is the Laplace top pick among the MCMC top-5 picks? (Top-1 equality is too brittle: many nodes tie.)"""
    lap_best = unobs[np.argmax(lap_scores[unobs])]
    return lap_best in set(unobs[np.argsort(-mc_scores[unobs])[:5]])


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def main():
    scenarios = json.loads((OUT / "scenarios.json").read_text())
    rows, scatter = [], {"fixed": ([], []), "paper": ([], [])}
    dist_cache = {}
    for i, sc in enumerate(scenarios):
        n = sc["n"]
        adj = np.zeros((n, n))
        for a, b in sc["edges"]:
            adj[a, b] = adj[b, a] = 1
        key = (n, len(sc["edges"]), sc["id"].split("/")[0])
        if key not in dist_cache:
            dist_cache[key] = hop_distances(adj)
        dmat = dist_cache[key]
        observed = {o["node"] for o in sc["obs"]}
        unobs = np.array([j for j in range(n) if j not in observed])
        obs_nodes = jnp.array([o["node"] for o in sc["obs"]])
        y = jnp.array([o["y"] for o in sc["obs"]])
        p_lap = np.array(sc["p"])
        row = {"id": sc["id"], "m": len(sc["obs"]), "laplace_ms": sc["laplaceMs"]}
        for mode in ("fixed", "paper"):
            t0 = time.time()
            mcmc = numpyro.infer.MCMC(numpyro.infer.NUTS(car_model), num_warmup=NUM_WARMUP, num_samples=NUM_SAMPLES, progress_bar=False)
            mcmc.run(PRNGKey(i), jnp.array(adj), obs_nodes, y, sc["prior"], mode)
            p_mc = np.asarray(mcmc.get_samples()["p"].mean(0))
            row[f"{mode}_s"] = time.time() - t0
            row[f"{mode}_mae"] = float(np.abs(p_mc[unobs] - p_lap[unobs]).mean())
            row[f"{mode}_r"] = float(np.corrcoef(p_mc[unobs], p_lap[unobs])[0, 1]) if p_lap[unobs].std() > 1e-9 else float("nan")
            le_lap, le_mc = le_scores(dmat, p_lap), le_scores(dmat, p_mc)
            row[f"{mode}_ne"] = top_in_top5(entropy(p_lap), entropy(p_mc), unobs)
            row[f"{mode}_le"] = top_in_top5(le_lap, le_mc, unobs)
            row[f"{mode}_le_rho"] = spearman(le_lap[unobs], le_mc[unobs])
            scatter[mode][0].extend(p_lap[unobs])
            scatter[mode][1].extend(p_mc[unobs])
        rows.append(row)
        print(f"[{i + 1}/{len(scenarios)}] {sc['id']}: fixed MAE={row['fixed_mae']:.3f} r={row['fixed_r']:.3f} | paper MAE={row['paper_mae']:.3f} r={row['paper_r']:.3f}")

    lines = [
        "# Surrogate validation: browser Laplace vs NumPyro MCMC",
        "",
        f"MCMC: NUTS, {NUM_WARMUP} warmup + {NUM_SAMPLES} samples, 1 chain. Metrics on unobserved nodes.",
        "NE/LE top-5 = the Laplace model's next pick is among the MCMC model's 5 best candidates. LE ρ = Spearman rank correlation of LE scores.",
        "",
        "| scenario | obs | Laplace ms | fixed MCMC s | fixed MAE | fixed r | NE top-5 | LE top-5 | LE ρ | paper MAE | paper r | NE top-5 | LE top-5 | LE ρ |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    yes = lambda b: "✓" if b else "✗"
    for r in rows:
        lines.append(
            f"| {r['id']} | {r['m']} | {r['laplace_ms']:.2f} | {r['fixed_s']:.1f} | {r['fixed_mae']:.3f} | {r['fixed_r']:.3f} | {yes(r['fixed_ne'])} | {yes(r['fixed_le'])} | {r['fixed_le_rho']:.2f} "
            f"| {r['paper_mae']:.3f} | {r['paper_r']:.3f} | {yes(r['paper_ne'])} | {yes(r['paper_le'])} | {r['paper_le_rho']:.2f} |"
        )
    mean = lambda k: np.nanmean([r[k] for r in rows])
    lines += [
        "",
        f"**Mean (fixed):** MAE {mean('fixed_mae'):.3f}, r {mean('fixed_r'):.3f}, NE top-5 {mean('fixed_ne'):.0%}, LE top-5 {mean('fixed_le'):.0%}, LE ρ {mean('fixed_le_rho'):.2f}",
        f"**Mean (paper):** MAE {mean('paper_mae'):.3f}, r {mean('paper_r'):.3f}, NE top-5 {mean('paper_ne'):.0%}, LE top-5 {mean('paper_le'):.0%}, LE ρ {mean('paper_le_rho'):.2f}",
        f"**Speed:** Laplace {mean('laplace_ms'):.2f} ms vs MCMC {mean('fixed_s'):.1f} s per update",
    ]
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / "validation.md").write_text("\n".join(lines) + "\n")

    fig, axes = plt.subplots(1, 2, figsize=(9, 4.5), sharey=True)
    for ax, mode in zip(axes, ("fixed", "paper")):
        ax.scatter(*scatter[mode], s=4, alpha=0.3)
        ax.plot([0, 1], [0, 1], "k--", lw=1)
        ax.set(title=f"MCMC ({mode} priors)", xlabel="Laplace P(infected)", xlim=(0, 1), ylim=(0, 1))
    axes[0].set_ylabel("MCMC P(infected)")
    fig.tight_layout()
    fig.savefig(REPORT / "validation.png", dpi=150)
    print("\n".join(lines[-3:]))
    print(f"Wrote {REPORT / 'validation.md'} and {REPORT / 'validation.png'}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the validation**

Run: `npm run validate` (≈40 s)
Expected final lines:
```
**Mean (fixed):** MAE 0.030, r 0.968, NE top-5 78%, LE top-5 89%, LE ρ 0.95
**Mean (paper):** MAE 0.058, r 0.589, NE top-5 22%, LE top-5 78%, LE ρ 0.85
**Speed:** Laplace 0.08 ms vs MCMC 1.2 s per update
```
Acceptance (fixed priors): mean MAE ≤ 0.08 and mean LE ρ ≥ 0.8. If not met, stop and report — do not tune silently.

- [ ] **Step 4: Inspect the plot**

Open `docs/validation/validation.png`. Left panel (fixed priors) should hug the diagonal (Laplace slightly compressed toward 0.5, but monotone). Right panel (paper priors) is flatter around 0.5: the paper's τ ~ LogNormal(0, 0.1) implies much weaker spatial correlation than the calibrated prior.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add scripts/export-scenarios.ts offline/validate_surrogate.py docs/validation/
git commit -m "feat(validation): compare Laplace surrogate with NumPyro MCMC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Surveillance Game

Interactive workshop game (ICID 2026) based on Tsui et al. (2024), *Toward optimal disease surveillance with graph-based active learning*, PNAS.

Design: `docs/superpowers/specs/2026-11-01-surveillance-game-design.md`

## Engine (`src/core/`)

Pure TypeScript, runs in the browser and in Node:

- `surrogate.ts`: Laplace-approximated latent Gaussian model with the paper's CAR prior (`prior.ts`). About 0.1 ms per update (see `docs/benchmark.md`).
- `policies.ts`: LE, NE, BALD, degree centrality, reactive-infected, random.
- `metrics.ts` / `replay.ts`: accuracy, AUC, learning-curve area; replaying a pick sequence.

Validation against NumPyro MCMC: `docs/validation/validation.md`.

## Commands

| Command | What it does |
|---|---|
| `npm test` / `npm run typecheck` | Unit tests / type check |
| `npm run bench` | Speed benchmark |
| `npm run data` | Rebuild presets → calibrate prior → rebuild bots (run all three after changing presets) |
| `npm run validate` | Laplace vs MCMC report → `docs/validation/` |

Python steps use `uv` (`offline/pyproject.toml`) and expect the paper repo at `../optimal-disease-surveillance-AL` (override with `SURVEILLANCE_REPO`).
````

- [ ] **Step 2: Final check and commit**

```bash
npm test && npm run typecheck
git add README.md
git commit -m "docs: engine README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Notes for Plans 2–3 (from prototyping)

- Predicted probabilities on the grid span only about 0.33–0.67 after 20 tests (binary tests are weakly informative). The prediction shading must use a stretched colour scale (e.g. map [0.3, 0.7] to the full red–blue range), or players won't see differences.
- BALD prefers corners and edges: the CAR prior gives low-degree nodes higher prior variance. This is worth explaining in the talk.
- LE beats NE at small budgets, and NE overtakes from about 10 tests on. Consider a default budget of 10 instead of 20 (spec §4) to keep the game in the regime where LE shines. This is the presenter's choice per round.

