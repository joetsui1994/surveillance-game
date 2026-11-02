import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile, presetModel, scenarioFor } from '../../core/presets.ts';
import { replay } from '../../core/replay.ts';
import { replayFrames } from './frames.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const model = presetModel(preset);
const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;

describe('replayFrames', () => {
  it('has one frame per step whose AUC matches the scored trajectory', () => {
    const infected = outbreak.truth.findIndex((y, j) => y === 1 && j !== outbreak.seedNode);
    const picks = [infected, ...Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode && j !== infected).slice(0, 4)];
    const frames = replayFrames(model, outbreak, picks);
    const tr = replay(scenarioFor(model, outbreak), picks);
    expect(frames).toHaveLength(picks.length + 1);
    expect(frames.map((f) => f.auc)).toEqual(tr.auc);
    expect(frames[2].tested.size).toBe(3);
    expect(frames[0].commentary).toMatch(/^Start: only the starting location \d+ is tested/);
    expect(frames[1].commentary).toMatch(/^Test 1: location \d+, infected · /);
    expect(frames[2].commentary).toMatch(/hops from the nearest known infection|next to a known infection/);
    for (const f of frames) for (const node of f.tested.keys()) expect(f.uncertainty[node]).toBe(0);
  });
});
