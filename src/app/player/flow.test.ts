import { describe, expect, it } from 'vitest';
import type { Round } from '../net/types.ts';
import type { Session } from '../session.ts';
import { afterSubmit, joinableRound, newSubmission, playerView, presenceStatus, retryDelay, shouldAutoJoin } from './flow.ts';

const round = (id: number, status: Round['status'] = 'open'): Round => ({
  id, number: id, presetId: 'grid10', outbreakId: 'ob00', budget: 2, rankMetric: 'auc', status, openedAt: '', closedAt: null,
});
const session = (picks: number[], roundId: number | null): Session => ({
  presetId: 'grid10', outbreakId: 'ob00', budget: 2, seedNode: 0, picks, usedPredictions: true, usedUncertainty: false, roundId,
});

describe('playerView', () => {
  const open2 = [round(1, 'closed'), round(2)];
  it('lobby offers the open round unless already joined', () => {
    expect(playerView(null, open2, null)).toEqual({ kind: 'start', round: open2[1] });
    expect(playerView(null, open2, 2)).toEqual({ kind: 'start', round: null });
    expect(playerView(null, null, null)).toEqual({ kind: 'start', round: null });
  });
  it('practice games show a banner for a joinable round', () => {
    expect(playerView(session([5], null), open2, null)).toEqual({ kind: 'play', round: null, banner: open2[1] });
    expect(playerView(session([5, 6], null), [round(1, 'closed')], null)).toEqual({ kind: 'practice-results', banner: null });
  });
  it('round games: play while open, missed if closed unfinished, results once finished', () => {
    expect(playerView(session([5], 2), open2, 2)).toEqual({ kind: 'play', round: open2[1], banner: null });
    expect(playerView(session([5], 1), open2, 1).kind).toBe('round-missed');
    expect(playerView(session([5, 6], 2), open2, 2)).toEqual({ kind: 'round-results', round: open2[1] });
    expect(playerView(session([5, 6], 1), open2, 1)).toEqual({ kind: 'round-results', round: open2[0] });
    expect(playerView(session([5], 9), open2, 9)).toEqual({ kind: 'stale' });
    expect(playerView(session([5], 2), null, 2)).toEqual({ kind: 'play', round: null, banner: null });
  });
  it('a round id reused for a different game (database reset) is stale', () => {
    expect(playerView(session([5], 2), [round(1, 'closed'), { ...round(2), outbreakId: 'ob01' }], 2)).toEqual({ kind: 'stale' });
    expect(playerView(session([5, 6], 2), [round(1, 'closed'), { ...round(2), presetId: 'ring' }], 2)).toEqual({ kind: 'stale' });
    expect(playerView(session([5], 2), [round(1, 'closed'), { ...round(2), budget: 3 }], 2)).toEqual({ kind: 'stale' });
  });
});

describe('shouldAutoJoin', () => {
  const r = round(3);
  it('joins from the lobby or after a finished practice game, never mid-game or without a name', () => {
    expect(shouldAutoJoin(null, r, 'ada')).toBe(true);
    expect(shouldAutoJoin(null, r, '  ')).toBe(false);
    expect(shouldAutoJoin(session([1, 2], null), r, 'ada')).toBe(true);
    expect(shouldAutoJoin(session([1], null), r, 'ada')).toBe(false);
    expect(shouldAutoJoin(session([1, 2], 1), r, 'ada')).toBe(false);
    expect(shouldAutoJoin(null, null, 'ada')).toBe(false);
    expect(joinableRound([r], 3)).toBeNull();
  });
});

describe('submission', () => {
  it('builds the play from a finished round game', () => {
    const sub = newSubmission(session([5, 6], 2), 'p1', ' ada ');
    expect(sub).toEqual({ state: 'pending', play: { roundId: 2, presetId: 'grid10', outbreakId: 'ob00', budget: 2, playerId: 'p1', nickname: 'ada', picks: [5, 6], usedPredictions: true, usedUncertainty: false } });
    expect(() => newSubmission(session([5], 2), 'p1', 'ada')).toThrow();
    expect(() => newSubmission(session([5, 6], null), 'p1', 'ada')).toThrow();
  });
  it('treats duplicate as delivered, keeps network failures pending, and rejects the rest', () => {
    const sub = newSubmission(session([5, 6], 2), 'p1', 'ada');
    expect(afterSubmit(sub, null).state).toBe('sent');
    expect(afterSubmit(sub, 'duplicate').state).toBe('sent');
    expect(afterSubmit(sub, 'network')).toBe(sub);
    expect(afterSubmit(sub, 'round_closed')).toMatchObject({ state: 'rejected', reason: 'round_closed' });
  });
  it('backs off exponentially up to 15 s', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
});

describe('presenceStatus', () => {
  it('reports lobby, free play, playing and finished', () => {
    expect(presenceStatus(null)).toEqual({ status: 'lobby', roundId: null });
    expect(presenceStatus(session([1], null))).toEqual({ status: 'free', roundId: null });
    expect(presenceStatus(session([1], 4))).toEqual({ status: 'playing', roundId: 4 });
    expect(presenceStatus(session([1, 2], 4))).toEqual({ status: 'finished', roundId: 4 });
  });
});
