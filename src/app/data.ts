import type { BotResult, BotsFile } from '../core/bots.ts';
import type { PolicyName } from '../core/policies.ts';
import { parsePresetFile, type Outbreak, type Preset, type PresetFile } from '../core/presets.ts';

export interface GameData {
  presets: PresetFile;
  bots: BotsFile;
}

export async function loadGameData(base: string = import.meta.env.BASE_URL): Promise<GameData> {
  const get = async (name: string) => {
    const res = await fetch(`${base}data/${name}`);
    if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
    return res.json();
  };
  const [presets, bots] = await Promise.all([get('presets.json'), get('bots.json')]);
  if ((bots as BotsFile)?.version !== 1) throw new Error('bots.json: expected version 1');
  return { presets: parsePresetFile(presets), bots: bots as BotsFile };
}

export function botResult(bots: BotsFile, presetId: string, outbreakId: string, policy: PolicyName): BotResult {
  const r = bots.presets[presetId]?.[outbreakId]?.find((b) => b.policy === policy);
  if (!r) throw new Error(`No ${policy} bot for ${presetId}/${outbreakId}`);
  return r;
}

/** A random 'game' outbreak, avoiding `previousId` when there is a choice. */
export function chooseOutbreak(preset: Preset, previousId: string | null, rng: () => number = Math.random): Outbreak {
  const games = preset.outbreaks.filter((o) => o.split === 'game');
  if (games.length === 0) throw new Error(`${preset.id}: no game outbreaks`);
  const pool = games.length > 1 ? games.filter((o) => o.id !== previousId) : games;
  return pool[Math.floor(rng() * pool.length)];
}
