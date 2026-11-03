import type { Graph } from '../../core/graph.ts';
import { COLORS, predictionColor, ringStyle } from '../scales.ts';

export const VIEW = 330;
export const PAD = 25;
export const R = 9;
/** Outline of the hovered node; its own edges are drawn darker and thicker. Nothing else changes on hover. */
const HOVER_OUTLINE = 3.5;
/** Half-length of the strokes of the + / − drawn on tested nodes. */
const SYMBOL = 4.5;

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
  /** Test order (1, 2, …) shown as a small badge beside tested nodes, e.g. in a replay. */
  order?: Map<number, number>;
}

export function GraphView(props: GraphViewProps) {
  const { graph, layout, tested, predictions, uncertainty, truth, wrong, hovered, onHover, onPick, order } = props;
  const { n } = graph;
  const xy = (i: number): [number, number] => [PAD + layout[i][0] * (VIEW - 2 * PAD), PAD + layout[i][1] * (VIEW - 2 * PAD)];

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
        const touches = hovered === a || hovered === b;
        return (
          <line
            key={`${a}-${b}`}
            data-testid={`edge-${a}-${b}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={touches ? COLORS.ink : COLORS.edge}
            strokeWidth={touches ? 3 : 1.5}
          />
        );
      })}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = xy(i);
        const result = tested.get(i);
        const isTested = result !== undefined;
        const isHovered = hovered === i;
        const outline = isHovered ? HOVER_OUTLINE : isTested ? 2.5 : 0.8;
        const ring = !isTested && uncertainty ? ringStyle(uncertainty[i]) : null;
        const clickable = !isTested && onPick !== undefined;
        return (
          <g key={i}>
            {ring && <circle cx={x} cy={y} r={R + ring.width / 2 + 0.5} fill="none" stroke={COLORS.ring} strokeWidth={ring.width} opacity={ring.opacity} pointerEvents="none" />}
            <circle
              data-testid={`node-${i}`}
              data-fill={fill(i)}
              cx={x}
              cy={y}
              r={R}
              fill={fill(i)}
              stroke={isTested || isHovered ? '#000' : COLORS.outline}
              strokeWidth={outline}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
              onMouseEnter={() => onHover(i)}
              onClick={clickable ? () => onPick(i) : undefined}
            />
            {isTested && (
              // Drawn as strokes rather than text, so + and − sit exactly at the node centre in any font.
              <path
                data-testid={`symbol-${i}`}
                d={result === 1 ? `M${x - SYMBOL},${y}h${2 * SYMBOL}M${x},${y - SYMBOL}v${2 * SYMBOL}` : `M${x - SYMBOL},${y}h${2 * SYMBOL}`}
                stroke="#fff"
                strokeWidth={2.4}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            {order?.has(i) && (
              <g pointerEvents="none" data-testid={`order-${i}`}>
                <circle cx={x + R * 0.95} cy={y - R * 0.95} r={5.5} fill="#fff" stroke={COLORS.ink} strokeWidth={1} />
                <text x={x + R * 0.95} y={y - R * 0.95 + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill={COLORS.ink}>
                  {order.get(i)}
                </text>
              </g>
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
