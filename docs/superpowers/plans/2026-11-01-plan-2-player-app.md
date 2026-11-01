# Surveillance Game — Plan 2: Player App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-player web app (no backend) where a player picks locations to test on the 10×10 grid, toggles the model's predictions and uncertainty, and gets a results screen comparing their AUC curve with the precomputed LE/NE/Random bots.

**Architecture:** Vite + React 19 + TypeScript in the existing repo (`src/app/`), on top of the Plan 1 engine (`src/core/`). Game state is a small, serialisable `Session` (pure functions in `session.ts`); the posterior is recomputed from it on every pick (~0.1 ms). Rendering is hand-written SVG. Static data comes from `public/data/*.json`.

**Tech Stack:** React 19, Vite 8, Vitest 5 (+ jsdom, @testing-library/react), TypeScript 7.

**Spec:** `docs/superpowers/specs/2026-11-01-player-app-design.md` (refines the parent spec `2026-11-01-surveillance-game-design.md`).

**Pre-verified:** Everything below was built and run in a prototype before writing:
- 81 tests pass and the typecheck is clean;
- `npm run build` succeeds;
- a full game was played in Chrome against the production build, and the start, play and results screens were checked visually against the mockups.

Expected outputs come from that run.

---

## Conventions

- **Working directory:** `/Users/user/Documents/conferences-workshops/ICID2026/workshop/surveillance-game` (the app root). Work on a feature branch: `git checkout -b feat/player-app`.
- **TS imports:** use explicit `.ts`/`.tsx` extensions, and `import type` for type-only imports.
- **Component tests:** start with `// @vitest-environment jsdom` and call RTL `cleanup` in `afterEach`. Other tests run in Node.
- **Commits:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## File Structure

```
surveillance-game/
├── .npmrc, index.html, vite.config.ts      (new)  tooling
├── package.json, tsconfig.json              (mod)  deps/scripts, JSX
├── offline/build_presets.py                 (mod)  default budget 10% of nodes
├── public/data/{presets,bots}.json          (regen)
├── docs/validation/*                        (regen)
├── src/core/entropy.ts (+test)              (mod)  probabilityStd
└── src/app/
    ├── main.tsx, App.tsx (+App.test.tsx)    entry; screen routing; data loading; persistence
    ├── session.ts (+test)                   pure game state machine + scoring
    ├── scales.ts (+test)                    colours, prediction scale, relative ring scale
    ├── labels.ts (+test)                    end-of-line label nudging for the chart
    ├── data.ts (+test)                      fetch JSON; bot lookup; outbreak choice
    ├── storage.ts                           localStorage (nickname, session, last outbreak)
    ├── vite-env.d.ts                        Vite client types
    ├── styles.css                           layout + explicit text colours
    ├── components/
    │   ├── GraphView.tsx (+test)            SVG graph: predictions, rings, hover hops, ✕
    │   ├── SidePanel.tsx                    toggles, hover box, explainer
    │   ├── Explainer.tsx                    "What do the colours mean?" + two densities
    │   └── AucChart.tsx                     AUC-vs-tests chart, legend, labels, crosshair
    └── screens/
        ├── StartScreen.tsx                  nickname + preset + rules
        ├── PlayScreen.tsx                   header, graph, side panel
        └── ResultsScreen.tsx                truth map, scores, chart, verdict
```

---

### Task 1: Tooling — React, Vite 8, Vitest 5

Vitest 3 cannot coexist with Vite 8 (needed by `@vitejs/plugin-react` 6). Upgrading to Vitest 5 also clears the `npm audit` findings on Vitest 3. npm 10 crashes resolving Vitest 5's optional peers (`Cannot read properties of null (reading 'edgesOut')`), so `.npmrc` sets `legacy-peer-deps`; the peers we need (vite, jsdom) are listed explicitly.

**Files:**
- Create: `.npmrc`, `vite.config.ts`, `index.html`
- Modify: `package.json`, `tsconfig.json`, `package-lock.json` (regenerated)

- [ ] **Step 1: Create the branch**

Run: `git checkout -b feat/player-app`

- [ ] **Step 2: Write `.npmrc`**

```ini
# npm 10 crashes resolving vitest 5 optional peers (arborist "edgesOut" bug); peers we need are listed explicitly.
legacy-peer-deps=true
```

- [ ] **Step 3: Replace `package.json` with**

```json
{
  "name": "surveillance-game",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
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
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^26.6.6",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "jsdom": "^27.0.1",
    "typescript": "^7.0.2",
    "vite": "^8.3.5",
    "vitest": "^5.0.5"
  },
  "dependencies": {
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  }
}
```

- [ ] **Step 4: Replace `tsconfig.json` with**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": [
      "ES2022",
      "DOM",
      "DOM.Iterable"
    ],
    "types": [
      "node"
    ],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "jsx": "react-jsx"
  },
  "include": [
    "src",
    "scripts",
    "vite.config.ts"
  ]
}
```

- [ ] **Step 5: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built app works from any static host path.
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Surveillance Game</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Reinstall from scratch**

Run: `rm -rf node_modules package-lock.json && npm install`
Expected: completes without errors, ends with `found 0 vulnerabilities`. `npx vitest --version` prints `vitest/5.x`.

- [ ] **Step 8: Verify the existing engine still passes**

Run: `npm test && npm run typecheck`
Expected: `Tests  52 passed (52)` and a silent typecheck. (`npm run build` would fail now because `src/app/main.tsx` doesn't exist yet. That's expected until Task 10.)

- [ ] **Step 9: Commit**

```bash
git add .npmrc package.json package-lock.json tsconfig.json vite.config.ts index.html
git commit -m "chore: add React + Vite 8, upgrade to Vitest 5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Engine — posterior SD of P(infected)

The "uncertainty" players see is the width of the posterior over P(infected) = σ(f), f ~ N(mean, var). (Not the entropy of the mean p, which would just repeat the colour shading.)

**Files:**
- Modify: `src/core/entropy.ts` (append function)
- Modify: `src/core/entropy.test.ts` (import + new describe block)

- [ ] **Step 1: Write the failing test**

In `src/core/entropy.test.ts`, change the import line to:

```ts
import { baldScore, binaryEntropy, probabilityStd } from './entropy.ts';
```

and append:

```ts
describe('probabilityStd', () => {
  it('is zero with no latent uncertainty', () => {
    expect(probabilityStd(0.3, 0)).toBeCloseTo(0, 12);
  });

  it('is symmetric in the latent mean', () => {
    expect(probabilityStd(1.2, 2)).toBeCloseTo(probabilityStd(-1.2, 2), 12);
  });

  it('agrees with a Monte Carlo estimate', () => {
    const rng = makeRng(321);
    const [mu, v, S] = [0.4, 3, 200_000];
    let m1 = 0;
    let m2 = 0;
    for (let s = 0; s < S; s++) {
      const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); // Box–Muller
      const p = 1 / (1 + Math.exp(-(mu + Math.sqrt(v) * z)));
      m1 += p / S;
      m2 += (p * p) / S;
    }
    expect(probabilityStd(mu, v)).toBeCloseTo(Math.sqrt(m2 - m1 * m1), 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/entropy.test.ts`
Expected: FAIL. The 3 `probabilityStd` tests fail (`probabilityStd is not a function`).

- [ ] **Step 3: Implement** — append to `src/core/entropy.ts`:

```ts
/**
 * Posterior standard deviation of P(infected) = σ(f) for f ~ N(mean, variance): the width of the
 * model's belief about P(infected). Shown to players as "uncertainty".
 */
export function probabilityStd(mean: number, variance: number): number {
  if (!(variance > 0)) return 0;
  const s = Math.sqrt(2 * variance);
  let m1 = 0;
  let m2 = 0;
  for (let k = 0; k < GH_X.length; k++) {
    const pk = 1 / (1 + Math.exp(-(mean + s * GH_X[k])));
    m1 += GH_W[k] * pk;
    m2 += GH_W[k] * pk * pk;
  }
  m1 /= SQRT_PI;
  m2 /= SQRT_PI;
  return Math.sqrt(Math.max(m2 - m1 * m1, 0));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/core/entropy.test.ts && npm run typecheck`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/entropy.ts src/core/entropy.test.ts
git commit -m "feat(core): posterior SD of P(infected)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Default budget of 10 tests; regenerate data

**Files:**
- Modify: `offline/build_presets.py` (one line)
- Regenerate: `public/data/presets.json`, `public/data/bots.json`, `docs/validation/validation.md`, `docs/validation/validation.png`

- [ ] **Step 1: Change the default budget**

In `offline/build_presets.py`, replace

```python
            "defaultBudget": round(0.2 * n),
```

with

```python
            "defaultBudget": round(0.1 * n),
```

- [ ] **Step 2: Rebuild presets, recalibrate, rebuild bots**

Run: `npm run data` (≈30 s)
Expected (last part):
```
grid10 — top 5 of 75 (mean learning-curve AUC on 20 calib outbreaks)
  alpha=0.95 tau=0.1 b0Var=1  0.8163
  ...
  ⚠ best b0Var=1 is on the grid boundary; consider extending the grid
grid10: mean AUC (accuracy) after 10 tests (game outbreaks)
  LE    0.952 (0.885)
  NE    0.945 (0.873)
  BALD  0.918 (0.820)
  DC    0.911 (0.814)
  RI    0.894 (0.552)
  RAND  0.907 (0.813)
```
You can ignore the b0Var boundary warning. The surface is flat in b0Var: the top 5 scores span less than 0.0005 across b0Var ∈ {0.01, 0.1, 1}. LE must be best at 10 tests.

- [ ] **Step 3: Rerun the surrogate validation**

Run: `npm run validate` (≈40 s)
Expected:
```
**Mean (fixed):** MAE 0.014, r 0.959, NE top-5 67%, LE top-5 78%, LE ρ 0.96
```
Acceptance: fixed MAE ≤ 0.08 and LE ρ ≥ 0.8.

- [ ] **Step 4: Run tests and commit**

```bash
npm test
```
```bash
git add offline/build_presets.py public/data/presets.json public/data/bots.json docs/validation/
git commit -m "feat(data): default budget of 10 tests; regenerate presets, bots, validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 4: Game session (pure state machine)

Plain-data `Session` (serialisable for localStorage now and for the server in Plan 3) plus pure transitions and scoring. Tests use the real `public/data/presets.json`.

**Files:**
- Create: `src/app/session.ts`
- Test: `src/app/session.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/session.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel } from '../core/presets.ts';
import { replay } from '../core/replay.ts';
import { scenarioFor } from '../core/presets.ts';
import {
  deserializeSession, isFinished, isTested, noteToggles, observations, pick, scoreSession,
  serializeSession, startSession, testsLeft,
} from './session.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const outbreak = preset.outbreaks.find((o) => o.split === 'game')!;
const freeNode = (exclude: number[]) => [...Array(preset.n).keys()].find((i) => !exclude.includes(i))!;

describe('session', () => {
  it('starts with the seed tested and the full budget', () => {
    const s = startSession(preset, outbreak, 3);
    expect(s.picks).toEqual([]);
    expect(testsLeft(s)).toBe(3);
    expect(isTested(s, outbreak.seedNode)).toBe(true);
    expect(isFinished(s)).toBe(false);
  });

  it('defaults to the preset budget and rejects invalid budgets', () => {
    expect(startSession(preset, outbreak).budget).toBe(preset.defaultBudget);
    expect(() => startSession(preset, outbreak, 0)).toThrow(/budget/);
    expect(() => startSession(preset, outbreak, preset.maxBudget + 1)).toThrow(/budget/);
  });

  it('records picks immutably and finishes when the budget is spent', () => {
    const s0 = startSession(preset, outbreak, 2);
    const a = freeNode([outbreak.seedNode]);
    const s1 = pick(s0, a, preset.n);
    expect(s0.picks).toEqual([]);
    expect(s1.picks).toEqual([a]);
    const s2 = pick(s1, freeNode([outbreak.seedNode, a]), preset.n);
    expect(isFinished(s2)).toBe(true);
    expect(() => pick(s2, freeNode([outbreak.seedNode, ...s2.picks]), preset.n)).toThrow(/no tests left/);
  });

  it('rejects tested and out-of-range picks', () => {
    const s = startSession(preset, outbreak, 3);
    expect(() => pick(s, outbreak.seedNode, preset.n)).toThrow(/already tested/);
    expect(() => pick(s, preset.n, preset.n)).toThrow(/out of range/);
    expect(() => pick(s, -1, preset.n)).toThrow(/out of range/);
  });

  it('notes toggle use without resetting it', () => {
    const s = startSession(preset, outbreak, 3);
    expect(noteToggles(s, false, false)).toBe(s);
    const t = noteToggles(noteToggles(s, true, false), false, false);
    expect(t.usedPredictions).toBe(true);
    expect(t.usedUncertainty).toBe(false);
  });

  it('builds observations from the true outbreak', () => {
    const s = pick(startSession(preset, outbreak, 3), freeNode([outbreak.seedNode]), preset.n);
    expect(observations(s, outbreak.truth)).toEqual([outbreak.seedNode, ...s.picks].map((node) => ({ node, y: outbreak.truth[node] })));
  });

  it('scores a finished session exactly like replay', () => {
    const model = presetModel(preset);
    let s = startSession(preset, outbreak, 3);
    for (let k = 0; k < 3; k++) s = pick(s, freeNode([outbreak.seedNode, ...s.picks]), preset.n);
    const score = scoreSession(model, outbreak, s);
    const tr = replay(scenarioFor(model, outbreak), s.picks);
    expect(score.trajectory.auc).toEqual(tr.auc);
    expect(score.auc).toBe(tr.auc[3]);
    expect(score.accuracy).toBe(tr.accuracy[3]);
    expect(score.aucArea).not.toBeNull();
  });

  it('round-trips through serialisation and rejects garbage', () => {
    const s = pick(startSession(preset, outbreak, 3), freeNode([outbreak.seedNode]), preset.n);
    expect(deserializeSession(serializeSession(s))).toEqual(s);
    expect(deserializeSession(null)).toBeNull();
    expect(deserializeSession('not json')).toBeNull();
    expect(deserializeSession(JSON.stringify({ ...s, picks: 'x' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/session.test.ts`
Expected: FAIL — cannot resolve the module(s) under test.

- [ ] **Step 3: Write `src/app/session.ts`**

```ts
import type { Outbreak, Preset, PresetModel } from '../core/presets.ts';
import { scenarioFor } from '../core/presets.ts';
import { lcArea } from '../core/metrics.ts';
import { replay, type Trajectory } from '../core/replay.ts';
import type { Observation } from '../core/surrogate.ts';

/** One player's game. Plain data only, so it serialises to localStorage (and, in Plan 3, to the server). */
export interface Session {
  presetId: string;
  outbreakId: string;
  budget: number;
  seedNode: number;
  picks: number[];
  usedPredictions: boolean;
  usedUncertainty: boolean;
}

export function startSession(preset: Preset, outbreak: Outbreak, budget = preset.defaultBudget): Session {
  if (!(Number.isInteger(budget) && budget >= 1 && budget <= preset.maxBudget))
    throw new Error(`startSession: budget must be an integer in 1..${preset.maxBudget}`);
  return {
    presetId: preset.id,
    outbreakId: outbreak.id,
    budget,
    seedNode: outbreak.seedNode,
    picks: [],
    usedPredictions: false,
    usedUncertainty: false,
  };
}

export const testsLeft = (s: Session): number => s.budget - s.picks.length;
export const isFinished = (s: Session): boolean => testsLeft(s) === 0;
export const isTested = (s: Session, node: number): boolean => node === s.seedNode || s.picks.includes(node);

export function pick(s: Session, node: number, n: number): Session {
  if (isFinished(s)) throw new Error('pick: no tests left');
  if (!(Number.isInteger(node) && node >= 0 && node < n)) throw new Error(`pick: node ${node} out of range`);
  if (isTested(s, node)) throw new Error(`pick: node ${node} already tested`);
  return { ...s, picks: [...s.picks, node] };
}

/** Record that a model overlay was switched on at least once (shown on the leaderboard in Plan 3). */
export function noteToggles(s: Session, predictions: boolean, uncertainty: boolean): Session {
  const usedPredictions = s.usedPredictions || predictions;
  const usedUncertainty = s.usedUncertainty || uncertainty;
  return usedPredictions === s.usedPredictions && usedUncertainty === s.usedUncertainty ? s : { ...s, usedPredictions, usedUncertainty };
}

export function observations(s: Session, truth: (0 | 1)[]): Observation[] {
  return [s.seedNode, ...s.picks].map((node) => ({ node, y: truth[node] }));
}

export interface SessionScore {
  trajectory: Trajectory;
  /** Final ROC-AUC on untested nodes (the paper's metric); null if undefined. */
  auc: number | null;
  /** Mean AUC over tests 1..budget; null if undefined at every step. */
  aucArea: number | null;
  accuracy: number;
}

export function scoreSession(model: PresetModel, outbreak: Outbreak, s: Session): SessionScore {
  const trajectory = replay(scenarioFor(model, outbreak), s.picks);
  return {
    trajectory,
    auc: trajectory.auc[trajectory.auc.length - 1],
    aucArea: s.picks.length > 0 ? lcArea(trajectory.auc) : null,
    accuracy: trajectory.accuracy[trajectory.accuracy.length - 1],
  };
}

export function serializeSession(s: Session): string {
  return JSON.stringify(s);
}

/** Parse a stored session; returns null for anything malformed. */
export function deserializeSession(text: string | null): Session | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Session;
    const ok =
      typeof s.presetId === 'string' &&
      typeof s.outbreakId === 'string' &&
      Number.isInteger(s.budget) &&
      Number.isInteger(s.seedNode) &&
      Array.isArray(s.picks) &&
      s.picks.every(Number.isInteger) &&
      s.picks.length <= s.budget &&
      typeof s.usedPredictions === 'boolean' &&
      typeof s.usedUncertainty === 'boolean';
    return ok ? s : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/app/session.test.ts && npm run typecheck`
Expected: PASS (8 tests), silent typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/app/session.ts src/app/session.test.ts
git commit -m "feat(app): game session state machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 5: Visual scales

Colours, the stretched diverging prediction scale (0.5 ± 0.15), and the relative (min–max) uncertainty ring scale.

**Files:**
- Create: `src/app/scales.ts`
- Test: `src/app/scales.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/scales.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { predictionColor, relativeScale, ringStyle } from './scales.ts';

describe('predictionColor', () => {
  it('is white at 0.5 and saturates at the stretch limits', () => {
    expect(predictionColor(0.5)).toBe('rgb(255,255,255)');
    expect(predictionColor(0.65)).toBe('rgb(229,115,115)');
    expect(predictionColor(0.99)).toBe('rgb(229,115,115)');
    expect(predictionColor(0.35)).toBe('rgb(100,160,225)');
    expect(predictionColor(0.0)).toBe('rgb(100,160,225)');
  });
});

describe('relativeScale', () => {
  it('min–max scales the chosen nodes only', () => {
    const r = relativeScale([0.2, 0.4, 0.3, 9], [0, 1, 2]);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(1);
    expect(r[2]).toBeCloseTo(0.5, 12);
    expect(r[3]).toBe(0); // not in `nodes`
  });

  it('returns zeros (not NaN) when values are all equal or no nodes are given', () => {
    expect(Array.from(relativeScale([0.3, 0.3], [0, 1]))).toEqual([0, 0]);
    expect(Array.from(relativeScale([0.3, 0.4], []))).toEqual([0, 0]);
  });
});

describe('ringStyle', () => {
  it('grows from thin and faint to thick and strong', () => {
    expect(ringStyle(0)).toEqual({ width: 0.5, opacity: 0.25 });
    expect(ringStyle(1).width).toBeCloseTo(5.5);
    expect(ringStyle(1).opacity).toBeCloseTo(0.95);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/scales.test.ts`
Expected: FAIL — cannot resolve the module(s) under test.

- [ ] **Step 3: Write `src/app/scales.ts`**

```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/app/scales.test.ts && npm run typecheck`
Expected: PASS (4 tests), silent typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/app/scales.ts src/app/scales.test.ts
git commit -m "feat(app): colour and ring scales

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 6: Chart label nudging

Keeps end-of-line chart labels ≥ 14 px apart and inside the plot.

**Files:**
- Create: `src/app/labels.ts`
- Test: `src/app/labels.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/labels.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { nudgeLabels } from './labels.ts';

describe('nudgeLabels', () => {
  it('leaves well-separated labels alone', () => {
    expect(nudgeLabels([10, 50, 90], 14, 0, 200)).toEqual([10, 50, 90]);
  });

  it('pushes crowded labels apart, preserving order and input positions', () => {
    const out = nudgeLabels([100, 95, 102, 98], 14, 0, 200);
    const sorted = [...out].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(14 - 1e-9);
    expect(out[1]).toBeLessThan(out[3]); // 95 stays above 98
    expect(out[3]).toBeLessThan(out[0]); // 98 stays above 100
  });

  it('keeps labels inside the bounds', () => {
    const out = nudgeLabels([195, 196, 199], 14, 0, 200);
    expect(Math.max(...out)).toBeLessThanOrEqual(200);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/labels.test.ts`
Expected: FAIL — cannot resolve the module(s) under test.

- [ ] **Step 3: Write `src/app/labels.ts`**

```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/app/labels.test.ts && npm run typecheck`
Expected: PASS (3 tests), silent typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/app/labels.ts src/app/labels.test.ts
git commit -m "feat(app): chart label nudging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 7: Data loading, bot lookup, outbreak choice, storage

`storage.ts` and `vite-env.d.ts` have no tests of their own (thin wrappers, exercised by the App tests in Task 10).

**Files:**
- Create: `src/app/vite-env.d.ts`
- Create: `src/app/data.ts`
- Create: `src/app/storage.ts`
- Test: `src/app/data.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/data.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile } from '../core/presets.ts';
import type { BotsFile } from '../core/bots.ts';
import { makeRng } from '../core/rng.ts';
import { botResult, chooseOutbreak } from './data.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;

describe('chooseOutbreak', () => {
  it('only returns game outbreaks and never repeats the previous one', () => {
    const rng = makeRng(1);
    for (let k = 0; k < 50; k++) {
      const o = chooseOutbreak(preset, 'ob00', rng);
      expect(o.split).toBe('game');
      expect(o.id).not.toBe('ob00');
    }
  });
});

describe('botResult', () => {
  it('finds a bot curve covering the maximum budget', () => {
    const le = botResult(bots, preset.id, 'ob00', 'LE');
    expect(le.auc.mean).toHaveLength(preset.maxBudget + 1);
    expect(() => botResult(bots, preset.id, 'nope', 'LE')).toThrow(/No LE bot/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/data.test.ts`
Expected: FAIL — cannot resolve the module(s) under test.

- [ ] **Step 3: Write `src/app/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Write `src/app/data.ts`**

```ts
import type { BotResult, BotsFile } from '../core/bots.ts';
import type { PolicyName } from '../core/policies.ts';
import { parsePresetFile, type Outbreak, type Preset, type PresetFile } from '../core/presets.ts';

export interface GameData {
  presets: PresetFile;
  bots: BotsFile;
}

export async function loadGameData(base: string = import.meta.env.BASE_URL): Promise<GameData> {
  const get = async (name: string) => {
    const res = await fetch(`${base}data/${name}`);
    if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
    return res.json();
  };
  const [presets, bots] = await Promise.all([get('presets.json'), get('bots.json')]);
  if ((bots as BotsFile)?.version !== 1) throw new Error('bots.json: expected version 1');
  return { presets: parsePresetFile(presets), bots: bots as BotsFile };
}

export function botResult(bots: BotsFile, presetId: string, outbreakId: string, policy: PolicyName): BotResult {
  const r = bots.presets[presetId]?.[outbreakId]?.find((b) => b.policy === policy);
  if (!r) throw new Error(`No ${policy} bot for ${presetId}/${outbreakId}`);
  return r;
}

/** A random 'game' outbreak, avoiding `previousId` when there is a choice. */
export function chooseOutbreak(preset: Preset, previousId: string | null, rng: () => number = Math.random): Outbreak {
  const games = preset.outbreaks.filter((o) => o.split === 'game');
  if (games.length === 0) throw new Error(`${preset.id}: no game outbreaks`);
  const pool = games.length > 1 ? games.filter((o) => o.id !== previousId) : games;
  return pool[Math.floor(rng() * pool.length)];
}
```

- [ ] **Step 5: Write `src/app/storage.ts`**

```ts
import { deserializeSession, serializeSession, type Session } from './session.ts';

const KEYS = { nickname: 'sg.nickname', session: 'sg.session', lastOutbreak: 'sg.lastOutbreak' };

// localStorage can throw (private mode, quota); the game must keep working without it.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const loadNickname = (): string => read(KEYS.nickname) ?? '';
export const saveNickname = (name: string): void => write(KEYS.nickname, name);
export const loadSession = (): Session | null => deserializeSession(read(KEYS.session));
export const saveSession = (s: Session | null): void => write(KEYS.session, s === null ? null : serializeSession(s));
export const loadLastOutbreak = (): string | null => read(KEYS.lastOutbreak);
export const saveLastOutbreak = (id: string): void => write(KEYS.lastOutbreak, id);
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/app/data.test.ts && npm run typecheck`
Expected: PASS (2 tests), silent typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/app/vite-env.d.ts src/app/data.ts src/app/storage.ts src/app/data.test.ts
git commit -m "feat(app): data loading, outbreak choice, storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 8: Graph view

SVG graph used by both the play and results screens. It shows prediction shading (or neutral grey), uncertainty rings, tested +/− markers, hover-hop outlines with fading beyond 3 hops, and ✕ for wrong predictions in results mode.

**Files:**
- Create: `src/app/components/GraphView.tsx`
- Test: `src/app/components/GraphView.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/app/components/GraphView.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridEdges, makeGraph } from '../../core/graph.ts';
import { COLORS, predictionColor } from '../scales.ts';
import { GraphView } from './GraphView.tsx';

afterEach(cleanup);

const graph = makeGraph(9, gridEdges(3, 3));
const layout = Array.from({ length: 9 }, (_, i) => [(i % 3) / 2, Math.floor(i / 3) / 2] as [number, number]);
const base = { graph, layout, tested: new Map<number, 0 | 1>([[4, 1]]), predictions: null, uncertainty: null, hovered: null, onHover: () => {} };

describe('GraphView', () => {
  it('draws every node, colouring tested nodes by result and others neutral', () => {
    render(<GraphView {...base} />);
    expect(screen.getByTestId('node-4').getAttribute('data-fill')).toBe(COLORS.infected);
    expect(screen.getByTestId('node-0').getAttribute('data-fill')).toBe(COLORS.unknown);
    expect(screen.getAllByTestId(/^node-/)).toHaveLength(9);
  });

  it('shades untested nodes by prediction when predictions are on', () => {
    const p = [0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.4];
    render(<GraphView {...base} predictions={p} />);
    expect(screen.getByTestId('node-0').getAttribute('data-fill')).toBe(predictionColor(0.6));
    expect(screen.getByTestId('node-8').getAttribute('data-fill')).toBe(predictionColor(0.4));
  });

  it('calls onPick for untested nodes only', () => {
    const onPick = vi.fn();
    render(<GraphView {...base} onPick={onPick} />);
    fireEvent.click(screen.getByTestId('node-0'));
    fireEvent.click(screen.getByTestId('node-4'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it('reports hover and shows ✕ on wrongly predicted nodes in results mode', () => {
    const onHover = vi.fn();
    render(<GraphView {...base} onHover={onHover} truth={[0, 0, 0, 0, 1, 0, 0, 0, 1]} wrong={new Set([8])} />);
    fireEvent.mouseEnter(screen.getByTestId('node-2'));
    expect(onHover).toHaveBeenCalledWith(2);
    expect(screen.getByTestId('wrong-8')).toBeTruthy();
    expect(screen.getByTestId('node-8').getAttribute('data-fill')).toBe(COLORS.truthInfected);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/components/GraphView.test.tsx`
Expected: FAIL — cannot resolve the module(s) under test.

- [ ] **Step 3: Write `src/app/components/GraphView.tsx`**

```tsx
import type { Graph } from '../../core/graph.ts';
import { COLORS, predictionColor, ringStyle } from '../scales.ts';

const VIEW = 330;
const PAD = 25;
const R = 9;
const MAX_HOPS = 3;
/** Outline width by hop distance from the hovered node (0 = the hovered node itself). */
const HOP_OUTLINE = [3.5, 2.2, 1.6, 1.2];

export interface GraphViewProps {
  graph: Graph;
  /** Node positions in [0, 1]². */
  layout: [number, number][];
  /** Test result per tested node. */
  tested: Map<number, 0 | 1>;
  /** P(infected) per node, or null when predictions are hidden. */
  predictions: ArrayLike<number> | null;
  /** Relative uncertainty in [0, 1] per node, or null when hidden. */
  uncertainty: ArrayLike<number> | null;
  /** Results mode: true status (colours untested nodes) and nodes the model got wrong (marked ✕). */
  truth?: (0 | 1)[];
  wrong?: Set<number>;
  hovered: number | null;
  onHover: (node: number | null) => void;
  /** Called when an untested node is clicked; omit to make the graph read-only. */
  onPick?: (node: number) => void;
}

export function GraphView(props: GraphViewProps) {
  const { graph, layout, tested, predictions, uncertainty, truth, wrong, hovered, onHover, onPick } = props;
  const { n, dist } = graph;
  const xy = (i: number): [number, number] => [PAD + layout[i][0] * (VIEW - 2 * PAD), PAD + layout[i][1] * (VIEW - 2 * PAD)];
  const hops = (i: number) => (hovered === null ? -1 : dist[hovered * n + i]);
  const near = (i: number) => hovered === null || (hops(i) >= 0 && hops(i) <= MAX_HOPS);

  const fill = (i: number) => {
    const result = tested.get(i);
    if (result !== undefined) return result === 1 ? COLORS.infected : COLORS.clear;
    if (truth) return truth[i] === 1 ? COLORS.truthInfected : COLORS.truthClear;
    return predictions ? predictionColor(predictions[i]) : COLORS.unknown;
  };

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="graph" role="img" aria-label="Network of locations" onMouseLeave={() => onHover(null)}>
      {graph.edges.map(([a, b]) => {
        const [x1, y1] = xy(a);
        const [x2, y2] = xy(b);
        return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.edge} strokeWidth={1.5} opacity={near(a) || near(b) ? 1 : 0.25} />;
      })}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = xy(i);
        const result = tested.get(i);
        const isTested = result !== undefined;
        const h = hops(i);
        const outline = h >= 0 && h <= MAX_HOPS ? HOP_OUTLINE[h] : isTested ? 2.5 : 0.8;
        const ring = !isTested && uncertainty ? ringStyle(uncertainty[i]) : null;
        const clickable = !isTested && onPick !== undefined;
        return (
          <g key={i} opacity={near(i) ? 1 : 0.25}>
            {ring && <circle cx={x} cy={y} r={R + ring.width / 2 + 0.5} fill="none" stroke={COLORS.ring} strokeWidth={ring.width} opacity={ring.opacity} pointerEvents="none" />}
            <circle
              data-testid={`node-${i}`}
              data-fill={fill(i)}
              cx={x}
              cy={y}
              r={R}
              fill={fill(i)}
              stroke={isTested || h >= 0 ? '#000' : COLORS.outline}
              strokeWidth={outline}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
              onMouseEnter={() => onHover(i)}
              onClick={clickable ? () => onPick(i) : undefined}
            />
            {isTested && (
              <text x={x} y={y + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">
                {result === 1 ? '+' : '−'}
              </text>
            )}
            {!isTested && wrong?.has(i) && (
              <text data-testid={`wrong-${i}`} x={x} y={y + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill={COLORS.ink} pointerEvents="none">
                ✕
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/app/components/GraphView.test.tsx && npm run typecheck`
Expected: PASS (4 tests), silent typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/GraphView.tsx src/app/components/GraphView.test.tsx
git commit -m "feat(app): SVG graph view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 9: Side panel, explainer, AUC chart

These presentational components are covered by the App integration tests in Task 10. They are typechecked here.

**Chart colours:**
- LE `#008300` and NE `#6250d6` pass the dataviz palette validator (CVD ΔE 28.8, normal-vision 35.5, both ≥ 3:1 contrast).
- "You" is ink `#0b0b0b`, and Random is the neutral reference `#8a8984` (dashed, with a band).
- None of these reuse the graph's red/blue/orange.

**Files:**
- Create: `src/app/components/Explainer.tsx`
- Create: `src/app/components/SidePanel.tsx`
- Create: `src/app/components/AucChart.tsx`

- [ ] **Step 1: Write `src/app/components/Explainer.tsx`**

```tsx
import { COLORS } from '../scales.ts';

/** Gaussian bump over [0, 1] centred at 0.5, as an SVG path in a 140×90 box. */
function densityPath(sd: number): string {
  const pts: string[] = [];
  for (let k = 0; k <= 140; k++) {
    const x = k / 140;
    pts.push(`L${k},${(90 - 80 * Math.exp(-((x - 0.5) ** 2) / (2 * sd * sd))).toFixed(1)}`);
  }
  return `M0,90 ${pts.join(' ')} L140,90 Z`;
}

function Density({ x, title, sd, fill, stroke }: { x: number; title: string; sd: number; fill: string; stroke: string }) {
  return (
    <g transform={`translate(${x},10)`}>
      <text x={70} y={8} fontSize={11} textAnchor="middle" fill={COLORS.ink}>{title}</text>
      <line x1={0} y1={90} x2={140} y2={90} stroke="#999" />
      <path d={densityPath(sd)} fill={fill} stroke={stroke} />
      <text x={0} y={104} fontSize={9} fill={COLORS.ink}>0</text>
      <text x={70} y={104} fontSize={9} textAnchor="middle" fill={COLORS.ink}>0.5</text>
      <text x={140} y={104} fontSize={9} textAnchor="end" fill={COLORS.ink}>1</text>
    </g>
  );
}

export function Explainer() {
  return (
    <details className="panel" open>
      <summary>What do the colours mean?</summary>
      <p>
        <b style={{ color: COLORS.infected }}>+</b> / <b style={{ color: COLORS.clear }}>−</b> tested location: infected / clear.
      </p>
      <p><b>Shading</b> is the model's best guess of P(infected) at each untested location.</p>
      <p>
        <b>Orange rings</b> show how <i>sure</i> the model is about that guess: the width of its belief about P(infected).
        Thicker ring = wider belief.
      </p>
      <svg viewBox="0 0 320 120" width="100%" aria-label="Two beliefs with the same average">
        <Density x={10} title="Confident it's 50/50" sd={0.04} fill="#b0bec5" stroke="#455a64" />
        <Density x={170} title="No idea (also 0.5 on average)" sd={0.3} fill="#ffcc80" stroke={COLORS.ring} />
      </svg>
      <p className="muted">
        Both have P(infected) = 0.5 on average, but only the right one gets a thick ring. Rings are relative: the thickest
        ring is the most uncertain location right now.
      </p>
    </details>
  );
}
```

- [ ] **Step 2: Write `src/app/components/SidePanel.tsx`**

```tsx
import type { Graph } from '../../core/graph.ts';
import { Explainer } from './Explainer.tsx';

export interface SidePanelProps {
  graph: Graph;
  showPredictions: boolean;
  showUncertainty: boolean;
  onTogglePredictions: (on: boolean) => void;
  onToggleUncertainty: (on: boolean) => void;
  hovered: number | null;
  /** Result per tested node. */
  tested: Map<number, 0 | 1>;
  p: ArrayLike<number>;
  pStd: ArrayLike<number>;
  /** Uncertainty rank (1 = most uncertain) per untested node. */
  rank: Map<number, number>;
}

function hopCounts(graph: Graph, node: number): number[] {
  const counts = [0, 0, 0];
  for (let j = 0; j < graph.n; j++) {
    const d = graph.dist[node * graph.n + j];
    if (d >= 1 && d <= 3) counts[d - 1]++;
  }
  return counts;
}

export function SidePanel(props: SidePanelProps) {
  const { graph, showPredictions, showUncertainty, hovered, tested, p, pStd, rank } = props;
  let hoverText = <span className="muted">Hover over a location to inspect it.</span>;
  if (hovered !== null) {
    const result = tested.get(hovered);
    const [h1, h2, h3] = hopCounts(graph, hovered);
    hoverText = (
      <>
        <b>Location {hovered}</b>
        <br />
        {result !== undefined ? (
          <>Tested: {result === 1 ? 'infected' : 'clear'}</>
        ) : (
          <>
            P(infected) ≈ {p[hovered].toFixed(2)} ± {pStd[hovered].toFixed(2)}
            <br />
            Uncertainty rank {rank.get(hovered)} of {rank.size}
          </>
        )}
        <br />
        <span className="muted">1-hop: {h1} · 2-hop: {h2} · 3-hop: {h3}</span>
      </>
    );
  }
  return (
    <aside className="side">
      <div className="panel">
        <b>Show model</b>
        <label>
          <input type="checkbox" checked={showPredictions} onChange={(e) => props.onTogglePredictions(e.target.checked)} /> Predictions (colour)
        </label>
        <label>
          <input type="checkbox" checked={showUncertainty} onChange={(e) => props.onToggleUncertainty(e.target.checked)} /> Uncertainty (orange rings)
        </label>
      </div>
      <div className="panel hover-box" data-testid="hover-box">{hoverText}</div>
      <Explainer />
      <p className="muted small">No live score during play: it would give the answer away. You choose where to test; the model does the mapping.</p>
    </aside>
  );
}
```

- [ ] **Step 3: Write `src/app/components/AucChart.tsx`**

```tsx
import { useRef, useState } from 'react';
import { nudgeLabels } from '../labels.ts';

export interface ChartSeries {
  key: string;
  name: string;
  /** Short name for the end-of-line label. */
  short: string;
  color: string;
  width: number;
  dash?: string;
  values: (number | null)[];
}

export interface AucChartProps {
  series: ChartSeries[];
  /** Optional reference band (e.g. Random's 5–95%). */
  band?: { lo: (number | null)[]; hi: (number | null)[]; color: string };
}

const W = 460;
const H = 240;
const L = 40;
const R = 380;
const T = 8;
const B = 204;

/** AUC against number of tests, y fixed to [0.5, 1]. Legend above, direct labels right, hover crosshair. */
export function AucChart({ series, band }: AucChartProps) {
  const N = Math.max(...series.map((s) => s.values.length)) - 1;
  const X = (t: number) => L + (t / N) * (R - L);
  const Y = (v: number) => B - ((Math.min(Math.max(v, 0.5), 1) - 0.5) / 0.5) * (B - T);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, t) => {
      if (v === null) return;
      d += `${d === '' ? 'M' : 'L'}${X(t)},${Y(v)} `;
    });
    return d;
  };
  const last = (vals: (number | null)[]) => vals[N] ?? null;
  const labelled = series.filter((s) => last(s.values) !== null);
  const labelYs = nudgeLabels(labelled.map((s) => Y(last(s.values)!)), 14, T + 4, B - 2);
  const ticks = Array.from({ length: Math.floor(N / 2) + 1 }, (_, k) => 2 * k).concat(N % 2 === 1 ? [N] : []);

  const onMove = (e: React.MouseEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - box.left) * W) / box.width;
    setHoverT(Math.max(0, Math.min(N, Math.round(((sx - L) / (R - L)) * N))));
  };

  return (
    <div className="chart">
      <div className="chart-title">How good was the model's map after each test?</div>
      <div className="chart-subtitle">AUC on untested locations (the paper's metric) · higher is better</div>
      <div className="legend" data-testid="legend">
        {[...series].reverse().map((s) => (
          <span key={s.key}>
            <svg width={22} height={10} aria-hidden="true">
              <line x1={1} y1={5} x2={21} y2={5} stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%">
          {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => (
            <g key={v}>
              <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke={v === 0.5 ? '#c9c7c1' : '#eceae6'} />
              <text x={L - 6} y={Y(v) + 4} fontSize={11} textAnchor="end" fill="#52514e">{v.toFixed(1)}</text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={t} x={X(t)} y={B + 16} fontSize={11} textAnchor="middle" fill="#52514e">{t}</text>
          ))}
          <text x={(L + R) / 2} y={B + 32} fontSize={11} textAnchor="middle" fill="#52514e">tests used (0 = starting location only)</text>
          {band && (
            <path
              d={
                'M' +
                band.hi.map((v, t) => `${X(t)},${Y(v ?? 0.5)}`).join(' L') +
                ' L' +
                band.lo.map((v, t) => `${X(t)},${Y(v ?? 0.5)}`).reverse().join(' L') +
                ' Z'
              }
              fill={band.color}
              opacity={0.16}
            />
          )}
          {series.map((s) => (
            <g key={s.key}>
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
              {last(s.values) !== null && <circle cx={X(N)} cy={Y(last(s.values)!)} r={s.width >= 3 ? 4 : 3} fill={s.color} stroke="#fcfcfb" strokeWidth={2} />}
            </g>
          ))}
          {labelled.map((s, k) => (
            <g key={s.key}>
              <line x1={X(N) + 5} y1={Y(last(s.values)!)} x2={R + 8} y2={labelYs[k]} stroke="#c9c7c1" />
              <text x={R + 11} y={labelYs[k] + 4} fontSize={11} fontWeight={s.width >= 3 ? 700 : 400} fill="#0b0b0b">
                {s.short} {last(s.values)!.toFixed(2)}
              </text>
            </g>
          ))}
          {hoverT !== null && <line x1={X(hoverT)} x2={X(hoverT)} y1={T} y2={B} stroke="#9e9c96" />}
          <rect x={L} y={T} width={R - L} height={B - T} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHoverT(null)} />
        </svg>
        {hoverT !== null && (
          <div className="tooltip" style={X(hoverT) / W > 0.55 ? { right: `${(1 - X(hoverT) / W) * 100 + 2}%` } : { left: `${(X(hoverT) / W) * 100 + 2}%` }}>
            <b>After {hoverT} test{hoverT === 1 ? '' : 's'}</b>
            {[...series].reverse().map((s) => (
              <div key={s.key}>
                <span className="swatch" style={{ background: s.color }} />
                {s.short}: {s.values[hoverT] === null ? '–' : s.values[hoverT]!.toFixed(3)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck` (silent)

```bash
git add src/app/components/Explainer.tsx src/app/components/SidePanel.tsx src/app/components/AucChart.tsx
git commit -m "feat(app): side panel, explainer, AUC chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Screens, App shell, styles

**Notes on the code:**
- `PlayScreen` passes **updater functions** to `onSessionChange`, and `App` applies them with `setSession((s) => ...)`. If it passed new session values instead, two clicks landing before a re-render would both read the same stale session and one test would be lost. This bug was observed in the prototype, and a regression test is included.
- Both overlays start **off**. Switching either on is recorded in the session (`usedPredictions` / `usedUncertainty`, which feed the 👁 on the Plan 3 leaderboard). Turning uncertainty on also turns predictions on.

**Files:**
- Create: `src/app/screens/StartScreen.tsx`, `src/app/screens/PlayScreen.tsx`, `src/app/screens/ResultsScreen.tsx`
- Create: `src/app/App.tsx`, `src/app/main.tsx`, `src/app/styles.css`
- Test: `src/app/App.test.tsx`

- [ ] **Step 1: Write the failing integration test** — `src/app/App.test.tsx`

```tsx
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

const files: Record<string, string> = {
  'presets.json': readFileSync('public/data/presets.json', 'utf8'),
  'bots.json': readFileSync('public/data/bots.json', 'utf8'),
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = files[url.split('/').pop()!];
    return { ok: body !== undefined, status: body ? 200 : 404, json: async () => JSON.parse(body) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Click untested nodes (lowest index first) until the game ends. */
function playToEnd() {
  for (;;) {
    const left = screen.queryByTestId('tests-left');
    if (!left) return;
    const untested = screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') !== '#c62828' && el.getAttribute('data-fill') !== '#1565c0')!;
    fireEvent.click(untested);
  }
}

describe('App', () => {
  it('plays a full game from start screen to results', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(screen.getByTestId('tests-left').textContent).toBe('10 / 10');
    fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!);
    expect(screen.getByTestId('tests-left').textContent).toBe('9 / 10');

    playToEnd();
    expect(screen.getByText('AUC (paper metric)')).toBeTruthy();
    expect(screen.getByTestId('score-auc').textContent).toMatch(/^0\.\d{3}$|^–$/);
    const legend = screen.getByTestId('legend');
    for (const name of ['You', 'LE (paper)', 'NE', 'Random (mean, 90% band)']) expect(within(legend).getByText(name)).toBeTruthy();
    expect(screen.getByTestId('verdict').textContent).toMatch(/On this outbreak you finished|undefined/);
  });

  it('counts every click even when several land before a re-render, and ignores repeats', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const untested = screen.getAllByTestId(/^node-/).filter((el) => el.getAttribute('data-fill') === '#e8e8e8').slice(0, 3);
    act(() => {
      for (const el of untested) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      untested[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(screen.getByTestId('tests-left').textContent).toBe('7 / 10');
  });

  it('turning on uncertainty also turns on predictions and shades nodes', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByLabelText(/Uncertainty/));
    expect((screen.getByLabelText(/Predictions/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByTestId(/^node-/).some((el) => el.getAttribute('data-fill')!.startsWith('rgb('))).toBe(true);
  });

  it('resumes an in-progress game after a reload', async () => {
    const first = render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!);
    first.unmount();

    render(<App />);
    expect((await screen.findByTestId('tests-left')).textContent).toBe('9 / 10');
  });

  it('shows an error if the data cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(<App />);
    expect(await screen.findByText(/Could not load the game/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/App.test.tsx`
Expected: FAIL — cannot resolve `./App.tsx`.

- [ ] **Step 3: Write `src/app/screens/StartScreen.tsx`**

```tsx
import { useState } from 'react';
import type { Preset } from '../../core/presets.ts';

export interface StartScreenProps {
  presets: Preset[];
  initialNickname: string;
  onStart: (nickname: string, presetId: string) => void;
}

export function StartScreen({ presets, initialNickname, onStart }: StartScreenProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId);
  const name = nickname.trim();
  return (
    <main className="start">
      <h1>Surveillance Game</h1>
      <p className="lead">
        An outbreak is spreading across a network of locations. You have <b>{preset?.defaultBudget ?? 'a few'} tests</b>. One
        starting location is already tested. Choose where to test next, and a model maps the rest. Your score is the model's
        AUC on the locations you didn't test, as in Tsui et al. (2024).
      </p>
      <label className="field">
        Nickname
        <input value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. ada" />
      </label>
      <div className="presets" role="radiogroup" aria-label="Network">
        {presets.map((p) => (
          <button key={p.id} role="radio" aria-checked={p.id === presetId} className={`preset-card${p.id === presetId ? ' selected' : ''}`} onClick={() => setPresetId(p.id)}>
            <b>{p.name}</b>
            <span className="muted">{p.n} locations · {p.defaultBudget} tests</span>
          </button>
        ))}
      </div>
      <button className="primary" disabled={name === '' || !preset} onClick={() => onStart(name, presetId)}>
        Play
      </button>
    </main>
  );
}
```

- [ ] **Step 4: Write `src/app/screens/PlayScreen.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { probabilityStd } from '../../core/entropy.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { fitLaplace } from '../../core/surrogate.ts';
import { GraphView } from '../components/GraphView.tsx';
import { SidePanel } from '../components/SidePanel.tsx';
import { relativeScale } from '../scales.ts';
import { isFinished, isTested, noteToggles, observations, pick, testsLeft, type Session } from '../session.ts';

export interface PlayScreenProps {
  model: PresetModel;
  outbreak: Outbreak;
  session: Session;
  nickname: string;
  /** Receives an updater, so several clicks before a re-render are all applied in order. */
  onSessionChange: (update: (s: Session) => Session) => void;
}

export function PlayScreen({ model, outbreak, session, nickname, onSessionChange }: PlayScreenProps) {
  const { preset, graph, K } = model;
  const [showPredictions, setShowPredictions] = useState(false);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const obs = observations(session, outbreak.truth);
  const tested = useMemo(() => new Map(obs.map((o) => [o.node, o.y])), [session.picks]);
  const posterior = useMemo(() => fitLaplace(K, graph.n, obs), [session.picks]);
  const { pStd, relUncertainty, rank } = useMemo(() => {
    const pStd = Float64Array.from(posterior.mean, (mu, j) => probabilityStd(mu, posterior.variance[j]));
    const untested = Array.from({ length: graph.n }, (_, j) => j).filter((j) => !tested.has(j));
    const rank = new Map([...untested].sort((a, b) => pStd[b] - pStd[a]).map((j, k) => [j, k + 1]));
    return { pStd, relUncertainty: relativeScale(pStd, untested), rank };
  }, [posterior]);

  const togglePredictions = (on: boolean) => {
    setShowPredictions(on);
    if (!on) setShowUncertainty(false);
    onSessionChange((s) => noteToggles(s, on, false));
  };
  const toggleUncertainty = (on: boolean) => {
    setShowUncertainty(on);
    if (on) setShowPredictions(true);
    onSessionChange((s) => noteToggles(s, on, on));
  };

  const left = testsLeft(session);
  return (
    <main className="play">
      <header className="bar">
        <div>
          <b>Surveillance Game</b> · {preset.name} · outbreak {outbreak.id} · <i>{nickname}</i>
        </div>
        <div aria-label="tests left">
          Tests left:{' '}
          <span className="pips" aria-hidden="true">
            {Array.from({ length: session.budget }, (_, k) => (
              <span key={k} className={k < left ? 'pip on' : 'pip'} />
            ))}
          </span>{' '}
          <b data-testid="tests-left">{left} / {session.budget}</b>
        </div>
      </header>
      <div className="play-body">
        <GraphView
          graph={graph}
          layout={preset.layout}
          tested={tested}
          predictions={showPredictions ? posterior.p : null}
          uncertainty={showUncertainty ? relUncertainty : null}
          hovered={hovered}
          onHover={setHovered}
          onPick={(node) => onSessionChange((s) => (isFinished(s) || isTested(s, node) ? s : pick(s, node, graph.n)))}
        />
        <SidePanel
          graph={graph}
          showPredictions={showPredictions}
          showUncertainty={showUncertainty}
          onTogglePredictions={togglePredictions}
          onToggleUncertainty={toggleUncertainty}
          hovered={hovered}
          tested={tested}
          p={posterior.p}
          pStd={pStd}
          rank={rank}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Write `src/app/screens/ResultsScreen.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { BotsFile } from '../../core/bots.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { AucChart, type ChartSeries } from '../components/AucChart.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { botResult } from '../data.ts';
import { scoreSession, type Session } from '../session.ts';

export interface ResultsScreenProps {
  model: PresetModel;
  outbreak: Outbreak;
  session: Session;
  bots: BotsFile;
  onPlayAgain: () => void;
  onChangeSettings: () => void;
}

// Validated categorical pair for the bots (dataviz palette check: CVD, normal vision, contrast);
// "You" is ink, Random a neutral reference. None reuse the graph's red/blue/orange.
const SERIES_STYLE = {
  you: { color: '#0b0b0b', width: 3 },
  le: { color: '#008300', width: 2 },
  ne: { color: '#6250d6', width: 2 },
  rand: { color: '#8a8984', width: 1.5, dash: '4 3' },
};

const fmt = (v: number | null) => (v === null ? '–' : v.toFixed(3));

export function ResultsScreen({ model, outbreak, session, bots, onPlayAgain, onChangeSettings }: ResultsScreenProps) {
  const { preset, graph } = model;
  const [hovered, setHovered] = useState<number | null>(null);
  const score = useMemo(() => scoreSession(model, outbreak, session), [model, outbreak, session]);
  const tested = new Map([session.seedNode, ...session.picks].map((node) => [node, outbreak.truth[node]]));
  const wrong = new Set(
    Array.from({ length: graph.n }, (_, j) => j).filter((j) => !tested.has(j) && (score.trajectory.final.p[j] > 0.5 ? 1 : 0) !== outbreak.truth[j]),
  );

  const upTo = session.budget + 1;
  const le = botResult(bots, preset.id, outbreak.id, 'LE').auc.mean.slice(0, upTo);
  const ne = botResult(bots, preset.id, outbreak.id, 'NE').auc.mean.slice(0, upTo);
  const rand = botResult(bots, preset.id, outbreak.id, 'RAND').auc;
  const series: ChartSeries[] = [
    { key: 'rand', name: 'Random (mean, 90% band)', short: 'Random', values: rand.mean.slice(0, upTo), ...SERIES_STYLE.rand },
    { key: 'ne', name: 'NE', short: 'NE', values: ne, ...SERIES_STYLE.ne },
    { key: 'le', name: 'LE (paper)', short: 'LE', values: le, ...SERIES_STYLE.le },
    { key: 'you', name: 'You', short: 'You', values: score.trajectory.auc, ...SERIES_STYLE.you },
  ];

  const finals = [
    { name: 'LE', v: le[session.budget] },
    { name: 'NE', v: ne[session.budget] },
    { name: 'Random', v: rand.mean[session.budget] },
  ].filter((b): b is { name: string; v: number } => b.v !== null);
  const above = score.auc === null ? [] : finals.filter((b) => score.auc! > b.v);
  const below = score.auc === null ? [] : finals.filter((b) => score.auc! <= b.v);
  const list = (bs: typeof finals) => bs.map((b) => `${b.name} (${b.v.toFixed(3)})`).join(', ');

  return (
    <main className="results">
      <header className="bar">
        <div><b>Results</b> · {preset.name} · outbreak {outbreak.id}</div>
      </header>
      <div className="results-body">
        <div className="results-map">
          <GraphView graph={graph} layout={preset.layout} tested={tested} predictions={null} uncertainty={null} truth={outbreak.truth} wrong={wrong} hovered={hovered} onHover={setHovered} />
          <p className="muted small">Fill = <b>true</b> status · <b>+/−</b> your tests · <b>✕</b> = model's final guess was wrong</p>
        </div>
        <div className="results-side">
          <div className="scores">
            <div>
              <div className="label">AUC (paper metric)</div>
              <div className="hero" data-testid="score-auc">{fmt(score.auc)}</div>
            </div>
            <div>
              <div className="label">Learning-curve AUC</div>
              <div className="secondary">{fmt(score.aucArea)}</div>
            </div>
            <div>
              <div className="label">Accuracy</div>
              <div className="tertiary">{(100 * score.accuracy).toFixed(0)}%</div>
            </div>
          </div>
          <AucChart series={series} band={{ lo: rand.lo.slice(0, upTo), hi: rand.hi.slice(0, upTo), color: SERIES_STYLE.rand.color }} />
          <p className="verdict" data-testid="verdict">
            {score.auc === null
              ? 'AUC is undefined for this game (all untested locations had the same status).'
              : <>On this outbreak you finished {above.length > 0 && <>above <b>{list(above)}</b></>}{above.length > 0 && below.length > 0 && ' and '}{below.length > 0 && <>below <b>{list(below)}</b></>}.</>}
          </p>
          <div className="actions">
            <button className="primary" onClick={onPlayAgain}>Play another outbreak</button>
            <button onClick={onChangeSettings}>Change network or nickname</button>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Write `src/app/App.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { presetModel, type PresetModel } from '../core/presets.ts';
import { chooseOutbreak, loadGameData, type GameData } from './data.ts';
import { isFinished, startSession, type Session } from './session.ts';
import { loadLastOutbreak, loadNickname, loadSession, saveLastOutbreak, saveNickname, saveSession } from './storage.ts';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';

export function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(loadNickname);
  const [session, setSession] = useState<Session | null>(loadSession);

  useEffect(() => {
    loadGameData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => saveSession(session), [session]);

  // Building K is ~ms per preset; cache one model per preset.
  const model = useMemo(() => {
    const cache = new Map<string, PresetModel>();
    return (presetId: string) => {
      const preset = data?.presets.presets.find((p) => p.id === presetId);
      if (!preset) return null;
      if (!cache.has(presetId)) cache.set(presetId, presetModel(preset));
      return cache.get(presetId)!;
    };
  }, [data]);

  if (error) return <main className="message">Could not load the game: {error}</main>;
  if (!data) return <main className="message">Loading…</main>;

  const begin = (presetId: string, previousId: string | null) => {
    const preset = data.presets.presets.find((p) => p.id === presetId)!;
    const outbreak = chooseOutbreak(preset, previousId);
    saveLastOutbreak(outbreak.id);
    setSession(startSession(preset, outbreak));
  };

  const current = session && model(session.presetId);
  const outbreak = current?.preset.outbreaks.find((o) => o.id === session?.outbreakId);
  if (!session || !current || !outbreak) {
    return (
      <StartScreen
        presets={data.presets.presets}
        initialNickname={nickname}
        onStart={(name, presetId) => {
          setNickname(name);
          saveNickname(name);
          begin(presetId, loadLastOutbreak());
        }}
      />
    );
  }
  if (!isFinished(session)) {
    return <PlayScreen model={current} outbreak={outbreak} session={session} nickname={nickname} onSessionChange={(update) => setSession((s) => (s ? update(s) : s))} />;
  }
  return (
    <ResultsScreen
      model={current}
      outbreak={outbreak}
      session={session}
      bots={data.bots}
      onPlayAgain={() => begin(session.presetId, session.outbreakId)}
      onChangeSettings={() => setSession(null)}
    />
  );
}
```

- [ ] **Step 7: Write `src/app/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Write `src/app/styles.css`**

```css
/* Explicit text colours everywhere: WCAG AA on light surfaces (no inherited pale text). */
:root {
  --bg: #f6f5f2;
  --surface: #ffffff;
  --chart-surface: #fcfcfb;
  --ink: #1f1f1f;
  --ink-2: #52514e;
  --border: #dddbd5;
  --accent: #1f4f8f;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--ink);
  background: var(--bg);
}
body { margin: 0; }
button { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 14px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.muted { color: var(--ink-2); }
.small { font-size: 12px; }
.label { font-size: 12px; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.04em; }
.message { padding: 40px; font-size: 18px; }

/* Start */
.start { max-width: 620px; margin: 48px auto; padding: 0 20px; display: flex; flex-direction: column; gap: 18px; }
.start h1 { margin: 0; }
.lead { line-height: 1.5; margin: 0; }
.field { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
.field input { font: inherit; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--ink); background: var(--surface); }
.presets { display: flex; gap: 12px; flex-wrap: wrap; }
.preset-card { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; min-width: 180px; text-align: left; }
.preset-card.selected { border: 2px solid var(--accent); }

/* Shared bar */
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 20px; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.pips { display: inline-flex; gap: 3px; vertical-align: middle; }
.pip { width: 9px; height: 9px; border-radius: 50%; background: #d4d2cc; }
.pip.on { background: var(--accent); }

/* Play */
.play-body, .results-body { display: flex; gap: 20px; padding: 20px; flex-wrap: wrap; align-items: flex-start; }
.graph { flex: 1 1 420px; max-width: 640px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
.side { flex: 1 1 260px; max-width: 340px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.panel p { margin: 4px 0; line-height: 1.4; }
.panel summary { font-weight: 600; cursor: pointer; }
.hover-box { min-height: 72px; line-height: 1.45; }

/* Results */
.results-map { flex: 1 1 340px; max-width: 480px; display: flex; flex-direction: column; }
.results-map .graph { max-width: none; }
.results-side { flex: 1 1 380px; max-width: 560px; display: flex; flex-direction: column; gap: 12px; }
.scores { display: flex; gap: 24px; align-items: flex-end; }
.hero { font-size: 48px; font-weight: 700; line-height: 1; }
.secondary { font-size: 22px; font-weight: 600; }
.tertiary { font-size: 16px; color: var(--ink-2); }
.verdict { margin: 0; font-size: 15px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* Chart */
.chart { background: var(--chart-surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px 6px; }
.chart-title { font-size: 14px; font-weight: 600; color: #0b0b0b; }
.chart-subtitle { font-size: 12px; color: var(--ink-2); margin-bottom: 6px; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--ink-2); margin-bottom: 4px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.chart-plot { position: relative; }
.chart-plot svg { display: block; }
.tooltip { position: absolute; top: 6px; pointer-events: none; background: #fff; border: 1px solid #d6d4cf; border-radius: 6px; padding: 6px 8px; font-size: 12px; color: #0b0b0b; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08); white-space: nowrap; }
.swatch { display: inline-block; width: 10px; height: 3px; margin-right: 5px; vertical-align: middle; }
```

- [ ] **Step 9: Run everything**

Run: `npm test && npm run typecheck`
Expected: `Test Files  17 passed (17)`, `Tests  81 passed (81)`, silent typecheck.

- [ ] **Step 10: Build**

Run: `npm run build`
Expected: `✓ built in …`, with `dist/index.html`, `dist/assets/*.js` (~245 kB, ~78 kB gzipped) and `dist/data/{presets,bots}.json`.

- [ ] **Step 11: Commit**

```bash
git add src/app/screens/ src/app/App.tsx src/app/App.test.tsx src/app/main.tsx src/app/styles.css
git commit -m "feat(app): start, play and results screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Manual browser check and README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Play one full game in a real browser**

Run: `npm run build && npx vite preview --port 4173` and open http://localhost:4173. Check:
1. **Start screen:** the Play button stays disabled until a nickname is entered. The 10×10 grid card shows "100 locations · 10 tests".
2. **Play screen:**
   - The header shows "Tests left … 10 / 10".
   - Clicking a grey node reveals a red **+** or blue **−**, and the counter drops by one.
   - **Predictions** shades untested nodes blue–white–red.
   - **Uncertainty** adds orange rings, thickest at corners and edges (an expected CAR-prior effect).
   - Hovering a node outlines its 1–3-hop neighbourhood, fades the rest, and fills the hover box ("P(infected) ≈ … ± …", rank, hop counts).
   - Reloading mid-game resumes it.
3. **Results screen** (after the 10th test):
   - the map shows true status with ✕ on wrong predictions;
   - the AUC hero number is shown;
   - the chart has its legend above the plot and non-overlapping end labels, and hovering shows a crosshair with a tooltip;
   - the verdict line names LE/NE/Random;
   - "Play another outbreak" starts a different outbreak.

Stop the preview server when done (Ctrl-C).

- [ ] **Step 2: Add an "App" section to `README.md`**

Insert after the `## Engine (src/core/)` section:

````markdown
## App (`src/app/`)

Single-player game: React + hand-written SVG. All model computation runs in the browser; data comes from `public/data/`.

```bash
npm run dev       # development server
npm run build     # typecheck + production build into dist/ (static; host anywhere)
npm run preview   # serve dist/ locally
```

Design: `docs/superpowers/specs/2026-11-01-player-app-design.md`
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: app commands in README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Notes for Plan 3 (multiplayer)

- **Submitting a play:** send `Session` as-is (`picks`, `usedPredictions`, `usedUncertainty`, budget, preset/outbreak ids). The board recomputes the scores with `scoreSession`.
- **Presenter-chosen rounds:** call `startSession(preset, outbreak, budget)` directly with the presenter's outbreak and budget, instead of `chooseOutbreak`.
- **Code reuse:** `AucChart` and `GraphView` (read-only, no `onPick`) can be reused on the projector board.

