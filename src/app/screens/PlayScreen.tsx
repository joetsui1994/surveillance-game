import { useMemo, useState, type ReactNode } from 'react';
import { probabilityStd } from '../../core/entropy.ts';
import type { Outbreak, PresetModel } from '../../core/presets.ts';
import { fitLaplace } from '../../core/surrogate.ts';
import { Explainer } from '../components/Explainer.tsx';
import { GraphView } from '../components/GraphView.tsx';
import { SidePanel } from '../components/SidePanel.tsx';
import { relativeScale } from '../scales.ts';
import { isFinished, isTested, noteToggles, observations, pick, testsLeft, type Session } from '../session.ts';

export interface PlayScreenProps {
  model: PresetModel;
  outbreak: Outbreak;
  session: Session;
  nickname: string;
  /** Receives an updater, so several clicks before a re-render are all applied in order. */
  onSessionChange: (update: (s: Session) => Session) => void;
  /** Header title, e.g. "Round 2"; defaults to the game name. */
  title?: string;
  /** Shown under the header, e.g. "Round 2 has started". */
  banner?: ReactNode;
}

export function PlayScreen({ model, outbreak, session, nickname, onSessionChange, title = 'Surveillance Game', banner }: PlayScreenProps) {
  const { preset, graph, K } = model;
  const [showPredictions, setShowPredictions] = useState(false);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [showKey, setShowKey] = useState(false);

  const obs = observations(session, outbreak.truth);
  const tested = useMemo(() => new Map(obs.map((o) => [o.node, o.y])), [session.picks]);
  const posterior = useMemo(() => fitLaplace(K, graph.n, obs), [session.picks]);
  const { pStd, relUncertainty, rank } = useMemo(() => {
    const pStd = Float64Array.from(posterior.mean, (mu, j) => probabilityStd(mu, posterior.variance[j]));
    const untested = Array.from({ length: graph.n }, (_, j) => j).filter((j) => !tested.has(j));
    const rank = new Map([...untested].sort((a, b) => pStd[b] - pStd[a]).map((j, k) => [j, k + 1]));
    return { pStd, relUncertainty: relativeScale(pStd, untested), rank };
  }, [posterior]);

  const togglePredictions = (on: boolean) => {
    setShowPredictions(on);
    if (!on) setShowUncertainty(false);
    onSessionChange((s) => noteToggles(s, on, false));
  };
  const toggleUncertainty = (on: boolean) => {
    setShowUncertainty(on);
    if (on) setShowPredictions(true);
    onSessionChange((s) => noteToggles(s, on, on));
  };

  const left = testsLeft(session);
  return (
    <main className="play">
      <header className="bar">
        <div>
          <b>{title}</b> · {preset.name} · outbreak {outbreak.id} · <i>{nickname}</i>
        </div>
        <button className="key-button" aria-expanded={showKey} onClick={() => setShowKey((v) => !v)}>
          What do the colours mean?
        </button>
        <div aria-label="tests left">
          Tests left:{' '}
          <span className="pips" aria-hidden="true">
            {Array.from({ length: session.budget }, (_, k) => (
              <span key={k} className={k < left ? 'pip on' : 'pip'} />
            ))}
          </span>{' '}
          <b data-testid="tests-left">{left} / {session.budget}</b>
        </div>
      </header>
      {banner}
      {showKey && <Explainer onClose={() => setShowKey(false)} />}
      <div className="play-body">
        <GraphView
          graph={graph}
          layout={preset.layout}
          tested={tested}
          predictions={showPredictions ? posterior.p : null}
          uncertainty={showUncertainty ? relUncertainty : null}
          hovered={hovered}
          onHover={setHovered}
          onPick={(node) => onSessionChange((s) => (isFinished(s) || isTested(s, node) ? s : pick(s, node, graph.n)))}
        />
        <SidePanel
          showPredictions={showPredictions}
          showUncertainty={showUncertainty}
          onTogglePredictions={togglePredictions}
          onToggleUncertainty={toggleUncertainty}
          hovered={hovered}
          tested={tested}
          p={posterior.p}
          pStd={pStd}
          rank={rank}
        />
      </div>
    </main>
  );
}
