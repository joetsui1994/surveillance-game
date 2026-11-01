import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePresetFile } from '../core/presets.ts';
import type { BotsFile } from '../core/bots.ts';
import { makeRng } from '../core/rng.ts';
import { botResult, chooseOutbreak } from './data.ts';

const preset = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets[0];
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;

describe('chooseOutbreak', () => {
  it('only returns game outbreaks and never repeats the previous one', () => {
    const rng = makeRng(1);
    for (let k = 0; k < 50; k++) {
      const o = chooseOutbreak(preset, 'ob00', rng);
      expect(o.split).toBe('game');
      expect(o.id).not.toBe('ob00');
    }
  });
});

describe('botResult', () => {
  it('finds a bot curve covering the maximum budget', () => {
    const le = botResult(bots, preset.id, 'ob00', 'LE');
    expect(le.auc.mean).toHaveLength(preset.maxBudget + 1);
    expect(() => botResult(bots, preset.id, 'nope', 'LE')).toThrow(/No LE bot/);
  });
});
