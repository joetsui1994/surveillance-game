import type { Graph } from '../../core/graph.ts';
import { Explainer } from './Explainer.tsx';

export interface SidePanelProps {
  graph: Graph;
  showPredictions: boolean;
  showUncertainty: boolean;
  onTogglePredictions: (on: boolean) => void;
  onToggleUncertainty: (on: boolean) => void;
  hovered: number | null;
  /** Result per tested node. */
  tested: Map<number, 0 | 1>;
  p: ArrayLike<number>;
  pStd: ArrayLike<number>;
  /** Uncertainty rank (1 = most uncertain) per untested node. */
  rank: Map<number, number>;
}

function hopCounts(graph: Graph, node: number): number[] {
  const counts = [0, 0, 0];
  for (let j = 0; j < graph.n; j++) {
    const d = graph.dist[node * graph.n + j];
    if (d >= 1 && d <= 3) counts[d - 1]++;
  }
  return counts;
}

export function SidePanel(props: SidePanelProps) {
  const { graph, showPredictions, showUncertainty, hovered, tested, p, pStd, rank } = props;
  let hoverText = <span className="muted">Hover over a location to inspect it.</span>;
  if (hovered !== null) {
    const result = tested.get(hovered);
    const [h1, h2, h3] = hopCounts(graph, hovered);
    hoverText = (
      <>
        <b>Location {hovered}</b>
        <br />
        {result !== undefined ? (
          <>Tested: {result === 1 ? 'infected' : 'clear'}</>
        ) : (
          // Reveal only what the switched-on overlays show, so the toggles mean something.
          showPredictions ? (
            <>
              P(infected) ≈ {p[hovered].toFixed(2)}
              {showUncertainty && <> ± {pStd[hovered].toFixed(2)}<br />Uncertainty rank {rank.get(hovered)} of {rank.size}</>}
            </>
          ) : (
            <span className="muted">Untested. Switch on Predictions to see the model's guess.</span>
          )
        )}
        <br />
        <span className="muted">1-hop: {h1} · 2-hop: {h2} · 3-hop: {h3}</span>
      </>
    );
  }
  return (
    <aside className="side">
      <div className="panel">
        <b>Show model</b>
        <label>
          <input type="checkbox" checked={showPredictions} onChange={(e) => props.onTogglePredictions(e.target.checked)} /> Predictions (colour)
        </label>
        <label>
          <input type="checkbox" checked={showUncertainty} onChange={(e) => props.onToggleUncertainty(e.target.checked)} /> Uncertainty (orange rings)
        </label>
      </div>
      <div className="panel hover-box" data-testid="hover-box">{hoverText}</div>
      <Explainer />
      <p className="muted small">No live score during play: it would give the answer away. You choose where to test; the model does the mapping.</p>
    </aside>
  );
}
