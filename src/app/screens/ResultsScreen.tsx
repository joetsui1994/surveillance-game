import { useMemo, useState, type ReactNode } from 'react';
import type { BotsFile } from '../../core/bots.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { AucChart, type ChartSeries } from '../components/AucChart.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { botResult } from '../data.ts';
import { scoreSession, type Session } from '../session.ts';

export interface ResultsScreenProps {
  model: PresetModel;
  outbreak: Outbreak;
  session: Session;
  bots: BotsFile;
  /** Header title; defaults to "Results". */
  title?: string;
  /** Compare with the bots (chart lines). Off while a round is still open. */
  showComparison?: boolean;
  /** Shown above the scores, e.g. the player's rank or "waiting for the presenter". */
  notice?: ReactNode;
  /** Optional banner under the header. */
  banner?: ReactNode;
  actions: ReactNode;
}

// Validated categorical colours for the bots (dataviz palette check: CVD, normal vision, contrast), the
// same as on the board; "You" is ink, Random a neutral reference.
const SERIES_STYLE = {
  you: { color: '#0b0b0b', width: 3 },
  le: { color: '#008300', width: 2 },
  ne: { color: '#6250d6', width: 2 },
  bald: { color: '#2a8fd4', width: 2 },
  dc: { color: '#cc3d6e', width: 2 },
  rand: { color: '#8a8984', width: 1.5, dash: '4 3' },
};

const fmt = (v: number | null) => (v === null ? '–' : v.toFixed(3));

export function ResultsScreen({ model, outbreak, session, bots, title = 'Results', showComparison = true, notice, banner, actions }: ResultsScreenProps) {
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
  const bald = botResult(bots, preset.id, outbreak.id, 'BALD').auc.mean.slice(0, upTo);
  const dc = botResult(bots, preset.id, outbreak.id, 'DC').auc.mean.slice(0, upTo);
  const rand = botResult(bots, preset.id, outbreak.id, 'RAND').auc;
  const you: ChartSeries = { key: 'you', name: 'You', short: 'You', values: score.trajectory.auc, ...SERIES_STYLE.you };
  const series: ChartSeries[] = showComparison
    ? [
        { key: 'rand', name: 'Random: average, and range of 90% of runs', short: 'Random', values: rand.mean.slice(0, upTo), ...SERIES_STYLE.rand },
        { key: 'dc', name: 'DC (degree, mean)', short: 'DC', values: dc, ...SERIES_STYLE.dc },
        { key: 'bald', name: 'BALD', short: 'BALD', values: bald, ...SERIES_STYLE.bald },
        { key: 'ne', name: 'NE', short: 'NE', values: ne, ...SERIES_STYLE.ne },
        { key: 'le', name: 'LE', short: 'LE', values: le, ...SERIES_STYLE.le },
        you,
      ]
    : [you];

  return (
    <main className="results">
      <header className="bar">
        <div><b>{title}</b> · {preset.name} · outbreak {outbreak.id}</div>
      </header>
      {banner}
      <div className="results-body">
        <div className="results-map">
          <GraphView graph={graph} layout={preset.layout} tested={tested} predictions={null} uncertainty={null} truth={outbreak.truth} wrong={wrong} hovered={hovered} onHover={setHovered} />
          <p className="muted small">Fill = <b>true</b> status · <b>+/−</b> your tests · <b>✕</b> = model's final guess was wrong</p>
        </div>
        <div className="results-side">
          {notice}
          <div className="scores">
            <div>
              <div className="label">AUC</div>
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
          <AucChart series={series} band={showComparison ? { lo: rand.lo.slice(0, upTo), hi: rand.hi.slice(0, upTo), color: SERIES_STYLE.rand.color } : undefined} />
          <div className="actions">{actions}</div>
        </div>
      </div>
    </main>
  );
}
