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
- Plays are written once, when the game is finished, through the `SECURITY DEFINER` function `submit_play(...)`. Anon has **no** direct insert, update or delete on any table; row-level security only allows `select` on `rounds` and `plays`.
- A player who hasn't finished when the round closes has no row: that is DNF.
- `submit_play` locks the round row and raises a named error that the app maps to a `SubmitError`:
  - `round_closed`: the round is missing or closed;
  - `invalid`: preset, outbreak or budget don't match the round; `picks` isn't exactly `budget` distinct non-negative entries; or the nickname is empty or over 24 characters;
  - `duplicate`: the player already has a play in this round.
- Free-play games are never written (free play is local practice only, no leaderboard).
- The database doesn't know the graph, so it can't reject picks ≥ n or equal to the seed; the board drops such plays when scoring.

### Presenter functions (`SECURITY DEFINER`)
- `open_round(pin, preset_id, outbreak_id, budget, rank_metric)`: closes any open round, then inserts a new open round with the next `number`. Returns the row.
- `close_round(pin, round_id)`
- `hide_play(pin, play_id)`
- `check_pin(pin) → boolean`: unlocks the drawer.
- `set_presenter_pin(new_pin)`: at least 6 characters; callable only from the SQL editor (not granted to anon).
- The PIN is stored as a pgcrypto bcrypt hash in `presenter_secret`, which anon cannot read. A wrong PIN raises `wrong_pin`.

### Realtime
- **Postgres changes:** players and board subscribe to `rounds`; the board subscribes to `plays` inserts and updates (for `hidden`).
- **Presence:** each open player tab announces `{player_id, nickname, status: 'lobby'|'free'|'playing'|'finished'}` on one channel. The board reads joined counts and chips from presence. Nothing is stored.

### Schema file
`supabase/schema.sql` creates everything above (tables, RLS, functions, pgcrypto, realtime publication) and can be re-run. `supabase/test/` checks it as the anon role on a throwaway local Postgres (`npm run test:sql`).

### Client config
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are injected at build time.
- If either is missing, the app runs as the Plan 2 single-player game and the board shows "Multiplayer not configured".
- Only the **anon** key ever appears in the client or repo. The service-role key is never used.

### `RoundsApi`
All networking goes through one interface:

```ts
interface RoundsApi {
  onRounds(cb: (rounds: Round[]) => void): Unsubscribe;            // all rounds: initial list, then every change
  onPlays(roundId: number, cb: (plays: Play[]) => void): Unsubscribe;
  submitPlay(play: NewPlay): Promise<void>;                        // rejects with SubmitError
  joinPresence(me: PresenceState): PresenceHandle;                 // update(state), leave()
  onPresence(cb: (players: PresenceState[]) => void): Unsubscribe;
  checkPin(pin: string): Promise<boolean>;
  openRound(pin: string, cfg: RoundConfig): Promise<Round>;        // presenter actions reject with PinError
  closeRound(pin: string, roundId: number): Promise<void>;
  hidePlay(pin: string, playId: number): Promise<void>;
}
```

The Supabase implementation reloads the whole list on every change and on every (re)connect, so a dropped connection resyncs by itself.

Two implementations: `SupabaseRoundsApi` (deployed) and `FakeRoundsApi` (in-memory, enforces the same insert rules; used by tests to drive several players, the presenter and the board in one process).

`submitPlay` errors are typed: `'round_closed' | 'duplicate' | 'invalid' | 'network'`. Only `network` is retried.

## 4. Player flow (`#/`)

**Join:** the start screen doubles as the **lobby**. It shows the nickname field (remembered) and "Waiting for the presenter to start a round. Meanwhile, play a practice game.", or "Connecting to the game…" until the rounds have loaded. A player with a saved nickname counts as being in the lobby. A player without one sees "Round N is open" and a **Join round N** button.
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
  - **Open round N** (disabled while a round is open, to prevent accidents; the database also enforces one open round) and **Close round N**. After opening, the outbreak picker moves on to the next outbreak.
- **Results controls:** **Reveal bots** (local toggle), and a ✕ on each leaderboard row to **hide a player**, shown only while the drawer is open and unlocked, so it's never on screen by accident.
- **Lock** forgets the PIN.
- **Hide drawer** collapses it.

### Phases (switch automatically from the current round and its status)
1. **Lobby** (no open round, and results dismissed):
   - QR code (the `qrcode` npm package) for the join URL, derived from the page's own address with the `#/board` hash removed, plus the URL in text;
   - joined count and nickname chips from presence;
   - "Round N next".
2. **Live** (a round is open): "18 / 25 finished": submitted plays over players in the round (present with status `playing` or `finished`, or already submitted), progress bar, ✓ chips. **No scores.**
3. **Results** (the latest round is closed):
   - **Leaderboard:** ranked by the round's metric. Ties at 3 decimals share a rank; `null` metrics rank last. Columns: rank, nickname, metric, the other two metrics in muted text, 🎨 (used predictions) and ◎ (used uncertainty). Hidden plays are excluded. 🤖 rows for LE, NE and Random (mean) appear after **Reveal bots**.
   - The leaderboard scrolls inside its panel (sticky header) so 30+ players fit on a projector.
   - A **Learning curves | First tests** switch picks the right-hand figure, so each gets the full width:
     - **learning curves:** faint per-player lines, bold human median, and bot curves after reveal (Plan 2 palette);
     - **first-pick heatmap:** the graph shaded (single-hue teal) by how many players chose each node first, counts printed on nodes, the seed node outlined.
   - **Back to lobby** button.

### Replay
Clicking a leaderboard row (player, LE or NE) opens the replay panel (mockup `replay.html`):
- the graph with numbered picks up to the current step;
- ⏮ ◀ ▶ Play ⏭ and a step slider (0 = seed only … budget);
- toggles: predictions, uncertainty, truth;
- a commentary line for the step (e.g. "Test 3: location 86, infected · next to a known infection · AUC 0.99 → 0.98");
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
| Supabase unreachable | Practice still works; lobby stays on "Connecting to the game…" and the board on "Connecting…". Backup: recorded run-through video |
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
- **Schema checks** (`npm run test:sql`): `schema.sql` applied twice to a throwaway local Postgres, then every rule exercised as the anon role.
- **Smoke test against the real project** (`npm run smoke`): wrong and right PIN, open a round (seen live by a second client), presence, a valid play (seen live by the board), and the database **rejecting** a duplicate, a wrong budget, repeated picks and a play after close; hiding and closing seen live.
- **Load test** (`npm run loadtest`): 30 simulated players join presence and submit within 3 s; reports failures and latency.
- Both live scripts refuse to run while a round is open (unless `--force`), and run against the fake with `LIVE_FAKE=1` to check the scripts themselves.
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
