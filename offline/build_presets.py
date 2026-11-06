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

from layout_quality import penalties
from networks import NETWORKS, communities, network_layout, sorted_edges

# The paper repo is expected to sit next to this app (override with SURVEILLANCE_REPO).
REPO_CODE = Path(os.environ.get("SURVEILLANCE_REPO", Path(__file__).resolve().parents[2] / "optimal-disease-surveillance-AL")) / "code"
sys.path.insert(0, str(REPO_CODE))
from binary_prevalence.outbreak_simulation.base import simulate_binary_outbreak  # noqa: E402

DEFAULT_PRIOR = {"alpha": 0.9, "tau": 1.0, "b0Var": 1.0}


def budgets(n):
    """Default and maximum tests: 10% and 30% of nodes, with at least 6 by default on small networks."""
    return max(6, round(0.1 * n)), round(0.3 * n)


def split_for(k, round_count, free_count, calib_count):
    """Outbreak k's role: presenter-led rounds first, then free play, then prior calibration, then more free play.

    The extra free-play outbreaks come last so that adding them leaves every earlier outbreak unchanged."""
    if k < round_count:
        return "round"
    if k < round_count + free_count:
        return "free"
    return "calib" if k < round_count + free_count + calib_count else "free"


def simulate_outbreaks(g, params, count, round_count, free_count, calib_count, seed, prevalence_range=(0.25, 0.5), max_tries=10_000):
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
            "split": split_for(len(outbreaks), round_count, free_count, calib_count),
            "truth": truth,
            "seedNode": int(rng.integers(0, n)),
            "prevalence": round(prevalence, 4),
        })
    if len(outbreaks) < count:
        raise RuntimeError(f"only found {len(outbreaks)} outbreaks in prevalence range {prevalence_range}")
    return outbreaks


def previous_priors(out_path):
    """Calibrated priors from the current presets.json, keyed by id, with the edges and outbreaks they were fitted to."""
    if not out_path.exists():
        return {}
    return {p["id"]: p for p in json.loads(out_path.read_text())["presets"]}


def build(out_path, round_outbreaks, free_outbreaks, calib_outbreaks, extra_free_outbreaks):
    previous = previous_priors(out_path)
    presets = []
    calibrated = {}  # id -> prior carried over from the previous file and not the default
    for pid, net in NETWORKS.items():
        g = net.build()
        n = g.number_of_nodes()
        assert sorted(g.nodes) == list(range(n)), "nodes must be labelled 0..n-1"
        assert nx.is_connected(g), f"{pid} must be connected"
        layout = network_layout(pid, g)
        edges = sorted_edges(g)
        pen = penalties(layout, edges)
        if pen["close"] or pen["onEdge"]:
            raise SystemExit(f"{pid}: layout has {pen['close']} close node pairs and {pen['onEdge']} nodes on edges; fix it in #/layout")
        default_budget, max_budget = budgets(n)
        count = round_outbreaks + free_outbreaks + calib_outbreaks + extra_free_outbreaks
        outbreaks = simulate_outbreaks(g, net.sim, count, round_outbreaks, free_outbreaks, calib_outbreaks, net.seed)
        # Keep a calibrated prior while the graph and calibration outbreaks are unchanged (e.g. after a layout edit).
        old = previous.get(pid)
        calib = lambda obs: [o for o in obs if o["split"] == "calib"]
        carried = bool(old) and old["edges"] == edges and calib(old["outbreaks"]) == calib(outbreaks)
        prior = old["prior"] if carried else DEFAULT_PRIOR
        calibrated[pid] = carried and prior != DEFAULT_PRIOR
        presets.append({
            "id": pid,
            "name": net.name,
            "n": n,
            "edges": edges,
            "layout": layout,
            "communities": communities(pid),
            "defaultBudget": default_budget,
            "maxBudget": max_budget,
            "prior": prior,
            "outbreaks": outbreaks,
        })
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"version": 1, "presets": presets}))
    for p in presets:
        prev = [o["prevalence"] for o in p["outbreaks"]]
        kept = "kept calibrated prior" if calibrated[p["id"]] else "default prior: run npm run data:calibrate"
        print(f"{p['id']}: n={p['n']} edges={len(p['edges'])} outbreaks={len(prev)} prevalence {min(prev):.2f}-{max(prev):.2f} ({kept})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "data" / "presets.json")
    ap.add_argument("--round-outbreaks", type=int, default=5)
    ap.add_argument("--free-outbreaks", type=int, default=5)
    ap.add_argument("--calib-outbreaks", type=int, default=20)
    ap.add_argument("--extra-free-outbreaks", type=int, default=15)
    args = ap.parse_args()
    build(args.out, args.round_outbreaks, args.free_outbreaks, args.calib_outbreaks, args.extra_free_outbreaks)
