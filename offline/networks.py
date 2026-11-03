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
