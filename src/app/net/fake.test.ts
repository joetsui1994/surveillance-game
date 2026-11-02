import { describe, expect, it } from 'vitest';
import { FakeRoundsApi } from './fake.ts';
import { latestRound, openRound, PinError, SubmitError, type NewPlay, type Play, type Round } from './types.ts';

const cfg = { presetId: 'grid10', outbreakId: 'ob00', budget: 3, rankMetric: 'auc' as const };
const play = (over: Partial<NewPlay> = {}): NewPlay => ({
  roundId: 1, presetId: 'grid10', outbreakId: 'ob00', budget: 3, playerId: 'p1', nickname: 'ada', picks: [1, 2, 3], usedPredictions: false, usedUncertainty: false, ...over,
});
const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: SubmitError) => e.kind);

describe('FakeRoundsApi', () => {
  it('opens a round, closing any open one, and numbers rounds in order', async () => {
    const api = new FakeRoundsApi();
    let seen: Round[] = [];
    api.onRounds((r) => (seen = r));
    await api.openRound('1234', cfg);
    await api.openRound('1234', { ...cfg, outbreakId: 'ob01' });
    expect(seen.map((r) => [r.number, r.status])).toEqual([[1, 'closed'], [2, 'open']]);
    expect(openRound(seen)?.outbreakId).toBe('ob01');
    expect(latestRound(seen)?.number).toBe(2);
  });

  it('rejects presenter actions with a wrong PIN', async () => {
    const api = new FakeRoundsApi();
    await expect(api.openRound('0000', cfg)).rejects.toBeInstanceOf(PinError);
    expect(await api.checkPin('0000')).toBe(false);
    expect(await api.checkPin('1234')).toBe(true);
  });

  it('accepts one valid play per player and enforces the database rules', async () => {
    const api = new FakeRoundsApi();
    await api.openRound('1234', cfg);
    let plays: Play[] = [];
    api.onPlays(1, (p) => (plays = p));
    expect(await kind(api.submitPlay(play()))).toBe('ok');
    expect(await kind(api.submitPlay(play()))).toBe('duplicate');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', budget: 4, picks: [1, 2, 3, 4] })))).toBe('invalid');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', picks: [1, 1, 2] })))).toBe('invalid');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', outbreakId: 'ob01' })))).toBe('invalid');
    expect(await kind(api.submitPlay(play({ playerId: 'p2', nickname: '  ' })))).toBe('invalid');
    api.offline = true;
    expect(await kind(api.submitPlay(play({ playerId: 'p2' })))).toBe('network');
    api.offline = false;
    await api.closeRound('1234', 1);
    expect(await kind(api.submitPlay(play({ playerId: 'p2' })))).toBe('round_closed');
    expect(plays).toHaveLength(1);
    await api.hidePlay('1234', plays[0].id);
    expect(plays[0].hidden).toBe(true);
  });

  it('tracks presence', () => {
    const api = new FakeRoundsApi();
    let players: unknown[] = [];
    api.onPresence((p) => (players = p));
    const me = api.joinPresence({ playerId: 'p1', nickname: 'ada', status: 'lobby', roundId: null });
    me.update({ playerId: 'p1', nickname: 'ada', status: 'playing', roundId: 1 });
    expect(players).toEqual([{ playerId: 'p1', nickname: 'ada', status: 'playing', roundId: 1 }]);
    me.leave();
    expect(players).toEqual([]);
  });
});
