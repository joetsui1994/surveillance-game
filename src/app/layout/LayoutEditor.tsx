// Dev-only (#/layout): drag nodes to tidy a network's layout, with live fault checks, and save it to offline/layouts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutFaults, type Point } from '../../core/layoutQuality.ts';
import type { Preset } from '../../core/presets.ts';
import { PAD, R, VIEW } from '../components/GraphView.tsx';
import { loadGameData } from '../data.ts';
import { COLORS } from '../scales.ts';

const TOWN_COLORS = ['#6a8fd0', '#d08a6a', '#7ab37a'];
const FAULT = '#d03b3b';
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export default function LayoutEditor() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [layout, setLayout] = useState<Point[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [towns, setTowns] = useState(false);
  const [status, setStatus] = useState('');
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    loadGameData().then((d) => {
      // The grid's layout is computed, not edited.
      const editable = d.presets.presets.filter((p) => p.id !== 'grid10');
      setPresets(editable);
      setId(editable[0]?.id ?? null);
    }, (e: unknown) => setStatus(String(e)));
  }, []);

  const preset = presets?.find((p) => p.id === id) ?? null;
  useEffect(() => {
    if (preset) setLayout(preset.layout.map(([x, y]): Point => [x, y]));
    setStatus('');
  }, [preset]);

  const faults = useMemo(() => (preset && layout.length === preset.n ? layoutFaults(layout, preset.edges) : null), [preset, layout]);
  if (!presets || !preset || !faults) return <main className="message">{status || 'Loading…'}</main>;

  const badNodes = new Set([...faults.close.flat(), ...faults.onEdge.map(([i]) => i)]);
  const badEdges = new Set([...faults.onEdge.map(([, e]) => e), ...faults.crossings.flat()]);
  const xy = ([x, y]: Point): Point => [PAD + x * (VIEW - 2 * PAD), PAD + y * (VIEW - 2 * PAD)];

  const toLayout = (e: React.PointerEvent): Point => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [clamp01((p.x - PAD) / (VIEW - 2 * PAD)), clamp01((p.y - PAD) / (VIEW - 2 * PAD))];
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragging === null) return;
    const p = toLayout(e);
    setLayout((l) => l.map((q, i) => (i === dragging ? p : q)));
  };
  const save = async () => {
    setStatus('Saving…');
    const res = await fetch('/__layout/save', { method: 'POST', body: JSON.stringify({ id: preset.id, layout }) });
    const body = (await res.json()) as { path?: string; error?: string };
    setStatus(res.ok ? `Saved to ${body.path}. Run npm run data:presets to apply it to the game.` : `Not saved: ${body.error}`);
  };

  return (
    <main className="layout-editor">
      <header className="bar">
        <div>
          <b>Layout editor</b> (dev only) ·{' '}
          <select value={preset.id} onChange={(e) => setId(e.target.value)} aria-label="Network">
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
            ))}
          </select>
        </div>
        <div className="layout-actions">
          {preset.communities && (
            <label>
              <input type="checkbox" checked={towns} onChange={(e) => setTowns(e.target.checked)} /> Colour by community
            </label>
          )}
          <button onClick={() => setLayout(preset.layout.map(([x, y]): Point => [x, y]))}>Revert</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </header>
      <p className="layout-stats" data-testid="layout-stats">
        <span className={faults.close.length ? 'bad' : ''}>{faults.close.length} overlapping pairs</span> ·{' '}
        <span className={faults.onEdge.length ? 'bad' : ''}>{faults.onEdge.length} nodes on edges</span> · {faults.crossings.length} crossings
        {status && <> · {status}</>}
      </p>
      <svg
        ref={svg}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="layout-canvas"
        onPointerMove={onMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        {preset.edges.map(([a, b], e) => {
          const [x1, y1] = xy(layout[a]);
          const [x2, y2] = xy(layout[b]);
          return <line key={e} x1={x1} y1={y1} x2={x2} y2={y2} stroke={badEdges.has(e) ? FAULT : COLORS.edge} strokeWidth={1.5} />;
        })}
        {layout.map((p, i) => {
          const [x, y] = xy(p);
          const fill = towns && preset.communities ? TOWN_COLORS[preset.communities[i] % TOWN_COLORS.length] : COLORS.unknown;
          return (
            <circle
              key={i}
              data-testid={`node-${i}`}
              cx={x}
              cy={y}
              r={R}
              fill={fill}
              stroke={badNodes.has(i) ? FAULT : COLORS.outline}
              strokeWidth={badNodes.has(i) ? 2.5 : 0.8}
              style={{ cursor: 'grab' }}
              onPointerDown={() => setDragging(i)}
            />
          );
        })}
      </svg>
    </main>
  );
}
