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
        return int((own + TOWN_MARGIN_PX * 3 / len(ks) > other).sum())

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
