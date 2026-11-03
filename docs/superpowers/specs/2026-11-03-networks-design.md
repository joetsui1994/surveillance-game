# Surveillance Game: More Networks (Plan 4)

**Date:** 2026-11-03
**Parent specs:** `2026-11-01-surveillance-game-design.md` (§5 presets) and `2026-11-02-multiplayer-design.md`. This document replaces parent §5's "later" rows.

## 1. Scope

Ship four networks, each with round, free and calibration outbreaks, a calibrated prior and precomputed bots. Layouts are made in a repeatable, hand-fixable way.

**Out of scope:**
- drawing communities (no tint or hulls; `communities` stays data only);
- network types beyond the four below;
- any change to the backend or rounds.

The start screen, presenter drawer, calibration and bot scripts already loop over every preset. The only app UI change is the start screen, whose network cards become a 2-column grid so that four cards sit 2 × 2 instead of wrapping 3 + 1.

## 2. Networks

| id | Shown as | Graph | Nodes / edges |
|---|---|---|---|
| `grid10` | 10×10 grid | `grid_2d_graph(10, 10)`, **unchanged** | 100 / 180 |
| `ba40` | Hub network | Barabási–Albert tree (m = 1) plus 12 triangle-closing edges | 40 / 51 |
| `sbm45hi` | Three towns | SBM, 3 × 15 nodes, p_in 0.20, p_out 0.01; 1–3 bridges per town pair | 45 / 70 |
| `sbm45lo` | Mixed towns | SBM, 3 × 15 nodes, p_in 0.20, p_out 0.04 | 45 / 82 |

**Why these densities.** Prototyping showed that BA with m = 2 and the denser SBM settings (0.30 inside a town) can't be drawn cleanly: they kept 73–111 crossings even after layout optimisation. The sparser versions draw with about 0–20 crossings.

Mixed towns keeps its density on purpose. It's meant to look busy, in contrast to Three towns.

**How graphs are built:**
- All graph code lives in `offline/networks.py`.
- Each builder tries graph seeds 0, 1, … and takes the first graph that is connected and passes the network's own check. Three towns requires 1–3 bridges between every pair of towns.
- `communities` holds each node's planted town on the SBMs and is `null` elsewhere.
- Nodes are labelled 0..n−1.

## 3. Outbreaks

- Every network gets 5 `round`, 5 `free` and 20 `calib` outbreaks, each with 25–50% prevalence and no duplicates. The existing `simulate_outbreaks` handles this.
- The simulator settings are set per network, along with a fixed outbreak seed per network. The grid keeps its old settings and seed, so its outbreaks and bot results stay byte-identical. That was checked in the prototype.

| id | `end_time` | `transmission_p` | seed | outbreaks in range (prototype) |
|---|---|---|---|---|
| `grid10` | 8 | 0.25 | 20261112 | as before |
| `ba40` | 6 | 0.3 | 20261113 | 42% |
| `sbm45hi` | 6 | 0.3 | 20261114 | 49% |
| `sbm45lo` | 4 | 0.3 | 20261115 | 41% |

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

**Usage:** `npm run data:layout -- <id> [--pick N]`.

**Steps:**
1. Raw candidates:
   - For networks with towns (`towns=True`, i.e. Three towns): 20 seeds of a town layout. Each town is spring-laid at one corner of a triangle, then the whole graph is relaxed briefly.
   - For the other networks: Kamada–Kawai and spring layouts (3 `k` values), each over 20 seeds.
2. Each candidate is rescaled to fill [0, 1]², keeping its aspect ratio.
3. The best 16 raw candidates are **refined**. Refinement is simulated annealing over single-node moves (20,000 steps) that minimises a weighted cost. Hard faults dominate the cost, then crossings, then uneven edge lengths.
4. The refined candidates are ranked, and the top 12 go on the contact sheet.

**Penalties.** These are measured in rendered pixels: the game draws [0, 1]² into 280 px, with node radius 9. In lexical order of importance:
1. `close`: node pairs closer than **28 px** centre to centre. Uncertainty rings reach about 15 px from a node's centre.
2. `onEdge`: a node closer than **14 px** to an edge it isn't part of.
3. `strays` (towns only): a node that is not at least **60 px** nearer its own town's centre than any other town's centre. This is what keeps three separate clumps readable in grey.
4. `crossings`.
5. `lengthCv`: the spread of edge lengths.

**Output:**
- `offline/out/layouts/<id>.png`: a contact sheet of the numbered top 12, drawn in the game's grey;
- `offline/out/layouts/<id>.json`: the candidates. `--pick N` saves candidate N from this file into `offline/layouts/<id>.json`, so picking doesn't re-run the search.

**Prototype results for the best candidate:**
- Hub network: 0 crossings.
- Three towns: 19 crossings, towns clearly separate.
- Mixed towns: 75 crossings.
- All three: no overlaps and no nodes on edges.

### 5.3 Editor: `#/layout` (dev only)

- A page in the Vite app, routed only when `import.meta.env.DEV`. It's tree-shaken out of production builds, and the build must not contain the editor's strings.
- The page has:
  - a picker for the network;
  - the graph drawn by `GraphView`'s own geometry (same `VIEW`, `PAD` and `R`);
  - drag-to-move nodes, kept inside [0, 1]²;
  - a live readout of overlaps, nodes on edges and crossings, with offending nodes and edges outlined in red. The geometry is in `src/core/layoutQuality.ts` and mirrors the Python;
  - a "Colour by community" toggle on the town networks, for editing only;
  - **Save**: POSTs `{ id, layout }` to a Vite dev-server endpoint, `/__layout/save`. The endpoint:
    - is a plugin in `vite.config.ts` with `apply: 'serve'`;
    - only writes `offline/layouts/<id>.json` for ids matching `^[a-z0-9]+$`;
    - keeps the file's `edges`, replaces `layout` and sets `source: "edited"`.
  - **Revert**: reloads the file.
- The editor reads its graphs from the current `presets.json`. After saving, `npm run data:presets` copies the layout into `presets.json`.
- `build_presets.py` keeps each network's calibrated prior when that network's edges and outbreaks are unchanged. So a layout-only rebuild doesn't reset priors, and bots don't need rebuilding. The prototype found that without this, `data:presets` silently reset every prior to the default.

## 6. Pipeline

1. `npm run data:layout -- <id>`, then look at the sheet and run `--pick N` (once per network).
2. Optionally, fix nodes by dragging them in `#/layout`.
3. `npm run data`: rebuilds presets, recalibrates priors for every network and precomputes the bots.
4. Commit `offline/layouts/*.json`, `public/data/presets.json` and `public/data/bots.json`.

- `bots.json` grows from 213 KB to about 500 KB.

## 7. Checks

- **Builder:**
  - each graph is connected;
  - a missing layout file fails with the command to run;
  - the layout's edges match the graph;
  - prevalence is in range;
  - outbreaks aren't duplicated;
  - the zero-tolerance penalties are met: no node pairs under 28 px and no node within 14 px of a foreign edge.
- **Vitest:**
  - `public/data/presets.json` parses;
  - it has the four ids;
  - each one has 5/5/20 outbreaks;
  - `bots.json` has every policy for each `round`/`free` outbreak of each network;
  - layout coordinates are in [0, 1];
  - no overlapping nodes or nodes on edges (`layoutFaults`);
  - `communities` is set only on the town networks.
- **Vitest (editor):**
  - the penalty functions on small hand-made layouts (a crossing, an overlap, a node on an edge);
  - the save endpoint's path guard.
- **Sanity:** `data:bots` prints the mean AUC for each policy and network. LE must beat Random's mean on each network after the default budget. If not, retune that network's outbreak settings (§3) before committing.
- **Prototype results** (LE vs Random, AUC after the default budget):
  - grid: 0.952 vs 0.907;
  - Hub network: 0.896 vs 0.883;
  - Three towns: 0.863 vs 0.819;
  - Mixed towns: 0.736 vs 0.696.
- On Hub network, the degree heuristic DC (0.936) beats LE. This is expected on hub-dominated graphs and is a talking point for the board; no change is needed.
- **By eye:** check each network in the browser at laptop and projector sizes. That covers play, results, the board's replay, and the uncertainty rings.

## 8. Rollout

- This is data plus a dev-only page, so it's safe to deploy before the dry run (by 2026-11-09).
- Round and play rows reference `(preset_id, outbreak_id)`. `grid10` ids don't change, so existing rows still replay.
- Truncating the tables before the workshop is still recommended.
