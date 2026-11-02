// Load test against the real Supabase project: N players (default 30) join, then all submit within a few seconds.
// Usage: PRESENTER_PIN=… npm run loadtest [-- --players 30 --force]
import type { Play, PresenceState } from '../src/app/net/types.ts';
import { quantile } from '../src/core/bots.ts';
import { makeRng } from '../src/core/rng.ts';
import { env, failed, check, guardOpenRound, newApi, testOutbreak, waitFor } from './live.ts';

const pin = env('PRESENTER_PIN');
const arg = (name: string, fallback: number) => {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? Number(process.argv[k + 1]) : fallback;
};
const N = arg('players', 30);
const budget = 10;
const board = newApi();
const { preset, outbreak, nodes } = testOutbreak();
await guardOpenRound(board);

console.log(`Load test: ${N} players`);
const round = await board.openRound(pin, { presetId: preset.id, outbreakId: outbreak.id, budget, rankMetric: 'auc' });
const players = Array.from({ length: N }, (_, k) => ({ api: newApi(), id: crypto.randomUUID(), name: `load${k + 1}` }));

await check(`board sees all ${N} players join`, async () => {
  const t0 = performance.now();
  const seen = waitFor<PresenceState[]>((cb) => board.onPresence(cb), (ps) => players.every((p) => ps.some((x) => x.playerId === p.id)), 20_000);
  for (const p of players) p.api.joinPresence({ playerId: p.id, nickname: p.name, status: 'playing', roundId: round.id });
  await seen;
  console.log(`        (${Math.round(performance.now() - t0)} ms)`);
});

const latencies: number[] = [];
const errors: string[] = [];
await check(`all ${N} plays are accepted and reach the board`, async () => {
  const t0 = performance.now();
  const seen = waitFor<Play[]>((cb) => board.onPlays(round.id, cb), (ps) => ps.length >= N, 30_000);
  await Promise.all(
    players.map(async (p, k) => {
      const rng = makeRng(k + 1);
      const picks = [...nodes].sort(() => rng() - 0.5).slice(0, budget);
      await new Promise((r) => setTimeout(r, rng() * 3000));
      const start = performance.now();
      try {
        await p.api.submitPlay({ roundId: round.id, presetId: preset.id, outbreakId: outbreak.id, budget, playerId: p.id, nickname: p.name, picks, usedPredictions: false, usedUncertainty: false });
        latencies.push(performance.now() - start);
      } catch (e) {
        errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  if (errors.length > 0) throw new Error(`${errors.length} submissions failed: ${errors.slice(0, 3).join('; ')}`);
  await seen;
  console.log(`        (all on the board after ${Math.round(performance.now() - t0)} ms)`);
});
if (latencies.length > 0) {
  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(`  submit latency: median ${Math.round(quantile(sorted, 0.5))} ms, 95th ${Math.round(quantile(sorted, 0.95))} ms, max ${Math.round(sorted.at(-1)!)} ms`);
}
await board.closeRound(pin, round.id);
console.log(failed() === 0 ? 'Load test passed.' : 'Load test FAILED.');
process.exit(failed() === 0 ? 0 : 1);
