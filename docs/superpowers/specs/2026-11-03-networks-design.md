# Surveillance Game: More Networks (Plan 4)

**Date:** 2026-11-03
**Parent specs:** `2026-11-01-surveillance-game-design.md` (§5 presets) and `2026-11-02-multiplayer-design.md`. This document replaces parent §5's "later" rows.

## 1. Scope

Ship four networks, each with round, free and calibration outbreaks, a calibrated prior and precomputed bots. Layouts are made in a repeatable, hand-fixable way.

**Out of scope:**
- drawing communities (no tint or hulls; `communities` stays data only);
- network types beyond the four below;
- any change to the backend or rounds.

No app UI changes are needed: the start screen, presenter drawer, calibration and bot scripts already loop over every preset.

## 2. Networks

| id | Shown as | Graph | Nodes |
|---|---|---|---|
| `grid10` | 10×10 grid | `grid_2d_graph(10, 10)`, **unchanged** | 100 |
| `ba40` | Hub network | Barabási–Albert, m = 2, fixed seed | 40 |
| `sbm45hi` | Three towns | SBM, 3 × 15 nodes, p_in ≈ 0.25, p_out ≈ 0.01 | 45 |
| `sbm45lo` | Mixed towns | SBM, 3 × 15 nodes, p_in ≈ 0.15, p_out ≈ 0.05 | 45 |

- Edge probabilities are starting points. The builder tries graph seeds in order and takes the first that meets all of these:
  - the graph is connected;
  - for `sbm45hi`, every pair of communities has 1–3 bridge edges;
  - for `sbm45lo`, the modularity of the planted partition is noticeably lower than for `sbm45hi`.
- `communities` holds the planted block for each node on the SBMs and `null` elsewhere.
- Nodes are labelled 0..n−1.

## 3. Outbreaks

- Every network gets 5 `round`, 5 `free` and 20 `calib` outbreaks, each with 25–50% prevalence and no duplicates. The existing `simulate_outbreaks` handles this.
- The simulator settings (`transmission_p`, `end_time`, `initial_infected_num`) are chosen per network. The target is a prevalence rate inside 25–50% that's high enough for the builder to find outbreaks quickly.
- The grid's settings and seed stay as they are. `grid10`'s outbreaks and bot results must stay byte-identical.
- To make that possible, each network gets its own fixed seed in the registry, instead of `seed + i`.

## 4. Budgets

- Default budget is `max(6, round(0.1·n))` and the maximum is `round(0.3·n)`.
- That gives:
  - `grid10`: 10 default / 30 max (unchanged);
  - `ba40`: 6 / 12;
  - the SBMs: 6 / 14.

## 5. Layouts

Positions don't enter the model. So a layout can change at any time without changing outbreaks, priors or bots.

### 5.1 Files

- Each non-grid network has a layout file, `offline/layouts/<id>.json`, committed to git:
  ```json
  { "id": "ba40", "edges": [[0, 1], ...], "layout": [[x, y], ...], "source": "search:kk:seed=17" }
  ```
- The positions are in [0, 1]². `source` is either the search candidate it came from or `"edited"`.
- `build_presets.py` uses the file if it exists. If the file's `edges` differ from the graph it just built, the builder fails with a clear message, so a layout is never applied to the wrong graph.
- If no file exists, the builder fails and says to run the layout search first.
- The grid keeps its computed coordinates and has no file.

### 5.2 Search: `offline/layout_search.py`

- Usage: `npm run data:layout -- <id> [--pick N]`.
- The script builds the graph, then generates candidates:
  - Kamada–Kawai;
  - spring layouts over several `k` values, iteration counts and 50 seeds;
  - for SBMs, a sector layout: each community is spring-laid separately, then placed in its own third of the square.
- Each candidate is rescaled to fill [0, 1]² and scored in rendered pixels. The game draws nodes with radius 9 in a 280 px square, so 1 layout unit = 280 px. Penalties, in lexical order of importance:
  1. node pairs closer than 26 px between centres;
  2. a node closer than 12 px to an edge it isn't part of;
  3. edge crossings;
  4. spread of edge lengths (coefficient of variation).
- Output:
  - `offline/out/layouts/<id>.png`: a contact sheet of the top 12 candidates, numbered, with their scores, drawn in the game's style (grey nodes, thin edges);
  - `--pick N` writes candidate N to `offline/layouts/<id>.json`. Without it the script only writes the sheet.

### 5.3 Editor: `#/layout` (dev only)

- A page in the Vite app, routed only when `import.meta.env.DEV`. It's tree-shaken out of production builds, and the build must not contain the editor's strings.
- The page has:
  - a picker for the network;
  - the graph drawn by `GraphView`'s own geometry (same `VIEW`, `PAD` and `R`);
  - drag-to-move nodes, kept inside [0, 1]²;
  - a live readout of the §5.2 penalties, with offending nodes and edges outlined in red;
  - **Save**: POSTs `{ id, layout }` to a Vite dev-server endpoint, `/__layout/save`. The endpoint:
    - is a plugin in `vite.config.ts` with `apply: 'serve'`;
    - only writes `offline/layouts/<id>.json` for ids matching `^[a-z0-9]+$`;
    - keeps the file's `edges`, replaces `layout` and sets `source: "edited"`.
  - **Revert**: reloads the file.
- The editor reads its graphs from the current `presets.json`. After saving, `npm run data:presets` copies the layout into `presets.json`. Priors and bots don't need rebuilding, but `npm run data` is still safe to run.

## 6. Pipeline

1. `npm run data:layout -- <id>`, then look at the sheet and run `--pick N` (once per network).
2. Optionally, fix nodes by dragging them in `#/layout`.
3. `npm run data`: rebuilds presets, recalibrates priors for every network and precomputes the bots.
4. Commit `offline/layouts/*.json`, `public/data/presets.json` and `public/data/bots.json`.

- `bots.json` is expected to grow from about 210 KB to about 600 KB.

## 7. Checks

- **Builder:**
  - each graph is connected;
  - the layout's edges match the graph;
  - prevalence is in range;
  - outbreaks aren't duplicated;
  - the zero-tolerance penalties are met: no node pairs under 26 px and no node within 12 px of a foreign edge.
- **Vitest:**
  - `public/data/presets.json` parses;
  - it has the four ids;
  - each one has 5/5/20 outbreaks;
  - `bots.json` has every policy for each `round`/`free` outbreak of each network;
  - layout coordinates are in [0, 1];
  - the minimum node gap is ≥ 26 px at render scale.
- **Vitest (editor):**
  - the penalty functions on small hand-made layouts (a crossing, an overlap, a node on an edge);
  - the save endpoint's path guard.
- **Sanity:** `data:bots` prints the mean AUC for each policy and network. LE must beat Random's mean on each network after the default budget. If not, retune that network's outbreak settings (§3) before committing.
- **By eye:** check each network in the browser at laptop and projector sizes. That covers play, results, the board's replay, and the uncertainty rings.

## 8. Rollout

- This is data plus a dev-only page, so it's safe to deploy before the dry run (by 2026-11-09).
- Round and play rows reference `(preset_id, outbreak_id)`. `grid10` ids don't change, so existing rows still replay.
- Truncating the tables before the workshop is still recommended.
