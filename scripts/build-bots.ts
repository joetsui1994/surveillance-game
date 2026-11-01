// Precompute bot trajectories for every preset × game outbreak. Usage: npm run data:bots
import { presetModel, scenarioFor } from '../src/core/presets.ts';
import { runPolicy, type Trajectory } from '../src/core/replay.ts';
import { makeRng } from '../src/core/rng.ts';
import { summarise, type BotResult, type BotsFile } from '../src/core/bots.ts';
import type { PolicyName } from '../src/core/policies.ts';
import { BOTS_PATH, loadPresets, writeJson } from './io.ts';

/** Model-driven policies run once (ties are rare after the first few steps); policies that are random
 *  among many equal candidates (DC on a grid: all interior nodes have degree 4) are averaged. */
const RUNS: Record<PolicyName, number> = { LE: 1, NE: 1, BALD: 1, DC: 200, RI: 200, RAND: 200 };

const out: BotsFile = { version: 1, presets: {} };
for (const preset of loadPresets().presets) {
  const model = presetModel(preset);
  out.presets[preset.id] = {};
  const finals: Record<string, { auc: number[]; acc: number[] }> = {};
  for (const ob of preset.outbreaks.filter((o) => o.split === 'game')) {
    const sc = scenarioFor(model, ob);
    const results: BotResult[] = [];
    for (const [policy, runs] of Object.entries(RUNS) as [PolicyName, number][]) {
      const trajectories: Trajectory[] = [];
      for (let r = 0; r < runs; r++) trajectories.push(runPolicy(sc, policy, preset.maxBudget, makeRng(r)));
      const res = summarise(policy, trajectories);
      results.push(res);
      const f = (finals[policy] ??= { auc: [], acc: [] });
      const aucAtBudget = res.auc.mean[preset.defaultBudget];
      if (aucAtBudget !== null) f.auc.push(aucAtBudget);
      f.acc.push(res.accuracy.mean[preset.defaultBudget] as number);
    }
    out.presets[preset.id][ob.id] = results;
  }
  const mean = (v: number[]) => (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3);
  console.log(`\n${preset.id}: mean AUC (accuracy) after ${preset.defaultBudget} tests (game outbreaks)`);
  for (const [policy, f] of Object.entries(finals)) console.log(`  ${policy.padEnd(5)} ${mean(f.auc)} (${mean(f.acc)})`);
}
writeJson(BOTS_PATH, out);
console.log(`\nWrote ${BOTS_PATH}`);
