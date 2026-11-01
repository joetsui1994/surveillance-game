import type { Graph } from '../../core/graph.ts';
import { COLORS, predictionColor, ringStyle } from '../scales.ts';

const VIEW = 330;
const PAD = 25;
const R = 9;
const MAX_HOPS = 3;
/** Outline width by hop distance from the hovered node (0 = the hovered node itself). */
const HOP_OUTLINE = [3.5, 2.2, 1.6, 1.2];

export interface GraphViewProps {
  graph: Graph;
  /** Node positions in [0, 1]². */
  layout: [number, number][];
  /** Test result per tested node. */
  tested: Map<number, 0 | 1>;
  /** P(infected) per node, or null when predictions are hidden. */
  predictions: ArrayLike<number> | null;
  /** Relative uncertainty in [0, 1] per node, or null when hidden. */
  uncertainty: ArrayLike<number> | null;
  /** Results mode: true status (colours untested nodes) and nodes the model got wrong (marked ✕). */
  truth?: (0 | 1)[];
  wrong?: Set<number>;
  hovered: number | null;
  onHover: (node: number | null) => void;
  /** Called when an untested node is clicked; omit to make the graph read-only. */
  onPick?: (node: number) => void;
}

export function GraphView(props: GraphViewProps) {
  const { graph, layout, tested, predictions, uncertainty, truth, wrong, hovered, onHover, onPick } = props;
  const { n, dist } = graph;
  const xy = (i: number): [number, number] => [PAD + layout[i][0] * (VIEW - 2 * PAD), PAD + layout[i][1] * (VIEW - 2 * PAD)];
  const hops = (i: number) => (hovered === null ? -1 : dist[hovered * n + i]);
  const near = (i: number) => hovered === null || (hops(i) >= 0 && hops(i) <= MAX_HOPS);

  const fill = (i: number) => {
    const result = tested.get(i);
    if (result !== undefined) return result === 1 ? COLORS.infected : COLORS.clear;
    if (truth) return truth[i] === 1 ? COLORS.truthInfected : COLORS.truthClear;
    return predictions ? predictionColor(predictions[i]) : COLORS.unknown;
  };

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="graph" role="img" aria-label="Network of locations" onMouseLeave={() => onHover(null)}>
      {graph.edges.map(([a, b]) => {
        const [x1, y1] = xy(a);
        const [x2, y2] = xy(b);
        return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.edge} strokeWidth={1.5} opacity={near(a) || near(b) ? 1 : 0.25} />;
      })}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = xy(i);
        const result = tested.get(i);
        const isTested = result !== undefined;
        const h = hops(i);
        const outline = h >= 0 && h <= MAX_HOPS ? HOP_OUTLINE[h] : isTested ? 2.5 : 0.8;
        const ring = !isTested && uncertainty ? ringStyle(uncertainty[i]) : null;
        const clickable = !isTested && onPick !== undefined;
        return (
          <g key={i} opacity={near(i) ? 1 : 0.25}>
            {ring && <circle cx={x} cy={y} r={R + ring.width / 2 + 0.5} fill="none" stroke={COLORS.ring} strokeWidth={ring.width} opacity={ring.opacity} pointerEvents="none" />}
            <circle
              data-testid={`node-${i}`}
              data-fill={fill(i)}
              cx={x}
              cy={y}
              r={R}
              fill={fill(i)}
              stroke={isTested || h >= 0 ? '#000' : COLORS.outline}
              strokeWidth={outline}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
              onMouseEnter={() => onHover(i)}
              onClick={clickable ? () => onPick(i) : undefined}
            />
            {isTested && (
              <text x={x} y={y + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">
                {result === 1 ? '+' : '−'}
              </text>
            )}
            {!isTested && wrong?.has(i) && (
              <text data-testid={`wrong-${i}`} x={x} y={y + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill={COLORS.ink} pointerEvents="none">
                ✕
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
