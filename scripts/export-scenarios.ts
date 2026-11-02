// Export observation snapshots (from LE runs) plus the browser surrogate's predictions, for MCMC validation.
// Writes offline/out/scenarios.json; consumed by offline/validate_surrogate.py.
import { resolve } from 'node:path';
import { playedOutbreaks, presetModel, scenarioFor } from '../src/core/presets.ts';
import { runPolicy } from '../src/core/replay.ts';
import { fitLaplace, type Observation } from '../src/core/surrogate.ts';
import { makeRng } from '../src/core/rng.ts';
import { loadPresets, ROOT, writeJson } from './io.ts';

const OUTBREAKS_PER_PRESET = 3;
const scenarios = [];
for (const preset of loadPresets().presets) {
  const model = presetModel(preset);
  const steps = [0, Math.round(preset.defaultBudget / 2), preset.defaultBudget];
  for (const ob of playedOutbreaks(preset).slice(0, OUTBREAKS_PER_PRESET)) {
    const tr = runPolicy(scenarioFor(model, ob), 'LE', preset.defaultBudget, makeRng(0));
    for (const t of steps) {
      const obs: Observation[] = [ob.seedNode, ...tr.picks.slice(0, t)].map((node) => ({ node, y: ob.truth[node] }));
      const start = performance.now();
      const post = fitLaplace(model.K, preset.n, obs);
      scenarios.push({
        id: `${preset.id}/${ob.id}/t${t}`,
        n: preset.n,
        edges: preset.edges,
        prior: preset.prior,
        obs,
        p: Array.from(post.p),
        laplaceMs: performance.now() - start,
      });
    }
  }
}
const path = resolve(ROOT, 'offline/out/scenarios.json');
writeJson(path, scenarios);
console.log(`Wrote ${scenarios.length} scenarios to ${path}`);
