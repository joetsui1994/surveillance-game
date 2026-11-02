import QRCode from 'qrcode';
import { useMemo } from 'react';

/** A QR code drawn as SVG squares (no canvas, no innerHTML). */
export function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const { n, cells } = useMemo(() => {
    const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    const cells: [number, number][] = [];
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) cells.push([r, c]);
    return { n: m.size, cells };
  }, [text]);
  const quiet = 4;
  return (
    <svg data-testid="qr" width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={n + 2 * quiet} height={n + 2 * quiet} fill="#fff" />
      <path d={cells.map(([r, c]) => `M${c},${r}h1v1h-1z`).join('')} fill="#000" />
    </svg>
  );
}
