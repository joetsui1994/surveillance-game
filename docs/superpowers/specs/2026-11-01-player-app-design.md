# Surveillance Game: Player App Design (Plan 2)

**Date:** 2026-11-01
**Parent spec:** `2026-11-01-surveillance-game-design.md`. This document refines §4 (gameplay) and §5 (visuals) for the single-player app.
**Mockups (outside the repo):** `ICID2026/workshop/.superpowers/brainstorm/87002-1793546512/content/` (`grid-style.html`, `uncertainty-v2.html`, `screens-v3.html`).

## 1. Scope

A single-player web app that is fully playable on one laptop with **no backend**:

- start screen → play screen → results screen;
- free play on any preset (currently only `grid10`), drawing a random `game` outbreak each time.

Plan 3 adds multiplayer (Supabase, presenter, board) on top of the same game session and views.

**Out of scope for Plan 2:**
- multiplayer, leaderboard and presenter controls (Plan 3);
- step-by-step replay of a finished game (cut, possible later polish);
- community tint (no SBM presets yet).

## 2. Tech

- **Vite + React + TypeScript,** in the existing repo. The app code lives in `src/app/`, and the engine stays in `src/core/`.
- **Rendering:** hand-written SVG. No chart or graph libraries.
- **Static data:** `public/data/presets.json` and `bots.json` are fetched at startup.
- **Persistence:** `localStorage` holds the nickname and the in-progress game, so a page refresh resumes play (parent spec §7).
- **Tests:**
  - Vitest for pure logic (session, scales, label layout);
  - `@testing-library/react` + jsdom for component behaviour;
  - a manual browser check of each screen.

## 3. Game session (pure, testable, transport-agnostic)

`src/app/session.ts` holds a pure state machine with no React and no DOM:

- `startSession(preset, outbreak, budget)` → state containing:
  - observations (the seed node pre-revealed);
  - picks;
  - the current posterior;
  - flags for whether the prediction and uncertainty toggles have ever been used.
- `pick(state, node)` → new state. It rejects observed or out-of-range nodes and any pick once the budget is spent, then refits the surrogate.
- `isFinished(state)`, and `result(state)` → `Trajectory` (via `replay`) plus `aucArea`.
- `serialize` / `deserialize` for localStorage.

Plan 3 will submit `picks` from this state; nothing else needs to change.

**Budget:** default 10 tests per game (10% of the grid), set in `presets.json` as `defaultBudget`. Bots cover up to `maxBudget` = 30, so any budget up to 30 works without recomputing.

## 4. Engine addition

`src/core/entropy.ts` gains `probabilityStd(mean, variance)`: the posterior standard deviation of P(infected) = σ(f) with f ~ N(mean, variance). It uses the existing 20-point Gauss–Hermite rule and is tested against Monte Carlo. This is the **uncertainty** shown to players.

## 5. Play screen

Layout: a header bar, the graph on the left, and a side panel on the right.

**Header:** the game name, preset and outbreak, the player's nickname, and the tests left (dots plus "4 / 10").

**Graph (style A, nodes and edges):**
- **Edges:** grey (#9e9e9e), 1.5 px.
- **Nodes:** r = 9 in a 330-unit viewBox (scaled to the panel).
- **Untested nodes, predictions on:**
  - fill is a diverging blue–white–red scale for P(infected), **stretched** over [0.35, 0.65] and clamped outside it;
  - with the toggle off, the fill is neutral grey (#e8e8e8).
- **Tested nodes:** solid red (#c62828) or blue (#1565c0), a black 2.5 px outline, and a white **+ / −** symbol, so identity never relies on colour alone.
- **Uncertainty toggle** (it switches predictions on if needed):
  - each untested node gets an orange (#ef6c00) ring;
  - width 0.5–5.5 px and opacity 0.25–0.95, scaled **relative** (min–max across untested nodes) to `probabilityStd`.
- **Hover (always on):**
  - the hovered node gets a thick outline;
  - nodes within 3 hops keep full opacity, with outline weight decreasing by hop (1 > 2 > 3);
  - nodes more than 3 hops away fade to 25% opacity.
- **Click** an untested node to test it. Tested nodes and finished games ignore clicks.

**Side panel:**
1. **Toggles:** Predictions; Uncertainty.
2. **Hover box:**
   - untested node: "P(infected) ≈ 0.58 ± 0.39", "Uncertainty rank 12 of 89", and "1-hop: 4 · 2-hop: 8 · 3-hop: 12";
   - tested node: its result.
3. **Collapsible explainer, "What do the colours mean?":**
   - +/− markers show tested locations;
   - shading is the model's best guess of P(infected);
   - rings show how unsure the model is, meaning **the width of its posterior belief about P(infected)**;
   - a two-density illustration with the same mean 0.5: a narrow spike ("confident it's 50/50", no ring) and a broad curve ("no idea", thick ring);
   - a note that rings are relative.
4. **Footnote:** "No live score during play. You choose where to test; the model does the mapping."

**There is no live score during play**, because AUC uses the true outbreak and would leak it.

## 6. Results screen

**Left: the true outbreak map.**
- Fill shows true status: pale red/blue for untested nodes, solid for tested.
- The player's tests are marked +/−.
- A **✕** marks untested nodes where the model's final p was on the wrong side of 0.5.

**Right:**
- **Scores:**
  - **AUC** is the hero number, labelled "AUC (paper metric)";
  - **learning-curve AUC** is secondary;
  - **accuracy** is small and muted.
- **Chart: "How good was the model's map after each test?"**
  - Subtitle: "AUC on untested locations (the paper's metric) · higher is better".
  - Y axis 0.5–1.0; X axis "tests used (0 = starting location only)".
  - **Series:**

    | Series | Colour | Line |
    |---|---|---|
    | You | ink #0b0b0b | 3 px |
    | LE | green #008300 | 2 px |
    | NE | violet #6250d6 | 2 px |
    | Random | grey #8a8984 | dashed mean, plus a 90% band at 16% opacity |

    LE/NE pass the dataviz palette validator (CVD, normal-vision, ≥ 3:1 contrast). None of these hues clash with the red/blue/orange used on the graph.
  - **Legend:** a row above the plot, always present.
  - **Direct labels:** at the right-hand ends of the lines, outside the plot, with leader lines. Labels are nudged at least 14 px apart and kept inside the plot height.
  - **Hover:** a crosshair, with a tooltip listing every series at that step. The tooltip flips side past 55% of the width.
- ~~**Verdict line**~~: removed on 2026-11-10 at the user's request; the chart now also shows BALD and DC (degree).
- **Button:** "Play another outbreak".

**Bots used here:** precomputed curves from `bots.json` for the same preset and outbreak, truncated to the player's budget.

## 7. Start screen

- **Nickname:** entered once and remembered.
- **Preset picker:** one card per preset (only "10×10 grid" for now).
- **Play** draws a random `game` outbreak, avoiding the previous one when possible.
- **Short rules:** "You have N tests. A starting location is already tested. Choose where to test next; the model maps the rest. Scored by AUC."

## 8. Accessibility & readability

- **Text contrast:** all text meets WCAG AA on its background, with explicit text colours (no inherited pale text).
- **Tested results:** shown by symbol as well as colour.
- **Chart:** the series palette is validated, text uses text colours (never series colours), and the legend is always present.

## 9. Testing

- **`session.ts`:**
  - start state;
  - pick validation (observed, out of range, after budget);
  - finished state;
  - result equals `replay`;
  - serialize round-trip.
- **`probabilityStd`:** zero when variance is 0, agreement with Monte Carlo, and symmetry in the mean.
- **Scales and layout helpers:**
  - prediction colour clamping;
  - relative ring scaling (all-equal SDs give no NaN);
  - label nudging (no overlaps, stays in bounds).
- **Components (RTL):**
  - clicking a node triggers a pick and the budget decrements;
  - the toggles change the fill;
  - the results screen renders the scores and four legend entries.
- **Manual check:** play one full game in the browser and compare against the mockups.
