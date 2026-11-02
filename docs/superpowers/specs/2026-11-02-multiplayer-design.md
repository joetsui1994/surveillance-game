# Surveillance Game: Multiplayer Design (Plan 3)

**Date:** 2026-11-02
**Parent spec:** `2026-11-01-surveillance-game-design.md`. This document supersedes the parent's §2 views table, §4 led round / free play / board, §6 data & sync and §9 timeline where they differ.
**Builds on:** `2026-11-01-player-app-design.md` (Plan 2, single-player app).
**Mockups (outside the repo):** `ICID2026/workshop/.superpowers/brainstorm/5038-1793577057/content/` (`board.html`, `replay.html`).

## 1. Scope

Presenter-led rounds for ~30 laptops, a projector board with a live leaderboard and replay, and free play between rounds.

- **Hosting:** a static site on GitHub Pages (public repo) and Supabase (free tier) for round state, plays and presence.
- **One presenter laptop,** mirrored to the projector. The presenter controls live in a drawer on the board page.
- **No accounts.** Players are a random ID kept in the browser plus a nickname.

**Out of scope:**
- free-play leaderboard (free play is practice only);
- stored scores (always recomputed from picks);
- RL, new presets, community tint (no SBM presets yet).

## 2. Data change: round vs free outbreaks

- `offline/build_presets.py` splits the 10 played outbreaks into `split: "round"` (5, presenter only) and `split: "free"` (5, free play). The 20 `calib` outbreaks are unchanged.
- `Outbreak.split` becomes `'round' | 'free' | 'calib'` in `src/core/presets.ts`.
- `scripts/build-bots.ts` computes bots for both `round` and `free` outbreaks.
- `chooseOutbreak` (free play) draws only from `free` outbreaks.
- Regenerate with `npm run data`; commit `presets.json` and `bots.json`.

## 3. Backend (Supabase)

### Tables

**`rounds`:** `id, number, preset_id, outbreak_id, budget, rank_metric ('auc'|'lc_auc'|'accuracy'), status ('open'|'closed'), opened_at, closed_at`

**`plays`:** `id, round_id not null, preset_id, outbreak_id, budget, player_id uuid, nickname, picks int[], used_predictions bool, used_uncertainty bool, hidden bool default false, created_at`
- Unique `(round_id, player_id)`: one play per player per round.

### Write-once plays
- Plays are **insert-only**, written once when the game is finished. There is no update path for anon.
- A player who hasn't finished when the round closes has no row: that is DNF.
- Row-level security allows an anon insert of a round play only if:
  - the round is **open**;
  - `preset_id`, `outbreak_id` and `budget` match the round;
  - `picks` has exactly `budget` entries, all distinct;
  - `hidden` is false.
- Free-play games are never written (free play is local practice only, no leaderboard).
- Anon can `select` from `rounds` and `plays`.

### Presenter functions (`SECURITY DEFINER`)
- `open_round(pin, preset_id, outbreak_id, budget, rank_metric)`: closes any open round, then inserts a new open round with the next `number`. Returns the row.
- `close_round(pin, round_id)`
- `hide_play(pin, play_id)`
- `set_presenter_pin(new_pin)`: callable only from the SQL editor (not granted to anon).
- The PIN is stored as a pgcrypto `crypt()` hash in `presenter_secret`, which anon cannot read. A wrong PIN raises an error.

### Realtime
- **Postgres changes:** players and board subscribe to `rounds`; the board subscribes to `plays` inserts and updates (for `hidden`).
- **Presence:** each open player tab announces `{player_id, nickname, status: 'lobby'|'free'|'playing'|'finished'}` on one channel. The board reads joined counts and chips from presence. Nothing is stored.

### Schema file
`supabase/schema.sql` creates everything above (tables, RLS, functions, pgcrypto, realtime publication) and is idempotent enough to re-run on a fresh project.

### Client config
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are injected at build time.
- If either is missing, the app runs as the Plan 2 single-player game and the board shows "Multiplayer not configured".
- Only the **anon** key ever appears in the client or repo. The service-role key is never used.

### `RoundsApi`
All networking goes through one interface:

```ts
interface RoundsApi {
  currentRound(): Promise<Round | null>;
  onRound(cb: (round: Round | null) => void): Unsubscribe;
  listPlays(roundId: number): Promise<Play[]>;
  onPlays(roundId: number, cb: (plays: Play[]) => void): Unsubscribe;
  submitPlay(play: NewPlay): Promise<void>;          // rejects with a typed error
  joinPresence(me: PresenceState): PresenceHandle;   // update(status), leave()
  onPresence(cb: (players: PresenceState[]) => void): Unsubscribe;
  openRound(pin: string, cfg: RoundConfig): Promise<Round>;
  closeRound(pin: string, roundId: number): Promise<void>;
  hidePlay(pin: string, playId: number): Promise<void>;
}
```

Two implementations: `SupabaseRoundsApi` (deployed) and `FakeRoundsApi` (in-memory, enforces the same insert rules; used by tests to drive several players, the presenter and the board in one process).

`submitPlay` errors are typed: `'round_closed' | 'duplicate' | 'invalid' | 'network'`. Only `network` is retried.

## 4. Player flow (`#/`)

**Join:** nickname (remembered), then the **lobby**: "Waiting for the presenter… or play a practice game while you wait."
- **Practice:** the Plan 2 game on the 5 `free` outbreaks, results screen included. Nothing is submitted.

**When a round opens:**
- **In the lobby:** the round starts immediately. The header shows "Round N"; the outbreak and budget come from the round.
- **Mid practice game:** a banner: "Round N has started. Finish this game or [Join now]". Joining abandons the practice game; finishing it leads straight into the round.

**During a round:** the Plan 2 play screen (toggles, hover box, no live score). Presence reports `playing`, then `finished`.

**After the last test:**
- The play is submitted. `network` failures retry with backoff while the round is open; the pending play is kept in localStorage so a reload retries too.
- The player sees **their own** result: truth map with ✕, AUC, learning-curve AUC, their curve, and "Waiting for the presenter to close the round…". No bots and no rank yet.

**When the round closes:** the player's screen adds their **rank** ("#4 of 25", computed from all non-hidden plays with the round's metric) and the full Plan 2 comparison against LE, NE and Random. A button returns to the lobby.

**Edge cases:**
- **Closed before finishing:** "This round has closed. Your game wasn't counted." Back to the lobby.
- **Reload mid-round:** resumes from the stored session (Plan 2). If the stored session is for a round that has since closed, it is dropped with the message above.
- **Late join:** allowed while the round is open.
- **Duplicate names:** identity is `player_id`; the board appends "(2)", "(3)" for display.
- **Submission rejected as `duplicate`:** treated as success (already submitted from another tab or a retry).

## 5. Board (`#/board`)

Hash routes because GitHub Pages can't rewrite URLs. Base font 18 px.

### Presenter drawer
- Opened with **P** or a small ⚙ in the corner; the PIN is entered in the page (no browser dialog) and kept in `sessionStorage`. A wrong PIN shows an inline error.
- **Round controls:**
  - network (preset);
  - outbreak: the 5 `round` outbreaks with prevalence, marking those already used (any round with that outbreak);
  - budget 1–30, default the preset's `defaultBudget`;
  - rank metric: AUC (default), learning-curve AUC, accuracy;
  - **Open round** and **Close round**.
- **Results controls:** **Reveal bots** (local toggle), and a ✕ on each leaderboard row while unlocked to **hide a player**.
- **Hide drawer** collapses it.

### Phases (switch automatically from the current round and its status)
1. **Lobby** (no open round, and results dismissed):
   - QR code (the `qrcode` npm package) for the join URL, derived from the page's own address with the `#/board` hash removed, plus the URL in text;
   - joined count and nickname chips from presence;
   - "Round N next".
2. **Live** (a round is open): "18 / 25 finished": submitted plays over players in the round (present with status `playing` or `finished`, or already submitted), progress bar, ✓ chips. **No scores.**
3. **Results** (the latest round is closed):
   - **Leaderboard:** ranked by the round's metric. Ties at 3 decimals share a rank; `null` metrics rank last. Columns: rank, nickname, metric, the other two metrics in muted text, 🎨 (used predictions) and ◎ (used uncertainty). Hidden plays are excluded. 🤖 rows for LE, NE and Random (mean) appear after **Reveal bots**.
   - **Learning curves:** faint per-player lines, bold human median, and bot curves after reveal (Plan 2 palette).
   - **First-pick heatmap:** the graph shaded by how many players chose each node first; the seed node marked.
   - **Back to lobby** button.

### Replay
Clicking a leaderboard row (player, LE or NE) opens the replay panel (mockup `replay.html`):
- the graph with numbered picks up to the current step;
- ⏮ ◀ ▶ Play ⏭ and a step slider (0 = seed only … budget);
- toggles: predictions, uncertainty, truth;
- a commentary line for the step (e.g. "Test 3: node (4, 7) — infected · 2 hops from nearest known infection · AUC 0.91 → 0.93");
- a mini AUC chart with a step marker.

Random has no single pick sequence and is not replayable.

### Reuse
`GraphView`, `AucChart`, `scales`, `scoreSession`/`replay`. New: `Leaderboard`, `FirstPickHeatmap`, `ReplayPanel`, `PresenterDrawer`, `Qr`, plus pure modules for ranking, heatmap counts and replay frames.

## 6. Deployment

- **Repo:** public GitHub repo `surveillance-game`. **Creating it and the first push need explicit user confirmation.**
- **Workflow:** `.github/workflows/deploy.yml` on push to `main`: `npm ci`, `npm test`, `npm run build` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from repository variables, then deploy `dist/` to GitHub Pages.
- **URL:** `https://<user>.github.io/surveillance-game/` (Vite `base: './'` already works under a sub-path).

### User setup (once, ~10 minutes)
1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Run `select set_presenter_pin('…');`. The PIN is never put in the repo or the chat.
3. Provide the project URL and anon key; they are added as repository variables and to a local `.env.local` (git-ignored).

## 7. Failure handling

| Failure | Behaviour |
|---|---|
| Wi-Fi drops mid-play | Play continues locally; the submission is queued in localStorage and retried while the round is open |
| Page refresh | Session and pending submission restored |
| Round closed before submit | "Your game wasn't counted"; back to lobby |
| Supabase unreachable | Practice still works; lobby shows "Can't reach the server"; board shows a connection banner. Backup: recorded run-through video |
| Wrong PIN | Inline error in the drawer; nothing changes |
| Env vars missing | Single-player mode (Plan 2) |

## 8. Testing

- **Unit (pure):**
  - player round state machine (lobby → round → submitted → closed; practice → banner → join/finish; closed before finishing);
  - ranking (metric choice, ties at 3 dp, `null` last, hidden excluded);
  - first-pick heatmap counts;
  - replay frames and commentary;
  - nickname de-duplication.
- **`FakeRoundsApi`:** the same insert rules as RLS (open round, matching config, distinct picks of length budget, one per player).
- **Integration (jsdom + fake):** 3 players and the board in one test: open → players switch → finish → board counts → close → ranks and comparisons appear; plus a close mid-game giving DNF.
- **Smoke test against the real project** (`npm run smoke`): open a round with the PIN, submit a valid play, and confirm the database **rejects** a wrong budget, a duplicate, a play after close and a wrong PIN.
- **Load test** (`npm run loadtest`): 30 simulated players join presence, play and submit together; reports failures and latency.
- **Dry run:** 2–3 colleagues on laptops, ideally on venue-like Wi-Fi.

## 9. Schedule

| Days | Work |
|---|---|
| Nov 2–3 | Data split, `RoundsApi` + fake, `schema.sql`, smoke test (needs the Supabase project) |
| Nov 4–5 | Multiplayer player flow |
| Nov 6–7 | Board, presenter drawer, replay |
| Nov 8 | Deploy to Pages, load test |
| Nov 9 | Dry run with colleagues. **Code freeze at end of day** |
| Nov 10–11 | Buffer and talk prep |
