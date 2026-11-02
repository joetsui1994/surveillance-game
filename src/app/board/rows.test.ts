import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BotsFile } from '../../core/bots.ts';
import { parsePresetFile, presetModel } from '../../core/presets.ts';
import type { Play, Round } from '../net/types.ts';
import { botRows, leaderboardRows, roomMedian } from './rows.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;
const model = presetModel(preset);
const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;
const round: Round = { id: 1, number: 1, presetId: preset.id, outbreakId: outbreak.id, budget: 4, rankMetric: 'auc', status: 'closed', openedAt: '', closedAt: '' };
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode);
const play = (id: number, picks: number[]): Play => ({
  id, roundId: 1, presetId: preset.id, outbreakId: outbreak.id, budget: 4, playerId: `p${id}`, nickname: `p${id}`, picks,
  usedPredictions: id === 1, usedUncertainty: false, hidden: false, createdAt: '',
});
const plays = [play(1, others.slice(0, 4)), play(2, others.slice(40, 44)), play(3, others.slice(80, 84))];

describe('leaderboardRows', () => {
  it('ranks players by the round metric, best first', () => {
    const rows = leaderboardRows(model, outbreak, round, plays, bots, false);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.bot)).toBe(true);
    expect(rows[0].rank).toBe(1);
    for (let k = 1; k < rows.length; k++) expect(rows[k - 1].auc! >= rows[k].auc!).toBe(true);
  });

  it('places revealed bots by value without giving them ranks', () => {
    const rows = leaderboardRows(model, outbreak, round, plays, bots, true);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.bot).map((r) => r.rank)).toEqual([null, null, null]);
    const values = rows.map((r) => r.auc ?? -1);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('bot rows use the round budget; LE and NE are replayable, Random is not', () => {
    const [le, ne, rand] = botRows(bots, preset.id, outbreak.id, 4);
    expect(le.curve).toHaveLength(5);
    expect(le.picks).toHaveLength(4);
    expect(ne.picks).toHaveLength(4);
    expect(rand.picks).toBeNull();
    expect(le.auc).toBe(le.curve[4]);
  });

  it('roomMedian ignores bots', () => {
    const rows = leaderboardRows(model, outbreak, round, plays, bots, true);
    expect(roomMedian(rows)).toEqual(roomMedian(rows.filter((r) => !r.bot)));
    expect(roomMedian(rows)).toHaveLength(5);
  });
});
