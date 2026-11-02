import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile } from '../core/presets.ts';
import type { BotsFile } from '../core/bots.ts';
import { makeRng } from '../core/rng.ts';
import { botResult, chooseOutbreak } from './data.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;

describe('chooseOutbreak', () => {
  it('only returns free-play outbreaks and never repeats the previous one', () => {
    const rng = makeRng(1);
    const previous = preset.outbreaks.find((o) => o.split === 'free')!.id;
    for (let k = 0; k < 50; k++) {
      const o = chooseOutbreak(preset, previous, rng);
      expect(o.split).toBe('free');
      expect(o.id).not.toBe(previous);
    }
  });

  it('presets.json has 5 round and 5 free outbreaks, and bots cover all of them', () => {
    expect(preset.outbreaks.filter((o) => o.split === 'round')).toHaveLength(5);
    expect(preset.outbreaks.filter((o) => o.split === 'free')).toHaveLength(5);
    for (const o of preset.outbreaks.filter((o) => o.split !== 'calib')) expect(() => botResult(bots, preset.id, o.id, 'LE')).not.toThrow();
  });
});

describe('botResult', () => {
  it('finds a bot curve covering the maximum budget', () => {
    const le = botResult(bots, preset.id, 'ob00', 'LE');
    expect(le.auc.mean).toHaveLength(preset.maxBudget + 1);
    expect(() => botResult(bots, preset.id, 'nope', 'LE')).toThrow(/No LE bot/);
  });
});
