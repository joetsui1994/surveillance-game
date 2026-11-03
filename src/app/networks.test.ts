import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BotsFile } from '../core/bots.ts';
import { layoutFaults } from '../core/layoutQuality.ts';
import { POLICIES } from '../core/policies.ts';
import { parsePresetFile } from '../core/presets.ts';
import { botResult } from './data.ts';

const presets = parsePresetFile(JSON.parse(readFileSync('public/data/presets.json', 'utf8'))).presets;
const bots = JSON.parse(readFileSync('public/data/bots.json', 'utf8')) as BotsFile;

describe('shipped networks', () => {
  it('are the grid, the hub network and the two town networks, in that order', () => {
    expect(presets.map((p) => p.id)).toEqual(['grid10', 'ba40', 'sbm45hi', 'sbm45lo']);
  });

  describe.each(presets.map((p) => [p.id, p] as const))('%s', (_, preset) => {
    it('has 5 round, 5 free and 20 calib outbreaks', () => {
      const count = (split: string) => preset.outbreaks.filter((o) => o.split === split).length;
      expect([count('round'), count('free'), count('calib')]).toEqual([5, 5, 20]);
    });

    it('has every bot for every played outbreak', () => {
      for (const o of preset.outbreaks.filter((o) => o.split !== 'calib'))
        for (const policy of POLICIES) expect(() => botResult(bots, preset.id, o.id, policy)).not.toThrow();
    });

    it('has a layout in [0, 1]² with no overlapping nodes or nodes on edges', () => {
      expect(preset.layout.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
      const faults = layoutFaults(preset.layout, preset.edges);
      expect(faults.close).toEqual([]);
      expect(faults.onEdge).toEqual([]);
    });

    it('labels communities only on the town networks', () => {
      expect(preset.communities === null).toBe(!preset.id.startsWith('sbm'));
    });
  });
});
