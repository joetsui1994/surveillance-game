import { useRef, useState } from 'react';
import { nudgeLabels } from '../labels.ts';

export interface ChartSeries {
  key: string;
  name: string;
  /** Short name for the end-of-line label. */
  short: string;
  color: string;
  width: number;
  dash?: string;
  values: (number | null)[];
}

export interface AucChartProps {
  series: ChartSeries[];
  /** Optional reference band (e.g. Random's 5–95%). */
  band?: { lo: (number | null)[]; hi: (number | null)[]; color: string };
  /** Faint unlabelled lines drawn behind the series (e.g. every player's curve). */
  background?: (number | null)[][];
  /** Step to mark with a vertical line (e.g. the replay position). */
  marker?: number;
  title?: string;
  subtitle?: string;
}

const W = 460;
const H = 240;
const L = 40;
const R = 380;
const T = 8;
const B = 204;

/** AUC against number of tests, y fixed to [0.5, 1]. Legend above, direct labels right, hover crosshair. */
export function AucChart({
  series,
  band,
  background = [],
  marker,
  title = "How good was the model's map after each test?",
  subtitle = 'AUC on untested locations · higher is better',
}: AucChartProps) {
  const N = Math.max(1, Math.max(...series.map((s) => s.values.length)) - 1);
  // Axis starts at 0.5 (chance) unless some value is lower; then it extends down in steps of 0.1.
  const all = [...series.flatMap((s) => s.values), ...(band?.lo ?? []), ...background.flat()].filter((v): v is number => v !== null);
  const yMin = Math.min(0.5, Math.floor(Math.min(...all, 0.5) * 10) / 10);
  const gridValues = Array.from({ length: Math.round((1 - yMin) * 10) + 1 }, (_, k) => +(yMin + k / 10).toFixed(1));
  const X = (t: number) => L + (t / N) * (R - L);
  const Y = (v: number) => B - ((Math.min(Math.max(v, yMin), 1) - yMin) / (1 - yMin)) * (B - T);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, t) => {
      if (v === null) return;
      d += `${d === '' ? 'M' : 'L'}${X(t)},${Y(v)} `;
    });
    return d;
  };
  const last = (vals: (number | null)[]) => vals[N] ?? null;
  const labelled = series.filter((s) => last(s.values) !== null);
  const labelYs = nudgeLabels(labelled.map((s) => Y(last(s.values)!)), 14, T + 4, B - 2);
  const ticks = Array.from({ length: Math.floor(N / 2) + 1 }, (_, k) => 2 * k).concat(N % 2 === 1 ? [N] : []);

  const onMove = (e: React.MouseEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - box.left) * W) / box.width;
    setHoverT(Math.max(0, Math.min(N, Math.round(((sx - L) / (R - L)) * N))));
  };

  return (
    <div className="chart">
      <div className="chart-title">{title}</div>
      <div className="chart-subtitle">{subtitle}</div>
      <div className="legend" data-testid="legend">
        {[...series].reverse().map((s) => (
          <span key={s.key}>
            <svg width={22} height={10} aria-hidden="true">
              <line x1={1} y1={5} x2={21} y2={5} stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%">
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke={v === yMin ? '#c9c7c1' : '#eceae6'} />
              <text x={L - 6} y={Y(v) + 4} fontSize={11} textAnchor="end" fill="#52514e">{v.toFixed(1)}</text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={t} x={X(t)} y={B + 16} fontSize={11} textAnchor="middle" fill="#52514e">{t}</text>
          ))}
          <text x={(L + R) / 2} y={B + 32} fontSize={11} textAnchor="middle" fill="#52514e">tests used (0 = starting location only)</text>
          {band && (
            <path
              d={
                'M' +
                band.hi.map((v, t) => `${X(t)},${Y(v ?? 0.5)}`).join(' L') +
                ' L' +
                band.lo.map((v, t) => `${X(t)},${Y(v ?? 0.5)}`).reverse().join(' L') +
                ' Z'
              }
              fill={band.color}
              opacity={0.16}
            />
          )}
          {background.map((values, k) => (
            <path key={`bg${k}`} d={path(values)} fill="none" stroke="#0b0b0b" strokeOpacity={0.14} strokeWidth={1} strokeLinejoin="round" />
          ))}
          {marker !== undefined && <line data-testid="chart-marker" x1={X(marker)} x2={X(marker)} y1={T} y2={B} stroke="#ef6c00" strokeWidth={2} />}
          {series.map((s) => (
            <g key={s.key}>
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
              {last(s.values) !== null && <circle cx={X(N)} cy={Y(last(s.values)!)} r={s.width >= 3 ? 4 : 3} fill={s.color} stroke="#fcfcfb" strokeWidth={2} />}
            </g>
          ))}
          {labelled.map((s, k) => (
            <g key={s.key}>
              <line x1={X(N) + 5} y1={Y(last(s.values)!)} x2={R + 8} y2={labelYs[k]} stroke="#c9c7c1" />
              <text x={R + 11} y={labelYs[k] + 4} fontSize={11} fontWeight={s.width >= 3 ? 700 : 400} fill="#0b0b0b">
                {s.short} {last(s.values)!.toFixed(2)}
              </text>
            </g>
          ))}
          {hoverT !== null && <line x1={X(hoverT)} x2={X(hoverT)} y1={T} y2={B} stroke="#9e9c96" />}
          <rect x={L} y={T} width={R - L} height={B - T} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHoverT(null)} />
        </svg>
        {hoverT !== null && (
          <div className="tooltip" style={X(hoverT) / W > 0.55 ? { right: `${(1 - X(hoverT) / W) * 100 + 2}%` } : { left: `${(X(hoverT) / W) * 100 + 2}%` }}>
            <b>After {hoverT} test{hoverT === 1 ? '' : 's'}</b>
            {[...series].reverse().map((s) => (
              <div key={s.key}>
                <span className="swatch" style={{ background: s.color }} />
                {s.short}: {s.values[hoverT] === null ? '–' : s.values[hoverT]!.toFixed(3)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
