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

## Multiplayer (presenter-led rounds)

Players open the site (`#/`); the projector shows `#/board`. Press **P** (or ⚙) on the board for the presenter drawer (PIN). Round state, finished plays and presence live in Supabase; scores are always recomputed from picks. Without Supabase settings the app is single-player only.

Design: `docs/superpowers/specs/2026-11-02-multiplayer-design.md`

**One-time setup**

1. Create a Supabase project. In its SQL editor, run `supabase/schema.sql`, then `select set_presenter_pin('…');` (at least 6 characters; keep it out of the repo).
2. Copy `.env.example` to `.env.local` and fill in the project URL and **anon** key (Project Settings → API).
3. For the deployed site, add the same two values as GitHub repository **variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and set Pages → Source to "GitHub Actions". `.github/workflows/deploy.yml` tests, builds and deploys every push to `main`.

**Checks**

```bash
npm run test:sql                       # schema.sql on a throwaway local Postgres (needs initdb/psql)
PRESENTER_PIN=… npm run smoke          # presenter, submission rules, realtime, presence on the real project
PRESENTER_PIN=… npm run loadtest       # 30 simulated players (-- --players N)
```

Both live scripts refuse to run while a round is open (add `-- --force`). Before the workshop, clear test data in the SQL editor: `truncate rounds, plays restart identity;`.

## Commands

| Command | What it does |
|---|---|
| `npm test` / `npm run typecheck` | Unit tests / type check |
| `npm run test:sql` | Database schema checks (local Postgres) |
| `npm run smoke` / `npm run loadtest` | Checks against the real Supabase project (see Multiplayer) |
| `npm run bench` | Speed benchmark |
| `npm run data` | Rebuild presets → calibrate prior → rebuild bots (run all three after changing presets) |
| `npm run validate` | Laplace vs MCMC report → `docs/validation/` |

Python steps use `uv` (`offline/pyproject.toml`) and expect the paper repo at `../optimal-disease-surveillance-AL` (override with `SURVEILLANCE_REPO`).
