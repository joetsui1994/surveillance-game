export interface SidePanelProps {
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

export function SidePanel(props: SidePanelProps) {
  const { showPredictions, showUncertainty, hovered, tested, p, pStd, rank } = props;
  let hoverText = <span className="muted">Hover over a location to inspect it.</span>;
  if (hovered !== null) {
    const result = tested.get(hovered);
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
      <p className="muted small">No live score during play: it would give the answer away. You choose where to test; the model does the mapping.</p>
    </aside>
  );
}
