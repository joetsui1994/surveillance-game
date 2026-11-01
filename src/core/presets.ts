import { makeGraph, type Graph } from './graph.ts';
import { carCovariance, type PriorParams } from './prior.ts';
import type { Scenario } from './replay.ts';

export interface Outbreak {
  id: string;
  /** 'game' outbreaks are played; 'calib' outbreaks are only used to calibrate the prior. */
  split: 'game' | 'calib';
  truth: (0 | 1)[];
  seedNode: number;
  prevalence: number;
}

export interface Preset {
  id: string;
  name: string;
  n: number;
  edges: [number, number][];
  /** Node positions in [0, 1]². */
  layout: [number, number][];
  communities: number[] | null;
  defaultBudget: number;
  maxBudget: number;
  prior: PriorParams;
  outbreaks: Outbreak[];
}

export interface PresetFile {
  version: 1;
  presets: Preset[];
}

/** Light structural validation of presets.json; throws with a useful message. */
export function parsePresetFile(json: unknown): PresetFile {
  const file = json as PresetFile;
  if (file?.version !== 1 || !Array.isArray(file.presets)) throw new Error('presets: expected { version: 1, presets: [...] }');
  for (const p of file.presets) {
    if (p.layout.length !== p.n) throw new Error(`presets/${p.id}: layout length ${p.layout.length} ≠ n ${p.n}`);
    if (!(p.defaultBudget > 0 && p.defaultBudget <= p.maxBudget && p.maxBudget < p.n))
      throw new Error(`presets/${p.id}: budgets must satisfy 0 < default ≤ max < n`);
    for (const o of p.outbreaks) {
      if (o.truth.length !== p.n) throw new Error(`presets/${p.id}/${o.id}: truth length ≠ n`);
      if (!(o.seedNode >= 0 && o.seedNode < p.n)) throw new Error(`presets/${p.id}/${o.id}: seedNode out of range`);
    }
  }
  return file;
}

export interface PresetModel {
  preset: Preset;
  graph: Graph;
  K: Float64Array;
}

/** Build the graph and prior covariance for a preset (do this once per preset). */
export function presetModel(preset: Preset): PresetModel {
  const graph = makeGraph(preset.n, preset.edges);
  return { preset, graph, K: carCovariance(graph, preset.prior) };
}

export function scenarioFor(model: PresetModel, outbreak: Outbreak): Scenario {
  return { graph: model.graph, K: model.K, truth: outbreak.truth, seedNode: outbreak.seedNode };
}
