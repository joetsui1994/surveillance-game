import { COLORS } from '../scales.ts';

/** Gaussian bump over [0, 1] centred at 0.5, as an SVG path in a 140×90 box. */
function densityPath(sd: number): string {
  const pts: string[] = [];
  for (let k = 0; k <= 140; k++) {
    const x = k / 140;
    pts.push(`L${k},${(90 - 80 * Math.exp(-((x - 0.5) ** 2) / (2 * sd * sd))).toFixed(1)}`);
  }
  return `M0,90 ${pts.join(' ')} L140,90 Z`;
}

function Density({ x, title, sd, fill, stroke }: { x: number; title: string; sd: number; fill: string; stroke: string }) {
  return (
    <g transform={`translate(${x},10)`}>
      <text x={70} y={8} fontSize={11} textAnchor="middle" fill={COLORS.ink}>{title}</text>
      <line x1={0} y1={90} x2={140} y2={90} stroke="#999" />
      <path d={densityPath(sd)} fill={fill} stroke={stroke} />
      <text x={0} y={104} fontSize={9} fill={COLORS.ink}>0</text>
      <text x={70} y={104} fontSize={9} textAnchor="middle" fill={COLORS.ink}>0.5</text>
      <text x={140} y={104} fontSize={9} textAnchor="end" fill={COLORS.ink}>1</text>
    </g>
  );
}

export function Explainer() {
  return (
    <details className="panel" open>
      <summary>What do the colours mean?</summary>
      <p>
        <b style={{ color: COLORS.infected }}>+</b> / <b style={{ color: COLORS.clear }}>−</b> tested location: infected / clear.
      </p>
      <p><b>Shading</b> is the model's best guess of P(infected) at each untested location.</p>
      <p>
        <b>Orange rings</b> show how <i>sure</i> the model is about that guess: the width of its belief about P(infected).
        Thicker ring = wider belief.
      </p>
      <svg viewBox="0 0 320 120" width="100%" aria-label="Two beliefs with the same average">
        <Density x={10} title="Confident it's 50/50" sd={0.04} fill="#b0bec5" stroke="#455a64" />
        <Density x={170} title="No idea (also 0.5 on average)" sd={0.3} fill="#ffcc80" stroke={COLORS.ring} />
      </svg>
      <p className="muted">
        Both have P(infected) = 0.5 on average, but only the right one gets a thick ring. Rings are relative: the thickest
        ring is the most uncertain location right now.
      </p>
    </details>
  );
}
