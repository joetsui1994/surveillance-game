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


def town_centres(k):
    """Where each town goes: a triangle for three towns, otherwise a regular polygon."""
    if k == 3:
        return [(0.5, 0.0), (0.0, 0.9), (1.0, 0.9)], 0.32
    angles = [np.pi / 2 + 2 * np.pi * i / k for i in range(k)]
    return [(0.5 + 0.5 * np.cos(a), 0.5 - 0.5 * np.sin(a)) for a in angles], 0.2


def town_layout(g, blocks, seed):
    """Spring-lay each town separately at its own centre, then relax the whole graph briefly."""
    centres, scale = town_centres(max(blocks) + 1)
    pos = {}
    for b, (cx, cy) in enumerate(centres):
        nodes = [v for v in g.nodes if blocks[v] == b]
        sub = nx.spring_layout(g.subgraph(nodes), seed=seed, iterations=200)
        for v, (x, y) in sub.items():
            pos[v] = (cx + scale * x, cy + scale * y)
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
    g = NETWORKS[args.id].build()
    # The cache is {"edges", "candidates"}; one for another graph (or an old bare list) is stale.
    cached = json.loads(cache.read_text()) if cache.exists() else None
    fresh = isinstance(cached, dict) and cached.get("edges") == sorted_edges(g)
    if args.pick is not None and fresh:
        top = cached["candidates"]
    else:
        if args.pick is not None and cached is not None:
            print(f"Re-searching {args.id}: the graph changed since the last search")
        g, top = search(args.id)
        sheet = OUT_DIR / f"{args.id}.png"
        contact_sheet(args.id, g, top, sheet)
        cache.write_text(json.dumps({"edges": sorted_edges(g), "candidates": top}))
        print(f"Wrote {sheet}")
        for i, c in enumerate(top):
            print(f"  #{i:<2} {c['penalties']}  {c['source']}")
    if args.pick is not None:
        if not 0 <= args.pick < len(top):
            raise SystemExit(f"--pick {args.pick} is out of range: choose 0..{len(top) - 1}")
        c = top[args.pick]
        save_layout(args.id, g, c["layout"], f"search:{c['source']}")
        print(f"Saved #{args.pick} to offline/layouts/{args.id}.json")


if __name__ == "__main__":
    main()
