import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel } from '../core/presets.ts';
import { replay } from '../core/replay.ts';
import { scenarioFor } from '../core/presets.ts';
import {
  deserializeSession, isFinished, isTested, isValidFor, noteToggles, observations, pick, scoreSession,
  serializeSession, startSession, testsLeft,
} from './session.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const outbreak = preset.outbreaks.find((o) => o.split === 'game')!;
const freeNode = (exclude: number[]) => [...Array(preset.n).keys()].find((i) => !exclude.includes(i))!;

describe('session', () => {
  it('starts with the seed tested and the full budget', () => {
    const s = startSession(preset, outbreak, 3);
    expect(s.picks).toEqual([]);
    expect(testsLeft(s)).toBe(3);
    expect(isTested(s, outbreak.seedNode)).toBe(true);
    expect(isFinished(s)).toBe(false);
  });

  it('defaults to the preset budget and rejects invalid budgets', () => {
    expect(startSession(preset, outbreak).budget).toBe(preset.defaultBudget);
    expect(() => startSession(preset, outbreak, 0)).toThrow(/budget/);
    expect(() => startSession(preset, outbreak, preset.maxBudget + 1)).toThrow(/budget/);
  });

  it('records picks immutably and finishes when the budget is spent', () => {
    const s0 = startSession(preset, outbreak, 2);
    const a = freeNode([outbreak.seedNode]);
    const s1 = pick(s0, a, preset.n);
    expect(s0.picks).toEqual([]);
    expect(s1.picks).toEqual([a]);
    const s2 = pick(s1, freeNode([outbreak.seedNode, a]), preset.n);
    expect(isFinished(s2)).toBe(true);
    expect(() => pick(s2, freeNode([outbreak.seedNode, ...s2.picks]), preset.n)).toThrow(/no tests left/);
  });

  it('rejects tested and out-of-range picks', () => {
    const s = startSession(preset, outbreak, 3);
    expect(() => pick(s, outbreak.seedNode, preset.n)).toThrow(/already tested/);
    expect(() => pick(s, preset.n, preset.n)).toThrow(/out of range/);
    expect(() => pick(s, -1, preset.n)).toThrow(/out of range/);
  });

  it('notes toggle use without resetting it', () => {
    const s = startSession(preset, outbreak, 3);
    expect(noteToggles(s, false, false)).toBe(s);
    const t = noteToggles(noteToggles(s, true, false), false, false);
    expect(t.usedPredictions).toBe(true);
    expect(t.usedUncertainty).toBe(false);
  });

  it('builds observations from the true outbreak', () => {
    const s = pick(startSession(preset, outbreak, 3), freeNode([outbreak.seedNode]), preset.n);
    expect(observations(s, outbreak.truth)).toEqual([outbreak.seedNode, ...s.picks].map((node) => ({ node, y: outbreak.truth[node] })));
  });

  it('scores a finished session exactly like replay', () => {
    const model = presetModel(preset);
    let s = startSession(preset, outbreak, 3);
    for (let k = 0; k < 3; k++) s = pick(s, freeNode([outbreak.seedNode, ...s.picks]), preset.n);
    const score = scoreSession(model, outbreak, s);
    const tr = replay(scenarioFor(model, outbreak), s.picks);
    expect(score.trajectory.auc).toEqual(tr.auc);
    expect(score.auc).toBe(tr.auc[3]);
    expect(score.accuracy).toBe(tr.accuracy[3]);
    expect(score.aucArea).not.toBeNull();
  });

  it('round-trips through serialisation and rejects garbage', () => {
    const s = pick(startSession(preset, outbreak, 3), freeNode([outbreak.seedNode]), preset.n);
    expect(deserializeSession(serializeSession(s))).toEqual(s);
    expect(deserializeSession(null)).toBeNull();
    expect(deserializeSession('not json')).toBeNull();
    expect(deserializeSession(JSON.stringify({ ...s, picks: 'x' }))).toBeNull();
  });
});

describe('isValidFor', () => {
  const s = pick(startSession(preset, outbreak, 3), freeNode([outbreak.seedNode]), preset.n);
  const other = preset.outbreaks.find((o) => o.split === 'game' && o.id !== outbreak.id && o.seedNode !== outbreak.seedNode)!;

  it('accepts a session that matches the current data', () => {
    expect(isValidFor(s, preset, outbreak)).toBe(true);
  });

  it('rejects stale or corrupt sessions (data regenerated, edited storage)', () => {
    expect(isValidFor(s, preset, other)).toBe(false); // different outbreak
    expect(isValidFor({ ...s, seedNode: (outbreak.seedNode + 1) % preset.n }, preset, outbreak)).toBe(false);
    expect(isValidFor({ ...s, picks: [preset.n] }, preset, outbreak)).toBe(false);
    expect(isValidFor({ ...s, picks: [s.picks[0], s.picks[0]] }, preset, outbreak)).toBe(false);
    expect(isValidFor({ ...s, picks: [outbreak.seedNode] }, preset, outbreak)).toBe(false);
    expect(isValidFor({ ...s, budget: 0, picks: [] }, preset, outbreak)).toBe(false);
    expect(isValidFor({ ...s, budget: preset.maxBudget + 1 }, preset, outbreak)).toBe(false);
  });
});
