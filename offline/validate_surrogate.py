"""Compare the browser Laplace surrogate against NumPyro MCMC on exported scenarios.

Two MCMC references per scenario:
  fixed — same model and the same fixed (alpha, tau, b0Var) as the browser: tests the Laplace approximation.
  paper — the paper's priors (alpha ~ U(0,1), tau ~ LogNormal(0, 0.1), b0 ~ N(0, 1)): tests the model choice.

Reads offline/out/scenarios.json (npm run validate), writes docs/validation/validation.md and validation.png.
"""
import json
import time
from pathlib import Path

import jax.numpy as jnp
import matplotlib
import numpy as np
import numpyro
import numpyro.distributions as dist
from jax.random import PRNGKey

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
REPORT = Path(__file__).resolve().parents[1] / "docs" / "validation"
NUM_WARMUP, NUM_SAMPLES = 500, 1000


def car_model(adj, obs_nodes, y, prior, mode):
    n = adj.shape[0]
    if mode == "fixed":
        b0 = numpyro.sample("b0", dist.Normal(0, np.sqrt(prior["b0Var"])).expand([n]))
        alpha, tau = prior["alpha"], prior["tau"]
    else:
        b0 = numpyro.sample("b0", dist.Normal(0, 1).expand([n]))
        alpha = numpyro.sample("alpha", dist.Uniform(0, 1))
        tau = numpyro.sample("tau", dist.LogNormal(0, 0.1))
    car = numpyro.sample("car", dist.CAR(loc=jnp.zeros(n), correlation=alpha, conditional_precision=tau, adj_matrix=adj, is_sparse=False))
    f = b0 + car
    numpyro.deterministic("p", 1 / (1 + jnp.exp(-f)))
    numpyro.sample("obs", dist.Bernoulli(logits=f[obs_nodes]), obs=y)


def entropy(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -p * np.log(p) - (1 - p) * np.log(1 - p)


def le_scores(dist_matrix, p):
    """Local Entropy as in local_entropy.py (all other reachable nodes, weight 1/d)."""
    h = entropy(p)
    with np.errstate(divide="ignore"):
        w = np.where(dist_matrix > 0, 1.0 / dist_matrix, 0.0)
    return (w @ h) / w.sum(axis=1)


def hop_distances(adj):
    n = adj.shape[0]
    d = np.full((n, n), -1)
    for s in range(n):
        d[s, s] = 0
        frontier = [s]
        while frontier:
            nxt = []
            for u in frontier:
                for v in np.nonzero(adj[u])[0]:
                    if d[s, v] < 0:
                        d[s, v] = d[s, u] + 1
                        nxt.append(v)
            frontier = nxt
    return d


def top_in_top5(lap_scores, mc_scores, unobs):
    """Is the Laplace top pick among the MCMC top-5 picks? (Top-1 equality is too brittle: many nodes tie.)"""
    lap_best = unobs[np.argmax(lap_scores[unobs])]
    return lap_best in set(unobs[np.argsort(-mc_scores[unobs])[:5]])


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def main():
    scenarios = json.loads((OUT / "scenarios.json").read_text())
    rows, scatter = [], {"fixed": ([], []), "paper": ([], [])}
    dist_cache = {}
    for i, sc in enumerate(scenarios):
        n = sc["n"]
        adj = np.zeros((n, n))
        for a, b in sc["edges"]:
            adj[a, b] = adj[b, a] = 1
        key = (n, len(sc["edges"]), sc["id"].split("/")[0])
        if key not in dist_cache:
            dist_cache[key] = hop_distances(adj)
        dmat = dist_cache[key]
        observed = {o["node"] for o in sc["obs"]}
        unobs = np.array([j for j in range(n) if j not in observed])
        obs_nodes = jnp.array([o["node"] for o in sc["obs"]])
        y = jnp.array([o["y"] for o in sc["obs"]])
        p_lap = np.array(sc["p"])
        row = {"id": sc["id"], "m": len(sc["obs"]), "laplace_ms": sc["laplaceMs"]}
        for mode in ("fixed", "paper"):
            t0 = time.time()
            mcmc = numpyro.infer.MCMC(numpyro.infer.NUTS(car_model), num_warmup=NUM_WARMUP, num_samples=NUM_SAMPLES, progress_bar=False)
            mcmc.run(PRNGKey(i), jnp.array(adj), obs_nodes, y, sc["prior"], mode)
            p_mc = np.asarray(mcmc.get_samples()["p"].mean(0))
            row[f"{mode}_s"] = time.time() - t0
            row[f"{mode}_mae"] = float(np.abs(p_mc[unobs] - p_lap[unobs]).mean())
            row[f"{mode}_r"] = float(np.corrcoef(p_mc[unobs], p_lap[unobs])[0, 1]) if p_lap[unobs].std() > 1e-9 else float("nan")
            le_lap, le_mc = le_scores(dmat, p_lap), le_scores(dmat, p_mc)
            row[f"{mode}_ne"] = top_in_top5(entropy(p_lap), entropy(p_mc), unobs)
            row[f"{mode}_le"] = top_in_top5(le_lap, le_mc, unobs)
            row[f"{mode}_le_rho"] = spearman(le_lap[unobs], le_mc[unobs])
            scatter[mode][0].extend(p_lap[unobs])
            scatter[mode][1].extend(p_mc[unobs])
        rows.append(row)
        print(f"[{i + 1}/{len(scenarios)}] {sc['id']}: fixed MAE={row['fixed_mae']:.3f} r={row['fixed_r']:.3f} | paper MAE={row['paper_mae']:.3f} r={row['paper_r']:.3f}")

    lines = [
        "# Surrogate validation: browser Laplace vs NumPyro MCMC",
        "",
        f"MCMC: NUTS, {NUM_WARMUP} warmup + {NUM_SAMPLES} samples, 1 chain. Metrics on unobserved nodes.",
        "NE/LE top-5 = the Laplace model's next pick is among the MCMC model's 5 best candidates. LE ρ = Spearman rank correlation of LE scores.",
        "",
        "| scenario | obs | Laplace ms | fixed MCMC s | fixed MAE | fixed r | NE top-5 | LE top-5 | LE ρ | paper MAE | paper r | NE top-5 | LE top-5 | LE ρ |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    yes = lambda b: "✓" if b else "✗"
    for r in rows:
        lines.append(
            f"| {r['id']} | {r['m']} | {r['laplace_ms']:.2f} | {r['fixed_s']:.1f} | {r['fixed_mae']:.3f} | {r['fixed_r']:.3f} | {yes(r['fixed_ne'])} | {yes(r['fixed_le'])} | {r['fixed_le_rho']:.2f} "
            f"| {r['paper_mae']:.3f} | {r['paper_r']:.3f} | {yes(r['paper_ne'])} | {yes(r['paper_le'])} | {r['paper_le_rho']:.2f} |"
        )
    mean = lambda k: np.nanmean([r[k] for r in rows])
    lines += [
        "",
        f"**Mean (fixed):** MAE {mean('fixed_mae'):.3f}, r {mean('fixed_r'):.3f}, NE top-5 {mean('fixed_ne'):.0%}, LE top-5 {mean('fixed_le'):.0%}, LE ρ {mean('fixed_le_rho'):.2f}",
        f"**Mean (paper):** MAE {mean('paper_mae'):.3f}, r {mean('paper_r'):.3f}, NE top-5 {mean('paper_ne'):.0%}, LE top-5 {mean('paper_le'):.0%}, LE ρ {mean('paper_le_rho'):.2f}",
        f"**Speed:** Laplace {mean('laplace_ms'):.2f} ms vs MCMC {mean('fixed_s'):.1f} s per update",
    ]
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / "validation.md").write_text("\n".join(lines) + "\n")

    fig, axes = plt.subplots(1, 2, figsize=(9, 4.5), sharey=True)
    for ax, mode in zip(axes, ("fixed", "paper")):
        ax.scatter(*scatter[mode], s=4, alpha=0.3)
        ax.plot([0, 1], [0, 1], "k--", lw=1)
        ax.set(title=f"MCMC ({mode} priors)", xlabel="Laplace P(infected)", xlim=(0, 1), ylim=(0, 1))
    axes[0].set_ylabel("MCMC P(infected)")
    fig.tight_layout()
    fig.savefig(REPORT / "validation.png", dpi=150)
    print("\n".join(lines[-3:]))
    print(f"Wrote {REPORT / 'validation.md'} and {REPORT / 'validation.png'}")


if __name__ == "__main__":
    main()
