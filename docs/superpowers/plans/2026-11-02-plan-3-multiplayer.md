# Multiplayer (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presenter-led rounds for ~30 laptops: players join from a lobby, play the same outbreak, submit their picks; a projector board shows live progress, then a leaderboard with bots, learning curves, a first-test heatmap and step-by-step replay; free play stays available between rounds.

**Architecture:** A static Vite/React site (GitHub Pages) talks to Supabase through one small `RoundsApi` interface (`src/app/net/`). Supabase holds `rounds` and write-once `plays`; all writes go through PIN-checked or rule-checking `SECURITY DEFINER` functions, and presence is Supabase realtime presence. Scores are never stored: the board and players recompute them from picks with the existing engine. Tests drive players, presenter and board through an in-memory `FakeRoundsApi` with the same rules; `schema.sql` is tested on a local Postgres; smoke/load scripts check the real project.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Vitest 5 (+ jsdom, @testing-library/react), `@supabase/supabase-js` 2, `qrcode`, PostgreSQL (Supabase; local Postgres 14+ for schema tests), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-02-multiplayer-design.md` (parent specs: `2026-11-01-surveillance-game-design.md`, `2026-11-01-player-app-design.md`).

**Verified:** every file below was built and tested in a scratch prototype first (126 tests passing, schema checks passing on Postgres 14, production build OK, all board and player screens checked in Chrome). Copy code exactly.

---

## Conventions (read once)

- Repo: `surveillance-game/` (its own git repo, branch `main`). Work on a feature branch: `git checkout -b plan-3-multiplayer`.
- Node 23.6+ (24 LTS recommended) runs `.ts` files directly; imports use explicit `.ts`/`.tsx` extensions and `import type` for types.
- `.npmrc` has `legacy-peer-deps=true`; keep it.
- Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`; types with `npm run typecheck`.
- jsdom tests start with `// @vitest-environment jsdom`.
- All text in the UI has explicit dark text colours (the user found pale text unreadable).
- Commit messages end with the `Co-Authored-By` line shown in each commit step.

## File structure

| Path | Responsibility |
|---|---|
| `offline/build_presets.py` | outbreaks labelled `round` (5), `free` (5), `calib` (20) |
| `src/core/presets.ts` | `Outbreak.split` union; `playedOutbreaks()` |
| `src/app/session.ts` | `Session.roundId` (null = free play) |
| `src/app/net/types.ts` | shared types, `RoundsApi`, `SubmitError`, `PinError`, `latestRound`, `openRound` |
| `src/app/net/rules.ts` | play-acceptance rules (mirrors `submit_play` in SQL) |
| `src/app/net/fake.ts` | in-memory backend for tests and script self-checks |
| `src/app/net/supabase.ts` | Supabase implementation |
| `src/app/net/config.ts` | build-time env → `RoundsApi \| null` |
| `src/app/net/hooks.ts` | `useRounds`, `usePresenceList`, `useRoundPlays` |
| `supabase/schema.sql`, `supabase/test/*` | database schema; local Postgres checks |
| `src/app/player/flow.ts` | pure player state: which screen, auto-join, presence status, submission state |
| `src/app/player/hooks.ts` | `useSubmitter` (retry), `usePresence` |
| `src/app/player/RoundNotice.tsx` | delivery status / rank above round results |
| `src/app/board/ranking.ts` | scoring plays, ranks with ties, display names, median curve, first-pick counts |
| `src/app/board/frames.ts` | replay frames + commentary |
| `src/app/board/rows.ts` | leaderboard rows incl. bots |
| `src/app/board/*.tsx` | `BoardApp`, `Leaderboard`, `FirstPickHeatmap`, `ReplayPanel`, `PresenterDrawer`, `Qr` |
| `src/app/Root.tsx`, `main.tsx` | hash routing `#/` vs `#/board` |
| `src/test/harness.ts` | shared jsdom helpers (data stub, clicking nodes) |
| `scripts/live.ts`, `smoke.ts`, `loadtest.ts` | checks against the real Supabase project |
| `.github/workflows/deploy.yml`, `.env.example`, `README.md` | deployment and setup |

---

## Task 1: Round and free-play outbreaks

The 10 played outbreaks become 5 `round` (presenter only) and 5 `free` (practice). The simulation is seeded, so the outbreaks themselves don't change, only their labels; `bots.json` comes out byte-identical.

**Files:**
- Modify: `offline/build_presets.py`, `src/core/presets.ts`, `src/core/presets.test.ts`, `scripts/build-bots.ts`, `scripts/export-scenarios.ts`, `src/app/data.ts`, `src/app/data.test.ts`, `src/app/session.test.ts`
- Regenerate: `public/data/presets.json` (and `bots.json`, unchanged)

- [ ] **Step 1: Write the failing test.** Replace the whole of `src/app/data.test.ts`:

````ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile } from '../core/presets.ts';
import type { BotsFile } from '../core/bots.ts';
import { makeRng } from '../core/rng.ts';
import { botResult, chooseOutbreak } from './data.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;

describe('chooseOutbreak', () => {
  it('only returns free-play outbreaks and never repeats the previous one', () => {
    const rng = makeRng(1);
    const previous = preset.outbreaks.find((o) => o.split === 'free')!.id;
    for (let k = 0; k < 50; k++) {
      const o = chooseOutbreak(preset, previous, rng);
      expect(o.split).toBe('free');
      expect(o.id).not.toBe(previous);
    }
  });

  it('presets.json has 5 round and 5 free outbreaks, and bots cover all of them', () => {
    expect(preset.outbreaks.filter((o) => o.split === 'round')).toHaveLength(5);
    expect(preset.outbreaks.filter((o) => o.split === 'free')).toHaveLength(5);
    for (const o of preset.outbreaks.filter((o) => o.split !== 'calib')) expect(() => botResult(bots, preset.id, o.id, 'LE')).not.toThrow();
  });
});

describe('botResult', () => {
  it('finds a bot curve covering the maximum budget', () => {
    const le = botResult(bots, preset.id, 'ob00', 'LE');
    expect(le.auc.mean).toHaveLength(preset.maxBudget + 1);
    expect(() => botResult(bots, preset.id, 'nope', 'LE')).toThrow(/No LE bot/);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/app/data.test.ts`
Expected: FAIL (`expected 'game' to be 'free'` / no `round` outbreaks).

- [ ] **Step 3: Label outbreaks in the builder.** Replace the whole of `offline/build_presets.py`:

````python
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


def split_for(k, round_count, free_count):
    """Outbreak k's role: presenter-led rounds first, then free play, then prior calibration."""
    if k < round_count:
        return "round"
    return "free" if k < round_count + free_count else "calib"


def simulate_outbreaks(g, params, count, round_count, free_count, seed, prevalence_range=(0.25, 0.5), max_tries=10_000):
    """Simulate `count` distinct outbreaks, labelled by split_for (round, free, then calib)."""
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
            "split": split_for(len(outbreaks), round_count, free_count),
            "truth": truth,
            "seedNode": int(rng.integers(0, n)),
            "prevalence": round(prevalence, 4),
        })
    if len(outbreaks) < count:
        raise RuntimeError(f"only found {len(outbreaks)} outbreaks in prevalence range {prevalence_range}")
    return outbreaks


def build(out_path, round_outbreaks, free_outbreaks, calib_outbreaks, seed):
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
            "defaultBudget": round(0.1 * n),
            "maxBudget": round(0.3 * n),
            "prior": DEFAULT_PRIOR,
            "outbreaks": simulate_outbreaks(g, sim_params, round_outbreaks + free_outbreaks + calib_outbreaks, round_outbreaks, free_outbreaks, seed + i),
        })
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"version": 1, "presets": presets}))
    for p in presets:
        prev = [o["prevalence"] for o in p["outbreaks"]]
        print(f"{p['id']}: n={p['n']} edges={len(p['edges'])} outbreaks={len(prev)} prevalence {min(prev):.2f}-{max(prev):.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "data" / "presets.json")
    ap.add_argument("--round-outbreaks", type=int, default=5)
    ap.add_argument("--free-outbreaks", type=int, default=5)
    ap.add_argument("--calib-outbreaks", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261112)
    args = ap.parse_args()
    build(args.out, args.round_outbreaks, args.free_outbreaks, args.calib_outbreaks, args.seed)
````

- [ ] **Step 4: Update the types and consumers.** Replace the whole of `src/core/presets.ts`:

````ts
import { makeGraph, type Graph } from './graph.ts';
import { carCovariance, type PriorParams } from './prior.ts';
import type { Scenario } from './replay.ts';

export interface Outbreak {
  id: string;
  /** 'round' outbreaks are for presenter-led rounds, 'free' for free play; 'calib' only calibrate the prior. */
  split: 'round' | 'free' | 'calib';
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

/** Outbreaks that are played (rounds and free play), i.e. everything bots are computed for. */
export const playedOutbreaks = (preset: Preset): Outbreak[] => preset.outbreaks.filter((o) => o.split !== 'calib');

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
````

In `src/core/presets.test.ts`, change the fixture's `split: 'game'` to `split: 'round'`.

Replace the whole of `scripts/build-bots.ts`:

````ts
// Precompute bot trajectories for every preset × played (round and free) outbreak. Usage: npm run data:bots
import { playedOutbreaks, presetModel, scenarioFor } from '../src/core/presets.ts';
import { runPolicy, type Trajectory } from '../src/core/replay.ts';
import { makeRng } from '../src/core/rng.ts';
import { summarise, type BotResult, type BotsFile } from '../src/core/bots.ts';
import type { PolicyName } from '../src/core/policies.ts';
import { BOTS_PATH, loadPresets, writeJson } from './io.ts';

/** Model-driven policies run once (ties are rare after the first few steps); policies that are random
 *  among many equal candidates (DC on a grid: all interior nodes have degree 4) are averaged. */
const RUNS: Record<PolicyName, number> = { LE: 1, NE: 1, BALD: 1, DC: 200, RI: 200, RAND: 200 };

const out: BotsFile = { version: 1, presets: {} };
for (const preset of loadPresets().presets) {
  const model = presetModel(preset);
  out.presets[preset.id] = {};
  const finals: Record<string, { auc: number[]; acc: number[] }> = {};
  for (const ob of playedOutbreaks(preset)) {
    const sc = scenarioFor(model, ob);
    const results: BotResult[] = [];
    for (const [policy, runs] of Object.entries(RUNS) as [PolicyName, number][]) {
      const trajectories: Trajectory[] = [];
      for (let r = 0; r < runs; r++) trajectories.push(runPolicy(sc, policy, preset.maxBudget, makeRng(r)));
      const res = summarise(policy, trajectories);
      results.push(res);
      const f = (finals[policy] ??= { auc: [], acc: [] });
      const aucAtBudget = res.auc.mean[preset.defaultBudget];
      if (aucAtBudget !== null) f.auc.push(aucAtBudget);
      f.acc.push(res.accuracy.mean[preset.defaultBudget] as number);
    }
    out.presets[preset.id][ob.id] = results;
  }
  const mean = (v: number[]) => (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3);
  console.log(`\n${preset.id}: mean AUC (accuracy) after ${preset.defaultBudget} tests (played outbreaks)`);
  for (const [policy, f] of Object.entries(finals)) console.log(`  ${policy.padEnd(5)} ${mean(f.auc)} (${mean(f.acc)})`);
}
writeJson(BOTS_PATH, out);
console.log(`\nWrote ${BOTS_PATH}`);
````

In `scripts/export-scenarios.ts`, import `playedOutbreaks` and use it:

```ts
import { playedOutbreaks, presetModel, scenarioFor } from '../src/core/presets.ts';
// …
  for (const ob of playedOutbreaks(preset).slice(0, OUTBREAKS_PER_PRESET)) {
```

Replace the whole of `src/app/data.ts`:

````ts
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

/** A random free-play outbreak, avoiding `previousId` when there is a choice. */
export function chooseOutbreak(preset: Preset, previousId: string | null, rng: () => number = Math.random): Outbreak {
  const games = preset.outbreaks.filter((o) => o.split === 'free');
  if (games.length === 0) throw new Error(`${preset.id}: no free-play outbreaks`);
  const pool = games.length > 1 ? games.filter((o) => o.id !== previousId) : games;
  return pool[Math.floor(rng() * pool.length)];
}
````

In `src/app/session.test.ts`, replace both occurrences of `o.split === 'game'` with `o.split === 'free'`.

- [ ] **Step 5: Regenerate the data**

Run: `npm run data` (needs `uv` and the paper repo at `../optimal-disease-surveillance-AL`; ~10 s)
Expected: `grid10: n=100 edges=180 outbreaks=30 …`, calibration picks `alpha=0.95 tau=0.1 b0Var=1`, and the bots summary prints `LE 0.952 (0.885)`, `NE 0.945 (0.873)`.

Then check: `git diff --stat public/data/` shows only `presets.json` (1 line changed); `bots.json` is unchanged. `python3 -c "import json;print([o['split'] for o in json.load(open('public/data/presets.json'))['presets'][0]['outbreaks']][:11])"` prints 5 × `round`, 5 × `free`, then `calib`.

- [ ] **Step 6: Run all tests and the type check**

Run: `npm test && npm run typecheck`
Expected: all pass (93 tests).

- [ ] **Step 7: Commit**

```bash
git add offline/build_presets.py src/core/presets.ts src/core/presets.test.ts scripts/build-bots.ts scripts/export-scenarios.ts src/app/data.ts src/app/data.test.ts src/app/session.test.ts public/data/presets.json
git commit -m "feat(data): split played outbreaks into round and free play

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: Sessions know their round

**Files:** Modify `src/app/session.ts`, `src/app/session.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/app/session.test.ts`, in the serialise round-trip test, after the line `expect(deserializeSession(JSON.stringify({ ...s, picks: 'x' }))).toBeNull();` add:

```ts
    expect(deserializeSession(JSON.stringify({ ...s, roundId: 'x' }))).toBeNull();
    const { roundId: _, ...legacy } = s;
    expect(deserializeSession(JSON.stringify(legacy))).toEqual({ ...s, roundId: null });
    const inRound = startSession(preset, outbreak, 3, 7);
    expect(deserializeSession(serializeSession(inRound))?.roundId).toBe(7);
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/app/session.test.ts`
Expected: FAIL (no `roundId`).

- [ ] **Step 3: Implement.** Replace the whole of `src/app/session.ts`:

````ts
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
  /** The presenter-led round this game belongs to; null for free play. */
  roundId: number | null;
}

export function startSession(preset: Preset, outbreak: Outbreak, budget = preset.defaultBudget, roundId: number | null = null): Session {
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
    roundId,
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

/** Is a (stored) session still consistent with the current data? Regenerated presets can change seeds. */
export function isValidFor(s: Session, preset: Preset, outbreak: Outbreak): boolean {
  if (s.presetId !== preset.id || s.outbreakId !== outbreak.id || s.seedNode !== outbreak.seedNode) return false;
  if (!(s.budget >= 1 && s.budget <= preset.maxBudget && s.picks.length <= s.budget)) return false;
  const seen = new Set([s.seedNode]);
  for (const node of s.picks) {
    if (!(Number.isInteger(node) && node >= 0 && node < preset.n) || seen.has(node)) return false;
    seen.add(node);
  }
  return true;
}

export function serializeSession(s: Session): string {
  return JSON.stringify(s);
}

/** Parse a stored session; returns null for anything malformed. */
export function deserializeSession(text: string | null): Session | null {
  if (!text) return null;
  try {
    // Sessions saved before multiplayer have no roundId: they were free play.
    const s = { roundId: null, ...JSON.parse(text) } as Session;
    const ok =
      typeof s.presetId === 'string' &&
      typeof s.outbreakId === 'string' &&
      Number.isInteger(s.budget) &&
      Number.isInteger(s.seedNode) &&
      Array.isArray(s.picks) &&
      s.picks.every(Number.isInteger) &&
      s.picks.length <= s.budget &&
      typeof s.usedPredictions === 'boolean' &&
      typeof s.usedUncertainty === 'boolean' &&
      (s.roundId === null || Number.isInteger(s.roundId));
    return ok ? s : null;
  } catch {
    return null;
  }
}
````

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/app/session.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/session.ts src/app/session.test.ts
git commit -m "feat(app): sessions record their round (null = free play)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 3: Backend interface and in-memory fake

**Files:** Create `src/app/net/types.ts`, `src/app/net/rules.ts`, `src/app/net/fake.ts`, `src/app/net/fake.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/app/net/fake.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { FakeRoundsApi } from './fake.ts';
import { latestRound, openRound, PinError, SubmitError, type NewPlay, type Play, type Round } from './types.ts';

const cfg = { presetId: 'grid10', outbreakId: 'ob00', budget: 3, rankMetric: 'auc' as const };
const play = (over: Partial<NewPlay> = {}): NewPlay => ({
  roundId: 1, presetId: 'grid10', outbreakId: 'ob00', budget: 3, playerId: 'p1', nickname: 'ada', picks: [1, 2, 3], usedPredictions: false, usedUncertainty: false, ...over,
});
const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: SubmitError) => e.kind);

describe('FakeRoundsApi', () => {
  it('opens a round, closing any open one, and numbers rounds in order', async () => {
    const api = new FakeRoundsApi();
    let seen: Round[] = [];
    api.onRounds((r) => (seen = r));
    await api.openRound('1234', cfg);
    await api.openRound('1234', { ...cfg, outbreakId: 'ob01' });
    expect(seen.map((r) => [r.number, r.status])).toEqual([[1, 'closed'], [2, 'open']]);
    expect(openRound(seen)?.outbreakId).toBe('ob01');
    expect(latestRound(seen)?.number).toBe(2);
  });

  it('rejects presenter actions with a wrong PIN', async () => {
    const api = new FakeRoundsApi();
    await expect(api.openRound('0000', cfg)).rejects.toBeInstanceOf(PinError);
    expect(await api.checkPin('0000')).toBe(false);
    expect(await api.checkPin('1234')).toBe(true);
  });

  it('accepts one valid play per player and enforces the database rules', async () => {
    const api = new FakeRoundsApi();
    await api.openRound('1234', cfg);
    let plays: Play[] = [];
    api.onPlays(1, (p) => (plays = p));
    expect(await kind(api.submitPlay(play()))).toBe('ok');
    expect(await kind(api.submitPlay(play()))).toBe('duplicate');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', budget: 4, picks: [1, 2, 3, 4] })))).toBe('invalid');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', picks: [1, 1, 2] })))).toBe('invalid');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', outbreakId: 'ob01' })))).toBe('invalid');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', nickname: '  ' })))).toBe('invalid');
    api.offline = true;
    expect(await kind(api.submitPlay(play({ playerId: 'p2' })))).toBe('network');
    api.offline = false;
    await api.closeRound('1234', 1);
    expect(await kind(api.submitPlay(play({ playerId: 'p2' })))).toBe('round_closed');
    expect(plays).toHaveLength(1);
    await api.hidePlay('1234', plays[0].id);
    expect(plays[0].hidden).toBe(true);
  });

  it('tracks presence', () => {
    const api = new FakeRoundsApi();
    let players: unknown[] = [];
    api.onPresence((p) => (players = p));
    const me = api.joinPresence({ playerId: 'p1', nickname: 'ada', status: 'lobby', roundId: null });
    me.update({ playerId: 'p1', nickname: 'ada', status: 'playing', roundId: 1 });
    expect(players).toEqual([{ playerId: 'p1', nickname: 'ada', status: 'playing', roundId: 1 }]);
    me.leave();
    expect(players).toEqual([]);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/app/net/fake.test.ts`
Expected: FAIL (cannot resolve `./fake.ts`).

- [ ] **Step 3: Implement.** Create `src/app/net/types.ts`:

````ts
/** Shared shapes for the multiplayer backend (Supabase in production, an in-memory fake in tests). */
export type RankMetric = 'auc' | 'lc_auc' | 'accuracy';

export interface RoundConfig {
  presetId: string;
  outbreakId: string;
  budget: number;
  rankMetric: RankMetric;
}

export interface Round extends RoundConfig {
  id: number;
  /** 1, 2, 3… in the order rounds were opened. */
  number: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
}

/** A finished round game, as submitted by a player. Scores are never sent; the board recomputes them from picks. */
export interface NewPlay {
  roundId: number;
  presetId: string;
  outbreakId: string;
  budget: number;
  playerId: string;
  nickname: string;
  picks: number[];
  usedPredictions: boolean;
  usedUncertainty: boolean;
}

export interface Play extends NewPlay {
  id: number;
  hidden: boolean;
  createdAt: string;
}

export type PresenceStatus = 'lobby' | 'free' | 'playing' | 'finished';

export interface PresenceState {
  playerId: string;
  nickname: string;
  status: PresenceStatus;
  /** The round being played (status 'playing' or 'finished'), else null. */
  roundId: number | null;
}

export type SubmitErrorKind = 'round_closed' | 'duplicate' | 'invalid' | 'network';

export class SubmitError extends Error {
  readonly kind: SubmitErrorKind;
  constructor(kind: SubmitErrorKind, message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

/** Thrown by presenter actions when the PIN is wrong. */
export class PinError extends Error {
  constructor() {
    super('Wrong PIN');
  }
}

export type Unsubscribe = () => void;

export interface PresenceHandle {
  update(state: PresenceState): void;
  leave(): void;
}

export interface RoundsApi {
  /** All rounds, oldest first. Called once with the current list, then on every change. */
  onRounds(cb: (rounds: Round[]) => void): Unsubscribe;
  /** All plays of one round (hidden ones included), oldest first. Called once, then on every change. */
  onPlays(roundId: number, cb: (plays: Play[]) => void): Unsubscribe;
  /** Rejects with a SubmitError. */
  submitPlay(play: NewPlay): Promise<void>;
  joinPresence(me: PresenceState): PresenceHandle;
  onPresence(cb: (players: PresenceState[]) => void): Unsubscribe;
  checkPin(pin: string): Promise<boolean>;
  /** Presenter actions reject with PinError on a wrong PIN. Opening a round closes any open one. */
  openRound(pin: string, cfg: RoundConfig): Promise<Round>;
  closeRound(pin: string, roundId: number): Promise<void>;
  hidePlay(pin: string, playId: number): Promise<void>;
}

/** The most recently opened round, if any. */
export const latestRound = (rounds: Round[]): Round | null => (rounds.length === 0 ? null : rounds.reduce((a, b) => (b.number > a.number ? b : a)));

/** The open round, if any (there is never more than one). */
export const openRound = (rounds: Round[]): Round | null => rounds.find((r) => r.status === 'open') ?? null;
````

Create `src/app/net/rules.ts`:

````ts
import type { NewPlay, Play, Round, SubmitErrorKind } from './types.ts';

/** The insert rules the database enforces (supabase/schema.sql); the fake backend applies the same ones. */
export function checkPlay(round: Round | undefined, play: NewPlay, existing: Play[]): SubmitErrorKind | null {
  if (!round || round.status !== 'open') return 'round_closed';
  if (play.presetId !== round.presetId || play.outbreakId !== round.outbreakId || play.budget !== round.budget) return 'invalid';
  if (play.picks.length !== round.budget || new Set(play.picks).size !== play.picks.length) return 'invalid';
  if (!play.picks.every((p) => Number.isInteger(p) && p >= 0)) return 'invalid';
  const nickname = play.nickname.trim();
  if (nickname.length === 0 || nickname.length > 24) return 'invalid';
  if (existing.some((p) => p.roundId === play.roundId && p.playerId === play.playerId)) return 'duplicate';
  return null;
}
````

Create `src/app/net/fake.ts`:

````ts
import { checkPlay } from './rules.ts';
import {
  PinError,
  SubmitError,
  type NewPlay,
  type Play,
  type PresenceHandle,
  type PresenceState,
  type Round,
  type RoundConfig,
  type RoundsApi,
  type Unsubscribe,
} from './types.ts';

/** In-memory backend with the same rules as the database. Listeners fire synchronously. */
export class FakeRoundsApi implements RoundsApi {
  rounds: Round[] = [];
  plays: Play[] = [];
  /** Set to make submitPlay fail with 'network' (simulates Wi-Fi loss). */
  offline = false;
  private presence = new Map<string, PresenceState>();
  private roundListeners = new Set<(r: Round[]) => void>();
  private playListeners = new Set<{ roundId: number; cb: (p: Play[]) => void }>();
  private presenceListeners = new Set<(p: PresenceState[]) => void>();
  private clock = 0;
  private readonly pin: string;

  constructor(pin = '1234') {
    this.pin = pin;
  }

  private now() {
    return new Date(Date.UTC(2026, 10, 12, 9, 0, this.clock++)).toISOString();
  }
  private emitRounds() {
    for (const cb of this.roundListeners) cb(this.rounds.map((r) => ({ ...r })));
  }
  private emitPlays() {
    for (const { roundId, cb } of this.playListeners) cb(this.plays.filter((p) => p.roundId === roundId).map((p) => ({ ...p })));
  }
  private emitPresence() {
    for (const cb of this.presenceListeners) cb([...this.presence.values()]);
  }
  private requirePin(pin: string) {
    if (pin !== this.pin) throw new PinError();
  }

  onRounds(cb: (r: Round[]) => void): Unsubscribe {
    this.roundListeners.add(cb);
    cb(this.rounds.map((r) => ({ ...r })));
    return () => this.roundListeners.delete(cb);
  }

  onPlays(roundId: number, cb: (p: Play[]) => void): Unsubscribe {
    const entry = { roundId, cb };
    this.playListeners.add(entry);
    cb(this.plays.filter((p) => p.roundId === roundId).map((p) => ({ ...p })));
    return () => this.playListeners.delete(entry);
  }

  async submitPlay(play: NewPlay): Promise<void> {
    if (this.offline) throw new SubmitError('network');
    const error = checkPlay(this.rounds.find((r) => r.id === play.roundId), play, this.plays);
    if (error) throw new SubmitError(error);
    this.plays.push({ ...play, picks: [...play.picks], id: this.plays.length + 1, hidden: false, createdAt: this.now() });
    this.emitPlays();
  }

  joinPresence(me: PresenceState): PresenceHandle {
    this.presence.set(me.playerId, { ...me });
    this.emitPresence();
    return {
      update: (state) => {
        this.presence.set(state.playerId, { ...state });
        this.emitPresence();
      },
      leave: () => {
        this.presence.delete(me.playerId);
        this.emitPresence();
      },
    };
  }

  onPresence(cb: (p: PresenceState[]) => void): Unsubscribe {
    this.presenceListeners.add(cb);
    cb([...this.presence.values()]);
    return () => this.presenceListeners.delete(cb);
  }

  async checkPin(pin: string): Promise<boolean> {
    return pin === this.pin;
  }

  async openRound(pin: string, cfg: RoundConfig): Promise<Round> {
    this.requirePin(pin);
    const now = this.now();
    for (const r of this.rounds) if (r.status === 'open') Object.assign(r, { status: 'closed', closedAt: now });
    const round: Round = { ...cfg, id: this.rounds.length + 1, number: this.rounds.length + 1, status: 'open', openedAt: now, closedAt: null };
    this.rounds.push(round);
    this.emitRounds();
    return { ...round };
  }

  async closeRound(pin: string, roundId: number): Promise<void> {
    this.requirePin(pin);
    const r = this.rounds.find((x) => x.id === roundId);
    if (r && r.status === 'open') Object.assign(r, { status: 'closed', closedAt: this.now() });
    this.emitRounds();
  }

  async hidePlay(pin: string, playId: number): Promise<void> {
    this.requirePin(pin);
    const p = this.plays.find((x) => x.id === playId);
    if (p) p.hidden = true;
    this.emitPlays();
  }
}
````

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/net/fake.test.ts && npm run typecheck`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/net
git commit -m "feat(net): RoundsApi interface and in-memory fake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 4: Database schema, tested on local Postgres

All writes go through functions: `submit_play` (rule-checked), `open_round` / `close_round` / `hide_play` (PIN-checked), `check_pin`. The public (anon) key can only `select` rounds and plays. The test harness starts a throwaway Postgres, applies `schema.sql` twice (it must be re-runnable) and checks every rule as the `anon` role.

Requires `initdb`, `pg_ctl`, `psql` on PATH (`brew install postgresql`; Postgres 14+). If they are missing, report BLOCKED rather than skipping the check.

**Files:** Create `supabase/schema.sql`, `supabase/test/prelude.sql`, `supabase/test/checks.sql`, `supabase/test/run.sh`; modify `package.json` (script)

- [ ] **Step 1: Write the checks.** Create `supabase/test/prelude.sql`:

````sql
-- Minimal stand-ins for what a Supabase project already has, so schema.sql can be tested on plain Postgres.
create role anon nologin; create role authenticated nologin;
create schema extensions; grant usage on schema extensions to anon, authenticated;
create publication supabase_realtime;
grant usage on schema public to anon, authenticated;
-- Supabase default: broad grants to API roles (schema.sql must revoke them)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
````

Create `supabase/test/checks.sql`:

````sql
-- Behaviour checks for schema.sql, run as the public (anon) role. Any failed check aborts with an error.
\set ON_ERROR_STOP on
select set_presenter_pin('secret-pin');

-- expect_error(sql, message): run sql and require it to fail with exactly that message.
create function pg_temp.expect_error(stmt text, msg text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected error "%" from: %', msg, stmt using errcode = 'P0002';
exception
  when sqlstate 'P0002' then raise;
  when others then
    if sqlerrm not like msg then raise exception 'expected error "%", got "%" from: %', msg, sqlerrm, stmt; end if;
end $$;

-- expect(condition, label)
create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'check failed: %', label; end if;
end $$;

set role anon;

select pg_temp.expect_error('select * from presenter_secret', 'permission denied%');
select pg_temp.expect_error($q$insert into plays (round_id, preset_id, outbreak_id, budget, player_id, nickname, picks) values (1, 'g', 'o', 1, gen_random_uuid(), 'x', '{1}')$q$, 'permission denied%');
select pg_temp.expect_error($q$update rounds set status = 'open'$q$, 'permission denied%');
select pg_temp.expect_error($q$select set_presenter_pin('hacked-pin')$q$, 'permission denied%');

select pg_temp.expect(not check_pin('nope') and check_pin('secret-pin'), 'check_pin');
select pg_temp.expect_error($q$select open_round('nope', 'grid10', 'ob00', 3, 'auc')$q$, 'wrong_pin');

select open_round('secret-pin', 'grid10', 'ob00', 3, 'auc');
select open_round('secret-pin', 'grid10', 'ob01', 3, 'auc');
select pg_temp.expect((select array_agg(status order by number) from rounds) = '{closed,open}', 'opening a round closes the open one');
select pg_temp.expect((select array_agg(number order by id) from rounds) = '{1,2}', 'rounds are numbered in order');

select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000001', ' ada ', '{1,2,3}', true, false);
select pg_temp.expect((select nickname = 'ada' and used_predictions from plays where round_id = 2), 'valid play stored, nickname trimmed');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000001', 'ada', '{4,5,6}', true, false)$q$, 'duplicate');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 4, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3,4}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,1,2}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,null,2}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,-2,3}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob00', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', '  ', '{1,2,3}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(1, 'grid10', 'ob00', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3}', true, false)$q$, 'round_closed');

select pg_temp.expect_error($q$select close_round('nope', 2)$q$, 'wrong_pin');
select close_round('secret-pin', 2);
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3}', true, false)$q$, 'round_closed');

select pg_temp.expect_error($q$select hide_play('nope', 1)$q$, 'wrong_pin');
select hide_play('secret-pin', (select id from plays limit 1));
select pg_temp.expect((select bool_and(hidden) from plays), 'hide_play');
select pg_temp.expect((select count(*) = 1 from plays), 'exactly one play stored');

\echo 'All schema checks passed.'
````

Create `supabase/test/run.sh`:

````bash
#!/usr/bin/env bash
# Test supabase/schema.sql on a throwaway local Postgres (needs initdb/pg_ctl/psql, e.g. `brew install postgresql`).
# Usage: npm run test:sql
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="$(mktemp -d)"
port=54329
trap 'pg_ctl -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"' EXIT
initdb -D "$data" -U postgres -A trust >/dev/null
pg_ctl -D "$data" -o "-p $port -k '' -c wal_level=logical" -l "$data/log" -w start >/dev/null
psql=(psql -h 127.0.0.1 -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${psql[@]}" -f "$here/prelude.sql"
"${psql[@]}" -f "$here/../schema.sql" >/dev/null 2>&1   # applied twice: it must be re-runnable
"${psql[@]}" -f "$here/../schema.sql" 2>&1 | grep -v NOTICE || true
"${psql[@]}" -f "$here/checks.sql" >/dev/null
echo "All schema checks passed."
````

```bash
chmod +x supabase/test/run.sh
npm pkg set scripts.test:sql="supabase/test/run.sh"
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test:sql`
Expected: FAIL (`supabase/schema.sql` not found).

- [ ] **Step 3: Write the schema.** Create `supabase/schema.sql`:

````sql
-- Surveillance Game: multiplayer schema. Paste into the Supabase SQL editor and run (safe to re-run).
-- Then set the presenter PIN once:  select set_presenter_pin('your-pin');
-- After a dry run, start fresh with:  truncate rounds, plays restart identity;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  number int not null unique,
  preset_id text not null,
  outbreak_id text not null,
  budget int not null check (budget between 1 and 100),
  rank_metric text not null default 'auc' check (rank_metric in ('auc', 'lc_auc', 'accuracy')),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
-- At most one open round.
create unique index if not exists rounds_one_open on public.rounds ((true)) where status = 'open';

create table if not exists public.plays (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.rounds (id) on delete cascade,
  preset_id text not null,
  outbreak_id text not null,
  budget int not null,
  player_id uuid not null,
  nickname text not null,
  picks int[] not null,
  used_predictions boolean not null default false,
  used_uncertainty boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

-- Hashed presenter PIN; no policies, so the public (anon) key can never read it.
create table if not exists public.presenter_secret (
  id int primary key default 1 check (id = 1),
  pin_hash text not null
);

-- The public key may only read rounds and plays. All writes go through the functions below.
alter table public.rounds enable row level security;
alter table public.plays enable row level security;
alter table public.presenter_secret enable row level security;
revoke all on public.rounds, public.plays, public.presenter_secret from anon, authenticated;
grant select on public.rounds, public.plays to anon, authenticated;
drop policy if exists "rounds are public" on public.rounds;
create policy "rounds are public" on public.rounds for select to anon, authenticated using (true);
drop policy if exists "plays are public" on public.plays;
create policy "plays are public" on public.plays for select to anon, authenticated using (true);

create or replace function public.pin_ok(pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from presenter_secret where pin_hash = crypt(pin, pin_hash));
$$;

create or replace function public.require_pin(pin text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not pin_ok(pin) then raise exception 'wrong_pin'; end if;
end $$;

create or replace function public.check_pin(pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select pin_ok(pin);
$$;

create or replace function public.set_presenter_pin(new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(new_pin, '')) < 6 then raise exception 'PIN must be at least 6 characters'; end if;
  insert into presenter_secret (id, pin_hash) values (1, crypt(new_pin, gen_salt('bf')))
  on conflict (id) do update set pin_hash = excluded.pin_hash;
end $$;

create or replace function public.open_round(pin text, p_preset_id text, p_outbreak_id text, p_budget int, p_rank_metric text)
returns public.rounds
language plpgsql security definer set search_path = public, extensions as $$
declare r rounds;
begin
  perform require_pin(pin);
  update rounds set status = 'closed', closed_at = now() where status = 'open';
  insert into rounds (number, preset_id, outbreak_id, budget, rank_metric)
  values ((select coalesce(max(number), 0) + 1 from rounds), p_preset_id, p_outbreak_id, p_budget, p_rank_metric)
  returning * into r;
  return r;
end $$;

create or replace function public.close_round(pin text, p_round_id bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(pin);
  update rounds set status = 'closed', closed_at = now() where id = p_round_id and status = 'open';
end $$;

create or replace function public.hide_play(pin text, p_play_id bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(pin);
  update plays set hidden = true where id = p_play_id;
end $$;

-- A finished round game. Errors (matched by the app): round_closed, invalid, duplicate.
create or replace function public.submit_play(
  p_round_id bigint, p_preset_id text, p_outbreak_id text, p_budget int, p_player_id uuid,
  p_nickname text, p_picks int[], p_used_predictions boolean, p_used_uncertainty boolean
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r rounds;
begin
  -- Lock the round row so a concurrent close_round can't slip in between the check and the insert.
  select * into r from rounds where id = p_round_id for share;
  if not found or r.status <> 'open' then raise exception 'round_closed'; end if;
  if p_preset_id is distinct from r.preset_id or p_outbreak_id is distinct from r.outbreak_id or p_budget is distinct from r.budget
     or coalesce(cardinality(p_picks), 0) <> r.budget
     or (select count(distinct x) from unnest(p_picks) as x where x >= 0) <> r.budget
     or char_length(btrim(coalesce(p_nickname, ''))) not between 1 and 24
  then
    raise exception 'invalid';
  end if;
  insert into plays (round_id, preset_id, outbreak_id, budget, player_id, nickname, picks, used_predictions, used_uncertainty)
  values (p_round_id, p_preset_id, p_outbreak_id, p_budget, p_player_id, btrim(p_nickname), p_picks,
          coalesce(p_used_predictions, false), coalesce(p_used_uncertainty, false));
exception when unique_violation then
  raise exception 'duplicate';
end $$;

revoke all on function public.pin_ok(text), public.require_pin(text), public.set_presenter_pin(text) from public, anon, authenticated;
revoke all on function public.check_pin(text), public.open_round(text, text, text, int, text), public.close_round(text, bigint),
  public.hide_play(text, bigint), public.submit_play(bigint, text, text, int, uuid, text, int[], boolean, boolean) from public;
grant execute on function public.check_pin(text), public.open_round(text, text, text, int, text), public.close_round(text, bigint),
  public.hide_play(text, bigint), public.submit_play(bigint, text, text, int, uuid, text, int[], boolean, boolean) to anon, authenticated;

-- Live updates for the app.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rounds') then
    alter publication supabase_realtime add table public.rounds;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plays') then
    alter publication supabase_realtime add table public.plays;
  end if;
end $$;
````

- [ ] **Step 4: Run the checks**

Run: `npm run test:sql`
Expected: `All schema checks passed.`

Prove the checks can fail: temporarily change the expected message `'duplicate'` (the `{4,5,6}` line in `checks.sql`) to `'invalid'`, rerun, and confirm it stops with `expected error "invalid", got "duplicate"`. Revert.

- [ ] **Step 5: Commit**

```bash
git add supabase package.json
git commit -m "feat(db): Supabase schema with rule-checked submissions and PIN-checked presenter functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 5: Supabase client

Not testable against a live project yet (the smoke test in Task 12 covers that); here we unit-test the error mapping and type-check the rest.

**Files:** Create `src/app/net/supabase.ts`, `src/app/net/supabase.test.ts`, `src/app/net/config.ts`; replace `src/app/vite-env.d.ts`; modify `package.json`, `package-lock.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install @supabase/supabase-js@^2.118.0 qrcode@^1.5.4
npm install -D @types/qrcode
```

- [ ] **Step 2: Write the failing test.** Create `src/app/net/supabase.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { submitErrorKind } from './supabase.ts';

describe('submitErrorKind', () => {
  it('maps database exceptions, server faults and lost connections', () => {
    expect(submitErrorKind({ status: 400, error: { message: 'duplicate', code: 'P0001' } })).toBe('duplicate');
    expect(submitErrorKind({ status: 400, error: { message: 'round_closed', code: 'P0001' } })).toBe('round_closed');
    expect(submitErrorKind({ status: 400, error: { message: 'invalid', code: 'P0001' } })).toBe('invalid');
    expect(submitErrorKind({ status: 404, error: { message: 'Could not find the function', code: 'PGRST202' } })).toBe('invalid');
    expect(submitErrorKind({ status: 503, error: { message: 'upstream', code: '' } })).toBe('network');
    expect(submitErrorKind({ status: 0, error: { message: 'TypeError: fetch failed', code: '' } })).toBe('network');
  });
});
````

Run: `npx vitest run src/app/net/supabase.test.ts`
Expected: FAIL (cannot resolve `./supabase.ts`).

- [ ] **Step 3: Implement.** Create `src/app/net/supabase.ts`:

````ts
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import {
  PinError,
  SubmitError,
  type NewPlay,
  type Play,
  type PresenceHandle,
  type PresenceState,
  type Round,
  type RoundConfig,
  type RoundsApi,
  type SubmitErrorKind,
  type Unsubscribe,
} from './types.ts';

interface RoundRow {
  id: number;
  number: number;
  preset_id: string;
  outbreak_id: string;
  budget: number;
  rank_metric: Round['rankMetric'];
  status: Round['status'];
  opened_at: string;
  closed_at: string | null;
}

interface PlayRow {
  id: number;
  round_id: number;
  preset_id: string;
  outbreak_id: string;
  budget: number;
  player_id: string;
  nickname: string;
  picks: number[];
  used_predictions: boolean;
  used_uncertainty: boolean;
  hidden: boolean;
  created_at: string;
}

const toRound = (r: RoundRow): Round => ({
  id: r.id,
  number: r.number,
  presetId: r.preset_id,
  outbreakId: r.outbreak_id,
  budget: r.budget,
  rankMetric: r.rank_metric,
  status: r.status,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
});

const toPlay = (p: PlayRow): Play => ({
  id: p.id,
  roundId: p.round_id,
  presetId: p.preset_id,
  outbreakId: p.outbreak_id,
  budget: p.budget,
  playerId: p.player_id,
  nickname: p.nickname,
  picks: p.picks,
  usedPredictions: p.used_predictions,
  usedUncertainty: p.used_uncertainty,
  hidden: p.hidden,
  createdAt: p.created_at,
});

interface RpcResult {
  error: { message: string; code: string } | null;
  status: number;
}

/** Map an RPC failure to a submit error: our own exceptions by name, server faults and no response as network. */
export function submitErrorKind(res: RpcResult): SubmitErrorKind {
  const known: SubmitErrorKind[] = ['round_closed', 'duplicate', 'invalid'];
  const message = res.error?.message ?? '';
  if ((known as string[]).includes(message)) return message as SubmitErrorKind;
  return res.status === 0 || res.status >= 500 ? 'network' : 'invalid';
}

function throwIfPinError(res: RpcResult): void {
  if (!res.error) return;
  if (res.error.message === 'wrong_pin') throw new PinError();
  throw new Error(res.error.message);
}

let channelCount = 0;
const channelName = (base: string) => `${base}-${++channelCount}-${Math.random().toString(36).slice(2, 8)}`;

/** Live data via Supabase. Every subscription reloads the full list on each change and on (re)connect. */
export class SupabaseRoundsApi implements RoundsApi {
  private presenceChannel: RealtimeChannel | null = null;
  private me: PresenceState | null = null;
  private presenceListeners = new Set<(p: PresenceState[]) => void>();
  private readonly sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: false } });
  }

  /** Load once, then reload on every change; a sequence number drops stale responses. */
  private live<T>(table: 'rounds' | 'plays', filter: string | undefined, load: () => PromiseLike<T[] | null>, cb: (rows: T[]) => void): Unsubscribe {
    let seq = 0;
    const reload = async () => {
      const mine = ++seq;
      const rows = await load();
      if (rows && mine === seq) cb(rows);
    };
    const channel = this.sb
      .channel(channelName(table))
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => void reload())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void reload();
      });
    return () => void this.sb.removeChannel(channel);
  }

  onRounds(cb: (rounds: Round[]) => void): Unsubscribe {
    return this.live<Round>(
      'rounds',
      undefined,
      async () => {
        const { data, error } = await this.sb.from('rounds').select('*').order('number');
        return error ? null : (data as RoundRow[]).map(toRound);
      },
      cb,
    );
  }

  onPlays(roundId: number, cb: (plays: Play[]) => void): Unsubscribe {
    return this.live<Play>(
      'plays',
      `round_id=eq.${roundId}`,
      async () => {
        const { data, error } = await this.sb.from('plays').select('*').eq('round_id', roundId).order('id');
        return error ? null : (data as PlayRow[]).map(toPlay);
      },
      cb,
    );
  }

  async submitPlay(play: NewPlay): Promise<void> {
    const res = await this.sb.rpc('submit_play', {
      p_round_id: play.roundId,
      p_preset_id: play.presetId,
      p_outbreak_id: play.outbreakId,
      p_budget: play.budget,
      p_player_id: play.playerId,
      p_nickname: play.nickname,
      p_picks: play.picks,
      p_used_predictions: play.usedPredictions,
      p_used_uncertainty: play.usedUncertainty,
    });
    if (res.error) throw new SubmitError(submitErrorKind(res), res.error.message);
  }

  private channel(): RealtimeChannel {
    if (this.presenceChannel) return this.presenceChannel;
    const channel = this.sb.channel('players', { config: { presence: { key: channelName('p'), enabled: true } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceState>();
      const players = Object.values(state)
        .map((metas) => metas[0])
        .filter((m) => m !== undefined)
        .map(({ playerId, nickname, status, roundId }) => ({ playerId, nickname, status, roundId }));
      for (const cb of this.presenceListeners) cb(players);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && this.me) void channel.track(this.me);
    });
    this.presenceChannel = channel;
    return channel;
  }

  joinPresence(me: PresenceState): PresenceHandle {
    this.me = me;
    const channel = this.channel();
    void channel.track(me);
    return {
      update: (state) => {
        this.me = state;
        void channel.track(state);
      },
      leave: () => {
        this.me = null;
        void channel.untrack();
      },
    };
  }

  onPresence(cb: (players: PresenceState[]) => void): Unsubscribe {
    this.presenceListeners.add(cb);
    this.channel();
    return () => this.presenceListeners.delete(cb);
  }

  async checkPin(pin: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc('check_pin', { pin });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async openRound(pin: string, cfg: RoundConfig): Promise<Round> {
    const res = await this.sb.rpc('open_round', {
      pin,
      p_preset_id: cfg.presetId,
      p_outbreak_id: cfg.outbreakId,
      p_budget: cfg.budget,
      p_rank_metric: cfg.rankMetric,
    });
    throwIfPinError(res);
    return toRound(res.data as RoundRow);
  }

  async closeRound(pin: string, roundId: number): Promise<void> {
    throwIfPinError(await this.sb.rpc('close_round', { pin, p_round_id: roundId }));
  }

  async hidePlay(pin: string, playId: number): Promise<void> {
    throwIfPinError(await this.sb.rpc('hide_play', { pin, p_play_id: playId }));
  }
}
````

Create `src/app/net/config.ts`:

````ts
import { SupabaseRoundsApi } from './supabase.ts';
import type { RoundsApi } from './types.ts';

/** The live backend if the build has Supabase settings; null means single-player only. */
export function createRoundsApi(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string } = import.meta.env): RoundsApi | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? new SupabaseRoundsApi(url, key) : null;
}
````

Replace the whole of `src/app/vite-env.d.ts`:

````ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
````

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/app/net && npm run typecheck`
Expected: 5 tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/net src/app/vite-env.d.ts
git commit -m "feat(net): Supabase implementation of RoundsApi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 6: Scoring, ranking and replay frames (pure)

**Files:** Create `src/app/board/ranking.ts`, `ranking.test.ts`, `frames.ts`, `frames.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/app/board/ranking.test.ts`:

````ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel } from '../../core/presets.ts';
import type { Play } from '../net/types.ts';
import { displayNames, firstPickCounts, formatMetric, medianCurve, metricValue, rankBy, scorePlays } from './ranking.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const model = presetModel(preset);
const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode);

let id = 0;
const play = (nickname: string, picks: number[], over: Partial<Play> = {}): Play => ({
  id: ++id, roundId: 1, presetId: preset.id, outbreakId: outbreak.id, budget: picks.length, playerId: `p${id}`, nickname, picks,
  usedPredictions: false, usedUncertainty: false, hidden: false, createdAt: '', ...over,
});

describe('rankBy', () => {
  it('ranks best first, shares ranks for ties at 3 dp and puts missing values last', () => {
    const items = [{ v: 0.9 }, { v: null }, { v: 0.95 }, { v: 0.9001 }, { v: 0.8 }];
    expect(rankBy(items, (x) => x.v).map(({ item, rank }) => [item.v, rank])).toEqual([[0.95, 1], [0.9001, 2], [0.9, 2], [0.8, 4], [null, null]]);
  });
});

describe('displayNames', () => {
  it('suffixes repeated nicknames in submission order, ignoring case and spaces', () => {
    const plays = [play('ada', [0]), play('Bob', [0]), play(' ada', [0]), play('ADA', [0])];
    expect([...displayNames(plays).values()]).toEqual(['ada', 'Bob', 'ada (2)', 'ADA (3)']);
  });
});

describe('scorePlays', () => {
  it('replays picks into scores and drops hidden and invalid plays', () => {
    const good = play('ada', others.slice(0, 3));
    const hidden = play('bob', others.slice(0, 3), { hidden: true });
    const seed = play('cy', [outbreak.seedNode, others[0], others[1]]);
    const scored = scorePlays(model, outbreak, [good, hidden, seed]);
    expect(scored.map((s) => s.name)).toEqual(['ada']);
    expect(scored[0].curve).toHaveLength(4);
    expect(scored[0].auc).toBe(scored[0].curve[3]);
    expect(metricValue(scored[0], 'lc_auc')).toBe(scored[0].aucArea);
  });
});

describe('helpers', () => {
  it('medianCurve takes the per-step median and skips nulls', () => {
    expect(medianCurve([[0.5, 0.6, null], [0.7, 0.8, 0.9], [0.6, null, 0.7]])).toEqual([0.6, 0.7, 0.8]);
  });
  it('firstPickCounts counts visible first picks', () => {
    const counts = firstPickCounts([play('a', [3, 4]), play('b', [3]), play('c', [5]), play('d', [3], { hidden: true })], 10);
    expect(counts[3]).toBe(2);
    expect(counts[5]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it('formatMetric shows accuracy as a percentage', () => {
    expect(formatMetric(0.8123, 'auc')).toBe('0.812');
    expect(formatMetric(0.8123, 'accuracy')).toBe('81%');
    expect(formatMetric(null, 'auc')).toBe('–');
  });
});
````

Create `src/app/board/frames.test.ts`:

````ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel, scenarioFor } from '../../core/presets.ts';
import { replay } from '../../core/replay.ts';
import { replayFrames } from './frames.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const model = presetModel(preset);
const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;

describe('replayFrames', () => {
  it('has one frame per step whose AUC matches the scored trajectory', () => {
    const infected = outbreak.truth.findIndex((y, j) => y === 1 && j !== outbreak.seedNode);
    const picks = [infected, ...Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode && j !== infected).slice(0, 4)];
    const frames = replayFrames(model, outbreak, picks);
    const tr = replay(scenarioFor(model, outbreak), picks);
    expect(frames).toHaveLength(picks.length + 1);
    expect(frames.map((f) => f.auc)).toEqual(tr.auc);
    expect(frames[2].tested.size).toBe(3);
    expect(frames[0].commentary).toMatch(/^Start: only the starting location \d+ is tested/);
    expect(frames[1].commentary).toMatch(/^Test 1: location \d+, infected · /);
    expect(frames[2].commentary).toMatch(/hops from the nearest known infection|next to a known infection/);
    for (const f of frames) for (const node of f.tested.keys()) expect(f.uncertainty[node]).toBe(0);
  });
});
````

Run: `npx vitest run src/app/board`
Expected: FAIL (modules missing).

- [ ] **Step 2: Implement.** Create `src/app/board/ranking.ts`:

````ts
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import type { Play, RankMetric } from '../net/types.ts';
import { isValidFor, scoreSession, type Session } from '../session.ts';

export interface Scores {
  auc: number | null;
  aucArea: number | null;
  accuracy: number | null;
}

export interface PlayerScore extends Scores {
  play: Play;
  /** Display name, with " (2)" etc. when several players share a nickname. */
  name: string;
  /** AUC after each test (index 0 = seed only). */
  curve: (number | null)[];
}

export const METRIC_LABEL: Record<RankMetric, string> = { auc: 'AUC', lc_auc: 'Learning-curve AUC', accuracy: 'Accuracy' };

export function metricValue(s: Scores, metric: RankMetric): number | null {
  return metric === 'auc' ? s.auc : metric === 'lc_auc' ? s.aucArea : s.accuracy;
}

export function formatMetric(v: number | null, metric: RankMetric): string {
  if (v === null) return '–';
  return metric === 'accuracy' ? `${(100 * v).toFixed(0)}%` : v.toFixed(3);
}

/** Nicknames made unique for display, in submission order: "ada", "ada (2)", … (case-insensitive). */
export function displayNames(plays: Play[]): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const p of [...plays].sort((a, b) => a.id - b.id)) {
    const key = p.nickname.trim().toLowerCase();
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    out.set(p.id, k === 1 ? p.nickname.trim() : `${p.nickname.trim()} (${k})`);
  }
  return out;
}

export function playSession(play: Play, outbreak: Outbreak): Session {
  return {
    presetId: play.presetId,
    outbreakId: play.outbreakId,
    budget: play.budget,
    seedNode: outbreak.seedNode,
    picks: play.picks,
    usedPredictions: play.usedPredictions,
    usedUncertainty: play.usedUncertainty,
    roundId: play.roundId,
  };
}

/** Score every visible play by replaying its picks. Plays that don't fit the outbreak (e.g. testing the seed) are dropped. */
export function scorePlays(model: PresetModel, outbreak: Outbreak, plays: Play[]): PlayerScore[] {
  const names = displayNames(plays);
  const out: PlayerScore[] = [];
  for (const play of plays) {
    if (play.hidden) continue;
    const session = playSession(play, outbreak);
    if (!isValidFor(session, model.preset, outbreak) || play.picks.length !== play.budget) continue;
    const s = scoreSession(model, outbreak, session);
    out.push({ play, name: names.get(play.id)!, auc: s.auc, aucArea: s.aucArea, accuracy: s.accuracy, curve: s.trajectory.auc });
  }
  return out;
}

const r3 = (v: number) => Math.round(v * 1000);

/**
 * Sort best-first by `value` and assign competition ranks (1, 2, 2, 4) with ties at the 3 decimals shown.
 * Items without a value come last with rank null.
 */
export function rankBy<T>(items: T[], value: (t: T) => number | null): { item: T; rank: number | null }[] {
  const defined = items.filter((t) => value(t) !== null).sort((a, b) => value(b)! - value(a)!);
  const ranked = defined.map((item, k) => ({ item, k }));
  const out: { item: T; rank: number | null }[] = [];
  for (const { item, k } of ranked) {
    const prev = out[k - 1];
    const tie = prev && r3(value(prev.item)!) === r3(value(item)!);
    out.push({ item, rank: tie ? prev.rank : k + 1 });
  }
  return [...out, ...items.filter((t) => value(t) === null).map((item) => ({ item, rank: null }))];
}

/** Per-step median of the curves (null where no curve is defined). */
export function medianCurve(curves: (number | null)[][]): (number | null)[] {
  const steps = Math.max(0, ...curves.map((c) => c.length));
  return Array.from({ length: steps }, (_, t) => {
    const v = curves.map((c) => c[t]).filter((x): x is number => x !== null && x !== undefined).sort((a, b) => a - b);
    if (v.length === 0) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
  });
}

/** How many players tested each node first. */
export function firstPickCounts(plays: Play[], n: number): number[] {
  const counts = new Array<number>(n).fill(0);
  for (const p of plays) if (!p.hidden && p.picks.length > 0 && p.picks[0] >= 0 && p.picks[0] < n) counts[p.picks[0]]++;
  return counts;
}
````

Create `src/app/board/frames.ts`:

````ts
import { probabilityStd } from '../../core/entropy.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { fitLaplace } from '../../core/surrogate.ts';
import { auc } from '../../core/metrics.ts';
import { unobservedNodes } from '../../core/policies.ts';
import { relativeScale } from '../scales.ts';

/** The model's state after `t` tests of a replayed game. */
export interface Frame {
  t: number;
  tested: Map<number, 0 | 1>;
  p: Float64Array;
  /** Relative uncertainty (posterior SD of P(infected), min–max scaled over untested nodes). */
  uncertainty: Float64Array;
  auc: number | null;
  commentary: string;
}

const status = (y: 0 | 1) => (y === 1 ? 'infected' : 'clear');
const fmt = (v: number | null) => (v === null ? '–' : v.toFixed(2));

/** Frames 0..picks.length for stepping through a game (≤ 31 Laplace fits, a few ms). */
export function replayFrames(model: PresetModel, outbreak: Outbreak, picks: number[]): Frame[] {
  const { graph, K } = model;
  const { truth, seedNode } = outbreak;
  const frames: Frame[] = [];
  const nodes = [seedNode, ...picks];
  for (let t = 0; t <= picks.length; t++) {
    const obs = nodes.slice(0, t + 1).map((node) => ({ node, y: truth[node] }));
    const post = fitLaplace(K, graph.n, obs);
    const untested = unobservedNodes(graph.n, obs);
    const sd = Float64Array.from(post.mean, (mu, j) => probabilityStd(mu, post.variance[j]));
    const a = auc(post.p, truth, untested);
    let commentary: string;
    if (t === 0) {
      commentary = `Start: only the starting location ${seedNode} is tested (${status(truth[seedNode])}).`;
    } else {
      const node = picks[t - 1];
      const known = nodes.slice(0, t).filter((j) => truth[j] === 1);
      const hops = known.length === 0 ? null : Math.min(...known.map((j) => graph.dist[j * graph.n + node]));
      const where = hops === null ? 'no infection found yet' : hops === 1 ? 'next to a known infection' : `${hops} hops from the nearest known infection`;
      commentary = `Test ${t}: location ${node}, ${status(truth[node])} · ${where} · AUC ${fmt(frames[t - 1].auc)} → ${fmt(a)}`;
    }
    frames.push({ t, tested: new Map(obs.map((o) => [o.node, o.y])), p: post.p, uncertainty: relativeScale(sd, untested), auc: a, commentary });
  }
  return frames;
}
````

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/app/board && npm run typecheck`
Expected: 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/board
git commit -m "feat(board): scoring, ranking with ties, replay frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 7: Player flow (pure)

Which screen a player sees, when they auto-join a round, what presence status they report, and how a submission moves between `pending`, `sent` and `rejected`.

**Files:** Create `src/app/player/flow.ts`, `src/app/player/flow.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/app/player/flow.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import type { Round } from '../net/types.ts';
import type { Session } from '../session.ts';
import { afterSubmit, joinableRound, newSubmission, playerView, presenceStatus, retryDelay, shouldAutoJoin } from './flow.ts';

const round = (id: number, status: Round['status'] = 'open'): Round => ({
  id, number: id, presetId: 'grid10', outbreakId: 'ob00', budget: 2, rankMetric: 'auc', status, openedAt: '', closedAt: null,
});
const session = (picks: number[], roundId: number | null): Session => ({
  presetId: 'grid10', outbreakId: 'ob00', budget: 2, seedNode: 0, picks, usedPredictions: true, usedUncertainty: false, roundId,
});

describe('playerView', () => {
  const open2 = [round(1, 'closed'), round(2)];
  it('lobby offers the open round unless already joined', () => {
    expect(playerView(null, open2, null)).toEqual({ kind: 'start', round: open2[1] });
    expect(playerView(null, open2, 2)).toEqual({ kind: 'start', round: null });
    expect(playerView(null, null, null)).toEqual({ kind: 'start', round: null });
  });
  it('practice games show a banner for a joinable round', () => {
    expect(playerView(session([5], null), open2, null)).toEqual({ kind: 'play', round: null, banner: open2[1] });
    expect(playerView(session([5, 6], null), [round(1, 'closed')], null)).toEqual({ kind: 'practice-results', banner: null });
  });
  it('round games: play while open, missed if closed unfinished, results once finished', () => {
    expect(playerView(session([5], 2), open2, 2)).toEqual({ kind: 'play', round: open2[1], banner: null });
    expect(playerView(session([5], 1), open2, 1).kind).toBe('round-missed');
    expect(playerView(session([5, 6], 2), open2, 2)).toEqual({ kind: 'round-results', round: open2[1] });
    expect(playerView(session([5, 6], 1), open2, 1)).toEqual({ kind: 'round-results', round: open2[0] });
    expect(playerView(session([5], 9), open2, 9)).toEqual({ kind: 'stale' });
    expect(playerView(session([5], 2), null, 2)).toEqual({ kind: 'play', round: null, banner: null });
  });
});

describe('shouldAutoJoin', () => {
  const r = round(3);
  it('joins from the lobby or after a finished practice game, never mid-game or without a name', () => {
    expect(shouldAutoJoin(null, r, 'ada')).toBe(true);
    expect(shouldAutoJoin(null, r, '  ')).toBe(false);
    expect(shouldAutoJoin(session([1, 2], null), r, 'ada')).toBe(true);
    expect(shouldAutoJoin(session([1], null), r, 'ada')).toBe(false);
    expect(shouldAutoJoin(session([1, 2], 1), r, 'ada')).toBe(false);
    expect(shouldAutoJoin(null, null, 'ada')).toBe(false);
    expect(joinableRound([r], 3)).toBeNull();
  });
});

describe('submission', () => {
  it('builds the play from a finished round game', () => {
    const sub = newSubmission(session([5, 6], 2), 'p1', ' ada ');
    expect(sub).toEqual({ state: 'pending', play: { roundId: 2, presetId: 'grid10', outbreakId: 'ob00', budget: 2, playerId: 'p1', nickname: 'ada', picks: [5, 6], usedPredictions: true, usedUncertainty: false } });
    expect(() => newSubmission(session([5], 2), 'p1', 'ada')).toThrow();
    expect(() => newSubmission(session([5, 6], null), 'p1', 'ada')).toThrow();
  });
  it('treats duplicate as delivered, keeps network failures pending, and rejects the rest', () => {
    const sub = newSubmission(session([5, 6], 2), 'p1', 'ada');
    expect(afterSubmit(sub, null).state).toBe('sent');
    expect(afterSubmit(sub, 'duplicate').state).toBe('sent');
    expect(afterSubmit(sub, 'network')).toBe(sub);
    expect(afterSubmit(sub, 'round_closed')).toMatchObject({ state: 'rejected', reason: 'round_closed' });
  });
  it('backs off exponentially up to 15 s', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
});

describe('presenceStatus', () => {
  it('reports lobby, free play, playing and finished', () => {
    expect(presenceStatus(null)).toEqual({ status: 'lobby', roundId: null });
    expect(presenceStatus(session([1], null))).toEqual({ status: 'free', roundId: null });
    expect(presenceStatus(session([1], 4))).toEqual({ status: 'playing', roundId: 4 });
    expect(presenceStatus(session([1, 2], 4))).toEqual({ status: 'finished', roundId: 4 });
  });
});
````

Run: `npx vitest run src/app/player`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement.** Create `src/app/player/flow.ts`:

````ts
import { openRound, type NewPlay, type PresenceStatus, type Round, type SubmitErrorKind } from '../net/types.ts';
import { isFinished, type Session } from '../session.ts';

/** What the player's screen shows, derived from their game and the live rounds (null = not loaded yet). */
export type PlayerView =
  | { kind: 'start'; round: Round | null }
  | { kind: 'play'; round: Round | null; banner: Round | null }
  | { kind: 'practice-results'; banner: Round | null }
  | { kind: 'round-results'; round: Round }
  | { kind: 'round-missed'; round: Round }
  /** The stored game's round no longer exists (e.g. the database was reset): drop the game. */
  | { kind: 'stale' };

/** The open round, unless this player has already joined it. */
export function joinableRound(rounds: Round[] | null, lastJoined: number | null): Round | null {
  const open = rounds ? openRound(rounds) : null;
  return open && open.id !== lastJoined ? open : null;
}

export function playerView(session: Session | null, rounds: Round[] | null, lastJoined: number | null): PlayerView {
  const joinable = joinableRound(rounds, lastJoined);
  if (!session) return { kind: 'start', round: joinable };
  if (session.roundId === null) {
    return isFinished(session) ? { kind: 'practice-results', banner: joinable } : { kind: 'play', round: null, banner: joinable };
  }
  // Rounds not loaded yet: show the board as it was; results wait for the round's status.
  if (rounds === null) return { kind: 'play', round: null, banner: null };
  const round = rounds.find((r) => r.id === session.roundId);
  if (!round) return { kind: 'stale' };
  if (isFinished(session)) return { kind: 'round-results', round };
  return round.status === 'open' ? { kind: 'play', round, banner: null } : { kind: 'round-missed', round };
}

/**
 * Join the open round straight away when the player is in the lobby (has a nickname and no game in progress)
 * or has just finished a practice game.
 */
export function shouldAutoJoin(session: Session | null, joinable: Round | null, nickname: string): boolean {
  if (!joinable || nickname.trim() === '') return false;
  return session === null || (session.roundId === null && isFinished(session));
}

export function presenceStatus(session: Session | null): { status: PresenceStatus; roundId: number | null } {
  if (!session) return { status: 'lobby', roundId: null };
  if (session.roundId === null) return { status: 'free', roundId: null };
  return { status: isFinished(session) ? 'finished' : 'playing', roundId: session.roundId };
}

/** A finished round game waiting to reach (or already at) the server. Kept in localStorage across reloads. */
export interface Submission {
  play: NewPlay;
  state: 'pending' | 'sent' | 'rejected';
  reason?: SubmitErrorKind;
}

export function newSubmission(session: Session, playerId: string, nickname: string): Submission {
  if (session.roundId === null || !isFinished(session)) throw new Error('newSubmission: needs a finished round game');
  return {
    state: 'pending',
    play: {
      roundId: session.roundId,
      presetId: session.presetId,
      outbreakId: session.outbreakId,
      budget: session.budget,
      playerId,
      nickname: nickname.trim(),
      picks: session.picks,
      usedPredictions: session.usedPredictions,
      usedUncertainty: session.usedUncertainty,
    },
  };
}

/** Outcome of one submit attempt. 'duplicate' means the server already has this play (an earlier retry got through). */
export function afterSubmit(sub: Submission, error: SubmitErrorKind | null): Submission {
  if (error === null || error === 'duplicate') return { ...sub, state: 'sent', reason: undefined };
  if (error === 'network') return sub;
  return { ...sub, state: 'rejected', reason: error };
}

/** Retry delay after `failures` consecutive network failures: 1 s, 2 s, 4 s … capped at 15 s. */
export const retryDelay = (failures: number): number => Math.min(15_000, 1000 * 2 ** Math.max(0, failures - 1));
````

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/app/player && npm run typecheck`
Expected: 8 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/player
git commit -m "feat(player): pure round flow and submission state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 8: Storage and React hooks

**Files:** Replace `src/app/storage.ts`; create `src/app/player/hooks.ts`, `src/app/net/hooks.ts`

These are exercised by the integration tests in Tasks 9 and 11; this task only needs to type-check.

- [ ] **Step 1: Implement.** Replace the whole of `src/app/storage.ts`:

````ts
import type { Submission } from './player/flow.ts';
import { deserializeSession, serializeSession, type Session } from './session.ts';

const KEYS = {
  nickname: 'sg.nickname',
  session: 'sg.session',
  lastOutbreak: 'sg.lastOutbreak',
  playerId: 'sg.playerId',
  lastRound: 'sg.lastRound',
  submission: 'sg.submission',
};

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

/** A random ID for this browser, so players need no account and nicknames needn't be unique. */
export function loadPlayerId(): string {
  const existing = read(KEYS.playerId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(KEYS.playerId, id);
  return id;
}

/** The last round this browser joined, so a player is never put into the same round twice. */
export function loadLastRound(): number | null {
  const v = Number(read(KEYS.lastRound));
  return read(KEYS.lastRound) !== null && Number.isInteger(v) ? v : null;
}
export const saveLastRound = (id: number): void => write(KEYS.lastRound, String(id));

export function loadSubmission(): Submission | null {
  try {
    const s = JSON.parse(read(KEYS.submission) ?? 'null') as Submission | null;
    return s && typeof s.state === 'string' && s.play && Array.isArray(s.play.picks) ? s : null;
  } catch {
    return null;
  }
}
export const saveSubmission = (s: Submission | null): void => write(KEYS.submission, s === null ? null : JSON.stringify(s));
````

Create `src/app/player/hooks.ts`:

````ts
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { SubmitError, type PresenceHandle, type RoundsApi, type SubmitErrorKind } from '../net/types.ts';
import type { Session } from '../session.ts';
import { afterSubmit, presenceStatus, retryDelay, type Submission } from './flow.ts';

/** Send a pending submission, retrying network failures with backoff. Returns the current failure streak. */
export function useSubmitter(api: RoundsApi | null, submission: Submission | null, setSubmission: Dispatch<SetStateAction<Submission | null>>): number {
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    if (!api || !submission || submission.state !== 'pending') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let error: SubmitErrorKind | null = null;
      try {
        await api.submitPlay(submission.play);
      } catch (e) {
        error = e instanceof SubmitError ? e.kind : 'network';
      }
      if (cancelled) return;
      if (error === 'network') {
        setFailures((f) => f + 1);
        return;
      }
      setFailures(0);
      setSubmission((s) => (s && s.state === 'pending' && s.play.roundId === submission.play.roundId ? afterSubmit(s, error) : s));
    }, failures === 0 ? 0 : retryDelay(failures));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, submission, failures, setSubmission]);
  return failures;
}

/** Announce this player (nickname and game status) to the board while the page is open. */
export function usePresence(api: RoundsApi | null, playerId: string, nickname: string, session: Session | null): void {
  const handle = useRef<PresenceHandle | null>(null);
  const name = nickname.trim();
  const { status, roundId } = presenceStatus(session);
  useEffect(() => {
    if (!api || name === '') return;
    const h = api.joinPresence({ playerId, nickname: name, status, roundId });
    handle.current = h;
    return () => {
      h.leave();
      handle.current = null;
    };
    // Status changes are sent as updates below, without leaving and re-joining.
  }, [api, playerId, name]);
  useEffect(() => {
    handle.current?.update({ playerId, nickname: name, status, roundId });
  }, [playerId, name, status, roundId]);
}
````

Create `src/app/net/hooks.ts`:

````ts
import { useEffect, useState } from 'react';
import type { Play, PresenceState, Round, RoundsApi } from './types.ts';

/** Live list of rounds (null while loading, or with no backend). */
export function useRounds(api: RoundsApi | null): Round[] | null {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  useEffect(() => api?.onRounds(setRounds), [api]);
  return rounds;
}

/** Players currently on the site, one entry per player ID. */
export function usePresenceList(api: RoundsApi | null): PresenceState[] {
  const [players, setPlayers] = useState<PresenceState[]>([]);
  useEffect(() => api?.onPresence((list) => setPlayers([...new Map(list.map((p) => [p.playerId, p])).values()])), [api]);
  return players;
}

/** Live plays of one round (null while loading or when roundId is null). */
export function useRoundPlays(api: RoundsApi | null, roundId: number | null): Play[] | null {
  const [plays, setPlays] = useState<{ roundId: number; plays: Play[] } | null>(null);
  useEffect(() => {
    if (!api || roundId === null) return;
    return api.onPlays(roundId, (p) => setPlays({ roundId, plays: p }));
  }, [api, roundId]);
  return plays && plays.roundId === roundId ? plays.plays : null;
}
````

- [ ] **Step 2: Type check and run the suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/storage.ts src/app/player/hooks.ts src/app/net/hooks.ts
git commit -m "feat(app): player ID, submission storage, live-data hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 9: Player app in rounds

The start screen doubles as the lobby; rounds auto-join; practice games get a "Round N has started" banner; finished round games are submitted (with retry) and show delivery status, then rank and the bot comparison once the round closes. With no backend (`api` null) the app behaves exactly as before.

**Files:**
- Create: `src/test/harness.ts`, `src/app/multiplayer.test.tsx`, `src/app/player/RoundNotice.tsx`
- Replace: `src/app/App.test.tsx`, `src/app/App.tsx`, `src/app/screens/StartScreen.tsx`, `src/app/screens/PlayScreen.tsx`, `src/app/screens/ResultsScreen.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Shared test helpers, and move the existing App tests onto them.** Create `src/test/harness.ts`:

````ts
// Shared helpers for jsdom tests that render the app against the real data files.
import { readFileSync } from 'node:fs';
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { parsePresetFile } from '../core/presets.ts';

export const files: Record<string, string> = {
  'presets.json': readFileSync('public/data/presets.json', 'utf8'),
  'bots.json': readFileSync('public/data/bots.json', 'utf8'),
};
export const presetFile = parsePresetFile(JSON.parse(files['presets.json']));

/** Serve public/data from disk through a stubbed fetch. */
export function stubData(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = files[url.split('/').pop()!];
    return { ok: body !== undefined, status: body ? 200 : 404, json: async () => JSON.parse(body) };
  }));
}

const isTestedFill = (el: Element) => el.getAttribute('data-fill') === '#c62828' || el.getAttribute('data-fill') === '#1565c0';

/** Click the first untested node. */
export function clickUntested(): void {
  fireEvent.click(screen.getAllByTestId(/^node-/).find((el) => !isTestedFill(el))!);
}

/** Click untested nodes (lowest index first) until the game ends. */
export function playToEnd(): void {
  while (screen.queryByTestId('tests-left')) clickUntested();
}
````

Replace the whole of `src/app/App.test.tsx`:

````tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { files, playToEnd, stubData } from '../test/harness.ts';
import { App } from './App.tsx';

beforeEach(() => {
  localStorage.clear();
  stubData();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('discards a stored session that no longer matches the data, instead of crashing', async () => {
    const preset = JSON.parse(files['presets.json']).presets[0];
    const ob = preset.outbreaks[0];
    const stale = { presetId: preset.id, outbreakId: ob.id, budget: 10, seedNode: (ob.seedNode + 1) % preset.n, picks: [], usedPredictions: false, usedUncertainty: false };
    localStorage.setItem('sg.session', JSON.stringify(stale));
    render(<App />);
    expect(await screen.findByPlaceholderText('e.g. ada')).toBeTruthy();
  });

  it('hover box only reveals what the switched-on overlays show', async () => {
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. ada'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const node = screen.getAllByTestId(/^node-/).find((el) => el.getAttribute('data-fill') === '#e8e8e8')!;
    fireEvent.mouseEnter(node);
    const box = screen.getByTestId('hover-box');
    expect(box.textContent).not.toMatch(/P\(infected\)/);
    fireEvent.click(screen.getByLabelText(/Predictions/));
    expect(box.textContent).toMatch(/P\(infected\) ≈ \d\.\d\d/);
    expect(box.textContent).not.toMatch(/±|rank/);
    fireEvent.click(screen.getByLabelText(/Uncertainty/));
    expect(box.textContent).toMatch(/±/);
    expect(box.textContent).toMatch(/Uncertainty rank/);
  });

  it('starts the game when Enter is pressed in the nickname field', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText('e.g. ada');
    fireEvent.change(input, { target: { value: 'ada' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByTestId('tests-left')).toBeTruthy();
  });

  it('shows an error if the data cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(<App />);
    expect(await screen.findByText(/Could not load the game/)).toBeTruthy();
  });
});
````

- [ ] **Step 2: Write the failing multiplayer test.** Create `src/app/multiplayer.test.tsx`:

````tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickUntested, playToEnd, presetFile, stubData } from '../test/harness.ts';
import { App } from './App.tsx';
import { FakeRoundsApi } from './net/fake.ts';
import type { PresenceState } from './net/types.ts';

const preset = presetFile.presets[0];
const roundOutbreak = preset.outbreaks.find((o) => o.split === 'round')!;
const cfg = { presetId: preset.id, outbreakId: roundOutbreak.id, budget: 3, rankMetric: 'auc' as const };
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== roundOutbreak.seedNode);

let api: FakeRoundsApi;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('sg.nickname', 'ada');
  stubData();
  api = new FakeRoundsApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = () => act(() => api.openRound('1234', cfg).then(() => undefined));
const close = (id = api.rounds.at(-1)!.id) => act(() => api.closeRound('1234', id));

describe('player in a presenter-led round', () => {
  it('waits in the lobby, joins when the round opens, submits, then sees their rank after close', async () => {
    let presence: PresenceState[] = [];
    api.onPresence((p) => (presence = p));
    render(<App api={api} />);
    expect((await screen.findByTestId('lobby-status')).textContent).toMatch(/Waiting for the presenter/);
    expect(presence).toMatchObject([{ nickname: 'ada', status: 'lobby' }]);

    await open();
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getByTestId('tests-left').textContent).toBe('3 / 3');
    expect(presence).toMatchObject([{ status: 'playing', roundId: 1 }]);

    playToEnd();
    expect((await screen.findByText(/Result received/)).textContent).toMatch(/Waiting for the presenter/);
    expect(api.plays).toHaveLength(1);
    expect(api.plays[0]).toMatchObject({ nickname: 'ada', budget: 3, outbreakId: roundOutbreak.id });
    expect(presence).toMatchObject([{ status: 'finished', roundId: 1 }]);
    expect(within(screen.getByTestId('legend')).queryByText('LE (paper)')).toBeNull();

    await act(() => api.submitPlay({ ...api.plays[0], playerId: 'other', nickname: 'bob', picks: others.slice(10, 13) }));
    await close();
    expect(screen.getByTestId('round-notice').textContent).toMatch(/^#[12] of 2 · ranked by AUC$/);
    expect(within(screen.getByTestId('legend')).getByText('LE (paper)')).toBeTruthy();
    expect(screen.getByTestId('verdict')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the lobby' }));
    expect(screen.getByTestId('lobby-status').textContent).toMatch(/Waiting for the presenter/);
  });

  it('offers to join from a practice game, and joining switches to the round', async () => {
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play a practice game' }));
    clickUntested();
    await open();
    expect(screen.getByTestId('round-banner').textContent).toMatch(/Round 1 has started/);
    fireEvent.click(screen.getByRole('button', { name: 'Join now' }));
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.queryByTestId('round-banner')).toBeNull();
  });

  it('a player without a nickname can join from the start screen', async () => {
    localStorage.removeItem('sg.nickname');
    render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    fireEvent.change(screen.getByPlaceholderText('e.g. ada'), { target: { value: 'cy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join round 1' }));
    expect(screen.getByText('Round 1')).toBeTruthy();
  });

  it('closing the round mid-game tells the player it was not counted', async () => {
    render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    clickUntested();
    await close();
    expect(screen.getByText(/Round 1 has closed. Your game wasn't counted./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the lobby' }));
    expect(screen.getByTestId('lobby-status')).toBeTruthy();
  });

  it('keeps retrying a submission while offline and delivers it when back online', async () => {
    render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    api.offline = true;
    playToEnd();
    expect(await screen.findByText(/Connection problem, retrying/)).toBeTruthy();
    api.offline = false;
    expect(await screen.findByText(/Result received/, undefined, { timeout: 4000 })).toBeTruthy();
    expect(api.plays).toHaveLength(1);
  });

  it('resumes a finished round game after a reload without submitting twice', async () => {
    const first = render(<App api={api} />);
    await screen.findByTestId('lobby-status');
    await open();
    playToEnd();
    await screen.findByText(/Result received/);
    first.unmount();
    render(<App api={api} />);
    expect(await screen.findByText(/Result received/)).toBeTruthy();
    expect(api.plays).toHaveLength(1);
  });
});
````

Run: `npx vitest run src/app/multiplayer.test.tsx`
Expected: FAIL (`App` takes no `api`; no lobby status).

- [ ] **Step 3: Screens.** Replace the whole of `src/app/screens/StartScreen.tsx`:

````tsx
import { useState } from 'react';
import type { Preset } from '../../core/presets.ts';
import type { Round } from '../net/types.ts';

export interface StartScreenProps {
  presets: Preset[];
  initialNickname: string;
  onStart: (nickname: string, presetId: string) => void;
  /** Multiplayer: a round the player can join now. */
  round?: Round | null;
  onJoin?: (nickname: string) => void;
  /** Multiplayer: a line about the live session, e.g. "Waiting for the presenter…". */
  status?: string;
}

export function StartScreen({ presets, initialNickname, onStart, round = null, onJoin, status }: StartScreenProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId);
  const name = nickname.trim();
  const multiplayer = onJoin !== undefined;
  return (
    <form
      className="start"
      onSubmit={(e) => {
        e.preventDefault();
        if (name === '') return;
        if (round && onJoin) onJoin(name);
        else if (preset) onStart(name, presetId);
      }}
    >
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
      {round ? (
        <div className="lobby-status live" data-testid="lobby-status">
          <b>Round {round.number} is open.</b>
          <button type="submit" className="primary" disabled={name === ''}>
            Join round {round.number}
          </button>
        </div>
      ) : (
        status && <div className="lobby-status" data-testid="lobby-status">{status}</div>
      )}
      <div className="presets" role="radiogroup" aria-label="Network">
        {presets.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === presetId} className={`preset-card${p.id === presetId ? ' selected' : ''}`} onClick={() => setPresetId(p.id)}>
            <b>{p.name}</b>
            <span className="muted">{p.n} locations · {p.defaultBudget} tests</span>
          </button>
        ))}
      </div>
      {multiplayer ? (
        <button type="button" className={round ? '' : 'primary'} disabled={name === '' || !preset} onClick={() => preset && onStart(name, presetId)}>
          Play a practice game
        </button>
      ) : (
        <button type="submit" className="primary" disabled={name === '' || !preset}>
          Play
        </button>
      )}
    </form>
  );
}
````

Replace the whole of `src/app/screens/PlayScreen.tsx`:

````tsx
import { useMemo, useState, type ReactNode } from 'react';
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
  /** Header title, e.g. "Round 2"; defaults to the game name. */
  title?: string;
  /** Shown under the header, e.g. "Round 2 has started". */
  banner?: ReactNode;
}

export function PlayScreen({ model, outbreak, session, nickname, onSessionChange, title = 'Surveillance Game', banner }: PlayScreenProps) {
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
          <b>{title}</b> · {preset.name} · outbreak {outbreak.id} · <i>{nickname}</i>
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
      {banner}
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
````

Replace the whole of `src/app/screens/ResultsScreen.tsx`:

````tsx
import { useMemo, useState, type ReactNode } from 'react';
import type { BotsFile } from '../../core/bots.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { AucChart, type ChartSeries } from '../components/AucChart.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { botResult } from '../data.ts';
import { scoreSession, type Session } from '../session.ts';
import { verdictText } from '../verdict.ts';

export interface ResultsScreenProps {
  model: PresetModel;
  outbreak: Outbreak;
  session: Session;
  bots: BotsFile;
  /** Header title; defaults to "Results". */
  title?: string;
  /** Compare with the bots (chart lines and verdict). Off while a round is still open. */
  showComparison?: boolean;
  /** Shown above the scores, e.g. the player's rank or "waiting for the presenter". */
  notice?: ReactNode;
  /** Optional banner under the header. */
  banner?: ReactNode;
  actions: ReactNode;
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

export function ResultsScreen({ model, outbreak, session, bots, title = 'Results', showComparison = true, notice, banner, actions }: ResultsScreenProps) {
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
  const you: ChartSeries = { key: 'you', name: 'You', short: 'You', values: score.trajectory.auc, ...SERIES_STYLE.you };
  const series: ChartSeries[] = showComparison
    ? [
        { key: 'rand', name: 'Random (mean, 90% band)', short: 'Random', values: rand.mean.slice(0, upTo), ...SERIES_STYLE.rand },
        { key: 'ne', name: 'NE', short: 'NE', values: ne, ...SERIES_STYLE.ne },
        { key: 'le', name: 'LE (paper)', short: 'LE', values: le, ...SERIES_STYLE.le },
        you,
      ]
    : [you];

  const verdict = verdictText(score.auc, [
    { name: 'LE', auc: le[session.budget] ?? null },
    { name: 'NE', auc: ne[session.budget] ?? null },
    { name: 'Random', auc: rand.mean[session.budget] ?? null },
  ]);

  return (
    <main className="results">
      <header className="bar">
        <div><b>{title}</b> · {preset.name} · outbreak {outbreak.id}</div>
      </header>
      {banner}
      <div className="results-body">
        <div className="results-map">
          <GraphView graph={graph} layout={preset.layout} tested={tested} predictions={null} uncertainty={null} truth={outbreak.truth} wrong={wrong} hovered={hovered} onHover={setHovered} />
          <p className="muted small">Fill = <b>true</b> status · <b>+/−</b> your tests · <b>✕</b> = model's final guess was wrong</p>
        </div>
        <div className="results-side">
          {notice}
          <div className="scores">
            <div>
              <div className="label">AUC (paper metric)</div>
              <div className="hero" data-testid="score-auc">{fmt(score.auc)}</div>
            </div>
            <div>
              <div className="label">Learning-curve AUC</div>
              <div className="secondary">{fmt(score.aucArea)}</div>
              <div className="muted small">mean AUC over tests 1–{session.budget}</div>
            </div>
            <div>
              <div className="label">Accuracy</div>
              <div className="tertiary">{(100 * score.accuracy).toFixed(0)}%</div>
            </div>
          </div>
          <AucChart series={series} band={showComparison ? { lo: rand.lo.slice(0, upTo), hi: rand.hi.slice(0, upTo), color: SERIES_STYLE.rand.color } : undefined} />
          {showComparison && <p className="verdict" data-testid="verdict">{verdict}</p>}
          <div className="actions">{actions}</div>
        </div>
      </div>
    </main>
  );
}
````

Create `src/app/player/RoundNotice.tsx`:

````tsx
import { useMemo } from 'react';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { METRIC_LABEL, metricValue, rankBy, scorePlays } from '../board/ranking.ts';
import type { Play, Round } from '../net/types.ts';
import type { Submission } from './flow.ts';

export interface RoundNoticeProps {
  round: Round;
  model: PresetModel;
  outbreak: Outbreak;
  playerId: string;
  submission: Submission | null;
  /** Consecutive network failures while sending. */
  failures: number;
  /** All plays of the round, once it has closed (null while loading). */
  plays: Play[] | null;
}

/** Above a round player's results: delivery status while the round is open, then their rank. */
export function RoundNotice({ round, model, outbreak, playerId, submission, failures, plays }: RoundNoticeProps) {
  const ranked = useMemo(() => {
    if (!plays) return null;
    return rankBy(scorePlays(model, outbreak, plays), (s) => metricValue(s, round.rankMetric));
  }, [plays, model, outbreak, round.rankMetric]);

  const mine = submission && submission.play.roundId === round.id ? submission : null;
  if (mine?.state === 'rejected') {
    const why = mine.reason === 'round_closed' ? 'The round closed before your result reached the server' : 'The server could not accept your result';
    return <div className="notice bad" data-testid="round-notice">{why}, so it wasn't counted.</div>;
  }
  if (round.status === 'open') {
    const text =
      mine?.state === 'sent'
        ? '✓ Result received. Waiting for the presenter to close the round…'
        : failures > 0
          ? 'Connection problem, retrying… Keep this page open.'
          : 'Sending your result…';
    return <div className={`notice${mine?.state === 'sent' ? ' good' : ''}`} data-testid="round-notice">{text}</div>;
  }
  if (!ranked) return <div className="notice" data-testid="round-notice">Loading the room's results…</div>;
  const me = ranked.find((r) => r.item.play.playerId === playerId);
  if (!me) return <div className="notice bad" data-testid="round-notice">Your game wasn't counted (it didn't reach the server before the round closed).</div>;
  return (
    <div className="notice good" data-testid="round-notice">
      <span className="rank">{me.rank === null ? '–' : `#${me.rank}`}</span> of {ranked.length} · ranked by {METRIC_LABEL[round.rankMetric]}
    </div>
  );
}
````

- [ ] **Step 4: App.** Replace the whole of `src/app/App.tsx`:

````tsx
import { useEffect, useMemo, useState } from 'react';
import { presetModel, type PresetModel } from '../core/presets.ts';
import { chooseOutbreak, loadGameData, type GameData } from './data.ts';
import type { Round, RoundsApi } from './net/types.ts';
import { joinableRound, newSubmission, playerView, shouldAutoJoin } from './player/flow.ts';
import { useRoundPlays } from './net/hooks.ts';
import { usePresence, useSubmitter } from './player/hooks.ts';
import { RoundNotice } from './player/RoundNotice.tsx';
import { isFinished, isValidFor, startSession, type Session } from './session.ts';
import {
  loadLastOutbreak, loadLastRound, loadNickname, loadPlayerId, loadSession, loadSubmission,
  saveLastOutbreak, saveLastRound, saveNickname, saveSession, saveSubmission,
} from './storage.ts';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';

export interface AppProps {
  /** Live backend for presenter-led rounds; null (the default) is single-player only. */
  api?: RoundsApi | null;
}

export function App({ api = null }: AppProps) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(loadNickname);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [playerId] = useState(loadPlayerId);
  const [rounds, setRounds] = useState<Round[] | null>(api ? null : []);
  const [lastRound, setLastRound] = useState(loadLastRound);
  const [submission, setSubmission] = useState(loadSubmission);

  useEffect(() => {
    loadGameData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => saveSession(session), [session]);
  useEffect(() => saveSubmission(submission), [submission]);
  useEffect(() => api?.onRounds(setRounds), [api]);

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

  const view = playerView(session, rounds, lastRound);
  const joinable = joinableRound(rounds, lastRound);

  const joinRound = (round: Round) => {
    const m = model(round.presetId);
    const outbreak = m?.preset.outbreaks.find((o) => o.id === round.outbreakId);
    if (!m || !outbreak) return;
    saveLastRound(round.id);
    setLastRound(round.id);
    setSession(startSession(m.preset, outbreak, round.budget, round.id));
  };

  // Drop a stored session that no longer fits the data (e.g. presets regenerated) or whose round is gone.
  useEffect(() => {
    if (!data || !session) return;
    const m = model(session.presetId);
    const ob = m?.preset.outbreaks.find((o) => o.id === session.outbreakId);
    if (!m || !ob || !isValidFor(session, m.preset, ob) || view.kind === 'stale') setSession(null);
  }, [data, session, model, view.kind]);

  // In the lobby, or just after a practice game, a newly opened round starts straight away.
  useEffect(() => {
    if (data && joinable && shouldAutoJoin(session, joinable, nickname)) joinRound(joinable);
  }, [data, joinable?.id, session, nickname]);

  // A finished round game is queued for submission (once per round).
  useEffect(() => {
    if (!api || !session || session.roundId === null || !isFinished(session)) return;
    if (submission?.play.roundId === session.roundId && submission.play.playerId === playerId) return;
    setSubmission(newSubmission(session, playerId, nickname));
  }, [api, session, submission, playerId, nickname]);

  const failures = useSubmitter(api, submission, setSubmission);
  usePresence(api, playerId, nickname, session);
  const resultsRound = view.kind === 'round-results' && view.round.status === 'closed' ? view.round : null;
  const roomPlays = useRoundPlays(api, resultsRound?.id ?? null);

  if (error) return <main className="message">Could not load the game: {error}</main>;
  if (!data) return <main className="message">Loading…</main>;

  const begin = (presetId: string, previousId: string | null) => {
    const preset = data.presets.presets.find((p) => p.id === presetId)!;
    const outbreak = chooseOutbreak(preset, previousId);
    saveLastOutbreak(outbreak.id);
    setSession(startSession(preset, outbreak));
  };
  const remember = (name: string) => {
    setNickname(name);
    saveNickname(name);
  };
  const backToLobby = () => setSession(null);
  const banner = (round: Round | null) =>
    round && (
      <div className="banner" data-testid="round-banner">
        <b>Round {round.number} has started.</b> Finish this game or
        <button className="primary" onClick={() => joinRound(round)}>Join now</button>
      </div>
    );

  const current = session && model(session.presetId);
  const outbreak = current?.preset.outbreaks.find((o) => o.id === session?.outbreakId);
  if (!session || !current || !outbreak || !isValidFor(session, current.preset, outbreak) || view.kind === 'start' || view.kind === 'stale') {
    const status = rounds === null ? 'Connecting to the game…' : 'Waiting for the presenter to start a round. Meanwhile, play a practice game.';
    return (
      <StartScreen
        presets={data.presets.presets}
        initialNickname={nickname}
        onStart={(name, presetId) => {
          remember(name);
          begin(presetId, loadLastOutbreak());
        }}
        {...(api && {
          round: joinable,
          status,
          onJoin: (name: string) => {
            remember(name);
            if (joinable) joinRound(joinable);
          },
        })}
      />
    );
  }

  if (view.kind === 'round-missed') {
    return (
      <main className="message">
        <p>Round {view.round.number} has closed. Your game wasn't counted.</p>
        <button className="primary" onClick={backToLobby}>Back to the lobby</button>
      </main>
    );
  }
  if (view.kind === 'play') {
    const title = view.round ? `Round ${view.round.number}` : session.roundId !== null ? 'Round' : undefined;
    return (
      <PlayScreen
        key={`${session.roundId}/${session.presetId}/${session.outbreakId}`}
        model={current}
        outbreak={outbreak}
        session={session}
        nickname={nickname}
        title={title}
        banner={banner(view.banner)}
        onSessionChange={(update) => setSession((s) => (s ? update(s) : s))}
      />
    );
  }
  if (view.kind === 'round-results') {
    const closed = view.round.status === 'closed';
    return (
      <ResultsScreen
        model={current}
        outbreak={outbreak}
        session={session}
        bots={data.bots}
        title={`Round ${view.round.number} results`}
        showComparison={closed}
        notice={<RoundNotice round={view.round} model={current} outbreak={outbreak} playerId={playerId} submission={submission} failures={failures} plays={roomPlays} />}
        actions={closed && <button className="primary" onClick={backToLobby}>Back to the lobby</button>}
      />
    );
  }
  return (
    <ResultsScreen
      model={current}
      outbreak={outbreak}
      session={session}
      bots={data.bots}
      banner={banner(view.banner)}
      actions={
        <>
          <button className="primary" onClick={() => begin(session.presetId, session.outbreakId)}>Play another outbreak</button>
          <button onClick={backToLobby}>{api ? 'Back to the lobby' : 'Change network or nickname'}</button>
        </>
      }
    />
  );
}
````

- [ ] **Step 5: Styles.** Append to `src/app/styles.css`:

````css
/* Multiplayer (player side) */
.lobby-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--ink); }
.lobby-status.live { border: 2px solid var(--accent); }
.banner { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 20px; background: #fff4d6; border-bottom: 1px solid #e6cf8f; color: var(--ink); }
.notice { padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--ink); line-height: 1.45; }
.notice.good { border-left: 4px solid #2e7d32; }
.notice.bad { border-left: 4px solid #b71c1c; }
.rank { font-size: 28px; font-weight: 700; }

````

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/app && npm run typecheck`
Expected: all PASS, including the 6 multiplayer tests and the 8 existing App tests (the offline-retry test takes ~1 s).

- [ ] **Step 7: Commit**

```bash
git add src/test src/app/App.tsx src/app/App.test.tsx src/app/multiplayer.test.tsx src/app/player/RoundNotice.tsx src/app/screens src/app/styles.css
git commit -m "feat(player): lobby, presenter-led rounds, submission with retry, rank after close

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 10: Chart and graph options for the board

`AucChart` gains faint background lines, a step marker and custom titles; `GraphView` gains numbered test-order badges. Defaults keep the Plan 2 screens unchanged.

**Files:** Replace `src/app/components/AucChart.tsx`, `src/app/components/GraphView.tsx`

- [ ] **Step 1: Implement.** Replace the whole of `src/app/components/AucChart.tsx`:

````tsx
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
  /** Faint unlabelled lines drawn behind the series (e.g. every player's curve). */
  background?: (number | null)[][];
  /** Step to mark with a vertical line (e.g. the replay position). */
  marker?: number;
  title?: string;
  subtitle?: string;
}

const W = 460;
const H = 240;
const L = 40;
const R = 380;
const T = 8;
const B = 204;

/** AUC against number of tests, y fixed to [0.5, 1]. Legend above, direct labels right, hover crosshair. */
export function AucChart({
  series,
  band,
  background = [],
  marker,
  title = "How good was the model's map after each test?",
  subtitle = "AUC on untested locations (the paper's metric) · higher is better",
}: AucChartProps) {
  const N = Math.max(1, Math.max(...series.map((s) => s.values.length)) - 1);
  // Axis starts at 0.5 (chance) unless some value is lower; then it extends down in steps of 0.1.
  const all = [...series.flatMap((s) => s.values), ...(band?.lo ?? []), ...background.flat()].filter((v): v is number => v !== null);
  const yMin = Math.min(0.5, Math.floor(Math.min(...all, 0.5) * 10) / 10);
  const gridValues = Array.from({ length: Math.round((1 - yMin) * 10) + 1 }, (_, k) => +(yMin + k / 10).toFixed(1));
  const X = (t: number) => L + (t / N) * (R - L);
  const Y = (v: number) => B - ((Math.min(Math.max(v, yMin), 1) - yMin) / (1 - yMin)) * (B - T);
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
      <div className="chart-title">{title}</div>
      <div className="chart-subtitle">{subtitle}</div>
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
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke={v === yMin ? '#c9c7c1' : '#eceae6'} />
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
          {background.map((values, k) => (
            <path key={`bg${k}`} d={path(values)} fill="none" stroke="#0b0b0b" strokeOpacity={0.14} strokeWidth={1} strokeLinejoin="round" />
          ))}
          {marker !== undefined && <line data-testid="chart-marker" x1={X(marker)} x2={X(marker)} y1={T} y2={B} stroke="#ef6c00" strokeWidth={2} />}
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
````

Replace the whole of `src/app/components/GraphView.tsx`:

````tsx
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
  /** Test order (1, 2, …) shown as a small badge beside tested nodes, e.g. in a replay. */
  order?: Map<number, number>;
}

export function GraphView(props: GraphViewProps) {
  const { graph, layout, tested, predictions, uncertainty, truth, wrong, hovered, onHover, onPick, order } = props;
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
            {order?.has(i) && (
              <g pointerEvents="none" data-testid={`order-${i}`}>
                <circle cx={x + R * 0.95} cy={y - R * 0.95} r={5.5} fill="#fff" stroke={COLORS.ink} strokeWidth={1} />
                <text x={x + R * 0.95} y={y - R * 0.95 + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill={COLORS.ink}>
                  {order.get(i)}
                </text>
              </g>
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
````

- [ ] **Step 2: Run the suite** (existing chart/graph tests must still pass)

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/AucChart.tsx src/app/components/GraphView.tsx
git commit -m "feat(app): chart background lines and marker; graph test-order badges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 11: Board, presenter drawer and replay

**Files:**
- Create: `src/app/board/rows.ts`, `rows.test.ts`, `Qr.tsx`, `Leaderboard.tsx`, `FirstPickHeatmap.tsx`, `ReplayPanel.tsx`, `PresenterDrawer.tsx`, `BoardApp.tsx`, `BoardApp.test.tsx`; `src/app/Root.tsx`
- Replace: `src/app/main.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write the failing tests.** Create `src/app/board/rows.test.ts`:

````ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BotsFile } from '../../core/bots.ts';
import { parsePresetFile, presetModel } from '../../core/presets.ts';
import type { Play, Round } from '../net/types.ts';
import { botRows, leaderboardRows, roomMedian } from './rows.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;
const model = presetModel(preset);
const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;
const round: Round = { id: 1, number: 1, presetId: preset.id, outbreakId: outbreak.id, budget: 4, rankMetric: 'auc', status: 'closed', openedAt: '', closedAt: '' };
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode);
const play = (id: number, picks: number[]): Play => ({
  id, roundId: 1, presetId: preset.id, outbreakId: outbreak.id, budget: 4, playerId: `p${id}`, nickname: `p${id}`, picks,
  usedPredictions: id === 1, usedUncertainty: false, hidden: false, createdAt: '',
});
const plays = [play(1, others.slice(0, 4)), play(2, others.slice(40, 44)), play(3, others.slice(80, 84))];

describe('leaderboardRows', () => {
  it('ranks players by the round metric, best first', () => {
    const rows = leaderboardRows(model, outbreak, round, plays, bots, false);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.bot)).toBe(true);
    expect(rows[0].rank).toBe(1);
    for (let k = 1; k < rows.length; k++) expect(rows[k - 1].auc! >= rows[k].auc!).toBe(true);
  });

  it('places revealed bots by value without giving them ranks', () => {
    const rows = leaderboardRows(model, outbreak, round, plays, bots, true);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.bot).map((r) => r.rank)).toEqual([null, null, null]);
    const values = rows.map((r) => r.auc ?? -1);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('bot rows use the round budget; LE and NE are replayable, Random is not', () => {
    const [le, ne, rand] = botRows(bots, preset.id, outbreak.id, 4);
    expect(le.curve).toHaveLength(5);
    expect(le.picks).toHaveLength(4);
    expect(ne.picks).toHaveLength(4);
    expect(rand.picks).toBeNull();
    expect(le.auc).toBe(le.curve[4]);
  });

  it('roomMedian ignores bots', () => {
    const rows = leaderboardRows(model, outbreak, round, plays, bots, true);
    expect(roomMedian(rows)).toEqual(roomMedian(rows.filter((r) => !r.bot)));
    expect(roomMedian(rows)).toHaveLength(5);
  });
});
````

Create `src/app/board/BoardApp.test.tsx`:

````tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presetFile, stubData } from '../../test/harness.ts';
import { FakeRoundsApi } from '../net/fake.ts';
import type { NewPlay } from '../net/types.ts';
import { isBoardRoute } from '../Root.tsx';
import { BoardApp, boardPhase, joinUrl } from './BoardApp.tsx';

const preset = presetFile.presets[0];
const roundOutbreaks = preset.outbreaks.filter((o) => o.split === 'round');
const ob = roundOutbreaks[0];
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== ob.seedNode);

let api: FakeRoundsApi;
beforeEach(() => {
  sessionStorage.clear();
  stubData();
  api = new FakeRoundsApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const play = (id: string, nickname: string, picks: number[]): NewPlay => ({
  roundId: api.rounds.at(-1)!.id, presetId: preset.id, outbreakId: ob.id, budget: preset.defaultBudget, playerId: id, nickname, picks,
  usedPredictions: id === 'p1', usedUncertainty: false,
});

describe('helpers', () => {
  it('routes, join URL and phases', () => {
    expect(isBoardRoute('#/board')).toBe(true);
    expect(isBoardRoute('#/board/')).toBe(true);
    expect(isBoardRoute('#/')).toBe(false);
    expect(joinUrl('https://x.github.io/surveillance-game/#/board')).toBe('https://x.github.io/surveillance-game/');
    const r = { id: 3, number: 3, presetId: 'g', outbreakId: 'o', budget: 1, rankMetric: 'auc' as const, openedAt: '', closedAt: null };
    expect(boardPhase(null, null)).toBe('lobby');
    expect(boardPhase({ ...r, status: 'open' }, null)).toBe('live');
    expect(boardPhase({ ...r, status: 'closed' }, null)).toBe('results');
    expect(boardPhase({ ...r, status: 'closed' }, 3)).toBe('lobby');
  });
});

describe('BoardApp', () => {
  it('says so when multiplayer is not configured', () => {
    render(<BoardApp api={null} />);
    expect(screen.getByText(/Multiplayer is not configured/)).toBeTruthy();
  });

  it('runs a round: lobby → presenter opens → live count → close → leaderboard, bots, replay, hide', async () => {
    render(<BoardApp api={api} />);
    await screen.findByTestId('qr');
    act(() => void api.joinPresence({ playerId: 'p1', nickname: 'ada', status: 'lobby', roundId: null }));
    act(() => void api.joinPresence({ playerId: 'p2', nickname: 'bob', status: 'lobby', roundId: null }));
    expect(screen.getByTestId('joined-count').textContent).toBe('2');

    // Presenter unlocks the drawer with P and opens round 1 on the first round outbreak.
    fireEvent.keyDown(window, { key: 'p' });
    const drawer = screen.getByTestId('drawer');
    fireEvent.change(within(drawer).getByLabelText('PIN'), { target: { value: '0000' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Unlock' }));
    expect(await within(drawer).findByText('Wrong PIN')).toBeTruthy();
    fireEvent.change(within(drawer).getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Unlock' }));
    const open = await within(drawer).findByRole('button', { name: 'Open round 1' });
    expect((within(drawer).getByLabelText('Outbreak') as HTMLSelectElement).value).toBe(ob.id);
    await act(async () => fireEvent.click(open));
    expect(api.rounds).toMatchObject([{ number: 1, outbreakId: ob.id, budget: preset.defaultBudget, status: 'open' }]);
    expect((within(drawer).getByLabelText('Outbreak') as HTMLSelectElement).value).toBe(roundOutbreaks[1].id);

    act(() => {
      api.joinPresence({ playerId: 'p1', nickname: 'ada', status: 'playing', roundId: 1 });
      api.joinPresence({ playerId: 'p2', nickname: 'bob', status: 'playing', roundId: 1 });
    });
    expect(screen.getByTestId('finished-count').textContent).toBe('0 / 2 finished');
    await act(() => api.submitPlay(play('p1', 'ada', others.slice(0, preset.defaultBudget))));
    expect(screen.getByTestId('finished-count').textContent).toBe('1 / 2 finished');
    expect(screen.queryByTestId('leaderboard')).toBeNull();
    await act(() => api.submitPlay(play('p2', 'ada', others.slice(50, 50 + preset.defaultBudget))));
    expect(screen.getByTestId('finished-count').textContent).toBe('2 / 2 finished');

    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Close round 1' })));
    const board = screen.getByTestId('leaderboard');
    expect(within(board).getByText('ada')).toBeTruthy();
    expect(within(board).getByText('ada (2)')).toBeTruthy();
    expect(within(board).queryByText('LE (paper)')).toBeNull();
    expect(within(board).getAllByText('🎨', { exact: false })).toHaveLength(2); // header + ada's row

    fireEvent.click(within(drawer).getByLabelText('Reveal bots'));
    expect(within(screen.getByTestId('leaderboard')).getByText('LE (paper)')).toBeTruthy();
    expect(within(screen.getByTestId('leaderboard')).getByText('Random (mean)')).toBeTruthy();

    // Replay ada's game.
    fireEvent.click(within(screen.getByTestId('leaderboard')).getByText('ada'));
    expect(screen.getByTestId('replay-step').textContent).toBe(`Test 0 of ${preset.defaultBudget}`);
    expect(screen.getByTestId('commentary').textContent).toMatch(/^Start:/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('commentary').textContent).toMatch(/^Test 1: location \d+/);
    expect(screen.getByTestId(`order-${others[0]}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(screen.getByTestId('replay-step').textContent).toBe(`Test ${preset.defaultBudget} of ${preset.defaultBudget}`);
    fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

    // Moderation: ✕ buttons only while the drawer is open; hide "ada (2)".
    fireEvent.click(within(drawer).getByRole('button', { name: 'Hide drawer' }));
    expect(screen.queryByRole('button', { name: 'Hide ada (2)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Presenter controls (P)' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hide ada (2)' })));
    expect(api.plays.find((p) => p.playerId === 'p2')?.hidden).toBe(true);
    expect(within(screen.getByTestId('leaderboard')).queryByText('ada (2)')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to lobby' }));
    expect(screen.getByTestId('qr')).toBeTruthy();
    expect(within(screen.getByTestId('drawer')).getByRole('button', { name: 'Open round 2' })).toBeTruthy();
  });
});
````

Run: `npx vitest run src/app/board`
Expected: FAIL (modules missing).

- [ ] **Step 2: Leaderboard rows.** Create `src/app/board/rows.ts`:

````ts
import type { BotsFile } from '../../core/bots.ts';
import { lcArea } from '../../core/metrics.ts';
import type { PolicyName } from '../../core/policies.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { botResult } from '../data.ts';
import type { Play, Round } from '../net/types.ts';
import { medianCurve, metricValue, rankBy, scorePlays, type Scores } from './ranking.ts';

/** One leaderboard line: a player, or a bot once revealed. */
export interface Row extends Scores {
  key: string;
  name: string;
  bot: boolean;
  /** Human rank (bots are not ranked); null if the metric is undefined or for bots. */
  rank: number | null;
  /** AUC after each test, 0..budget. */
  curve: (number | null)[];
  /** Picks to replay; null for Random (a 200-run average). */
  picks: number[] | null;
  play: Play | null;
}

const BOTS: { policy: PolicyName; name: string }[] = [
  { policy: 'LE', name: 'LE (paper)' },
  { policy: 'NE', name: 'NE' },
  { policy: 'RAND', name: 'Random (mean)' },
];

export function botRows(bots: BotsFile, presetId: string, outbreakId: string, budget: number): Row[] {
  return BOTS.map(({ policy, name }) => {
    const r = botResult(bots, presetId, outbreakId, policy);
    const curve = r.auc.mean.slice(0, budget + 1);
    return {
      key: `bot-${policy}`,
      name,
      bot: true,
      rank: null,
      curve,
      auc: curve[budget] ?? null,
      aucArea: lcArea(curve),
      accuracy: r.accuracy.mean[budget] ?? null,
      picks: r.picks ? r.picks.slice(0, budget) : null,
      play: null,
    };
  });
}

/** Players ranked by the round's metric, with bots (if shown) placed by their value. */
export function leaderboardRows(model: PresetModel, outbreak: Outbreak, round: Round, plays: Play[], bots: BotsFile, showBots: boolean): Row[] {
  const players: Row[] = rankBy(scorePlays(model, outbreak, plays), (s) => metricValue(s, round.rankMetric)).map(({ item, rank }) => ({
    key: `play-${item.play.id}`,
    name: item.name,
    bot: false,
    rank,
    curve: item.curve,
    auc: item.auc,
    aucArea: item.aucArea,
    accuracy: item.accuracy,
    picks: item.play.picks,
    play: item.play,
  }));
  if (!showBots) return players;
  const all = [...players, ...botRows(bots, round.presetId, round.outbreakId, round.budget)];
  // Stable sort: bots go after players with the same value; undefined values last.
  const v = (r: Row) => metricValue(r, round.rankMetric) ?? -Infinity;
  return all.map((r, k) => ({ r, k })).sort((a, b) => v(b.r) - v(a.r) || a.k - b.k).map(({ r }) => r);
}

/** The room's median learning curve. */
export const roomMedian = (rows: Row[]): (number | null)[] => medianCurve(rows.filter((r) => !r.bot).map((r) => r.curve));
````

- [ ] **Step 3: Components.** Create `src/app/board/Qr.tsx`:

````tsx
import QRCode from 'qrcode';
import { useMemo } from 'react';

/** A QR code drawn as SVG squares (no canvas, no innerHTML). */
export function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const { n, cells } = useMemo(() => {
    const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    const cells: [number, number][] = [];
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) cells.push([r, c]);
    return { n: m.size, cells };
  }, [text]);
  const quiet = 4;
  return (
    <svg data-testid="qr" width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={n + 2 * quiet} height={n + 2 * quiet} fill="#fff" />
      <path d={cells.map(([r, c]) => `M${c},${r}h1v1h-1z`).join('')} fill="#000" />
    </svg>
  );
}
````

Create `src/app/board/Leaderboard.tsx`:

````tsx
import type { RankMetric } from '../net/types.ts';
import { formatMetric, METRIC_LABEL, metricValue } from './ranking.ts';
import type { Row } from './rows.ts';

export interface LeaderboardProps {
  rows: Row[];
  metric: RankMetric;
  onSelect: (row: Row) => void;
  /** Shown only while the presenter drawer is unlocked. */
  onHide?: (row: Row) => void;
}

const OTHER: Record<RankMetric, RankMetric[]> = { auc: ['lc_auc', 'accuracy'], lc_auc: ['auc', 'accuracy'], accuracy: ['auc', 'lc_auc'] };

export function Leaderboard({ rows, metric, onSelect, onHide }: LeaderboardProps) {
  return (
    <table className="leaderboard" data-testid="leaderboard">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th className="num">{METRIC_LABEL[metric]}</th>
          {OTHER[metric].map((m) => (
            <th key={m} className="num muted">{METRIC_LABEL[m]}</th>
          ))}
          <th title="Looked at predictions / uncertainty">🎨 ◎</th>
          {onHide && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const replayable = r.picks !== null;
          return (
            <tr
              key={r.key}
              className={`${r.bot ? 'bot' : ''}${replayable ? ' clickable' : ''}`}
              onClick={replayable ? () => onSelect(r) : undefined}
              data-testid={`row-${r.key}`}
            >
              <td>{r.bot ? '🤖' : (r.rank ?? '–')}</td>
              <td>{r.name}</td>
              <td className="num strong">{formatMetric(metricValue(r, metric), metric)}</td>
              {OTHER[metric].map((m) => (
                <td key={m} className="num muted">{formatMetric(metricValue(r, m), m)}</td>
              ))}
              <td>
                {r.play?.usedPredictions ? '🎨' : ''} {r.play?.usedUncertainty ? '◎' : ''}
              </td>
              {onHide && (
                <td>
                  {r.play && (
                    <button
                      className="hide"
                      aria-label={`Hide ${r.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHide(r);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
````

Create `src/app/board/FirstPickHeatmap.tsx`:

````tsx
import type { Graph } from '../../core/graph.ts';
import { COLORS } from '../scales.ts';

const VIEW = 330;
const PAD = 25;
const R = 9;
// Single-hue sequential ramp (teal), distinct from infection red/blue and uncertainty orange.
const LO = [224, 242, 241];
const HI = [0, 105, 92];

const shade = (t: number) => `rgb(${LO.map((lo, k) => Math.round(lo + (HI[k] - lo) * t)).join(',')})`;

/** Where did people test first? Darker = more players; counts printed on nodes. The starting location is outlined. */
export function FirstPickHeatmap({ graph, layout, counts, seedNode }: { graph: Graph; layout: [number, number][]; counts: number[]; seedNode: number }) {
  const max = Math.max(1, ...counts);
  const xy = (i: number): [number, number] => [PAD + layout[i][0] * (VIEW - 2 * PAD), PAD + layout[i][1] * (VIEW - 2 * PAD)];
  return (
    <figure className="heatmap">
      <figcaption>Where did people test first?</figcaption>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="graph" role="img" aria-label="First-test heatmap">
        {graph.edges.map(([a, b]) => {
          const [x1, y1] = xy(a);
          const [x2, y2] = xy(b);
          return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.edge} strokeWidth={1} opacity={0.5} />;
        })}
        {counts.map((c, i) => {
          const [x, y] = xy(i);
          const t = c / max;
          return (
            <g key={i}>
              <circle data-testid={`heat-${i}`} cx={x} cy={y} r={R} fill={c === 0 ? '#f1f0ec' : shade(0.25 + 0.75 * t)} stroke={i === seedNode ? COLORS.ink : COLORS.outline} strokeWidth={i === seedNode ? 3 : 0.6} />
              {c > 0 && (
                <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill={t > 0.5 ? '#fff' : COLORS.ink}>
                  {c}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="muted small">Numbers = players whose first test was there · thick outline = starting location</p>
    </figure>
  );
}
````

Create `src/app/board/ReplayPanel.tsx`:

````tsx
import { useEffect, useMemo, useState } from 'react';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { AucChart } from '../components/AucChart.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { replayFrames } from './frames.ts';
import type { Row } from './rows.ts';

export interface ReplayPanelProps {
  model: PresetModel;
  outbreak: Outbreak;
  row: Row;
  /** For the mini chart. */
  le: (number | null)[];
  median: (number | null)[];
  onClose: () => void;
}

/** Step through one game: the map after each test, with commentary and the AUC so far. */
export function ReplayPanel({ model, outbreak, row, le, median, onClose }: ReplayPanelProps) {
  const picks = row.picks ?? [];
  const frames = useMemo(() => replayFrames(model, outbreak, picks), [model, outbreak, row.key]);
  const last = frames.length - 1;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showPredictions, setShowPredictions] = useState(true);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [showTruth, setShowTruth] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    if (t >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setT((x) => Math.min(last, x + 1)), 1200);
    return () => clearTimeout(timer);
  }, [playing, t, last]);

  const frame = frames[t];
  const order = new Map(picks.slice(0, t).map((node, k) => [node, k + 1]));
  const go = (next: number) => {
    setPlaying(false);
    setT(Math.max(0, Math.min(last, next)));
  };

  return (
    <div className="replay" data-testid="replay">
      <div className="replay-head">
        <b>Replaying {row.name}</b>
        <button onClick={onClose}>← Back to results</button>
      </div>
      <div className="replay-body">
        <GraphView
          graph={model.graph}
          layout={model.preset.layout}
          tested={frame.tested}
          predictions={showPredictions && !showTruth ? frame.p : null}
          uncertainty={showUncertainty && !showTruth ? frame.uncertainty : null}
          truth={showTruth ? outbreak.truth : undefined}
          hovered={hovered}
          onHover={setHovered}
          order={order}
        />
        <div className="replay-side">
          <div className="replay-controls">
            <button aria-label="First" onClick={() => go(0)}>⏮</button>
            <button aria-label="Previous" onClick={() => go(t - 1)}>◀</button>
            <button className="primary" onClick={() => (playing ? setPlaying(false) : (t >= last ? (setT(0), setPlaying(true)) : setPlaying(true)))}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button aria-label="Next" onClick={() => go(t + 1)}>▶</button>
            <button aria-label="Last" onClick={() => go(last)}>⏭</button>
            <span data-testid="replay-step">Test {t} of {last}</span>
          </div>
          <input type="range" aria-label="Step" min={0} max={last} value={t} onChange={(e) => go(Number(e.target.value))} />
          <div className="toggles">
            <label><input type="checkbox" checked={showPredictions} onChange={(e) => setShowPredictions(e.target.checked)} /> Model predictions</label>
            <label><input type="checkbox" checked={showUncertainty} onChange={(e) => setShowUncertainty(e.target.checked)} /> Uncertainty rings</label>
            <label><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> Reveal true outbreak</label>
          </div>
          <p className="commentary" data-testid="commentary">{frame.commentary}</p>
          <AucChart
            title={`AUC after each test: ${row.name} vs LE and the room`}
            subtitle="Orange line = current step"
            marker={t}
            series={[
              { key: 'median', name: 'Room median', short: 'Room', color: '#8a8984', width: 2, dash: '4 3', values: median },
              { key: 'le', name: 'LE (paper)', short: 'LE', color: '#008300', width: 2, values: le },
              { key: 'row', name: row.name, short: row.bot ? row.name.split(' ')[0] : row.name, color: '#0b0b0b', width: 3, values: row.curve },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
````

Create `src/app/board/PresenterDrawer.tsx`:

````tsx
import { useState } from 'react';
import type { Preset } from '../../core/presets.ts';
import { openRound, PinError, type RankMetric, type Round, type RoundsApi } from '../net/types.ts';
import { METRIC_LABEL } from './ranking.ts';

export interface PresenterDrawerProps {
  api: RoundsApi;
  presets: Preset[];
  rounds: Round[];
  showBots: boolean;
  onShowBots: (on: boolean) => void;
  /** The checked PIN, or null while locked. Owned by the board, which also uses it to hide players. */
  pin: string | null;
  onPin: (pin: string | null) => void;
  onClose: () => void;
}

/** Presenter controls, unlocked with the PIN (kept for this tab only). */
export function PresenterDrawer({ api, presets, rounds, showBots, onShowBots, pin, onPin, onClose }: PresenterDrawerProps) {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId);
  const roundOutbreaks = preset?.outbreaks.filter((o) => o.split === 'round') ?? [];
  const unused = roundOutbreaks.find((o) => !rounds.some((r) => r.presetId === presetId && r.outbreakId === o.id));
  const [outbreakId, setOutbreakId] = useState(unused?.id ?? roundOutbreaks[0]?.id ?? '');
  const [budget, setBudget] = useState(preset?.defaultBudget ?? 10);
  const [metric, setMetric] = useState<RankMetric>('auc');
  const open = openRound(rounds);
  const nextNumber = Math.max(0, ...rounds.map((r) => r.number)) + 1;

  const act = async (f: (pin: string) => Promise<unknown>) => {
    if (!pin) return;
    setBusy(true);
    setError(null);
    try {
      await f(pin);
    } catch (e) {
      if (e instanceof PinError) onPin(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!pin) {
    return (
      <aside className="drawer" data-testid="drawer">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              if (await api.checkPin(entry)) onPin(entry);
              else setError('Wrong PIN');
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <b>Presenter</b>
          <label>
            PIN
            <input type="password" value={entry} onChange={(e) => setEntry(e.target.value)} autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy || entry === ''}>Unlock</button>
            <button type="button" onClick={onClose}>Hide</button>
          </div>
        </form>
      </aside>
    );
  }

  return (
    <aside className="drawer" data-testid="drawer">
      <b>Presenter</b>
      <label>
        Network
        <select
          value={presetId}
          onChange={(e) => {
            const next = presets.find((p) => p.id === e.target.value);
            setPresetId(e.target.value);
            setOutbreakId(next?.outbreaks.find((o) => o.split === 'round')?.id ?? '');
            setBudget(next?.defaultBudget ?? 10);
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        Outbreak
        <select value={outbreakId} onChange={(e) => setOutbreakId(e.target.value)}>
          {roundOutbreaks.map((o) => {
            const used = rounds.filter((r) => r.presetId === presetId && r.outbreakId === o.id).map((r) => r.number);
            return (
              <option key={o.id} value={o.id}>
                {o.id} · prevalence {Math.round(o.prevalence * 100)}%{used.length > 0 ? ` · used in round ${used.join(', ')}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        Budget (tests)
        <input type="number" min={1} max={preset?.maxBudget ?? 30} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
      </label>
      <label>
        Rank by
        <select value={metric} onChange={(e) => setMetric(e.target.value as RankMetric)}>
          {(Object.keys(METRIC_LABEL) as RankMetric[]).map((m) => (
            <option key={m} value={m}>{METRIC_LABEL[m]}{m === 'auc' ? ' (paper)' : ''}</option>
          ))}
        </select>
      </label>
      <div className="row">
        <button
          className="primary"
          disabled={busy || open !== null || !preset || !(Number.isInteger(budget) && budget >= 1 && budget <= preset.maxBudget)}
          onClick={() =>
            act(async (p) => {
              await api.openRound(p, { presetId, outbreakId, budget, rankMetric: metric });
              // Suggest the next outbreak for the following round.
              const k = roundOutbreaks.findIndex((o) => o.id === outbreakId);
              setOutbreakId(roundOutbreaks[(k + 1) % roundOutbreaks.length].id);
            })
          }
        >
          Open round {nextNumber}
        </button>
        <button disabled={busy || open === null} onClick={() => act((p) => api.closeRound(p, open!.id))}>
          Close round{open ? ` ${open.number}` : ''}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={showBots} onChange={(e) => onShowBots(e.target.checked)} /> Reveal bots
      </label>
      <p className="muted small">✕ on a leaderboard row hides that player.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={onClose}>Hide drawer</button>
        <button onClick={() => onPin(null)}>Lock</button>
      </div>
    </aside>
  );
}
````

Create `src/app/board/BoardApp.tsx`:

````tsx
import { useEffect, useMemo, useState } from 'react';
import { presetModel, type Outbreak, type PresetModel } from '../../core/presets.ts';
import { AucChart } from '../components/AucChart.tsx';
import { botResult, loadGameData, type GameData } from '../data.ts';
import { usePresenceList, useRoundPlays, useRounds } from '../net/hooks.ts';
import { latestRound, type Play, type PresenceState, type Round, type RoundsApi } from '../net/types.ts';
import { FirstPickHeatmap } from './FirstPickHeatmap.tsx';
import { Leaderboard } from './Leaderboard.tsx';
import { PresenterDrawer } from './PresenterDrawer.tsx';
import { Qr } from './Qr.tsx';
import { firstPickCounts, METRIC_LABEL } from './ranking.ts';
import { ReplayPanel } from './ReplayPanel.tsx';
import { leaderboardRows, roomMedian, type Row } from './rows.ts';

const PIN_KEY = 'sg.pin';

function loadPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function savePin(pin: string | null): void {
  try {
    if (pin === null) sessionStorage.removeItem(PIN_KEY);
    else sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    /* ignore */
  }
}

/** The join URL: this page's address without the #/board route. */
export const joinUrl = (href: string): string => href.split('#')[0];

export type BoardPhase = 'lobby' | 'live' | 'results';

/** Live while a round is open; results for the latest closed round until dismissed; otherwise the lobby. */
export function boardPhase(latest: Round | null, dismissed: number | null): BoardPhase {
  if (!latest) return 'lobby';
  if (latest.status === 'open') return 'live';
  return latest.id === dismissed ? 'lobby' : 'results';
}

export function BoardApp({ api }: { api: RoundsApi | null }) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rounds = useRounds(api);
  const players = usePresenceList(api);
  const latest = rounds ? latestRound(rounds) : null;
  const plays = useRoundPlays(api, latest?.id ?? null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pin, setPinState] = useState(loadPin);
  const [showBots, setShowBots] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);

  const setPin = (p: string | null) => {
    savePin(p);
    setPinState(p);
  };

  useEffect(() => {
    loadGameData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  // P toggles the presenter drawer (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.key === 'p' || e.key === 'P') setDrawerOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // A new round starts with bots hidden and no replay open.
  useEffect(() => {
    setShowBots(false);
    setSelected(null);
  }, [latest?.id]);

  const models = useMemo(() => new Map((data?.presets.presets ?? []).map((p) => [p.id, presetModel(p)])), [data]);

  if (!api) return <main className="message">Multiplayer is not configured for this build (no Supabase settings).</main>;
  if (error) return <main className="message">Could not load the game: {error}</main>;
  if (!data || !rounds) return <main className="message">Connecting…</main>;

  const phase = boardPhase(latest, dismissed);
  const model = latest ? (models.get(latest.presetId) ?? null) : null;
  const outbreak = model?.preset.outbreaks.find((o) => o.id === latest?.outbreakId) ?? null;

  return (
    <main className="board">
      <header className="bar">
        <div>
          <b>Surveillance Game</b> · ICID 2026
        </div>
        <div>
          {latest && phase !== 'lobby' && model && (
            <span>
              Round {latest.number} · {model.preset.name} · {latest.budget} tests · ranked by {METRIC_LABEL[latest.rankMetric]}
            </span>
          )}
          <button className="gear" aria-label="Presenter controls (P)" onClick={() => setDrawerOpen((o) => !o)}>⚙</button>
        </div>
      </header>

      {phase === 'lobby' && <Lobby players={players} nextNumber={(latest?.number ?? 0) + 1} />}
      {phase === 'live' && latest && <Live round={latest} players={players} submitted={(plays ?? []).filter((p) => !p.hidden).map((p) => p.playerId)} />}
      {phase === 'results' && latest && model && outbreak && (
        <Results
          round={latest}
          model={model}
          outbreak={outbreak}
          rows={leaderboardRows(model, outbreak, latest, plays ?? [], data.bots, showBots)}
          plays={plays ?? []}
          le={botResult(data.bots, latest.presetId, latest.outbreakId, 'LE').auc.mean.slice(0, latest.budget + 1)}
          showBots={showBots}
          selected={selected}
          onSelect={setSelected}
          onHide={pin && drawerOpen ? (row) => row.play && void api.hidePlay(pin, row.play.id).catch(() => setPin(null)) : undefined}
          onDismiss={() => setDismissed(latest.id)}
        />
      )}

      {drawerOpen && (
        <PresenterDrawer
          api={api}
          presets={data.presets.presets}
          rounds={rounds}
          showBots={showBots}
          onShowBots={setShowBots}
          pin={pin}
          onPin={setPin}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </main>
  );
}

function Lobby({ players, nextNumber }: { players: PresenceState[]; nextNumber: number }) {
  const url = joinUrl(location.href);
  return (
    <section className="board-lobby">
      <div className="join">
        <Qr text={url} size={260} />
        <div className="join-url">{url}</div>
        <div className="muted">Scan or type to join</div>
      </div>
      <div className="joined">
        <div className="big" data-testid="joined-count">{players.length}</div>
        <div className="label">players joined</div>
        <div className="chips">
          {players.map((p) => (
            <span key={p.playerId} className="chip">{p.nickname}</span>
          ))}
        </div>
        <p className="muted">Round {nextNumber} starts when the presenter opens it.</p>
      </div>
    </section>
  );
}

function Live({ round, players, submitted }: { round: Round; players: PresenceState[]; submitted: string[] }) {
  const done = new Set(submitted);
  const inRound = new Map(players.filter((p) => p.roundId === round.id).map((p) => [p.playerId, p.nickname]));
  const total = new Set([...inRound.keys(), ...done]).size;
  return (
    <section className="board-live">
      <div className="big" data-testid="finished-count">
        {done.size} / {total} finished
      </div>
      <div className="progress">
        <div style={{ width: `${total === 0 ? 0 : (100 * done.size) / total}%` }} />
      </div>
      <div className="chips">
        {[...inRound].map(([id, name]) => (
          <span key={id} className={`chip${done.has(id) ? ' done' : ''}`}>
            {done.has(id) ? '✓ ' : ''}
            {name}
          </span>
        ))}
      </div>
      <p className="muted">Playing now… results appear when the round closes. Scores stay hidden until then.</p>
    </section>
  );
}

interface ResultsProps {
  round: Round;
  model: PresetModel;
  outbreak: Outbreak;
  rows: Row[];
  plays: Play[];
  le: (number | null)[];
  showBots: boolean;
  selected: Row | null;
  onSelect: (row: Row | null) => void;
  onHide?: (row: Row) => void;
  onDismiss: () => void;
}

function Results({ round, model, outbreak, rows, le, showBots, selected, onSelect, onHide, onDismiss, plays }: ResultsProps) {
  const [figure, setFigure] = useState<'curves' | 'heatmap'>('curves');
  const median = roomMedian(rows);
  const humans = rows.filter((r) => !r.bot);
  const bot = (key: string) => rows.find((r) => r.key === key);
  if (selected) {
    return <ReplayPanel model={model} outbreak={outbreak} row={selected} le={le} median={median} onClose={() => onSelect(null)} />;
  }
  const series = [
    ...(showBots
      ? [
          { key: 'rand', name: 'Random (mean)', short: 'Random', color: '#8a8984', width: 1.5, dash: '4 3', values: bot('bot-RAND')?.curve ?? [] },
          { key: 'ne', name: 'NE', short: 'NE', color: '#6250d6', width: 2, values: bot('bot-NE')?.curve ?? [] },
          { key: 'le', name: 'LE (paper)', short: 'LE', color: '#008300', width: 2, values: bot('bot-LE')?.curve ?? [] },
        ]
      : []),
    { key: 'median', name: `Room median (${humans.length} players)`, short: 'Room', color: '#0b0b0b', width: 3, values: median },
  ];
  return (
    <section className="board-results">
      <div className="board-col">
        <div className="leaderboard-wrap">
          <Leaderboard rows={rows} metric={round.rankMetric} onSelect={onSelect} onHide={onHide} />
        </div>
        <p className="muted small">🎨 looked at predictions · ◎ looked at uncertainty · click a row to replay</p>
        <button onClick={onDismiss}>Back to lobby</button>
      </div>
      <div className="board-col">
        <div className="switch" role="tablist">
          <button role="tab" aria-selected={figure === 'curves'} className={figure === 'curves' ? 'primary' : ''} onClick={() => setFigure('curves')}>Learning curves</button>
          <button role="tab" aria-selected={figure === 'heatmap'} className={figure === 'heatmap' ? 'primary' : ''} onClick={() => setFigure('heatmap')}>First tests</button>
        </div>
        {figure === 'curves' ? (
          <AucChart series={series} background={humans.map((r) => r.curve)} subtitle="Faint lines: each player · AUC on untested locations (the paper's metric)" />
        ) : (
          <FirstPickHeatmap graph={model.graph} layout={model.preset.layout} counts={firstPickCounts(plays, model.graph.n)} seedNode={outbreak.seedNode} />
        )}
      </div>
    </section>
  );
}
````

- [ ] **Step 4: Routing.** Create `src/app/Root.tsx`:

````tsx
import { useEffect, useState } from 'react';
import { App } from './App.tsx';
import { BoardApp } from './board/BoardApp.tsx';
import type { RoundsApi } from './net/types.ts';

/** Hash routes, because GitHub Pages can't rewrite paths: #/board is the projector, anything else the player app. */
export const isBoardRoute = (hash: string): boolean => hash.replace(/\/$/, '') === '#/board';

export function Root({ api }: { api: RoundsApi | null }) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return isBoardRoute(hash) ? <BoardApp api={api} /> : <App api={api} />;
}
````

Replace the whole of `src/app/main.tsx`:

````tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { createRoundsApi } from './net/config.ts';
import { Root } from './Root.tsx';
import './styles.css';

const api = createRoundsApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root api={api} />
    </ErrorBoundary>
  </StrictMode>,
);
````

- [ ] **Step 5: Styles.** Append to `src/app/styles.css`:

````css
/* Board (projector): larger type for the back of the room */
.board { font-size: 18px; min-height: 100vh; position: relative; }
.board .bar > div { display: flex; align-items: center; gap: 14px; }
.gear { font-size: 18px; padding: 2px 10px; }
.big { font-size: 64px; font-weight: 700; line-height: 1; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.chip { display: inline-block; padding: 4px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; color: var(--ink); }
.chip.done { border-color: #2e7d32; background: #edf7ee; }
.board-lobby { display: flex; gap: 48px; padding: 40px; align-items: flex-start; flex-wrap: wrap; }
.join { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.join-url { font-size: 22px; font-weight: 600; word-break: break-all; max-width: 420px; text-align: center; }
.joined { flex: 1 1 400px; }
.board-live { padding: 40px; max-width: 1000px; }
.progress { height: 14px; background: #e4e2dc; border-radius: 7px; overflow: hidden; margin: 16px 0; }
.progress > div { height: 100%; background: var(--accent); transition: width 0.3s; }
.board-results { display: flex; gap: 24px; padding: 16px 20px; flex-wrap: wrap; align-items: flex-start; }
.board-col { flex: 1 1 480px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.board-col > button { align-self: flex-start; }
/* Fit 30+ players on a projector: the table scrolls inside its panel with a sticky header. */
.leaderboard-wrap { max-height: calc(100vh - 150px); overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.leaderboard-wrap thead th { position: sticky; top: 0; background: var(--surface); }
.switch { display: flex; gap: 6px; }
.leaderboard { width: 100%; border-collapse: collapse; }
.leaderboard th, .leaderboard td { padding: 3px 10px; text-align: left; border-bottom: 1px solid #eceae6; color: var(--ink); }
.leaderboard th { font-size: 13px; color: var(--ink-2); font-weight: 600; }
.leaderboard .num { text-align: right; font-variant-numeric: tabular-nums; }
.leaderboard td.muted { color: var(--ink-2); }
.leaderboard .strong { font-weight: 700; }
.leaderboard tr.bot td { background: #f1f6f1; }
.leaderboard tr.clickable { cursor: pointer; }
.leaderboard tr.clickable:hover td { background: #fff4d6; }
.leaderboard button.hide { padding: 0 8px; font-size: 13px; }
.heatmap { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.heatmap figcaption { font-weight: 600; font-size: 14px; color: #0b0b0b; }
.heatmap .graph { border: none; max-width: min(520px, calc(100vh - 230px)); }

/* Presenter drawer */
.drawer { position: absolute; right: 14px; top: 56px; width: 300px; background: #fff; border: 2px solid var(--accent); border-radius: 8px; padding: 12px; font-size: 14px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15); display: flex; flex-direction: column; gap: 8px; color: var(--ink); z-index: 10; }
.drawer form { display: flex; flex-direction: column; gap: 8px; }
.drawer label { display: flex; flex-direction: column; gap: 3px; font-weight: 600; }
.drawer label.check { flex-direction: row; align-items: center; gap: 6px; }
.drawer select, .drawer input:not([type='checkbox']) { font: inherit; padding: 5px 6px; border: 1px solid var(--border); border-radius: 6px; color: var(--ink); background: #fff; }
.drawer .row { display: flex; gap: 8px; flex-wrap: wrap; }
.error { color: #b71c1c; margin: 0; }

/* Replay */
.replay { padding: 16px 20px; }
.replay-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.replay-body { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
.replay-side { flex: 1 1 420px; max-width: 620px; display: flex; flex-direction: column; gap: 10px; }
.replay-controls { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.replay input[type='range'] { width: 100%; }
.toggles { display: flex; gap: 16px; flex-wrap: wrap; font-size: 15px; }
.commentary { margin: 0; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; min-height: 2.8em; }
.board .label { font-size: 16px; }
````

- [ ] **Step 6: Run everything**

Run: `npm test && npm run build`
Expected: 27 test files, 126 tests PASS; build succeeds with no chunk-size warning after Task 13 (a warning about a >500 kB chunk is expected until then).

- [ ] **Step 7: Look at it.** Run `npm run dev` and open `http://localhost:5173/#/board`. Without Supabase settings it must say "Multiplayer is not configured for this build". (The full board is checked against the real backend in Task 14.)

- [ ] **Step 8: Commit**

```bash
git add src/app/board src/app/Root.tsx src/app/main.tsx src/app/styles.css
git commit -m "feat(board): projector board with lobby, live progress, leaderboard, heatmap, replay and presenter drawer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 12: Smoke and load tests for the real project

Both scripts use the real `SupabaseRoundsApi` in Node. With `LIVE_FAKE=1` they run against one shared in-memory fake (PIN `1234`), which checks the scripts themselves before a project exists.

**Files:** Create `scripts/live.ts`, `scripts/smoke.ts`, `scripts/loadtest.ts`; modify `package.json`

- [ ] **Step 1: Implement.** Create `scripts/live.ts`:

````ts
// Shared setup for scripts that talk to the real Supabase project (smoke test, load test).
import { FakeRoundsApi } from '../src/app/net/fake.ts';
import { SupabaseRoundsApi } from '../src/app/net/supabase.ts';
import { openRound, type Round, type RoundsApi } from '../src/app/net/types.ts';
import { loadPresets } from './io.ts';

export function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Put VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local and run with PRESENTER_PIN=… in the environment.`);
    process.exit(2);
  }
  return v;
}

// LIVE_FAKE=1 runs the script against one shared in-memory backend (PIN 1234), to check the script itself.
const fake = process.env.LIVE_FAKE ? new FakeRoundsApi('1234') : null;

export const newApi = (): RoundsApi => fake ?? new SupabaseRoundsApi(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'));

/** Resolve when `check` passes on a value pushed by `subscribe`, or reject after `ms`. */
export function waitFor<T>(subscribe: (cb: (v: T) => void) => () => void, check: (v: T) => boolean, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    let unsub: (() => void) | null = null;
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      unsub?.();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
    unsub = subscribe((v) => {
      if (done || !check(v)) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => unsub?.());
      resolve(v);
    });
  });
}

/** Refuse to run while a real round is open, unless --force: these scripts open and close rounds. Returns the rounds so far. */
export async function guardOpenRound(api: RoundsApi): Promise<Round[]> {
  const rounds = await waitFor<Round[]>((cb) => api.onRounds(cb), () => true);
  const open = openRound(rounds);
  if (open && !process.argv.includes('--force')) {
    console.error(`Round ${open.number} is open. These scripts would close it. Re-run with --force if that's OK.`);
    process.exit(2);
  }
  return rounds;
}

/** The first round outbreak of the first preset, and nodes other than its seed. */
export function testOutbreak() {
  const preset = loadPresets().presets[0];
  const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;
  const nodes = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode);
  return { preset, outbreak, nodes };
}

let failures = 0;
export async function check(label: string, f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export const failed = (): number => failures;

export function expectEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}
````

Create `scripts/smoke.ts`:

````ts
// Smoke test against the real Supabase project: presenter functions, submission rules, realtime and presence.
// Usage: PRESENTER_PIN=… npm run smoke   (add -- --force if a round is open; it will be closed)
// Leaves a few test rounds behind; clear them before the workshop with: truncate rounds, plays restart identity;
import { PinError, SubmitError, type Play, type PresenceState, type Round } from '../src/app/net/types.ts';
import { check, env, expectEqual, failed, guardOpenRound, newApi, testOutbreak, waitFor } from './live.ts';

const pin = env('PRESENTER_PIN');
const presenter = newApi();
const player = newApi();
const { preset, outbreak, nodes } = testOutbreak();
const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof SubmitError ? e.kind : `unexpected: ${String(e)}`));

const lastNumber = Math.max(0, ...(await guardOpenRound(presenter)).map((x) => x.number));
console.log('Smoke test');
let round: Round | null = null;

await check('wrong PIN is rejected', async () => {
  expectEqual(await presenter.checkPin(`${pin}-wrong`), false);
  const err = await presenter.openRound(`${pin}-wrong`, { presetId: preset.id, outbreakId: outbreak.id, budget: 3, rankMetric: 'auc' }).catch((e: unknown) => e);
  if (!(err instanceof PinError)) throw new Error(`expected PinError, got ${String(err)}`);
});
await check('right PIN unlocks', async () => expectEqual(await presenter.checkPin(pin), true));

await check('opening a round reaches players live', async () => {
  const seen = waitFor<Round[]>((cb) => player.onRounds(cb), (rs) => rs.some((x) => x.number > lastNumber && x.status === 'open'));
  round = await presenter.openRound(pin, { presetId: preset.id, outbreakId: outbreak.id, budget: 3, rankMetric: 'auc' });
  await seen;
});
if (!round) {
  console.log('Cannot continue without a round.');
  process.exit(1);
}
const r = round as Round;
const play = { roundId: r.id, presetId: preset.id, outbreakId: outbreak.id, budget: 3, playerId: crypto.randomUUID(), nickname: 'smoke', picks: nodes.slice(0, 3), usedPredictions: true, usedUncertainty: false };

await check('presence: the board sees a joining player', async () => {
  const seen = waitFor<PresenceState[]>((cb) => presenter.onPresence(cb), (ps) => ps.some((p) => p.playerId === play.playerId));
  player.joinPresence({ playerId: play.playerId, nickname: 'smoke', status: 'playing', roundId: r.id });
  await seen;
});
await check('a valid play is accepted and reaches the board live', async () => {
  const seen = waitFor<Play[]>((cb) => presenter.onPlays(r.id, cb), (ps) => ps.some((p) => p.playerId === play.playerId));
  expectEqual(await kind(player.submitPlay(play)), 'ok');
  const plays = await seen;
  expectEqual(plays.find((p) => p.playerId === play.playerId)?.picks.join(','), play.picks.join(','));
});
await check('a second play from the same player is a duplicate', async () => expectEqual(await kind(player.submitPlay(play)), 'duplicate'));
await check('a wrong budget is invalid', async () =>
  expectEqual(await kind(player.submitPlay({ ...play, playerId: crypto.randomUUID(), budget: 4, picks: nodes.slice(0, 4) })), 'invalid'));
await check('repeated picks are invalid', async () =>
  expectEqual(await kind(player.submitPlay({ ...play, playerId: crypto.randomUUID(), picks: [nodes[0], nodes[0], nodes[1]] })), 'invalid'));
await check('hiding a play reaches the board live', async () => {
  const plays = await waitFor<Play[]>((cb) => presenter.onPlays(r.id, cb), () => true);
  const mine = plays.find((p) => p.playerId === play.playerId)!;
  const seen = waitFor<Play[]>((cb) => presenter.onPlays(r.id, cb), (ps) => ps.some((p) => p.id === mine.id && p.hidden));
  await presenter.hidePlay(pin, mine.id);
  await seen;
});
await check('closing the round reaches players live', async () => {
  const seen = waitFor<Round[]>((cb) => player.onRounds(cb), (rs) => rs.some((x) => x.id === r.id && x.status === 'closed'));
  await presenter.closeRound(pin, r.id);
  await seen;
});
await check('a play after close is rejected', async () =>
  expectEqual(await kind(player.submitPlay({ ...play, playerId: crypto.randomUUID() })), 'round_closed'));

console.log(failed() === 0 ? 'All smoke checks passed.' : `${failed()} smoke check(s) failed.`);
process.exit(failed() === 0 ? 0 : 1);
````

Create `scripts/loadtest.ts`:

````ts
// Load test against the real Supabase project: N players (default 30) join, then all submit within a few seconds.
// Usage: PRESENTER_PIN=… npm run loadtest [-- --players 30 --force]
import type { Play, PresenceState } from '../src/app/net/types.ts';
import { quantile } from '../src/core/bots.ts';
import { makeRng } from '../src/core/rng.ts';
import { env, failed, check, guardOpenRound, newApi, testOutbreak, waitFor } from './live.ts';

const pin = env('PRESENTER_PIN');
const arg = (name: string, fallback: number) => {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? Number(process.argv[k + 1]) : fallback;
};
const N = arg('players', 30);
const budget = 10;
const board = newApi();
const { preset, outbreak, nodes } = testOutbreak();
await guardOpenRound(board);

console.log(`Load test: ${N} players`);
const round = await board.openRound(pin, { presetId: preset.id, outbreakId: outbreak.id, budget, rankMetric: 'auc' });
const players = Array.from({ length: N }, (_, k) => ({ api: newApi(), id: crypto.randomUUID(), name: `load${k + 1}` }));

await check(`board sees all ${N} players join`, async () => {
  const t0 = performance.now();
  const seen = waitFor<PresenceState[]>((cb) => board.onPresence(cb), (ps) => players.every((p) => ps.some((x) => x.playerId === p.id)), 20_000);
  for (const p of players) p.api.joinPresence({ playerId: p.id, nickname: p.name, status: 'playing', roundId: round.id });
  await seen;
  console.log(`        (${Math.round(performance.now() - t0)} ms)`);
});

const latencies: number[] = [];
const errors: string[] = [];
await check(`all ${N} plays are accepted and reach the board`, async () => {
  const t0 = performance.now();
  const seen = waitFor<Play[]>((cb) => board.onPlays(round.id, cb), (ps) => ps.length >= N, 30_000);
  await Promise.all(
    players.map(async (p, k) => {
      const rng = makeRng(k + 1);
      const picks = [...nodes].sort(() => rng() - 0.5).slice(0, budget);
      await new Promise((r) => setTimeout(r, rng() * 3000));
      const start = performance.now();
      try {
        await p.api.submitPlay({ roundId: round.id, presetId: preset.id, outbreakId: outbreak.id, budget, playerId: p.id, nickname: p.name, picks, usedPredictions: false, usedUncertainty: false });
        latencies.push(performance.now() - start);
      } catch (e) {
        errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  if (errors.length > 0) throw new Error(`${errors.length} submissions failed: ${errors.slice(0, 3).join('; ')}`);
  await seen;
  console.log(`        (all on the board after ${Math.round(performance.now() - t0)} ms)`);
});
if (latencies.length > 0) {
  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(`  submit latency: median ${Math.round(quantile(sorted, 0.5))} ms, 95th ${Math.round(quantile(sorted, 0.95))} ms, max ${Math.round(sorted.at(-1)!)} ms`);
}
await board.closeRound(pin, round.id);
console.log(failed() === 0 ? 'Load test passed.' : 'Load test FAILED.');
process.exit(failed() === 0 ? 0 : 1);
````

```bash
npm pkg set scripts.smoke="node --disable-warning=ExperimentalWarning --env-file-if-exists=.env.local scripts/smoke.ts"
npm pkg set scripts.loadtest="node --disable-warning=ExperimentalWarning --env-file-if-exists=.env.local scripts/loadtest.ts"
```

- [ ] **Step 2: Check the scripts against the fake**

Run: `LIVE_FAKE=1 PRESENTER_PIN=1234 npm run smoke`
Expected: 11 `PASS` lines and `All smoke checks passed.`

Run: `LIVE_FAKE=1 PRESENTER_PIN=1234 npm run loadtest`
Expected: two `PASS` lines and `Load test passed.`

Run: `npm run smoke` (no env)
Expected: exits with `Missing PRESENTER_PIN…` (no stack trace).

- [ ] **Step 3: Type check and commit**

Run: `npm run typecheck`

```bash
git add scripts/live.ts scripts/smoke.ts scripts/loadtest.ts package.json
git commit -m "test: smoke and load tests against the live Supabase project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 13: Deployment files and docs

**Files:** Create `.github/workflows/deploy.yml`, `.env.example`; modify `.gitignore`, `vite.config.ts`, `README.md`

- [ ] **Step 1: Workflow and env example.** Create `.github/workflows/deploy.yml`:

````yaml
# Test, build and publish to GitHub Pages on every push to main.
# Repository variables (Settings → Secrets and variables → Actions → Variables):
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   (the anon key is public by design; never use the service-role key)
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
````

Create `.env.example`:

````
# Copy to .env.local (git-ignored) for `npm run dev`, `npm run smoke` and `npm run loadtest`.
# Supabase → Project Settings → API. The anon key is public by design; never put the service-role key here.
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
````

In `.gitignore`, add `!.env.example` on the line after `.env*`. Check: `git check-ignore .env.example .env.local` prints only `.env.local`.

- [ ] **Step 2: Silence the expected bundle-size warning.** Replace the whole of `vite.config.ts`:

````ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built app works from any static host path.
  base: './',
  plugins: [react()],
  // One ~510 kB bundle (~150 kB gzipped, mostly React and supabase-js) is fine for a one-page app.
  build: { chunkSizeWarningLimit: 600 },
  test: { environment: 'node' },
});
````

- [ ] **Step 3: README.** Replace the whole of `README.md`:

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

## App (`src/app/`)

Single-player game: React + hand-written SVG. All model computation runs in the browser; data comes from `public/data/`.

```bash
npm run dev       # development server
npm run build     # typecheck + production build into dist/ (static; host anywhere)
npm run preview   # serve dist/ locally
```

Design: `docs/superpowers/specs/2026-11-01-player-app-design.md`

## Multiplayer (presenter-led rounds)

Players open the site (`#/`); the projector shows `#/board`. Press **P** (or ⚙) on the board for the presenter drawer (PIN). Round state, finished plays and presence live in Supabase; scores are always recomputed from picks. Without Supabase settings the app is single-player only.

Design: `docs/superpowers/specs/2026-11-02-multiplayer-design.md`

**One-time setup**

1. Create a Supabase project. In its SQL editor, run `supabase/schema.sql`, then `select set_presenter_pin('…');` (at least 6 characters; keep it out of the repo).
2. Copy `.env.example` to `.env.local` and fill in the project URL and **anon** key (Project Settings → API).
3. For the deployed site, add the same two values as GitHub repository **variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and set Pages → Source to "GitHub Actions". `.github/workflows/deploy.yml` tests, builds and deploys every push to `main`.

**Checks**

```bash
npm run test:sql                       # schema.sql on a throwaway local Postgres (needs initdb/psql)
PRESENTER_PIN=… npm run smoke          # presenter, submission rules, realtime, presence on the real project
PRESENTER_PIN=… npm run loadtest       # 30 simulated players (-- --players N)
```

Both live scripts refuse to run while a round is open (add `-- --force`). Before the workshop, clear test data in the SQL editor: `truncate rounds, plays restart identity;`.

## Commands

| Command | What it does |
|---|---|
| `npm test` / `npm run typecheck` | Unit tests / type check |
| `npm run test:sql` | Database schema checks (local Postgres) |
| `npm run smoke` / `npm run loadtest` | Checks against the real Supabase project (see Multiplayer) |
| `npm run bench` | Speed benchmark |
| `npm run data` | Rebuild presets → calibrate prior → rebuild bots (run all three after changing presets) |
| `npm run validate` | Laplace vs MCMC report → `docs/validation/` |

Python steps use `uv` (`offline/pyproject.toml`) and expect the paper repo at `../optimal-disease-surveillance-AL` (override with `SURVEILLANCE_REPO`).
````

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: 126 tests PASS; build without warnings.

- [ ] **Step 5: Commit**

```bash
git add .github .env.example .gitignore vite.config.ts README.md
git commit -m "chore: GitHub Pages deployment and multiplayer setup docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 14: Go live (controller with the user; not a subagent task)

These steps need the user's accounts and approval. Do them in order and stop at each **confirm**.

1. **Supabase (user):** create the project; run `supabase/schema.sql` in the SQL editor; run `select set_presenter_pin('…');` (a long random passphrase, ≥ 10 characters; the user keeps the PIN, never pasted in chat). The user pastes the project URL and **anon** key (never the service-role key).
2. Create `.env.local` from `.env.example` with those two values.
3. Run `PRESENTER_PIN=… npm run smoke` (the user types the PIN in their own shell, e.g. `! PRESENTER_PIN=… npm run smoke`). Expected: `All smoke checks passed.` Fix anything that fails before continuing.
4. Run `PRESENTER_PIN=… npm run loadtest`. Expected: `Load test passed.`, median submit latency well under 1 s.
5. `npm run dev`, open `http://localhost:5173/#/board` and, in another browser profile, `http://localhost:5173/`: run one round end to end (drawer unlock, open, play, close, reveal bots, replay, hide, back to lobby).
6. **Confirm with the user** before creating the **public** GitHub repo `surveillance-game` and pushing `main`. Then: add repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; set Pages → Source → GitHub Actions; check the workflow run and open the deployed URL (player and `#/board`).
7. Clear test data in the SQL editor: `truncate rounds, plays;` (no `restart identity`: round ids must keep increasing, because browsers remember the last round id they joined).
8. Dry run with 2–3 colleagues on laptops (by Nov 9, code freeze); clear data again afterwards.
