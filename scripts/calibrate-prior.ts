// Grid-search the CAR prior (alpha, tau, b0Var) per preset on its 'calib' outbreaks, maximising the mean
// learning-curve accuracy of LE and Random. Usage: npm run data:calibrate  (add --write to update presets.json)
import { makeGraph } from '../src/core/graph.ts';
import { carCovariance, type PriorParams } from '../src/core/prior.ts';
import { runPolicy } from '../src/core/replay.ts';
import { lcArea } from '../src/core/metrics.ts';
import { makeRng } from '../src/core/rng.ts';
import { loadPresets, PRESETS_PATH, writeJson } from './io.ts';

const ALPHAS = [0.5, 0.8, 0.9, 0.95, 0.99];
const TAUS = [0.01, 0.03, 0.1, 0.3, 1];
const B0_VARS = [0.01, 0.1, 1];
const RANDOM_RUNS = 3;

const write = process.argv.includes('--write');
const file = loadPresets();

for (const preset of file.presets) {
  const graph = makeGraph(preset.n, preset.edges);
  const calib = preset.outbreaks.filter((o) => o.split === 'calib');
  if (calib.length === 0) throw new Error(`${preset.id}: no calib outbreaks`);
  const results: { prior: PriorParams; score: number }[] = [];
  for (const alpha of ALPHAS) for (const tau of TAUS) for (const b0Var of B0_VARS) {
    const prior = { alpha, tau, b0Var };
    const K = carCovariance(graph, prior);
    let total = 0;
    let count = 0;
    for (const ob of calib) {
      const sc = { graph, K, truth: ob.truth, seedNode: ob.seedNode };
      total += lcArea(runPolicy(sc, 'LE', preset.defaultBudget, makeRng(0)).accuracy);
      count++;
      for (let r = 0; r < RANDOM_RUNS; r++) {
        total += lcArea(runPolicy(sc, 'RAND', preset.defaultBudget, makeRng(r)).accuracy);
        count++;
      }
    }
    results.push({ prior, score: total / count });
  }
  results.sort((a, b) => b.score - a.score);
  console.log(`\n${preset.id} — top 5 of ${results.length} (mean learning-curve accuracy on ${calib.length} calib outbreaks)`);
  for (const r of results.slice(0, 5)) console.log(`  alpha=${r.prior.alpha} tau=${r.prior.tau} b0Var=${r.prior.b0Var}  ${r.score.toFixed(4)}`);
  const best = results[0].prior;
  const edges: [string, number, number[]][] = [['alpha', best.alpha, ALPHAS], ['tau', best.tau, TAUS], ['b0Var', best.b0Var, B0_VARS]];
  for (const [name, value, grid] of edges)
    if (value === grid[0] || value === grid[grid.length - 1]) console.warn(`  ⚠ best ${name}=${value} is on the grid boundary; consider extending the grid`);
  preset.prior = best;
}

if (write) {
  writeJson(PRESETS_PATH, file);
  console.log(`\nWrote calibrated priors to ${PRESETS_PATH}`);
}
