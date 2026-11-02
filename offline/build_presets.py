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
