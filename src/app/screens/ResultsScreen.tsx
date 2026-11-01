import { useMemo, useState } from 'react';
import type { BotsFile } from '../../core/bots.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { AucChart, type ChartSeries } from '../components/AucChart.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { botResult } from '../data.ts';
import { scoreSession, type Session } from '../session.ts';
import { verdictText } from '../verdict.ts';

export interface ResultsScreenProps {
  model: PresetModel;
  outbreak: Outbreak;
  session: Session;
  bots: BotsFile;
  onPlayAgain: () => void;
  onChangeSettings: () => void;
}

// Validated categorical pair for the bots (dataviz palette check: CVD, normal vision, contrast);
// "You" is ink, Random a neutral reference. None reuse the graph's red/blue/orange.
const SERIES_STYLE = {
  you: { color: '#0b0b0b', width: 3 },
  le: { color: '#008300', width: 2 },
  ne: { color: '#6250d6', width: 2 },
  rand: { color: '#8a8984', width: 1.5, dash: '4 3' },
};

const fmt = (v: number | null) => (v === null ? '–' : v.toFixed(3));

export function ResultsScreen({ model, outbreak, session, bots, onPlayAgain, onChangeSettings }: ResultsScreenProps) {
  const { preset, graph } = model;
  const [hovered, setHovered] = useState<number | null>(null);
  const score = useMemo(() => scoreSession(model, outbreak, session), [model, outbreak, session]);
  const tested = new Map([session.seedNode, ...session.picks].map((node) => [node, outbreak.truth[node]]));
  const wrong = new Set(
    Array.from({ length: graph.n }, (_, j) => j).filter((j) => !tested.has(j) && (score.trajectory.final.p[j] > 0.5 ? 1 : 0) !== outbreak.truth[j]),
  );

  const upTo = session.budget + 1;
  const le = botResult(bots, preset.id, outbreak.id, 'LE').auc.mean.slice(0, upTo);
  const ne = botResult(bots, preset.id, outbreak.id, 'NE').auc.mean.slice(0, upTo);
  const rand = botResult(bots, preset.id, outbreak.id, 'RAND').auc;
  const series: ChartSeries[] = [
    { key: 'rand', name: 'Random (mean, 90% band)', short: 'Random', values: rand.mean.slice(0, upTo), ...SERIES_STYLE.rand },
    { key: 'ne', name: 'NE', short: 'NE', values: ne, ...SERIES_STYLE.ne },
    { key: 'le', name: 'LE (paper)', short: 'LE', values: le, ...SERIES_STYLE.le },
    { key: 'you', name: 'You', short: 'You', values: score.trajectory.auc, ...SERIES_STYLE.you },
  ];

  const verdict = verdictText(score.auc, [
    { name: 'LE', auc: le[session.budget] ?? null },
    { name: 'NE', auc: ne[session.budget] ?? null },
    { name: 'Random', auc: rand.mean[session.budget] ?? null },
  ]);

  return (
    <main className="results">
      <header className="bar">
        <div><b>Results</b> · {preset.name} · outbreak {outbreak.id}</div>
      </header>
      <div className="results-body">
        <div className="results-map">
          <GraphView graph={graph} layout={preset.layout} tested={tested} predictions={null} uncertainty={null} truth={outbreak.truth} wrong={wrong} hovered={hovered} onHover={setHovered} />
          <p className="muted small">Fill = <b>true</b> status · <b>+/−</b> your tests · <b>✕</b> = model's final guess was wrong</p>
        </div>
        <div className="results-side">
          <div className="scores">
            <div>
              <div className="label">AUC (paper metric)</div>
              <div className="hero" data-testid="score-auc">{fmt(score.auc)}</div>
            </div>
            <div>
              <div className="label">Learning-curve AUC</div>
              <div className="secondary">{fmt(score.aucArea)}</div>
              <div className="muted small">mean AUC over tests 1–{session.budget}</div>
            </div>
            <div>
              <div className="label">Accuracy</div>
              <div className="tertiary">{(100 * score.accuracy).toFixed(0)}%</div>
            </div>
          </div>
          <AucChart series={series} band={{ lo: rand.lo.slice(0, upTo), hi: rand.hi.slice(0, upTo), color: SERIES_STYLE.rand.color }} />
          <p className="verdict" data-testid="verdict">{verdict}</p>
          <div className="actions">
            <button className="primary" onClick={onPlayAgain}>Play another outbreak</button>
            <button onClick={onChangeSettings}>Change network or nickname</button>
          </div>
        </div>
      </div>
    </main>
  );
}
