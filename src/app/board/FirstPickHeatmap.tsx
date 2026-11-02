import type { Graph } from '../../core/graph.ts';
import { COLORS } from '../scales.ts';

const VIEW = 330;
const PAD = 25;
const R = 9;
// Single-hue sequential ramp (teal), distinct from infection red/blue and uncertainty orange.
const LO = [224, 242, 241];
const HI = [0, 105, 92];

const shade = (t: number) => `rgb(${LO.map((lo, k) => Math.round(lo + (HI[k] - lo) * t)).join(',')})`;

/** Where did people test first? Darker = more players; counts printed on nodes. The starting location is outlined. */
export function FirstPickHeatmap({ graph, layout, counts, seedNode }: { graph: Graph; layout: [number, number][]; counts: number[]; seedNode: number }) {
  const max = Math.max(1, ...counts);
  const xy = (i: number): [number, number] => [PAD + layout[i][0] * (VIEW - 2 * PAD), PAD + layout[i][1] * (VIEW - 2 * PAD)];
  return (
    <figure className="heatmap">
      <figcaption>Where did people test first?</figcaption>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="graph" role="img" aria-label="First-test heatmap">
        {graph.edges.map(([a, b]) => {
          const [x1, y1] = xy(a);
          const [x2, y2] = xy(b);
          return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.edge} strokeWidth={1} opacity={0.5} />;
        })}
        {counts.map((c, i) => {
          const [x, y] = xy(i);
          const t = c / max;
          return (
            <g key={i}>
              <circle data-testid={`heat-${i}`} cx={x} cy={y} r={R} fill={c === 0 ? '#f1f0ec' : shade(0.25 + 0.75 * t)} stroke={i === seedNode ? COLORS.ink : COLORS.outline} strokeWidth={i === seedNode ? 3 : 0.6} />
              {c > 0 && (
                <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill={t > 0.5 ? '#fff' : COLORS.ink}>
                  {c}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="muted small">Numbers = players whose first test was there · thick outline = starting location</p>
    </figure>
  );
}
