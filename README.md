# Surveillance Game

Interactive workshop game (ICID 2026) based on Tsui et al. (2024), *Toward optimal disease surveillance with graph-based active learning*, PNAS.

Design: `docs/superpowers/specs/2026-11-01-surveillance-game-design.md`

## Engine (`src/core/`)

Pure TypeScript, runs in the browser and in Node:

- `surrogate.ts`: Laplace-approximated latent Gaussian model with the paper's CAR prior (`prior.ts`). About 0.1 ms per update (see `docs/benchmark.md`).
- `policies.ts`: LE, NE, BALD, degree centrality, reactive-infected, random.
- `metrics.ts` / `replay.ts`: accuracy, AUC, learning-curve area; replaying a pick sequence.

Validation against NumPyro MCMC: `docs/validation/validation.md`.

## App (`src/app/`)

Single-player game: React + hand-written SVG. All model computation runs in the browser; data comes from `public/data/`.

```bash
npm run dev       # development server
npm run build     # typecheck + production build into dist/ (static; host anywhere)
npm run preview   # serve dist/ locally
```

Design: `docs/superpowers/specs/2026-11-01-player-app-design.md`

## Commands

| Command | What it does |
|---|---|
| `npm test` / `npm run typecheck` | Unit tests / type check |
| `npm run bench` | Speed benchmark |
| `npm run data` | Rebuild presets → calibrate prior → rebuild bots (run all three after changing presets) |
| `npm run validate` | Laplace vs MCMC report → `docs/validation/` |

Python steps use `uv` (`offline/pyproject.toml`) and expect the paper repo at `../optimal-disease-surveillance-AL` (override with `SURVEILLANCE_REPO`).
