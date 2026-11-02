import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel, scenarioFor, type Preset } from './presets.ts';

const tiny: Preset = {
  id: 'path4',
  name: 'Path',
  n: 4,
  edges: [[0, 1], [1, 2], [2, 3]],
  layout: [[0, 0], [0.33, 0], [0.66, 0], [1, 0]],
  communities: null,
  defaultBudget: 1,
  maxBudget: 2,
  prior: { alpha: 0.9, tau: 1, b0Var: 1 },
  outbreaks: [{ id: 'ob00', split: 'round', truth: [1, 1, 0, 0], seedNode: 0, prevalence: 0.5 }],
};

describe('parsePresetFile', () => {
  it('accepts a valid file', () => {
    expect(parsePresetFile({ version: 1, presets: [tiny] }).presets[0].id).toBe('path4');
  });

  it('rejects malformed files', () => {
    expect(() => parsePresetFile({ version: 2, presets: [] })).toThrow(/version/);
    expect(() => parsePresetFile({ version: 1, presets: [{ ...tiny, maxBudget: 4 }] })).toThrow(/budgets/);
    const badTruth = { ...tiny, outbreaks: [{ ...tiny.outbreaks[0], truth: [1, 0] as (0 | 1)[] }] };
    expect(() => parsePresetFile({ version: 1, presets: [badTruth] })).toThrow(/truth/);
  });
});

describe('presetModel / scenarioFor', () => {
  it('builds a graph, covariance and scenario', () => {
    const model = presetModel(tiny);
    expect(model.graph.n).toBe(4);
    expect(model.K).toHaveLength(16);
    const sc = scenarioFor(model, tiny.outbreaks[0]);
    expect(sc.seedNode).toBe(0);
    expect(sc.truth).toEqual([1, 1, 0, 0]);
  });
});
