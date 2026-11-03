import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePresetFile, type Preset, type PresetFile } from '../src/core/presets.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRESETS_PATH = resolve(ROOT, 'public/data/presets.json');
export const BOTS_PATH = resolve(ROOT, 'public/data/bots.json');

export function loadPresets(path = PRESETS_PATH): PresetFile {
  return parsePresetFile(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

/** SHA-256 of everything the bot results depend on, so bots.json can be checked against presets.json. */
export function presetFingerprint({ edges, outbreaks, prior, defaultBudget, maxBudget }: Preset): string {
  return createHash('sha256').update(JSON.stringify({ edges, outbreaks, prior, defaultBudget, maxBudget })).digest('hex');
}
