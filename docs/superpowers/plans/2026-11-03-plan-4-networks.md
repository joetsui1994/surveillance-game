# More Networks (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three more networks (Hub network, Three towns, Mixed towns) alongside the 10×10 grid, with outbreaks, calibrated priors and bots, plus a repeatable layout workflow: a scored search with a contact sheet, and a dev-only drag-to-fix editor.

**Architecture:** `offline/networks.py` is the network registry: graphs, outbreak settings and layout files. `offline/layout_quality.py` scores layouts in rendered pixels and refines them by annealing, and `offline/layout_search.py` writes contact sheets and saves picks to `offline/layouts/<id>.json`. `build_presets.py` reads the registry and layouts. In the app, `src/core/layoutQuality.ts` mirrors the Python checks. The dev-only `#/layout` editor (lazy-loaded behind `import.meta.env.DEV`) saves through a Vite dev-server plugin.

**Tech stack:** Python 3.11 with networkx, numpy and matplotlib (via `uv`); TypeScript 7, React 19, Vite 8, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-03-networks-design.md`.

**Source of truth:** every file below was written and verified in a prototype first:
- 160 tests passed;
- the typecheck was clean;
- the production build contains no editor code;
- grid data is byte-identical to before;
- the editor was checked in Chrome: drag, faults, revert and save.

Copy code exactly. Generated data is deterministic; its expected MD5s are given in Tasks 2 and 3.

**Conventions:**
- Work on `main` in `surveillance-game/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Python commands run from the repo root via npm scripts or `uv run --project offline`.
- If the paper repo isn't next to the app: `export SURVEILLANCE_REPO=/Users/user/Documents/conferences-workshops/ICID2026/workshop/optimal-disease-surveillance-AL`.

---

### Task 1: Network registry and layout scoring (Python)

**Files:**
- Create: `offline/networks.py`
- Create: `offline/layout_quality.py`

- [ ] **Step 1: Create** `offline/networks.py` (complete file):

```python
"""The game's networks: graph builders, outbreak settings and layout files.

Graphs are deterministic (fixed seeds). Non-grid layouts live in offline/layouts/<id>.json, made by
layout_search.py and optionally hand-edited in the app's dev-only #/layout page.
"""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import networkx as nx
import numpy as np

LAYOUT_DIR = Path(__file__).resolve().parent / "layouts"

# Render geometry, matching src/app/components/GraphView.tsx (VIEW 330, PAD 25, node radius 9).
PX_PER_UNIT = 280
MIN_NODE_GAP_PX = 28  # centre to centre; uncertainty rings reach ~15 px from the centre
MIN_EDGE_CLEARANCE_PX = 14  # a node's centre to any edge it isn't part of
TOWN_MARGIN_PX = 60  # a town's node must be this much nearer its own town's centre than any other


@dataclass(frozen=True)
class Network:
    name: str
    build: Callable[[], nx.Graph]
    sim: dict  # simulate_binary_outbreak params
    seed: int  # outbreak RNG seed
    grid: tuple[int, int] | None = None  # rows, cols: layout computed rather than read from a file
    towns: bool = False  # lay communities out in separate regions


def grid_graph(rows, cols):
    g = nx.grid_2d_graph(rows, cols)
    return nx.relabel_nodes(g, {(r, c): r * cols + c for r, c in g.nodes})


def grid_layout(rows, cols):
    return [[(i % cols) / (cols - 1), (i // cols) / (rows - 1)] for i in range(rows * cols)]


SBM_SIZES = [15, 15, 15]


def sbm_blocks():
    return [b for b, size in enumerate(SBM_SIZES) for _ in range(size)]


def bridge_counts(g):
    """Edges between each pair of SBM blocks, in pair order (0,1), (0,2), (1,2)."""
    block = sbm_blocks()
    pairs = [(a, b) for a in range(len(SBM_SIZES)) for b in range(a + 1, len(SBM_SIZES))]
    counts = dict.fromkeys(pairs, 0)
    for u, v in g.edges:
        if block[u] != block[v]:
            counts[tuple(sorted((block[u], block[v])))] += 1
    return [counts[p] for p in pairs]


def first_seed(make, accept, tries=1000):
    """The first graph seed (0, 1, …) whose graph is connected and accepted."""
    for seed in range(tries):
        g = make(seed)
        if nx.is_connected(g) and accept(g):
            return g
    raise RuntimeError("no acceptable graph seed found")


def sbm(p_in, p_out, accept=lambda g: True):
    k = len(SBM_SIZES)
    probs = [[p_in if i == j else p_out for j in range(k)] for i in range(k)]
    g = first_seed(lambda s: nx.stochastic_block_model(SBM_SIZES, probs, seed=s), accept)
    return nx.Graph(g.edges)  # drop the SBM's graph/node attributes


def hub_graph(n, extra):
    """A Barabási–Albert tree (m = 1) plus `extra` triangle-closing edges: hubs, with a few short loops."""
    def make(seed):
        g = nx.barabasi_albert_graph(n, 1, seed=seed)
        rng = np.random.default_rng(seed)
        added = 0
        while added < extra:
            u = int(rng.integers(n))
            v = int(rng.choice(list(g[u])))
            w = int(rng.choice(list(g[v])))
            if w != u and not g.has_edge(u, w):
                g.add_edge(u, w)
                added += 1
        return g

    return first_seed(make, lambda g: True)


NETWORKS: dict[str, Network] = {
    "grid10": Network("10×10 grid", lambda: grid_graph(10, 10), {"end_time": 8, "transmission_p": 0.25, "initial_infected_num": 1}, 20261112, grid=(10, 10)),
    "ba40": Network("Hub network", lambda: hub_graph(40, 12), {"end_time": 6, "transmission_p": 0.3, "initial_infected_num": 1}, 20261113),
    "sbm45hi": Network(
        "Three towns",
        lambda: sbm(0.2, 0.01, accept=lambda g: all(1 <= c <= 3 for c in bridge_counts(g))),
        {"end_time": 6, "transmission_p": 0.3, "initial_infected_num": 1},
        20261114,
        towns=True,
    ),
    "sbm45lo": Network("Mixed towns", lambda: sbm(0.2, 0.04), {"end_time": 4, "transmission_p": 0.3, "initial_infected_num": 1}, 20261115),
}


def communities(pid):
    return sbm_blocks() if pid.startswith("sbm") else None


def sorted_edges(g):
    return sorted([min(a, b), max(a, b)] for a, b in g.edges)


def layout_path(pid):
    return LAYOUT_DIR / f"{pid}.json"


def load_layout(pid, g):
    """The saved layout for a non-grid network; fails if missing or made for a different graph."""
    path = layout_path(pid)
    if not path.exists():
        raise SystemExit(f"{pid}: no layout at {path}. Run: npm run data:layout -- {pid}  (then --pick N)")
    saved = json.loads(path.read_text())
    if saved["edges"] != sorted_edges(g):
        raise SystemExit(f"{pid}: {path.name} was made for a different graph; re-run the layout search")
    return saved["layout"]


def save_layout(pid, g, layout, source):
    LAYOUT_DIR.mkdir(parents=True, exist_ok=True)
    data = {"id": pid, "edges": sorted_edges(g), "layout": [[round(x, 4), round(y, 4)] for x, y in layout], "source": source}
    layout_path(pid).write_text(json.dumps(data) + "\n")


def network_layout(pid, g):
    net = NETWORKS[pid]
    return grid_layout(*net.grid) if net.grid else load_layout(pid, g)
```

- [ ] **Step 2: Create** `offline/layout_quality.py` (complete file):

```python
"""Layout penalties in rendered pixels; mirrored in src/core/layoutQuality.ts for the #/layout editor."""
import numpy as np

from networks import MIN_EDGE_CLEARANCE_PX, MIN_NODE_GAP_PX, PX_PER_UNIT, TOWN_MARGIN_PX


def normalise(pos):
    """Scale and centre positions to fill [0, 1]² while keeping the aspect ratio."""
    p = np.asarray(pos, dtype=float)
    p = p - p.min(axis=0)
    p = p / p.max(axis=0).max()
    return p + (1 - p.max(axis=0)) / 2


class Geometry:
    """Vectorised penalty terms for one graph; positions are n×2 arrays in [0, 1]²."""

    def __init__(self, n, edges, communities=None):
        self.n = n
        self.communities = None if communities is None else np.asarray(communities)
        self.edges = np.asarray(edges)
        a, b = self.edges[:, 0], self.edges[:, 1]
        # Node i vs edge (a, b), excluding the edge's own ends.
        self.node_edge = ~((np.arange(n)[:, None] == a) | (np.arange(n)[:, None] == b))
        # Edge pairs that share no endpoint.
        e = self.edges
        shared = (e[:, None, 0] == e[None, :, 0]) | (e[:, None, 0] == e[None, :, 1]) | (e[:, None, 1] == e[None, :, 0]) | (e[:, None, 1] == e[None, :, 1])
        self.edge_pairs = np.triu(~shared, 1)
        self.iu = np.triu_indices(n, 1)

    def close_pairs(self, px):
        d = np.linalg.norm(px[:, None] - px[None, :], axis=-1)
        return d[self.iu] < MIN_NODE_GAP_PX

    def node_edge_dist(self, px):
        a, b = px[self.edges[:, 0]], px[self.edges[:, 1]]
        ab = b - a
        t = np.clip(np.einsum("nek,ek->ne", px[:, None] - a[None], ab) / np.maximum(np.einsum("ek,ek->e", ab, ab), 1e-9), 0, 1)
        proj = a[None] + t[..., None] * ab[None]
        return np.linalg.norm(px[:, None] - proj, axis=-1)

    def crossing_matrix(self, px):
        p1, p2 = px[self.edges[:, 0]], px[self.edges[:, 1]]

        def orient(a, b, c):  # a, b: E×2 for one side; c: E×2 broadcast to E×E
            return np.sign((b[:, None, 0] - a[:, None, 0]) * (c[None, :, 1] - a[:, None, 1]) - (b[:, None, 1] - a[:, None, 1]) * (c[None, :, 0] - a[:, None, 0]))

        o1 = orient(p1, p2, p1) * orient(p1, p2, p2)  # edge i's line vs edge j's ends
        return (o1 < 0) & (o1.T < 0) & self.edge_pairs

    def penalties(self, layout):
        px = np.asarray(layout, dtype=float) * PX_PER_UNIT
        lengths = np.linalg.norm(px[self.edges[:, 0]] - px[self.edges[:, 1]], axis=1)
        return {
            "close": int(self.close_pairs(px).sum()),
            "onEdge": int(((self.node_edge_dist(px) < MIN_EDGE_CLEARANCE_PX) & self.node_edge).sum()),
            "crossings": int(self.crossing_matrix(px).sum()),
            "lengthCv": round(float(lengths.std() / lengths.mean()), 3),
            "strays": self.strays(px),
        }

    def strays(self, px):
        """Nodes not clearly in their own community: within TOWN_MARGIN_PX of being nearer another community's centre."""
        if self.communities is None:
            return 0
        ks = np.unique(self.communities)
        centres = np.array([px[self.communities == k].mean(axis=0) for k in ks])
        d = np.linalg.norm(px[:, None] - centres[None], axis=-1)
        own = d[np.arange(self.n), np.searchsorted(ks, self.communities)]
        other = np.where(ks[None] == self.communities[:, None], np.inf, d).min(axis=1)
        return int((own + TOWN_MARGIN_PX > other).sum())

    def cost(self, layout):
        """Scalar to minimise: hard faults dominate, then crossings, then uneven edges."""
        pen = self.penalties(layout)
        return 100 * pen["close"] + 30 * pen["onEdge"] + 30 * pen["strays"] + 10 * pen["crossings"] + 20 * pen["lengthCv"]


def penalties(layout, edges, communities=None):
    return Geometry(len(layout), edges, communities).penalties(layout)


def score_key(pen):
    """Lexical order: overlaps, nodes on edges, nodes strayed into another community, crossings, uneven edges."""
    return (pen["close"], pen["onEdge"], pen["strays"], pen["crossings"], pen["lengthCv"])


def refine(layout, edges, seed, communities=None, steps=20000):
    """Simulated annealing over single-node moves, kept inside [0, 1]²."""
    rng = np.random.default_rng(seed)
    geo = Geometry(len(layout), edges, communities)
    cur = np.asarray(layout, dtype=float).copy()
    cur_cost = geo.cost(cur)
    best, best_cost = cur.copy(), cur_cost
    for step in range(steps):
        frac = step / steps
        temp = 5 * (1 - frac) + 0.05
        radius = 0.12 * (1 - frac) + 0.01
        i = rng.integers(len(cur))
        old = cur[i].copy()
        cur[i] = np.clip(old + rng.normal(0, radius, 2), 0, 1)
        c = geo.cost(cur)
        if c <= cur_cost or rng.random() < np.exp((cur_cost - c) / temp):
            cur_cost = c
            if c < best_cost:
                best, best_cost = cur.copy(), c
        else:
            cur[i] = old
    return normalise(best)
```

- [ ] **Step 3: Smoke check**

Run:
```bash
cd offline && uv run --project . python -c "
from networks import NETWORKS, bridge_counts, grid_layout, sorted_edges
from layout_quality import penalties
for pid, net in NETWORKS.items():
    g = net.build(); print(pid, g.number_of_nodes(), g.number_of_edges())
print('bridges', bridge_counts(NETWORKS['sbm45hi'].build()))
g = NETWORKS['grid10'].build(); print(penalties(grid_layout(10, 10), sorted_edges(g)))
"; cd ..
```
Expected:
```
grid10 100 180
ba40 40 51
sbm45hi 45 70
sbm45lo 45 82
bridges [2, 3, 1]
{'close': 0, 'onEdge': 0, 'crossings': 0, 'lengthCv': 0.0, 'strays': 0}
```

- [ ] **Step 4: Commit**
```bash
git add offline/networks.py offline/layout_quality.py
git commit -m "feat(offline): network registry and layout scoring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Layout search, contact sheet, saved layouts

**Files:**
- Create: `offline/layout_search.py`
- Modify: `package.json` (add `data:layout`)
- Create (generated): `offline/layouts/ba40.json`, `offline/layouts/sbm45hi.json`, `offline/layouts/sbm45lo.json`

- [ ] **Step 1: Create** `offline/layout_search.py` (complete file):

```python
"""Search candidate layouts for a network and write a contact sheet; --pick N saves candidate N.

Raw layouts (Kamada–Kawai and spring over many seeds; per-town regions for networks with towns) are
ranked, and the best are refined by simulated annealing to remove overlaps and crossings.

Usage: npm run data:layout -- <id> [--pick N]
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import networkx as nx  # noqa: E402
import numpy as np  # noqa: E402

from layout_quality import Geometry, normalise, refine, score_key  # noqa: E402
from networks import NETWORKS, communities, save_layout, sorted_edges  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out" / "layouts"
SEEDS = range(20)
SPRING_K = [None, 1.0, 2.0]  # multiples of 1/sqrt(n); None = networkx default
REFINE = 16  # raw candidates refined
TOP = 12  # candidates on the contact sheet


def town_layout(g, blocks, seed):
    """Spring-lay each town separately at the corners of a triangle, then relax the whole graph briefly."""
    centres = [(0.5, 0.0), (0.0, 0.9), (1.0, 0.9)]
    pos = {}
    for b, (cx, cy) in enumerate(centres):
        nodes = [v for v in g.nodes if blocks[v] == b]
        sub = nx.spring_layout(g.subgraph(nodes), seed=seed, iterations=200)
        for v, (x, y) in sub.items():
            pos[v] = (cx + 0.32 * x, cy + 0.32 * y)
    return nx.spring_layout(g, pos=pos, seed=seed, iterations=15, k=1.5 / np.sqrt(g.number_of_nodes()))


def raw_candidates(g, blocks):
    n = g.number_of_nodes()
    for seed in SEEDS:
        if blocks is not None:
            yield f"towns:seed={seed}", town_layout(g, blocks, seed)
            continue
        yield f"kk:seed={seed}", nx.kamada_kawai_layout(g, pos=nx.random_layout(g, seed=seed))
        for mult in SPRING_K:
            k = None if mult is None else mult / np.sqrt(n)
            yield f"spring:k={mult}:seed={seed}", nx.spring_layout(g, seed=seed, k=k, iterations=500)


def search(pid):
    net = NETWORKS[pid]
    g = net.build()
    n = g.number_of_nodes()
    edges = sorted_edges(g)
    blocks = communities(pid) if net.towns else None
    geo = Geometry(n, edges, blocks)
    raw = []
    for source, pos in raw_candidates(g, blocks):
        layout = normalise([pos[v] for v in range(n)])
        raw.append((score_key(geo.penalties(layout)), source, layout))
    raw.sort(key=lambda c: c[0])
    found = []
    for i, (_, source, layout) in enumerate(raw[:REFINE]):
        refined = refine(layout, edges, seed=i, communities=blocks)
        found.append({"source": f"{source}+refine", "layout": refined.tolist(), "penalties": geo.penalties(refined)})
    found.sort(key=lambda c: score_key(c["penalties"]))
    return g, found[:TOP]


def contact_sheet(pid, g, top, path):
    cols = 4
    rows = (len(top) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(4 * cols, 4.4 * rows))
    for i, ax in enumerate(np.ravel(axes)):
        ax.axis("off")
        if i >= len(top):
            continue
        p = np.array(top[i]["layout"])
        for a, b in g.edges:
            ax.plot(*p[[a, b]].T, color="#c9c7c0", lw=1.2, zorder=1)
        ax.scatter(*p.T, s=90, c="#8a8984", edgecolors="white", linewidths=1, zorder=2)
        ax.set_xlim(-0.06, 1.06)
        ax.set_ylim(1.06, -0.06)
        ax.set_aspect("equal")
        pen = top[i]["penalties"]
        ax.set_title(f"#{i}  crossings {pen['crossings']} · close {pen['close']} · on-edge {pen['onEdge']} · strays {pen['strays']}\n{top[i]['source']}", fontsize=8)
    fig.suptitle(f"{pid}: top {len(top)} layouts (best first)")
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=90, bbox_inches="tight")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", choices=[k for k, v in NETWORKS.items() if v.grid is None])
    ap.add_argument("--pick", type=int, help="save candidate N from the last search (re-runs it if missing)")
    args = ap.parse_args()
    cache = OUT_DIR / f"{args.id}.json"
    if args.pick is not None and cache.exists():
        g, top = NETWORKS[args.id].build(), json.loads(cache.read_text())
    else:
        g, top = search(args.id)
        sheet = OUT_DIR / f"{args.id}.png"
        contact_sheet(args.id, g, top, sheet)
        cache.write_text(json.dumps(top))
        print(f"Wrote {sheet}")
        for i, c in enumerate(top):
            print(f"  #{i:<2} {c['penalties']}  {c['source']}")
    if args.pick is not None:
        c = top[args.pick]
        save_layout(args.id, g, c["layout"], f"search:{c['source']}")
        print(f"Saved #{args.pick} to offline/layouts/{args.id}.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Add the npm script.** In `package.json`, insert this line directly above `"data:presets"`:
```json
    "data:layout": "uv run --project offline python offline/layout_search.py",
```
- [ ] **Step 3: Run the search and pick candidate #0 for each network.** This takes about a minute per network; run them in parallel:
```bash
for id in ba40 sbm45hi sbm45lo; do npm run data:layout -- $id < /dev/null & done; wait
for id in ba40 sbm45hi sbm45lo; do npm run data:layout -- $id --pick 0; done
md5 -r offline/layouts/*.json   # Linux: md5sum
```
Expected best candidates:
- `ba40` #0: 0 crossings;
- `sbm45hi` #0: 19 crossings, 3 strays;
- `sbm45lo` #0: 75 crossings;
- all with close 0 and onEdge 0.

Expected MD5s:
```
a196193f1421861aa95dd6ca663ef78e offline/layouts/ba40.json
6474c1d8700e31ba705aaed784c6eb80 offline/layouts/sbm45hi.json
612fdcd3047cd11b25e40377ba8442dc offline/layouts/sbm45lo.json
```
If an MD5 differs, the code was not copied exactly. Diff it against this plan before continuing. (`offline/out/` is git-ignored.)

- [ ] **Step 4: Commit**
```bash
git add offline/layout_search.py package.json offline/layouts
git commit -m "feat(offline): layout search with annealing refinement, contact sheets and saved layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Builder uses the registry; regenerate data

**Files:**
- Modify: `offline/build_presets.py`
- Regenerate: `public/data/presets.json`, `public/data/bots.json`

- [ ] **Step 1: Apply this change to `offline/build_presets.py`.** It replaces the `PRESETS` registry with `networks.py`, adds a per-network seed and the budget floor, and keeps calibrated priors when a network's edges and outbreaks are unchanged:

```diff
diff --git a/offline/build_presets.py b/offline/build_presets.py
index 0c076b1..a3c5272 100644
--- a/offline/build_presets.py
+++ b/offline/build_presets.py
@@ -12,6 +12,9 @@ from pathlib import Path
 import networkx as nx
 import numpy as np
 
+from layout_quality import penalties
+from networks import NETWORKS, communities, network_layout, sorted_edges
+
 # The paper repo is expected to sit next to this app (override with SURVEILLANCE_REPO).
 REPO_CODE = Path(os.environ.get("SURVEILLANCE_REPO", Path(__file__).resolve().parents[2] / "optimal-disease-surveillance-AL")) / "code"
 sys.path.insert(0, str(REPO_CODE))
@@ -20,18 +23,9 @@ from binary_prevalence.outbreak_simulation.base import simulate_binary_outbreak
 DEFAULT_PRIOR = {"alpha": 0.9, "tau": 1.0, "b0Var": 1.0}
 
 
-def grid_preset(rows, cols):
-    g = nx.grid_2d_graph(rows, cols)
-    mapping = {(r, c): r * cols + c for r, c in g.nodes}
-    g = nx.relabel_nodes(g, mapping)
-    layout = [[(i % cols) / (cols - 1), (i // cols) / (rows - 1)] for i in range(rows * cols)]
-    return g, layout, None
-
-
-# id -> (name, builder, outbreak simulation params)
-PRESETS = {
-    "grid10": ("10×10 grid", lambda: grid_preset(10, 10), {"end_time": 8, "transmission_p": 0.25, "initial_infected_num": 1}),
-}
+def budgets(n):
+    """Default and maximum tests: 10% and 30% of nodes, with at least 6 by default on small networks."""
+    return max(6, round(0.1 * n)), round(0.3 * n)
 
 
 def split_for(k, round_count, free_count):
@@ -69,30 +63,49 @@ def simulate_outbreaks(g, params, count, round_count, free_count, seed, prevalen
     return outbreaks
 
 
-def build(out_path, round_outbreaks, free_outbreaks, calib_outbreaks, seed):
+def previous_priors(out_path):
+    """Calibrated priors from the current presets.json, keyed by id, with the edges and outbreaks they were fitted to."""
+    if not out_path.exists():
+        return {}
+    return {p["id"]: p for p in json.loads(out_path.read_text())["presets"]}
+
+
+def build(out_path, round_outbreaks, free_outbreaks, calib_outbreaks):
+    previous = previous_priors(out_path)
     presets = []
-    for i, (pid, (name, builder, sim_params)) in enumerate(PRESETS.items()):
-        g, layout, communities = builder()
+    for pid, net in NETWORKS.items():
+        g = net.build()
         n = g.number_of_nodes()
         assert sorted(g.nodes) == list(range(n)), "nodes must be labelled 0..n-1"
         assert nx.is_connected(g), f"{pid} must be connected"
+        layout = network_layout(pid, g)
+        edges = sorted_edges(g)
+        pen = penalties(layout, edges)
+        if pen["close"] or pen["onEdge"]:
+            raise SystemExit(f"{pid}: layout has {pen['close']} close node pairs and {pen['onEdge']} nodes on edges; fix it in #/layout")
+        default_budget, max_budget = budgets(n)
+        outbreaks = simulate_outbreaks(g, net.sim, round_outbreaks + free_outbreaks + calib_outbreaks, round_outbreaks, free_outbreaks, net.seed)
+        # Keep a calibrated prior while the graph and outbreaks are unchanged (e.g. after a layout edit).
+        old = previous.get(pid)
+        prior = old["prior"] if old and old["edges"] == edges and old["outbreaks"] == outbreaks else DEFAULT_PRIOR
         presets.append({
             "id": pid,
-            "name": name,
+            "name": net.name,
             "n": n,
-            "edges": sorted([min(a, b), max(a, b)] for a, b in g.edges),
+            "edges": edges,
             "layout": layout,
-            "communities": communities,
-            "defaultBudget": round(0.1 * n),
-            "maxBudget": round(0.3 * n),
-            "prior": DEFAULT_PRIOR,
-            "outbreaks": simulate_outbreaks(g, sim_params, round_outbreaks + free_outbreaks + calib_outbreaks, round_outbreaks, free_outbreaks, seed + i),
+            "communities": communities(pid),
+            "defaultBudget": default_budget,
+            "maxBudget": max_budget,
+            "prior": prior,
+            "outbreaks": outbreaks,
         })
     out_path.parent.mkdir(parents=True, exist_ok=True)
     out_path.write_text(json.dumps({"version": 1, "presets": presets}))
     for p in presets:
         prev = [o["prevalence"] for o in p["outbreaks"]]
-        print(f"{p['id']}: n={p['n']} edges={len(p['edges'])} outbreaks={len(prev)} prevalence {min(prev):.2f}-{max(prev):.2f}")
+        kept = "kept calibrated prior" if p["prior"] is not DEFAULT_PRIOR else "default prior: run npm run data:calibrate"
+        print(f"{p['id']}: n={p['n']} edges={len(p['edges'])} outbreaks={len(prev)} prevalence {min(prev):.2f}-{max(prev):.2f} ({kept})")
 
 
 if __name__ == "__main__":
@@ -101,6 +114,5 @@ if __name__ == "__main__":
     ap.add_argument("--round-outbreaks", type=int, default=5)
     ap.add_argument("--free-outbreaks", type=int, default=5)
     ap.add_argument("--calib-outbreaks", type=int, default=20)
-    ap.add_argument("--seed", type=int, default=20261112)
     args = ap.parse_args()
-    build(args.out, args.round_outbreaks, args.free_outbreaks, args.calib_outbreaks, args.seed)
+    build(args.out, args.round_outbreaks, args.free_outbreaks, args.calib_outbreaks)
```

- [ ] **Step 2: Rebuild all data** (about 30 s):
```bash
npm run data
md5 -r public/data/*.json
```
Expected `data:bots` summary (AUC after the default budget):
- `ba40`: LE 0.896, RAND 0.883, DC 0.936;
- `sbm45hi`: LE 0.863, RAND 0.819;
- `sbm45lo`: LE 0.736, RAND 0.696;
- grid: LE 0.952, unchanged.

Expected MD5s:
```
0a994f5f3920e92e2777e3edb3967778 public/data/bots.json
f203c821aeb8a31ccb2bc67df504fa59 public/data/presets.json
```

- [ ] **Step 3: Check that the grid is unchanged and a layout-only rebuild keeps priors**
```bash
git show HEAD:public/data/presets.json > /tmp/old-presets.json && git show HEAD:public/data/bots.json > /tmp/old-bots.json
python3 -c "
import json
o=json.load(open('/tmp/old-presets.json'))['presets'][0]; n=json.load(open('public/data/presets.json'))['presets'][0]
print('grid identical:', o==n)
print('grid bots identical:', json.load(open('/tmp/old-bots.json'))['presets']['grid10']==json.load(open('public/data/bots.json'))['presets']['grid10'])"
npm run data:presets
md5 -r public/data/presets.json
```
Expected:
- `grid identical: True` and `grid bots identical: True`;
- `data:presets` prints "(kept calibrated prior)" for all four networks;
- the presets MD5 is still `f203c821aeb8a31ccb2bc67df504fa59`.

- [ ] **Step 4: Run the existing tests**: `npm test`. Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add offline/build_presets.py public/data/presets.json public/data/bots.json
git commit -m "feat(data): Hub network, Three towns and Mixed towns with outbreaks, priors and bots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Layout checks in TypeScript

**Files:**
- Create: `src/core/layoutQuality.ts`
- Test: `src/core/layoutQuality.test.ts`

- [ ] **Step 1: Write the failing test** `src/core/layoutQuality.test.ts` (complete file):

```ts
import { describe, expect, it } from 'vitest';
import { layoutFaults, segmentsCross, type Point } from './layoutQuality.ts';

describe('segmentsCross', () => {
  it('detects a proper crossing but not touching or parallel segments', () => {
    expect(segmentsCross([0, 0], [1, 1], [0, 1], [1, 0])).toBe(true);
    expect(segmentsCross([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
    expect(segmentsCross([0, 0], [1, 0], [1, 0], [1, 1])).toBe(false);
  });
});

describe('layoutFaults', () => {
  it('finds no faults in a well-spread square', () => {
    const square: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(layoutFaults(square, [[0, 1], [1, 2], [2, 3], [3, 0]])).toEqual({ close: [], onEdge: [], crossings: [] });
  });

  it('reports an X crossing as one pair of edge indices', () => {
    const x: Point[] = [[0, 0], [1, 1], [0, 1], [1, 0]];
    expect(layoutFaults(x, [[0, 1], [2, 3]]).crossings).toEqual([[0, 1]]);
  });

  it('reports overlapping nodes (closer than 28 px at 280 px per unit)', () => {
    const near: Point[] = [[0.5, 0.5], [0.55, 0.5], [0, 0]];
    expect(layoutFaults(near, []).close).toEqual([[0, 1]]);
  });

  it('reports a node sitting on an edge it is not part of', () => {
    const line: Point[] = [[0, 0.5], [1, 0.5], [0.5, 0.52]];
    expect(layoutFaults(line, [[0, 1]]).onEdge).toEqual([[2, 0]]);
  });
});
```

- [ ] **Step 2: Run it**: `npx vitest run src/core/layoutQuality.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement** `src/core/layoutQuality.ts` (complete file):

```ts
// Layout checks in rendered pixels, mirroring offline/layout_quality.py (the game draws [0, 1]² into 280 px).
export const PX_PER_UNIT = 280;
/** Centre-to-centre; uncertainty rings reach ~15 px from a node's centre. */
export const MIN_NODE_GAP_PX = 28;
/** A node's centre to any edge it isn't part of. */
export const MIN_EDGE_CLEARANCE_PX = 14;

export type Point = [number, number];

export interface LayoutFaults {
  /** Node pairs closer than MIN_NODE_GAP_PX. */
  close: [number, number][];
  /** [node, edge index] where the node sits within MIN_EDGE_CLEARANCE_PX of an edge it isn't part of. */
  onEdge: [number, number][];
  /** Pairs of edge indices that cross. */
  crossings: [number, number][];
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const orient = (a: Point, b: Point, c: Point) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** True if segments p1p2 and p3p4 properly cross (touching or collinear doesn't count). */
export function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  return orient(p1, p2, p3) * orient(p1, p2, p4) < 0 && orient(p3, p4, p1) * orient(p3, p4, p2) < 0;
}

export function layoutFaults(layout: Point[], edges: [number, number][]): LayoutFaults {
  const px = layout.map(([x, y]): Point => [x * PX_PER_UNIT, y * PX_PER_UNIT]);
  const close: [number, number][] = [];
  for (let i = 0; i < px.length; i++)
    for (let j = i + 1; j < px.length; j++) if (Math.hypot(px[i][0] - px[j][0], px[i][1] - px[j][1]) < MIN_NODE_GAP_PX) close.push([i, j]);
  const onEdge: [number, number][] = [];
  edges.forEach(([a, b], e) => {
    for (let i = 0; i < px.length; i++) if (i !== a && i !== b && pointSegmentDistance(px[i], px[a], px[b]) < MIN_EDGE_CLEARANCE_PX) onEdge.push([i, e]);
  });
  const crossings: [number, number][] = [];
  for (let e = 0; e < edges.length; e++)
    for (let f = e + 1; f < edges.length; f++) {
      const [a, b] = edges[e];
      const [c, d] = edges[f];
      if (new Set([a, b, c, d]).size === 4 && segmentsCross(px[a], px[b], px[c], px[d])) crossings.push([e, f]);
    }
  return { close, onEdge, crossings };
}
```

- [ ] **Step 4: Run it**: `npx vitest run src/core/layoutQuality.test.ts`. Expected: 5 passed.
- [ ] **Step 5: Commit**
```bash
git add src/core/layoutQuality.ts src/core/layoutQuality.test.ts
git commit -m "feat(core): layout fault checks mirroring the offline scorer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dev-server save endpoint

**Files:**
- Create: `scripts/layout-save.ts`
- Test: `scripts/layout-save.test.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the failing test** `scripts/layout-save.test.ts` (complete file):

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveLayoutFile } from './layout-save.ts';

function dirWithLayout() {
  const dir = mkdtempSync(join(tmpdir(), 'layouts-'));
  writeFileSync(join(dir, 'net1.json'), JSON.stringify({ id: 'net1', edges: [[0, 1]], layout: [[0, 0], [1, 1]], source: 'search:kk' }));
  return dir;
}

describe('saveLayoutFile', () => {
  it('replaces positions, keeps edges and marks the file edited', () => {
    const dir = dirWithLayout();
    saveLayoutFile(dir, { id: 'net1', layout: [[0.123456, 0.5], [1, 0]] });
    expect(JSON.parse(readFileSync(join(dir, 'net1.json'), 'utf8'))).toEqual({ id: 'net1', edges: [[0, 1]], layout: [[0.1235, 0.5], [1, 0]], source: 'edited' });
  });

  it('refuses path tricks, unknown ids and malformed layouts', () => {
    const dir = dirWithLayout();
    expect(() => saveLayoutFile(dir, { id: '../net1', layout: [[0, 0], [1, 1]] })).toThrow(/bad id/);
    expect(() => saveLayoutFile(dir, { id: 'net2', layout: [[0, 0], [1, 1]] })).toThrow(/no layout/);
    expect(() => saveLayoutFile(dir, { id: 'net1', layout: [[0, 0]] })).toThrow(/one \[x, y\]/);
    expect(() => saveLayoutFile(dir, { id: 'net1', layout: [[0, 0], [1, 2]] })).toThrow(/one \[x, y\]/);
  });
});
```

- [ ] **Step 2: Run it**: `npx vitest run scripts/layout-save.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement** `scripts/layout-save.ts` (complete file):

```ts
// Dev-server endpoint for the #/layout editor: POST /__layout/save { id, layout } rewrites offline/layouts/<id>.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const LAYOUT_ROUTE = '/__layout/save';

/** Replace the positions in an existing layout file, keeping its edges; throws on anything unexpected. */
export function saveLayoutFile(dir: string, body: unknown): string {
  const { id, layout } = (body ?? {}) as { id?: unknown; layout?: unknown };
  if (typeof id !== 'string' || !/^[a-z0-9]+$/.test(id)) throw new Error('bad id');
  const path = resolve(dir, `${id}.json`);
  if (!existsSync(path)) throw new Error(`no layout file for ${id}`);
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { edges: [number, number][]; layout: [number, number][] };
  const ok =
    Array.isArray(layout) &&
    layout.length === saved.layout.length &&
    layout.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= 0 && v <= 1));
  if (!ok) throw new Error('layout must be one [x, y] in [0, 1]² per node');
  const rounded = (layout as [number, number][]).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  writeFileSync(path, JSON.stringify({ id, edges: saved.edges, layout: rounded, source: 'edited' }) + '\n');
  return path;
}

export function layoutSavePlugin(dir: string): Plugin {
  return {
    name: 'layout-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(LAYOUT_ROUTE, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          try {
            const path = saveLayoutFile(dir, JSON.parse(raw));
            res.end(JSON.stringify({ path }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
        });
      });
    },
  };
}
```

- [ ] **Step 4: Register the plugin**: `vite.config.ts` (complete file):

```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { layoutSavePlugin } from './scripts/layout-save.ts';

export default defineConfig({
  // Relative base so the built app works from any static host path.
  base: './',
  // The layout editor (#/layout, dev only) saves through this dev-server endpoint.
  plugins: [react(), layoutSavePlugin(resolve(import.meta.dirname, 'offline/layouts'))],
  // One ~510 kB bundle (~150 kB gzipped, mostly React and supabase-js) is fine for a one-page app.
  build: { chunkSizeWarningLimit: 600 },
  test: { environment: 'node' },
});
```

- [ ] **Step 5: Run it**: `npx vitest run scripts/layout-save.test.ts && npx tsc --noEmit`. Expected: 2 passed, and no type errors.
- [ ] **Step 6: Commit**
```bash
git add scripts/layout-save.ts scripts/layout-save.test.ts vite.config.ts
git commit -m "feat(dev): layout save endpoint for the dev server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Layout editor at #/layout (dev only)

**Files:**
- Modify: `src/app/components/GraphView.tsx` (export `VIEW`, `PAD`, `R`)
- Create: `src/app/layout/LayoutEditor.tsx`
- Modify: `src/app/Root.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Export the geometry constants**:
```diff
diff --git a/src/app/components/GraphView.tsx b/src/app/components/GraphView.tsx
index aaa18e3..fb22a78 100644
--- a/src/app/components/GraphView.tsx
+++ b/src/app/components/GraphView.tsx
@@ -1,9 +1,9 @@
 import type { Graph } from '../../core/graph.ts';
 import { COLORS, predictionColor, ringStyle } from '../scales.ts';
 
-const VIEW = 330;
-const PAD = 25;
-const R = 9;
+export const VIEW = 330;
+export const PAD = 25;
+export const R = 9;
 /** Outline of the hovered node; its own edges are drawn darker and thicker. Nothing else changes on hover. */
 const HOVER_OUTLINE = 3.5;
 /** Half-length of the strokes of the + / − drawn on tested nodes. */
```

- [ ] **Step 2: Create the editor** `src/app/layout/LayoutEditor.tsx` (complete file):

```tsx
// Dev-only (#/layout): drag nodes to tidy a network's layout, with live fault checks, and save it to offline/layouts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutFaults, type Point } from '../../core/layoutQuality.ts';
import type { Preset } from '../../core/presets.ts';
import { PAD, R, VIEW } from '../components/GraphView.tsx';
import { loadGameData } from '../data.ts';
import { COLORS } from '../scales.ts';

const TOWN_COLORS = ['#6a8fd0', '#d08a6a', '#7ab37a'];
const FAULT = '#d03b3b';
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export default function LayoutEditor() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [layout, setLayout] = useState<Point[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [towns, setTowns] = useState(false);
  const [status, setStatus] = useState('');
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    loadGameData().then((d) => {
      // The grid's layout is computed, not edited.
      const editable = d.presets.presets.filter((p) => p.id !== 'grid10');
      setPresets(editable);
      setId(editable[0]?.id ?? null);
    }, (e: unknown) => setStatus(String(e)));
  }, []);

  const preset = presets?.find((p) => p.id === id) ?? null;
  useEffect(() => {
    if (preset) setLayout(preset.layout.map(([x, y]): Point => [x, y]));
    setStatus('');
  }, [preset]);

  const faults = useMemo(() => (preset && layout.length === preset.n ? layoutFaults(layout, preset.edges) : null), [preset, layout]);
  if (!presets || !preset || !faults) return <main className="message">{status || 'Loading…'}</main>;

  const badNodes = new Set([...faults.close.flat(), ...faults.onEdge.map(([i]) => i)]);
  const badEdges = new Set([...faults.onEdge.map(([, e]) => e), ...faults.crossings.flat()]);
  const xy = ([x, y]: Point): Point => [PAD + x * (VIEW - 2 * PAD), PAD + y * (VIEW - 2 * PAD)];

  const toLayout = (e: React.PointerEvent): Point => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [clamp01((p.x - PAD) / (VIEW - 2 * PAD)), clamp01((p.y - PAD) / (VIEW - 2 * PAD))];
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragging === null) return;
    const p = toLayout(e);
    setLayout((l) => l.map((q, i) => (i === dragging ? p : q)));
  };
  const save = async () => {
    setStatus('Saving…');
    const res = await fetch('/__layout/save', { method: 'POST', body: JSON.stringify({ id: preset.id, layout }) });
    const body = (await res.json()) as { path?: string; error?: string };
    setStatus(res.ok ? `Saved to ${body.path}. Run npm run data:presets to apply it to the game.` : `Not saved: ${body.error}`);
  };

  return (
    <main className="layout-editor">
      <header className="bar">
        <div>
          <b>Layout editor</b> (dev only) ·{' '}
          <select value={preset.id} onChange={(e) => setId(e.target.value)} aria-label="Network">
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
            ))}
          </select>
        </div>
        <div className="layout-actions">
          {preset.communities && (
            <label>
              <input type="checkbox" checked={towns} onChange={(e) => setTowns(e.target.checked)} /> Colour by community
            </label>
          )}
          <button onClick={() => setLayout(preset.layout.map(([x, y]): Point => [x, y]))}>Revert</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </header>
      <p className="layout-stats" data-testid="layout-stats">
        <span className={faults.close.length ? 'bad' : ''}>{faults.close.length} overlapping pairs</span> ·{' '}
        <span className={faults.onEdge.length ? 'bad' : ''}>{faults.onEdge.length} nodes on edges</span> · {faults.crossings.length} crossings
        {status && <> · {status}</>}
      </p>
      <svg
        ref={svg}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="layout-canvas"
        onPointerMove={onMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        {preset.edges.map(([a, b], e) => {
          const [x1, y1] = xy(layout[a]);
          const [x2, y2] = xy(layout[b]);
          return <line key={e} x1={x1} y1={y1} x2={x2} y2={y2} stroke={badEdges.has(e) ? FAULT : COLORS.edge} strokeWidth={1.5} />;
        })}
        {layout.map((p, i) => {
          const [x, y] = xy(p);
          const fill = towns && preset.communities ? TOWN_COLORS[preset.communities[i] % TOWN_COLORS.length] : COLORS.unknown;
          return (
            <circle
              key={i}
              data-testid={`node-${i}`}
              cx={x}
              cy={y}
              r={R}
              fill={fill}
              stroke={badNodes.has(i) ? FAULT : COLORS.outline}
              strokeWidth={badNodes.has(i) ? 2.5 : 0.8}
              style={{ cursor: 'grab' }}
              onPointerDown={() => setDragging(i)}
            />
          );
        })}
      </svg>
    </main>
  );
}
```

- [ ] **Step 3: Route it in dev builds only** `src/app/Root.tsx` (complete file):

```tsx
import { lazy, Suspense, useEffect, useState } from 'react';
import { App } from './App.tsx';
import { BoardApp } from './board/BoardApp.tsx';
import type { RoundsApi } from './net/types.ts';

/** Hash routes, because GitHub Pages can't rewrite paths: #/board is the projector, anything else the player app. */
export const isBoardRoute = (hash: string): boolean => hash.replace(/\/$/, '') === '#/board';
export const isLayoutRoute = (hash: string): boolean => hash.replace(/\/$/, '') === '#/layout';

// The layout editor exists only under `npm run dev`; production builds drop it (and its import) entirely.
const LayoutEditor = import.meta.env.DEV ? lazy(() => import('./layout/LayoutEditor.tsx')) : null;

export function Root({ api }: { api: RoundsApi | null }) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (LayoutEditor && isLayoutRoute(hash))
    return (
      <Suspense fallback={<main className="message">Loading…</main>}>
        <LayoutEditor />
      </Suspense>
    );
  return isBoardRoute(hash) ? <BoardApp api={api} /> : <App api={api} />;
}
```

- [ ] **Step 4: Styles.** This adds the editor styles and turns the start screen's network cards into a 2-column grid, so four cards sit 2 × 2:
```diff
diff --git a/src/app/styles.css b/src/app/styles.css
index 50c9119..13ba877 100644
--- a/src/app/styles.css
+++ b/src/app/styles.css
@@ -26,8 +26,8 @@ button.primary { background: var(--accent); border-color: var(--accent); color:
 .lead { line-height: 1.5; margin: 0; }
 .field { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
 .field input { font: inherit; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--ink); background: var(--surface); }
-.presets { display: flex; gap: 12px; flex-wrap: wrap; }
-.preset-card { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; min-width: 180px; text-align: left; }
+.presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
+.preset-card { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; }
 .preset-card.selected { border: 2px solid var(--accent); }
 
 /* Shared bar */
@@ -144,3 +144,9 @@ button.primary { background: var(--accent); border-color: var(--accent); color:
 .toggles { display: flex; gap: 16px; flex-wrap: wrap; font-size: 15px; }
 .commentary { margin: 0; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; min-height: 2.8em; }
 .board .label { font-size: 16px; }
+
+/* Layout editor (dev only, #/layout) */
+.layout-actions { display: flex; gap: 10px; align-items: center; }
+.layout-stats { padding: 0 20px; }
+.layout-stats .bad { color: #d03b3b; font-weight: 700; }
+.layout-canvas { display: block; width: min(92vw, 78vh); margin: 0 auto; touch-action: none; user-select: none; }
```

- [ ] **Step 5: Verify**
```bash
npx tsc --noEmit && npm test && npm run build && ! grep -l "Layout editor" dist/assets/*.js && echo "editor not in production build"
```
Expected: no type errors, all tests pass, and `editor not in production build` is printed.

- [ ] **Step 6: Manual check.** Run `npm run dev` and open `http://localhost:5173/#/layout`.
  1. Hub network shows "0 overlapping pairs · 0 nodes on edges · 0 crossings".
  2. Drag the central hub onto a neighbour: the readout turns red, and the faulty nodes and edges are outlined in red.
  3. Press **Revert**: the readout returns to 0 faults.
  4. Do **not** press Save. (If you do, restore the file with `git checkout offline/layouts`.)
  5. Open `http://localhost:5173/`: the four network cards sit in a 2 × 2 grid.
- [ ] **Step 7: Commit**
```bash
git add src/app/components/GraphView.tsx src/app/layout/LayoutEditor.tsx src/app/Root.tsx src/app/styles.css
git commit -m "feat(dev): drag-to-fix layout editor at #/layout; network cards in a grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Shipped-data tests and README

**Files:**
- Test: `src/app/networks.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add the test** `src/app/networks.test.ts` (complete file):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BotsFile } from '../core/bots.ts';
import { layoutFaults } from '../core/layoutQuality.ts';
import { POLICIES } from '../core/policies.ts';
import { parsePresetFile } from '../core/presets.ts';
import { botResult } from './data.ts';

const presets = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets;
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;

describe('shipped networks', () => {
  it('are the grid, the hub network and the two town networks, in that order', () => {
    expect(presets.map((p) => p.id)).toEqual(['grid10', 'ba40', 'sbm45hi', 'sbm45lo']);
  });

  describe.each(presets.map((p) => [p.id, p] as const))('%s', (_, preset) => {
    it('has 5 round, 5 free and 20 calib outbreaks', () => {
      const count = (split: string) => preset.outbreaks.filter((o) => o.split === split).length;
      expect([count('round'), count('free'), count('calib')]).toEqual([5, 5, 20]);
    });

    it('has every bot for every played outbreak', () => {
      for (const o of preset.outbreaks.filter((o) => o.split !== 'calib'))
        for (const policy of POLICIES) expect(() => botResult(bots, preset.id, o.id, policy)).not.toThrow();
    });

    it('has a layout in [0, 1]² with no overlapping nodes or nodes on edges', () => {
      expect(preset.layout.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
      const faults = layoutFaults(preset.layout, preset.edges);
      expect(faults.close).toEqual([]);
      expect(faults.onEdge).toEqual([]);
    });

    it('labels communities only on the town networks', () => {
      expect(preset.communities === null).toBe(!preset.id.startsWith('sbm'));
    });
  });
});
```

- [ ] **Step 2: Run it**: `npx vitest run src/app/networks.test.ts`. Expected: 17 passed (1 + 4 × 4).
- [ ] **Step 3: Update the README**:
```diff
diff --git a/README.md b/README.md
index 1ecea4c..8556cd3 100644
--- a/README.md
+++ b/README.md
@@ -56,7 +56,16 @@ Both live scripts refuse to run while a round is open (add `-- --force` to close
 | `npm run test:sql` | Database schema checks (local Postgres) |
 | `npm run smoke` / `npm run loadtest` | Checks against the real Supabase project (see Multiplayer) |
 | `npm run bench` | Speed benchmark |
-| `npm run data` | Rebuild presets → calibrate prior → rebuild bots (run all three after changing presets) |
+| `npm run data` | Rebuild presets → calibrate prior → rebuild bots (run all three after changing networks or outbreaks) |
+| `npm run data:layout -- <id> [--pick N]` | Search layouts for a network; writes a contact sheet to `offline/out/layouts/<id>.png`, `--pick N` saves candidate N |
 | `npm run validate` | Laplace vs MCMC report → `docs/validation/` |
 
+## Networks and layouts
+
+Networks are defined in `offline/networks.py`: the 10×10 grid, a hub network (`ba40`) and two three-town networks (`sbm45hi`, `sbm45lo`). Graphs come from fixed seeds. Non-grid layouts are files in `offline/layouts/<id>.json` (positions plus the edges they were made for), so rebuilding data never moves a node.
+
+1. `npm run data:layout -- <id>`, look at the contact sheet, then `npm run data:layout -- <id> --pick N`.
+2. Optional: `npm run dev`, open `#/layout`, drag nodes (faults show in red), **Save**. The editor exists only in dev builds.
+3. `npm run data:presets` to apply a layout change (layouts don't affect priors or bots), or `npm run data` after changing a network or its outbreaks.
+
 Python steps use `uv` (`offline/pyproject.toml`) and expect the paper repo at `../optimal-disease-surveillance-AL` (override with `SURVEILLANCE_REPO`).
```

- [ ] **Step 4: Full verification**: `npx tsc --noEmit && npm test && npm run build`. Expected: 31 test files and 160 tests pass, and the build succeeds.
- [ ] **Step 5: Commit**
```bash
git add src/app/networks.test.ts README.md
git commit -m "test: shipped networks have outbreaks, bots and clean layouts; docs: networks and layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hand-off to the user (not for subagents)

- [ ] Push only after the user says so. The deploy workflow then publishes the new networks.
- [ ] Ask the user to look at each network in play and on the board, and to tidy layouts in `#/layout` if they want. A layout edit then needs `npm run data:presets`, a commit and a push.
