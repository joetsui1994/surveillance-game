// Smoke test against the real Supabase project: presenter functions, submission rules, realtime and presence.
// Usage: PRESENTER_PIN=… npm run smoke   (add -- --force if a round is open; it will be closed)
// Leaves a few test rounds behind; clear them before the workshop with: truncate rounds, plays;
// (no "restart identity": ids must keep increasing because browsers remember the last round id they joined)
import { PinError, SubmitError, type Play, type PresenceState, type Round } from '../src/app/net/types.ts';
import { check, env, expectEqual, failed, guardOpenRound, newApi, testOutbreak, waitFor } from './live.ts';

const pin = env('PRESENTER_PIN');
const presenter = newApi();
const player = newApi();
const { preset, outbreak, nodes } = testOutbreak();
const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof SubmitError ? e.kind : `unexpected: ${String(e)}`));

const lastNumber = Math.max(0, ...(await guardOpenRound(presenter, pin)).map((x) => x.number));
console.log('Smoke test');
let round: Round | null = null;

await check('wrong PIN is rejected', async () => {
  expectEqual(await presenter.checkPin(`${pin}-wrong`), false);
  const err = await presenter.openRound(`${pin}-wrong`, { presetId: preset.id, outbreakId: outbreak.id, budget: 3, rankMetric: 'auc' }).catch((e: unknown) => e);
  if (!(err instanceof PinError)) throw new Error(`expected PinError, got ${String(err)}`);
});
await check('right PIN unlocks', async () => expectEqual(await presenter.checkPin(pin), true));

await check('opening a round reaches players live', async () => {
  const seen = waitFor<Round[]>((cb) => player.onRounds(cb), (rs) => rs.some((x) => x.number > lastNumber && x.status === 'open'));
  round = await presenter.openRound(pin, { presetId: preset.id, outbreakId: outbreak.id, budget: 3, rankMetric: 'auc' });
  await seen;
});
if (!round) {
  console.log('Cannot continue without a round.');
  process.exit(1);
}
const r = round as Round;
await check('a second round cannot be opened over the open one', async () => {
  const err = await presenter.openRound(pin, { presetId: preset.id, outbreakId: outbreak.id, budget: 3, rankMetric: 'auc' }).catch((e: unknown) => e);
  expectEqual(err instanceof Error ? err.message : String(err), 'round_open');
});
const play = { roundId: r.id, presetId: preset.id, outbreakId: outbreak.id, budget: 3, playerId: crypto.randomUUID(), nickname: 'smoke', picks: nodes.slice(0, 3), usedPredictions: true, usedUncertainty: false };

await check('presence: the board sees a joining player', async () => {
  const seen = waitFor<PresenceState[]>((cb) => presenter.onPresence(cb), (ps) => ps.some((p) => p.playerId === play.playerId));
  player.joinPresence({ playerId: play.playerId, nickname: 'smoke', status: 'playing', roundId: r.id });
  await seen;
});
await check('a valid play is accepted and reaches the board live', async () => {
  const seen = waitFor<Play[]>((cb) => presenter.onPlays(r.id, cb), (ps) => ps.some((p) => p.playerId === play.playerId));
  expectEqual(await kind(player.submitPlay(play)), 'ok');
  const plays = await seen;
  expectEqual(plays.find((p) => p.playerId === play.playerId)?.picks.join(','), play.picks.join(','));
});
await check('a second play from the same player is a duplicate', async () => expectEqual(await kind(player.submitPlay(play)), 'duplicate'));
await check('a wrong budget is invalid', async () =>
  expectEqual(await kind(player.submitPlay({ ...play, playerId: crypto.randomUUID(), budget: 4, picks: nodes.slice(0, 4) })), 'invalid'));
await check('repeated picks are invalid', async () =>
  expectEqual(await kind(player.submitPlay({ ...play, playerId: crypto.randomUUID(), picks: [nodes[0], nodes[0], nodes[1]] })), 'invalid'));
await check('hiding a play reaches the board live', async () => {
  const plays = await waitFor<Play[]>((cb) => presenter.onPlays(r.id, cb), () => true);
  const mine = plays.find((p) => p.playerId === play.playerId)!;
  const seen = waitFor<Play[]>((cb) => presenter.onPlays(r.id, cb), (ps) => ps.some((p) => p.id === mine.id && p.hidden));
  await presenter.hidePlay(pin, mine.id);
  await seen;
});
await check('closing the round reaches players live', async () => {
  const seen = waitFor<Round[]>((cb) => player.onRounds(cb), (rs) => rs.some((x) => x.id === r.id && x.status === 'closed'));
  await presenter.closeRound(pin, r.id);
  await seen;
});
await check('a play after close is rejected', async () =>
  expectEqual(await kind(player.submitPlay({ ...play, playerId: crypto.randomUUID() })), 'round_closed'));

console.log(failed() === 0 ? 'All smoke checks passed.' : `${failed()} smoke check(s) failed.`);
process.exit(failed() === 0 ? 0 : 1);
