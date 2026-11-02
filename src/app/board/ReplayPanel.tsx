import { useEffect, useMemo, useState } from 'react';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { AucChart } from '../components/AucChart.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { replayFrames } from './frames.ts';
import type { Row } from './rows.ts';

export interface ReplayPanelProps {
  model: PresetModel;
  outbreak: Outbreak;
  row: Row;
  /** For the mini chart. */
  le: (number | null)[];
  median: (number | null)[];
  onClose: () => void;
}

/** Step through one game: the map after each test, with commentary and the AUC so far. */
export function ReplayPanel({ model, outbreak, row, le, median, onClose }: ReplayPanelProps) {
  const picks = row.picks ?? [];
  const frames = useMemo(() => replayFrames(model, outbreak, picks), [model, outbreak, row.key]);
  const last = frames.length - 1;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showPredictions, setShowPredictions] = useState(true);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [showTruth, setShowTruth] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    if (t >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setT((x) => Math.min(last, x + 1)), 1200);
    return () => clearTimeout(timer);
  }, [playing, t, last]);

  const frame = frames[t];
  const order = new Map(picks.slice(0, t).map((node, k) => [node, k + 1]));
  const go = (next: number) => {
    setPlaying(false);
    setT(Math.max(0, Math.min(last, next)));
  };

  return (
    <div className="replay" data-testid="replay">
      <div className="replay-head">
        <b>Replaying {row.name}</b>
        <button onClick={onClose}>← Back to results</button>
      </div>
      <div className="replay-body">
        <GraphView
          graph={model.graph}
          layout={model.preset.layout}
          tested={frame.tested}
          predictions={showPredictions && !showTruth ? frame.p : null}
          uncertainty={showUncertainty && !showTruth ? frame.uncertainty : null}
          truth={showTruth ? outbreak.truth : undefined}
          hovered={hovered}
          onHover={setHovered}
          order={order}
        />
        <div className="replay-side">
          <div className="replay-controls">
            <button aria-label="First" onClick={() => go(0)}>⏮</button>
            <button aria-label="Previous" onClick={() => go(t - 1)}>◀</button>
            <button className="primary" onClick={() => (playing ? setPlaying(false) : (t >= last ? (setT(0), setPlaying(true)) : setPlaying(true)))}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button aria-label="Next" onClick={() => go(t + 1)}>▶</button>
            <button aria-label="Last" onClick={() => go(last)}>⏭</button>
            <span data-testid="replay-step">Test {t} of {last}</span>
          </div>
          <input type="range" aria-label="Step" min={0} max={last} value={t} onChange={(e) => go(Number(e.target.value))} />
          <div className="toggles">
            <label><input type="checkbox" checked={showPredictions} onChange={(e) => setShowPredictions(e.target.checked)} /> Model predictions</label>
            <label><input type="checkbox" checked={showUncertainty} onChange={(e) => setShowUncertainty(e.target.checked)} /> Uncertainty rings</label>
            <label><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> Reveal true outbreak</label>
          </div>
          <p className="commentary" data-testid="commentary">{frame.commentary}</p>
          <AucChart
            title={`AUC after each test: ${row.name} vs LE and the room`}
            subtitle="Orange line = current step"
            marker={t}
            series={[
              { key: 'median', name: 'Room median', short: 'Room', color: '#8a8984', width: 2, dash: '4 3', values: median },
              { key: 'le', name: 'LE (paper)', short: 'LE', color: '#008300', width: 2, values: le },
              { key: 'row', name: row.name, short: row.bot ? row.name.split(' ')[0] : row.name, color: '#0b0b0b', width: 3, values: row.curve },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
