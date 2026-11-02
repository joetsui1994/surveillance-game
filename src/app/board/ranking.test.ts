import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel } from '../../core/presets.ts';
import type { Play } from '../net/types.ts';
import { displayNames, firstPickCounts, formatMetric, medianCurve, metricValue, rankBy, scorePlays } from './ranking.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const model = presetModel(preset);
const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;
const others = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode);

let id = 0;
const play = (nickname: string, picks: number[], over: Partial<Play> = {}): Play => ({
  id: ++id, roundId: 1, presetId: preset.id, outbreakId: outbreak.id, budget: picks.length, playerId: `p${id}`, nickname, picks,
  usedPredictions: false, usedUncertainty: false, hidden: false, createdAt: '', ...over,
});

describe('rankBy', () => {
  it('ranks best first, shares ranks for ties at 3 dp and puts missing values last', () => {
    const items = [{ v: 0.9 }, { v: null }, { v: 0.95 }, { v: 0.9001 }, { v: 0.8 }];
    expect(rankBy(items, (x) => x.v).map(({ item, rank }) => [item.v, rank])).toEqual([[0.95, 1], [0.9001, 2], [0.9, 2], [0.8, 4], [null, null]]);
  });
});

describe('displayNames', () => {
  it('suffixes repeated nicknames in submission order, ignoring case and spaces', () => {
    const plays = [play('ada', [0]), play('Bob', [0]), play(' ada', [0]), play('ADA', [0])];
    expect([...displayNames(plays).values()]).toEqual(['ada', 'Bob', 'ada (2)', 'ADA (3)']);
  });
});

describe('scorePlays', () => {
  it('replays picks into scores and drops hidden and invalid plays', () => {
    const good = play('ada', others.slice(0, 3));
    const hidden = play('bob', others.slice(0, 3), { hidden: true });
    const seed = play('cy', [outbreak.seedNode, others[0], others[1]]);
    const scored = scorePlays(model, outbreak, [good, hidden, seed]);
    expect(scored.map((s) => s.name)).toEqual(['ada']);
    expect(scored[0].curve).toHaveLength(4);
    expect(scored[0].auc).toBe(scored[0].curve[3]);
    expect(metricValue(scored[0], 'lc_auc')).toBe(scored[0].aucArea);
  });
});

describe('helpers', () => {
  it('medianCurve takes the per-step median and skips nulls', () => {
    expect(medianCurve([[0.5, 0.6, null], [0.7, 0.8, 0.9], [0.6, null, 0.7]])).toEqual([0.6, 0.7, 0.8]);
  });
  it('firstPickCounts counts visible first picks', () => {
    const counts = firstPickCounts([play('a', [3, 4]), play('b', [3]), play('c', [5]), play('d', [3], { hidden: true })], 10);
    expect(counts[3]).toBe(2);
    expect(counts[5]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it('formatMetric shows accuracy as a percentage', () => {
    expect(formatMetric(0.8123, 'auc')).toBe('0.812');
    expect(formatMetric(0.8123, 'accuracy')).toBe('81%');
    expect(formatMetric(null, 'auc')).toBe('–');
  });
});
