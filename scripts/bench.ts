// Speed benchmark for the in-browser surrogate. Usage: npm run bench [-- path/to/graph.adjlist]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeGraph, type Graph } from '../src/core/graph.ts';
import { carCovariance, DEFAULT_PRIOR } from '../src/core/prior.ts';
import { fitLaplace, type Observation } from '../src/core/surrogate.ts';
import { baldScores, leScores, neScores } from '../src/core/policies.ts';
import { runPolicy } from '../src/core/replay.ts';
import { makeRng } from '../src/core/rng.ts';
import { loadPresets, ROOT } from './io.ts';

const PAPER_SBM = resolve(ROOT, '../optimal-disease-surveillance-AL/materials/synthetic-graphs/SB-high_modularity/SB-high_modularity-seed865503.relabelled.adjlist');

function parseAdjlist(text: string): Graph {
  const edges: [number, number][] = [];
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [u, ...vs] = line.trim().split(/\s+/).map(Number);
    n = Math.max(n, u + 1, ...vs.map((v) => v + 1));
    for (const v of vs) edges.push([u, v]);
  }
  return makeGraph(n, edges);
}

function time(fn: () => void, reps: number): number {
  fn(); // warm-up
  const t = performance.now();
  for (let r = 0; r < reps; r++) fn();
  return (performance.now() - t) / reps;
}

function bench(label: string, g: Graph) {
  const rng = makeRng(0);
  let K: Float64Array = new Float64Array(0);
  const kMs = time(() => { K = carCovariance(g, DEFAULT_PRIOR); }, 5);
  console.log(`\n### ${label} (n = ${g.n}, edges = ${g.edges.length})\n`);
  console.log('| operation | ms |\n|---|---|');
  console.log(`| build prior covariance (once per graph) | ${kMs.toFixed(2)} |`);
  for (const m of [1, 10, 20, 30]) {
    const nodes = Array.from({ length: g.n }, (_, i) => i).sort(() => rng() - 0.5).slice(0, m);
    const obs: Observation[] = nodes.map((node) => ({ node, y: rng() < 0.4 ? 1 : 0 }));
    console.log(`| fit, ${m} observations | ${time(() => fitLaplace(K, g.n, obs), 200).toFixed(3)} |`);
  }
  const post = fitLaplace(K, g.n, [{ node: 0, y: 1 }]);
  console.log(`| NE scores | ${time(() => neScores(post), 200).toFixed(3)} |`);
  console.log(`| BALD scores | ${time(() => baldScores(post), 200).toFixed(3)} |`);
  console.log(`| LE scores | ${time(() => leScores(g, post), 200).toFixed(3)} |`);
  const truth = Array.from({ length: g.n }, (_, i) => (i % 3 === 0 ? 1 : 0) as 0 | 1);
  const budget = Math.round(0.3 * g.n);
  const sc = { graph: g, K, truth, seedNode: 0 };
  console.log(`| full LE run, budget ${budget} | ${time(() => runPolicy(sc, 'LE', budget, makeRng(1)), 3).toFixed(1)} |`);
}

const grid = loadPresets().presets.find((p) => p.id === 'grid10');
if (grid) bench('grid10', makeGraph(grid.n, grid.edges));
const extra = process.argv[2] ?? (existsSync(PAPER_SBM) ? PAPER_SBM : undefined);
if (extra) bench(`adjlist: ${extra.split('/').pop()}`, parseAdjlist(readFileSync(extra, 'utf8')));
