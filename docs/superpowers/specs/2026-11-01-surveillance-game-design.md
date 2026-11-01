# Surveillance Game — Design Spec

**Date:** 2026-11-01
**Event:** ICID 2026 workshop (talk + practical), 2026-11-12
**Based on:** Tsui et al. (2024), *Toward optimal disease surveillance with graph-based active learning*, PNAS 121(52) e2412424121; code in `../optimal-disease-surveillance-AL`.

## 1. Purpose

An interactive web game in which ~30 workshop participants (mostly on laptops) choose which nodes of a network to test for infection under a fixed budget. After every test, a surrogate model updates its predicted infection probability for all unobserved nodes. Participants are scored on how well the model maps the outbreak given their choices, compete on a live leaderboard, and are compared against the active-learning policies from the paper (LE, NE, BALD) and baselines.

Goal: build intuition for exploration vs exploitation, graph structure, and why Local Entropy (LE) works.

### Scope

- **Must have:** game, live leaderboard, comparison against paper policies (bots), presenter-led rounds, free play.
- **Out of scope (stretch, only if time allows after code freeze):** RL policy, GNN-ensemble surrogate.
- **Out of scope:** empirical graphs (Italy/IATA), maps, user accounts.

## 2. Architecture

```
 OFFLINE (your machine)                       ONLINE
 ┌──────────────────────────────┐   JSON    ┌───────────────────────────────┐
 │ Python: build_presets.py     │ ────────▶ │ Static web app (Vite + TS)    │
 │  • graphs + curated layouts  │  bundled  │  hosted on Vercel/Netlify     │
 │  • outbreaks via repo's      │           │                               │
 │    simulate_binary_outbreak  │           │  core/  (pure TS, no UI)      │
 │ Node: build_bots.ts          │           │   graph · surrogate · policies│
 │  • runs core/ → bots.json    │           │   metrics                     │
 │ validate_surrogate.ipynb     │           │  views/                       │
 │  • Laplace vs NumPyro MCMC   │           │   Player · Presenter · Board  │
 └──────────────────────────────┘           └──────────────┬────────────────┘
                                                           │ Realtime
                                            ┌──────────────▼────────────────┐
                                            │ Supabase (free tier)          │
                                            │  rounds · plays               │
                                            └───────────────────────────────┘
```

- All model computation (surrogate, policies, scoring) runs in the browser. There is no compute server.
- Supabase stores round state and plays and pushes realtime updates. It does nothing else.
- `core/` is pure TypeScript with no DOM dependency, so it can be unit-tested and run in Node (bots, and a future RL environment).

### Views (one URL)

| Route | Who | Purpose |
|---|---|---|
| `/` | Players | Nickname → lobby → play current round, or free play |
| `/present` | Presenter (PIN) | Configure / open / close rounds, see completion count |
| `/board` | Projector | Live leaderboard, learning curves, first-pick heatmap |

## 3. Surrogate model

A latent Gaussian graph model fitted with a **Laplace approximation**:

- Prior: the paper's structure `f = b0 + car`, i.e. covariance `K = b0Var·I + (τ(D − αA))⁻¹`, computed once per graph. Other priors (e.g. a graph diffusion kernel) can be swapped in later because only `K` is consumed; none is planned for now.
- Likelihood: `y_i ~ Bernoulli(σ(f_i))` for observed nodes.
- Fit: Newton iterations on `(Q + W)` with step-halving if a step fails to improve the objective, and diagonal jitter if Cholesky fails. Marginal variances come from `diag((Q+W)⁻¹)`.
- Predictive probability: probit approximation `p ≈ σ(μ / √(1 + πs²/8))`.
- Hyperparameters: fixed per preset, **calibrated offline** by grid search over (α, τ, b0Var) on held-out simulated outbreaks. The objective is learning-curve AUC. For the 10×10 grid: α = 0.95, τ = 0.03, b0Var = 0.01 (b0Var barely matters). The paper's priors (τ ~ LogNormal(0, 0.1)) imply much weaker spatial correlation on this grid.
- Interface: `fit(graph, observations) → { mean, variance, p }`.
- Measured cost: ~0.1–0.2 ms per fit (≤ 30 observations) on 100–160 nodes. Only the m observed nodes enter the Newton iterations.
- Probabilities are clamped to `[1e-6, 1 − 1e-6]` before computing entropies.

### Policies (`core/policies`)

All policies take one surrogate fit as input and never refit per candidate.

| Policy | Definition |
|---|---|
| NE | max entropy of `p_i` |
| BALD | predictive entropy − expected entropy (20-point Gauss–Hermite quadrature over `f_i`) |
| LE | distance-weighted average entropy over other nodes, weight `1/d`, normalised by the sum of weights (matches `local_entropy.py`) |
| DC | highest degree (non-adaptive) |
| RI | random neighbour of a known-infected node, else random |
| Random | uniform over untested nodes |

Ties are broken randomly using a seeded RNG.

## 4. Gameplay

### Led round

1. A player enters a nickname (duplicates get a suffix) and waits in the lobby.
2. The presenter opens a round. Every player gets the same graph, hidden outbreak, budget (default ~20% of nodes) and **pre-revealed seed node**.
3. Clicking an untested node reveals it (red = infected, blue = not) and refits the surrogate. There is no undo. The budget counter decrements.
4. Display aids:
   - **Predictions toggle** (player-controlled, always available): shades unobserved nodes by `p`.
   - **Uncertainty toggle** (only active while predictions are on): entropy halo.
   - **Hover:** neighbour highlight, plus hop-distance rings (1/2/3+) with counts.
   - **Community tint** for SBM graphs: on or off as a per-round setting.
   - Use of the two toggles is logged and shown as 👁 on the leaderboard.
5. When the budget is spent, the results screen shows:
   - final Accuracy, AUC and learning-curve area, plus rank;
   - the true outbreak overlaid on the model's final map, with errors highlighted;
   - the player's learning curve vs the bots.

   The UI text makes clear that **you choose where to test; the model does the mapping**.
6. The presenter closes the round. Unfinished plays are marked DNF and excluded from the ranking.

Late joiners may join an open round.

### Free play

Free play is available whenever no led round is open. The player picks any preset, and each attempt draws one of ~10 precomputed outbreaks. There is one leaderboard per preset, ranked by **Δ vs LE on the same outbreak**.

### Scoring

All metrics are computed on **unobserved nodes only**, using the model's `p`. **The primary metric is ROC-AUC, as in the paper** (posterior P(infected) vs true status):

- **AUC (default ranking):** after the final test. `null` if the unobserved nodes are all one class (rare at 25–50% prevalence). Such plays are ranked last for that metric.
- **Learning-curve AUC:** mean AUC over steps 1…B (undefined steps skipped). This mirrors the paper's AUC-vs-r curves.
- **Accuracy (secondary display only):** threshold 0.5. It is shown because it is intuitive, but it is not the default ranking. It penalises sampling bias: players who only test next to known infections get maps that over-predict infection (RI bot: AUC 0.92 but accuracy 0.61 after 20 tests). This is a teaching point about reactive testing.

The presenter can switch the ranking metric per round, but AUC is the default. Prior calibration, bot summaries and free play's Δ vs LE all use AUC.

### Bots

- Bots are **precomputed offline and stored. Nothing about them is computed live.**
- `build_bots.ts` runs the same `core/` code in Node for every precomputed configuration (preset × outbreak × seed node × budget).
- Policies: LE, NE, BALD, DC, RI, and Random (200 runs → mean and 90% band).
- Output: `bots.json` (picks, per-step curves, final metrics), bundled with the app.
- The board, results screen and free-play Δ vs LE all read from `bots.json`.
- A led round can only use precomputed configurations, so the presenter picks from a menu.
- Bots appear on the board as 🤖 rows, **hidden by default** with a reveal toggle.

### Board

- The live leaderboard (ranking metric chosen by the presenter, with hide-row moderation).
- Learning curves: faint per-human lines, a bold human median, and coloured bot curves.
- A "where did people test first?" heatmap on the graph.

## 5. Presets & visuals

The first preset is a **10×10 grid** (100 nodes, node id = row·10 + col), chosen for interpretability. Later presets are added to the builder's registry:

| Preset | Size | Status |
|---|---|---|
| 10×10 grid | 100 nodes | first, in Plan 1 |
| Barabási–Albert | ~40 nodes | later |
| SBM, high modularity | ~45 nodes, 3 communities | later |
| SBM, low modularity | ~45 nodes | later |

- Layouts are hand-curated, fixed and precomputed (few edge crossings, no live physics). The grid uses its own coordinates. Non-grid graphs have 20–50 nodes.
- Outbreaks are simulated with the repo's `simulate_binary_outbreak` and curated for 25–50% prevalence and an interesting spatial pattern.
- Each preset ships with 10 `game` outbreaks (each with a seed node) and 20 `calib` outbreaks used only for prior calibration.

## 6. Data & sync (Supabase)

**`rounds`:** `id, preset_id, outbreak_id, budget, seed_node, rank_metric, tint, status (draft|open|closed), opened_at, closed_at`

**`plays`:** `id, round_id (null = free play), preset_id, outbreak_id, player_id (random UUID in localStorage), nickname, picks int[], used_predictions bool, used_uncertainty bool, finished bool, hidden bool, created_at`

- Plays submit **picks only**. The board replays the picks through `core/` to compute all metrics, so client-submitted scores are never trusted.
- Realtime:
  - players subscribe to `rounds`;
  - the board subscribes to `plays`.
- Security:
  - Anonymous users may insert and read `plays` and read `rounds`.
  - Presenter actions (round changes, hiding rows) go through `SECURITY DEFINER` functions that check a hashed PIN.
- Accepted risk: the true outbreak is bundled client-side (lightly obfuscated). Recomputing scores on the board prevents fake scores.

## 7. Failure handling

| Failure | Behaviour |
|---|---|
| Wifi drops mid-play | Play continues (all compute is local); the finished play is queued in localStorage and retried on reconnect |
| Page refresh | In-progress play restored from localStorage |
| Supabase unavailable | Solo play still works; the leaderboard degrades. Backup: recorded run-through video for the talk |
| Newton non-convergence / Cholesky failure | Step-halving / diagonal jitter |
| Undefined AUC | `null`, ranking falls back to accuracy |

## 8. Testing

- **`core/` unit tests (Vitest):**
  - Laplace posterior vs brute-force numerical integration on a 3-node graph;
  - policy picks vs the repo's Python policies on fixed inputs;
  - metrics vs sklearn reference values.
- **Validation script** (`offline/validate_surrogate.py`): the browser surrogate vs NumPyro MCMC under (a) the same fixed priors and (b) the paper's priors. It reports MAE, r, NE/LE top-5 agreement and LE rank correlation, plus a scatter plot for the talk.
- **Load test:** 30 simulated concurrent players submitting plays.
- **Dress rehearsal:** 2–3 colleagues play a full led round on laptops.

## 9. Timeline

| Day (from Nov 1) | Work |
|---|---|
| 1 | Benchmark spike; Python preset/outbreak builder |
| 2–3 | `core/` + tests; validation notebook |
| 4–5 | Player view: rendering, hover, toggles, results |
| 6 | Supabase schema, sync, presenter view |
| 7 | Board; `build_bots.ts` |
| 8 | Free play, offline handling, polish, deploy |
| 9 | Load test, dress rehearsal, fixes — **code freeze** |
| 10–11 | Buffer / talk prep |

RL is parked until after code freeze. `core/` is designed to serve as its environment.
